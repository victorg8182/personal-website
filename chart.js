(function () {
  var DATA = window.VIEWS_DATA;
  var mount = document.getElementById("views-chart");
  if (!DATA || !mount) return;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var START = DATA.startFrom || "0000-00";

  function toPoint(r) {
    var p = r[0].split("-");
    return { key: r[0], year: +p[0], month: +p[1],
             t: (+p[0] - 2020) * 12 + (+p[1] - 1), v: r[1] };
  }

  /* full history drives the numbers; `series` is only what gets plotted */
  var full   = DATA.SERIES.map(toPoint);
  var series = full.filter(function (p) { return p.key >= START; });

  var LOG   = DATA.scale !== "linear";
  var last  = series[series.length - 1];
  var first = series[0];
  var peak  = last.v;

  var DECADES  = [1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9];
  var LIN_STEP = peak >= 1e9 ? 5e8 : peak >= 1e8 ? 5e7 : Math.pow(10, Math.floor(Math.log10(peak)));
  var Y_MIN = LOG ? 100 : 0;
  var Y_MAX = LOG ? 4e9 : Math.ceil((peak * 1.06) / LIN_STEP) * LIN_STEP;
  var LIN_TICKS = [];
  for (var tv = 0; tv <= Y_MAX + 1; tv += LIN_STEP) LIN_TICKS.push(tv);

  /* ---------------- formatting ---------------- */
  function compact(n) {
    var a = Math.abs(n);
    if (a >= 1e9) return trim(n / 1e9) + "B";
    if (a >= 1e6) return trim(n / 1e6) + "M";
    if (a >= 1e3) return trim(n / 1e3) + "K";
    return String(Math.round(n));
  }
  function trim(x) {
    var s = Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2);
    return s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  /* ---------------- year index ---------------- */
  var byYear = {};
  series.forEach(function (p) {
    (byYear[p.year] = byYear[p.year] || []).push(p);
  });
  var YEARS = Object.keys(byYear).map(Number).sort();

  /* month → index, so the dot can be placed by position on the axis rather
     than by which data point happens to end the year */
  var idxByT = {};
  series.forEach(function (p, i) { idxByT[p.t] = i; });

  function yearInfo(y) {
    var pts   = byYear[y];
    var endPt = pts[pts.length - 1];
    /* baseline = last month of the previous year, from the FULL history so the
       gain stays correct even when early years aren't plotted */
    var fullPrev = full[full.indexOf(pts[0]) - 1];
    var startV   = fullPrev ? fullPrev.v : 0;
    /* the band is the year's column: jan gridline to jan gridline, clamped to
       the plot so the current (part-finished) year stops at the right edge */
    return {
      year: y,
      tStart: Math.max((y - 2020) * 12, first.t),
      tEnd:   Math.min((y + 1 - 2020) * 12, last.t),
      endPt: endPt,
      total: endPt.v,
      gain: endPt.v - startV,
      partial: endPt.month < 12
    };
  }

  /* ---------------- headline elements ---------------- */
  var elTotal = document.querySelector("[data-views-total]");
  var elCtx   = document.querySelector("[data-views-context]");
  var elDelta = document.querySelector("[data-views-delta]");
  var elDeltaWrap = elDelta && elDelta.parentNode;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- easing (mirrors the CSS curves) ---------------- */
  function bez(p1, p2) {
    function f(t, a, b) { var u = 1 - t; return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t; }
    return function (x) {
      var lo = 0, hi = 1, t = x;
      for (var i = 0; i < 18; i++) {
        if (f(t, p1[0], p2[0]) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return f(t, p1[1], p2[1]);
    };
  }
  var easeViz  = bez([0.62, 0.00], [0.16, 1]);   /* --ease-viz  */
  var easeSoft = bez([0.33, 1.00], [0.68, 1]);   /* --ease-soft */

  /* number tween */
  var shown = last.v, tweenRAF = null;
  function tweenTo(target) {
    if (!elTotal) return;
    if (reduced) { shown = target; elTotal.textContent = compact(target); return; }
    var from = shown, delta = target - from, t0 = null, DUR = 750;
    if (tweenRAF) cancelAnimationFrame(tweenRAF);
    function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / DUR);
      var e = 1 - Math.pow(1 - k, 4);
      shown = from + delta * e;
      elTotal.textContent = compact(shown);
      if (k < 1) tweenRAF = requestAnimationFrame(step);
      else { shown = target; elTotal.textContent = compact(target); }
    }
    tweenRAF = requestAnimationFrame(step);
  }

  function swapDelta(text) {
    if (!elDelta) return;
    if (reduced) { elDelta.textContent = text; return; }
    elDeltaWrap.classList.add("is-swapping");
    setTimeout(function () {
      elDelta.textContent = text;
      elDeltaWrap.classList.remove("is-swapping");
    }, 200);
  }

  /* ---------------- render ---------------- */
  var PAD = { top: 16, right: 10, bottom: 26, left: 42 };
  var geo = null;          // { x(), y(), plotL, plotR, innerH }
  var nodes = {};
  var currentYear = null;  // null === intro / all
  var hasDrawn = false;

  /* ---------------- dot travel ----------------
     The marker walks the polyline itself — animating cx/cy in CSS would cut
     the corner and float the dot off the curve mid-transition.

     Two parameterisations, because the dot has a different partner in each
     case and has to keep step with it:
       · year change — the band's edges ease in X, so the dot must ease in X
         too. Easing arc length instead makes it lag through steep stretches
         (a month of 2024 is many times longer on the curve than on the axis).
       · intro       — the line draws by stroke-dashoffset, which is arc
         length, so there the dot eases in arc length to stay at the tip. */
  var dotX = null, dotRAF = null;

  function pointAtX(px) {
    var p = geo.pts, n = p.length - 1;
    if (px <= p[0].x) return p[0];
    if (px >= p[n].x) return p[n];
    var lo = 0, hi = n;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (p[mid].x <= px) lo = mid; else hi = mid;
    }
    var span = p[hi].x - p[lo].x || 1;
    var k = (px - p[lo].x) / span;
    return { x: px, y: p[lo].y + (p[hi].y - p[lo].y) * k };
  }

  function pointAtLen(L) {
    var p = geo.pts, c = geo.cum, n = c.length - 1;
    if (L <= 0) return p[0];
    if (L >= c[n]) return p[n];
    var lo = 0, hi = n;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (c[mid] <= L) lo = mid; else hi = mid;
    }
    var seg = c[hi] - c[lo] || 1;
    var k = (L - c[lo]) / seg;
    return { x: p[lo].x + (p[hi].x - p[lo].x) * k, y: p[lo].y + (p[hi].y - p[lo].y) * k };
  }

  function placeDot(pt) {
    if (!nodes.dot) return;
    nodes.dot.setAttribute("cx", pt.x);
    nodes.dot.setAttribute("cy", pt.y);
    nodes.halo.setAttribute("cx", pt.x);
    nodes.halo.setAttribute("cy", pt.y);
    dotX = pt.x;        // wherever it actually is, even mid-flight
  }

  /* `resolve` maps the animated value back onto the curve, so the same tween
     serves both parameterisations */
  function travelDot(from, to, dur, ease, resolve) {
    if (dotRAF) { cancelAnimationFrame(dotRAF); dotRAF = null; }
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      placeDot(resolve(from + (to - from) * ease(k)));
      if (k < 1) dotRAF = requestAnimationFrame(step);
      else dotRAF = null;
    }
    dotRAF = requestAnimationFrame(step);
  }

  function moveDotTo(idx, instant) {
    if (!geo || !geo.pts) return;
    var to = geo.pts[Math.max(0, Math.min(geo.pts.length - 1, idx))].x;
    if (instant || reduced || dotX === null || Math.abs(to - dotX) < 0.5) {
      if (dotRAF) { cancelAnimationFrame(dotRAF); dotRAF = null; }
      placeDot(pointAtX(to));
      return;
    }
    /* same duration and curve as the band's x/width transition, on the same
       axis — so the dot and the highlight edge stay locked together */
    travelDot(dotX, to, 1100, easeViz, pointAtX);
  }

  function el(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function render() {
    var W = mount.clientWidth, H = mount.clientHeight;
    if (!W || !H) return;

    var innerW = W - PAD.left - PAD.right;
    var innerH = H - PAD.top - PAD.bottom;
    var tMin = first.t, tMax = last.t;

    function x(t) { return PAD.left + ((t - tMin) / (tMax - tMin)) * innerW; }
    function y(v) {
      var f = LOG
        ? (Math.log10(Math.max(v, Y_MIN)) - Math.log10(Y_MIN)) / (Math.log10(Y_MAX) - Math.log10(Y_MIN))
        : (v - Y_MIN) / (Y_MAX - Y_MIN);
      return PAD.top + innerH - f * innerH;
    }
    /* screen-space polyline + cumulative length — the track the dot rides */
    var pts = series.map(function (p) { return { x: x(p.t), y: y(p.v) }; });
    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }

    geo = { x: x, y: y, plotL: PAD.left, plotR: W - PAD.right, top: PAD.top, innerH: innerH, W: W,
            pts: pts, cum: cum };

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, class: "chart-svg", "aria-hidden": "true" });

    /* defs */
    var defs = el("defs", {});
    var grad = el("linearGradient", { id: "viz-fill", x1: "0", y1: "0", x2: "0", y2: "1" });
    grad.appendChild(el("stop", { offset: "0%",   class: "chart-fill-top" }));
    grad.appendChild(el("stop", { offset: "100%", class: "chart-fill-bottom" }));
    defs.appendChild(grad);

    /* hard-edged window; smoothness comes from the easing, not from blur */
    var clip = el("clipPath", { id: "viz-clip" });
    var clipRect = el("rect", {
      class: "chart-clip-rect", x: PAD.left, y: 0, width: innerW, height: H
    });
    clip.appendChild(clipRect);
    defs.appendChild(clip);
    svg.appendChild(defs);

    /* exactly the plot box — any overhang reads as the band breaking the frame */
    var band = el("rect", {
      class: "chart-band",
      x: PAD.left, y: PAD.top, width: innerW, height: innerH
    });
    svg.appendChild(band);

    /* gridlines */
    (LOG ? DECADES : LIN_TICKS).forEach(function (v) {
      var yy = Math.round(y(v)) + 0.5;
      if (yy < PAD.top - 1 || yy > PAD.top + innerH + 1) return;
      svg.appendChild(el("line", { x1: PAD.left, y1: yy, x2: W - PAD.right, y2: yy, class: "chart-grid" }));
      var lb = el("text", { x: PAD.left - 10, y: yy + 3.2, class: "chart-ylabel", "text-anchor": "end" });
      lb.textContent = compact(v);
      svg.appendChild(lb);
    });

    /* x ticks */
    var xlabels = {};
    YEARS.forEach(function (yr) {
      var t = (yr - 2020) * 12;
      if (t < tMin || t > tMax) return;
      var xx = Math.round(x(t)) + 0.5;
      svg.appendChild(el("line", { x1: xx, y1: PAD.top, x2: xx, y2: PAD.top + innerH, class: "chart-grid chart-grid--v" }));
      var lb = el("text", { x: xx, y: PAD.top + innerH + 16, class: "chart-xlabel", "text-anchor": "middle" });
      lb.textContent = "'" + String(yr).slice(2);
      svg.appendChild(lb);
      xlabels[yr] = lb;
    });

    /* paths */
    var d = series.map(function (p, i) {
      return (i ? "L" : "M") + x(p.t).toFixed(2) + " " + y(p.v).toFixed(2);
    }).join(" ");
    var areaD = d + " L" + x(tMax).toFixed(2) + " " + (PAD.top + innerH).toFixed(2) +
                    " L" + x(tMin).toFixed(2) + " " + (PAD.top + innerH).toFixed(2) + " Z";

    svg.appendChild(el("path", { d: d, class: "chart-line-base" }));

    var g = el("g", { "clip-path": "url(#viz-clip)" });
    g.appendChild(el("path", { d: areaD, class: "chart-area-hi", fill: "url(#viz-fill)" }));
    var lineHi = el("path", { d: d, class: "chart-line-hi" });
    g.appendChild(lineHi);
    svg.appendChild(g);

    var halo = el("circle", { class: "chart-dot-halo", cx: x(last.t), cy: y(last.v), r: 6 });
    var dot  = el("circle", { class: "chart-dot",      cx: x(last.t), cy: y(last.v), r: 2.7 });
    svg.appendChild(halo);
    svg.appendChild(dot);

    mount.innerHTML = "";
    mount.appendChild(svg);

    nodes = { svg: svg, clipRect: clipRect, band: band, lineHi: lineHi, dot: dot, halo: halo, xlabels: xlabels, innerW: innerW };

    /* one-time draw-in */
    var intro = !hasDrawn && !reduced;
    hasDrawn = true;

    apply(currentYear, true);

    if (intro) {
      var len = lineHi.getTotalLength();
      lineHi.style.strokeDasharray = len;
      lineHi.style.strokeDashoffset = len;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          lineHi.style.transition = "stroke-dashoffset 1.9s cubic-bezier(0.33, 1, 0.68, 1)";
          lineHi.style.strokeDashoffset = "0";
          /* the dot rides the drawing tip in — arc length here, to match the
             stroke-dashoffset the line is drawn with */
          travelDot(0, geo.cum[geo.cum.length - 1], 1900, easeSoft, pointAtLen);
        });
      });
    }
  }

  /* ---------------- state ---------------- */
  function apply(year, instant) {
    if (!geo || !nodes.clipRect) return;

    var x0, x1, dotIdx, total, ctx, delta;

    if (year == null || !byYear[year]) {
      x0 = geo.plotL;
      x1 = geo.plotR;
      dotIdx = series.length - 1;
      total = last.v;
      ctx   = "all-time impressions";
      delta = "across everything i've made & run";
    } else {
      var info = yearInfo(year);
      x0 = geo.x(info.tStart);
      x1 = geo.x(info.tEnd);
      /* the dot marks the leading edge of the band, not the year's last data
         point — those are a month apart now the band spans jan to jan */
      dotIdx = idxByT[info.tEnd];
      if (dotIdx == null) dotIdx = series.indexOf(info.endPt);
      total = info.total;
      ctx   = "all-time impressions";
      delta = "+" + compact(info.gain) + " in " + year + (info.partial ? " so far" : "");
    }

    var w = Math.max(2, x1 - x0);
    nodes.clipRect.setAttribute("x", x0);
    nodes.clipRect.setAttribute("width", w);
    nodes.band.setAttribute("x", x0);
    nodes.band.setAttribute("width", w);

    moveDotTo(dotIdx, instant);

    Object.keys(nodes.xlabels).forEach(function (k) {
      nodes.xlabels[k].classList.toggle("is-active", +k === year);
    });

    if (elCtx) elCtx.textContent = ctx;
    if (instant) {
      shown = total;
      if (elTotal) elTotal.textContent = compact(total);
      if (elDelta) elDelta.textContent = delta;
    } else {
      tweenTo(total);
      swapDelta(delta);
    }
  }

  window.ViewsChart = {
    setYear: function (y) {
      var next = (y === "intro" || y == null) ? null : +y;
      if (next === currentYear) return;
      currentYear = next;
      apply(next, false);
    },
    years: YEARS
  };

  render();

  /* A ResizeObserver also covers the case render() bails on: mounted at zero
     width (hidden tab, deferred layout) and never asked to draw again. */
  var pending;
  function schedule() {
    clearTimeout(pending);
    pending = setTimeout(render, 130);
  }
  if (window.ResizeObserver) {
    var lastW = 0, lastH = 0;
    new ResizeObserver(function () {
      var w = mount.clientWidth, h = mount.clientHeight;
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      if (!hasDrawn) render();       // first real size — draw immediately
      else schedule();
    }).observe(mount);
  } else {
    window.addEventListener("resize", schedule);
  }
})();

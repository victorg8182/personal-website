(function () {
  var body = document.body;
  var html = document.documentElement;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  var track     = document.querySelector(".stage__text");
  var real      = [].slice.call(document.querySelectorAll(".panel"));
  var railItems = [].slice.call(document.querySelectorAll(".rail__item"));
  var header    = document.querySelector(".header");
  if (!track || !real.length) return;

  var firstYear = real[0].dataset.year;             // 2026
  var lastYear  = real[real.length - 1].dataset.year; // 2021

  /* 2026 opens with the whole curve lit. Once you've been anywhere else,
     coming back to 2026 highlights it like every other year. */
  var hasLeftStart = false;

  /* ---------------- seamless loop ----------------
     Clone the last panel before the first and the first panel after the last.
     When a clone reaches the middle of the viewport we jump to its twin — the
     two are pixel-identical, so the jump is invisible and the scroll continues. */
  var loopable = !window.matchMedia("(max-width: 1080px)").matches &&
                 !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var headClone, tailClone;
  if (loopable) {
    headClone = real[real.length - 1].cloneNode(true);   // 2021, sits above 2026
    tailClone = real[0].cloneNode(true);                 // 2026, sits below 2021
    [headClone, tailClone].forEach(function (c) {
      c.removeAttribute("id");
      c.dataset.clone = "1";
    });
    headClone.dataset.twin = lastYear;
    tailClone.dataset.twin = firstYear;
    track.insertBefore(headClone, real[0]);
    track.appendChild(tailClone);
  }

  var all = [].slice.call(track.querySelectorAll(".panel"));

  /* ---------------- active state ---------------- */
  var activeYear = null;

  function setActive(year) {
    all.forEach(function (p) {
      p.classList.toggle("is-active", p.dataset.year === year);
    });
    railItems.forEach(function (r) {
      r.classList.toggle("is-active", r.dataset.goto === year);
    });

    if (year !== firstYear) hasLeftStart = true;
    var full = (year === firstYear && !hasLeftStart);

    body.classList.toggle("is-full", full);
    if (window.ViewsChart) window.ViewsChart.setYear(full ? null : year);
    activeYear = year;
  }

  /* ---------------- jump (never animated) ----------------
     html has scroll-behavior:smooth for rail clicks, so every programmatic
     jump must opt out explicitly or it slides instead of cutting. */
  function hardScrollTo(y) {
    var prev = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    window.scrollTo(0, y);
    void html.offsetHeight;           // flush before restoring
    html.style.scrollBehavior = prev || "";
  }

  /* ---------------- glide (keyboard / rail / cue) ----------------
     Native smooth scrolling has no duration control and lands too fast for a
     page that changes a whole chart per panel, so drive it ourselves. Snapping
     is suspended for the duration — mandatory snap fights a per-frame tween. */
  var GLIDE_BASE = 1150;          // one panel; matches the chart's --dur-viz
  var glideRAF = null, snapWas = null, behaviorWas = null;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function releaseGlide() {
    if (snapWas !== null) { html.style.scrollSnapType = snapWas; snapWas = null; }
    if (behaviorWas !== null) { html.style.scrollBehavior = behaviorWas; behaviorWas = null; }
  }
  function cancelGlide() {
    if (glideRAF) { cancelAnimationFrame(glideRAF); glideRAF = null; }
    releaseGlide();
  }

  function easeInOut(k) {
    return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  }

  function glideTo(y) {
    var from = window.scrollY || html.scrollTop;
    var delta = y - from;
    if (Math.abs(delta) < 1) return;
    if (reducedMotion) { hardScrollTo(y); return; }

    /* a rail click can span five panels — stretch a little, but not linearly */
    var panels = Math.abs(delta) / Math.max(1, window.innerHeight);
    var dur = Math.min(2200, GLIDE_BASE + 240 * Math.max(0, panels - 1));

    cancelGlide();
    snapWas = html.style.scrollSnapType;
    behaviorWas = html.style.scrollBehavior;
    html.style.scrollSnapType = "none";
    html.style.scrollBehavior = "auto";

    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      window.scrollTo(0, from + delta * easeInOut(k));
      if (k < 1) { glideRAF = requestAnimationFrame(step); return; }
      glideRAF = null;
      releaseGlide();               // snap re-engages exactly on a snap point
    }
    glideRAF = requestAnimationFrame(step);
  }

  /* a real scroll gesture always wins over an in-flight glide */
  window.addEventListener("wheel", cancelGlide, { passive: true });
  window.addEventListener("touchstart", cancelGlide, { passive: true });

  var jumping = false;
  function jumpTo(node) {
    jumping = true;
    cancelGlide();                  // the teleport must not be overwritten
    hardScrollTo(node.offsetTop);
    /* two frames — one for the scroll to land, one for the snap to settle */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { jumping = false; });
    });
  }

  function twinOf(cloneEl) {
    var y = cloneEl.dataset.twin;
    for (var i = 0; i < real.length; i++) if (real[i].dataset.year === y) return real[i];
    return null;
  }

  /* ---------------- observer ----------------
     The observer only drives state. The teleport is handled separately, in
     onScroll, so it can wait until the clone has snapped exactly into place —
     at that instant the clone and its twin are pixel-identical, so swapping
     them is invisible and the year-to-year transition looks like every other. */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) setActive(e.target.dataset.year);
    });
  }, { rootMargin: "-48% 0px -48% 0px", threshold: 0 });

  all.forEach(function (p) { io.observe(p); });

  function checkLoop(y) {
    if (!loopable || jumping) return;
    [headClone, tailClone].forEach(function (c) {
      if (!c) return;
      if (Math.abs(y - c.offsetTop) < 2) {
        var twin = twinOf(c);
        if (twin) jumpTo(twin);
      }
    });
  }

  /* ---------------- jump targets (rail + scroll cue) ---------------- */
  [].slice.call(document.querySelectorAll("[data-goto]")).forEach(function (r) {
    r.addEventListener("click", function () {
      var t = document.getElementById("y-" + r.dataset.goto);
      if (t) glideTo(t.offsetTop);
    });
  });

  /* ---------------- scroll chrome ---------------- */
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var top = real[0].offsetTop;
      var y = window.scrollY || html.scrollTop;
      var moved = Math.abs(y - top) > 40;
      body.classList.toggle("is-scrolled", moved);
      if (header) header.classList.toggle("is-stuck", y > top + 10 || y < top - 10);
      checkLoop(y);
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------------- keyboard ----------------
     Space is the other way people page through a site, and left to the browser
     it jumps a viewport at a time and fights the snap. Take it over too. */
  /* not anchors: space doesn't activate a link, so it should still scroll */
  var FORM = /^(BUTTON|INPUT|TEXTAREA|SELECT)$/;

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    var space = e.key === " " || e.key === "Spacebar";
    /* space on a focused control is that control's activation, not a scroll */
    if (space && e.target && (FORM.test(e.target.tagName) || e.target.isContentEditable)) return;

    var dir = (e.key === "ArrowDown" || e.key === "PageDown") ? 1
            : (e.key === "ArrowUp"   || e.key === "PageUp")   ? -1
            : space ? (e.shiftKey ? -1 : 1) : 0;
    if (!dir) return;

    var i = all.findIndex(function (p) { return p.classList.contains("is-active"); });
    var next = all[i + dir];
    if (next) { e.preventDefault(); glideTo(next.offsetTop); }
  });

  /* ---------------- boot ---------------- */
  setActive(firstYear);
  hasLeftStart = false;
  body.classList.add("is-full");
  if (window.ViewsChart) window.ViewsChart.setYear(null);

  if (loopable) {
    /* land on the real first panel, past the head clone — instantly, never a slide */
    hardScrollTo(real[0].offsetTop);
    window.addEventListener("load", function () {
      hardScrollTo(real[0].offsetTop);
      setActive(firstYear);
      hasLeftStart = false;
      body.classList.add("is-full");
      if (window.ViewsChart) window.ViewsChart.setYear(null);
    });
  }
  onScroll();
})();

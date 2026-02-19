(function () {
  // Theme toggle
  var toggle = document.querySelector(".theme-toggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      document.body.classList.toggle("light-theme");
    });
  }

  // Custom cursor — smooth, rich follow
  var cursor = document.querySelector(".cursor");
  var cursorDot = document.querySelector(".cursor-dot");

  if (!cursor || !cursorDot) return;

  var mouse = { x: -100, y: -100 };
  var cursorPos = { x: -100, y: -100 };
  var dotPos = { x: -100, y: -100 };

  // Use requestAnimationFrame for smooth updates
  var raf = null;
  function tick() {
    // Lerp ring (slower = smoother, more lag)
    cursorPos.x += (mouse.x - cursorPos.x) * 0.12;
    cursorPos.y += (mouse.y - cursorPos.y) * 0.12;
    cursor.style.left = cursorPos.x + "px";
    cursor.style.top = cursorPos.y + "px";

    // Lerp dot (snappier)
    dotPos.x += (mouse.x - dotPos.x) * 0.35;
    dotPos.y += (mouse.y - dotPos.y) * 0.35;
    cursorDot.style.left = dotPos.x + "px";
    cursorDot.style.top = dotPos.y + "px";

    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  function onMouseMove(e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    if (cursor.style.visibility !== "visible") {
      cursor.style.visibility = "visible";
      cursorDot.style.visibility = "visible";
      cursorPos.x = mouse.x;
      cursorPos.y = mouse.y;
      dotPos.x = mouse.x;
      dotPos.y = mouse.y;
    }
  }

  function onMouseLeave() {
    cursor.style.visibility = "hidden";
    cursorDot.style.visibility = "hidden";
  }

  function onMouseEnter() {
    if (mouse.x >= 0 && mouse.y >= 0) {
      cursor.style.visibility = "visible";
      cursorDot.style.visibility = "visible";
    }
  }

  // Hover state for links and buttons
  var hoverTargets = document.querySelectorAll("a, button");
  hoverTargets.forEach(function (el) {
    el.addEventListener("mouseenter", function () {
      cursor.classList.add("hover");
    });
    el.addEventListener("mouseleave", function () {
      cursor.classList.remove("hover");
    });
  });

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseleave", onMouseLeave);
  document.addEventListener("mouseenter", onMouseEnter);

  // Hide cursor until first move (avoid flash at 0,0)
  cursor.style.visibility = "hidden";
  cursorDot.style.visibility = "hidden";
})();

/* $THUG — page interactions */
(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var CA = "9q1e32Nqwd97gydrVZt9mqeS4GJJ3MBvtbvm8aDtpump";

  /* ---------- toast ---------- */
  var toastEl = document.getElementById("toast");
  var toastT;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }
  window.thugToast = toast;

  /* ---------- copy CA ---------- */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy") ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var label = btn.querySelector(".ca__copy, .contract__copy");
      copyText(CA).then(function () {
        toast("Contract copied. Stay thug.");
        if (label) {
          label.textContent = "Copied";
          setTimeout(function () { label.textContent = "Copy"; }, 1600);
        }
      }, function () { toast("Copy failed. Select it manually."); });
    });
  });

  /* ---------- stars ---------- */
  function lightStars(el, delay, step) {
    var stars = el.querySelectorAll("i");
    stars.forEach(function (s, i) {
      setTimeout(function () { s.classList.add("on"); }, delay + i * step);
    });
  }
  function clearStars(el) {
    el.querySelectorAll("i").forEach(function (s) { s.classList.remove("on"); });
  }

  /* ---------- hero intro: glasses drop, hard cut ---------- */
  var hero = document.getElementById("hero");
  var stage = document.getElementById("heroStage");
  var glasses = document.getElementById("heroGlasses");
  var heroStars = document.getElementById("heroStars");
  var timers = [];

  /* timecode: runs while the glasses fall, freezes on impact */
  var tc = document.getElementById("tc");
  var tcTime = tc.querySelector(".tc__time");
  var tcLabel = tc.querySelector(".tc__label");
  var tcRaf = 0, tcStart = 0;
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function tcFormat(ms) {
    var fr = Math.floor(ms / 1000 * 24);
    return "00:" + pad(Math.floor(fr / 1440) % 60) + ":" + pad(Math.floor(fr / 24) % 60) + ":" + pad(fr % 24);
  }
  function tcRun() {
    cancelAnimationFrame(tcRaf);
    tc.classList.remove("is-frozen");
    tcLabel.textContent = "Rec";
    tcStart = performance.now();
    (function tick() {
      tcTime.textContent = tcFormat(performance.now() - tcStart);
      tcRaf = requestAnimationFrame(tick);
    })();
  }
  function tcFreeze() {
    cancelAnimationFrame(tcRaf);
    tc.classList.add("is-frozen");
    tcLabel.textContent = "Freeze";
  }

  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }

  function land() {
    hero.classList.remove("is-dropping");
    hero.classList.add("is-landed");
    stage.classList.remove("is-thud");
    void stage.offsetWidth;
    stage.classList.add("is-thud");
    lightStars(heroStars, 450, 140);
    tcFreeze();
  }

  function intro() {
    timers.forEach(clearTimeout);
    timers = [];
    if (reduce) { hero.classList.add("is-landed"); lightStars(heroStars, 0, 0); tcFreeze(); return; }
    hero.classList.remove("is-landed", "is-dropping");
    clearStars(heroStars);
    // force the glasses back off-screen before animating
    void glasses.offsetWidth;
    tcRun();
    later(function () { hero.classList.add("is-dropping"); }, 380);
    later(land, 380 + 1550);
  }

  function start() { setTimeout(intro, 30); }
  if (document.fonts && document.fonts.ready) {
    // wait for the blackletter so the hard cut lands on real type (cap the wait)
    var started = false;
    var go = function () { if (!started) { started = true; start(); } };
    document.fonts.load('700 100px "UnifrakturCook"').then(go, go);
    setTimeout(go, 1200);
  } else {
    start();
  }

  glasses.addEventListener("click", function () {
    if (hero.classList.contains("is-dropping")) return;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    intro();
  });

  /* ---------- subtle parallax on the props ---------- */
  var props = document.querySelector(".hero__props");
  if (!reduce && window.matchMedia("(pointer: fine)").matches) {
    var raf = 0, mx = 0, my = 0;
    hero.addEventListener("pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      mx = (e.clientX - r.left) / r.width - 0.5;
      my = (e.clientY - r.top) / r.height - 0.5;
      if (!raf) raf = requestAnimationFrame(function () {
        raf = 0;
        props.style.transform = "translate(" + (mx * 10).toFixed(2) + "px," + (my * 8).toFixed(2) + "px)";
      });
    });
    hero.addEventListener("pointerleave", function () { props.style.transform = ""; });
  }

  /* ---------- scroll reveals ---------- */
  var viceStars = document.getElementById("viceStars");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        var siblings = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
        el.style.transitionDelay = (el.matches(".beat, .step") ? siblings * 90 : 0) + "ms";
        el.classList.add("in");
        if (el.classList.contains("vice__meter")) lightStars(viceStars, 300, 220);
        io.unobserve(el);
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -6% 0px" });
    document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("in"); });
    lightStars(viceStars, 0, 0);
  }
})();

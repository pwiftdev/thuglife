/* VICEFEED — landing interactions */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // nav glass on scroll
  var nav = $("#nav");
  function onScroll() { nav.classList.toggle("is-solid", scrollY > 24); }
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // GTA VI day counter (release: 19 Nov 2026)
  var launch = new Date(2026, 10, 19), now = new Date(); now.setHours(0, 0, 0, 0);
  var d = Math.round((now - launch) / 864e5);
  $("#day").textContent = d < 0 ? "GTA VI drops in " + -d + " days" : "GTA VI is out · Day " + (d + 1);
  $("#yr").textContent = now.getFullYear();

  /* ---- hero phone footage ----
     Drop vertical MP4s (9:16, muted, ~10–20s, under ~4 MB) into assets/clips/
     and list them here. Empty slots keep the animated scene. */
  var HERO_CLIPS = {
    l: "assets/clips/hero-left.mp4",     // clip: @formula on TikTok
    c: "assets/clips/hero-center.mp4",   // clip: @hifi4_ on TikTok
    r: "assets/clips/hero-right.mp4"     // clip: @therealjasonduval on TikTok
  };
  function heroClip(slot, src) {
    var v = document.querySelector('.phone__vid[data-slot="' + slot + '"]');
    if (!v || !src) return;
    v.addEventListener("loadeddata", function () { v.closest(".phone__scr").classList.add("has-vid"); v.play().catch(function () {}); }, { once: true });
    v.addEventListener("error", function () { v.remove(); }, { once: true });
    v.preload = "auto"; v.src = src;
  }
  Object.keys(HERO_CLIPS).forEach(function (k) { heroClip(k, HERO_CLIPS[k]); });
  window.VF.heroClip = heroClip;

  // live footage in every phone / mini frame
  document.querySelectorAll("canvas[data-scene]").forEach(function (c) {
    VF.scenes.mount(c, c.dataset.scene, { offset: +c.dataset.offset || 0 });
  });

  // earnings ticker on the centre phone
  var earn = $("#earnTick"), v = 612.5;
  if (!reduce) setInterval(function () {
    v += 0.5; earn.textContent = "$" + v.toFixed(2);
  }, 1400);

  // scale the embedded editor to the frame
  var view = $("#studioView"), frame = view && view.querySelector("iframe");
  function fit() { if (frame) frame.style.transform = "scale(" + view.clientWidth / 1440 + ")"; }
  addEventListener("resize", fit); fit();

  // depth: blurred foreground palms + floating neon bokeh
  var L = document.getElementById("palmsL");
  if (L && innerWidth > 640) {
    var fg = L.cloneNode(true); fg.removeAttribute("id");
    fg.setAttribute("class", "sky__palms sky__palms--fg"); fg.setAttribute("aria-hidden", "true");
    L.parentNode.appendChild(fg);
  }
  var bk = document.getElementById("bokeh"), cols = ["255,21,137", "20,236,217", "255,198,94", "255,138,61"];
  if (bk && !reduce) for (var i = 0; i < 16; i++) {
    var b = document.createElement("i"), sz = 6 + Math.random() * 26;
    b.style.cssText = "left:" + (Math.random() * 100) + "%;top:" + (30 + Math.random() * 55) + "%;width:" + sz + "px;height:" + sz + "px;background:rgba(" + cols[i % 4] + ",.9);--b:" + (sz / 5).toFixed(1) + "px;--o:" + (.35 + Math.random() * .5).toFixed(2) + ";--d:" + (6 + Math.random() * 8).toFixed(1) + "s;--dl:-" + (Math.random() * 10).toFixed(1) + "s";
    bk.appendChild(b);
  }

  // parallax: pointer + scroll drive CSS vars on the hero
  var hero = document.querySelector(".hero"), pr = 0, tmx = 0, tmy = 0, cmx = 0, cmy = 0;
  if (!reduce) {
    if (matchMedia("(pointer: fine)").matches) hero.addEventListener("pointermove", function (e) {
      tmx = e.clientX / innerWidth - .5; tmy = e.clientY / innerHeight - .5; if (!pr) pr = requestAnimationFrame(loop);
    });
    addEventListener("scroll", function () { hero.style.setProperty("--sy", Math.min(1, scrollY / innerHeight).toFixed(3)); }, { passive: true });
  }
  function loop() {
    cmx += (tmx - cmx) * .08; cmy += (tmy - cmy) * .08;
    hero.style.setProperty("--mx", cmx.toFixed(3)); hero.style.setProperty("--my", cmy.toFixed(3));
    pr = Math.abs(tmx - cmx) + Math.abs(tmy - cmy) > .001 ? requestAnimationFrame(loop) : 0;
  }

  // reveals
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var i = Array.prototype.indexOf.call(e.target.parentElement.children, e.target);
        e.target.style.transitionDelay = i * 90 + "ms";
        e.target.classList.add("in"); io.unobserve(e.target);
      });
    }, { threshold: .12 });
    document.querySelectorAll(".reveal").forEach(function (e) { io.observe(e); });
  } else document.querySelectorAll(".reveal").forEach(function (e) { e.classList.add("in"); });
})();

/* VICEFEED — procedural "footage". Three Leonida-flavoured scenes drawn on canvas
   as a pure function of time, so the editor can scrub them and thumbnails can
   sample any frame. Used by the landing phones, studio thumbs and the editor. */
(function () {
  "use strict";
  var TAU = Math.PI * 2;

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function grad(ctx, y0, y1, stops) {
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }
  function glow(ctx, x, y, r, color, a) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace("A", a));
    g.addColorStop(1, color.replace("A", 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // skylines are generated once per scene, in unit space
  var SKY = {};
  function skyline(key, seed, n) {
    if (SKY[key]) return SKY[key];
    var r = rng(seed), out = [], x = -0.02;
    while (x < 1.02) {
      var bw = 0.025 + r() * 0.05;
      var d = Math.exp(-Math.pow((x - 0.35) / 0.18, 2)) + Math.exp(-Math.pow((x - 0.78) / 0.12, 2)) * 0.6;
      out.push({ x: x, w: bw, h: 0.02 + r() * 0.05 + d * (0.05 + r() * 0.11), lit: [] });
      for (var k = 0; k < n; k++) out[out.length - 1].lit.push([r(), r()]);
      x += bw + r() * 0.006;
    }
    return (SKY[key] = out);
  }

  function palm(ctx, x, y, hgt, lean, color, sway) {
    var tx = x + lean, ty = y - hgt;
    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineCap = "round";
    // trunk: tapered by stacking strokes
    for (var k = 0; k < 3; k++) {
      ctx.lineWidth = hgt * (0.05 - k * 0.012);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.15, y - hgt * 0.55, tx + (k - 1) * 0.0, ty + hgt * k * 0.04);
      ctx.stroke();
    }
    var L = hgt * 0.46;
    for (var i = 0; i < 9; i++) {
      var a = -Math.PI + (i + 0.5) * (Math.PI / 9) + Math.sin(sway + i) * 0.04;
      var side = Math.abs(Math.cos(a));
      var ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.75 + L * (0.18 + side * 0.5);
      var cx = tx + Math.cos(a) * L * 0.5, cy = ty + Math.sin(a) * L * 0.6 - L * 0.12;
      var w = L * 0.16;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(cx - Math.sin(a) * w, cy - w * 0.4, ex, ey);
      ctx.quadraticCurveTo(cx + Math.sin(a) * w * 0.3, cy + w, tx, ty);
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(tx, ty + hgt * 0.03, hgt * 0.03, 0, TAU); ctx.fill();
  }

  function car(ctx, cx, cy, s, brake, body) {
    var k = s / 140;
    ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k);
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.beginPath(); ctx.ellipse(0, 40, 80, 10, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = body || "#0d0612";
    ctx.beginPath();
    ctx.moveTo(-70, 30); ctx.lineTo(-66, -2); ctx.quadraticCurveTo(-62, -14, -48, -18);
    ctx.lineTo(-36, -40); ctx.quadraticCurveTo(-30, -48, -18, -48); ctx.lineTo(18, -48);
    ctx.quadraticCurveTo(30, -48, 36, -40); ctx.lineTo(48, -18); ctx.quadraticCurveTo(62, -14, 66, -2);
    ctx.lineTo(70, 30); ctx.quadraticCurveTo(70, 38, 62, 38); ctx.lineTo(-62, 38); ctx.quadraticCurveTo(-70, 38, -70, 30);
    ctx.fill();
    ctx.fillStyle = "#2b1840";
    ctx.beginPath(); ctx.moveTo(-30, -40); ctx.lineTo(30, -40); ctx.lineTo(40, -20); ctx.lineTo(-40, -20); ctx.fill();
    ctx.fillStyle = "rgba(255,140,180,.22)";
    ctx.beginPath(); ctx.moveTo(-26, -38); ctx.lineTo(4, -38); ctx.lineTo(-10, -22); ctx.lineTo(-36, -22); ctx.fill();
    ctx.fillStyle = "#ff2245";
    ctx.fillRect(-62, -6, 34, 8); ctx.fillRect(28, -6, 34, 8);
    var a = 0.35 + brake * 0.65;
    glow(ctx, -45, -2, 46, "rgba(255,30,70,A)", a);
    glow(ctx, 45, -2, 46, "rgba(255,30,70,A)", a);
    ctx.fillStyle = "#fbecd4"; ctx.fillRect(-16, 10, 32, 10);
    ctx.restore();
  }

  /* ---------------- scene: Vice highway at sunset ---------------- */
  function highway(ctx, w, h, t) {
    var hz = h * 0.5;
    ctx.fillStyle = grad(ctx, 0, hz, [[0, "#160830"], [0.42, "#55196b"], [0.74, "#d8346f"], [1, "#ffa04e"]]);
    ctx.fillRect(0, 0, w, hz + 1);
    var sr = w * 0.24;
    glow(ctx, w / 2, hz, sr * 2.6, "rgba(255,120,90,A)", 0.45);
    var sg = ctx.createLinearGradient(0, hz - sr, 0, hz + sr);
    sg.addColorStop(0, "#fff2bd"); sg.addColorStop(0.45, "#ffc25a"); sg.addColorStop(1, "#ff4f74");
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(w / 2, hz - sr * 0.08, sr, 0, TAU); ctx.fill();
    // skyline
    var sk = skyline("hw", 9, 6);
    sk.forEach(function (b) {
      var bh = b.h * h;
      ctx.fillStyle = "#2a0b39";
      ctx.fillRect(b.x * w, hz - bh, b.w * w + 1, bh + 1);
      ctx.fillStyle = "rgba(255,200,140,.55)";
      b.lit.forEach(function (l) { if (l[0] > 0.5) ctx.fillRect(b.x * w + l[0] * b.w * w * 0.8, hz - bh + l[1] * bh * 0.85, Math.max(1, w * 0.004), Math.max(1, w * 0.004)); });
    });
    ctx.fillStyle = grad(ctx, hz, h, [[0, "#2c0f35"], [1, "#07030b"]]);
    ctx.fillRect(0, hz, w, h - hz);
    // road
    ctx.fillStyle = "#16091e";
    ctx.beginPath(); ctx.moveTo(w * 0.47, hz); ctx.lineTo(w * 0.53, hz); ctx.lineTo(w * 1.3, h); ctx.lineTo(-w * 0.3, h); ctx.fill();
    ctx.strokeStyle = "rgba(255,90,140,.55)"; ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.beginPath(); ctx.moveTo(w * 0.47, hz); ctx.lineTo(-w * 0.3, h); ctx.moveTo(w * 0.53, hz); ctx.lineTo(w * 1.3, h); ctx.stroke();
    // dashes
    ctx.fillStyle = "#ffd36b";
    var N = 9;
    for (var i = 0; i < N; i++) {
      var s0 = ((i + t * 1.7) % N) / N, s1 = s0 + 0.04;
      var y0 = hz + (h - hz) * Math.pow(s0, 2.2), y1 = hz + (h - hz) * Math.pow(Math.min(1, s1), 2.2);
      var hw0 = w * 0.0025 + (y0 - hz) / (h - hz) * w * 0.018, hw1 = w * 0.0025 + (y1 - hz) / (h - hz) * w * 0.018;
      ctx.beginPath(); ctx.moveTo(w / 2 - hw0, y0); ctx.lineTo(w / 2 + hw0, y0); ctx.lineTo(w / 2 + hw1, y1); ctx.lineTo(w / 2 - hw1, y1); ctx.fill();
    }
    // palms rushing past
    var P = 5, list = [];
    for (var j = 0; j < P; j++) {
      var s = ((j / P) + t * 0.16) % 1;
      list.push(s);
    }
    list.sort();
    list.forEach(function (s, idx) {
      var e = Math.pow(s, 2.3);
      var y = hz + (h - hz) * e;
      var hg = h * (0.03 + e * 1.1);
      ctx.globalAlpha = Math.min(1, s * 4);
      palm(ctx, w / 2 - w * (0.05 + e * 0.95), y, hg, hg * 0.12, "#0a0311", t + idx);
      palm(ctx, w / 2 + w * (0.05 + e * 0.95), y, hg, -hg * 0.12, "#0a0311", t + idx + 2);
    });
    ctx.globalAlpha = 1;
    var brake = Math.max(0, Math.sin(t * 1.6)) > 0.85 ? 1 : 0;
    car(ctx, w / 2 + Math.sin(t * 1.1) * w * 0.035, h * 0.79, w * 0.5, brake);
  }

  /* ---------------- scene: night chase downtown ---------------- */
  function night(ctx, w, h, t) {
    var hz = h * 0.46;
    ctx.fillStyle = grad(ctx, 0, hz, [[0, "#04020a"], [0.6, "#160a2c"], [1, "#3a1046"]]);
    ctx.fillRect(0, 0, w, hz + 1);
    var sk = skyline("nt", 4, 14);
    sk.forEach(function (b, i) {
      var bh = b.h * h * 2.6;
      ctx.fillStyle = i % 3 ? "#0d0718" : "#120a22";
      ctx.fillRect(b.x * w, hz - bh, b.w * w + 1, bh + 1);
      ctx.fillStyle = i % 2 ? "rgba(20,236,217,.55)" : "rgba(255,180,220,.5)";
      b.lit.forEach(function (l) { if (l[0] > 0.45) ctx.fillRect(b.x * w + l[0] * b.w * w * 0.85, hz - bh + l[1] * bh * 0.9, Math.max(1, w * 0.005), Math.max(1, w * 0.003)); });
      if (i % 5 === 2) { // neon sign
        ctx.fillStyle = i % 2 ? "#ff1589" : "#14ecd9";
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = w * 0.03;
        ctx.fillRect(b.x * w + b.w * w * 0.15, hz - bh * 0.7, b.w * w * 0.7, h * 0.008);
        ctx.shadowBlur = 0;
      }
    });
    // wet street
    ctx.fillStyle = grad(ctx, hz, h, [[0, "#1d0a2a"], [1, "#05020a"]]);
    ctx.fillRect(0, hz, w, h - hz);
    ctx.save(); ctx.globalAlpha = 0.18; ctx.translate(0, hz * 2); ctx.scale(1, -1);
    sk.forEach(function (b, i) { if (i % 5 === 2) { ctx.fillStyle = i % 2 ? "#ff1589" : "#14ecd9"; ctx.fillRect(b.x * w, hz - b.h * h * 1.6, b.w * w, h * 0.02); } });
    ctx.restore();
    // speed streaks
    var r = rng(77);
    ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = Math.max(1, w * 0.003);
    for (var i = 0; i < 18; i++) {
      var a = r() * TAU, sp = (r() + t * 1.4) % 1;
      var d0 = w * (0.1 + sp * 0.9), d1 = d0 + w * 0.12 * sp;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * d0, hz + Math.sin(a) * d0 * 0.6);
      ctx.lineTo(w / 2 + Math.cos(a) * d1, hz + Math.sin(a) * d1 * 0.6);
      ctx.stroke();
    }
    // road lines
    ctx.fillStyle = "rgba(255,255,255,.75)";
    for (var j = 0; j < 8; j++) {
      var s0 = ((j + t * 2.6) % 8) / 8, e0 = Math.pow(s0, 2.2), e1 = Math.pow(Math.min(1, s0 + 0.05), 2.2);
      var y0 = hz + (h - hz) * e0, y1 = hz + (h - hz) * e1;
      [-1, 1].forEach(function (sd) {
        var x0 = w / 2 + sd * (w * 0.02 + e0 * w * 0.45), x1 = w / 2 + sd * (w * 0.02 + e1 * w * 0.45);
        ctx.beginPath(); ctx.moveTo(x0 - 1, y0); ctx.lineTo(x0 + 1, y0); ctx.lineTo(x1 + w * 0.008, y1); ctx.lineTo(x1 - w * 0.008, y1); ctx.fill();
      });
    }
    car(ctx, w / 2 + Math.sin(t * 2.2) * w * 0.05, h * 0.78, w * 0.52, 0.3, "#0a0510");
    // police lights
    var ph = Math.floor(t * 5) % 2;
    glow(ctx, 0, h * 0.15, w * 0.9, ph ? "rgba(255,30,60,A)" : "rgba(40,90,255,A)", 0.35);
    glow(ctx, w, h * 0.15, w * 0.9, ph ? "rgba(40,90,255,A)" : "rgba(255,30,60,A)", 0.35);
  }

  /* ---------------- scene: beach day ---------------- */
  function beach(ctx, w, h, t) {
    var hz = h * 0.43, shore = h * 0.7;
    ctx.fillStyle = grad(ctx, 0, hz, [[0, "#1aa9d6"], [0.6, "#7fdcef"], [1, "#ffd9b0"]]);
    ctx.fillRect(0, 0, w, hz + 1);
    glow(ctx, w * 0.78, h * 0.12, w * 0.5, "rgba(255,245,210,A)", 0.9);
    ctx.fillStyle = "#fffbe8"; ctx.beginPath(); ctx.arc(w * 0.78, h * 0.12, w * 0.07, 0, TAU); ctx.fill();
    // far skyline haze
    var sk = skyline("bc", 21, 0);
    ctx.fillStyle = "rgba(90,140,170,.45)";
    sk.forEach(function (b) { if (b.x > 0.55) ctx.fillRect(b.x * w, hz - b.h * h * 0.9, b.w * w + 1, b.h * h * 0.9); });
    ctx.fillStyle = grad(ctx, hz, shore, [[0, "#0a8fbf"], [1, "#11d4c6"]]);
    ctx.fillRect(0, hz, w, shore - hz);
    ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = Math.max(1, w * 0.003);
    for (var i = 0; i < 12; i++) {
      var yy = hz + (shore - hz) * Math.pow((i + 1) / 12, 1.6);
      var off = (t * (0.05 + i * 0.01) * w) % (w * 0.3);
      ctx.beginPath();
      for (var x = -w * 0.3 + off; x < w; x += w * 0.3) { ctx.moveTo(x, yy); ctx.lineTo(x + w * 0.08 * (i / 12 + 0.3), yy); }
      ctx.stroke();
    }
    // speedboat + wake
    var bx = (((t * 0.11) % 1.5) - 0.25) * w, by = hz + (shore - hz) * 0.42;
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.beginPath(); ctx.moveTo(bx - w * 0.02, by); ctx.lineTo(bx - w * 0.3, by - h * 0.006); ctx.lineTo(bx - w * 0.3, by + h * 0.012); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(bx - w * 0.06, by - h * 0.01); ctx.lineTo(bx + w * 0.05, by - h * 0.01); ctx.lineTo(bx + w * 0.03, by + h * 0.006); ctx.lineTo(bx - w * 0.06, by + h * 0.006); ctx.fill();
    ctx.fillStyle = "#ff1589"; ctx.fillRect(bx - w * 0.055, by - h * 0.004, w * 0.09, h * 0.003);
    // sand + foam
    ctx.fillStyle = grad(ctx, shore, h, [[0, "#fbe0b0"], [1, "#e7b277"]]);
    ctx.beginPath(); ctx.moveTo(0, shore);
    for (var k = 0; k <= 20; k++) ctx.lineTo(w * k / 20, shore + Math.sin(k * 0.9 + t * 1.6) * h * 0.008);
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = Math.max(1.5, w * 0.006);
    ctx.beginPath();
    for (var m = 0; m <= 20; m++) ctx.lineTo(w * m / 20, shore + Math.sin(m * 0.9 + t * 1.6) * h * 0.008);
    ctx.stroke();
    palm(ctx, -w * 0.02, h * 1.02, h * 0.82, w * 0.2, "#123438", t * 0.8);
    palm(ctx, w * 1.04, h * 1.02, h * 0.66, -w * 0.18, "#0f2c30", t * 0.8 + 2);
  }

  var scenes = { highway: highway, night: night, beach: beach };
  var meta = {
    highway: { name: "Vice highway", hue: "#ff5a6e" },
    night: { name: "Downtown chase", hue: "#6d2bff" },
    beach: { name: "Ocean drive", hue: "#14ecd9" }
  };

  function draw(name, ctx, w, h, t) { (scenes[name] || highway)(ctx, w, h, t); }

  // keep a canvas animating while on screen
  function mount(canvas, name, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d"), visible = true, t0 = performance.now() - (opts.offset || 0) * 1000, speed = opts.speed || 1;
    function size() {
      var r = canvas.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(r.width * d)); canvas.height = Math.max(1, Math.round(r.height * d));
    }
    size();
    addEventListener("resize", size);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(canvas);
    var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function frame() {
      if (visible) draw(name, ctx, canvas.width, canvas.height, reduce ? (opts.offset || 2) : (performance.now() - t0) / 1000 * speed);
      if (!reduce) requestAnimationFrame(frame);
    }
    draw(name, ctx, canvas.width, canvas.height, opts.offset || 0); // first frame even if off-screen
    frame();
  }
  function still(canvas, name, t) {
    var r = canvas.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round((r.width || canvas.width) * d)); canvas.height = Math.max(1, Math.round((r.height || canvas.height) * d));
    draw(name, canvas.getContext("2d"), canvas.width, canvas.height, t || 0);
  }

  window.VF = window.VF || {};
  window.VF.scenes = { draw: draw, mount: mount, still: still, meta: meta, list: ["highway", "night", "beach"] };
})();

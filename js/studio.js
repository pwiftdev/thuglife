/* $THUG — Thug Yourself studio
   Everything renders locally on a <canvas>; nothing is uploaded. */
(function () {
  "use strict";

  var MAX_SIDE = 2048;          // export resolution cap
  var HANDLE = 11;              // handle half-size in CSS px
  var ROT_GAP = 30;             // distance of rotate knob above item, CSS px

  /* ---------- source art ---------- */
  // Pixel glasses, traced 1:1 from the uploaded artwork (25 × 5 grid).
  var GLASSES = [
    "#########################",
    "##o#o######...##o#o######",
    ".##o#o#####...###o#o####.",
    "..##o#o###.....###o#o##..",
    "...######.......######..."
  ];
  var G_W = 25, G_H = 5;
  var gBlack = new Path2D(), gWhite = new Path2D();
  GLASSES.forEach(function (row, y) {
    for (var x = 0; x < row.length; x++) {
      if (row[x] === "#") gBlack.rect(x, y, 1, 1);
      else if (row[x] === "o") gWhite.rect(x, y, 1, 1);
    }
  });

  var jointImg = new Image();
  var jointGray = null;
  jointImg.onload = function () { jointGray = toGray(jointImg, jointImg.naturalWidth, jointImg.naturalHeight, 1.05); render(); };
  jointImg.src = window.THUG_JOINT || "assets/joint.png";

  var CAPTION = "Thug Life";
  var CAPTION_FONT = '"UnifrakturCook", "Old English Text MT", serif';

  /* ---------- DOM ---------- */
  var canvas = document.getElementById("studioCanvas");
  var ctx = canvas.getContext("2d");
  var stageEl = document.getElementById("stage");
  var fileInput = document.getElementById("fileInput");
  var exportBtn = document.getElementById("exportBtn");
  var resetBtn = document.getElementById("resetBtn");
  var bwToggle = document.getElementById("bwToggle");
  var sizeRange = document.getElementById("sizeRange");
  var rotRange = document.getElementById("rotRange");
  var flipBtn = document.getElementById("flipBtn");
  var frontBtn = document.getElementById("frontBtn");
  var delBtn = document.getElementById("delBtn");
  var selName = document.getElementById("selName");
  var selGroup = document.getElementById("selGroup");

  /* ---------- state ---------- */
  var S = {
    photo: null,      // HTMLCanvasElement (colour, scaled to W×H)
    photoGray: null,  // HTMLCanvasElement (grayscale)
    W: 0, H: 0,       // working/export size
    items: [],        // {type, x, y, w, rot, flip}
    sel: -1,
    bw: true
  };
  var view = { scale: 1, cssW: 0, cssH: 0, dpr: 1 };

  /* ---------- helpers ---------- */
  function toGray(src, w, h, contrast) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var x = c.getContext("2d");
    x.drawImage(src, 0, 0, w, h);
    var d;
    try { d = x.getImageData(0, 0, w, h); } catch (e) { return c; }
    var p = d.data, k = contrast || 1;
    for (var i = 0; i < p.length; i += 4) {
      var l = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      l = (l - 128) * k + 128;
      l = l < 0 ? 0 : l > 255 ? 255 : l;
      p[i] = p[i + 1] = p[i + 2] = l;
    }
    x.putImageData(d, 0, 0);
    return c;
  }

  function aspect(it) {
    if (it.type === "glasses") return G_H / G_W;
    if (it.type === "joint") return jointImg.naturalWidth ? jointImg.naturalHeight / jointImg.naturalWidth : 0.68;
    // caption: measure at a reference size
    ctx.save();
    ctx.font = "700 100px " + CAPTION_FONT;
    var m = ctx.measureText(CAPTION).width || 420;
    ctx.restore();
    return 118 / m;
  }
  function dims(it) { return { w: it.w, h: it.w * aspect(it) }; }

  // which side the rotate knob sits on: -1 above (default), +1 below if above is off-canvas
  function knobSide(it) {
    if (drag && drag.mode === "rotate" && drag.it === it) return drag.side;
    var d = dims(it), k = 1 / view.scale;
    var off = d.h / 2 + 6 * k + ROT_GAP * k;
    var kx = it.x + Math.sin(it.rot) * off, ky = it.y - Math.cos(it.rot) * off;
    var m = 10 * k;
    return (kx < m || ky < m || kx > S.W - m || ky > S.H - m) ? 1 : -1;
  }

  function label(t) { return t === "glasses" ? "Shades" : t === "joint" ? "Joint" : "Caption"; }

  /* ---------- drawing ---------- */
  function drawItem(c, it, forExport) {
    var d = dims(it);
    c.save();
    c.translate(it.x, it.y);
    c.rotate(it.rot);
    if (it.flip) c.scale(-1, 1);
    if (it.type === "glasses") {
      var s = d.w / G_W;
      c.translate(-d.w / 2, -d.h / 2);
      c.scale(s, s);
      c.fillStyle = "#fff"; c.fill(gWhite);
      c.fillStyle = "#000"; c.fill(gBlack);
    } else if (it.type === "joint") {
      var src = S.bw && jointGray ? jointGray : jointImg;
      if (jointImg.complete && jointImg.naturalWidth) c.drawImage(src, -d.w / 2, -d.h / 2, d.w, d.h);
    } else {
      var fs = d.h / 1.18;
      c.font = "700 " + fs + "px " + CAPTION_FONT;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.lineJoin = "round";
      c.lineWidth = fs * 0.07;
      c.strokeStyle = "rgba(0,0,0,.85)";
      c.strokeText(CAPTION, 0, fs * 0.04);
      c.fillStyle = "#fff";
      c.fillText(CAPTION, 0, fs * 0.04);
    }
    c.restore();
  }

  function drawScene(c, forExport) {
    c.fillStyle = "#111";
    c.fillRect(0, 0, S.W, S.H);
    var src = S.bw ? S.photoGray : S.photo;
    if (src) c.drawImage(src, 0, 0, S.W, S.H);
    S.items.forEach(function (it) { drawItem(c, it, forExport); });
  }

  function drawSelection(c) {
    var it = S.items[S.sel];
    if (!it) return;
    var d = dims(it);
    var k = 1 / view.scale; // CSS px -> image px
    c.save();
    c.translate(it.x, it.y);
    c.rotate(it.rot);
    var pad = 6 * k;
    var hw = d.w / 2 + pad, hh = d.h / 2 + pad;
    c.lineWidth = 1.5 * k;
    c.strokeStyle = "#fff";
    c.setLineDash([6 * k, 5 * k]);
    c.strokeRect(-hw, -hh, hw * 2, hh * 2);
    c.setLineDash([]);
    // stem + rotate knob
    var ks = knobSide(it);
    c.beginPath();
    c.moveTo(0, ks * hh);
    c.lineTo(0, ks * (hh + ROT_GAP * k));
    c.stroke();
    c.beginPath();
    c.arc(0, ks * (hh + ROT_GAP * k), 7 * k, 0, Math.PI * 2);
    c.fillStyle = "#fff"; c.fill();
    c.lineWidth = 1.5 * k; c.strokeStyle = "#000"; c.stroke();
    // corner scale handles
    var hs = HANDLE * k * 0.75;
    [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(function (p) {
      c.fillStyle = "#fff";
      c.fillRect(p[0] - hs, p[1] - hs, hs * 2, hs * 2);
      c.strokeStyle = "#000";
      c.strokeRect(p[0] - hs, p[1] - hs, hs * 2, hs * 2);
    });
    c.restore();
  }

  var rafPending = false;
  function render() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      if (!S.photo) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var k = view.scale * view.dpr;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.imageSmoothingQuality = "high";
      drawScene(ctx, false);
      drawSelection(ctx);
    });
  }

  /* ---------- layout ---------- */
  function fit() {
    if (!S.photo) return;
    var r = stageEl.getBoundingClientRect();
    var pad = window.innerWidth < 700 ? 16 : 40;
    var availW = Math.max(120, r.width - pad * 2);
    var availH = Math.max(120, r.height - pad * 2 - 18);
    var sc = Math.min(availW / S.W, availH / S.H);
    view.scale = sc;
    view.cssW = Math.round(S.W * sc);
    view.cssH = Math.round(S.H * sc);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.style.width = view.cssW + "px";
    canvas.style.height = view.cssH + "px";
    canvas.width = Math.round(view.cssW * view.dpr);
    canvas.height = Math.round(view.cssH * view.dpr);
    render();
  }
  window.addEventListener("resize", fit);

  /* ---------- loading a photo ---------- */
  function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) { window.thugToast && window.thugToast("That's not an image."); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight;
      var s = Math.min(1, MAX_SIDE / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      var first = !S.photo;
      var prevW = S.W;
      S.photo = c;
      S.photoGray = toGray(c, w, h, 1.18);
      S.W = w; S.H = h;
      if (first || !S.items.length) {
        defaultLayout();
      } else if (prevW) {
        // keep the user's layout proportionally when swapping photos
        var r = w / prevW;
        S.items.forEach(function (it) { it.x *= r; it.y *= r; it.w *= r; });
      }
      stageEl.classList.add("has-image");
      exportBtn.disabled = false;
      fit();
      syncPanel();
    };
    img.onerror = function () { URL.revokeObjectURL(url); window.thugToast && window.thugToast("Couldn't read that image."); };
    img.src = url;
  }

  function defaultLayout() {
    var W = S.W, H = S.H, m = Math.min(W, H);
    S.items = [
      { type: "glasses", x: W * 0.5, y: H * 0.36, w: Math.min(W * 0.62, m * 0.8), rot: 0, flip: false },
      { type: "joint", x: W * 0.6, y: H * 0.58, w: m * 0.26, rot: 0, flip: false },
      { type: "text", x: W * 0.5, y: H * 0.86, w: Math.min(W * 0.7, m * 0.9), rot: 0, flip: false }
    ];
    S.sel = 0;
  }

  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    stageEl.addEventListener(ev, function (e) { e.preventDefault(); stageEl.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    stageEl.addEventListener(ev, function (e) { e.preventDefault(); stageEl.classList.remove("is-over"); });
  });
  stageEl.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  window.addEventListener("paste", function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") === 0) {
        loadFile(items[i].getAsFile());
        document.getElementById("studio").scrollIntoView({ behavior: "smooth" });
        break;
      }
    }
  });

  /* ---------- hit testing ---------- */
  function toLocal(it, px, py) {
    var dx = px - it.x, dy = py - it.y;
    var c = Math.cos(-it.rot), s = Math.sin(-it.rot);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  function hitHandle(px, py) {
    var it = S.items[S.sel];
    if (!it) return null;
    var d = dims(it), k = 1 / view.scale;
    var l = toLocal(it, px, py);
    var pad = 6 * k;
    var hw = d.w / 2 + pad, hh = d.h / 2 + pad;
    var tol = HANDLE * 1.6 * k;
    var ks = knobSide(it);
    if (Math.abs(l.x) < tol && Math.abs(l.y - ks * (hh + ROT_GAP * k)) < tol) return "rotate";
    var corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    for (var i = 0; i < 4; i++) {
      if (Math.abs(l.x - corners[i][0]) < tol && Math.abs(l.y - corners[i][1]) < tol) return "scale";
    }
    return null;
  }

  function hitItem(px, py) {
    for (var i = S.items.length - 1; i >= 0; i--) {
      var it = S.items[i], d = dims(it);
      var l = toLocal(it, px, py);
      var slack = 6 / view.scale;
      if (Math.abs(l.x) <= d.w / 2 + slack && Math.abs(l.y) <= d.h / 2 + slack) return i;
    }
    return -1;
  }

  function pointerPos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.scale, y: (e.clientY - r.top) / view.scale };
  }

  /* ---------- pointer interaction ---------- */
  var drag = null;
  var pointers = new Map();

  canvas.addEventListener("pointerdown", function (e) {
    if (!S.photo) return;
    canvas.setPointerCapture(e.pointerId);
    var p = pointerPos(e);
    pointers.set(e.pointerId, p);

    // two-finger pinch / rotate on touch
    if (pointers.size === 2 && S.items[S.sel]) {
      var pts = Array.from(pointers.values());
      var it0 = S.items[S.sel];
      drag = {
        mode: "pinch", it: it0, w0: it0.w, r0: it0.rot,
        d0: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
        a0: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x)
      };
      return;
    }

    var h = hitHandle(p.x, p.y);
    if (h) {
      var it = S.items[S.sel];
      drag = { mode: h, it: it, p0: p, w0: it.w, r0: it.rot, side: knobSide(it),
        dist0: Math.hypot(p.x - it.x, p.y - it.y) };
      return;
    }
    var i = hitItem(p.x, p.y);
    if (i >= 0) {
      S.sel = i;
      var it2 = S.items[i];
      drag = { mode: "move", it: it2, ox: p.x - it2.x, oy: p.y - it2.y };
      canvas.style.cursor = "grabbing";
    } else {
      S.sel = -1;
      drag = null;
    }
    syncPanel();
    render();
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!S.photo) return;
    var p = pointerPos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

    if (!drag) {
      // hover cursor
      var h = hitHandle(p.x, p.y);
      canvas.style.cursor = h === "rotate" ? "grab" : h === "scale" ? "nwse-resize" : hitItem(p.x, p.y) >= 0 ? "move" : "default";
      return;
    }
    var it = drag.it;
    if (drag.mode === "move") {
      it.x = p.x - drag.ox;
      it.y = p.y - drag.oy;
    } else if (drag.mode === "scale") {
      var dist = Math.hypot(p.x - it.x, p.y - it.y);
      it.w = clampW(drag.w0 * dist / Math.max(1, drag.dist0));
    } else if (drag.mode === "rotate") {
      var a = Math.atan2(p.y - it.y, p.x - it.x) + (drag.side > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      it.rot = normAngle(a);
    } else if (drag.mode === "pinch" && pointers.size >= 2) {
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      var ang = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      it.w = clampW(drag.w0 * d / Math.max(1, drag.d0));
      it.rot = normAngle(drag.r0 + ang - drag.a0);
    }
    syncPanel(true);
    render();
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (drag && drag.mode === "pinch" && pointers.size === 1) { drag = null; return; }
    if (pointers.size === 0) drag = null;
    canvas.style.cursor = "default";
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);

  canvas.addEventListener("wheel", function (e) {
    var it = S.items[S.sel];
    if (!it) return;
    var p = pointerPos(e);
    if (hitItem(p.x, p.y) !== S.sel) return;
    e.preventDefault();
    it.w = clampW(it.w * Math.exp(-e.deltaY * 0.0015));
    syncPanel(true);
    render();
  }, { passive: false });

  function clampW(w) { return Math.max(Math.min(S.W, S.H) * 0.02, Math.min(w, Math.max(S.W, S.H) * 2)); }
  function normAngle(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

  /* ---------- keyboard ---------- */
  window.addEventListener("keydown", function (e) {
    var it = S.items[S.sel];
    if (!it || !S.photo) return;
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (/INPUT|TEXTAREA|SELECT/.test(tag) && document.activeElement.type !== "range") return;
    var r = stageEl.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    var step = (e.shiftKey ? 10 : 1) / view.scale;
    var used = true;
    switch (e.key) {
      case "ArrowLeft": it.x -= step; break;
      case "ArrowRight": it.x += step; break;
      case "ArrowUp": it.y -= step; break;
      case "ArrowDown": it.y += step; break;
      case "Delete": case "Backspace": removeSel(); break;
      case "[": it.rot = normAngle(it.rot - Math.PI / 90); break;
      case "]": it.rot = normAngle(it.rot + Math.PI / 90); break;
      default: used = false;
    }
    if (used && document.activeElement.type !== "range") { e.preventDefault(); syncPanel(true); render(); }
  });

  /* ---------- panel ---------- */
  function syncPanel(fromCanvas) {
    var it = S.items[S.sel];
    selGroup.classList.toggle("is-empty", !it);
    selName.textContent = it ? label(it.type) : "—";
    if (!it) return;
    var pct = it.w / S.W * 100;
    sizeRange.value = pct.toFixed(1);
    rotRange.value = Math.round(it.rot * 180 / Math.PI);
  }

  sizeRange.addEventListener("input", function () {
    var it = S.items[S.sel]; if (!it) return;
    it.w = clampW(parseFloat(sizeRange.value) / 100 * S.W);
    render();
  });
  rotRange.addEventListener("input", function () {
    var it = S.items[S.sel]; if (!it) return;
    it.rot = parseFloat(rotRange.value) * Math.PI / 180;
    render();
  });
  flipBtn.addEventListener("click", function () {
    var it = S.items[S.sel]; if (!it) return;
    it.flip = !it.flip; render();
  });
  frontBtn.addEventListener("click", function () {
    var it = S.items[S.sel]; if (!it) return;
    S.items.splice(S.sel, 1); S.items.push(it); S.sel = S.items.length - 1; render();
  });
  function removeSel() {
    if (S.sel < 0) return;
    S.items.splice(S.sel, 1);
    S.sel = -1;
    syncPanel(); render();
  }
  delBtn.addEventListener("click", removeSel);

  document.querySelectorAll("[data-add]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!S.photo) { fileInput.click(); return; }
      var type = b.getAttribute("data-add");
      var m = Math.min(S.W, S.H);
      var off = (S.items.length % 5) * m * 0.03;
      var w = type === "glasses" ? m * 0.55 : type === "joint" ? m * 0.26 : m * 0.8;
      S.items.push({ type: type, x: S.W / 2 + off, y: S.H / 2 + off, w: w, rot: 0, flip: false });
      S.sel = S.items.length - 1;
      syncPanel(); render();
    });
  });

  bwToggle.addEventListener("change", function () { S.bw = bwToggle.checked; render(); });

  resetBtn.addEventListener("click", function () {
    if (!S.photo) return;
    defaultLayout();
    syncPanel(); render();
  });

  /* ---------- export ---------- */
  exportBtn.addEventListener("click", function () {
    if (!S.photo) return;
    var out = document.createElement("canvas");
    out.width = S.W; out.height = S.H;
    var c = out.getContext("2d");
    c.imageSmoothingQuality = "high";
    drawScene(c, true);
    var done = function (blob) {
      if (!blob) { window.thugToast && window.thugToast("Export failed. Try another photo."); return; }
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "thug-life.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      window.thugToast && window.thugToast("Exported. Deal with it.");
    };
    if (out.toBlob) out.toBlob(done, "image/png");
    else {
      try {
        var bin = atob(out.toDataURL("image/png").split(",")[1]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        done(new Blob([arr], { type: "image/png" }));
      } catch (err) { done(null); }
    }
  });

  // make sure the caption font is ready before the first draw that needs it
  if (document.fonts) document.fonts.load('700 100px "UnifrakturCook"').then(render, function () {});
  syncPanel();
})();

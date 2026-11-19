/* VICEFEED — hero scene: procedural skyline + palm silhouettes */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";

  // tiny seeded RNG so the skyline is the same on every load
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function el(name, attrs) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function f(n) { return n.toFixed(1); }

  /* ---------- skyline ---------- */
  function city(svg) {
    var W = 1600, H = 200, r = rng(7);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    var back = el("g", { fill: "#5b1a5c", opacity: ".55" });
    var front = el("g", { fill: "#22082f" });
    var lights = el("g", { fill: "#ffc98a", opacity: ".75" });
    var x = 0;
    while (x < W) {
      var w = 18 + r() * 34;
      var h = 30 + r() * 90;
      back.appendChild(el("rect", { x: f(x), y: f(H - h - 30), width: f(w), height: f(h + 30) }));
      x += w + r() * 6;
    }
    x = -10;
    while (x < W) {
      var bw = 22 + r() * 46;
      // downtown cluster sits left of centre, beach strip stays low
      var d = Math.exp(-Math.pow((x - 520) / 300, 2));
      var bh = 18 + r() * 40 + d * (60 + r() * 90);
      var y = H - bh;
      front.appendChild(el("rect", { x: f(x), y: f(y), width: f(bw), height: f(bh) }));
      if (bh > 70 && r() > .55) { // antenna
        front.appendChild(el("rect", { x: f(x + bw / 2 - 1), y: f(y - 16), width: "2", height: "16" }));
      }
      for (var wy = y + 8; wy < H - 6; wy += 9) {
        for (var wx = x + 5; wx < x + bw - 5; wx += 8) {
          if (r() > .86) lights.appendChild(el("rect", { x: f(wx), y: f(wy), width: "3", height: "3" }));
        }
      }
      x += bw + 2 + r() * 10;
    }
    svg.appendChild(back); svg.appendChild(front); svg.appendChild(lights);
  }

  /* ---------- palms ---------- */
  function quad(p0, p1, p2, t) {
    var a = 1 - t;
    return [a * a * p0[0] + 2 * a * t * p1[0] + t * t * p2[0], a * a * p0[1] + 2 * a * t * p1[1] + t * t * p2[1]];
  }
  function quadD(p0, p1, p2, t) {
    return [2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]), 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])];
  }

  function trunk(base, ctrl, top, w0, w1) {
    var L = [], R = [], N = 40;
    for (var i = 0; i <= N; i++) {
      var t = i / N, p = quad(base, ctrl, top, t), d = quadD(base, ctrl, top, t);
      var len = Math.hypot(d[0], d[1]), nx = -d[1] / len, ny = d[0] / len;
      var w = (w0 + (w1 - w0) * t) / 2 + (i % 2 ? 1.1 : 0); // ringed bark
      L.push([p[0] + nx * w, p[1] + ny * w]);
      R.push([p[0] - nx * w, p[1] - ny * w]);
    }
    var pts = L.concat(R.reverse());
    return "M" + pts.map(function (p) { return f(p[0]) + " " + f(p[1]); }).join("L") + "Z";
  }

  function frond(c, ang, len, wid, r) {
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var side = Math.abs(dx);
    var droop = len * (0.25 + side * 0.55);
    var p0 = c;
    var p1 = [c[0] + dx * len * 0.55, c[1] + dy * len * 0.55 - len * 0.18];
    var p2 = [c[0] + dx * len, c[1] + dy * len + droop];
    var top = [], bot = [], N = 26;
    for (var i = 0; i <= N; i++) {
      var t = i / N, p = quad(p0, p1, p2, t), d = quadD(p0, p1, p2, t);
      var l = Math.hypot(d[0], d[1]), nx = -d[1] / l, ny = d[0] / l;
      var hw = wid * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - t * 0.35);
      var saw = i % 2 ? 1 : 0.28; // leaflets
      var hang = i % 2 ? hw * 0.55 : 0; // leaflets hang under gravity
      var j = (r() - .5) * hw * .25;
      top.push([p[0] + nx * hw * saw + j, p[1] + ny * hw * saw + hang]);
      bot.push([p[0] - nx * hw * saw + j, p[1] - ny * hw * saw + hang]);
    }
    var pts = top.concat(bot.reverse());
    return "M" + pts.map(function (p) { return f(p[0]) + " " + f(p[1]); }).join("L") + "Z";
  }

  function palm(svg, o) {
    var r = rng(o.seed);
    var g = el("g", { class: "sway" });
    var base = [o.x, 905], top = [o.x + o.lean, 900 - o.h];
    var ctrl = [o.x + o.lean * 0.15 + o.bow, 900 - o.h * 0.55];
    g.appendChild(el("path", { d: trunk(base, ctrl, top, o.w, o.w * 0.48) }));
    var n = 11;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI + (i / (n - 1)) * Math.PI; // left ... right, through "up"
      a += (r() - .5) * 0.25;
      var len = o.f * (0.75 + r() * 0.4) * (1 - Math.abs(Math.sin(a)) * 0.25);
      g.appendChild(el("path", { d: frond(top, a, len, o.f * 0.13, r) }));
    }
    // a couple of drooping fronds hanging under the crown
    [Math.PI * 0.22, Math.PI * 0.78].forEach(function (a) {
      g.appendChild(el("path", { d: frond(top, a, o.f * 0.7, o.f * 0.11, r) }));
    });
    for (var k = 0; k < 4; k++) {
      g.appendChild(el("circle", { cx: f(top[0] + (r() - .5) * 18), cy: f(top[1] + 8 + r() * 10), r: f(5 + r() * 3) }));
    }
    var paths = g.querySelectorAll("circle");
    paths.forEach(function (p) { p.setAttribute("fill", "#0a0311"); });
    svg.appendChild(g);
  }

  var cityEl = document.getElementById("city");
  if (cityEl) city(cityEl);

  var L = document.getElementById("palmsL");
  if (L) {
    palm(L, { x: 150, h: 600, lean: 90, bow: -40, w: 30, f: 230, seed: 3 });
    palm(L, { x: 60, h: 800, lean: 140, bow: -70, w: 36, f: 280, seed: 11 });
    palm(L, { x: 330, h: 420, lean: 40, bow: 20, w: 22, f: 170, seed: 21 });
  }
  var R = document.getElementById("palmsR");
  if (R) {
    palm(R, { x: 470, h: 720, lean: -120, bow: 60, w: 34, f: 260, seed: 5 });
    palm(R, { x: 560, h: 520, lean: -60, bow: 30, w: 26, f: 200, seed: 17 });
  }
})();

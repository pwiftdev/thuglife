/* VICEFEED — studio: live profile, claims and earnings */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var icon = VF.icon;
  var nf = new Intl.NumberFormat("en-US");
  var S = { wallet: null, user: null, rate: 0.5, claims: [], totals: null, filter: "all", fresh: {} };

  function api(path, body) {
    return fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" } : { credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; if (!r.ok) throw j; return j; }); });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function money(n) { return "$" + (n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function compact(n) { return n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M" : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K" : nf.format(n || 0); }
  function ago(iso) {
    var s = (Date.now() - Date.parse(iso)) / 1000;
    return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago";
  }
  var toastEl = $("#toast"), tt;
  function toast(m) { toastEl.textContent = m; toastEl.classList.add("show"); clearTimeout(tt); tt = setTimeout(function () { toastEl.classList.remove("show"); }, 2600); }

  /* ---------- count-up ---------- */
  function countTo(el, to, fmt) {
    var from = +(el.dataset.v || 0);
    el.dataset.v = to;
    if (reduce || from === to) { el.innerHTML = fmt(to); return; }
    var t0 = performance.now(), D = 1100;
    (function step() {
      var k = Math.min(1, (performance.now() - t0) / D), e = 1 - Math.pow(1 - k, 4);
      el.innerHTML = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    })();
  }

  /* ---------- profile ---------- */
  function paintProfile() {
    var u = S.user, h = "@" + u.username;
    $("#meHandle").textContent = h; $("#helloHandle").textContent = h; $("#mkHandle").textContent = h;
    var av = $("#meAv"); av.textContent = VF.profile.initials(u.username); av.style.background = VF.avatars[u.avatar || 0];
    var w = S.wallet.slice(0, 4) + "…" + S.wallet.slice(-4);
    $("#meWallet").textContent = w; $("#earnWallet").textContent = "Pays to " + w;
    $("#stRate").textContent = money(S.rate);
    var parts = [];
    if (u.tiktok) parts.push("TikTok @" + u.tiktok);
    if (u.x) parts.push("X @" + u.x);
    $("#claimHelp").textContent = "Paste a TikTok or X link. We pull the views and check it's from " + parts.join(" or ") + ".";
    // keep the editor's watermark in sync with the account
    VF.profile.set({ handle: u.username, av: u.avatar, tiktok: u.tiktok, x: u.x, wallet: S.wallet });
  }

  /* ---------- totals ---------- */
  function paintTotals() {
    var t = S.totals || { views: 0, earned: 0, live: 0, pending: 0, count: 0 };
    countTo($("#earnNum"), t.earned, function (v) { var p = v.toFixed(2).split("."); return "$" + nf.format(+p[0]) + "<span>." + p[1] + "</span>"; });
    countTo($("#stViews"), t.views, function (v) { return compact(Math.round(v)); });
    countTo($("#stLive"), t.live, function (v) { return Math.round(v); });
    $("#stPending").textContent = t.pending ? t.pending + " pending" : "none pending";
    $("#earnNote").textContent = t.live ? nf.format(t.views) + " counted views across " + t.live + " clip" + (t.live > 1 ? "s" : "") + "." : "Post a clip, paste the link below, and earnings show up here.";
    var nc = $("#navCount"); nc.hidden = !t.count; nc.textContent = t.count;
    chart();
  }
  // earnings line from each live claim's view history
  function chart() {
    var live = S.claims.filter(function (c) { return c.status === "live"; });
    var pts = [];
    live.forEach(function (c) { pts.push({ t: Date.parse(c.createdAt), e: c.earned }); });
    pts.sort(function (a, b) { return a.t - b.t; });
    var acc = 0, series = [0].concat(pts.map(function (p) { return (acc += p.e); }));
    if (series.length < 2) series = [0, 0];
    var max = Math.max.apply(null, series) || 1, n = series.length - 1;
    var d = series.map(function (v, i) { return (i ? "L" : "M") + (i / n * 400).toFixed(1) + " " + (110 - v / max * 96).toFixed(1); }).join(" ");
    $("#chartLine").setAttribute("d", d);
    $("#chartFill").setAttribute("d", d + " L400 120 L0 120Z");
  }

  /* ---------- rows ---------- */
  var STATUS = {
    processing: ["st--proc", "Processing"],
    live: ["st--live", "Live"],
    review: ["st--rev", "In review"],
    not_yours: ["st--bad", "Not your account"],
    rejected: ["st--bad", "Rejected"]
  };
  function rowHTML(c) {
    var st = STATUS[c.status] || ["st--rev", c.status];
    var title = c.caption ? c.caption.replace(/\s+/g, " ").slice(0, 70) : (c.platform === "tiktok" ? "TikTok video" : "X post") + " " + c.videoId.slice(-6);
    var who = c.author || c.handle;
    var plat = c.platform === "tiktok" ? "TikTok" : "X";
    var noteCls = c.status === "live" ? "warn" : c.status === "processing" ? "" : "bad";
    var counted = c.status === "live";
    return '<div class="tr' + (S.fresh[c.id] ? " is-new" : "") + '" data-id="' + c.id + '">' +
      '<span class="tc"><span class="pfbig ' + c.platform + '">' + icon(c.platform === "tiktok" ? "tiktok" : "xlogo") + '</span><span><b>' + esc(title) + '</b><em>' + plat + (who ? " · @" + esc(who) : "") + " · " + ago(c.createdAt) + '</em></span></span>' +
      '<span class="num">' + (c.status === "processing" ? "…" : nf.format(c.views || 0)) + "</span>" +
      '<span class="num">' + (counted ? money(c.earned) : "—") + "</span>" +
      '<span class="stcell"><i class="st ' + st[0] + '">' + st[1] + "</i>" + (c.status === "live" || c.status === "review" ? '<button class="ib" data-refresh="' + c.id + '" title="Refresh views" aria-label="Refresh views">' + icon("loop") + "</button>" : "") + '<a class="ib" href="' + esc(c.url) + '" target="_blank" rel="noopener" title="Open post" aria-label="Open post">' + icon("ext") + "</a></span>" +
      (c.note ? '<p class="note ' + noteCls + '">' + esc(c.note) + "</p>" : "") +
      "</div>";
  }
  function paintRows() {
    var q = ($("#search").value || "").toLowerCase().trim();
    var list = S.claims.filter(function (c) {
      if (q && ((c.caption || "") + " " + c.url + " " + (c.author || "")).toLowerCase().indexOf(q) < 0) return false;
      return S.filter === "all" || (S.filter === "live" ? c.status === "live" : c.status === "processing" || c.status === "review");
    });
    $("#rows").innerHTML = list.map(rowHTML).join("");
    $("#empty").hidden = S.claims.length > 0;
    S.fresh = {};
  }
  $("#seg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    S.filter = b.dataset.f;
    $$("#seg button").forEach(function (x) { x.classList.toggle("is-on", x === b); });
    paintRows();
  });

  /* ---------- data ---------- */
  function load() {
    return api("/api/claims").then(function (r) {
      S.claims = r.claims; S.totals = r.totals; S.rate = r.rate || S.rate;
      paintRows(); paintTotals();
      S.claims.filter(function (c) { return c.status === "processing"; }).forEach(function (c) { process(c.id); });
    });
  }
  var inflight = {};
  function process(id, force) {
    if (inflight[id]) return; inflight[id] = 1;
    api("/api/claims/process", { id: id, force: !!force }).then(function (r) {
      var c = r.claim, i = S.claims.findIndex(function (x) { return x.id === id; });
      if (i > -1) S.claims[i] = c;
      var msg = c.status === "live" ? "Verified: " + nf.format(c.views) + " views = " + money(c.earned) : c.note || "";
      if (c.status === "live") toast("Clip verified: " + nf.format(c.views) + " views = " + money(c.earned));
      else if (c.status === "not_yours") toast("That clip isn't from your linked account.");
      if (/Fetching/.test(cMsg.textContent)) { cMsg.textContent = msg; cMsg.className = "claimbox__msg " + (c.status === "live" ? "ok" : "err"); }
      return load();
    }).catch(function (e) { toast(e.message || "Couldn't check that clip right now."); })
      .then(function () { delete inflight[id]; });
  }
  $("#rows").addEventListener("click", function (e) {
    var b = e.target.closest("[data-refresh]"); if (!b) return;
    b.disabled = true; b.querySelector(".i").style.animation = "spin .8s linear infinite";
    process(b.dataset.refresh, true);
  });

  /* ---------- claim form ---------- */
  var cIn = $("#claimIn"), cPf = $("#claimPf"), cMsg = $("#claimMsg");
  function platformOf(v) { return /tiktok\.com/i.test(v) ? "tiktok" : /(^|\/\/|\.)(x|twitter)\.com/i.test(v) ? "x" : ""; }
  cIn.addEventListener("input", function () {
    var p = platformOf(cIn.value);
    cPf.className = "claimbar__pf " + p;
    cPf.innerHTML = icon(p === "tiktok" ? "tiktok" : p === "x" ? "xlogo" : "link");
    cMsg.textContent = ""; cMsg.className = "claimbox__msg";
  });
  $("#claimForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var url = cIn.value.trim(), btn = $("#claimGo");
    if (!url) { cMsg.textContent = "Paste a link first."; cMsg.className = "claimbox__msg err"; return; }
    btn.disabled = true; cMsg.textContent = "Submitting…"; cMsg.className = "claimbox__msg";
    api("/api/claims", { url: url }).then(function (r) {
      if (r.existing) { cMsg.textContent = "You already claimed this one. It's in your list."; cMsg.className = "claimbox__msg ok"; return; }
      S.fresh[r.claim.id] = 1;
      S.claims.unshift(r.claim); paintRows();
      cIn.value = ""; cIn.dispatchEvent(new Event("input"));
      cMsg.textContent = "Got it. Fetching the views…"; cMsg.className = "claimbox__msg ok";
      document.getElementById("clips").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      process(r.claim.id);
    }).catch(function (e) {
      cMsg.textContent = e.message || "Couldn't claim that link."; cMsg.className = "claimbox__msg err";
    }).then(function () { btn.disabled = false; });
  });

  $("#search").addEventListener("input", paintRows);

  /* ---------- misc ---------- */
  $("#claimBtn").addEventListener("click", function () { toast("Rewards are paid in SOL to " + S.wallet.slice(0, 4) + "…" + S.wallet.slice(-4) + "."); });
  $("#signOut").addEventListener("click", function () { api("/api/auth/logout", {}).then(function () { location.href = "start.html"; }); });

  var hr = new Date().getHours();
  $("#greet").textContent = hr < 5 ? "Late night" : hr < 12 ? "Morning" : hr < 18 ? "Afternoon" : "Evening";
  var launch = new Date(2026, 10, 19), now = new Date(); now.setHours(0, 0, 0, 0);
  var d = Math.round((now - launch) / 864e5);
  $("#day").textContent = d < 0 ? "GTA VI in " + -d + " days" : "GTA VI · Day " + (d + 1);
  document.querySelectorAll("canvas[data-still]").forEach(function (c) { VF.scenes.still(c, c.dataset.still, +c.dataset.t || 0); });

  /* ---------- boot ---------- */
  api("/api/me").then(function (r) {
    if (!r.wallet) { location.replace("start.html"); return; }
    if (!r.user) { location.replace("start.html"); return; }
    S.wallet = r.wallet; S.user = r.user; S.rate = r.rate;
    paintProfile();
    return load();
  }).catch(function (e) {
    toast(e.message || "Couldn't load your studio.");
  });
  // keep processing claims moving and views fresh while the tab is open
  setInterval(function () { if (!document.hidden && S.user) load(); }, 60000);
})();

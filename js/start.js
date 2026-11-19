/* VICEFEED — onboarding: wallet sign-in → username → TikTok/X → done */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var ob = $("#ob"), steps = $$(".obs"), dots = $$("#dots i");
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var S = { step: 0, wallet: null, username: "", av: null, tiktok: "", x: "", available: false };

  /* ---------- api ---------- */
  function api(path, body) {
    return fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" } : { credentials: "same-origin" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; if (!r.ok) throw j; return j; }); });
  }

  /* ---------- steps ---------- */
  function go(n) {
    S.step = Math.max(0, Math.min(3, n));
    ob.dataset.step = S.step;
    steps.forEach(function (s, i) { s.classList.toggle("is-on", i === S.step); s.classList.toggle("is-past", i < S.step); });
    dots.forEach(function (d, i) { d.classList.toggle("on", i === S.step - 1); d.classList.toggle("done", i < S.step - 1); });
    var focus = { 1: "#handleIn", 2: "#ttIn" }[S.step];
    if (focus) setTimeout(function () { $(focus).focus({ preventScroll: true }); }, 380);
    if (S.step === 3) finish();
    if (innerWidth < 900 && S.step > 0) $(".ob__panel").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }
  $("#backBtn").addEventListener("click", function () { if (S.step > 1) go(S.step - 1); });

  /* ---------- live card ---------- */
  function short(w) { return w ? w.slice(0, 4) + "…" + w.slice(-4) : ""; }
  function paint() {
    $("#pHandle").textContent = "@" + (S.username || "yourname");
    var av = $("#pAv");
    av.textContent = S.username ? VF.profile.initials(S.username) : "?";
    if (S.av != null) { av.style.setProperty("--avbg", VF.avatars[S.av]); av.style.setProperty("--avfg", "#07030c"); }
    $('[data-pf="tiktok"]').classList.toggle("on", !!S.tiktok);
    $('[data-pf="x"]').classList.toggle("on", !!S.x);
    $("#pTt").textContent = S.tiktok ? "@" + S.tiktok : "TikTok";
    $("#pX").textContent = S.x ? "@" + S.x : "X";
    var w = $("#pWallet");
    w.classList.toggle("on", !!S.wallet);
    w.querySelector("span").textContent = S.wallet ? short(S.wallet) + " connected" : "No wallet yet";
  }

  /* ---------- wallets ---------- */
  function phantom() {
    var p = (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom && window.solana);
    return p && p.isPhantom ? p : null;
  }
  var OTHERS = [
    { name: "Solflare", get: function () { return window.solflare && window.solflare.isSolflare ? window.solflare : null; }, c1: "#ffd36b", c2: "#ff8a3d" },
    { name: "Backpack", get: function () { return window.backpack && window.backpack.isBackpack ? window.backpack : null; }, c1: "#ff6b6b", c2: "#e5323a" }
  ];
  var status = $("#authStatus");
  function say(msg, kind) { status.textContent = msg || ""; status.className = "obs__status" + (kind ? " " + kind : ""); }

  var mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  function setupButtons() {
    var sub = $("#phantomSub");
    if (!phantom()) sub.textContent = mobile ? "Opens the Phantom app" : "Not installed: we'll take you to phantom.app";
    var html = OTHERS.filter(function (o) { return o.get(); }).map(function (o) {
      return '<button class="wbtn" data-w="' + o.name + '"><span class="wbtn__m" style="background:linear-gradient(135deg,' + o.c1 + "," + o.c2 + ')">' + o.name[0] + '</span><span class="wbtn__t"><b>' + o.name + "</b><em>Detected</em></span></button>";
    }).join("");
    $("#otherWallets").innerHTML = html;
  }
  // wallets inject a little after load
  setupButtons(); setTimeout(setupButtons, 600);

  function b64(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }

  var busy = false;
  async function signIn(provider, btn) {
    if (busy) return; busy = true;
    btn.disabled = true; btn.classList.add("is-busy");
    try {
      say("Opening your wallet…");
      var resp = await provider.connect();
      var pk = (resp && resp.publicKey) || provider.publicKey;
      var wallet = pk.toString();
      say("Sign the message in your wallet. It's free.");
      var n = await api("/api/auth/nonce?wallet=" + encodeURIComponent(wallet));
      var signed = await provider.signMessage(new TextEncoder().encode(n.message), "utf8");
      var sig = signed && signed.signature ? signed.signature : signed;
      var res = await api("/api/auth/verify", { wallet: wallet, message: n.message, signature: b64(new Uint8Array(sig)), token: n.token });
      S.wallet = wallet; paint();
      if (res.user && res.user.username) { say("Welcome back, @" + res.user.username + ".", "ok"); location.href = "studio.html"; return; }
      say("Wallet connected.", "ok");
      go(1);
    } catch (e) {
      var m = (e && (e.message || e.error)) || "";
      if (e && (e.code === 4001 || /reject|denied|cancel/i.test(m))) say("You cancelled in the wallet. Try again when ready.", "err");
      else say(m || "Couldn't sign in. Try again.", "err");
    } finally {
      busy = false; btn.disabled = false; btn.classList.remove("is-busy");
    }
  }

  $("#phantomBtn").addEventListener("click", function () {
    var p = phantom();
    if (p) return signIn(p, this);
    if (mobile) { location.href = "https://phantom.app/ul/browse/" + encodeURIComponent(location.href) + "?ref=" + encodeURIComponent(location.origin); return; }
    window.open("https://phantom.app/download", "_blank", "noopener");
    say("Install Phantom, then come back and refresh this page.");
  });
  $("#otherWallets").addEventListener("click", function (e) {
    var b = e.target.closest("[data-w]"); if (!b) return;
    var o = OTHERS.filter(function (x) { return x.name === b.dataset.w; })[0];
    if (o && o.get()) signIn(o.get(), b);
  });

  /* ---------- username ---------- */
  var hIn = $("#handleIn"), hBox = $("#handleBox"), hOk = $("#handleOk span"), hHint = $("#handleHint"), checkT, checkSeq = 0;
  function validName(v) { return /^[a-z0-9._]{3,24}$/.test(v); }
  function syncGo1() { $("#go1").disabled = !(S.available && S.av != null); }
  hIn.addEventListener("input", function () {
    var v = hIn.value.toLowerCase().replace(/[^a-z0-9._]/g, "");
    if (v !== hIn.value) hIn.value = v;
    S.username = v; S.available = false; paint(); syncGo1();
    hBox.classList.remove("ok", "taken");
    clearTimeout(checkT);
    if (!validName(v)) { hHint.textContent = "3–24 characters: letters, numbers, dots, underscores."; return; }
    var seq = ++checkSeq;
    checkT = setTimeout(function () {
      api("/api/username?u=" + encodeURIComponent(v)).then(function (r) {
        if (seq !== checkSeq) return;
        S.available = !!r.available;
        hBox.classList.toggle("ok", S.available); hBox.classList.toggle("taken", !S.available);
        hOk.textContent = S.available ? "Available" : "Taken";
        hHint.textContent = S.available ? "Nice. That's yours if you want it." : "Someone has that one. Try another.";
        syncGo1();
      }).catch(function () { hHint.textContent = "Couldn't check right now."; });
    }, 280);
  });
  hIn.addEventListener("keydown", function (e) { if (e.key === "Enter" && !$("#go1").disabled) go(2); });
  $$(".av[data-av]").forEach(function (b) {
    b.style.background = VF.avatars[+b.dataset.av];
    b.addEventListener("click", function () {
      S.av = +b.dataset.av;
      $$(".av").forEach(function (x) { x.setAttribute("aria-pressed", x === b); });
      paint(); syncGo1();
    });
  });
  $("#go1").addEventListener("click", function () { go(2); });

  /* ---------- pages ---------- */
  function cleanHandle(v) { return v.toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9._]/g, ""); }
  ["ttIn", "xIn"].forEach(function (idn) {
    var el = $("#" + idn);
    el.addEventListener("input", function () {
      var v = cleanHandle(el.value); if (v !== el.value) el.value = v;
      if (idn === "ttIn") S.tiktok = v; else S.x = v;
      $("#go2").disabled = !(S.tiktok.length >= 2 || S.x.length >= 2);
      paint();
    });
  });
  $("#go2").addEventListener("click", function () {
    var btn = this, st = $("#saveStatus");
    btn.disabled = true; st.textContent = "Saving…"; st.className = "obs__status";
    api("/api/me", { username: S.username, avatar: S.av || 0, tiktok: S.tiktok, x: S.x }).then(function (r) {
      VF.profile.set({ handle: r.user.username, av: r.user.avatar, tiktok: r.user.tiktok, x: r.user.x, wallet: S.wallet });
      go(3);
    }).catch(function (e) {
      st.textContent = e.message || "Couldn't save. Try again."; st.className = "obs__status err";
      if (e.error === "username_taken") setTimeout(function () { go(1); }, 900);
    }).then(function () { btn.disabled = false; });
  });

  /* ---------- tilt ---------- */
  var card = $(".pcard"), stage = $(".ob__stage");
  if (!reduce && matchMedia("(pointer: fine)").matches) {
    stage.addEventListener("pointermove", function (e) {
      var r = stage.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      card.style.setProperty("--ry", (x * 14).toFixed(2) + "deg");
      card.style.setProperty("--rx", (-y * 12).toFixed(2) + "deg");
      card.style.setProperty("--mx", (50 + x * 80) + "%");
      card.style.setProperty("--my", (y * 80) + "%");
    });
    stage.addEventListener("pointerleave", function () { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); });
  }

  /* ---------- done ---------- */
  var finished = false;
  function finish() {
    var h = "@" + (S.username || "you");
    $("#doneHandle").textContent = h; $("#doneWmH").textContent = h;
    var c = $(".wmprev canvas");
    if (!c.dataset.on) { c.dataset.on = 1; VF.scenes.mount(c, "highway", { offset: 2 }); }
    if (!finished && !reduce) confetti();
    finished = true;
  }
  function confetti() {
    var cv = $("#confetti"), ctx = cv.getContext("2d"), d = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * d; cv.height = innerHeight * d;
    var cols = ["#14ecd9", "#ff1589", "#fbecd4", "#ffc65e", "#ff8a3d"], P = [];
    var ox = (innerWidth > 900 ? innerWidth * .75 : innerWidth * .5) * d, oy = innerHeight * .35 * d;
    for (var i = 0; i < 140; i++) {
      var a = Math.random() * Math.PI * 2, sp = (4 + Math.random() * 9) * d;
      P.push({ x: ox, y: oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6 * d, r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3, w: (5 + Math.random() * 7) * d, h: (8 + Math.random() * 10) * d, c: cols[i % cols.length], round: Math.random() > .7 });
    }
    var t0 = performance.now();
    (function tick(now) {
      var k = (now - t0) / 1000;
      ctx.clearRect(0, 0, cv.width, cv.height);
      P.forEach(function (p) {
        p.vy += .32 * d; p.vx *= .985; p.vy *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - k / 3);
        ctx.fillStyle = p.c;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 7); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 2);
        ctx.restore();
      });
      if (k < 3.2) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
    })(t0);
  }

  /* ---------- boot: resume where the user left off ---------- */
  var obs = document.getElementById("obScene");
  if (obs) VF.scenes.mount(obs, "highway", { offset: 1, speed: .6 });
  paint();
  api("/api/me").then(function (r) {
    if (!r.wallet) { go(0); return; }
    S.wallet = r.wallet; paint();
    if (r.user && r.user.username && !/edit=1/.test(location.search)) { location.replace("studio.html"); return; }
    if (r.user) { S.username = r.user.username; S.av = r.user.avatar; S.tiktok = r.user.tiktok || ""; S.x = r.user.x || ""; }
    go(1);
  }).catch(function () { go(0); });
})();

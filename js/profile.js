/* VICEFEED — the clipper's profile, kept on this device until accounts exist. */
(function () {
  var AV = [
    "linear-gradient(135deg,#ff1589,#ff8a3d 60%,#ffc65e)",
    "linear-gradient(135deg,#7ff9ee,#14ecd9 40%,#1a7fd6)",
    "conic-gradient(from 210deg,#14ecd9,#ff1589,#6d2bff,#14ecd9)",
    "linear-gradient(135deg,#fff3c8,#ffc65e 45%,#ff8a3d)",
    "linear-gradient(135deg,#8a5cff,#3a0f6b 55%,#ff1589)"
  ];
  var KEY = "vf.profile";
  var DEF = { handle: "leonida.clips", av: 0, plats: { tiktok: "leonida.clips", youtube: "LeonidaClips" }, wallet: "Phantom" };
  function get() { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return Object.assign({}, DEF); } }
  function set(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
  function initials(h) { return (h || "?").replace(/[^a-z0-9]/gi, " ").trim().split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase() || "?"; }
  window.VF = window.VF || {};
  window.VF.avatars = AV;
  window.VF.profile = { get: get, set: set, initials: initials };
})();

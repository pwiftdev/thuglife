// Wallet sign-in: Solana ed25519 signature checks, stateless nonces and an
// HMAC-signed session cookie. No third-party packages.
const crypto = require("crypto");
const { cookies, isHttps, fail } = require("./http");
const db = require("./db");

const SESSION_COOKIE = "vf_session";
const SESSION_DAYS = 30;
const NONCE_TTL = 10 * 60 * 1000;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.VERCEL) throw fail(503, "config_missing", "SESSION_SECRET isn't set on the server.");
  return "vicefeed-local-dev-secret-change-me";
}

/* ---------- base58 (Solana addresses and signatures) ---------- */
const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MAP = {}; for (let i = 0; i < ALPHA.length; i++) MAP[ALPHA[i]] = i;
function b58decode(str) {
  if (typeof str !== "string" || !str) return null;
  const bytes = [0];
  for (const ch of str) {
    const v = MAP[ch]; if (v === undefined) return null;
    let carry = v;
    for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of str) { if (ch === "1") bytes.push(0); else break; }
  return Buffer.from(bytes.reverse());
}
const isWallet = (w) => typeof w === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w) && (b58decode(w) || []).length === 32;

function verifySignature(wallet, message, signature) {
  const pub = b58decode(wallet);
  if (!pub || pub.length !== 32) return false;
  let sig = null;
  if (typeof signature === "string") {
    sig = /^[1-9A-HJ-NP-Za-km-z]+$/.test(signature) && signature.length > 80 ? b58decode(signature) : Buffer.from(signature, "base64");
  }
  if (!sig || sig.length !== 64) return false;
  const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pub]), format: "der", type: "spki" });
  return crypto.verify(null, Buffer.from(message, "utf8"), key, sig);
}

/* ---------- signed tokens ---------- */
const b64u = (buf) => Buffer.from(buf).toString("base64url");
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + mac;
}
function unsign(token) {
  if (typeof token !== "string" || token.indexOf(".") < 0) return null;
  const [body, mac] = token.split(".");
  const want = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch (e) { return null; }
}

/* ---------- sign-in message ---------- */
function signInMessage(wallet, domain, nonce, issuedAt) {
  return [
    domain + " wants you to sign in with your Solana account:",
    wallet,
    "",
    "Sign in to VICEFEED. This is free: it doesn't send a transaction or touch your funds.",
    "",
    "Nonce: " + nonce,
    "Issued At: " + issuedAt
  ].join("\n");
}
function issueNonce(wallet, domain) {
  const nonce = crypto.randomBytes(12).toString("hex");
  const issuedAt = new Date().toISOString();
  return { message: signInMessage(wallet, domain, nonce, issuedAt), token: sign({ w: wallet, n: nonce, d: domain, t: issuedAt }) };
}
async function checkNonce(token, wallet, message) {
  const p = unsign(token);
  if (!p || p.w !== wallet) throw fail(401, "bad_nonce", "Sign-in request expired. Try again.");
  if (Date.now() - Date.parse(p.t) > NONCE_TTL) throw fail(401, "nonce_expired", "Sign-in request expired. Try again.");
  if (message !== signInMessage(wallet, p.d, p.n, p.t)) throw fail(401, "bad_message", "Signed message doesn't match.");
  // single use
  if (!(await db.setNX("nonce:" + p.n, 1))) throw fail(401, "nonce_used", "That sign-in request was already used.");
  await db.expire("nonce:" + p.n, 900);
}

/* ---------- session ---------- */
function setSession(res, req, wallet) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const value = sign({ w: wallet, exp });
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 86400 + (isHttps(req) ? "; Secure" : ""));
}
function clearSession(res, req) {
  res.setHeader("Set-Cookie", SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (isHttps(req) ? "; Secure" : ""));
}
function session(req) {
  const p = unsign(cookies(req)[SESSION_COOKIE]);
  if (!p || !p.w || p.exp < Date.now()) return null;
  return p.w;
}
function requireWallet(req) {
  const w = session(req);
  if (!w) throw fail(401, "signed_out", "Sign in with your wallet first.");
  return w;
}

module.exports = { isWallet, verifySignature, issueNonce, checkNonce, setSession, clearSession, session, requireWallet, b58decode };

// Clipper profiles + payout maths.
const db = require("./db");
const { fail } = require("./http");

const RATE = Number(process.env.RATE_PER_1K || 0.5);
const USERNAME_RE = /^[a-z0-9._]{3,24}$/;
const HANDLE_RE = /^[a-z0-9._]{2,30}$/;

const cleanHandle = (h) => String(h || "").trim().replace(/^@+/, "").replace(/^https?:\/\/(www\.)?(tiktok\.com\/@|x\.com\/|twitter\.com\/)/i, "").split(/[/?#]/)[0].toLowerCase();

async function getUser(wallet) { return db.get("user:" + wallet); }

async function usernameFree(name, wallet) {
  const owner = await db.get("username:" + name);
  return !owner || owner === wallet;
}

async function saveProfile(wallet, input) {
  const existing = (await getUser(wallet)) || { wallet, createdAt: new Date().toISOString() };
  const username = String(input.username ?? existing.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!USERNAME_RE.test(username)) throw fail(400, "bad_username", "Usernames are 3–24 letters, numbers, dots or underscores.");
  const tiktok = cleanHandle(input.tiktok ?? existing.tiktok);
  const x = cleanHandle(input.x ?? existing.x);
  if (tiktok && !HANDLE_RE.test(tiktok)) throw fail(400, "bad_tiktok", "That TikTok handle doesn't look right.");
  if (x && !HANDLE_RE.test(x)) throw fail(400, "bad_x", "That X handle doesn't look right.");
  if (!tiktok && !x) throw fail(400, "no_pages", "Link at least one page: TikTok or X.");
  const av = Math.max(0, Math.min(4, parseInt(input.avatar ?? existing.avatar ?? 0, 10) || 0));

  if (username !== existing.username) {
    if (!(await db.setNX("username:" + username, wallet))) {
      if (!(await usernameFree(username, wallet))) throw fail(409, "username_taken", "@" + username + " is taken.");
    }
    if (existing.username) await db.del("username:" + existing.username);
  }
  const user = { ...existing, username, tiktok, x, avatar: av, updatedAt: new Date().toISOString() };
  await db.set("user:" + wallet, user);
  return user;
}

function payout(views) {
  const units = Math.floor((views || 0) / 1000);
  return { units, earned: +(units * RATE).toFixed(2) };
}

module.exports = { getUser, saveProfile, usernameFree, cleanHandle, payout, RATE, USERNAME_RE };

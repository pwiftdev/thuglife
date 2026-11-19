// Claims: a clipper submits a TikTok/X link, we fetch its public views,
// check it was posted from their linked account, and price it per 1K views.
const crypto = require("crypto");
const db = require("./db");
const { fail } = require("./http");
const { parse, resolve, fetchStats } = require("./platforms");
const { payout } = require("./users");

const TAG_RE = /#vicefeed|\$vicefeed/i;
const PER_HOUR = 30;

function publicClaim(c) {
  const { wallet, history, ...rest } = c;
  return rest;
}

async function listClaims(wallet) {
  const ids = await db.lrange("claims:" + wallet, 0, 199);
  const claims = (await db.mget(ids.map((id) => "claim:" + id))).filter(Boolean);
  const totals = claims.reduce((t, c) => {
    if (c.status === "live") { t.views += c.views || 0; t.earned += c.earned || 0; t.live++; }
    if (c.status === "processing" || c.status === "review") t.pending++;
    return t;
  }, { views: 0, earned: 0, live: 0, pending: 0, count: claims.length });
  totals.earned = +totals.earned.toFixed(2);
  return { claims: claims.map(publicClaim), totals };
}

async function createClaim(wallet, user, rawUrl) {
  let link = parse(rawUrl);
  if (!link) throw fail(400, "bad_link", "Paste a TikTok video link or an X post link.");
  const recent = await db.incr("rate:claims:" + wallet + ":" + Math.floor(Date.now() / 36e5));
  if (recent === 1) await db.expire("rate:claims:" + wallet + ":" + Math.floor(Date.now() / 36e5), 3700);
  if (recent > PER_HOUR) throw fail(429, "slow_down", "That's a lot of clips. Try again in a bit.");
  link = await resolve(link);
  const linked = link.platform === "tiktok" ? user.tiktok : user.x;
  if (!linked) throw fail(400, "not_linked", "Add your " + (link.platform === "tiktok" ? "TikTok" : "X") + " handle to your profile first.");

  const id = "c_" + crypto.randomBytes(8).toString("hex");
  const key = "claimurl:" + link.platform + ":" + link.id;
  if (!(await db.setNX(key, id))) {
    const existingId = await db.get(key);
    const existing = existingId && (await db.get("claim:" + existingId));
    if (existing && existing.wallet === wallet) return { claim: publicClaim(existing), existing: true };
    throw fail(409, "already_claimed", "This clip was already claimed by another account.");
  }
  const now = new Date().toISOString();
  const claim = {
    id, wallet, platform: link.platform, videoId: link.id, url: link.url, handle: link.handle || null,
    status: "processing", views: 0, units: 0, earned: 0, note: null, tagged: null,
    createdAt: now, updatedAt: now, checkedAt: null, history: []
  };
  await db.set("claim:" + id, claim);
  await db.lpush("claims:" + wallet, id);
  await db.sadd("claims:active", id);
  return { claim: publicClaim(claim) };
}

async function processClaim(claim, user, { force } = {}) {
  const since = claim.checkedAt ? Date.now() - Date.parse(claim.checkedAt) : Infinity;
  if (!force && claim.status !== "processing" && since < 10 * 60 * 1000) return claim; // throttle refreshes
  const link = { platform: claim.platform, id: claim.videoId, url: claim.url, handle: claim.handle };
  const linked = (claim.platform === "tiktok" ? user && user.tiktok : user && user.x) || "";
  try {
    const s = await fetchStats(link);
    claim.views = s.views;
    claim.author = s.author || claim.handle;
    claim.caption = (s.caption || "").slice(0, 280);
    claim.tagged = TAG_RE.test(s.caption || "");
    Object.assign(claim, payout(s.views));
    if (!linked) { claim.status = "not_yours"; claim.note = "Link your " + (claim.platform === "tiktok" ? "TikTok" : "X") + " handle to count this clip."; }
    else if (claim.author && claim.author !== linked) { claim.status = "not_yours"; claim.note = "Posted by @" + claim.author + ", not your linked @" + linked + "."; }
    else if (claim.platform === "x" && s.hasVideo === false) { claim.status = "rejected"; claim.note = "That post has no video."; }
    else { claim.status = "live"; claim.note = claim.tagged ? null : "Add #VICEFEED to the caption so we can match it faster."; }
  } catch (e) {
    if (e.code === "not_found") { claim.status = "rejected"; claim.note = e.message; }
    else { claim.status = "review"; claim.note = "We couldn't read the views automatically. We'll check it by hand."; claim.error = String(e.message).slice(0, 160); }
  }
  claim.checkedAt = claim.updatedAt = new Date().toISOString();
  claim.history = [...(claim.history || []), { t: claim.checkedAt, v: claim.views }].slice(-30);
  if (claim.status === "rejected" || claim.status === "not_yours") await db.srem("claims:active", claim.id);
  await db.set("claim:" + claim.id, claim);
  return claim;
}

module.exports = { listClaims, createClaim, processClaim, publicClaim };

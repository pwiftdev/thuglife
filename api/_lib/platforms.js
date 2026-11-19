// TikTok + X: parse links and fetch public view counts.
//
// TikTok: reads the public video page (the same JSON the web player uses).
//   Optional: set TIKTOK_VIEWS_API to a provider URL containing {id} / {url}
//   that returns JSON with a play count, used first if present.
// X: uses the official API when X_BEARER_TOKEN is set (media view_count),
//   otherwise the public embed (syndication) endpoint that powers tweet embeds.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function parse(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, "").toLowerCase();
  let m;
  if (host === "tiktok.com") {
    if ((m = u.pathname.match(/^\/@([\w.-]+)\/(?:video|photo)\/(\d{8,25})/))) return { platform: "tiktok", id: m[2], handle: m[1].toLowerCase(), url: "https://www.tiktok.com/@" + m[1] + "/video/" + m[2] };
    if ((m = u.pathname.match(/^\/t\/([\w-]+)/))) return { platform: "tiktok", short: true, url: u.href };
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") return { platform: "tiktok", short: true, url: u.href };
  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com" || host === "fxtwitter.com" || host === "vxtwitter.com") {
    if ((m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})/))) return { platform: "x", id: m[2], handle: m[1].toLowerCase(), url: "https://x.com/" + m[1] + "/status/" + m[2] };
  }
  return null;
}

async function timed(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 9000);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// vm.tiktok.com/abc → canonical /@user/video/id
async function resolve(link) {
  if (!link.short) return link;
  let url = link.url;
  for (let i = 0; i < 4; i++) {
    const r = await timed(url, { redirect: "manual", headers: { "User-Agent": UA } });
    const loc = r.headers.get("location");
    if (!loc) break;
    url = new URL(loc, url).href;
    const p = parse(url);
    if (p && !p.short) return p;
  }
  throw Object.assign(new Error("Couldn't open that short link. Paste the full video link."), { status: 400, code: "bad_short_link" });
}

/* ---------------- TikTok ---------------- */
function dig(o, keys) { return keys.reduce((a, k) => (a == null ? a : a[k]), o); }

async function tiktok(link) {
  if (process.env.TIKTOK_VIEWS_API) {
    try {
      const r = await timed(process.env.TIKTOK_VIEWS_API.replace("{id}", link.id).replace("{url}", encodeURIComponent(link.url)), { headers: { Accept: "application/json" } });
      const j = await r.json();
      const views = num(dig(j, ["data", "play_count"]) ?? dig(j, ["data", "stats", "playCount"]) ?? j.playCount ?? j.play_count ?? j.views);
      if (views != null) return { views, author: (dig(j, ["data", "author", "unique_id"]) || dig(j, ["data", "author", "uniqueId"]) || link.handle || "").toLowerCase(), caption: dig(j, ["data", "title"]) || dig(j, ["data", "desc"]) || "", source: "provider" };
    } catch (e) { /* fall through to the public page */ }
  }
  const r = await timed(link.url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html" } }, 12000);
  const html = await r.text();
  let item = null;
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try { item = dig(JSON.parse(m[1]), ["__DEFAULT_SCOPE__", "webapp.video-detail", "itemInfo", "itemStruct"]); } catch (e) {}
  }
  if (!item) {
    const s = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
    if (s) { try { item = dig(JSON.parse(s[1]), ["ItemModule", link.id]); } catch (e) {} }
  }
  let views = item && num(dig(item, ["statsV2", "playCount"]) ?? dig(item, ["stats", "playCount"]));
  if (views == null) {
    const p = html.match(/"playCount":"?(\d+)/);
    if (p) views = +p[1];
  }
  if (views == null) throw unavailable("TikTok didn't return a view count for this video yet.");
  return { views, author: (dig(item, ["author", "uniqueId"]) || link.handle || "").toLowerCase(), caption: (item && item.desc) || "", source: "tiktok" };
}

/* ---------------- X ---------------- */
async function xApi(link) {
  const u = "https://api.x.com/2/tweets/" + link.id + "?expansions=attachments.media_keys,author_id&media.fields=public_metrics,type&tweet.fields=public_metrics,text&user.fields=username";
  const r = await timed(u, { headers: { Authorization: "Bearer " + process.env.X_BEARER_TOKEN } });
  if (!r.ok) throw unavailable("X API returned " + r.status + ".");
  const j = await r.json();
  const media = (dig(j, ["includes", "media"]) || []).find((m) => m.type === "video" || m.type === "animated_gif");
  const views = num(dig(media, ["public_metrics", "view_count"]) ?? dig(j, ["data", "public_metrics", "impression_count"]));
  if (views == null) throw unavailable("X didn't return a view count for this post.");
  return { views, author: (dig(j, ["includes", "users", 0, "username"]) || link.handle || "").toLowerCase(), caption: dig(j, ["data", "text"]) || "", hasVideo: !!media, source: "x-api" };
}

function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}
async function xPublic(link) {
  const u = "https://cdn.syndication.twimg.com/tweet-result?id=" + link.id + "&lang=en&token=" + syndicationToken(link.id);
  const r = await timed(u, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (r.status === 404) throw Object.assign(new Error("That post doesn't exist or isn't public."), { status: 404, code: "not_found" });
  if (!r.ok) throw unavailable("X returned " + r.status + ".");
  const j = await r.json();
  if (j.__typename === "TweetTombstone") throw Object.assign(new Error("That post isn't public."), { status: 404, code: "not_found" });
  const hasVideo = !!(j.video || (j.mediaDetails || []).some((m) => m.type === "video" || m.type === "animated_gif"));
  const views = num(dig(j, ["video", "viewCount"]) ?? dig(j, ["mediaDetails", 0, "mediaStats", "viewCount"]) ?? j.views_count ?? dig(j, ["views", "count"]));
  if (views == null) throw unavailable(hasVideo ? "X isn't sharing this video's views publicly yet." : "That post has no video.");
  return { views, author: (dig(j, ["user", "screen_name"]) || link.handle || "").toLowerCase(), caption: j.text || "", hasVideo, source: "x-public" };
}

async function x(link) {
  if (process.env.X_BEARER_TOKEN) {
    try { return await xApi(link); } catch (e) { /* fall back to the public endpoint */ }
  }
  return xPublic(link);
}

/* ---------------- helpers ---------------- */
function num(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}
function unavailable(msg) { return Object.assign(new Error(msg), { status: 502, code: "views_unavailable" }); }

async function fetchStats(link) {
  return link.platform === "tiktok" ? tiktok(link) : x(link);
}

module.exports = { parse, resolve, fetchStats };

// Daily: refresh view counts for live claims. Vercel Cron calls this with
// Authorization: Bearer $CRON_SECRET.
const { send, route, fail } = require("./_lib/http");
const db = require("./_lib/db");
const { getUser } = require("./_lib/users");
const { processClaim } = require("./_lib/claims");

module.exports = route(["GET"], async (req, res) => {
  const want = process.env.CRON_SECRET;
  if (!want || req.headers.authorization !== "Bearer " + want) throw fail(401, "unauthorized", "Nope.");
  const ids = (await db.smembers("claims:active")).slice(0, 150);
  let done = 0;
  for (const id of ids) {
    const c = await db.get("claim:" + id);
    if (!c) { await db.srem("claims:active", id); continue; }
    await processClaim(c, await getUser(c.wallet), { force: true });
    done++;
  }
  send(res, 200, { refreshed: done });
});

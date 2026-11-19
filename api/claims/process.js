// POST /api/claims/process { id, force? } → fetches views for one claim
const { send, readJson, route, fail } = require("../_lib/http");
const { requireWallet } = require("../_lib/auth");
const db = require("../_lib/db");
const { getUser } = require("../_lib/users");
const { processClaim, publicClaim } = require("../_lib/claims");

module.exports = route(["POST"], async (req, res) => {
  const wallet = requireWallet(req);
  const { id, force } = await readJson(req);
  const claim = typeof id === "string" && (await db.get("claim:" + id));
  if (!claim || claim.wallet !== wallet) throw fail(404, "not_found", "Claim not found.");
  const done = await processClaim(claim, await getUser(wallet), { force: !!force && claim.status === "review" });
  send(res, 200, { claim: publicClaim(done) });
});

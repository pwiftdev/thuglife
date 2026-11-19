// GET  /api/claims          → { claims, totals }
// POST /api/claims { url }  → { claim }   (status starts as "processing")
const { send, readJson, route, fail } = require("../_lib/http");
const { requireWallet } = require("../_lib/auth");
const { getUser, RATE } = require("../_lib/users");
const { listClaims, createClaim } = require("../_lib/claims");

module.exports = route(["GET", "POST"], async (req, res) => {
  const wallet = requireWallet(req);
  if (req.method === "GET") return send(res, 200, { ...(await listClaims(wallet)), rate: RATE });
  const user = await getUser(wallet);
  if (!user) throw fail(400, "no_profile", "Finish your profile first.");
  const { url } = await readJson(req);
  const out = await createClaim(wallet, user, url);
  send(res, out.existing ? 200 : 201, out);
});

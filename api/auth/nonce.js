// GET /api/auth/nonce?wallet=<base58>  →  { message, token }
const { send, query, route, fail } = require("../_lib/http");
const { isWallet, issueNonce } = require("../_lib/auth");

module.exports = route(["GET"], async (req, res) => {
  const wallet = query(req).get("wallet") || "";
  if (!isWallet(wallet)) throw fail(400, "bad_wallet", "That isn't a Solana wallet address.");
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "vicefeed").split(":")[0];
  send(res, 200, issueNonce(wallet, host));
});

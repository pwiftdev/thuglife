// POST /api/auth/verify { wallet, message, signature, token } → session cookie
const { send, readJson, route, fail } = require("../_lib/http");
const { isWallet, verifySignature, checkNonce, setSession } = require("../_lib/auth");
const { getUser } = require("../_lib/users");

module.exports = route(["POST"], async (req, res) => {
  const { wallet, message, signature, token } = await readJson(req);
  if (!isWallet(wallet)) throw fail(400, "bad_wallet", "That isn't a Solana wallet address.");
  if (typeof message !== "string" || message.length > 600) throw fail(400, "bad_message", "Missing sign-in message.");
  if (!verifySignature(wallet, message, signature)) throw fail(401, "bad_signature", "Signature didn't check out. Try again.");
  await checkNonce(token, wallet, message);
  setSession(res, req, wallet);
  send(res, 200, { wallet, user: await getUser(wallet) });
});

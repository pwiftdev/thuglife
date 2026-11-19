// GET  /api/me → { wallet, user, rate }   (wallet is null when signed out)
// POST /api/me { username, avatar, tiktok, x } → saves the profile
const { send, readJson, route } = require("./_lib/http");
const { requireWallet, session } = require("./_lib/auth");
const { getUser, saveProfile, RATE } = require("./_lib/users");

module.exports = route(["GET", "POST"], async (req, res) => {
  if (req.method === "GET") {
    const w = session(req); // signed-out is a normal state here, not an error
    return send(res, 200, { wallet: w || null, user: w ? await getUser(w) : null, rate: RATE });
  }
  const wallet = requireWallet(req);
  const user = await saveProfile(wallet, await readJson(req));
  send(res, 200, { wallet, user, rate: RATE });
});

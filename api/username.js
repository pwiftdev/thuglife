// GET /api/username?u=name → { available }
const { send, query, route } = require("./_lib/http");
const { session } = require("./_lib/auth");
const { usernameFree, USERNAME_RE } = require("./_lib/users");

module.exports = route(["GET"], async (req, res) => {
  const u = String(query(req).get("u") || "").toLowerCase().replace(/^@/, "");
  if (!USERNAME_RE.test(u)) return send(res, 200, { available: false, reason: "format" });
  send(res, 200, { available: await usernameFree(u, session(req)) });
});

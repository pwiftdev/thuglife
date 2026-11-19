// POST /api/auth/logout
const { send, route } = require("../_lib/http");
const { clearSession } = require("../_lib/auth");

module.exports = route(["POST"], async (req, res) => {
  clearSession(res, req);
  send(res, 200, { ok: true });
});

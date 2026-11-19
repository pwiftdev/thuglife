// Small request/response helpers that work on Vercel and in dev.js alike.

function send(res, status, body, headers) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (headers) for (const k of Object.keys(headers)) res.setHeader(k, headers[k]);
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { return {}; }
}

function query(req) {
  return new URL(req.url, "http://local").searchParams;
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isHttps(req) {
  return (req.headers["x-forwarded-proto"] || "").includes("https") || !!process.env.VERCEL;
}

function origin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return (isHttps(req) ? "https://" : "http://") + host;
}

// Wraps a handler: method check + uniform error responses.
function route(methods, fn) {
  return async (req, res) => {
    if (!methods.includes(req.method)) return send(res, 405, { error: "method_not_allowed" }, { Allow: methods.join(", ") });
    try {
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      send(res, status, { error: e.code || (status >= 500 ? "server_error" : "bad_request"), message: e.expose || status < 500 ? e.message : "Something went wrong" });
    }
  };
}

function fail(status, code, message) {
  return Object.assign(new Error(message || code), { status, code });
}

module.exports = { send, readJson, query, cookies, isHttps, origin, route, fail };

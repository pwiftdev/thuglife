// Local preview with the API routes working: `node dev.js` → http://localhost:5180
// No dependencies. On Vercel this file is ignored (see .vercelignore).
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5180;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".txt": "text/plain", ".json": "application/json", ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2" };

http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const api = p.match(/^\/api\/([a-z][a-z/-]*)$/);
  if (api && !api[1].includes("_lib")) {
    let file = path.join(ROOT, "api", api[1] + ".js");
    if (!fs.existsSync(file)) file = path.join(ROOT, "api", api[1], "index.js");
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
    Object.keys(require.cache).forEach((k) => { if (k.startsWith(path.join(ROOT, "api"))) delete require.cache[k]; });
    try { return await require(file)(req, res); } catch (e) { console.error(e); res.statusCode = 500; return res.end("error"); }
  }
  let file = path.normalize(path.join(ROOT, p === "/" ? "index.html" : p));
  if (p !== "/" && p.endsWith("/")) file = path.join(file, "index.html");
  else if (!path.extname(file) && fs.existsSync(file + ".html")) file += ".html";
  else if (!path.extname(file) && fs.existsSync(path.join(file, "index.html"))) { res.statusCode = 308; res.setHeader("Location", p + "/"); return res.end(); }
  if (!file.startsWith(ROOT) || /(^|\/)\./.test(path.relative(ROOT, file))) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(buf);
  });
}).listen(PORT, () => console.log(`VICEFEED dev → http://localhost:${PORT}`));

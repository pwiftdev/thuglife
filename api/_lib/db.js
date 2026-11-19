// Storage: Upstash Redis over REST in production (Vercel KV / Upstash integration
// sets these env vars), a JSON file in local dev. Values are JSON-encoded.
const fs = require("fs");
const path = require("path");
const { fail } = require("./http");

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const REMOTE = !!(URL_ && TOKEN);

/* ---------- remote ---------- */
async function remote(args) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw fail(503, "storage_error", j.error || "Storage request failed");
  return j.result;
}

/* ---------- local (dev only) ---------- */
const FILE = path.join(__dirname, "..", "..", ".data", "db.json");
let mem = null;
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { mem = {}; }
  return mem;
}
function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(mem, null, 1));
}
function local(args) {
  const db = load(), [cmd, key, ...rest] = args, c = String(cmd).toUpperCase();
  switch (c) {
    case "GET": return db[key] === undefined ? null : db[key];
    case "SET": {
      if (rest.includes("NX") && db[key] !== undefined) return null;
      db[key] = rest[0]; save(); return "OK";
    }
    case "DEL": { const had = db[key] !== undefined; delete db[key]; save(); return had ? 1 : 0; }
    case "LPUSH": { db[key] = [...rest.reverse(), ...(db[key] || [])]; save(); return db[key].length; }
    case "LRANGE": { const l = db[key] || [], a = +rest[0], b = +rest[1]; return l.slice(a, b === -1 ? undefined : b + 1); }
    case "LREM": { const l = db[key] || []; db[key] = l.filter((v) => v !== rest[1]); save(); return l.length - db[key].length; }
    case "SADD": { const s = new Set(db[key] || []); rest.forEach((v) => s.add(v)); db[key] = [...s]; save(); return 1; }
    case "SREM": { db[key] = (db[key] || []).filter((v) => !rest.includes(v)); save(); return 1; }
    case "SMEMBERS": return db[key] || [];
    case "MGET": return [key, ...rest].map((k) => (db[k] === undefined ? null : db[k]));
    case "INCR": { db[key] = String((+db[key] || 0) + 1); save(); return +db[key]; }
    case "EXPIRE": return 1;
  }
  throw new Error("Unsupported local command " + c);
}

async function cmd(...args) {
  if (REMOTE) return remote(args);
  if (process.env.VERCEL) throw fail(503, "storage_missing", "Storage isn't connected yet. Add Upstash Redis (Vercel KV) to this project.");
  return local(args.map((a) => (typeof a === "number" ? String(a) : a)));
}

const db = {
  cmd,
  async get(key) { const v = await cmd("GET", key); return v == null ? null : JSON.parse(v); },
  async set(key, val) { return cmd("SET", key, JSON.stringify(val)); },
  async setNX(key, val) { return (await cmd("SET", key, JSON.stringify(val), "NX")) === "OK"; },
  async del(key) { return cmd("DEL", key); },
  async lpush(key, v) { return cmd("LPUSH", key, v); },
  async lrange(key, a = 0, b = -1) { return (await cmd("LRANGE", key, a, b)) || []; },
  async sadd(key, v) { return cmd("SADD", key, v); },
  async srem(key, v) { return cmd("SREM", key, v); },
  async smembers(key) { return (await cmd("SMEMBERS", key)) || []; },
  async mget(keys) { if (!keys.length) return []; return ((await cmd("MGET", ...keys)) || []).map((v) => (v == null ? null : JSON.parse(v))); },
  async incr(key) { return cmd("INCR", key); },
  async expire(key, s) { return cmd("EXPIRE", key, s); },
  remote: REMOTE
};

module.exports = db;

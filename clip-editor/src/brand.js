// VICEFEED brand layer: the watermark every clip needs to earn rewards.
// The watermark is composed once on the main thread into an ImageBitmap,
// then drawn by the same function in preview and in the export worker.

export const BRAND_STYLES = ["badge", "handle", "word", "icon"];
export const BRAND_POSITIONS = ["tl", "tc", "tr", "ml", "bl"];

export const DEFAULT_BRAND = Object.freeze({
  on: true,
  style: "badge",
  handle: "",
  pos: "tl",
  size: 1,
  opacity: 1,
});

// width of the mark as a share of the frame's short edge
const BASE = { badge: 0.4, handle: 0.44, word: 0.5, icon: 0.13 };
// anchor point (x, y) and which corner of the mark sits on it
const ANCHORS = {
  tl: [0.055, 0.05, 0, 0],
  tc: [0.5, 0.05, 0.5, 0],
  tr: [0.945, 0.05, 1, 0],
  ml: [0.055, 0.5, 0, 0.5],
  bl: [0.055, 0.8, 0, 1],
};

export function normalizeBrand(brand) {
  const b = { ...DEFAULT_BRAND, ...(brand && typeof brand === "object" ? brand : {}) };
  b.on = b.on !== false;
  if (!BRAND_STYLES.includes(b.style)) b.style = "badge";
  if (!BRAND_POSITIONS.includes(b.pos)) b.pos = "tl";
  b.size = Math.min(2, Math.max(0.5, Number(b.size) || 1));
  b.opacity = Math.min(1, Math.max(0.3, Number(b.opacity) || 1));
  b.handle = String(b.handle || "").replace(/[^\w.@]/g, "").slice(0, 31);
  if (b.handle && !b.handle.startsWith("@")) b.handle = "@" + b.handle;
  return b;
}

export function brandRect(brand, bitmap, width, height) {
  const w = BASE[brand.style] * brand.size * Math.min(width, height);
  const h = (w * bitmap.height) / bitmap.width;
  const [ax, ay, ox, oy] = ANCHORS[brand.pos] ?? ANCHORS.tl;
  return { x: ax * width - ox * w, y: ay * height - oy * h, w, h };
}

// Safe to call from a worker: only needs a 2D context and a bitmap.
export function drawBrand(ctx, layer, width, height) {
  if (!layer?.bitmap || !layer.brand?.on) return;
  const { x, y, w, h } = brandRect(layer.brand, layer.bitmap, width, height);
  ctx.save();
  ctx.globalAlpha = layer.brand.opacity;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(layer.bitmap, x, y, w, h);
  ctx.restore();
}

/* ---------------- main thread: composing the mark ---------------- */

const ASSET_ROOT = new URL("../assets/", globalThis.location?.href ?? "http://localhost/");
const images = {};
function image(name) {
  images[name] ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Brand asset missing: " + name));
    img.src = new URL(name, ASSET_ROOT).href;
  });
  return images[name];
}

export function profileHandle() {
  try {
    const p = JSON.parse(localStorage.getItem("vf.profile") || "{}");
    return p.handle ? "@" + p.handle : "";
  } catch {
    return "";
  }
}

const cache = new Map();
let listeners = [];
export function onBrandReady(fn) {
  listeners.push(fn);
}

export function composeBrand(brand) {
  const handle = brand.handle || profileHandle() || "@vicefeed";
  const key = brand.style + "|" + handle;
  if (!cache.has(key)) {
    const job = build(brand.style, handle).then((bitmap) => {
      cache.get(key).bitmap = bitmap;
      listeners.forEach((fn) => fn());
      return bitmap;
    });
    cache.set(key, { job, bitmap: null });
  }
  return cache.get(key).job;
}

// For the preview: returns what's ready now and kicks off the rest.
export function brandLayer(brand) {
  const b = normalizeBrand(brand);
  if (!b.on) return { brand: b, bitmap: null };
  const handle = b.handle || profileHandle() || "@vicefeed";
  const entry = cache.get(b.style + "|" + handle);
  if (!entry) composeBrand(b).catch(() => {});
  return { brand: b, bitmap: entry?.bitmap ?? null };
}

async function build(style, handle) {
  const [icon, word] = await Promise.all([image("icon-256.png"), image("wordmark.png")]);
  try { await document.fonts?.load('700 40px "Geist"'); } catch {}
  const H = 220;
  const font = (weight, px) => `${weight} ${px}px "Geist", system-ui, -apple-system, "Segoe UI", sans-serif`;
  const c = document.createElement("canvas");
  const x = c.getContext("2d");

  if (style === "icon") {
    const w = 320, h = (w * icon.height) / icon.width;
    c.width = w + 40; c.height = h + 50;
    x.shadowColor = "rgba(0,0,0,.45)"; x.shadowBlur = 18; x.shadowOffsetY = 8;
    x.drawImage(icon, 20, 14, w, h);
    return createImageBitmap(c);
  }
  if (style === "word") {
    const w = 1100, h = (w * word.height) / word.width;
    c.width = w + 60; c.height = h + 60;
    x.shadowColor = "rgba(0,0,0,.5)"; x.shadowBlur = 24; x.shadowOffsetY = 10;
    x.drawImage(word, 30, 18, w, h);
    return createImageBitmap(c);
  }

  // badge + handle: a dark glass pill with the icon on the left
  const pad = H * 0.16, iconH = H * 0.72, iconW = (iconH * icon.width) / icon.height, gap = H * 0.12;
  let lines;
  if (style === "badge") {
    const wh = H * 0.34, ww = (wh * word.width) / word.height;
    x.font = font(600, H * 0.2);
    lines = { w: Math.max(ww, x.measureText(handle).width), draw(tx) {
      x.drawImage(word, tx, H * 0.2, ww, wh);
      x.font = font(600, H * 0.2); x.fillStyle = "rgba(255,255,255,.88)"; x.textBaseline = "alphabetic";
      x.fillText(handle, tx + 2, H * 0.8);
    } };
  } else {
    x.font = font(800, H * 0.3);
    const tw = x.measureText(handle).width;
    x.font = font(600, H * 0.17);
    lines = { w: Math.max(tw, x.measureText("on VICEFEED").width), draw(tx) {
      x.textBaseline = "alphabetic";
      x.font = font(800, H * 0.3); x.fillStyle = "#ffffff"; x.fillText(handle, tx, H * 0.5);
      x.font = font(600, H * 0.17); x.fillStyle = "#14ecd9"; x.fillText("on VICEFEED", tx + 2, H * 0.76);
    } };
  }
  const W = Math.ceil(pad + iconW + gap + lines.w + pad * 1.3);
  c.width = W + 24; c.height = H + 24;
  x.translate(12, 12);
  // pill
  x.shadowColor = "rgba(0,0,0,.35)"; x.shadowBlur = 16; x.shadowOffsetY = 6;
  x.beginPath(); x.roundRect(0, 0, W, H, H / 2); x.fillStyle = "rgba(10,5,18,.62)"; x.fill();
  x.shadowColor = "transparent";
  x.lineWidth = 3; x.strokeStyle = "rgba(255,255,255,.16)"; x.stroke();
  // subtle top sheen
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(255,255,255,.10)"); g.addColorStop(0.5, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fill();
  x.drawImage(icon, pad, (H - iconH) / 2 - H * 0.02, iconW, iconH);
  lines.draw(pad + iconW + gap);
  return createImageBitmap(c);
}

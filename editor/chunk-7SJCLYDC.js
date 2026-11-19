import {
  DEFAULT_VISUAL,
  clamp,
  fadeGain
} from "./chunk-3PW7KLAI.js";

// src/brand.js
var BRAND_STYLES = ["badge", "handle", "word", "icon"];
var BRAND_POSITIONS = ["tl", "tc", "tr", "ml", "bl"];
var DEFAULT_BRAND = Object.freeze({
  on: true,
  style: "badge",
  handle: "",
  pos: "tl",
  size: 1,
  opacity: 1
});
var BASE = { badge: 0.4, handle: 0.44, word: 0.5, icon: 0.13 };
var ANCHORS = {
  tl: [0.055, 0.05, 0, 0],
  tc: [0.5, 0.05, 0.5, 0],
  tr: [0.945, 0.05, 1, 0],
  ml: [0.055, 0.5, 0, 0.5],
  bl: [0.055, 0.8, 0, 1]
};
function normalizeBrand(brand) {
  const b = { ...DEFAULT_BRAND, ...brand && typeof brand === "object" ? brand : {} };
  b.on = b.on !== false;
  if (!BRAND_STYLES.includes(b.style)) b.style = "badge";
  if (!BRAND_POSITIONS.includes(b.pos)) b.pos = "tl";
  b.size = Math.min(2, Math.max(0.5, Number(b.size) || 1));
  b.opacity = Math.min(1, Math.max(0.3, Number(b.opacity) || 1));
  b.handle = String(b.handle || "").replace(/[^\w.@]/g, "").slice(0, 31);
  if (b.handle && !b.handle.startsWith("@")) b.handle = "@" + b.handle;
  return b;
}
function brandRect(brand, bitmap, width, height) {
  const w = BASE[brand.style] * brand.size * Math.min(width, height);
  const h = w * bitmap.height / bitmap.width;
  const [ax, ay, ox, oy] = ANCHORS[brand.pos] ?? ANCHORS.tl;
  return { x: ax * width - ox * w, y: ay * height - oy * h, w, h };
}
function drawBrand(ctx, layer, width, height) {
  if (!layer?.bitmap || !layer.brand?.on) return;
  const { x, y, w, h } = brandRect(layer.brand, layer.bitmap, width, height);
  ctx.save();
  ctx.globalAlpha = layer.brand.opacity;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(layer.bitmap, x, y, w, h);
  ctx.restore();
}
var ASSET_ROOT = new URL("../assets/", globalThis.location?.href ?? "http://localhost/");
var images = {};
function image(name) {
  images[name] ??= new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Brand asset missing: " + name));
    img.src = new URL(name, ASSET_ROOT).href;
  });
  return images[name];
}
function profileHandle() {
  try {
    const p = JSON.parse(localStorage.getItem("vf.profile") || "{}");
    return p.handle ? "@" + p.handle : "";
  } catch {
    return "";
  }
}
var cache = /* @__PURE__ */ new Map();
var listeners = [];
function onBrandReady(fn) {
  listeners.push(fn);
}
function composeBrand(brand) {
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
function brandLayer(brand) {
  const b = normalizeBrand(brand);
  if (!b.on) return { brand: b, bitmap: null };
  const handle = b.handle || profileHandle() || "@vicefeed";
  const entry = cache.get(b.style + "|" + handle);
  if (!entry) composeBrand(b).catch(() => {
  });
  return { brand: b, bitmap: entry?.bitmap ?? null };
}
async function build(style, handle) {
  const [icon, word] = await Promise.all([image("icon-256.png"), image("wordmark.png")]);
  try {
    await document.fonts?.load('700 40px "Geist"');
  } catch {
  }
  const H = 220;
  const font = (weight, px) => `${weight} ${px}px "Geist", system-ui, -apple-system, "Segoe UI", sans-serif`;
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  if (style === "icon") {
    const w = 320, h = w * icon.height / icon.width;
    c.width = w + 40;
    c.height = h + 50;
    x.shadowColor = "rgba(0,0,0,.45)";
    x.shadowBlur = 18;
    x.shadowOffsetY = 8;
    x.drawImage(icon, 20, 14, w, h);
    return createImageBitmap(c);
  }
  if (style === "word") {
    const w = 1100, h = w * word.height / word.width;
    c.width = w + 60;
    c.height = h + 60;
    x.shadowColor = "rgba(0,0,0,.5)";
    x.shadowBlur = 24;
    x.shadowOffsetY = 10;
    x.drawImage(word, 30, 18, w, h);
    return createImageBitmap(c);
  }
  const pad = H * 0.16, iconH = H * 0.72, iconW = iconH * icon.width / icon.height, gap = H * 0.12;
  let lines;
  if (style === "badge") {
    const wh = H * 0.34, ww = wh * word.width / word.height;
    x.font = font(600, H * 0.2);
    lines = { w: Math.max(ww, x.measureText(handle).width), draw(tx) {
      x.drawImage(word, tx, H * 0.2, ww, wh);
      x.font = font(600, H * 0.2);
      x.fillStyle = "rgba(255,255,255,.88)";
      x.textBaseline = "alphabetic";
      x.fillText(handle, tx + 2, H * 0.8);
    } };
  } else {
    x.font = font(800, H * 0.3);
    const tw = x.measureText(handle).width;
    x.font = font(600, H * 0.17);
    lines = { w: Math.max(tw, x.measureText("on VICEFEED").width), draw(tx) {
      x.textBaseline = "alphabetic";
      x.font = font(800, H * 0.3);
      x.fillStyle = "#ffffff";
      x.fillText(handle, tx, H * 0.5);
      x.font = font(600, H * 0.17);
      x.fillStyle = "#14ecd9";
      x.fillText("on VICEFEED", tx + 2, H * 0.76);
    } };
  }
  const W = Math.ceil(pad + iconW + gap + lines.w + pad * 1.3);
  c.width = W + 24;
  c.height = H + 24;
  x.translate(12, 12);
  x.shadowColor = "rgba(0,0,0,.35)";
  x.shadowBlur = 16;
  x.shadowOffsetY = 6;
  x.beginPath();
  x.roundRect(0, 0, W, H, H / 2);
  x.fillStyle = "rgba(10,5,18,.62)";
  x.fill();
  x.shadowColor = "transparent";
  x.lineWidth = 3;
  x.strokeStyle = "rgba(255,255,255,.16)";
  x.stroke();
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(255,255,255,.10)");
  g.addColorStop(0.5, "rgba(255,255,255,0)");
  x.fillStyle = g;
  x.fill();
  x.drawImage(icon, pad, (H - iconH) / 2 - H * 0.02, iconW, iconH);
  lines.draw(pad + iconW + gap);
  return createImageBitmap(c);
}

// src/render-frame.js
var textFont = (text, size) => text.style === "glossy" ? `900 ${size}px "Arial Black", "Arial", sans-serif` : `bold ${size}px Arial, sans-serif`;
var frames = /* @__PURE__ */ new WeakMap();
function frameGeometry(source, frame, width, height) {
  const sw = source.width;
  const sh = source.height;
  const previous = frames.get(frame);
  if (previous?.sw === sw && previous.sh === sh && previous.width === width && previous.height === height)
    return previous;
  const x = sw * frame.left;
  const y = sh * frame.top;
  const cropWidth = sw * (1 - frame.left - frame.right);
  const cropHeight = sh * (1 - frame.top - frame.bottom);
  const angle = frame.rotation * Math.PI / 180;
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  const scale = frame.zoom * (frame.fit === "fit" ? Math.min(
    width / (cropWidth * cos + cropHeight * sin),
    height / (cropWidth * sin + cropHeight * cos)
  ) : Math.max(
    (width * cos + height * sin) / cropWidth,
    (width * sin + height * cos) / cropHeight
  ));
  const { brightness = 1, contrast = 1, saturation = 1 } = frame;
  const filter = brightness !== 1 || contrast !== 1 || saturation !== 1 ? `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})` : "none";
  const geometry = {
    sw,
    sh,
    width,
    height,
    x,
    y,
    cropWidth,
    cropHeight,
    angle,
    filter,
    dw: cropWidth * scale,
    dh: cropHeight * scale
  };
  frames.set(frame, geometry);
  return geometry;
}
function drawSource(ctx, source, frame, width, height, opacity) {
  const { x, y, cropWidth, cropHeight, angle, filter, dw, dh } = frameGeometry(
    source,
    frame,
    width,
    height
  );
  ctx.save();
  ctx.globalAlpha = opacity;
  if (filter !== "none") ctx.filter = filter;
  ctx.translate(width * (0.5 + frame.x), height * (0.5 + frame.y));
  ctx.rotate(angle);
  if (frame.flipX || frame.flipY)
    ctx.scale(frame.flipX ? -1 : 1, frame.flipY ? -1 : 1);
  source.draw(ctx, x, y, cropWidth, cropHeight, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}
function wrapText(ctx, value, limit) {
  return value.split("\n").flatMap((paragraph) => {
    const lines = [];
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= limit) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (line && ctx.measureText(line + character).width > limit) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    lines.push(line);
    return lines;
  });
}
var textCache = /* @__PURE__ */ new WeakMap();
function textLayout(ctx, text, width, height) {
  const size = text.size * Math.min(width, height);
  ctx.font = textFont(text, size);
  ctx.textAlign = text.align;
  ctx.textBaseline = "middle";
  const x = text.x * width;
  const y = text.y * height;
  const padding = size * 0.26;
  let metrics = textCache.get(text);
  if (metrics?.width !== width || metrics?.height !== height) {
    const lines2 = wrapText(ctx, text.value, width * 0.86);
    const lineHeight2 = size * 1.2;
    const boxWidth2 = Math.max(...lines2.map((line) => ctx.measureText(line).width)) + padding * 2;
    metrics = {
      width,
      height,
      lines: lines2,
      lineHeight: lineHeight2,
      boxWidth: boxWidth2,
      boxHeight: lines2.length * lineHeight2 + padding * 2
    };
    textCache.set(text, metrics);
  }
  const { lines, lineHeight, boxWidth, boxHeight } = metrics;
  const left = text.align === "left" ? x - padding : text.align === "right" ? x - boxWidth + padding : x - boxWidth / 2;
  return {
    size,
    x,
    y,
    left,
    top: y - boxHeight / 2,
    lines,
    lineHeight,
    boxWidth,
    boxHeight
  };
}
function activeText(texts, time) {
  return texts.filter(
    (text) => time >= text.start && time < text.end && text.value.trim()
  );
}
function hitText(ctx, texts, time, x, y, size = ctx.canvas) {
  return activeText(texts, time).reverse().find((text) => {
    const { left, top, boxWidth, boxHeight } = textLayout(
      ctx,
      text,
      size.width,
      size.height
    );
    return x >= left && x <= left + boxWidth && y >= top && y <= top + boxHeight;
  });
}
function drawFrame(ctx, source, span, texts, time, { width, height } = ctx.canvas, brand) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  if (source && span) {
    const opacity = fadeGain(
      span.clip.visual ?? DEFAULT_VISUAL,
      time - span.start,
      span.end - span.start
    );
    if (opacity > 0)
      drawSource(ctx, source, span.clip.frame, width, height, opacity);
  }
  for (const text of activeText(texts, time)) {
    const { size, x, y, left, top, lines, lineHeight, boxWidth, boxHeight } = textLayout(ctx, text, width, height);
    if (text.style === "background") {
      ctx.fillStyle = "rgba(0,0,0,0.76)";
      ctx.fillRect(left, top, boxWidth, boxHeight);
    }
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = clamp(size * 0.13, 1, 24);
    ctx.lineJoin = "round";
    if (text.style === "glossy") {
      const depth = Math.max(3, size * 0.14);
      const steps = Math.max(4, Math.round(depth / 1.5));
      lines.forEach((line, index) => {
        const lineY = y + (index - (lines.length - 1) / 2) * lineHeight;
        ctx.save();
        ctx.shadowColor = "rgba(20, 0, 20, 0.55)";
        ctx.shadowBlur = size * 0.25;
        ctx.shadowOffsetY = size * 0.08;
        ctx.fillStyle = "#8a0044";
        ctx.fillText(line, x, lineY + depth);
        ctx.restore();
        for (let i = steps; i >= 1; i--) {
          const off = depth * i / steps;
          ctx.fillStyle = i > steps * 0.6 ? "#c8006a" : i > steps * 0.25 ? "#f0007f" : "#ff3d9d";
          ctx.fillText(line, x, lineY + off);
        }
        ctx.fillStyle = text.color;
        ctx.fillText(line, x, lineY);
      });
      continue;
    }
    ctx.fillStyle = text.color;
    lines.forEach((line, index) => {
      const lineY = y + (index - (lines.length - 1) / 2) * lineHeight;
      if (text.style === "outline") ctx.strokeText(line, x, lineY);
      ctx.fillText(line, x, lineY);
    });
  }
  drawBrand(ctx, brand, width, height);
}
var sampleSource = (sample) => sample && {
  width: sample.displayWidth,
  height: sample.displayHeight,
  draw: (ctx, ...rect) => sample.draw(ctx, ...rect)
};
var videoSource = (video) => ({
  get width() {
    return video.videoWidth;
  },
  get height() {
    return video.videoHeight;
  },
  draw: (ctx, ...rect) => ctx.drawImage(video, ...rect)
});

export {
  normalizeBrand,
  profileHandle,
  onBrandReady,
  composeBrand,
  brandLayer,
  hitText,
  drawFrame,
  sampleSource,
  videoSource
};

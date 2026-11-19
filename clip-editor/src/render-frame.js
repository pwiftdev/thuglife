import { DEFAULT_VISUAL, clamp, fadeGain } from "./project.js";
import { drawBrand } from "./brand.js";

const textFont = (text, size) =>
  text.style === "glossy"
    ? `900 ${size}px "Arial Black", "Arial", sans-serif`
    : `bold ${size}px Arial, sans-serif`;

const frames = new WeakMap();

function frameGeometry(source, frame, width, height) {
  const sw = source.width;
  const sh = source.height;
  const previous = frames.get(frame);
  if (
    previous?.sw === sw &&
    previous.sh === sh &&
    previous.width === width &&
    previous.height === height
  )
    return previous;
  const x = sw * frame.left;
  const y = sh * frame.top;
  const cropWidth = sw * (1 - frame.left - frame.right);
  const cropHeight = sh * (1 - frame.top - frame.bottom);
  const angle = (frame.rotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  const scale =
    frame.zoom *
    (frame.fit === "fit"
      ? Math.min(
          width / (cropWidth * cos + cropHeight * sin),
          height / (cropWidth * sin + cropHeight * cos),
        )
      : Math.max(
          (width * cos + height * sin) / cropWidth,
          (width * sin + height * cos) / cropHeight,
        ));
  const { brightness = 1, contrast = 1, saturation = 1 } = frame;
  const filter =
    brightness !== 1 || contrast !== 1 || saturation !== 1
      ? `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`
      : "none";
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
    dh: cropHeight * scale,
  };
  frames.set(frame, geometry);
  return geometry;
}

function drawSource(ctx, source, frame, width, height, opacity) {
  const { x, y, cropWidth, cropHeight, angle, filter, dw, dh } = frameGeometry(
    source,
    frame,
    width,
    height,
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

const textCache = new WeakMap();

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
    const lines = wrapText(ctx, text.value, width * 0.86);
    const lineHeight = size * 1.2;
    const boxWidth =
      Math.max(...lines.map((line) => ctx.measureText(line).width)) +
      padding * 2;
    metrics = {
      width,
      height,
      lines,
      lineHeight,
      boxWidth,
      boxHeight: lines.length * lineHeight + padding * 2,
    };
    textCache.set(text, metrics);
  }
  const { lines, lineHeight, boxWidth, boxHeight } = metrics;
  const left =
    text.align === "left"
      ? x - padding
      : text.align === "right"
        ? x - boxWidth + padding
        : x - boxWidth / 2;
  return {
    size,
    x,
    y,
    left,
    top: y - boxHeight / 2,
    lines,
    lineHeight,
    boxWidth,
    boxHeight,
  };
}

export function activeText(texts, time) {
  return texts.filter(
    (text) => time >= text.start && time < text.end && text.value.trim(),
  );
}

export function hitText(ctx, texts, time, x, y, size = ctx.canvas) {
  return activeText(texts, time)
    .reverse()
    .find((text) => {
      const { left, top, boxWidth, boxHeight } = textLayout(
        ctx,
        text,
        size.width,
        size.height,
      );
      return (
        x >= left && x <= left + boxWidth && y >= top && y <= top + boxHeight
      );
    });
}

export function drawFrame(
  ctx,
  source,
  span,
  texts,
  time,
  { width, height } = ctx.canvas,
  brand,
) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  if (source && span) {
    const opacity = fadeGain(
      span.clip.visual ?? DEFAULT_VISUAL,
      time - span.start,
      span.end - span.start,
    );
    if (opacity > 0)
      drawSource(ctx, source, span.clip.frame, width, height, opacity);
  }
  for (const text of activeText(texts, time)) {
    const { size, x, y, left, top, lines, lineHeight, boxWidth, boxHeight } =
      textLayout(ctx, text, width, height);
    if (text.style === "background") {
      ctx.fillStyle = "rgba(0,0,0,0.76)";
      ctx.fillRect(left, top, boxWidth, boxHeight);
    }
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = clamp(size * 0.13, 1, 24);
    ctx.lineJoin = "round";
    if (text.style === "glossy") {
      // VICEFEED candy type, like the wordmark: cream face on a hot-pink 3D extrusion
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
          const off = (depth * i) / steps;
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

export const sampleSource = (sample) =>
  sample && {
    width: sample.displayWidth,
    height: sample.displayHeight,
    draw: (ctx, ...rect) => sample.draw(ctx, ...rect),
  };

export const videoSource = (video) => ({
  get width() {
    return video.videoWidth;
  },
  get height() {
    return video.videoHeight;
  },
  draw: (ctx, ...rect) => ctx.drawImage(video, ...rect),
});

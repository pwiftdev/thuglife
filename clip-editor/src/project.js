export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
export const id = () => crypto.randomUUID();
export const EPSILON = 0.000001;
export const MIN_CLIP = 0.01;
export const DEFAULT_VISUAL = Object.freeze({ fadeIn: 0, fadeOut: 0 });
export const clipDuration = (clip) => (clip.out - clip.in) / clip.speed;
export const audioDuration = (track) =>
  (track.out - track.in) / (track.speed ?? 1);

export function newProject() {
  return {
    version: 2,
    assets: [],
    clips: [],
    texts: [],
    audioTracks: [],
    range: null,
    brand: { on: true, style: "badge", handle: "", pos: "tl", size: 1, opacity: 1 },
    settings: {
      aspect: "9:16",
      width: 1080,
      height: 1920,
      resolution: "source",
      fps: 30,
      quality: "standard",
      format: "mp4",
    },
  };
}

export function newClip(asset) {
  return {
    id: id(),
    assetId: asset.id,
    in: 0,
    out: asset.duration,
    speed: 1,
    volume: 1,
    mute: false,
    fadeIn: 0,
    fadeOut: 0,
    frame: {
      fit: "fill",
      x: 0,
      y: 0,
      zoom: 1,
      rotation: 0,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
  };
}

export function timeline(clips) {
  let start = 0;
  return clips.map((clip) => {
    const span = { clip, start, end: start + clipDuration(clip) };
    start = span.end;
    return span;
  });
}

export const durationOf = (spans) => spans.at(-1)?.end ?? 0;

export function locate(spans, time) {
  if (!spans.length) return null;
  let low = 0;
  let high = spans.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (time < spans[middle].end) high = middle;
    else low = middle + 1;
  }
  const span = spans[low];
  return { ...span, sourceTime: sourceTimeAt(span, time) };
}

export function sourceTimeAt({ clip, start }, time) {
  return clamp(
    clip.in + (time - start) * clip.speed,
    clip.in,
    Math.max(clip.in, clip.out - EPSILON),
  );
}

export function canSplit(span, time) {
  return Boolean(
    span &&
    (time - span.start) * span.clip.speed >= MIN_CLIP &&
    (span.end - time) * span.clip.speed >= MIN_CLIP,
  );
}

export function splitEnvelope(item, duration, offset) {
  if (!item.fadeIn && !item.fadeOut) return [undefined, undefined];
  const left = item.envelope ?? { offset: 0, length: duration };
  return [left, { ...left, offset: left.offset + offset }];
}

export function splitClip(project, span, time) {
  if (!canSplit(span, time)) return null;
  const cut = sourceTimeAt(span, time);
  const { clip, start } = span;
  const duration = clipDuration(clip);
  const [leftFade, rightFade] = splitEnvelope(clip, duration, time - start);
  const visual = clip.visual ?? DEFAULT_VISUAL;
  const [leftVisual, rightVisual] = splitEnvelope(
    visual,
    duration,
    time - start,
  );
  const left = {
    ...clip,
    out: cut,
    envelope: leftFade,
    visual: { ...visual, envelope: leftVisual },
  };
  const right = {
    ...clip,
    id: id(),
    in: cut,
    envelope: rightFade,
    visual: { ...visual, envelope: rightVisual },
  };
  const clips = project.clips.flatMap((item) =>
    item.id === clip.id ? [left, right] : [item],
  );
  return { project: { ...project, clips }, id: right.id };
}

export function moveClip(clips, clipId, targetIndex) {
  const index = clips.findIndex((clip) => clip.id === clipId);
  if (
    index < 0 ||
    targetIndex < 0 ||
    targetIndex >= clips.length ||
    index === targetIndex
  )
    return clips;
  const result = [...clips];
  const [clip] = result.splice(index, 1);
  result.splice(targetIndex, 0, clip);
  return result;
}

const even = (value) => 2 * Math.round(clamp(value, 2, 3840) / 2);
const ratios = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };

export function outputSize(project) {
  const { aspect, width, height, resolution } = project.settings;
  const source = project.assets.find(
    (asset) => asset.id === project.clips[0]?.assetId,
  );
  if (aspect === "custom") return { width: even(width), height: even(height) };
  const baseWidth = source?.width ?? 1920;
  const baseHeight = source?.height ?? 1080;
  const ratio = ratios[aspect] ?? baseWidth / baseHeight;
  const shortEdge =
    resolution === "source"
      ? Math.min(baseWidth, baseHeight)
      : Number(resolution);
  const w = shortEdge * Math.max(1, ratio);
  const h = shortEdge * Math.max(1, 1 / ratio);
  const scale = Math.min(1, 3840 / Math.max(w, h));
  return { width: even(w * scale), height: even(h * scale) };
}

export function fadeGain(track, time, length) {
  if (!track.fadeIn && !track.fadeOut) return 1;
  time += track.envelope?.offset ?? 0;
  length = track.envelope?.length ?? length;
  return Math.min(
    track.fadeIn > 0 ? clamp(time / track.fadeIn, 0, 1) : 1,
    track.fadeOut > 0 ? clamp((length - time) / track.fadeOut, 0, 1) : 1,
  );
}

export function timecode(seconds) {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const hours = Math.floor(ms / 3600000);
  const minutes = String(Math.floor(ms / 60000) % 60).padStart(2, "0");
  const remainder = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${hours ? hours + ":" : ""}${minutes}:${remainder}.${String(ms % 1000).padStart(3, "0")}`;
}

export function exportRange(project, spans) {
  const length = durationOf(spans);
  const end = clamp(project.range?.end ?? length, 0, length);
  const start = clamp(project.range?.start ?? 0, 0, end);
  return { start, end, duration: end - start };
}

export function intersects(start, end, range) {
  return end > range.start && start < range.end;
}

export function audibleTracks(project, spans, range) {
  const audioIds = new Set(
    project.assets.filter(({ audioCodec }) => audioCodec).map(({ id }) => id),
  );
  const clips = spans.filter(
    ({ clip, start, end }) =>
      !clip.mute &&
      clip.volume > 0 &&
      audioIds.has(clip.assetId) &&
      intersects(start, end, range),
  );
  const tracks = project.audioTracks.filter(
    (track) =>
      !track.mute &&
      track.volume > 0 &&
      intersects(track.start, track.start + audioDuration(track), range),
  );
  return { clips, tracks, enabled: clips.length > 0 || tracks.length > 0 };
}

export function requiredAssets(project, spans = timeline(project.clips)) {
  const range = exportRange(project, spans);
  const assets = new Set();
  for (const { clip, start, end } of spans) {
    if (intersects(start, end, range)) assets.add(clip.assetId);
  }
  for (const track of project.audioTracks) {
    if (
      !track.mute &&
      track.volume > 0 &&
      intersects(track.start, track.start + audioDuration(track), range)
    )
      assets.add(track.assetId);
  }
  return assets;
}

export function history(initial) {
  const past = [];
  const future = [];
  let current = initial;
  return {
    get current() {
      return current;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    set(next) {
      if (next === current) return;
      past.push(current);
      if (past.length > 80) past.shift();
      future.length = 0;
      current = next;
    },
    undo() {
      if (!past.length) return;
      future.push(current);
      current = past.pop();
    },
    redo() {
      if (!future.length) return;
      past.push(current);
      current = future.pop();
    },
  };
}

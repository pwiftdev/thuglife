import {
  audioDuration,
  clamp,
  id,
  MIN_CLIP,
  splitClip,
  splitEnvelope,
} from "./project.js";

const lists = { clip: "clips", text: "texts", audio: "audioTracks" };
const timedDuration = (kind, item) =>
  kind === "text" ? item.end - item.start : audioDuration(item);

export function editorItem(project, kind, id) {
  return project[lists[kind]]?.find((item) => item.id === id);
}

export function editItem(project, kind, id, update) {
  const key = lists[kind];
  return {
    ...project,
    [key]: project[key].map((item) =>
      item.id === id ? { ...item, ...update } : item,
    ),
  };
}

export function deleteItem(project, kind, id) {
  const key = lists[kind];
  return { ...project, [key]: project[key].filter((item) => item.id !== id) };
}

function insert(project, kind, item, index) {
  const key = lists[kind];
  return {
    project: { ...project, [key]: project[key].toSpliced(index, 0, item) },
    selection: { kind, id: item.id },
  };
}

export function pasteItem(project, spans, { kind, item }, time, afterId) {
  if (
    kind !== "text" &&
    !project.assets.some((asset) => asset.id === item.assetId)
  )
    return null;
  const next = { ...item, id: id() };
  if (kind !== "clip") {
    next.start = time;
    if (kind === "text") next.end = time + timedDuration(kind, item);
    return {
      ...insert(project, kind, next, project[lists[kind]].length),
      time,
    };
  }
  if (afterId) {
    const after = spans.findIndex(({ clip }) => clip.id === afterId);
    return {
      ...insert(project, kind, next, after + 1),
      time: spans[after]?.end ?? 0,
    };
  }
  const index = spans.findIndex(({ end }) => time < end);
  if (index < 0)
    return {
      ...insert(project, kind, next, spans.length),
      time: spans.at(-1)?.end ?? 0,
    };
  const span = spans[index];
  const split = splitClip(project, span, time);
  if (split) return { ...insert(split.project, kind, next, index + 1), time };
  const start = time - span.start <= span.end - time;
  return {
    ...insert(project, kind, next, start ? index : index + 1),
    time: start ? span.start : span.end,
  };
}

export function canSplitTimed(kind, item, time) {
  if (!item || kind === "clip") return false;
  const min = MIN_CLIP / (item.speed ?? 1);
  return (
    time - item.start >= min &&
    item.start + timedDuration(kind, item) - time >= min
  );
}

export function splitTimed(project, { kind, item }, time) {
  if (!canSplitTimed(kind, item, time)) return null;
  let left;
  let right;
  if (kind === "text") {
    left = { end: time };
    right = { ...item, start: time, id: id() };
  } else {
    const offset = time - item.start;
    const cut = item.in + offset * (item.speed ?? 1);
    const [leftFade, rightFade] = splitEnvelope(
      item,
      audioDuration(item),
      offset,
    );
    left = { out: cut, envelope: leftFade };
    right = { ...item, start: time, in: cut, id: id(), envelope: rightFade };
  }
  const index = project[lists[kind]].indexOf(item) + 1;
  return insert(editItem(project, kind, item.id, left), kind, right, index);
}

export function detachAudio(project, span) {
  const { clip, start } = span;
  const track = {
    id: id(),
    assetId: clip.assetId,
    in: clip.in,
    out: clip.out,
    speed: clip.speed,
    start,
    volume: clip.mute ? 0 : clip.volume,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut,
    envelope: clip.envelope,
  };
  return insert(
    editItem(project, "clip", clip.id, { mute: true }),
    "audio",
    track,
    project.audioTracks.length,
  );
}

export function timelineEdit({
  kind,
  item,
  edge,
  delta,
  sourceDuration,
  timelineDuration,
}) {
  if (edge === "move") {
    const start = clamp(
      item.start + delta,
      0,
      Math.max(timelineDuration, item.start),
    );
    if (kind === "text") return { start, end: start + (item.end - item.start) };
    return { start };
  }
  if (kind === "text") {
    return edge === "start"
      ? {
          start: clamp(item.start + delta, 0, Math.max(0, item.end - MIN_CLIP)),
        }
      : {
          end: clamp(
            item.end + delta,
            item.start + MIN_CLIP,
            Math.max(item.end, item.start + MIN_CLIP, timelineDuration),
          ),
        };
  }
  const speed = item.speed ?? 1;
  const minimum = Math.min(MIN_CLIP, sourceDuration);
  if (edge === "end")
    return {
      out: clamp(item.out + delta * speed, item.in + minimum, sourceDuration),
      envelope: undefined,
    };
  const lower =
    kind === "audio" ? Math.max(0, item.in - item.start * speed) : 0;
  const start = clamp(item.in + delta * speed, lower, item.out - minimum);
  return kind === "audio"
    ? {
        in: start,
        start: item.start + (start - item.in) / speed,
        envelope: undefined,
      }
    : { in: start, envelope: undefined };
}

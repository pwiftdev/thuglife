import { normalizeBrand } from "./brand.js";
import { newProject } from "./project.js";

const KEY = "clip-editor.project.v1";
const validId = (value) => typeof value === "string" && value.length > 0;
const between = (value, min, max = Infinity) =>
  Number.isFinite(value) && value >= min && value <= max;
const oneOf = (value, options) => options.includes(value);
const nonNegative = (value) => between(value, 0);
const validEnvelope = (value) =>
  !value || (nonNegative(value.offset) && between(value.length, value.offset));
const validFade = (item) =>
  nonNegative(item.fadeIn) &&
  nonNegative(item.fadeOut) &&
  validEnvelope(item.envelope);

function migrate(project) {
  if (project?.version !== 1) return project;
  const { audio, ...rest } = project;
  return {
    ...rest,
    version: 2,
    range: null,
    clips: rest.clips.map((clip) => ({ fadeIn: 0, fadeOut: 0, ...clip })),
    audioTracks: audio ? [{ speed: 1, ...audio }] : [],
  };
}

function validAsset(asset) {
  return (
    validId(asset?.id) &&
    validId(asset.name) &&
    nonNegative(asset.size) &&
    Number.isFinite(asset.origin) &&
    between(asset.duration, Number.MIN_VALUE) &&
    (asset.kind === "video"
      ? between(asset.width, 1) && between(asset.height, 1)
      : asset.kind === "audio" && validId(asset.audioCodec))
  );
}

function validFrame(frame) {
  return (
    frame &&
    oneOf(frame.fit, ["fit", "fill"]) &&
    between(frame.zoom, 0.25, 5) &&
    between(frame.rotation, -180, 180) &&
    between(frame.x, -1, 1) &&
    between(frame.y, -1, 1) &&
    ["left", "right", "top", "bottom"].every((edge) =>
      nonNegative(frame[edge]),
    ) &&
    ["brightness", "contrast", "saturation"].every(
      (key) => frame[key] === undefined || between(frame[key], 0, 2),
    ) &&
    ["flipX", "flipY"].every(
      (key) => frame[key] === undefined || typeof frame[key] === "boolean",
    ) &&
    frame.left + frame.right < 1 &&
    frame.top + frame.bottom < 1
  );
}

function validMediaItem(item, asset) {
  return (
    asset &&
    validId(item.id) &&
    nonNegative(item.in) &&
    item.in < item.out &&
    between(item.out, 0, asset.duration + 0.000001) &&
    between(item.speed, 0.5, 2) &&
    between(item.volume, 0, 1) &&
    validFade(item)
  );
}

function validText(text) {
  return (
    validId(text?.id) &&
    typeof text.value === "string" &&
    text.value.length <= 500 &&
    nonNegative(text.start) &&
    text.end > text.start &&
    Number.isFinite(text.end) &&
    between(text.x, 0, 1) &&
    between(text.y, 0, 1) &&
    between(text.size, 0.015, 0.4) &&
    /^#[0-9a-f]{6}$/i.test(text.color) &&
    oneOf(text.align, ["left", "center", "right"]) &&
    oneOf(text.style, ["plain", "outline", "background", "glossy"])
  );
}

function validSettings(settings) {
  return (
    settings &&
    oneOf(settings.aspect, [
      "original",
      "16:9",
      "9:16",
      "1:1",
      "4:5",
      "custom",
    ]) &&
    between(settings.width, 2, 3840) &&
    between(settings.height, 2, 3840) &&
    oneOf(settings.resolution, [
      "source",
      "480",
      "720",
      "1080",
      "1440",
      "2160",
    ]) &&
    oneOf(settings.fps, [24, 30, 60]) &&
    oneOf(settings.quality, ["small", "standard", "high"]) &&
    oneOf(settings.format, ["mp4", "webm"])
  );
}

export function deserializeProject(raw) {
  const project = migrate(JSON.parse(raw));
  if (
    project?.version !== 2 ||
    ![project.assets, project.clips, project.texts, project.audioTracks].every(
      Array.isArray,
    ) ||
    !validSettings(project.settings) ||
    !project.assets.every(validAsset) ||
    !project.texts.every(validText)
  ) {
    throw new Error("Invalid project");
  }
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const ids = [
    ...assets.keys(),
    ...[...project.clips, ...project.texts, ...project.audioTracks].map(
      (item) => item?.id,
    ),
  ];
  const range = project.range;
  if (
    assets.size !== project.assets.length ||
    new Set(ids).size !== ids.length ||
    (range &&
      (!nonNegative(range.start) ||
        (range.end !== null && !between(range.end, range.start)))) ||
    !project.clips.every((clip) => {
      const asset = assets.get(clip?.assetId);
      return (
        asset?.kind === "video" &&
        validMediaItem(clip, asset) &&
        typeof clip.mute === "boolean" &&
        validFrame(clip.frame)
      );
    }) ||
    !project.audioTracks.every((track) => {
      const asset = assets.get(track?.assetId);
      return (
        asset?.audioCodec &&
        validMediaItem(track, asset) &&
        nonNegative(track.start)
      );
    })
  ) {
    throw new Error("Invalid project");
  }
  project.brand = normalizeBrand(project.brand);
  return project;
}

export function loadProject(onError) {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? deserializeProject(raw) : newProject();
  } catch (error) {
    onError(
      error.name === "SecurityError"
        ? "Browser storage is unavailable. Project edits will only last in this tab."
        : "The saved project could not be read. New edits will start a fresh project.",
    );
    return newProject();
  }
}

export function saveProject(project, setStatus) {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
    setStatus("Saved on this device");
  } catch (error) {
    setStatus(
      error.name === "QuotaExceededError"
        ? "Storage is full. Edits are unsaved."
        : "Local save unavailable. Edits are unsaved.",
    );
  }
}

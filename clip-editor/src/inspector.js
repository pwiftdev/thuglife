import { byId, choice, fields, node, number } from "./fields.js";
import {
  audioDuration,
  clamp,
  clipDuration,
  DEFAULT_VISUAL,
  durationOf,
  MIN_CLIP,
  outputSize,
  timecode,
} from "./project.js";

const presets = [
  ["original", "Original"],
  ["16:9", "16:9 landscape"],
  ["9:16", "9:16 vertical"],
  ["1:1", "1:1 square"],
  ["4:5", "4:5 portrait"],
  ["custom", "Custom size"],
];
const frameRoot = byId("frame-controls");
const root = byId("inspector-controls");
const groups = new Map();
let activeKind;

function group(key, heading) {
  if (groups.has(key)) return groups.get(key);
  const section = node("section", "property-group");
  const title = node("h3", "", heading);
  const body = node("div", "field-grid");
  section.append(title, body);
  root.append(section);
  const result = { section, title, body };
  groups.set(key, result);
  return result;
}

function percent(key, label, value, change, min = 0, max = 1) {
  return number(
    key,
    label,
    value * 100,
    (next) => change(clamp(next / 100, min, max)),
    min * 100,
    max * 100,
    1,
  );
}

function fadeFields(item, duration, apply, label = "Fade", prefix = "") {
  return ["fadeIn", "fadeOut"].map((key, index) =>
    number(
      prefix + key,
      `${label} ${index ? "out" : "in"} (s)`,
      item[key],
      (value) => apply(key)(clamp(value, 0, duration)),
      0,
      Math.max(duration, item[key]),
    ),
  );
}

function speedField(speed, apply) {
  return number(
    "speed",
    "Speed (×)",
    speed,
    (value) => apply("speed")(clamp(value, 0.5, 2)),
    0.5,
    2,
    0.01,
  );
}

function showClip(clip, asset, actions) {
  const trim = group("trim", asset.name);
  trim.title.textContent = asset.name;
  const min = Math.min(MIN_CLIP, asset.duration);
  const apply = (key) => (value) => actions.update({ [key]: value });
  fields(trim.body, [
    number(
      "in",
      "Source in (s)",
      clip.in,
      (value) => apply("in")(clamp(value, 0, clip.out - min)),
      0,
      clip.out - min,
    ),
    number(
      "out",
      "Source out (s)",
      clip.out,
      (value) => apply("out")(clamp(value, clip.in + min, asset.duration)),
      clip.in + min,
      asset.duration,
    ),
    speedField(clip.speed, apply),
    percent("volume", "Source volume (%)", clip.volume, apply("volume")),
    ...(asset.audioCodec ? fadeFields(clip, clipDuration(clip), apply) : []),
    {
      key: "mute",
      label: "Mute source",
      value: clip.mute,
      change: apply("mute"),
      type: "checkbox",
      wide: true,
    },
  ]);
  if (!trim.length) {
    trim.length = node("p", "muted");
    trim.section.append(trim.length);
  }
  trim.length.textContent = `Clip length ${timecode(clipDuration(clip))}`;
  const frame = clip.frame;
  const adjust = (key) => (value) =>
    actions.update({ frame: { ...frame, [key]: value } });
  fields(group("framing", "Framing").body, [
    choice("fit", "Scale", frame.fit, adjust("fit"), [
      ["fit", "Fit"],
      ["fill", "Fill"],
    ]),
    percent("zoom", "Zoom (%)", frame.zoom, adjust("zoom"), 0.25, 5),
    percent("x", "Position X (%)", frame.x, adjust("x"), -1, 1),
    percent("y", "Position Y (%)", frame.y, adjust("y"), -1, 1),
    number(
      "rotation",
      "Rotation (°)",
      frame.rotation,
      (value) => adjust("rotation")(clamp(value, -180, 180)),
      -180,
      180,
      1,
    ),
    ...[
      ["left", "right"],
      ["right", "left"],
      ["top", "bottom"],
      ["bottom", "top"],
    ].map(([edge, other]) =>
      percent(
        edge,
        `Crop ${edge} (%)`,
        frame[edge],
        adjust(edge),
        0,
        0.95 - frame[other],
      ),
    ),
  ]);
  const visual = clip.visual ?? DEFAULT_VISUAL;
  const visualChange = (key) => (value) =>
    actions.update({
      visual: { ...visual, [key]: value, envelope: undefined },
    });
  fields(group("appearance", "Appearance").body, [
    ...fadeFields(
      visual,
      clipDuration(clip),
      visualChange,
      "Video fade",
      "video-",
    ),
    percent(
      "brightness",
      "Brightness (%)",
      frame.brightness ?? 1,
      adjust("brightness"),
      0,
      2,
    ),
    percent(
      "contrast",
      "Contrast (%)",
      frame.contrast ?? 1,
      adjust("contrast"),
      0,
      2,
    ),
    percent(
      "saturation",
      "Saturation (%)",
      frame.saturation ?? 1,
      adjust("saturation"),
      0,
      2,
    ),
    {
      key: "flipX",
      label: "Flip horizontal",
      value: Boolean(frame.flipX),
      type: "checkbox",
      change: adjust("flipX"),
      wide: true,
    },
    {
      key: "flipY",
      label: "Flip vertical",
      value: Boolean(frame.flipY),
      type: "checkbox",
      change: adjust("flipY"),
      wide: true,
    },
  ]);
}

function showText(text, length, actions) {
  const apply = (key) => (value) => actions.update({ [key]: value });
  fields(group("text", "Text overlay").body, [
    {
      key: "value",
      label: "Text",
      value: text.value,
      change: apply("value"),
      type: "textarea",
      rows: 3,
      maxLength: 500,
    },
    number(
      "start",
      "Start (s)",
      text.start,
      (value) =>
        apply("start")(clamp(value, 0, Math.max(0, text.end - MIN_CLIP))),
      0,
      Math.max(0, text.end - MIN_CLIP),
    ),
    number(
      "end",
      "End (s)",
      text.end,
      (value) =>
        apply("end")(
          clamp(
            value,
            text.start + MIN_CLIP,
            Math.max(length, text.start + MIN_CLIP),
          ),
        ),
      text.start + MIN_CLIP,
      Math.max(length, text.end),
    ),
    percent("x", "Position X (%)", text.x, apply("x")),
    percent("y", "Position Y (%)", text.y, apply("y")),
    percent("size", "Size (%)", text.size, apply("size"), 0.015, 0.4),
    {
      key: "color",
      label: "Color",
      value: text.color,
      change: apply("color"),
      type: "color",
    },
    choice("align", "Alignment", text.align, apply("align"), [
      ["left", "Left"],
      ["center", "Center"],
      ["right", "Right"],
    ]),
    choice("style", "Style", text.style, apply("style"), [
      ["glossy", "Glossy 3D"],
      ["outline", "Outline"],
      ["background", "Background"],
      ["plain", "Plain"],
    ]),
  ]);
}

function showAudio(audio, asset, length, actions) {
  const groupAudio = group("audio", asset.name);
  groupAudio.title.textContent = asset.name;
  const apply = (key) => (value) => actions.update({ [key]: value });
  const min = Math.min(MIN_CLIP, asset.duration);
  const maxStart = Math.max(length, 0);
  const duration = audioDuration(audio);
  fields(groupAudio.body, [
    number(
      "start",
      "Timeline start (s)",
      audio.start,
      (value) => apply("start")(clamp(value, 0, maxStart)),
      0,
      Math.max(maxStart, audio.start),
    ),
    percent("volume", "Track volume (%)", audio.volume, apply("volume")),
    speedField(audio.speed, apply),
    number(
      "in",
      "Source in (s)",
      audio.in,
      (value) => apply("in")(clamp(value, 0, audio.out - min)),
      0,
      audio.out - min,
    ),
    number(
      "out",
      "Source out (s)",
      audio.out,
      (value) => apply("out")(clamp(value, audio.in + min, asset.duration)),
      audio.in + min,
      asset.duration,
    ),
    {
      key: "mute",
      label: "Mute track",
      value: Boolean(audio.mute),
      change: apply("mute"),
      type: "checkbox",
      wide: true,
    },
    ...fadeFields(audio, duration, apply),
  ]);
}

export function renderInspector(project, spans, selected, actions) {
  const { settings } = project;
  const size = outputSize(project);
  fields(frameRoot, [
    {
      ...choice(
        "aspect",
        "Output frame",
        settings.aspect,
        (aspect) =>
          actions.settings(
            aspect === "custom" ? { aspect, ...size } : { aspect },
          ),
        presets,
      ),
      wide: true,
    },
    ...(settings.aspect === "custom"
      ? [
          number(
            "width",
            "Width (px)",
            settings.width,
            (width) =>
              actions.settings({
                width: 2 * Math.round(clamp(width, 2, 3840) / 2),
              }),
            2,
            3840,
            2,
          ),
          number(
            "height",
            "Height (px)",
            settings.height,
            (height) =>
              actions.settings({
                height: 2 * Math.round(clamp(height, 2, 3840) / 2),
              }),
            2,
            3840,
            2,
          ),
        ]
      : []),
  ]);

  const kind = selected?.kind ?? "none";
  if (activeKind !== kind) {
    activeKind = kind;
    root.replaceChildren();
    groups.clear();
    if (kind === "none")
      root.append(
        node(
          "p",
          "muted",
          "Select a clip, text overlay or audio track to edit it.",
        ),
      );
  }
  const item = selected?.item;
  const asset = project.assets.find(({ id }) => id === item?.assetId);
  if (kind === "clip") showClip(item, asset, actions);
  if (kind === "text") showText(item, durationOf(spans), actions);
  if (kind === "audio") showAudio(item, asset, durationOf(spans), actions);
}

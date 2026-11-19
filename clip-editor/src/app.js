import { installCanvasEditing } from "./canvas-edit.js";
import { normalizeBrand, onBrandReady, profileHandle } from "./brand.js";
import {
  canSplitTimed,
  deleteItem,
  detachAudio,
  editItem,
  editorItem,
  pasteItem,
  splitTimed,
} from "./edit-operations.js";
import { createMediaLibrary } from "./media-library.js";
import { createExportPanel } from "./export-panel.js";
import { byId } from "./fields.js";
import { renderInspector } from "./inspector.js";
import { loadProject, saveProject } from "./local-project.js";
import { matchesAsset } from "./media.js";
import { createPreview } from "./preview.js";
import {
  audioDuration,
  canSplit,
  clipDuration,
  clamp,
  durationOf,
  EPSILON,
  history,
  id,
  locate,
  moveClip,
  newClip,
  outputSize,
  splitClip,
  timeline,
} from "./project.js";
import { createTimelineView } from "./timeline-view.js";

const canvas = byId("preview-canvas");
const notice = byId("notice");
const files = new Map();
const state = history(loadProject(showNotice));
let spans = timeline(state.current.clips);
let size = outputSize(state.current);
let assets = new Map(state.current.assets.map((asset) => [asset.id, asset]));
let clipboard;
const controls = Object.fromEntries(
  [
    "undo",
    "redo",
    "play",
    "step-back",
    "step-forward",
    "split",
    "delete",
    "earlier",
    "later",
    "add-text",
    "cut",
    "copy",
    "paste",
    "duplicate",
    "detach",
    "range-in",
    "range-out",
    "range-clear",
  ].map((name) => [name, byId(name)]),
);
let selection = spans.length ? { kind: "clip", id: spans[0].clip.id } : null;
let draft;
let indexedAssets = state.current.assets;

function showNotice(message = "") {
  notice.hidden = !message;
  notice.textContent = message;
}

function selected(project = state.current) {
  if (!selection) return null;
  const { kind, id } = selection;
  const item = editorItem(project, kind, id);
  return item ? { kind, item } : null;
}

function getState() {
  const project = draft ?? state.current;
  return {
    project,
    spans:
      draft && draft.clips !== state.current.clips
        ? timeline(draft.clips)
        : spans,
    files,
    assets,
    size,
    time: preview.time,
  };
}

const preview = createPreview({
  canvas,
  getState,
  onTime(time) {
    timelineView.position(time, scrubFollows());
    renderTimeActions();
  },
  onPlaying(playing) {
    controls.play.textContent = playing ? "Pause" : "Play";
    renderTimeActions();
  },
  onError: showNotice,
});
const timelineView = createTimelineView({
  getState,
  onSeek: (time) => preview.seek(time),
  getSelection: selected,
  onSelect: select,
  onMove: reorder,
  onPause: () => preview.pause(false),
  onEdit(kind, id, update) {
    selection = { kind, id };
    updateSelected(update);
  },
});
const exportPanel = createExportPanel({
  getState,
  updateSettings,
  pause: () => preview.pause(),
  onOpen: () => document.activeElement?.blur(),
});

function scrubFollows() {
  return preview.playing || document.activeElement === byId("seek");
}

const mediaLibrary = createMediaLibrary({
  files,
  getProject: () => state.current,
  append: appendMedia,
  onRelink() {
    render();
    preview.refresh();
  },
  notice: showNotice,
});

function disable(control, disabled) {
  if (control.disabled !== disabled) control.disabled = disabled;
}

let actionSelection;
function renderTimeActions() {
  const time = preview.time;
  const span = locate(spans, time);
  const length = durationOf(spans);
  const linked = span && files.has(span.clip.assetId);
  disable(controls.play, !linked && !preview.playing);
  disable(controls["step-back"], !linked || time <= 0);
  disable(controls["step-forward"], !linked || time >= length);
  disable(
    controls.split,
    actionSelection && actionSelection.kind !== "clip"
      ? !canSplitTimed(actionSelection.kind, actionSelection.item, time)
      : !canSplit(span, time),
  );
  disable(controls["range-in"], !length || time >= length);
  disable(controls["range-out"], !time);
}

function renderActions() {
  const current = selected();
  actionSelection = current;
  const index =
    current?.kind === "clip" ? state.current.clips.indexOf(current.item) : -1;
  controls.undo.disabled = !state.canUndo;
  controls.redo.disabled = !state.canRedo;
  controls.delete.disabled =
    controls.cut.disabled =
    controls.copy.disabled =
    controls.duplicate.disabled =
      !current;
  controls.paste.disabled =
    !clipboard ||
    (clipboard.kind !== "text" && !assets.has(clipboard.item.assetId));
  controls.detach.disabled =
    !current ||
    current.kind !== "clip" ||
    current.item.mute ||
    !assets.get(current.item.assetId)?.audioCodec;
  controls.earlier.disabled = index <= 0;
  controls.later.disabled = index < 0 || index >= spans.length - 1;
  controls["add-text"].disabled = !spans.length;
  controls["range-clear"].disabled = !state.current.range;
  renderTimeActions();
}

function renderProperties() {
  const project = state.current;
  renderInspector(project, spans, selected(), {
    update: updateSelected,
    settings: updateSettings,
  });
}

function render() {
  const project = state.current;
  spans = timeline(project.clips);
  if (indexedAssets !== project.assets) {
    indexedAssets = project.assets;
    assets = new Map(indexedAssets.map((asset) => [asset.id, asset]));
  }
  size = outputSize(project);
  mediaLibrary.render();
  renderProperties();
  timelineView.render();
  const { width, height } = size;
  byId("frame-size").textContent = spans.length ? `${width} × ${height}` : "";
  canvas.hidden = !spans.length;
  byId("preview-empty").hidden = Boolean(spans.length);
  renderActions();
  renderBrand();
  exportPanel.refresh();
}

function persist() {
  saveProject(state.current, (message) => {
    byId("save-status").textContent = message;
  });
}

function change(project, nextSelection = selection, time = preview.time) {
  if (project === state.current) return;
  preview.pause(false);
  draft = undefined;
  state.set(project);
  selection = nextSelection;
  render();
  preview.seek(time);
  persist();
}

function updateSettings(update) {
  const project = state.current;
  if (
    Object.entries(update).every(
      ([key, value]) => project.settings[key] === value,
    )
  )
    return;
  change({ ...project, settings: { ...project.settings, ...update } });
}

function updateSelected(update) {
  const current = selected();
  if (!current) return;
  const { kind, item } = current;
  const changesTiming = "in" in update || "out" in update || "speed" in update;
  if (changesTiming && kind === "clip" && item.visual?.envelope) {
    update = { ...update, visual: { ...item.visual, envelope: undefined } };
  }
  if (changesTiming || "fadeIn" in update || "fadeOut" in update)
    update = { ...update, envelope: undefined };
  if (Object.entries(update).every(([key, value]) => item[key] === value))
    return;
  let time = preview.time;
  if (kind === "clip" && changesTiming) {
    const span = spans.find(({ clip }) => clip.id === item.id);
    const at = locate(spans, time);
    if (at?.clip.id === item.id) {
      const next = { ...item, ...update };
      time =
        span.start +
        (clamp(at.sourceTime, next.in, Math.max(next.in, next.out - EPSILON)) -
          next.in) /
          next.speed;
    }
  }
  if (kind === "text" && ("start" in update || "end" in update)) {
    const next = { ...item, ...update };
    if (time < next.start || time >= next.end) time = next.start;
  }
  change(editItem(state.current, kind, item.id, update), selection, time);
}

function select(kind, id, seek = false) {
  selection = { kind, id };
  const current = selected();
  if (seek && current) {
    const span = spans.find(({ clip }) => clip.id === id);
    const start = span?.start ?? current.item.start;
    const end =
      span?.end ?? current.item.end ?? start + audioDuration(current.item);
    if (preview.time < start || preview.time >= end) preview.seek(start);
  }
  timelineView.select(current);
  renderProperties();
  renderActions();
}

function restore(method) {
  preview.pause(false);
  state[method]();
  if (!selected()) {
    const clip = locate(timeline(state.current.clips), preview.time)?.clip;
    selection = clip ? { kind: "clip", id: clip.id } : null;
  }
  render();
  preview.seek(preview.time);
  persist();
}

function appendMedia(incoming) {
  const project = state.current;
  const next = {
    ...project,
    assets: [...project.assets],
    clips: [...project.clips],
    audioTracks: [...project.audioTracks],
  };
  let cursor = durationOf(spans);
  let time = preview.time;
  let selectedItem;
  for (const { asset, file } of incoming) {
    const existing = next.assets.find(
      (item) =>
        item.id === asset.id ||
        (item.kind === asset.kind &&
          item.name === file.name &&
          matchesAsset(item, asset)),
    );
    const source = existing ?? asset;
    if (!existing) next.assets.push(source);
    files.set(source.id, file);
    if (source.kind === "audio") {
      const audio = {
        id: id(),
        assetId: source.id,
        start: 0,
        speed: 1,
        in: 0,
        out: source.duration,
        volume: 0.7,
        fadeIn: 0,
        fadeOut: 0,
      };
      next.audioTracks.push(audio);
      selectedItem = { kind: "audio", id: audio.id };
    } else {
      const clip = newClip(source);
      next.clips.push(clip);
      selectedItem = { kind: "clip", id: clip.id };
      time = cursor;
      cursor += clipDuration(clip);
    }
  }
  if (next.assets.length === project.assets.length)
    next.assets = project.assets;
  if (next.clips.length === project.clips.length) next.clips = project.clips;
  if (next.audioTracks.length === project.audioTracks.length)
    next.audioTracks = project.audioTracks;
  change(next, selectedItem, time);
}

function split() {
  const project = state.current;
  const current = selected();
  if (current && current.kind !== "clip") {
    const result = splitTimed(project, current, preview.time);
    if (result) change(result.project, result.selection);
    return;
  }
  const result = splitClip(project, locate(spans, preview.time), preview.time);
  if (result) change(result.project, { kind: "clip", id: result.id });
}

function removeSelection() {
  const current = selected();
  if (current)
    change(deleteItem(state.current, current.kind, current.item.id), null);
}

function copySelection(cut = false) {
  const current = selected();
  if (!current) return;
  clipboard = current;
  if (cut) removeSelection();
  else renderActions();
}

function pasteSelection(duplicate = false) {
  const current = duplicate ? selected() : clipboard;
  if (!current) return;
  const time =
    duplicate && current.kind !== "clip" ? current.item.start : preview.time;
  const after =
    duplicate && current.kind === "clip" ? current.item.id : undefined;
  const result = pasteItem(state.current, spans, current, time, after);
  if (result) change(result.project, result.selection, result.time);
}

function detachSelection() {
  const current = selected();
  if (current?.kind !== "clip") return;
  const span = spans.find(({ clip }) => clip.id === current.item.id);
  const result = detachAudio(state.current, span);
  change(result.project, result.selection);
}

function updateRange(edge) {
  const project = state.current;
  if (edge === "clear") {
    change({ ...project, range: null });
    return;
  }
  const time = preview.time;
  const before = project.range ?? { start: 0, end: null };
  const range =
    edge === "start"
      ? { start: time, end: before.end > time ? before.end : null }
      : { start: before.start < time ? before.start : 0, end: time };
  change({ ...project, range });
}

function reorder(clipId, index) {
  const project = state.current;
  const clips = moveClip(project.clips, clipId, index);
  if (clips === project.clips) return;
  const start = timeline(clips)[index].start;
  change({ ...project, clips }, { kind: "clip", id: clipId }, start);
}

function nudgeClip(direction) {
  if (selection?.kind !== "clip") return;
  const index = state.current.clips.findIndex(
    (clip) => clip.id === selection.id,
  );
  if (index >= 0) reorder(selection.id, index + direction);
}

const TEXT_PRESETS = {
  glossy: { value: "VICE CITY", y: 0.3, size: 0.1, color: "#fbecd4", style: "glossy" },
  hook: { value: "WAIT FOR IT", y: 0.22, size: 0.085, color: "#ffffff", style: "outline" },
  box: { value: "he really did that", y: 0.72, size: 0.05, color: "#ffffff", style: "background" },
};

function addText(preset) {
  const project = state.current;
  const length = durationOf(spans);
  if (!length) {
    showNotice("Import a video first, then add text on top of it.");
    return;
  }
  const start = Math.min(preview.time, Math.max(0, length - 0.5));
  const text = {
    id: id(),
    value: "Your text",
    start,
    end: Math.min(start + 3, length),
    x: 0.5,
    y: 0.78,
    size: 0.075,
    color: "#ffffff",
    align: "center",
    style: "outline",
    ...(typeof preset === "string" ? TEXT_PRESETS[preset] : null),
  };
  change(
    { ...project, texts: [...project.texts, text] },
    { kind: "text", id: text.id },
    start,
  );
  document.querySelector("#inspector-controls textarea")?.focus();
}

installCanvasEditing({
  canvas,
  preview,
  getState,
  onSelect: select,
  onDraft(kind, id, update) {
    draft = editItem(state.current, kind, id, update);
    preview.refresh();
  },
  onFinish(commit) {
    if (commit && draft) change(draft);
    draft = undefined;
    preview.refresh();
  },
});

const actions = {
  undo: () => restore("undo"),
  redo: () => restore("redo"),
  play: () => void preview.play(),
  "step-back": () => void preview.step(-1),
  "step-forward": () => void preview.step(1),
  split,
  delete: removeSelection,
  earlier: () => nudgeClip(-1),
  later: () => nudgeClip(1),
  "add-text": () => addText(),
  cut: () => copySelection(true),
  copy: () => copySelection(),
  paste: () => pasteSelection(),
  duplicate: () => pasteSelection(true),
  detach: detachSelection,
  "range-in": () => updateRange("start"),
  "range-out": () => updateRange("end"),
  "range-clear": () => updateRange("clear"),
};
const editMenu = byId("edit-menu");
for (const [id, action] of Object.entries(actions)) {
  controls[id].addEventListener("click", () => {
    if (editMenu.contains(controls[id])) {
      editMenu.open = false;
      editMenu.querySelector("summary").focus();
    }
    action();
  });
}
document.addEventListener("pointerdown", (event) => {
  if (!editMenu.contains(event.target)) editMenu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (
    event.target.closest("input, textarea, select, [contenteditable]") ||
    byId("export-dialog").open
  )
    return;
  const key = event.key.toLowerCase();
  const command = event.metaKey || event.ctrlKey;
  let control;
  if (command && key === "z") control = event.shiftKey ? "redo" : "undo";
  else if (command && key === "y") control = "redo";
  else if (command)
    control = { x: "cut", c: "copy", v: "paste", d: "duplicate" }[key];
  else if (!command && !event.altKey) {
    if (key === "escape" && editMenu.open) {
      editMenu.open = false;
      editMenu.querySelector("summary").focus();
      return;
    }
    if ((key === "home" || key === "end") && spans.length) {
      event.preventDefault();
      preview.seek(key === "home" ? 0 : durationOf(spans));
      return;
    }
    control = {
      " ": event.target.closest("button, summary") ? undefined : "play",
      i: "range-in",
      o: "range-out",
      s: "split",
      delete: "delete",
      arrowleft: "step-back",
      arrowright: "step-forward",
    }[key];
  }
  if (!control || controls[control].disabled) return;
  event.preventDefault();
  actions[control]();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) preview.pause();
});
window.addEventListener("pagehide", () => preview.pause(false));

/* ---------------- VICEFEED brand kit ---------------- */
const brandUi = {
  on: byId("brand-on"),
  styles: byId("brand-styles"),
  handle: byId("brand-handle"),
  pos: byId("brand-pos"),
  size: byId("brand-size"),
  opacity: byId("brand-opacity"),
  check: byId("brand-check"),
  note: byId("brand-note"),
};
const myHandle = profileHandle();
if (!state.current.brand?.handle && myHandle) {
  // first open on this account: put the clipper's handle on the watermark
  state.current.brand = normalizeBrand({ ...state.current.brand, handle: myHandle });
}
document.querySelectorAll(".brandkit .hnd").forEach((el) => {
  el.textContent = myHandle || "@you";
});

function brandOf(project = state.current) {
  return normalizeBrand(project.brand);
}
function setBrand(update, commit = true) {
  const next = { ...state.current, brand: normalizeBrand({ ...brandOf(), ...update }) };
  if (commit) change(next);
  else {
    draft = next;
    preview.refresh();
  }
}
function renderBrand() {
  const b = brandOf(draft ?? state.current);
  brandUi.on.checked = b.on;
  brandUi.styles.querySelectorAll("button").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.style === b.style));
    el.disabled = !b.on;
  });
  brandUi.pos.querySelectorAll("button").forEach((el) => {
    el.setAttribute("aria-checked", String(el.dataset.pos === b.pos));
    el.disabled = !b.on;
  });
  if (document.activeElement !== brandUi.handle) brandUi.handle.value = b.handle || myHandle;
  brandUi.handle.disabled = !b.on || b.style === "word" || b.style === "icon";
  brandUi.size.value = b.size;
  brandUi.opacity.value = b.opacity;
  brandUi.size.disabled = brandUi.opacity.disabled = !b.on;
  byId("brand-size-out").textContent = Math.round(b.size * 100) + "%";
  byId("brand-opacity-out").textContent = Math.round(b.opacity * 100) + "%";
  brandUi.check.textContent = b.on ? "Watermark on" : "No watermark";
  brandUi.check.classList.toggle("off", !b.on);
  brandUi.note.textContent = b.on
    ? "The watermark is required to earn rewards."
    : "Clips without the watermark don't earn rewards.";
  brandUi.note.classList.toggle("warn", !b.on);
}
brandUi.on.addEventListener("change", () => setBrand({ on: brandUi.on.checked }));
brandUi.styles.addEventListener("click", (event) => {
  const el = event.target.closest("[data-style]");
  if (el) setBrand({ style: el.dataset.style });
});
brandUi.pos.addEventListener("click", (event) => {
  const el = event.target.closest("[data-pos]");
  if (el) setBrand({ pos: el.dataset.pos });
});
brandUi.handle.addEventListener("change", () => setBrand({ handle: brandUi.handle.value }));
for (const key of ["size", "opacity"]) {
  brandUi[key].addEventListener("input", () => {
    setBrand({ [key]: Number(brandUi[key].value) }, false);
    byId(`brand-${key}-out`).textContent = Math.round(brandUi[key].value * 100) + "%";
  });
  brandUi[key].addEventListener("change", () => setBrand({ [key]: Number(brandUi[key].value) }));
}
document.querySelector(".brand-texts").addEventListener("click", (event) => {
  const el = event.target.closest("[data-preset]");
  if (el) addText(el.dataset.preset);
});
onBrandReady(() => preview.refresh());

render();
preview.refresh();

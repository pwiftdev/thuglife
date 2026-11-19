import {
  brandLayer,
  composeBrand,
  drawFrame,
  hitText,
  normalizeBrand,
  onBrandReady,
  profileHandle,
  sampleSource,
  videoSource
} from "./chunk-7SJCLYDC.js";
import {
  DEFAULT_VISUAL,
  EPSILON,
  MIN_CLIP,
  VideoSampleSink,
  audibleTracks,
  audioDuration,
  canSplit,
  clamp,
  clipDuration,
  durationOf,
  exportRange,
  fadeGain,
  history,
  id,
  locate,
  matchesAsset,
  moveClip,
  newClip,
  newProject,
  openMedia,
  outputSize,
  requiredAssets,
  sourceTimeAt,
  splitClip,
  splitEnvelope,
  timecode,
  timeline
} from "./chunk-3PW7KLAI.js";

// src/canvas-edit.js
function installCanvasEditing({
  canvas: canvas2,
  preview: preview2,
  getState: getState2,
  onSelect,
  onDraft,
  onFinish
}) {
  let drag;
  let scheduled;
  let nextUpdate;
  const position = (event, bounds2) => ({
    x: (event.clientX - bounds2.left) / bounds2.width,
    y: (event.clientY - bounds2.top) / bounds2.height
  });
  canvas2.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const bounds2 = canvas2.getBoundingClientRect();
    const { x, y } = position(event, bounds2);
    const text = preview2.hitText(x, y);
    const clip = locate(getState2().spans, preview2.time)?.clip;
    const item = text ?? clip;
    if (!item) return;
    preview2.pause();
    const kind = text ? "text" : "clip";
    onSelect(kind, item.id);
    drag = { item, kind, x, y, pointer: event.pointerId, bounds: bounds2 };
    canvas2.setPointerCapture(event.pointerId);
    canvas2.classList.add("moving-text");
  });
  canvas2.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { x, y } = position(event, drag.bounds);
    const { kind, item } = drag;
    const a = x - drag.x;
    const b = y - drag.y;
    if (kind === "text")
      nextUpdate = { x: clamp(item.x + a, 0, 1), y: clamp(item.y + b, 0, 1) };
    else
      nextUpdate = {
        frame: {
          ...item.frame,
          x: clamp(item.frame.x + a, -1, 1),
          y: clamp(item.frame.y + b, -1, 1)
        }
      };
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = void 0;
      onDraft(drag.kind, drag.item.id, nextUpdate);
    });
  });
  function end(event, commit) {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (scheduled) cancelAnimationFrame(scheduled);
    if (commit && nextUpdate) onDraft(drag.kind, drag.item.id, nextUpdate);
    drag = scheduled = nextUpdate = void 0;
    canvas2.classList.remove("moving-text");
    onFinish(commit);
  }
  canvas2.addEventListener("pointerup", (event) => end(event, true));
  canvas2.addEventListener("lostpointercapture", (event) => end(event, false));
}

// src/edit-operations.js
var lists = { clip: "clips", text: "texts", audio: "audioTracks" };
var timedDuration = (kind, item) => kind === "text" ? item.end - item.start : audioDuration(item);
function editorItem(project, kind, id2) {
  return project[lists[kind]]?.find((item) => item.id === id2);
}
function editItem(project, kind, id2, update) {
  const key = lists[kind];
  return {
    ...project,
    [key]: project[key].map(
      (item) => item.id === id2 ? { ...item, ...update } : item
    )
  };
}
function deleteItem(project, kind, id2) {
  const key = lists[kind];
  return { ...project, [key]: project[key].filter((item) => item.id !== id2) };
}
function insert(project, kind, item, index) {
  const key = lists[kind];
  return {
    project: { ...project, [key]: project[key].toSpliced(index, 0, item) },
    selection: { kind, id: item.id }
  };
}
function pasteItem(project, spans2, { kind, item }, time, afterId) {
  if (kind !== "text" && !project.assets.some((asset) => asset.id === item.assetId))
    return null;
  const next = { ...item, id: id() };
  if (kind !== "clip") {
    next.start = time;
    if (kind === "text") next.end = time + timedDuration(kind, item);
    return {
      ...insert(project, kind, next, project[lists[kind]].length),
      time
    };
  }
  if (afterId) {
    const after = spans2.findIndex(({ clip }) => clip.id === afterId);
    return {
      ...insert(project, kind, next, after + 1),
      time: spans2[after]?.end ?? 0
    };
  }
  const index = spans2.findIndex(({ end }) => time < end);
  if (index < 0)
    return {
      ...insert(project, kind, next, spans2.length),
      time: spans2.at(-1)?.end ?? 0
    };
  const span = spans2[index];
  const split2 = splitClip(project, span, time);
  if (split2) return { ...insert(split2.project, kind, next, index + 1), time };
  const start = time - span.start <= span.end - time;
  return {
    ...insert(project, kind, next, start ? index : index + 1),
    time: start ? span.start : span.end
  };
}
function canSplitTimed(kind, item, time) {
  if (!item || kind === "clip") return false;
  const min = MIN_CLIP / (item.speed ?? 1);
  return time - item.start >= min && item.start + timedDuration(kind, item) - time >= min;
}
function splitTimed(project, { kind, item }, time) {
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
      offset
    );
    left = { out: cut, envelope: leftFade };
    right = { ...item, start: time, in: cut, id: id(), envelope: rightFade };
  }
  const index = project[lists[kind]].indexOf(item) + 1;
  return insert(editItem(project, kind, item.id, left), kind, right, index);
}
function detachAudio(project, span) {
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
    envelope: clip.envelope
  };
  return insert(
    editItem(project, "clip", clip.id, { mute: true }),
    "audio",
    track,
    project.audioTracks.length
  );
}
function timelineEdit({
  kind,
  item,
  edge,
  delta,
  sourceDuration,
  timelineDuration
}) {
  if (edge === "move") {
    const start2 = clamp(
      item.start + delta,
      0,
      Math.max(timelineDuration, item.start)
    );
    if (kind === "text") return { start: start2, end: start2 + (item.end - item.start) };
    return { start: start2 };
  }
  if (kind === "text") {
    return edge === "start" ? {
      start: clamp(item.start + delta, 0, Math.max(0, item.end - MIN_CLIP))
    } : {
      end: clamp(
        item.end + delta,
        item.start + MIN_CLIP,
        Math.max(item.end, item.start + MIN_CLIP, timelineDuration)
      )
    };
  }
  const speed = item.speed ?? 1;
  const minimum = Math.min(MIN_CLIP, sourceDuration);
  if (edge === "end")
    return {
      out: clamp(item.out + delta * speed, item.in + minimum, sourceDuration),
      envelope: void 0
    };
  const lower = kind === "audio" ? Math.max(0, item.in - item.start * speed) : 0;
  const start = clamp(item.in + delta * speed, lower, item.out - minimum);
  return kind === "audio" ? {
    in: start,
    start: item.start + (start - item.in) / speed,
    envelope: void 0
  } : { in: start, envelope: void 0 };
}

// src/fields.js
var byId = (id2) => document.getElementById(id2);
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== void 0) element.textContent = text;
  return element;
}
var number = (key, label, value, change2, min, max, step = 1e-3) => ({
  key,
  label,
  value,
  change: change2,
  min,
  max,
  step,
  type: "number"
});
var choice = (key, label, value, change2, options) => ({
  key,
  label,
  value,
  change: change2,
  options,
  type: "select"
});
var labelCount = 0;
function fields(container, definitions) {
  const existing = new Map(
    [...container.children].map((element) => [element.dataset.key, element])
  );
  const keys = new Set(definitions.map(({ key }) => key));
  for (const [key, element] of existing) {
    if (!keys.has(key)) element.remove();
  }
  definitions.forEach((field, index) => {
    let label = existing.get(field.key);
    if (!label) {
      label = node("label", "field");
      label.dataset.key = field.key;
      const title = node("span", "", field.label);
      title.id = `editor-field-${++labelCount}`;
      label.append(title);
      const input2 = node(
        field.type === "select" || field.type === "textarea" ? field.type : "input"
      );
      input2.setAttribute("aria-labelledby", title.id);
      if (input2.tagName === "INPUT") input2.type = field.type;
      input2.addEventListener("change", () => {
        const current = input2.definition;
        const value = current.type === "number" ? input2.valueAsNumber : current.type === "checkbox" ? input2.checked : input2.value;
        if (current.type === "number" && !Number.isFinite(value))
          input2.value = current.value;
        else current.change(value);
      });
      label.append(input2);
    }
    if (container.children[index] !== label)
      container.insertBefore(label, container.children[index] ?? null);
    const input = label.lastElementChild;
    input.definition = field;
    label.classList.toggle(
      "wide",
      field.type === "textarea" || field.wide === true
    );
    for (const attribute of ["min", "max", "step", "rows", "maxLength"]) {
      if (field[attribute] !== void 0) input[attribute] = field[attribute];
    }
    if (field.type === "select") {
      for (const [index2, [value, title]] of field.options.entries()) {
        let option = input.options[index2];
        if (!option) input.append(option = node("option"));
        option.value = value;
        if (option.textContent !== title) option.textContent = title;
      }
      input.length = field.options.length;
    }
    if (field.type === "checkbox") input.checked = field.value;
    else {
      const value = field.type === "number" ? String(Number(field.value.toFixed(3))) : String(field.value);
      if (input.value !== value) input.value = value;
    }
    input.disabled = Boolean(field.disabled);
  });
}

// src/inspect-local.js
var worker;
function releaseInspector() {
  worker?.terminate();
  worker = void 0;
}
function inspectLocalFile(file, kind) {
  return new Promise((resolve, reject) => {
    worker ??= new Worker(new URL("./media-worker.js", import.meta.url), {
      type: "module"
    });
    worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.asset);
    worker.onerror = (event) => {
      releaseInspector();
      reject(
        new Error(
          event.message || "The browser could not start the media reader."
        )
      );
    };
    worker.postMessage({ file, kind });
  });
}

// src/media-library.js
var list = byId("media-list");
var dropZone = byId("drop-zone");
var inputFor = { video: byId("video-file"), audio: byId("audio-file") };
var buttonFor = { video: byId("import-video"), audio: byId("import-audio") };
var relink = byId("relink-file");
var hasFiles = (event) => event.dataTransfer?.types.includes("Files");
var mediaKind = (file) => file.type.startsWith("audio/") || /\.(wav|mp3|m4a|aac|ogg|opus|flac)$/i.test(file.name) ? "audio" : "video";
function readSelection(input) {
  const files2 = Array.from(input.files);
  input.value = "";
  return files2;
}
function createMediaLibrary({
  files: files2,
  getProject,
  append,
  onRelink,
  notice: notice2
}) {
  let importing = false;
  let relinkTarget;
  let rendered;
  let dirty = true;
  function render2() {
    const { assets: assets2 } = getProject();
    if (!dirty && rendered === assets2) return;
    dirty = false;
    rendered = assets2;
    const entries = document.createDocumentFragment();
    for (const asset of assets2) {
      const entry = node("div", "media-entry");
      const name = node("div", "media-name", asset.name);
      name.title = asset.name;
      const shape = asset.kind === "video" ? `${asset.width} \xD7 ${asset.height}` : asset.audioCodec.toUpperCase();
      const linked = files2.has(asset.id);
      const label = linked ? `${shape} \xB7 ${timecode(asset.duration)}${asset.kind === "video" ? ` \xB7 ${asset.audioTracks} audio` : ""}` : "Media needs relinking";
      const button = node(
        "button",
        "",
        linked ? asset.kind === "video" ? "Add to timeline" : "Use as audio" : "Relink"
      );
      button.type = "button";
      button.dataset.asset = asset.id;
      entry.append(name, node("p", "muted", label), button);
      entries.append(entry);
    }
    const assetId = document.activeElement?.dataset.asset;
    list.replaceChildren(entries);
    if (assetId)
      [...list.querySelectorAll("button")].find(({ dataset }) => dataset.asset === assetId)?.focus({ preventScroll: true });
  }
  async function read(incoming, defaultKind, target) {
    if (!incoming.length || importing) return;
    importing = true;
    buttonFor.video.disabled = buttonFor.audio.disabled = true;
    notice2("Reading media\u2026");
    const accepted = [];
    const errors = [];
    try {
      for (const file of incoming) {
        try {
          const asset = await inspectLocalFile(
            file,
            target?.kind ?? defaultKind ?? mediaKind(file)
          );
          if (target && !matchesAsset(target, asset)) {
            throw new Error(
              `\u201C${file.name}\u201D does not match the saved source \u201C${target.name}\u201D. Choose the original file.`
            );
          }
          accepted.push({ asset: target ?? asset, file });
        } catch (error) {
          errors.push(error.message);
        }
      }
      if (!accepted.length) return;
      dirty = true;
      if (target) {
        files2.set(target.id, accepted[0].file);
        onRelink();
      } else {
        append(accepted);
      }
    } finally {
      releaseInspector();
      notice2(errors.join(" "));
      buttonFor.video.disabled = buttonFor.audio.disabled = false;
      importing = false;
    }
  }
  for (const kind of ["video", "audio"]) {
    const input = inputFor[kind];
    buttonFor[kind].addEventListener("click", () => input.click());
    input.addEventListener(
      "change",
      () => void read(readSelection(input), kind)
    );
  }
  list.addEventListener("click", (event) => {
    const assetId = event.target.closest("button[data-asset]")?.dataset.asset;
    const asset = getProject().assets.find((item) => item.id === assetId);
    if (!asset || importing) return;
    if (files2.has(assetId)) append([{ asset, file: files2.get(assetId) }]);
    else {
      relinkTarget = asset;
      relink.click();
    }
  });
  relink.addEventListener("change", () => {
    const picked = readSelection(relink);
    const target = relinkTarget;
    relinkTarget = void 0;
    if (target) void read(picked, target.kind, target);
  });
  for (const name of ["dragover", "drop"]) {
    window.addEventListener(name, (event) => {
      if (hasFiles(event)) event.preventDefault();
    });
  }
  dropZone.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dropZone.classList.add("is-dragging");
    event.dataTransfer.dropEffect = "copy";
  });
  dropZone.addEventListener("dragleave", (event) => {
    if (!dropZone.contains(event.relatedTarget))
      dropZone.classList.remove("is-dragging");
  });
  dropZone.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
    void read([...event.dataTransfer.files]);
  });
  return { render: render2 };
}

// src/export-panel.js
var dialog = byId("export-dialog");
var settingsRoot = byId("export-settings");
var progress = byId("progress");
var status = byId("export-status");
var support = byId("export-support");
var save = byId("export-save");
var download = byId("export-download");
var cancel = byId("export-cancel");
var codecLabels = { mp4: "MP4 (H.264 / AAC)", webm: "WebM (VP8 / Opus)" };
var downloadLifetime = 5 * 60 * 1e3;
function removeScratch(name) {
  if (!name) return;
  void navigator.storage.getDirectory().then((root3) => root3.removeEntry(name)).catch(() => {
  });
}
function downloadFile(blob, scratch, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    removeScratch(scratch);
  }, downloadLifetime);
}
function createExportPanel({ getState: getState2, updateSettings: updateSettings2, pause, onOpen }) {
  let worker2;
  let job;
  let formats;
  let request = 0;
  let pendingProbe;
  let probeTimer;
  function setStatus(message) {
    status.hidden = !message;
    status.textContent = message;
  }
  function render2() {
    const {
      project,
      spans: spans2,
      files: files2,
      size: { width, height }
    } = getState2();
    const { settings } = project;
    const range = exportRange(project, spans2);
    const locked = Boolean(job);
    const hasPicker = typeof window.showSaveFilePicker === "function";
    const missing = [...requiredAssets(project, spans2)].some(
      (id2) => !files2.has(id2)
    );
    const blocked = range.duration <= 0 || missing || !formats || Boolean(formats[settings.format]);
    const options = [
      {
        ...choice(
          "format",
          "Format",
          settings.format,
          (format) => updateSettings2({ format }),
          Object.entries(codecLabels)
        ),
        wide: true
      },
      choice(
        "resolution",
        "Resolution",
        settings.resolution,
        (resolution) => updateSettings2({ resolution }),
        [
          ["source", "Match first clip"],
          ["480", "480p"],
          ["720", "720p"],
          ["1080", "1080p"],
          ["1440", "1440p"],
          ["2160", "2160p"]
        ]
      ),
      choice(
        "fps",
        "Frame rate",
        settings.fps,
        (fps) => updateSettings2({ fps: Number(fps) }),
        [
          [24, "24 fps"],
          [30, "30 fps"],
          [60, "60 fps"]
        ]
      ),
      choice(
        "quality",
        "Quality",
        settings.quality,
        (quality) => updateSettings2({ quality }),
        [
          ["small", "Smaller file"],
          ["standard", "Standard"],
          ["high", "High"]
        ]
      )
    ];
    fields(
      settingsRoot,
      options.filter(
        ({ key }) => key !== "resolution" || settings.aspect !== "custom"
      ).map((field) => ({ ...field, disabled: locked }))
    );
    support.textContent = [
      `${width} \xD7 ${height}`,
      ...project.range ? [`Range ${timecode(range.start)} to ${timecode(range.end)}`] : [],
      missing ? "Relink missing media to export." : !project.clips.length ? "Add a video clip to export." : range.duration <= 0 ? "Mark a range with video or clear the export range." : formats ? formats[settings.format] || "Encoding available on this device." : "Checking browser encoders\u2026"
    ].join(" \xB7 ");
    save.hidden = !hasPicker;
    save.disabled = locked || blocked;
    download.disabled = locked || blocked;
    cancel.hidden = !job || job.phase === "picking" || job.phase === "saving";
    cancel.disabled = job?.phase === "canceling";
    byId("export-close").disabled = locked;
    byId("export-progress").hidden = !job || job.phase === "picking";
  }
  function receive({ data }) {
    if (data.type === "support") {
      if (data.request !== request) return;
      formats = data.formats;
      render2();
      return;
    }
    if (!job) return;
    if (data.type === "progress") {
      if (job.phase === "encoding") {
        progress.value = data.progress;
        setStatus(`Encoding ${Math.round(data.progress * 100)}%`);
      }
      return;
    }
    if (data.type === "saving") {
      job.phase = "saving";
      progress.value = 1;
      setStatus("Saving video\u2026");
      render2();
      return;
    }
    const filename = job.filename;
    job = void 0;
    if (data.type === "complete") {
      if (data.blob) downloadFile(data.blob, data.scratch, filename);
      setStatus(data.blob ? "Download started." : "Video saved.");
      document.getElementById("export-next")?.removeAttribute("hidden");
    } else if (data.type === "canceled") {
      setStatus("Export canceled.");
    } else {
      setStatus(`Export failed. ${data.message}`);
    }
    render2();
  }
  function getWorker() {
    if (worker2) return worker2;
    worker2 = new Worker(new URL("./export-worker.js", import.meta.url), {
      type: "module"
    });
    worker2.addEventListener("message", receive);
    worker2.addEventListener("error", (event) => {
      worker2.terminate();
      worker2 = void 0;
      job = void 0;
      formats ??= Object.fromEntries(
        Object.keys(codecLabels).map((format) => [
          format,
          "The export worker could not start."
        ])
      );
      setStatus(
        `Export worker failed. ${event.message || "Close and reopen Export to retry."}`
      );
      render2();
    });
    return worker2;
  }
  function refresh() {
    if (!dialog.open) return;
    const { project, spans: spans2, size: size2 } = getState2();
    const { fps, quality } = project.settings;
    const range = exportRange(project, spans2);
    const spec = {
      size: size2,
      fps,
      quality,
      audio: audibleTracks(project, spans2, range).enabled
    };
    const key = JSON.stringify(spec);
    if (key !== pendingProbe) {
      pendingProbe = key;
      formats = void 0;
      const probe = ++request;
      clearTimeout(probeTimer);
      probeTimer = setTimeout(() => {
        if (!dialog.open) return;
        try {
          getWorker().postMessage({ type: "probe", request: probe, spec });
        } catch (error) {
          formats = Object.fromEntries(
            Object.keys(codecLabels).map((format) => [format, error.message])
          );
          render2();
        }
      }, 120);
    }
    render2();
  }
  async function start(direct) {
    const { project, spans: spans2, files: files2 } = getState2();
    const { format } = project.settings;
    const ids = requiredAssets(project, spans2);
    if (job || !formats || formats[format] || exportRange(project, spans2).duration <= 0 || [...ids].some((id2) => !files2.has(id2)))
      return;
    pause();
    const filename = `vicefeed-clip.${format}`;
    job = { filename, phase: direct ? "picking" : "encoding" };
    setStatus("");
    render2();
    let handle;
    try {
      if (direct) {
        handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: codecLabels[format],
              accept: { [`video/${format}`]: [`.${format}`] }
            }
          ]
        });
        job.phase = "encoding";
      }
      progress.value = 0;
      setStatus("Preparing video\u2026");
      render2();
      const brand = normalizeBrand(project.brand);
      const brandBitmap = brand.on ? await composeBrand(brand) : null;
      getWorker().postMessage({
        type: "export",
        project: { ...project, brand },
        brandBitmap,
        files: direct ? files2 : new Map([...ids].map((id2) => [id2, files2.get(id2)])),
        handle
      });
    } catch (error) {
      job = void 0;
      if (error.name !== "AbortError")
        setStatus(`Could not start the export. ${error.message}`);
      render2();
    }
  }
  byId("export-open").addEventListener("click", () => {
    pause();
    onOpen();
    pendingProbe = void 0;
    setStatus("");
    dialog.showModal();
    refresh();
  });
  byId("export-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (job) event.preventDefault();
  });
  cancel.addEventListener("click", () => {
    if (job?.phase !== "encoding") return;
    job.phase = "canceling";
    worker2.postMessage({ type: "cancel" });
    setStatus("Canceling export\u2026");
    render2();
  });
  save.addEventListener("click", () => void start(true));
  download.addEventListener("click", () => void start(false));
  return { refresh };
}

// src/inspector.js
var presets = [
  ["original", "Original"],
  ["16:9", "16:9 landscape"],
  ["9:16", "9:16 vertical"],
  ["1:1", "1:1 square"],
  ["4:5", "4:5 portrait"],
  ["custom", "Custom size"]
];
var frameRoot = byId("frame-controls");
var root = byId("inspector-controls");
var groups = /* @__PURE__ */ new Map();
var activeKind;
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
function percent(key, label, value, change2, min = 0, max = 1) {
  return number(
    key,
    label,
    value * 100,
    (next) => change2(clamp(next / 100, min, max)),
    min * 100,
    max * 100,
    1
  );
}
function fadeFields(item, duration, apply, label = "Fade", prefix = "") {
  return ["fadeIn", "fadeOut"].map(
    (key, index) => number(
      prefix + key,
      `${label} ${index ? "out" : "in"} (s)`,
      item[key],
      (value) => apply(key)(clamp(value, 0, duration)),
      0,
      Math.max(duration, item[key])
    )
  );
}
function speedField(speed, apply) {
  return number(
    "speed",
    "Speed (\xD7)",
    speed,
    (value) => apply("speed")(clamp(value, 0.5, 2)),
    0.5,
    2,
    0.01
  );
}
function showClip(clip, asset, actions2) {
  const trim = group("trim", asset.name);
  trim.title.textContent = asset.name;
  const min = Math.min(MIN_CLIP, asset.duration);
  const apply = (key) => (value) => actions2.update({ [key]: value });
  fields(trim.body, [
    number(
      "in",
      "Source in (s)",
      clip.in,
      (value) => apply("in")(clamp(value, 0, clip.out - min)),
      0,
      clip.out - min
    ),
    number(
      "out",
      "Source out (s)",
      clip.out,
      (value) => apply("out")(clamp(value, clip.in + min, asset.duration)),
      clip.in + min,
      asset.duration
    ),
    speedField(clip.speed, apply),
    percent("volume", "Source volume (%)", clip.volume, apply("volume")),
    ...asset.audioCodec ? fadeFields(clip, clipDuration(clip), apply) : [],
    {
      key: "mute",
      label: "Mute source",
      value: clip.mute,
      change: apply("mute"),
      type: "checkbox",
      wide: true
    }
  ]);
  if (!trim.length) {
    trim.length = node("p", "muted");
    trim.section.append(trim.length);
  }
  trim.length.textContent = `Clip length ${timecode(clipDuration(clip))}`;
  const frame = clip.frame;
  const adjust = (key) => (value) => actions2.update({ frame: { ...frame, [key]: value } });
  fields(group("framing", "Framing").body, [
    choice("fit", "Scale", frame.fit, adjust("fit"), [
      ["fit", "Fit"],
      ["fill", "Fill"]
    ]),
    percent("zoom", "Zoom (%)", frame.zoom, adjust("zoom"), 0.25, 5),
    percent("x", "Position X (%)", frame.x, adjust("x"), -1, 1),
    percent("y", "Position Y (%)", frame.y, adjust("y"), -1, 1),
    number(
      "rotation",
      "Rotation (\xB0)",
      frame.rotation,
      (value) => adjust("rotation")(clamp(value, -180, 180)),
      -180,
      180,
      1
    ),
    ...[
      ["left", "right"],
      ["right", "left"],
      ["top", "bottom"],
      ["bottom", "top"]
    ].map(
      ([edge, other]) => percent(
        edge,
        `Crop ${edge} (%)`,
        frame[edge],
        adjust(edge),
        0,
        0.95 - frame[other]
      )
    )
  ]);
  const visual = clip.visual ?? DEFAULT_VISUAL;
  const visualChange = (key) => (value) => actions2.update({
    visual: { ...visual, [key]: value, envelope: void 0 }
  });
  fields(group("appearance", "Appearance").body, [
    ...fadeFields(
      visual,
      clipDuration(clip),
      visualChange,
      "Video fade",
      "video-"
    ),
    percent(
      "brightness",
      "Brightness (%)",
      frame.brightness ?? 1,
      adjust("brightness"),
      0,
      2
    ),
    percent(
      "contrast",
      "Contrast (%)",
      frame.contrast ?? 1,
      adjust("contrast"),
      0,
      2
    ),
    percent(
      "saturation",
      "Saturation (%)",
      frame.saturation ?? 1,
      adjust("saturation"),
      0,
      2
    ),
    {
      key: "flipX",
      label: "Flip horizontal",
      value: Boolean(frame.flipX),
      type: "checkbox",
      change: adjust("flipX"),
      wide: true
    },
    {
      key: "flipY",
      label: "Flip vertical",
      value: Boolean(frame.flipY),
      type: "checkbox",
      change: adjust("flipY"),
      wide: true
    }
  ]);
}
function showText(text, length, actions2) {
  const apply = (key) => (value) => actions2.update({ [key]: value });
  fields(group("text", "Text overlay").body, [
    {
      key: "value",
      label: "Text",
      value: text.value,
      change: apply("value"),
      type: "textarea",
      rows: 3,
      maxLength: 500
    },
    number(
      "start",
      "Start (s)",
      text.start,
      (value) => apply("start")(clamp(value, 0, Math.max(0, text.end - MIN_CLIP))),
      0,
      Math.max(0, text.end - MIN_CLIP)
    ),
    number(
      "end",
      "End (s)",
      text.end,
      (value) => apply("end")(
        clamp(
          value,
          text.start + MIN_CLIP,
          Math.max(length, text.start + MIN_CLIP)
        )
      ),
      text.start + MIN_CLIP,
      Math.max(length, text.end)
    ),
    percent("x", "Position X (%)", text.x, apply("x")),
    percent("y", "Position Y (%)", text.y, apply("y")),
    percent("size", "Size (%)", text.size, apply("size"), 0.015, 0.4),
    {
      key: "color",
      label: "Color",
      value: text.color,
      change: apply("color"),
      type: "color"
    },
    choice("align", "Alignment", text.align, apply("align"), [
      ["left", "Left"],
      ["center", "Center"],
      ["right", "Right"]
    ]),
    choice("style", "Style", text.style, apply("style"), [
      ["glossy", "Glossy 3D"],
      ["outline", "Outline"],
      ["background", "Background"],
      ["plain", "Plain"]
    ])
  ]);
}
function showAudio(audio, asset, length, actions2) {
  const groupAudio = group("audio", asset.name);
  groupAudio.title.textContent = asset.name;
  const apply = (key) => (value) => actions2.update({ [key]: value });
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
      Math.max(maxStart, audio.start)
    ),
    percent("volume", "Track volume (%)", audio.volume, apply("volume")),
    speedField(audio.speed, apply),
    number(
      "in",
      "Source in (s)",
      audio.in,
      (value) => apply("in")(clamp(value, 0, audio.out - min)),
      0,
      audio.out - min
    ),
    number(
      "out",
      "Source out (s)",
      audio.out,
      (value) => apply("out")(clamp(value, audio.in + min, asset.duration)),
      audio.in + min,
      asset.duration
    ),
    {
      key: "mute",
      label: "Mute track",
      value: Boolean(audio.mute),
      change: apply("mute"),
      type: "checkbox",
      wide: true
    },
    ...fadeFields(audio, duration, apply)
  ]);
}
function renderInspector(project, spans2, selected2, actions2) {
  const { settings } = project;
  const size2 = outputSize(project);
  fields(frameRoot, [
    {
      ...choice(
        "aspect",
        "Output frame",
        settings.aspect,
        (aspect) => actions2.settings(
          aspect === "custom" ? { aspect, ...size2 } : { aspect }
        ),
        presets
      ),
      wide: true
    },
    ...settings.aspect === "custom" ? [
      number(
        "width",
        "Width (px)",
        settings.width,
        (width) => actions2.settings({
          width: 2 * Math.round(clamp(width, 2, 3840) / 2)
        }),
        2,
        3840,
        2
      ),
      number(
        "height",
        "Height (px)",
        settings.height,
        (height) => actions2.settings({
          height: 2 * Math.round(clamp(height, 2, 3840) / 2)
        }),
        2,
        3840,
        2
      )
    ] : []
  ]);
  const kind = selected2?.kind ?? "none";
  if (activeKind !== kind) {
    activeKind = kind;
    root.replaceChildren();
    groups.clear();
    if (kind === "none")
      root.append(
        node(
          "p",
          "muted",
          "Select a clip, text overlay or audio track to edit it."
        )
      );
  }
  const item = selected2?.item;
  const asset = project.assets.find(({ id: id2 }) => id2 === item?.assetId);
  if (kind === "clip") showClip(item, asset, actions2);
  if (kind === "text") showText(item, durationOf(spans2), actions2);
  if (kind === "audio") showAudio(item, asset, durationOf(spans2), actions2);
}

// src/local-project.js
var KEY = "clip-editor.project.v1";
var validId = (value) => typeof value === "string" && value.length > 0;
var between = (value, min, max = Infinity) => Number.isFinite(value) && value >= min && value <= max;
var oneOf = (value, options) => options.includes(value);
var nonNegative = (value) => between(value, 0);
var validEnvelope = (value) => !value || nonNegative(value.offset) && between(value.length, value.offset);
var validFade = (item) => nonNegative(item.fadeIn) && nonNegative(item.fadeOut) && validEnvelope(item.envelope);
function migrate(project) {
  if (project?.version !== 1) return project;
  const { audio, ...rest } = project;
  return {
    ...rest,
    version: 2,
    range: null,
    clips: rest.clips.map((clip) => ({ fadeIn: 0, fadeOut: 0, ...clip })),
    audioTracks: audio ? [{ speed: 1, ...audio }] : []
  };
}
function validAsset(asset) {
  return validId(asset?.id) && validId(asset.name) && nonNegative(asset.size) && Number.isFinite(asset.origin) && between(asset.duration, Number.MIN_VALUE) && (asset.kind === "video" ? between(asset.width, 1) && between(asset.height, 1) : asset.kind === "audio" && validId(asset.audioCodec));
}
function validFrame(frame) {
  return frame && oneOf(frame.fit, ["fit", "fill"]) && between(frame.zoom, 0.25, 5) && between(frame.rotation, -180, 180) && between(frame.x, -1, 1) && between(frame.y, -1, 1) && ["left", "right", "top", "bottom"].every(
    (edge) => nonNegative(frame[edge])
  ) && ["brightness", "contrast", "saturation"].every(
    (key) => frame[key] === void 0 || between(frame[key], 0, 2)
  ) && ["flipX", "flipY"].every(
    (key) => frame[key] === void 0 || typeof frame[key] === "boolean"
  ) && frame.left + frame.right < 1 && frame.top + frame.bottom < 1;
}
function validMediaItem(item, asset) {
  return asset && validId(item.id) && nonNegative(item.in) && item.in < item.out && between(item.out, 0, asset.duration + 1e-6) && between(item.speed, 0.5, 2) && between(item.volume, 0, 1) && validFade(item);
}
function validText(text) {
  return validId(text?.id) && typeof text.value === "string" && text.value.length <= 500 && nonNegative(text.start) && text.end > text.start && Number.isFinite(text.end) && between(text.x, 0, 1) && between(text.y, 0, 1) && between(text.size, 0.015, 0.4) && /^#[0-9a-f]{6}$/i.test(text.color) && oneOf(text.align, ["left", "center", "right"]) && oneOf(text.style, ["plain", "outline", "background", "glossy"]);
}
function validSettings(settings) {
  return settings && oneOf(settings.aspect, [
    "original",
    "16:9",
    "9:16",
    "1:1",
    "4:5",
    "custom"
  ]) && between(settings.width, 2, 3840) && between(settings.height, 2, 3840) && oneOf(settings.resolution, [
    "source",
    "480",
    "720",
    "1080",
    "1440",
    "2160"
  ]) && oneOf(settings.fps, [24, 30, 60]) && oneOf(settings.quality, ["small", "standard", "high"]) && oneOf(settings.format, ["mp4", "webm"]);
}
function deserializeProject(raw) {
  const project = migrate(JSON.parse(raw));
  if (project?.version !== 2 || ![project.assets, project.clips, project.texts, project.audioTracks].every(
    Array.isArray
  ) || !validSettings(project.settings) || !project.assets.every(validAsset) || !project.texts.every(validText)) {
    throw new Error("Invalid project");
  }
  const assets2 = new Map(project.assets.map((asset) => [asset.id, asset]));
  const ids = [
    ...assets2.keys(),
    ...[...project.clips, ...project.texts, ...project.audioTracks].map(
      (item) => item?.id
    )
  ];
  const range = project.range;
  if (assets2.size !== project.assets.length || new Set(ids).size !== ids.length || range && (!nonNegative(range.start) || range.end !== null && !between(range.end, range.start)) || !project.clips.every((clip) => {
    const asset = assets2.get(clip?.assetId);
    return asset?.kind === "video" && validMediaItem(clip, asset) && typeof clip.mute === "boolean" && validFrame(clip.frame);
  }) || !project.audioTracks.every((track) => {
    const asset = assets2.get(track?.assetId);
    return asset?.audioCodec && validMediaItem(track, asset) && nonNegative(track.start);
  })) {
    throw new Error("Invalid project");
  }
  project.brand = normalizeBrand(project.brand);
  return project;
}
function loadProject(onError) {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? deserializeProject(raw) : newProject();
  } catch (error) {
    onError(
      error.name === "SecurityError" ? "Browser storage is unavailable. Project edits will only last in this tab." : "The saved project could not be read. New edits will start a fresh project."
    );
    return newProject();
  }
}
function saveProject(project, setStatus) {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
    setStatus("Saved on this device");
  } catch (error) {
    setStatus(
      error.name === "QuotaExceededError" ? "Storage is full. Edits are unsaved." : "Local save unavailable. Edits are unsaved."
    );
  }
}

// src/native-media.js
function nativeMedia(type) {
  const element = document.createElement(type);
  element.preload = "auto";
  element.playsInline = true;
  element.preservesPitch = false;
  let url;
  let current;
  return {
    element,
    set(file) {
      if (file === current) return;
      this.clear();
      if (!file) return;
      current = file;
      url = URL.createObjectURL(file);
      element.src = url;
    },
    clear() {
      if (!url) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
      url = current = void 0;
    }
  };
}
function nativeTime(asset, relative) {
  return Math.max(0, asset.origin + relative);
}

// src/preview-audio.js
var PREFETCH = 0.25;
function createAudioPreview(onError) {
  let upcoming = [];
  let next = 0;
  const active = /* @__PURE__ */ new Map();
  function clear() {
    for (const { media } of active.values()) media.clear();
    active.clear();
    upcoming = [];
    next = 0;
  }
  return {
    clear,
    prepare(state2, from) {
      clear();
      upcoming = state2.project.audioTracks.flatMap((track) => {
        const file = state2.files.get(track.assetId);
        const length = audioDuration(track);
        if (!file || track.mute || !track.volume || track.start + length <= from)
          return [];
        return [
          { track, file, length, asset: state2.assets.get(track.assetId) }
        ];
      }).sort((a, b) => a.track.start - b.track.start);
    },
    pause() {
      for (const { media } of active.values()) media.element.pause();
    },
    sync(at, signal) {
      while (upcoming[next]?.track.start <= at + PREFETCH) {
        const entry = upcoming[next++];
        if (entry.track.start + entry.length <= at) continue;
        const media = nativeMedia("audio");
        media.set(entry.file);
        media.element.playbackRate = entry.track.speed;
        active.set(entry.track.id, { ...entry, media, reported: false });
      }
      for (const [id2, entry] of active) {
        const { track, length, media, asset } = entry;
        const element = media.element;
        const offset = at - track.start;
        if (offset >= length) {
          media.clear();
          active.delete(id2);
          continue;
        }
        if (element.error) {
          if (!entry.reported)
            onError("An added audio clip could not be played.");
          entry.reported = true;
          continue;
        }
        if (element.readyState < 1) continue;
        const target = nativeTime(
          asset,
          track.in + Math.max(0, offset) * track.speed
        );
        if (target >= element.duration) {
          element.pause();
          continue;
        }
        const tolerance = element.paused ? 0.018 : 0.065;
        if (!element.seeking && Math.abs(element.currentTime - target) > tolerance)
          element.currentTime = target;
        if (offset < 0) continue;
        const volume = track.volume * fadeGain(track, offset, length);
        if (Math.abs(element.volume - volume) > 2e-3 || volume === 0 && element.volume !== 0)
          element.volume = volume;
        if (element.paused && !element.seeking && !entry.reported) {
          element.play().catch((error) => {
            if (signal.aborted || error.name === "AbortError") return;
            entry.reported = true;
            onError(error.message);
          });
        }
      }
    }
  };
}

// src/preview.js
var PREVIEW_PIXELS = 1280 * 720;
var PREVIEW_EDGE = 1600;
function mediaEvent(element, event, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const listeners = new AbortController();
    const options = { once: true, signal: listeners.signal };
    const finish = (error) => {
      listeners.abort();
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const failure = () => finish(
      new Error(
        element.error?.message || "The browser could not read this media during playback."
      )
    );
    const timer = setTimeout(
      () => finish(
        new Error("Playback could not load the requested media in time.")
      ),
      15e3
    );
    element.addEventListener(event, () => finish(), options);
    element.addEventListener("error", failure, options);
    signal.addEventListener("abort", () => finish(signal.reason), options);
    if (element.error) failure();
  });
}
async function readyAt(media, time, signal) {
  if (media.readyState < 1) await mediaEvent(media, "loadedmetadata", signal);
  signal.throwIfAborted();
  if (Math.abs(media.currentTime - time) > EPSILON) media.currentTime = time;
  if (media.seeking) await mediaEvent(media, "seeked", signal);
  if (media.readyState < 2) await mediaEvent(media, "loadeddata", signal);
}
function createPreview({
  canvas: canvas2,
  getState: getState2,
  onTime,
  onPlaying,
  onError
}) {
  const ctx = canvas2.getContext("2d", { alpha: false });
  const video = nativeMedia("video");
  const audio = createAudioPreview(onError);
  let time = 0;
  let playback;
  let request;
  let decoding = false;
  let stepping = false;
  let input;
  let sink;
  let activeFile;
  let still;
  let revision = 0;
  function clearStill(releaseInput = false) {
    still?.sample?.close();
    still = void 0;
    if (releaseInput) {
      input?.dispose();
      input = sink = activeFile = void 0;
    }
  }
  function assetFor(clip, state2) {
    return state2.assets.get(clip.assetId);
  }
  function paint(source, span, state2 = getState2()) {
    const { width, height } = state2.size;
    const scale = Math.min(
      1,
      Math.sqrt(PREVIEW_PIXELS / (width * height)),
      PREVIEW_EDGE / Math.max(width, height)
    );
    const rasterWidth = Math.max(1, Math.round(width * scale));
    const rasterHeight = Math.max(1, Math.round(height * scale));
    if (canvas2.width !== rasterWidth || canvas2.height !== rasterHeight) {
      canvas2.width = rasterWidth;
      canvas2.height = rasterHeight;
    }
    ctx.setTransform(rasterWidth / width, 0, 0, rasterHeight / height, 0, 0);
    drawFrame(ctx, source, span, state2.project.texts, time, state2.size, brandLayer(state2.project.brand));
  }
  async function drain() {
    if (decoding) return;
    decoding = true;
    try {
      while (request) {
        const job = request;
        request = void 0;
        if (job.file !== activeFile) {
          clearStill(true);
          activeFile = job.file;
        }
        try {
          if (!sink) {
            const opened = openMedia(job.file);
            input = opened;
            const track = await opened.getPrimaryVideoTrack();
            if (opened !== input) continue;
            sink = new VideoSampleSink(track);
          }
          const sample = await sink.getSample(job.timestamp);
          if (job.revision !== revision) {
            sample?.close();
            continue;
          }
          if (!sample)
            throw new Error("No video frame could be decoded at the playhead.");
          clearStill();
          still = { ...job, sample };
          paint(sampleSource(sample), locate(getState2().spans, time));
        } catch (error) {
          clearStill(true);
          if (job.revision === revision) onError(error.message);
        }
      }
    } finally {
      decoding = false;
    }
  }
  function matchesStill(file, timestamp) {
    if (still?.file !== file || !still.sample) return false;
    const sample = still.sample;
    return Math.abs(still.timestamp - timestamp) < EPSILON || timestamp >= sample.timestamp && timestamp < sample.timestamp + sample.duration - EPSILON;
  }
  function refresh() {
    if (playback) return;
    const state2 = getState2();
    const span = locate(state2.spans, time);
    const file = span && state2.files.get(span.clip.assetId);
    if (!file) {
      revision++;
      request = void 0;
      clearStill(true);
      paint(null, span);
      return;
    }
    const timestamp = assetFor(span.clip, state2).origin + span.sourceTime;
    if (matchesStill(file, timestamp)) {
      revision++;
      request = void 0;
      paint(sampleSource(still.sample), span);
      return;
    }
    if (still?.file !== file) paint(null, span);
    request = { revision: ++revision, file, timestamp };
    if (activeFile && activeFile !== file) clearStill(true);
    void drain();
  }
  function updateTime(value) {
    time = clamp(value, 0, durationOf(getState2().spans));
    onTime(time);
  }
  function pause(redraw = true) {
    if (playback) {
      playback.abort();
      playback = void 0;
      video.clear();
      audio.clear();
      onPlaying(false);
    }
    if (redraw) refresh();
  }
  function seek2(value) {
    pause(false);
    updateTime(value);
    refresh();
  }
  async function step(direction) {
    if (stepping) return;
    pause(false);
    const state2 = getState2();
    const span = locate(state2.spans, time);
    const file = span && state2.files.get(span.clip.assetId);
    if (!file) return;
    stepping = true;
    const stepRevision = ++revision;
    request = void 0;
    const asset = assetFor(span.clip, state2);
    const input2 = openMedia(file);
    const sourceTime = asset.origin + span.sourceTime;
    const cached = matchesStill(file, sourceTime) ? still.sample.timestamp : void 0;
    let adjacent;
    try {
      const sink2 = new VideoSampleSink(await input2.getPrimaryVideoTrack());
      let timestamp = cached;
      if (timestamp === void 0) {
        const current = await sink2.getSample(sourceTime);
        if (!current)
          throw new Error("No video frame could be decoded at the playhead.");
        timestamp = current.timestamp;
        current.close();
      }
      if (direction < 0) {
        if (span.sourceTime > span.clip.in + EPSILON)
          adjacent = await sink2.getSample(timestamp - EPSILON);
      } else {
        const iterator = sink2.samples(
          timestamp + EPSILON,
          asset.origin + span.clip.out
        );
        try {
          for await (const frame of iterator) {
            if (frame.timestamp > timestamp) {
              adjacent = frame;
              break;
            }
            frame.close();
          }
        } finally {
          await iterator.return();
        }
      }
      const relative = adjacent?.timestamp - asset.origin;
      if (stepRevision !== revision || playback) return;
      if (Number.isFinite(relative) && relative >= span.clip.in - EPSILON && relative < span.clip.out) {
        const next = span.start + (Math.max(relative, span.clip.in) - span.clip.in) / span.clip.speed + EPSILON;
        clearStill(activeFile && activeFile !== file);
        still = {
          file,
          timestamp: asset.origin + sourceTimeAt(span, next),
          sample: adjacent
        };
        adjacent = void 0;
        updateTime(next);
        paint(sampleSource(still.sample), span, state2);
      } else if (direction > 0) {
        seek2(span.end);
      } else if (relative < span.clip.in && time - span.start > EPSILON && timestamp > asset.origin + span.clip.in + EPSILON) {
        seek2(span.start);
      } else {
        seek2(span.start > 0 ? span.start - EPSILON : 0);
      }
    } catch (error) {
      if (stepRevision === revision) onError(error.message);
    } finally {
      adjacent?.close();
      input2.dispose();
      stepping = false;
    }
  }
  async function playFrom(span, state2, signal) {
    const asset = assetFor(span.clip, state2);
    const file = state2.files.get(span.clip.assetId);
    if (!file) throw new Error(`Relink \u201C${asset.name}\u201D to preview this clip.`);
    audio.pause();
    video.set(file);
    const element = video.element;
    element.pause();
    element.playbackRate = span.clip.speed;
    element.muted = span.clip.mute;
    element.volume = span.clip.volume * fadeGain(span.clip, time - span.start, span.end - span.start);
    await readyAt(element, nativeTime(asset, span.sourceTime), signal);
    signal.throwIfAborted();
    await element.play();
    signal.throwIfAborted();
    let fresh = true;
    let callback;
    const frameReady = () => {
      fresh = true;
      callback = element.requestVideoFrameCallback(frameReady);
    };
    if (element.requestVideoFrameCallback)
      callback = element.requestVideoFrameCallback(frameReady);
    const source = videoSource(element);
    const overlayTimes = state2.project.texts.flatMap(({ start, end }) => [start, end]).filter((mark) => mark > time && mark < span.end).sort((a, b) => a - b);
    let overlayIndex = 0;
    let lastAlpha;
    try {
      await new Promise((resolve, reject) => {
        const tick = () => {
          if (signal.aborted) return resolve();
          try {
            if (element.error)
              throw new Error(
                element.error.message || "The recording could not continue playing."
              );
            const relative = element.currentTime - asset.origin - span.clip.in;
            const position = Math.max(
              time,
              span.start + relative / span.clip.speed
            );
            if (element.ended || position >= span.end - EPSILON) {
              element.pause();
              updateTime(span.end);
              return resolve();
            }
            updateTime(position);
            let overlayChanged = false;
            while (overlayTimes[overlayIndex] <= position) {
              overlayChanged = true;
              overlayIndex++;
            }
            const visual = span.clip.visual;
            const alpha = visual ? fadeGain(visual, position - span.start, span.end - span.start) : 1;
            if (fresh || overlayChanged || alpha !== lastAlpha || callback === void 0) {
              lastAlpha = alpha;
              paint(source, span, state2);
              fresh = false;
            }
            const volume = span.clip.volume * fadeGain(span.clip, position - span.start, span.end - span.start);
            if (Math.abs(element.volume - volume) > 2e-3)
              element.volume = volume;
            audio.sync(position, signal);
            requestAnimationFrame(tick);
          } catch (error) {
            reject(error);
          }
        };
        tick();
      });
    } finally {
      if (callback !== void 0) element.cancelVideoFrameCallback(callback);
    }
  }
  async function play() {
    if (playback) return pause();
    const state2 = getState2();
    const length = durationOf(state2.spans);
    if (!length) return;
    if (time >= length - EPSILON) updateTime(0);
    const controller = new AbortController();
    const { signal } = controller;
    playback = controller;
    audio.prepare(state2, time);
    onPlaying(true);
    revision++;
    request = void 0;
    clearStill(true);
    try {
      while (time < length - EPSILON && !signal.aborted) {
        await playFrom(locate(state2.spans, time), state2, signal);
      }
    } catch (error) {
      if (!signal.aborted) onError(error.message);
    } finally {
      if (playback === controller) pause();
    }
  }
  return {
    seek: seek2,
    refresh,
    pause,
    play,
    step,
    hitText(x, y) {
      const state2 = getState2();
      return hitText(
        ctx,
        state2.project.texts,
        time,
        x * state2.size.width,
        y * state2.size.height,
        state2.size
      );
    },
    get time() {
      return time;
    },
    get playing() {
      return Boolean(playback);
    }
  };
}

// src/timeline-view.js
var scroll = byId("tracks-scroll");
var root2 = byId("tracks");
var ruler = byId("ruler");
var videoLane = byId("video-lane");
var textLane = byId("text-lane");
var audioLane = byId("audio-lane");
var playhead = byId("playhead");
var zoom = byId("timeline-zoom");
var seek = byId("seek");
var rangeBand = byId("range-band");
var counter = byId("timecode");
var trackGroup = root2.closest(".timeline-lanes");
function tickInterval(minimum) {
  const scale = 10 ** Math.floor(Math.log10(minimum));
  return [1, 2, 5, 10].map((multiple) => multiple * scale).find((value) => value >= minimum);
}
function arrangeRows(entries) {
  const rows = [];
  const items = [...entries].sort((a, b) => a.start - b.start).map((entry) => {
    let row = rows.findIndex((end) => end <= entry.start);
    if (row < 0) row = rows.length;
    rows[row] = entry.end;
    return { ...entry, row };
  });
  return { items, height: 10 + Math.max(1, rows.length) * 32 };
}
function bounds(kind, item, spans2) {
  if (kind === "clip") return spans2.find(({ clip }) => clip.id === item.id);
  return {
    start: item.start,
    end: kind === "text" ? item.end : item.start + audioDuration(item)
  };
}
function createTimelineView({
  getState: getState2,
  getSelection,
  onSeek,
  onSelect,
  onMove,
  onEdit,
  onPause
}) {
  let scale = 1;
  let length = 0;
  let lastEnd = 0;
  let trackWidth = 1;
  let viewportWidth = 1;
  let secondsLabel = timecode(0);
  let rulerKey;
  let selectedId;
  let drag;
  let draggedId;
  let frameRequest;
  let skipClick = false;
  const chips = /* @__PURE__ */ new Map();
  function position(time, scrollIntoView) {
    const x = Math.min(trackWidth - 1, time * scale);
    playhead.style.transform = `translateX(${Math.max(0, x)}px)`;
    if (scrollIntoView && (x < scroll.scrollLeft || x > scroll.scrollLeft + viewportWidth - 12)) {
      scroll.scrollLeft = x - viewportWidth / 3;
    }
    if (Number(seek.value) !== time) seek.value = time;
    counter.value = `${timecode(time)} / ${secondsLabel}`;
  }
  function renderRuler() {
    const interval = tickInterval(Math.max(1e-3, 95 / scale));
    const from = Math.max(
      0,
      Math.floor(scroll.scrollLeft / scale / interval) - 1
    );
    const until = Math.min(
      lastEnd,
      (scroll.scrollLeft + viewportWidth) / scale + interval
    );
    const end = Math.floor(until / interval);
    const key = `${scale}:${interval}:${from}:${end}`;
    if (key === rulerKey) return;
    rulerKey = key;
    const ticks = document.createDocumentFragment();
    for (let index = from; index <= end; index++) {
      const time = index * interval;
      const label = node("span", "tick", timecode(time));
      label.style.left = time * scale + "px";
      ticks.append(label);
    }
    ruler.replaceChildren(ticks);
  }
  function geometry(button, start, end) {
    const left = start * scale + "px";
    const width = Math.max(4, (end - start) * scale) + "px";
    if (button.style.left !== left) button.style.left = left;
    if (button.style.width !== width) button.style.width = width;
  }
  function createChip(kind, id2) {
    const button = node("button", `clip-chip chip-${kind}`);
    button.type = "button";
    button.dataset.id = id2;
    button.dataset.kind = kind;
    button.setAttribute("aria-pressed", String(selectedId === id2));
    button.append(node("span", "chip-label"), node("span", "chip-duration"));
    for (const edge of ["start", "end"]) {
      const handle = node("span", `trim-handle trim-${edge}`);
      handle.dataset.edge = edge;
      handle.setAttribute("aria-hidden", "true");
      button.append(handle);
    }
    button.draggable = kind === "clip";
    chips.set(id2, button);
    return button;
  }
  function renderLane(lane, kind, entries, labelFor, used) {
    let next = lane.firstElementChild;
    for (const { item, start, end, row = 0 } of entries) {
      used.add(item.id);
      const button = chips.get(item.id) ?? createChip(kind, item.id);
      if (button !== next) lane.insertBefore(button, next);
      next = button.nextElementSibling;
      const label = labelFor(item);
      const duration = timecode(end - start);
      if (button.firstElementChild.textContent !== label) {
        button.firstElementChild.textContent = label;
        button.setAttribute("aria-label", label);
      }
      if (button.children[1].textContent !== duration)
        button.children[1].textContent = duration;
      const description = `${label} \xB7 ${duration}`;
      if (button.title !== description) button.title = description;
      geometry(button, start, end);
      const top = 5 + row * 32 + "px";
      if (button.style.top !== top) button.style.top = top;
    }
  }
  function render2() {
    if (drag) return;
    const { project, spans: spans2, assets: assets2, time } = getState2();
    length = durationOf(spans2);
    secondsLabel = timecode(length);
    select2(getSelection());
    const text = arrangeRows(
      project.texts.map((item) => ({ item, start: item.start, end: item.end }))
    );
    const audio = arrangeRows(
      project.audioTracks.map((item) => ({
        item,
        start: item.start,
        end: item.start + audioDuration(item)
      }))
    );
    lastEnd = length;
    for (const { end } of [...text.items, ...audio.items])
      lastEnd = Math.max(lastEnd, end);
    viewportWidth = Math.max(1, scroll.clientWidth);
    const width = Math.min(
      1e6,
      viewportWidth * 2 ** (Number(zoom.value) / 12)
    );
    scale = lastEnd ? Math.min(width / (length || lastEnd), 1e6 / lastEnd) : 1;
    trackWidth = Math.max(viewportWidth, lastEnd * scale);
    root2.style.width = trackWidth + "px";
    trackGroup.style.setProperty("--text-lane-height", text.height + "px");
    trackGroup.style.setProperty("--audio-lane-height", audio.height + "px");
    seek.max = length;
    seek.disabled = !length;
    const range = exportRange(project, spans2);
    rangeBand.hidden = !project.range || range.duration <= 0;
    if (!rangeBand.hidden) geometry(rangeBand, range.start, range.end);
    const used = /* @__PURE__ */ new Set();
    const sourceName = (item) => assets2.get(item.assetId).name;
    renderLane(
      videoLane,
      "clip",
      spans2.map(({ clip, start, end }) => ({ item: clip, start, end })),
      sourceName,
      used
    );
    renderLane(
      textLane,
      "text",
      text.items,
      (item) => item.value.trim() || "Empty text overlay",
      used
    );
    renderLane(audioLane, "audio", audio.items, sourceName, used);
    for (const [id2, button] of chips) {
      if (used.has(id2)) continue;
      chips.delete(id2);
      button.remove();
    }
    renderRuler();
    position(time, true);
  }
  function select2(selected2) {
    const next = selected2?.item.id;
    if (selectedId === next) return;
    chips.get(selectedId)?.setAttribute("aria-pressed", "false");
    selectedId = next;
    chips.get(selectedId)?.setAttribute("aria-pressed", "true");
  }
  const pointerTime = (x) => (x - scroll.getBoundingClientRect().left + scroll.scrollLeft) / scale;
  function beginEdit(event, button, edge) {
    const { kind, id: id2 } = button.dataset;
    const { project, spans: spans2, assets: assets2, time } = getState2();
    const item = editorItem(project, kind, id2);
    const { start, end } = bounds(kind, item, spans2);
    const markers = [0, length, time];
    for (const span of spans2) {
      if (span.clip.id !== id2) markers.push(span.start, span.end);
    }
    for (const track of project.audioTracks) {
      if (track.id !== id2)
        markers.push(track.start, track.start + audioDuration(track));
    }
    for (const text of project.texts) {
      if (text.id !== id2) markers.push(text.start, text.end);
    }
    onPause();
    onSelect(kind, id2, false);
    drag = {
      button,
      edge,
      kind,
      item,
      start,
      end,
      markers,
      sourceDuration: assets2.get(item.assetId)?.duration,
      pointer: event.pointerId,
      initial: pointerTime(event.clientX),
      initialX: event.clientX
    };
    root2.setPointerCapture(event.pointerId);
  }
  function editDelta(job, x, unsnapped) {
    const delta = pointerTime(x) - job.initial;
    if (unsnapped) return delta;
    const edges = job.edge === "move" ? [job.start, job.end] : [job[job.edge]];
    let nearest = 7 / scale;
    let snapped = delta;
    for (const edge of edges) {
      for (const mark of job.markers) {
        const distance = Math.abs(mark - edge - delta);
        if (distance < nearest) {
          nearest = distance;
          snapped = mark - edge;
        }
      }
    }
    return snapped;
  }
  function updatePointer(x, alt) {
    if (drag.scrub) {
      onSeek(clamp(pointerTime(x), 0, length));
      return;
    }
    if (Math.abs(x - drag.initialX) < 3 && !drag.moved) return;
    drag.moved = true;
    const { item, kind, edge, start, end } = drag;
    drag.update = timelineEdit({
      ...drag,
      delta: editDelta(drag, x, alt),
      timelineDuration: length
    });
    const updated = { ...item, ...drag.update };
    const speed = item.speed ?? 1;
    if (kind === "clip") {
      geometry(
        drag.button,
        edge === "start" ? start + (updated.in - item.in) / speed : start,
        edge === "end" ? end + (updated.out - item.out) / speed : end
      );
    } else {
      const right = kind === "text" ? updated.end : updated.start + audioDuration(updated);
      geometry(drag.button, updated.start, right);
    }
  }
  root2.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const button = event.target.closest(".clip-chip");
    if (button) {
      const edge = event.target.closest("[data-edge]")?.dataset.edge;
      if (!edge && button.dataset.kind === "clip") return;
      if (edge) event.preventDefault();
      beginEdit(event, button, edge ?? "move");
    } else if (length) {
      drag = { scrub: true, pointer: event.pointerId };
      root2.setPointerCapture(event.pointerId);
      updatePointer(event.clientX, event.altKey);
    }
  });
  root2.addEventListener("pointermove", (event) => {
    if (event.pointerId !== drag?.pointer) return;
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(() => {
      frameRequest = void 0;
      updatePointer(event.clientX, event.altKey);
    });
  });
  function finish(event, committed) {
    if (drag?.pointer !== event.pointerId) return;
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = void 0;
    if (committed && (drag.moved || !drag.scrub))
      updatePointer(event.clientX, event.altKey);
    const { scrub, button, kind, item, update, start, end, moved } = drag;
    drag = void 0;
    if (scrub) return;
    geometry(button, start, end);
    if (moved) {
      skipClick = true;
      setTimeout(() => {
        skipClick = false;
      }, 0);
    }
    if (committed && update && Object.entries(update).some(
      ([key, value]) => key !== "envelope" && item[key] !== value
    ))
      onEdit(kind, item.id, update);
    else if (committed && !moved) onSelect(kind, item.id, true);
  }
  root2.addEventListener("pointerup", (event) => finish(event, true));
  root2.addEventListener("lostpointercapture", (event) => finish(event, false));
  root2.addEventListener("click", (event) => {
    const button = event.target.closest(".clip-chip");
    if (button && !skipClick)
      onSelect(button.dataset.kind, button.dataset.id, true);
  });
  root2.addEventListener("dragstart", (event) => {
    const button = event.target.closest(".chip-clip");
    if (!button || drag) {
      event.preventDefault();
      return;
    }
    draggedId = button.dataset.id;
    event.dataTransfer.setData("text/plain", draggedId);
    event.dataTransfer.effectAllowed = "move";
  });
  root2.addEventListener("dragend", () => {
    draggedId = void 0;
  });
  videoLane.addEventListener("dragover", (event) => {
    if (!draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  videoLane.addEventListener("drop", (event) => {
    if (!draggedId) return;
    event.preventDefault();
    const target = event.target.closest(".chip-clip")?.dataset.id;
    const spans2 = getState2().spans;
    const index = target ? spans2.findIndex(({ clip }) => clip.id === target) : spans2.length - 1;
    if (index >= 0) onMove(draggedId, index);
    draggedId = void 0;
  });
  new ResizeObserver(render2).observe(scroll);
  scroll.addEventListener("scroll", renderRuler);
  zoom.addEventListener("input", render2);
  seek.addEventListener("input", () => onSeek(Number(seek.value)));
  return { render: render2, position, select: select2 };
}

// src/app.js
var canvas = byId("preview-canvas");
var notice = byId("notice");
var files = /* @__PURE__ */ new Map();
var state = history(loadProject(showNotice));
var spans = timeline(state.current.clips);
var size = outputSize(state.current);
var assets = new Map(state.current.assets.map((asset) => [asset.id, asset]));
var clipboard;
var controls = Object.fromEntries(
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
    "range-clear"
  ].map((name) => [name, byId(name)])
);
var selection = spans.length ? { kind: "clip", id: spans[0].clip.id } : null;
var draft;
var indexedAssets = state.current.assets;
function showNotice(message = "") {
  notice.hidden = !message;
  notice.textContent = message;
}
function selected(project = state.current) {
  if (!selection) return null;
  const { kind, id: id2 } = selection;
  const item = editorItem(project, kind, id2);
  return item ? { kind, item } : null;
}
function getState() {
  const project = draft ?? state.current;
  return {
    project,
    spans: draft && draft.clips !== state.current.clips ? timeline(draft.clips) : spans,
    files,
    assets,
    size,
    time: preview.time
  };
}
var preview = createPreview({
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
  onError: showNotice
});
var timelineView = createTimelineView({
  getState,
  onSeek: (time) => preview.seek(time),
  getSelection: selected,
  onSelect: select,
  onMove: reorder,
  onPause: () => preview.pause(false),
  onEdit(kind, id2, update) {
    selection = { kind, id: id2 };
    updateSelected(update);
  }
});
var exportPanel = createExportPanel({
  getState,
  updateSettings,
  pause: () => preview.pause(),
  onOpen: () => document.activeElement?.blur()
});
function scrubFollows() {
  return preview.playing || document.activeElement === byId("seek");
}
var mediaLibrary = createMediaLibrary({
  files,
  getProject: () => state.current,
  append: appendMedia,
  onRelink() {
    render();
    preview.refresh();
  },
  notice: showNotice
});
function disable(control, disabled) {
  if (control.disabled !== disabled) control.disabled = disabled;
}
var actionSelection;
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
    actionSelection && actionSelection.kind !== "clip" ? !canSplitTimed(actionSelection.kind, actionSelection.item, time) : !canSplit(span, time)
  );
  disable(controls["range-in"], !length || time >= length);
  disable(controls["range-out"], !time);
}
function renderActions() {
  const current = selected();
  actionSelection = current;
  const index = current?.kind === "clip" ? state.current.clips.indexOf(current.item) : -1;
  controls.undo.disabled = !state.canUndo;
  controls.redo.disabled = !state.canRedo;
  controls.delete.disabled = controls.cut.disabled = controls.copy.disabled = controls.duplicate.disabled = !current;
  controls.paste.disabled = !clipboard || clipboard.kind !== "text" && !assets.has(clipboard.item.assetId);
  controls.detach.disabled = !current || current.kind !== "clip" || current.item.mute || !assets.get(current.item.assetId)?.audioCodec;
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
    settings: updateSettings
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
  byId("frame-size").textContent = spans.length ? `${width} \xD7 ${height}` : "";
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
  draft = void 0;
  state.set(project);
  selection = nextSelection;
  render();
  preview.seek(time);
  persist();
}
function updateSettings(update) {
  const project = state.current;
  if (Object.entries(update).every(
    ([key, value]) => project.settings[key] === value
  ))
    return;
  change({ ...project, settings: { ...project.settings, ...update } });
}
function updateSelected(update) {
  const current = selected();
  if (!current) return;
  const { kind, item } = current;
  const changesTiming = "in" in update || "out" in update || "speed" in update;
  if (changesTiming && kind === "clip" && item.visual?.envelope) {
    update = { ...update, visual: { ...item.visual, envelope: void 0 } };
  }
  if (changesTiming || "fadeIn" in update || "fadeOut" in update)
    update = { ...update, envelope: void 0 };
  if (Object.entries(update).every(([key, value]) => item[key] === value))
    return;
  let time = preview.time;
  if (kind === "clip" && changesTiming) {
    const span = spans.find(({ clip }) => clip.id === item.id);
    const at = locate(spans, time);
    if (at?.clip.id === item.id) {
      const next = { ...item, ...update };
      time = span.start + (clamp(at.sourceTime, next.in, Math.max(next.in, next.out - EPSILON)) - next.in) / next.speed;
    }
  }
  if (kind === "text" && ("start" in update || "end" in update)) {
    const next = { ...item, ...update };
    if (time < next.start || time >= next.end) time = next.start;
  }
  change(editItem(state.current, kind, item.id, update), selection, time);
}
function select(kind, id2, seek2 = false) {
  selection = { kind, id: id2 };
  const current = selected();
  if (seek2 && current) {
    const span = spans.find(({ clip }) => clip.id === id2);
    const start = span?.start ?? current.item.start;
    const end = span?.end ?? current.item.end ?? start + audioDuration(current.item);
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
    audioTracks: [...project.audioTracks]
  };
  let cursor = durationOf(spans);
  let time = preview.time;
  let selectedItem;
  for (const { asset, file } of incoming) {
    const existing = next.assets.find(
      (item) => item.id === asset.id || item.kind === asset.kind && item.name === file.name && matchesAsset(item, asset)
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
        fadeOut: 0
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
    const result2 = splitTimed(project, current, preview.time);
    if (result2) change(result2.project, result2.selection);
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
  const time = duplicate && current.kind !== "clip" ? current.item.start : preview.time;
  const after = duplicate && current.kind === "clip" ? current.item.id : void 0;
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
  const range = edge === "start" ? { start: time, end: before.end > time ? before.end : null } : { start: before.start < time ? before.start : 0, end: time };
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
    (clip) => clip.id === selection.id
  );
  if (index >= 0) reorder(selection.id, index + direction);
}
var TEXT_PRESETS = {
  glossy: { value: "VICE CITY", y: 0.3, size: 0.1, color: "#fbecd4", style: "glossy" },
  hook: { value: "WAIT FOR IT", y: 0.22, size: 0.085, color: "#ffffff", style: "outline" },
  box: { value: "he really did that", y: 0.72, size: 0.05, color: "#ffffff", style: "background" }
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
    ...typeof preset === "string" ? TEXT_PRESETS[preset] : null
  };
  change(
    { ...project, texts: [...project.texts, text] },
    { kind: "text", id: text.id },
    start
  );
  document.querySelector("#inspector-controls textarea")?.focus();
}
installCanvasEditing({
  canvas,
  preview,
  getState,
  onSelect: select,
  onDraft(kind, id2, update) {
    draft = editItem(state.current, kind, id2, update);
    preview.refresh();
  },
  onFinish(commit) {
    if (commit && draft) change(draft);
    draft = void 0;
    preview.refresh();
  }
});
var actions = {
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
  "range-clear": () => updateRange("clear")
};
var editMenu = byId("edit-menu");
for (const [id2, action] of Object.entries(actions)) {
  controls[id2].addEventListener("click", () => {
    if (editMenu.contains(controls[id2])) {
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
  if (event.target.closest("input, textarea, select, [contenteditable]") || byId("export-dialog").open)
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
      " ": event.target.closest("button, summary") ? void 0 : "play",
      i: "range-in",
      o: "range-out",
      s: "split",
      delete: "delete",
      arrowleft: "step-back",
      arrowright: "step-forward"
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
var brandUi = {
  on: byId("brand-on"),
  styles: byId("brand-styles"),
  handle: byId("brand-handle"),
  pos: byId("brand-pos"),
  size: byId("brand-size"),
  opacity: byId("brand-opacity"),
  check: byId("brand-check"),
  note: byId("brand-note")
};
var myHandle = profileHandle();
if (!state.current.brand?.handle && myHandle) {
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
  brandUi.note.textContent = b.on ? "The watermark is required to earn rewards." : "Clips without the watermark don't earn rewards.";
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

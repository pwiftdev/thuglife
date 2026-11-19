import { composeBrand, normalizeBrand } from "./brand.js";
import { byId, choice, fields } from "./fields.js";
import {
  audibleTracks,
  exportRange,
  requiredAssets,
  timecode,
} from "./project.js";

const dialog = byId("export-dialog");
const settingsRoot = byId("export-settings");
const progress = byId("progress");
const status = byId("export-status");
const support = byId("export-support");
const save = byId("export-save");
const download = byId("export-download");
const cancel = byId("export-cancel");
const codecLabels = { mp4: "MP4 (H.264 / AAC)", webm: "WebM (VP8 / Opus)" };
const downloadLifetime = 5 * 60 * 1000;

function removeScratch(name) {
  if (!name) return;
  void navigator.storage
    .getDirectory()
    .then((root) => root.removeEntry(name))
    .catch(() => {});
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

export function createExportPanel({ getState, updateSettings, pause, onOpen }) {
  let worker;
  let job;
  let formats;
  let request = 0;
  let pendingProbe;
  let probeTimer;

  function setStatus(message) {
    status.hidden = !message;
    status.textContent = message;
  }

  function render() {
    const {
      project,
      spans,
      files,
      size: { width, height },
    } = getState();
    const { settings } = project;
    const range = exportRange(project, spans);
    const locked = Boolean(job);
    const hasPicker = typeof window.showSaveFilePicker === "function";
    const missing = [...requiredAssets(project, spans)].some(
      (id) => !files.has(id),
    );
    const blocked =
      range.duration <= 0 ||
      missing ||
      !formats ||
      Boolean(formats[settings.format]);
    const options = [
      {
        ...choice(
          "format",
          "Format",
          settings.format,
          (format) => updateSettings({ format }),
          Object.entries(codecLabels),
        ),
        wide: true,
      },
      choice(
        "resolution",
        "Resolution",
        settings.resolution,
        (resolution) => updateSettings({ resolution }),
        [
          ["source", "Match first clip"],
          ["480", "480p"],
          ["720", "720p"],
          ["1080", "1080p"],
          ["1440", "1440p"],
          ["2160", "2160p"],
        ],
      ),
      choice(
        "fps",
        "Frame rate",
        settings.fps,
        (fps) => updateSettings({ fps: Number(fps) }),
        [
          [24, "24 fps"],
          [30, "30 fps"],
          [60, "60 fps"],
        ],
      ),
      choice(
        "quality",
        "Quality",
        settings.quality,
        (quality) => updateSettings({ quality }),
        [
          ["small", "Smaller file"],
          ["standard", "Standard"],
          ["high", "High"],
        ],
      ),
    ];
    fields(
      settingsRoot,
      options
        .filter(
          ({ key }) => key !== "resolution" || settings.aspect !== "custom",
        )
        .map((field) => ({ ...field, disabled: locked })),
    );
    support.textContent = [
      `${width} × ${height}`,
      ...(project.range
        ? [`Range ${timecode(range.start)} to ${timecode(range.end)}`]
        : []),
      missing
        ? "Relink missing media to export."
        : !project.clips.length
          ? "Add a video clip to export."
          : range.duration <= 0
            ? "Mark a range with video or clear the export range."
            : formats
              ? formats[settings.format] || "Encoding available on this device."
              : "Checking browser encoders…",
    ].join(" · ");
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
      render();
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
      setStatus("Saving video…");
      render();
      return;
    }
    const filename = job.filename;
    job = undefined;
    if (data.type === "complete") {
      if (data.blob) downloadFile(data.blob, data.scratch, filename);
      setStatus(data.blob ? "Download started." : "Video saved.");
      document.getElementById("export-next")?.removeAttribute("hidden");
    } else if (data.type === "canceled") {
      setStatus("Export canceled.");
    } else {
      setStatus(`Export failed. ${data.message}`);
    }
    render();
  }

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("./export-worker.js", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", receive);
    worker.addEventListener("error", (event) => {
      worker.terminate();
      worker = undefined;
      job = undefined;
      formats ??= Object.fromEntries(
        Object.keys(codecLabels).map((format) => [
          format,
          "The export worker could not start.",
        ]),
      );
      setStatus(
        `Export worker failed. ${event.message || "Close and reopen Export to retry."}`,
      );
      render();
    });
    return worker;
  }

  function refresh() {
    if (!dialog.open) return;
    const { project, spans, size } = getState();
    const { fps, quality } = project.settings;
    const range = exportRange(project, spans);
    const spec = {
      size,
      fps,
      quality,
      audio: audibleTracks(project, spans, range).enabled,
    };
    const key = JSON.stringify(spec);
    if (key !== pendingProbe) {
      pendingProbe = key;
      formats = undefined;
      const probe = ++request;
      clearTimeout(probeTimer);
      probeTimer = setTimeout(() => {
        if (!dialog.open) return;
        try {
          getWorker().postMessage({ type: "probe", request: probe, spec });
        } catch (error) {
          formats = Object.fromEntries(
            Object.keys(codecLabels).map((format) => [format, error.message]),
          );
          render();
        }
      }, 120);
    }
    render();
  }

  async function start(direct) {
    const { project, spans, files } = getState();
    const { format } = project.settings;
    const ids = requiredAssets(project, spans);
    if (
      job ||
      !formats ||
      formats[format] ||
      exportRange(project, spans).duration <= 0 ||
      [...ids].some((id) => !files.has(id))
    )
      return;
    pause();
    const filename = `vicefeed-clip.${format}`;
    job = { filename, phase: direct ? "picking" : "encoding" };
    setStatus("");
    render();
    let handle;
    try {
      if (direct) {
        handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: codecLabels[format],
              accept: { [`video/${format}`]: [`.${format}`] },
            },
          ],
        });
        job.phase = "encoding";
      }
      progress.value = 0;
      setStatus("Preparing video…");
      render();
      const brand = normalizeBrand(project.brand);
      const brandBitmap = brand.on ? await composeBrand(brand) : null;
      getWorker().postMessage({
        type: "export",
        project: { ...project, brand },
        brandBitmap,
        files: direct
          ? files
          : new Map([...ids].map((id) => [id, files.get(id)])),
        handle,
      });
    } catch (error) {
      job = undefined;
      if (error.name !== "AbortError")
        setStatus(`Could not start the export. ${error.message}`);
      render();
    }
  }

  byId("export-open").addEventListener("click", () => {
    pause();
    onOpen();
    pendingProbe = undefined;
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
    worker.postMessage({ type: "cancel" });
    setStatus("Canceling export…");
    render();
  });
  save.addEventListener("click", () => void start(true));
  download.addEventListener("click", () => void start(false));

  return { refresh };
}

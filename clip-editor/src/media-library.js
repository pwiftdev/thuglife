import { byId, node } from "./fields.js";
import { inspectLocalFile, releaseInspector } from "./inspect-local.js";
import { matchesAsset } from "./media.js";
import { timecode } from "./project.js";

const list = byId("media-list");
const dropZone = byId("drop-zone");
const inputFor = { video: byId("video-file"), audio: byId("audio-file") };
const buttonFor = { video: byId("import-video"), audio: byId("import-audio") };
const relink = byId("relink-file");

const hasFiles = (event) => event.dataTransfer?.types.includes("Files");
const mediaKind = (file) =>
  file.type.startsWith("audio/") ||
  /\.(wav|mp3|m4a|aac|ogg|opus|flac)$/i.test(file.name)
    ? "audio"
    : "video";

function readSelection(input) {
  const files = Array.from(input.files);
  input.value = "";
  return files;
}

export function createMediaLibrary({
  files,
  getProject,
  append,
  onRelink,
  notice,
}) {
  let importing = false;
  let relinkTarget;
  let rendered;
  let dirty = true;

  function render() {
    const { assets } = getProject();
    if (!dirty && rendered === assets) return;
    dirty = false;
    rendered = assets;
    const entries = document.createDocumentFragment();
    for (const asset of assets) {
      const entry = node("div", "media-entry");
      const name = node("div", "media-name", asset.name);
      name.title = asset.name;
      const shape =
        asset.kind === "video"
          ? `${asset.width} × ${asset.height}`
          : asset.audioCodec.toUpperCase();
      const linked = files.has(asset.id);
      const label = linked
        ? `${shape} · ${timecode(asset.duration)}${asset.kind === "video" ? ` · ${asset.audioTracks} audio` : ""}`
        : "Media needs relinking";
      const button = node(
        "button",
        "",
        linked
          ? asset.kind === "video"
            ? "Add to timeline"
            : "Use as audio"
          : "Relink",
      );
      button.type = "button";
      button.dataset.asset = asset.id;
      entry.append(name, node("p", "muted", label), button);
      entries.append(entry);
    }
    const assetId = document.activeElement?.dataset.asset;
    list.replaceChildren(entries);
    if (assetId)
      [...list.querySelectorAll("button")]
        .find(({ dataset }) => dataset.asset === assetId)
        ?.focus({ preventScroll: true });
  }

  async function read(incoming, defaultKind, target) {
    if (!incoming.length || importing) return;
    importing = true;
    buttonFor.video.disabled = buttonFor.audio.disabled = true;
    notice("Reading media…");
    const accepted = [];
    const errors = [];
    try {
      for (const file of incoming) {
        try {
          const asset = await inspectLocalFile(
            file,
            target?.kind ?? defaultKind ?? mediaKind(file),
          );
          if (target && !matchesAsset(target, asset)) {
            throw new Error(
              `“${file.name}” does not match the saved source “${target.name}”. Choose the original file.`,
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
        files.set(target.id, accepted[0].file);
        onRelink();
      } else {
        append(accepted);
      }
    } finally {
      releaseInspector();
      notice(errors.join(" "));
      buttonFor.video.disabled = buttonFor.audio.disabled = false;
      importing = false;
    }
  }

  for (const kind of ["video", "audio"]) {
    const input = inputFor[kind];
    buttonFor[kind].addEventListener("click", () => input.click());
    input.addEventListener(
      "change",
      () => void read(readSelection(input), kind),
    );
  }
  list.addEventListener("click", (event) => {
    const assetId = event.target.closest("button[data-asset]")?.dataset.asset;
    const asset = getProject().assets.find((item) => item.id === assetId);
    if (!asset || importing) return;
    if (files.has(assetId)) append([{ asset, file: files.get(assetId) }]);
    else {
      relinkTarget = asset;
      relink.click();
    }
  });
  relink.addEventListener("change", () => {
    const picked = readSelection(relink);
    const target = relinkTarget;
    relinkTarget = undefined;
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

  return { render };
}

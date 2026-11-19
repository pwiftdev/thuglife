import {
  AudioSampleSource,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import { createAudioMixer, CHANNELS, SAMPLE_RATE } from "./export-audio.js";
import { exportDestination } from "./export-output.js";
import { fingerprint, openMedia } from "./media.js";
import {
  audibleTracks,
  exportRange,
  intersects,
  EPSILON,
  outputSize,
  sourceTimeAt,
  timeline,
} from "./project.js";
import { drawFrame, sampleSource } from "./render-frame.js";

const qualities = {
  small: QUALITY_LOW,
  standard: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
};
const audioOptions = {
  numberOfChannels: CHANNELS,
  sampleRate: SAMPLE_RATE,
  bitrate: 160000,
};

async function encoding({ size, fps, quality, audio }, type) {
  const video = {
    ...size,
    frameRate: fps,
    quality: qualities[quality],
    alpha: "discard",
    latencyMode: "quality",
  };
  const audioCodec = type === "mp4" ? "aac" : "opus";
  const videoCodec = type === "mp4" ? "avc" : "vp8";
  if (
    typeof OffscreenCanvas === "undefined" ||
    typeof VideoEncoder === "undefined"
  ) {
    throw new Error(
      "Export needs WebCodecs and OffscreenCanvas. Open the editor over HTTPS or localhost in a compatible desktop browser.",
    );
  }
  if (!(await canEncodeVideo(videoCodec, video))) {
    throw new Error(
      `${type === "mp4" ? "H.264" : "VP8"} cannot encode ${size.width} × ${size.height} at ${fps} fps on this device. Try a smaller size, a different frame rate, or another format.`,
    );
  }
  if (audio && !(await canEncodeAudio(audioCodec, audioOptions))) {
    throw new Error(
      `${audioCodec.toUpperCase()} audio encoding is unavailable in this browser. Try another export format.`,
    );
  }
  return {
    size,
    video: { ...video, codec: videoCodec, keyFrameInterval: 2 },
    audio: audio ? { codec: audioCodec, bitrate: audioOptions.bitrate } : null,
  };
}

async function encodeProject(project, files, handle, signal, saving, brandBitmap) {
  const brand = brandBitmap ? { brand: project.brand, bitmap: brandBitmap } : null;
  const { format, fps } = project.settings;
  const spans = timeline(project.clips);
  const range = exportRange(project, spans);
  const { duration } = range;
  if (duration <= 0)
    throw new Error("Choose a range with video before exporting.");
  const mix = audibleTracks(project, spans, range);
  const { size, video, audio } = await encoding(
    {
      size: outputSize(project),
      fps,
      quality: project.settings.quality,
      audio: mix.enabled,
    },
    format,
  );
  const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
  const open = (id) => {
    const asset = byId.get(id);
    const file = files.get(id);
    if (!file)
      throw new Error(
        `Relink “${asset?.name ?? "missing media"}” before exporting.`,
      );
    return { input: openMedia(file), origin: asset.origin };
  };

  if (handle) {
    const existing = await handle.getFile();
    const sameSize = project.assets.filter(
      (asset) => files.has(asset.id) && asset.size === existing.size,
    );
    if (sameSize.length) {
      const hash = await fingerprint(existing);
      for (const asset of sameSize) {
        if (
          hash ===
          (asset.fingerprint ?? (await fingerprint(files.get(asset.id))))
        ) {
          throw new Error(
            "Choose a different output file to keep the source recording unchanged.",
          );
        }
      }
    }
  }

  signal.throwIfAborted();
  const canvas = new OffscreenCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  const videoSource = new CanvasSource(canvas, video);
  const audioSource = audio && new AudioSampleSource(audio);
  const muxer =
    format === "mp4"
      ? new Mp4OutputFormat({ fastStart: false })
      : new WebMOutputFormat();
  const destination = await exportDestination(handle, muxer.mimeType);
  const output = new Output({ format: muxer, target: destination.target });
  const mixer =
    audioSource &&
    createAudioMixer(
      mix.clips,
      mix.tracks,
      range.start,
      open,
      audioSource,
      signal,
    );
  let success = false;
  try {
    signal.throwIfAborted();
    output.addVideoTrack(videoSource);
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();

    let frame = 0;
    let audioFrame = 0;
    let nextProgress = 0;
    let loaded;
    try {
      for (const span of spans) {
        if (!intersects(span.start, span.end, range)) continue;
        const limit = Math.max(
          1,
          Math.ceil(
            (Math.min(span.end, range.end) - range.start) * fps - EPSILON,
          ),
        );
        if (frame >= limit) continue;
        if (loaded?.id !== span.clip.assetId) {
          loaded?.input.dispose();
          loaded = { id: span.clip.assetId, ...open(span.clip.assetId) };
          loaded.track = await loaded.input.getPrimaryVideoTrack();
        }
        const sink = new VideoSampleSink(loaded.track);
        const { origin } = loaded;
        const timestamps = function* () {
          for (let index = frame; index < limit; index++) {
            yield origin + sourceTimeAt(span, range.start + index / fps);
          }
        };
        for await (const sample of sink.samplesAtTimestamps(timestamps())) {
          const time = frame / fps;
          try {
            signal.throwIfAborted();
            if (!sample)
              throw new Error(
                `Could not decode video at ${(time + range.start).toFixed(3)} seconds in the timeline.`,
              );
            drawFrame(
              ctx,
              sampleSource(sample),
              span,
              project.texts,
              time + range.start,
              undefined,
              brand,
            );
          } finally {
            sample?.close();
          }
          await videoSource.add(time, Math.min(1 / fps, duration - time));
          frame++;
          const until = Math.round(
            Math.min(frame / fps, duration) * SAMPLE_RATE,
          );
          if (mixer && until - audioFrame >= 4096) {
            await mixer.write(audioFrame, until);
            audioFrame = until;
          }
          if (time >= nextProgress) {
            postMessage({
              type: "progress",
              progress: Math.min(0.99, time / duration),
            });
            nextProgress = time + 0.2;
          }
        }
      }
    } finally {
      loaded?.input.dispose();
    }
    if (!frame)
      throw new Error(
        "The timeline is too short to export at this frame rate.",
      );
    await mixer?.write(audioFrame, Math.round(duration * SAMPLE_RATE));
    signal.throwIfAborted();
    await output.finalize();
    signal.throwIfAborted();
    saving();
    const result = await destination.commit();
    success = true;
    return result;
  } finally {
    await mixer?.close();
    if (output.state !== "finalized") await output.cancel().catch(() => {});
    if (!success) await destination.discard();
  }
}

let controller;
let committing = false;
self.onmessage = async ({ data }) => {
  if (data.type === "cancel") {
    if (!committing) controller?.abort();
    return;
  }
  if (data.type === "probe") {
    const result = await Promise.all(
      ["mp4", "webm"].map(async (format) => {
        try {
          await encoding(data.spec, format);
          return [format, null];
        } catch (error) {
          return [format, error.message];
        }
      }),
    );
    postMessage({
      type: "support",
      request: data.request,
      formats: Object.fromEntries(result),
    });
    return;
  }
  if (data.type !== "export" || controller) return;
  controller = new AbortController();
  try {
    const result = await encodeProject(
      data.project,
      data.files,
      data.handle,
      controller.signal,
      () => {
        committing = true;
        postMessage({ type: "saving" });
      },
      data.brandBitmap,
    );
    postMessage({ type: "complete", ...result });
  } catch (error) {
    const storageErrors = {
      QuotaExceededError:
        "Browser storage is full. Use Save to file, free local storage, or export a shorter clip.",
      NotAllowedError:
        "The browser denied access to a local file. Relink your media or choose another export destination.",
      NotFoundError:
        "A local file or destination is no longer available. Relink it or choose another destination.",
      NoModificationAllowedError:
        "The destination is locked. Close it in other apps or save to a different file.",
    };
    const message = storageErrors[error.name] ?? error.message;
    postMessage(
      controller.signal.aborted
        ? { type: "canceled" }
        : { type: "error", message },
    );
  } finally {
    controller = null;
    committing = false;
  }
};

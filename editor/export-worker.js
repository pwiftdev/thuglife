import {
  drawFrame,
  sampleSource
} from "./chunk-7SJCLYDC.js";
import {
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  CanvasSource,
  EPSILON,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  StreamTarget,
  VideoSampleSink,
  WebMOutputFormat,
  audibleTracks,
  audioDuration,
  canEncodeAudio,
  canEncodeVideo,
  clamp,
  exportRange,
  fadeGain,
  fingerprint,
  intersects,
  openMedia,
  outputSize,
  sourceTimeAt,
  timeline
} from "./chunk-3PW7KLAI.js";

// src/export-audio.js
var SAMPLE_RATE = 48e3;
var CHANNELS = 2;
var SKIP = 2e-6;
var BLOCK_FRAMES = 4096;
function downmix(data, frames, channels, target) {
  for (let frame = 0; frame < frames; frame++) {
    const index = frame * channels;
    let left = data[index];
    let right = data[index + 1];
    if (channels === 3) {
      const center = Math.SQRT1_2 * data[index + 2];
      left += center;
      right += center;
    } else if (channels === 4) {
      left = (left + data[index + 2]) * 0.5;
      right = (right + data[index + 3]) * 0.5;
    } else {
      const center = Math.SQRT1_2 * data[index + 2];
      left += center + Math.SQRT1_2 * data[index + channels - 2];
      right += center + Math.SQRT1_2 * data[index + channels - 1];
    }
    target[frame * 2] = left;
    target[frame * 2 + 1] = right;
  }
}
var AudioReader = class {
  constructor(track, origin, layer, time) {
    this.layer = layer;
    this.origin = origin;
    const start = layer.in + Math.max(0, time - layer.start) * layer.speed;
    this.iterator = new AudioSampleSink(track).samples(
      origin + start - 0.1,
      origin + layer.out
    );
    this.buffer = new Float32Array(0);
    this.stereo = new Float32Array(0);
  }
  async advance() {
    const { value, done } = await this.iterator.next();
    this.packet = null;
    if (done) return false;
    try {
      const {
        numberOfChannels: channels,
        numberOfFrames: frames,
        sampleRate: rate,
        timestamp
      } = value;
      const size = channels * frames;
      if (this.buffer.length < size) this.buffer = new Float32Array(size);
      value.copyTo(this.buffer.subarray(0, size), {
        planeIndex: 0,
        format: "f32"
      });
      let data = this.buffer;
      if (channels > 2) {
        if (this.stereo.length < frames * 2)
          this.stereo = new Float32Array(frames * 2);
        downmix(data, frames, channels, this.stereo);
        data = this.stereo;
      }
      this.packet = {
        data,
        stride: Math.min(channels, 2),
        frames,
        rate,
        timestamp,
        end: timestamp + frames / rate
      };
      return true;
    } finally {
      value.close();
    }
  }
  async mix(output, first, last, blockStart, signal) {
    if (this.done) return;
    const layer = this.layer;
    const rate = layer.speed / SAMPLE_RATE;
    const offset = blockStart - layer.start;
    const sourceStart = this.origin + layer.in + offset * layer.speed;
    const seconds = layer.end - layer.start;
    const hasFade = layer.fadeIn > 0 || layer.fadeOut > 0;
    for (let index = first; index < last; ) {
      signal.throwIfAborted();
      const time = sourceStart + index * rate;
      if (!this.packet || time >= this.packet.end - SKIP) {
        if (!await this.advance()) {
          this.done = true;
          return;
        }
        continue;
      }
      const {
        data,
        stride,
        frames,
        rate: sourceRate,
        timestamp,
        end
      } = this.packet;
      if (time < timestamp - SKIP) {
        index += Math.max(1, Math.ceil((timestamp - SKIP - time) / rate));
        continue;
      }
      const limit = Math.min(
        last,
        index + Math.max(1, Math.ceil((end - SKIP - time) / rate))
      );
      const right = stride - 1;
      for (; index < limit; index++) {
        const position = clamp(
          (sourceStart + index * rate - timestamp) * sourceRate,
          0,
          frames - 1
        );
        const frame = Math.floor(position);
        const fraction = position - frame;
        const a = frame * stride;
        const b = Math.min(frames - 1, frame + 1) * stride;
        const gain = hasFade ? layer.volume * fadeGain(layer, offset + index / SAMPLE_RATE, seconds) : layer.volume;
        output[index * 2] += (data[a] + fraction * (data[b] - data[a])) * gain;
        output[index * 2 + 1] += (data[a + right] + fraction * (data[b + right] - data[a + right])) * gain;
      }
    }
  }
  close() {
    return this.iterator.return();
  }
};
function createAudioMixer(spans, audioTracks, origin, open, source, signal) {
  const layers = [
    ...spans.map(({ clip, start, end }) => ({ ...clip, start, end })),
    ...audioTracks.map((track) => ({
      ...track,
      end: track.start + audioDuration(track)
    }))
  ].map((layer) => ({
    ...layer,
    first: Math.ceil((layer.start - origin) * SAMPLE_RATE),
    last: Math.ceil((layer.end - origin) * SAMPLE_RATE)
  })).sort((a, b) => a.first - b.first);
  const active = /* @__PURE__ */ new Set();
  const readers = /* @__PURE__ */ new Map();
  let next = 0;
  async function readerFor(layer, time) {
    if (readers.has(layer.id)) return readers.get(layer.id).reader;
    const { input, origin: origin2 } = open(layer.assetId);
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error("A source audio track could not be read.");
      const reader = new AudioReader(track, origin2, layer, time);
      readers.set(layer.id, { reader, input });
      return reader;
    } catch (error) {
      input.dispose();
      throw error;
    }
  }
  async function closeLayer(id) {
    const entry = readers.get(id);
    if (!entry) return;
    readers.delete(id);
    try {
      await entry.reader.close();
    } finally {
      entry.input.dispose();
    }
  }
  return {
    async write(from, until) {
      for (let start = from; start < until; start += BLOCK_FRAMES) {
        signal.throwIfAborted();
        const count = Math.min(BLOCK_FRAMES, until - start);
        const block = new Float32Array(count * CHANNELS);
        while (layers[next]?.first < start + count) active.add(layers[next++]);
        const blockStart = origin + start / SAMPLE_RATE;
        for (const layer of active) {
          const first = Math.max(0, layer.first - start);
          const last = Math.min(count, layer.last - start);
          if (first < last) {
            const reader = await readerFor(
              layer,
              blockStart + first / SAMPLE_RATE
            );
            await reader.mix(block, first, last, blockStart, signal);
          }
          if (layer.last <= start + count) {
            active.delete(layer);
            await closeLayer(layer.id);
          }
        }
        for (let index = 0; index < block.length; index++)
          block[index] = clamp(block[index], -1, 1);
        const sample = new AudioSample({
          data: block,
          format: "f32",
          numberOfChannels: CHANNELS,
          sampleRate: SAMPLE_RATE,
          timestamp: start / SAMPLE_RATE
        });
        try {
          await source.add(sample);
        } finally {
          sample.close();
        }
      }
    },
    async close() {
      await Promise.allSettled([...readers.keys()].map(closeLayer));
    }
  };
}

// src/export-output.js
var MEMORY_LIMIT = 128 * 1024 * 1024;
var PAGE_SIZE = 1024 * 1024;
async function removeExpiredDownloads(root) {
  const expiry = Date.now() - 30 * 60 * 1e3;
  for await (const [name, entry] of root.entries()) {
    if (entry.kind !== "file" || !/^clip-editor-[0-9a-f-]{36}\.tmp$/.test(name))
      continue;
    try {
      const file = await entry.getFile();
      if (file.size > 0 && file.lastModified < expiry)
        await root.removeEntry(name);
    } catch {
      continue;
    }
  }
}
function memoryDestination(mimeType) {
  const pages = [];
  let length = 0;
  return {
    target: new StreamTarget(
      new WritableStream({
        write({ position, data }) {
          const end = position + data.length;
          if (end > MEMORY_LIMIT) {
            throw new Error(
              "Download exceeded the 128 MB memory limit. Choose Save to file or export a shorter clip."
            );
          }
          length = Math.max(length, end);
          for (let offset = 0; offset < data.length; ) {
            const address = position + offset;
            const index = Math.floor(address / PAGE_SIZE);
            const pageOffset = address % PAGE_SIZE;
            const count = Math.min(
              data.length - offset,
              PAGE_SIZE - pageOffset
            );
            pages[index] ??= new Uint8Array(PAGE_SIZE);
            pages[index].set(data.subarray(offset, offset + count), pageOffset);
            offset += count;
          }
        }
      })
    ),
    commit: () => ({
      blob: new Blob(
        Array.from({ length: Math.ceil(length / PAGE_SIZE) }, (_, index) => {
          const page = pages[index] ?? new Uint8Array(PAGE_SIZE);
          return page.subarray(
            0,
            Math.min(PAGE_SIZE, length - index * PAGE_SIZE)
          );
        }),
        { type: mimeType }
      )
    }),
    discard() {
      pages.length = 0;
    }
  };
}
async function exportDestination(handle, mimeType) {
  let scratch;
  let root;
  if (!handle) {
    try {
      root = await navigator.storage.getDirectory();
    } catch {
      return memoryDestination(mimeType);
    }
    await removeExpiredDownloads(root).catch(() => {
    });
    scratch = `clip-editor-${crypto.randomUUID()}.tmp`;
    handle = await root.getFileHandle(scratch, { create: true });
  }
  let writer;
  try {
    writer = await handle.createWritable();
  } catch (error) {
    if (scratch) await root.removeEntry(scratch).catch(() => {
    });
    throw error;
  }
  return {
    target: new StreamTarget(
      new WritableStream({
        write(chunk) {
          return writer.write(chunk);
        }
      }),
      { chunked: true, chunkSize: 1024 * 1024 }
    ),
    async commit() {
      await writer.close();
      return scratch ? {
        scratch,
        blob: (await handle.getFile()).slice(0, void 0, mimeType)
      } : {};
    },
    async discard() {
      await writer.abort().catch(() => {
      });
      if (scratch) await root.removeEntry(scratch).catch(() => {
      });
    }
  };
}

// src/export-worker.js
var qualities = {
  small: QUALITY_LOW,
  standard: QUALITY_MEDIUM,
  high: QUALITY_HIGH
};
var audioOptions = {
  numberOfChannels: CHANNELS,
  sampleRate: SAMPLE_RATE,
  bitrate: 16e4
};
async function encoding({ size, fps, quality, audio }, type) {
  const video = {
    ...size,
    frameRate: fps,
    quality: qualities[quality],
    alpha: "discard",
    latencyMode: "quality"
  };
  const audioCodec = type === "mp4" ? "aac" : "opus";
  const videoCodec = type === "mp4" ? "avc" : "vp8";
  if (typeof OffscreenCanvas === "undefined" || typeof VideoEncoder === "undefined") {
    throw new Error(
      "Export needs WebCodecs and OffscreenCanvas. Open the editor over HTTPS or localhost in a compatible desktop browser."
    );
  }
  if (!await canEncodeVideo(videoCodec, video)) {
    throw new Error(
      `${type === "mp4" ? "H.264" : "VP8"} cannot encode ${size.width} \xD7 ${size.height} at ${fps} fps on this device. Try a smaller size, a different frame rate, or another format.`
    );
  }
  if (audio && !await canEncodeAudio(audioCodec, audioOptions)) {
    throw new Error(
      `${audioCodec.toUpperCase()} audio encoding is unavailable in this browser. Try another export format.`
    );
  }
  return {
    size,
    video: { ...video, codec: videoCodec, keyFrameInterval: 2 },
    audio: audio ? { codec: audioCodec, bitrate: audioOptions.bitrate } : null
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
      audio: mix.enabled
    },
    format
  );
  const byId = new Map(project.assets.map((asset) => [asset.id, asset]));
  const open = (id) => {
    const asset = byId.get(id);
    const file = files.get(id);
    if (!file)
      throw new Error(
        `Relink \u201C${asset?.name ?? "missing media"}\u201D before exporting.`
      );
    return { input: openMedia(file), origin: asset.origin };
  };
  if (handle) {
    const existing = await handle.getFile();
    const sameSize = project.assets.filter(
      (asset) => files.has(asset.id) && asset.size === existing.size
    );
    if (sameSize.length) {
      const hash = await fingerprint(existing);
      for (const asset of sameSize) {
        if (hash === (asset.fingerprint ?? await fingerprint(files.get(asset.id)))) {
          throw new Error(
            "Choose a different output file to keep the source recording unchanged."
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
  const muxer = format === "mp4" ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat();
  const destination = await exportDestination(handle, muxer.mimeType);
  const output = new Output({ format: muxer, target: destination.target });
  const mixer = audioSource && createAudioMixer(
    mix.clips,
    mix.tracks,
    range.start,
    open,
    audioSource,
    signal
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
            (Math.min(span.end, range.end) - range.start) * fps - EPSILON
          )
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
                `Could not decode video at ${(time + range.start).toFixed(3)} seconds in the timeline.`
              );
            drawFrame(
              ctx,
              sampleSource(sample),
              span,
              project.texts,
              time + range.start,
              void 0,
              brand
            );
          } finally {
            sample?.close();
          }
          await videoSource.add(time, Math.min(1 / fps, duration - time));
          frame++;
          const until = Math.round(
            Math.min(frame / fps, duration) * SAMPLE_RATE
          );
          if (mixer && until - audioFrame >= 4096) {
            await mixer.write(audioFrame, until);
            audioFrame = until;
          }
          if (time >= nextProgress) {
            postMessage({
              type: "progress",
              progress: Math.min(0.99, time / duration)
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
        "The timeline is too short to export at this frame rate."
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
    if (output.state !== "finalized") await output.cancel().catch(() => {
    });
    if (!success) await destination.discard();
  }
}
var controller;
var committing = false;
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
      })
    );
    postMessage({
      type: "support",
      request: data.request,
      formats: Object.fromEntries(result)
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
      data.brandBitmap
    );
    postMessage({ type: "complete", ...result });
  } catch (error) {
    const storageErrors = {
      QuotaExceededError: "Browser storage is full. Use Save to file, free local storage, or export a shorter clip.",
      NotAllowedError: "The browser denied access to a local file. Relink your media or choose another export destination.",
      NotFoundError: "A local file or destination is no longer available. Relink it or choose another destination.",
      NoModificationAllowedError: "The destination is locked. Close it in other apps or save to a different file."
    };
    const message = storageErrors[error.name] ?? error.message;
    postMessage(
      controller.signal.aborted ? { type: "canceled" } : { type: "error", message }
    );
  } finally {
    controller = null;
    committing = false;
  }
};

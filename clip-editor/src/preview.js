import { VideoSampleSink } from "mediabunny";
import { openMedia } from "./media.js";
import {
  clamp,
  durationOf,
  EPSILON,
  fadeGain,
  locate,
  sourceTimeAt,
} from "./project.js";
import { brandLayer } from "./brand.js";
import {
  drawFrame,
  hitText,
  sampleSource,
  videoSource,
} from "./render-frame.js";
import { nativeMedia, nativeTime } from "./native-media.js";
import { createAudioPreview } from "./preview-audio.js";

const PREVIEW_PIXELS = 1280 * 720;
const PREVIEW_EDGE = 1600;

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
    const failure = () =>
      finish(
        new Error(
          element.error?.message ||
            "The browser could not read this media during playback.",
        ),
      );
    const timer = setTimeout(
      () =>
        finish(
          new Error("Playback could not load the requested media in time."),
        ),
      15000,
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

export function createPreview({
  canvas,
  getState,
  onTime,
  onPlaying,
  onError,
}) {
  const ctx = canvas.getContext("2d", { alpha: false });
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
    still = undefined;
    if (releaseInput) {
      input?.dispose();
      input = sink = activeFile = undefined;
    }
  }

  function assetFor(clip, state) {
    return state.assets.get(clip.assetId);
  }

  function paint(source, span, state = getState()) {
    const { width, height } = state.size;
    const scale = Math.min(
      1,
      Math.sqrt(PREVIEW_PIXELS / (width * height)),
      PREVIEW_EDGE / Math.max(width, height),
    );
    const rasterWidth = Math.max(1, Math.round(width * scale));
    const rasterHeight = Math.max(1, Math.round(height * scale));
    if (canvas.width !== rasterWidth || canvas.height !== rasterHeight) {
      canvas.width = rasterWidth;
      canvas.height = rasterHeight;
    }
    ctx.setTransform(rasterWidth / width, 0, 0, rasterHeight / height, 0, 0);
    drawFrame(ctx, source, span, state.project.texts, time, state.size, brandLayer(state.project.brand));
  }

  async function drain() {
    if (decoding) return;
    decoding = true;
    try {
      while (request) {
        const job = request;
        request = undefined;
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
          paint(sampleSource(sample), locate(getState().spans, time));
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
    return (
      Math.abs(still.timestamp - timestamp) < EPSILON ||
      (timestamp >= sample.timestamp &&
        timestamp < sample.timestamp + sample.duration - EPSILON)
    );
  }

  function refresh() {
    if (playback) return;
    const state = getState();
    const span = locate(state.spans, time);
    const file = span && state.files.get(span.clip.assetId);
    if (!file) {
      revision++;
      request = undefined;
      clearStill(true);
      paint(null, span);
      return;
    }
    const timestamp = assetFor(span.clip, state).origin + span.sourceTime;
    if (matchesStill(file, timestamp)) {
      revision++;
      request = undefined;
      paint(sampleSource(still.sample), span);
      return;
    }
    if (still?.file !== file) paint(null, span);
    request = { revision: ++revision, file, timestamp };
    if (activeFile && activeFile !== file) clearStill(true);
    void drain();
  }

  function updateTime(value) {
    time = clamp(value, 0, durationOf(getState().spans));
    onTime(time);
  }

  function pause(redraw = true) {
    if (playback) {
      playback.abort();
      playback = undefined;
      video.clear();
      audio.clear();
      onPlaying(false);
    }
    if (redraw) refresh();
  }

  function seek(value) {
    pause(false);
    updateTime(value);
    refresh();
  }

  async function step(direction) {
    if (stepping) return;
    pause(false);
    const state = getState();
    const span = locate(state.spans, time);
    const file = span && state.files.get(span.clip.assetId);
    if (!file) return;
    stepping = true;
    const stepRevision = ++revision;
    request = undefined;
    const asset = assetFor(span.clip, state);
    const input = openMedia(file);
    const sourceTime = asset.origin + span.sourceTime;
    const cached = matchesStill(file, sourceTime)
      ? still.sample.timestamp
      : undefined;
    let adjacent;
    try {
      const sink = new VideoSampleSink(await input.getPrimaryVideoTrack());
      let timestamp = cached;
      if (timestamp === undefined) {
        const current = await sink.getSample(sourceTime);
        if (!current)
          throw new Error("No video frame could be decoded at the playhead.");
        timestamp = current.timestamp;
        current.close();
      }
      if (direction < 0) {
        if (span.sourceTime > span.clip.in + EPSILON)
          adjacent = await sink.getSample(timestamp - EPSILON);
      } else {
        const iterator = sink.samples(
          timestamp + EPSILON,
          asset.origin + span.clip.out,
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
      if (
        Number.isFinite(relative) &&
        relative >= span.clip.in - EPSILON &&
        relative < span.clip.out
      ) {
        const next =
          span.start +
          (Math.max(relative, span.clip.in) - span.clip.in) / span.clip.speed +
          EPSILON;
        clearStill(activeFile && activeFile !== file);
        still = {
          file,
          timestamp: asset.origin + sourceTimeAt(span, next),
          sample: adjacent,
        };
        adjacent = undefined;
        updateTime(next);
        paint(sampleSource(still.sample), span, state);
      } else if (direction > 0) {
        seek(span.end);
      } else if (
        relative < span.clip.in &&
        time - span.start > EPSILON &&
        timestamp > asset.origin + span.clip.in + EPSILON
      ) {
        seek(span.start);
      } else {
        seek(span.start > 0 ? span.start - EPSILON : 0);
      }
    } catch (error) {
      if (stepRevision === revision) onError(error.message);
    } finally {
      adjacent?.close();
      input.dispose();
      stepping = false;
    }
  }

  async function playFrom(span, state, signal) {
    const asset = assetFor(span.clip, state);
    const file = state.files.get(span.clip.assetId);
    if (!file) throw new Error(`Relink “${asset.name}” to preview this clip.`);

    audio.pause();
    video.set(file);
    const element = video.element;
    element.pause();
    element.playbackRate = span.clip.speed;
    element.muted = span.clip.mute;
    element.volume =
      span.clip.volume *
      fadeGain(span.clip, time - span.start, span.end - span.start);
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
    const overlayTimes = state.project.texts
      .flatMap(({ start, end }) => [start, end])
      .filter((mark) => mark > time && mark < span.end)
      .sort((a, b) => a - b);
    let overlayIndex = 0;
    let lastAlpha;
    try {
      await new Promise((resolve, reject) => {
        const tick = () => {
          if (signal.aborted) return resolve();
          try {
            if (element.error)
              throw new Error(
                element.error.message ||
                  "The recording could not continue playing.",
              );
            const relative = element.currentTime - asset.origin - span.clip.in;
            const position = Math.max(
              time,
              span.start + relative / span.clip.speed,
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
            const alpha = visual
              ? fadeGain(visual, position - span.start, span.end - span.start)
              : 1;
            if (
              fresh ||
              overlayChanged ||
              alpha !== lastAlpha ||
              callback === undefined
            ) {
              lastAlpha = alpha;
              paint(source, span, state);
              fresh = false;
            }
            const volume =
              span.clip.volume *
              fadeGain(span.clip, position - span.start, span.end - span.start);
            if (Math.abs(element.volume - volume) > 0.002)
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
      if (callback !== undefined) element.cancelVideoFrameCallback(callback);
    }
  }

  async function play() {
    if (playback) return pause();
    const state = getState();
    const length = durationOf(state.spans);
    if (!length) return;
    if (time >= length - EPSILON) updateTime(0);
    const controller = new AbortController();
    const { signal } = controller;
    playback = controller;
    audio.prepare(state, time);
    onPlaying(true);
    revision++;
    request = undefined;
    clearStill(true);
    try {
      while (time < length - EPSILON && !signal.aborted) {
        await playFrom(locate(state.spans, time), state, signal);
      }
    } catch (error) {
      if (!signal.aborted) onError(error.message);
    } finally {
      if (playback === controller) pause();
    }
  }

  return {
    seek,
    refresh,
    pause,
    play,
    step,
    hitText(x, y) {
      const state = getState();
      return hitText(
        ctx,
        state.project.texts,
        time,
        x * state.size.width,
        y * state.size.height,
        state.size,
      );
    },
    get time() {
      return time;
    },
    get playing() {
      return Boolean(playback);
    },
  };
}

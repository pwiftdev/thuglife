import { nativeMedia, nativeTime } from "./native-media.js";
import { audioDuration, fadeGain } from "./project.js";

const PREFETCH = 0.25;

export function createAudioPreview(onError) {
  let upcoming = [];
  let next = 0;
  const active = new Map();

  function clear() {
    for (const { media } of active.values()) media.clear();
    active.clear();
    upcoming = [];
    next = 0;
  }

  return {
    clear,
    prepare(state, from) {
      clear();
      upcoming = state.project.audioTracks
        .flatMap((track) => {
          const file = state.files.get(track.assetId);
          const length = audioDuration(track);
          if (
            !file ||
            track.mute ||
            !track.volume ||
            track.start + length <= from
          )
            return [];
          return [
            { track, file, length, asset: state.assets.get(track.assetId) },
          ];
        })
        .sort((a, b) => a.track.start - b.track.start);
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
      for (const [id, entry] of active) {
        const { track, length, media, asset } = entry;
        const element = media.element;
        const offset = at - track.start;
        if (offset >= length) {
          media.clear();
          active.delete(id);
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
          track.in + Math.max(0, offset) * track.speed,
        );
        if (target >= element.duration) {
          element.pause();
          continue;
        }
        const tolerance = element.paused ? 0.018 : 0.065;
        if (
          !element.seeking &&
          Math.abs(element.currentTime - target) > tolerance
        )
          element.currentTime = target;
        if (offset < 0) continue;
        const volume = track.volume * fadeGain(track, offset, length);
        if (
          Math.abs(element.volume - volume) > 0.002 ||
          (volume === 0 && element.volume !== 0)
        )
          element.volume = volume;
        if (element.paused && !element.seeking && !entry.reported) {
          element.play().catch((error) => {
            if (signal.aborted || error.name === "AbortError") return;
            entry.reported = true;
            onError(error.message);
          });
        }
      }
    },
  };
}

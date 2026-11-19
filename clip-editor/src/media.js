import {
  AudioSampleSink,
  BlobSource,
  Input,
  MP4,
  MP3,
  WAVE,
  WEBM,
  OGG,
  ADTS,
  FLAC,
  VideoSampleSink,
} from "mediabunny";
import { id } from "./project.js";

export function openMedia(file) {
  return new Input({
    source: new BlobSource(file, {
      maxCacheSize: 8 * 1024 * 1024,
      handleUnhandledError: () => {},
    }),
    formats: [MP4, WEBM, MP3, WAVE, OGG, ADTS, FLAC],
  });
}

export async function fingerprint(file) {
  const size = 32768;
  const positions = [
    0,
    Math.max(0, Math.floor((file.size - size) / 2)),
    Math.max(0, file.size - size),
  ];
  const pieces = await Promise.all(
    positions.map((position) =>
      file.slice(position, position + size).arrayBuffer(),
    ),
  );
  const bytes = new Uint8Array(
    pieces.reduce((length, piece) => length + piece.byteLength, 0),
  );
  let offset = 0;
  for (const piece of pieces) {
    bytes.set(new Uint8Array(piece), offset);
    offset += piece.byteLength;
  }
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function verifySample(sink, start, kind) {
  for await (const sample of sink.samples(start, start + 0.5)) {
    sample.close();
    return;
  }
  throw new Error(
    `No ${kind} sample could be decoded near the start of the file.`,
  );
}

export async function inspectMedia(file, kind) {
  if (
    !globalThis.crypto?.subtle ||
    (kind === "video" && typeof VideoDecoder === "undefined")
  ) {
    throw new Error(
      "Opening recordings needs WebCodecs and a secure page. Use desktop Chrome or Edge over HTTPS or localhost.",
    );
  }
  const input = openMedia(file);
  try {
    const format = await input.getFormat();
    if (kind === "video" && format !== MP4 && format !== WEBM) {
      throw new Error("Choose an MP4 or WebM recording.");
    }
    const [video, audio, audioTracks] = await Promise.all([
      kind === "video" ? input.getPrimaryVideoTrack() : null,
      input.getPrimaryAudioTrack(),
      input.getAudioTracks(),
    ]);
    const track = kind === "video" ? video : audio;
    if (!track) throw new Error(`No ${kind} track was found.`);
    for (const stream of [video, audio].filter(Boolean)) {
      if (!(await stream.canDecode())) {
        const codec =
          (await stream.getCodecParameterString()) ??
          (await stream.getInternalCodecId());
        throw new Error(
          `This browser cannot decode the ${stream.type} codec (${codec ?? "unknown"}).`,
        );
      }
    }

    const [origin, end, width, height, codec, audioCodec] = await Promise.all([
      track.getFirstTimestamp(),
      track.computeDuration(),
      video?.getDisplayWidth(),
      video?.getDisplayHeight(),
      track.getCodec(),
      audio?.getCodec(),
    ]);
    const duration = end - origin;
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("The file has no playable duration.");

    if (video) await verifySample(new VideoSampleSink(video), origin, "video");
    if (audio)
      await verifySample(
        new AudioSampleSink(audio),
        await audio.getFirstTimestamp(),
        "audio",
      );

    return {
      id: id(),
      kind,
      fingerprint: await fingerprint(file),
      name: file.name,
      size: file.size,
      origin,
      duration,
      width,
      height,
      codec,
      audioCodec,
      audioTracks: audioTracks.length,
    };
  } catch (error) {
    if (error.name === "NotReadableError" || error.name === "NotAllowedError") {
      throw new Error(
        `Cannot read “${file.name}”. Check file permissions and pick it again.`,
      );
    }
    throw new Error(`Could not open “${file.name}”. ${error.message}`, {
      cause: error,
    });
  } finally {
    input.dispose();
  }
}

export function matchesAsset(saved, picked) {
  return (
    saved.size === picked.size &&
    (!saved.fingerprint || saved.fingerprint === picked.fingerprint) &&
    saved.codec === picked.codec &&
    saved.audioCodec === picked.audioCodec &&
    saved.width === picked.width &&
    saved.height === picked.height &&
    Math.abs(saved.duration - picked.duration) < 0.002 &&
    Math.abs(saved.origin - picked.origin) < 0.002
  );
}

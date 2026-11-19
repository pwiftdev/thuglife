import { AudioSample, AudioSampleSink } from "mediabunny";
import { audioDuration, clamp, fadeGain } from "./project.js";

export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
const SKIP = 0.000002;
const BLOCK_FRAMES = 4096;

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

class AudioReader {
  constructor(track, origin, layer, time) {
    this.layer = layer;
    this.origin = origin;
    const start = layer.in + Math.max(0, time - layer.start) * layer.speed;
    this.iterator = new AudioSampleSink(track).samples(
      origin + start - 0.1,
      origin + layer.out,
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
        timestamp,
      } = value;
      const size = channels * frames;
      if (this.buffer.length < size) this.buffer = new Float32Array(size);
      value.copyTo(this.buffer.subarray(0, size), {
        planeIndex: 0,
        format: "f32",
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
        end: timestamp + frames / rate,
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
    for (let index = first; index < last;) {
      signal.throwIfAborted();
      const time = sourceStart + index * rate;
      if (!this.packet || time >= this.packet.end - SKIP) {
        if (!(await this.advance())) {
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
        end,
      } = this.packet;
      if (time < timestamp - SKIP) {
        index += Math.max(1, Math.ceil((timestamp - SKIP - time) / rate));
        continue;
      }
      const limit = Math.min(
        last,
        index + Math.max(1, Math.ceil((end - SKIP - time) / rate)),
      );
      const right = stride - 1;
      for (; index < limit; index++) {
        const position = clamp(
          (sourceStart + index * rate - timestamp) * sourceRate,
          0,
          frames - 1,
        );
        const frame = Math.floor(position);
        const fraction = position - frame;
        const a = frame * stride;
        const b = Math.min(frames - 1, frame + 1) * stride;
        const gain = hasFade
          ? layer.volume *
            fadeGain(layer, offset + index / SAMPLE_RATE, seconds)
          : layer.volume;
        output[index * 2] += (data[a] + fraction * (data[b] - data[a])) * gain;
        output[index * 2 + 1] +=
          (data[a + right] + fraction * (data[b + right] - data[a + right])) *
          gain;
      }
    }
  }

  close() {
    return this.iterator.return();
  }
}

export function createAudioMixer(
  spans,
  audioTracks,
  origin,
  open,
  source,
  signal,
) {
  const layers = [
    ...spans.map(({ clip, start, end }) => ({ ...clip, start, end })),
    ...audioTracks.map((track) => ({
      ...track,
      end: track.start + audioDuration(track),
    })),
  ]
    .map((layer) => ({
      ...layer,
      first: Math.ceil((layer.start - origin) * SAMPLE_RATE),
      last: Math.ceil((layer.end - origin) * SAMPLE_RATE),
    }))
    .sort((a, b) => a.first - b.first);
  const active = new Set();
  const readers = new Map();
  let next = 0;

  async function readerFor(layer, time) {
    if (readers.has(layer.id)) return readers.get(layer.id).reader;
    const { input, origin } = open(layer.assetId);
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error("A source audio track could not be read.");
      const reader = new AudioReader(track, origin, layer, time);
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
              blockStart + first / SAMPLE_RATE,
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
          timestamp: start / SAMPLE_RATE,
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
    },
  };
}

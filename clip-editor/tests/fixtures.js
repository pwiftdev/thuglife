import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const media = (...parts) => join(process.cwd(), "test-output", ...parts);
export function ffmpeg(args, options) {
  return execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", ...args],
    options,
  );
}

export function fixtures(long) {
  mkdirSync(media(), { recursive: true });
  const create = (name, args) => {
    if (!existsSync(media(name))) ffmpeg(["-y", ...args, media(name)]);
  };

  create("landscape.mp4", [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "30",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
  ]);
  create("second.webm", [
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=640x360:r=30:d=3,drawbox=c=yellow:t=fill:enable='gte(t,1.2)'",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=if(gte(t\\,1.2)\\,0.2*sin(2*PI*620*t)\\,0):s=48000",
    "-t",
    "3",
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-c:a",
    "libopus",
  ]);
  create("music.wav", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=930:sample_rate=44100",
    "-t",
    "1.3",
    "-c:a",
    "pcm_s16le",
  ]);
  create("music2.wav", [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=700:sample_rate=48000",
    "-t",
    "2",
    "-c:a",
    "pcm_s16le",
  ]);
  create("vfr.mp4", [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x180:rate=30",
    "-vf",
    "select='eq(mod(n,3),0)+eq(mod(n,3),1)'",
    "-fps_mode",
    "vfr",
    "-t",
    "3",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-an",
  ]);
  create("unsupported.avi", [
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=30:d=0.3",
    "-c:v",
    "mpeg4",
  ]);
  writeFileSync(media("corrupt.mp4"), "This is not a movie.");
  if (long) {
    create("long-segment.mp4", [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1920x1080:rate=60",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000",
      "-t",
      "15",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "4",
      "-b:v",
      "3200k",
      "-maxrate",
      "3300k",
      "-bufsize",
      "3300k",
      "-g",
      "120",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
    ]);
    writeFileSync(media("concat.txt"), "file long-segment.mp4\n".repeat(120));
    create("long.mp4", [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      media("concat.txt"),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
    ]);
  }
}

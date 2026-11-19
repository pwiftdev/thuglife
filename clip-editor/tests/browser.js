import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { ffmpeg, fixtures, media } from "./fixtures.js";

const origin = process.env.EDITOR_URL || "http://127.0.0.1:5181";
const tag = process.env.BROWSER_LABEL || "browser";
const runLong = process.env.LONG_TEST === "1";
fixtures(runLong);

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH,
  channel: process.env.BROWSER_CHANNEL,
  headless: process.env.HEADED !== "1",
});
const runtimeErrors = [];
console.log(tag, browser.version());

async function project() {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => {
    runtimeErrors.push(error.message);
    console.error(error);
  });
  page.on("request", (request) => {
    if (
      !request.url().startsWith(origin + "/") &&
      !request.url().startsWith("blob:")
    ) {
      runtimeErrors.push("Unexpected request: " + request.url());
    }
    if (request.method() !== "GET")
      runtimeErrors.push("Unexpected method: " + request.method());
  });
  await page.goto(origin);
  return page;
}

async function click(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
}
async function set(page, label, value) {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(String(value));
  await field.blur();
}
async function option(page, label, value) {
  await page.getByLabel(label, { exact: true }).selectOption(String(value));
}
async function seek(page, time) {
  await page.locator("#seek").evaluate((input, time) => {
    input.value = time;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, time);
}
async function clipCount(page, count) {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".chip-clip").length === count,
    count,
  );
}
async function importVideo(page, name, count = 1) {
  await page.locator("#video-file").setInputFiles(media(name));
  await clipCount(page, count);
}
async function openExport(page, format) {
  await click(page, "Export");
  await option(page, "Format", format);
  await page.waitForFunction(
    () => !document.querySelector("#export-download").disabled,
  );
}
async function download(page, format, name, open = true) {
  if (open) await openExport(page, format);
  const event = page.waitForEvent("download", { timeout: 60_000 });
  await click(page, "Download");
  const file = await event;
  assert.equal(file.suggestedFilename(), `clip.${format}`);
  const path = media(`${tag}-${name}.${format}`);
  await file.saveAs(path);
  assert.equal(await file.failure(), null);
  return path;
}

function probe(path) {
  return JSON.parse(
    execFileSync("ffprobe", [
      "-v",
      "fatal",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ]),
  );
}
function checkFile(path, { width, height, format, duration, audio, fps = 30 }) {
  const file = probe(path);
  const video = file.streams.find((stream) => stream.codec_type === "video");
  const audioTracks = file.streams.filter(
    (stream) => stream.codec_type === "audio",
  );
  assert.equal(video.width, width);
  assert.equal(video.height, height);
  const [frames, seconds] = video.r_frame_rate.split("/").map(Number);
  assert.ok(Math.abs(frames / seconds - fps) < 0.1);
  assert.ok(
    Math.abs(Number(file.format.duration) - duration) < 0.05,
    file.format.duration,
  );
  assert.equal(video.codec_name, format === "mp4" ? "h264" : "vp8");
  if (audio)
    assert.equal(audioTracks[0]?.codec_name, format === "mp4" ? "aac" : "opus");
  else assert.equal(audioTracks.length, 0);
}

function frame(path, time) {
  return ffmpeg([
    "-ss",
    String(time),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "scale=64:64",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
}

function brightOverlay(image, x, y) {
  let count = 0;
  for (let row = y - 4; row <= y + 4; row++) {
    for (let col = x - 16; col <= x + 16; col++) {
      const index = (row * 64 + col) * 3;
      if (
        image[index] > 208 &&
        image[index + 1] > 208 &&
        image[index + 2] > 208
      )
        count++;
    }
  }
  return count;
}

function tone(path, time, frequency, length = 0.08) {
  const data = ffmpeg([
    "-ss",
    String(time),
    "-i",
    path,
    "-t",
    String(length),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  let cosine = 0;
  let sine = 0;
  for (let index = 0; index < data.length / 4; index++) {
    const sample = data.readFloatLE(index * 4);
    const angle = (index * 2 * Math.PI * frequency) / 48000;
    cosine += sample * Math.cos(angle);
    sine += sample * Math.sin(angle);
  }
  return Math.hypot(cosine, sine) / (data.length / 8);
}

async function browserPlayback(page, path) {
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    input.id = "playback-test-file";
    document.body.append(input);
  });
  await page.locator("#playback-test-file").setInputFiles(path);
  const result = await page.evaluate(async () => {
    const file = document.querySelector("#playback-test-file").files[0];
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;
    try {
      await video.play();
      await new Promise((resolve) => video.requestVideoFrameCallback(resolve));
      return [video.videoWidth, video.videoHeight];
    } finally {
      video.pause();
      URL.revokeObjectURL(url);
    }
  });
  assert.ok(result.every((size) => size > 0));
}

async function vertical() {
  const page = await project();
  await importVideo(page, "landscape.mp4");
  await seek(page, 1);
  await click(page, "Split");
  await seek(page, 3);
  await click(page, "Split");
  await clipCount(page, 3);
  await click(page, "Delete");
  await page.locator(".chip-clip").first().click();
  await click(page, "Delete");
  await clipCount(page, 1);
  await page.locator(".chip-clip").click();
  await option(page, "Output frame", "9:16");
  await option(page, "Output frame", "custom");
  await set(page, "Width (px)", 360);
  await set(page, "Height (px)", 640);
  await set(page, "Crop left (%)", 24);
  await set(page, "Crop right (%)", 10);
  await set(page, "Zoom (%)", 114);
  await set(page, "Position X (%)", 10);
  await seek(page, 0.5);
  await click(page, "Add text");
  await set(page, "Text", "Timed overlay");
  await set(page, "End (s)", 1.5);
  await set(page, "Size (%)", 12);
  await option(page, "Style", "background");
  await seek(page, 0.85);
  await page.waitForTimeout(150);
  const canvas = await page.locator("#preview-canvas").boundingBox();
  assert.ok(
    Math.abs(canvas.width / canvas.height - 360 / 640) < 0.015,
    JSON.stringify(canvas),
  );
  const cx = canvas.x + canvas.width * 0.5;
  const cy = canvas.y + canvas.height * 0.78;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, canvas.y + canvas.height * 0.55, { steps: 5 });
  await page.mouse.up();
  assert.ok(
    Math.abs(
      Number(
        await page.getByLabel("Position Y (%)", { exact: true }).inputValue(),
      ) - 55,
    ) < 1,
  );
  const previewWhite = await page
    .locator("#preview-canvas")
    .evaluate((canvas) => {
      const pixels = canvas
        .getContext("2d")
        .getImageData(70, 330, 220, 44).data;
      let count = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (
          pixels[offset] > 220 &&
          pixels[offset + 1] > 220 &&
          pixels[offset + 2] > 220
        )
          count++;
      }
      return count;
    });
  assert.ok(previewWhite > 100);
  await page.screenshot({ path: media(`${tag}-editor.png`) });
  const path = await download(page, "mp4", "vertical");
  checkFile(path, {
    width: 360,
    height: 640,
    format: "mp4",
    duration: 2,
    audio: true,
  });
  assert.ok(tone(path, 0.2, 440) > 0.04 && tone(path, 1.8, 440) > 0.04);
  const withText = brightOverlay(frame(path, 0.85), 32, 35);
  assert.ok(withText > 6, withText);
  assert.ok(withText > brightOverlay(frame(path, 0.2), 32, 35) + 5);
  assert.ok(withText > brightOverlay(frame(path, 1.7), 32, 35) + 5);
  await browserPlayback(page, path);

  await click(page, "Close");
  await page.reload();
  await clipCount(page, 1);
  await click(page, "Export");
  assert.match(
    await page.locator("#export-support").textContent(),
    /Relink missing media/,
  );
  await click(page, "Close");
  await click(page, "Relink");
  await page.locator("#relink-file").setInputFiles(media("second.webm"));
  await page.waitForFunction(() =>
    document.querySelector("#notice").textContent.includes("does not match"),
  );
  await click(page, "Relink");
  await page.locator("#relink-file").setInputFiles(media("landscape.mp4"));
  await page
    .getByRole("button", { name: "Add to timeline", exact: true })
    .waitFor();
  assert.equal(await page.getByLabel("Crop left (%)").inputValue(), "24");
  await page.locator("#video-file").setInputFiles(media("corrupt.mp4"));
  await page.waitForFunction(() =>
    document.querySelector("#notice").textContent.includes("Could not open"),
  );
  await page.locator("#video-file").setInputFiles(media("unsupported.avi"));
  await page.waitForFunction(() =>
    document.querySelector("#notice").textContent.includes("unsupported.avi"),
  );
  const relink = await download(page, "webm", "relinked");
  checkFile(relink, {
    width: 360,
    height: 640,
    format: "webm",
    duration: 2,
    audio: true,
  });
  await browserPlayback(page, relink);
  await click(page, "Close");
  await page.locator("#video-file").setInputFiles(relink);
  await clipCount(page, 2);
  await page.close();
  console.log(
    "PASS two cuts, vertical custom crop, dragged timed text, MP4/AAC and WebM/Opus playback, restore, relink, wrong source and corrupt input",
  );
}

async function mixed() {
  const page = await project();
  await importVideo(page, "landscape.mp4");
  await set(page, "Source out (s)", 1);
  const source = Array.from(await readFile(media("second.webm")));
  await page.locator("#drop-zone").evaluate((dropZone, source) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File([new Uint8Array(source)], "second.webm", { type: "video/webm" }),
    );
    dropZone.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
    );
  }, source);
  await clipCount(page, 2);
  await set(page, "Source out (s)", 2.5);
  await set(page, "Speed (×)", 2);
  await page
    .locator(".chip-clip")
    .last()
    .dragTo(page.locator(".chip-clip").first());
  assert.equal(
    await page.locator(".chip-clip").first().getAttribute("aria-label"),
    "second.webm",
  );
  await click(page, "Undo");
  assert.equal(
    await page.locator(".chip-clip").first().getAttribute("aria-label"),
    "landscape.mp4",
  );
  await click(page, "Redo");
  assert.equal(
    await page.locator(".chip-clip").first().getAttribute("aria-label"),
    "second.webm",
  );
  await click(page, "Move later");
  await page.locator("#audio-file").setInputFiles(media("music.wav"));
  await page.locator(".chip-audio").waitFor();
  await set(page, "Timeline start (s)", 0.65);
  await set(page, "Source in (s)", 0.1);
  await set(page, "Source out (s)", 1.2);
  await set(page, "Fade in (s)", 0.22);
  await set(page, "Fade out (s)", 0.22);
  await seek(page, 0.6);
  await click(page, "Play");
  await page.waitForFunction(
    () => Number(document.querySelector("#seek").value) > 1.8,
    null,
    { timeout: 8000 },
  );
  await click(page, "Pause");
  const path = await download(page, "webm", "mixed");
  checkFile(path, {
    width: 640,
    height: 360,
    format: "webm",
    duration: 2.25,
    audio: true,
  });
  assert.ok(tone(path, 0.15, 440) > 0.045);
  assert.ok(tone(path, 0.96, 930) > 0.04);
  assert.ok(tone(path, 0.65, 930) < tone(path, 0.96, 930) / 2);
  const atCut = frame(path, 1.12);
  assert.ok(atCut[0] < 45 && atCut[1] < 45 && atCut[2] > 180);
  assert.ok(tone(path, 1.46, 1240) < 0.02);
  const afterSpeed = frame(path, 1.74);
  assert.ok(afterSpeed[0] > 180 && afterSpeed[1] > 180 && afterSpeed[2] < 50);
  assert.ok(tone(path, 1.66, 1240) > 0.07 && tone(path, 2.11, 1240) > 0.07);
  assert.ok(tone(path, 2.03, 930) < 0.015);
  await page.close();
  console.log(
    "PASS two sources, VP9/Opus import, move/undo/redo, preview across a cut, 2× speed, WAV trim/position/fades and output sync",
  );
}

async function variableAndDirect() {
  const page = await project();
  await importVideo(page, "vfr.mp4");
  const step = async (button, time) => {
    await click(page, button);
    await page.waitForFunction(
      (time) =>
        Math.abs(Number(document.querySelector("#seek").value) - time) < 0.003,
      time,
      { timeout: 4000 },
    );
  };
  await step("Next source frame", 1 / 30);
  await step("Next source frame", 3 / 30);
  await step("Previous source frame", 1 / 30);
  await step("Previous source frame", 0);
  await set(page, "Source in (s)", 0.22);
  await set(page, "Source out (s)", 1.76);
  const path = await download(page, "mp4", "vfr");
  checkFile(path, {
    width: 320,
    height: 180,
    format: "mp4",
    duration: 1.54,
    audio: false,
  });

  const original = Array.from(await readFile(media("vfr.mp4")));
  await page.evaluate(async (original) => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("vfr.mp4", { create: true });
    const writer = await handle.createWritable();
    await writer.write(new Uint8Array(original));
    await writer.close();
    window.showSaveFilePicker = async () => handle;
  }, original);
  await click(page, "Save to file");
  await page.waitForFunction(() =>
    document
      .querySelector("#export-status")
      .textContent.includes("Choose a different output file"),
  );
  const bytes = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle("vfr.mp4")).getFile();
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    await root.removeEntry("vfr.mp4");
    return bytes;
  });
  assert.deepEqual(bytes, original);

  await page.evaluate(() => {
    window.showSaveFilePicker = async () =>
      (await navigator.storage.getDirectory()).getFileHandle(
        "direct-test.mp4",
        { create: true },
      );
  });
  await click(page, "Save to file");
  await page.waitForFunction(
    () =>
      document.querySelector("#export-status").textContent === "Video saved.",
  );
  const sizes = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle("direct-test.mp4")).getFile();
    const header = new TextDecoder().decode(
      await file.slice(4, 8).arrayBuffer(),
    );
    await root.removeEntry("direct-test.mp4");
    return { size: file.size, header };
  });
  assert.equal(sizes.header, "ftyp");
  assert.ok(sizes.size > 1000);
  await page.close();
  console.log(
    "PASS variable-rate frame stepping, silent MP4, direct-save writer using a test file handle",
  );
}

async function dragAcross(page, locator, offset) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.keyboard.down("Alt");
  try {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + offset, y, { steps: 10 });
    await page.mouse.up();
  } finally {
    await page.keyboard.up("Alt");
  }
}

async function editMenu(page, label) {
  await page.locator("#edit-menu summary").click();
  await click(page, label);
}

async function advancedEdits() {
  const page = await project();
  await importVideo(page, "landscape.mp4");
  const video = page.locator(".chip-clip");
  let pixelsPerSecond = (await video.boundingBox()).width / 4;
  await dragAcross(page, video.locator(".trim-start"), pixelsPerSecond * 0.5);
  assert.ok(
    Math.abs(
      Number(
        await page.getByLabel("Source in (s)", { exact: true }).inputValue(),
      ) - 0.5,
    ) < 0.015,
  );
  pixelsPerSecond = (await video.boundingBox()).width / 3.5;
  await dragAcross(page, video.locator(".trim-end"), -pixelsPerSecond * 0.5);
  assert.ok(
    Math.abs(
      Number(
        await page.getByLabel("Source out (s)", { exact: true }).inputValue(),
      ) - 3.5,
    ) < 0.02,
  );

  await editMenu(page, "Duplicate");
  await clipCount(page, 2);
  await editMenu(page, "Cut");
  await clipCount(page, 1);
  await seek(page, 1.5);
  await editMenu(page, "Paste at playhead");
  await clipCount(page, 3);
  await click(page, "Undo");
  await clipCount(page, 1);
  await video.click();
  await set(page, "Video fade in (s)", 0.6);
  await set(page, "Saturation (%)", 0);
  await page.getByLabel("Flip horizontal", { exact: true }).check();

  await editMenu(page, "Detach source audio");
  await page.locator(".chip-audio").waitFor();
  await video.click();
  assert.ok(await page.getByLabel("Mute source", { exact: true }).isChecked());
  await page.locator("#audio-file").setInputFiles(media("music.wav"));
  await page.waitForFunction(
    () => document.querySelectorAll(".chip-audio").length === 2,
  );
  await page.locator("#audio-file").setInputFiles(media("music2.wav"));
  await page.waitForFunction(
    () => document.querySelectorAll(".chip-audio").length === 3,
  );
  await set(page, "Speed (×)", 0.5);
  pixelsPerSecond = (await video.boundingBox()).width / 3;
  await dragAcross(
    page,
    page.getByRole("button", { name: "music2.wav", exact: true }),
    pixelsPerSecond * 0.75,
  );
  assert.ok(
    Math.abs(
      Number(
        await page
          .getByLabel("Timeline start (s)", { exact: true })
          .inputValue(),
      ) - 0.75,
    ) < 0.02,
  );
  await seek(page, 1.5);
  await click(page, "Split");
  await page.waitForFunction(
    () => document.querySelectorAll(".chip-audio").length === 4,
  );
  await seek(page, 0.1);
  await editMenu(page, "Mark in");
  await seek(page, 2.4);
  await editMenu(page, "Mark out");
  await page.locator("#range-band").waitFor();
  const file = await download(page, "mp4", "advanced");
  checkFile(file, {
    width: 640,
    height: 360,
    format: "mp4",
    duration: 2.3,
    audio: true,
  });
  assert.ok(tone(file, 0.25, 440) > 0.04);
  assert.ok(tone(file, 0.25, 930) > 0.025);
  assert.ok(tone(file, 0.25, 350) < 0.02);
  assert.ok(tone(file, 0.95, 350) > 0.04);
  assert.ok(tone(file, 2.0, 350) > 0.04);
  const dark = frame(file, 0.01);
  const normal = frame(file, 0.6);
  const mean = (pixels) =>
    pixels.reduce((total, value) => total + value, 0) / pixels.length;
  assert.ok(mean(dark) < mean(normal) / 2);
  assert.ok(
    normal.every(
      (channel, index) =>
        index % 3 === 0 || Math.abs(channel - normal[index - (index % 3)]) < 6,
    ),
  );
  await click(page, "Close");
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".chip-audio").length === 4,
  );
  await page.locator("#range-band").waitFor();
  await page.close();
  console.log(
    "PASS pointer trims, duplicate/cut/paste, flip, video fades and saturation, detachable audio, layered audio drag and split, range export and persistence",
  );
}

async function failedFinalWrite() {
  const page = await project();
  await page.context().route("**/export-worker.js", async (route) => {
    const response = await route.fetch();
    const instrumentation = `
      const originalWritable = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async function(...args) {
        const writer = await originalWritable.apply(this, args);
        if (this.name === "fail-close.mp4") {
          writer.close = () => { throw new DOMException("Simulated disk full", "QuotaExceededError"); };
        }
        return writer;
      };
    `;
    await route.fulfill({
      response,
      body: instrumentation + (await response.text()),
    });
  });
  await importVideo(page, "landscape.mp4");
  await set(page, "Source out (s)", 1);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("fail-close.mp4", { create: true });
    const writer = await handle.createWritable();
    await writer.write("keep this destination");
    await writer.close();
    window.showSaveFilePicker = async () => handle;
    window.exportMessages = [];
    const BrowserWorker = window.Worker;
    window.Worker = class extends BrowserWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", (event) =>
          window.exportMessages.push(event.data.type),
        );
      }
    };
  });
  await openExport(page, "mp4");
  await click(page, "Save to file");
  await page.waitForFunction(() =>
    document
      .querySelector("#export-status")
      .textContent.includes("Browser storage is full"),
  );
  const { before, messages } = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return {
      before: await (
        await (await root.getFileHandle("fail-close.mp4")).getFile()
      ).text(),
      messages: window.exportMessages,
    };
  });
  assert.equal(before, "keep this destination");
  assert.ok(messages.includes("saving"));
  const retry = await download(page, "mp4", "retry-after-write-failure", false);
  checkFile(retry, {
    width: 640,
    height: 360,
    format: "mp4",
    duration: 1,
    audio: true,
  });
  await page.close();
  console.log(
    "PASS local file commit failure after saving began, original destination preserved, and download retry",
  );
}

async function longRecording() {
  const session = await browser.newBrowserCDPSession();
  const currentRss = async () => {
    const { processInfo } = await session.send("SystemInfo.getProcessInfo");
    const ids = processInfo
      .filter(({ type }) => type === "renderer")
      .map(({ id }) => id);
    if (!ids.length) return 0;
    return (
      execFileSync("ps", ["-o", "rss=", "-p", ids.join(",")], {
        encoding: "utf8",
      })
        .trim()
        .split(/\s+/)
        .reduce((total, value) => total + Number(value), 0) / 1024
    );
  };
  const page = await project();
  const baseline = await currentRss();
  let peak = baseline;
  let reading = false;
  const interval = setInterval(async () => {
    if (reading) return;
    reading = true;
    try {
      peak = Math.max(peak, await currentRss());
    } catch {
      /* A renderer may exit between CDP and ps. */
    } finally {
      reading = false;
    }
  }, 170);
  try {
    await importVideo(page, "long.mp4");
    assert.match(await page.locator("#timecode").textContent(), /30:00/);
    const dims = probe(media("long.mp4")).streams[0];
    assert.deepEqual(
      [dims.width, dims.height, dims.r_frame_rate],
      [1920, 1080, "60/1"],
    );
    const snapshot = (previous) => {
      const thumb = document.createElement("canvas");
      thumb.width = 48;
      thumb.height = 27;
      const ctx = thumb.getContext("2d");
      ctx.drawImage(
        document.querySelector("#preview-canvas"),
        0,
        0,
        thumb.width,
        thumb.height,
      );
      const data = ctx.getImageData(0, 0, thumb.width, thumb.height).data;
      if (!previous)
        return data.some((value, index) => index % 4 !== 3 && value > 20)
          ? Array.from(data)
          : null;
      return data.some(
        (value, index) =>
          index % 4 !== 3 && Math.abs(value - previous[index]) > 40,
      );
    };
    const beforeSeek = await page.waitForFunction(snapshot, null);
    const previous = await beforeSeek.jsonValue();
    const raster = await page
      .locator("#preview-canvas")
      .evaluate(({ width, height }) => [width, height]);
    assert.deepEqual(raster, [1280, 720]);
    const seekStart = performance.now();
    await seek(page, 1751.1);
    await page.waitForFunction(snapshot, previous);
    const seekMs = performance.now() - seekStart;
    assert.ok(seekMs < 5000, seekMs);
    await editMenu(page, "Mark in");
    await seek(page, 1775.25);
    await editMenu(page, "Mark out");
    await openExport(page, "mp4");
    await option(page, "Frame rate", 60);
    await click(page, "Download");
    await page.waitForFunction(() =>
      document
        .querySelector("#export-status")
        .textContent.startsWith("Encoding"),
    );
    const wait = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const start = performance.now();
          requestAnimationFrame(() => resolve(performance.now() - start));
        }),
    );
    assert.ok(wait < 250, wait);
    await click(page, "Cancel export");
    await page.waitForFunction(
      () =>
        document.querySelector("#export-status").textContent ===
        "Export canceled.",
    );
    const incompleteFiles = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const names = [];
      for await (const name of root.keys())
        if (name.startsWith("clip-editor-")) names.push(name);
      return names;
    });
    assert.deepEqual(incompleteFiles, []);
    await click(page, "Close");
    await seek(page, 1753.1);
    await editMenu(page, "Mark out");
    const path = await download(page, "mp4", "late");
    checkFile(path, {
      width: 1920,
      height: 1080,
      format: "mp4",
      duration: 2,
      audio: true,
      fps: 60,
    });
    assert.ok(tone(path, 1.2, 440) > 0.04);
    assert.ok(
      peak - baseline < 650,
      `Renderer RSS grew from ${baseline.toFixed(0)} to ${peak.toFixed(0)} MiB`,
    );
    console.log(
      `PASS 30-minute 1080p60 input, late seek ${seekMs.toFixed(0)} ms, export/cancel/retry, UI frame ${wait.toFixed(0)} ms, sampled renderer RSS ${baseline.toFixed(0)} to ${peak.toFixed(0)} MiB`,
    );
  } finally {
    clearInterval(interval);
    await page.close();
    await session.detach();
  }
}

try {
  await vertical();
  await mixed();
  await variableAndDirect();
  await advancedEdits();
  await failedFinalWrite();
  if (runLong) await longRecording();
  assert.deepEqual(runtimeErrors, []);
} finally {
  await browser.close();
}

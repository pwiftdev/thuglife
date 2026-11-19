import assert from "node:assert/strict";
import test from "node:test";
import {
  durationOf,
  exportRange,
  fadeGain,
  history,
  locate,
  moveClip,
  newClip,
  newProject,
  outputSize,
  requiredAssets,
  sourceTimeAt,
  splitClip,
  timeline,
} from "../src/project.js";
import {
  canSplitTimed,
  detachAudio,
  pasteItem,
  splitTimed,
  timelineEdit,
} from "../src/edit-operations.js";
import { deserializeProject } from "../src/local-project.js";
import { activeText } from "../src/render-frame.js";

function projectWithClip() {
  const project = newProject();
  const asset = { id: "asset", duration: 30, width: 1920, height: 1080 };
  project.assets.push(asset);
  project.clips.push({ ...newClip(asset), in: 4, out: 24, speed: 2 });
  return project;
}

test("a split preserves source timestamps and the total duration at both speed extremes", () => {
  for (const speed of [0.5, 2]) {
    const project = projectWithClip();
    project.clips[0].speed = speed;
    const spans = timeline(project.clips);
    const cut = 2.125;
    const result = splitClip(project, spans[0], cut);
    const sections = timeline(result.project.clips);
    assert.equal(result.project.clips[0].out, 4 + cut * speed);
    assert.equal(locate(sections, cut).clip.id, result.id);
    assert.equal(sourceTimeAt(sections[1], cut + 0.5), 4 + (cut + 0.5) * speed);
    assert.equal(durationOf(sections), durationOf(spans));
    assert.equal(project.clips[0].out, 24);
    assert.equal(splitClip(project, spans[0], 0.001), null);
    assert.equal(locate(sections, durationOf(sections)).sourceTime, 23.999999);
  }
});

test("moving and deleting clips leaves source properties intact across undo and redo", () => {
  const project = projectWithClip();
  const initial = splitClip(project, timeline(project.clips)[0], 3).project;
  const undo = history(initial);
  const moved = moveClip(initial.clips, initial.clips[0].id, 1);
  undo.set({ ...initial, clips: moved });
  assert.equal(undo.current.clips[1], initial.clips[0]);
  undo.set({ ...undo.current, clips: [moved[0]] });
  undo.undo();
  assert.deepEqual(undo.current.clips, moved);
  undo.undo();
  assert.equal(undo.current, initial);
  undo.redo();
  assert.deepEqual(undo.current.clips, moved);
  undo.set(initial);
  assert.equal(undo.canRedo, false);
});

test("output sizes keep the selected aspect and use even dimensions", () => {
  const project = projectWithClip();
  project.settings.aspect = "original"; // VICEFEED defaults new projects to 9:16
  assert.deepEqual(outputSize(project), { width: 1920, height: 1080 });
  Object.assign(project.settings, { aspect: "9:16", resolution: "720" });
  assert.deepEqual(outputSize(project), { width: 720, height: 1280 });
  Object.assign(project.settings, {
    aspect: "custom",
    width: 721,
    height: 1281,
  });
  assert.deepEqual(outputSize(project), { width: 722, height: 1282 });
});

test("audio fades and timed overlays honor both edges", () => {
  const track = { fadeIn: 0.5, fadeOut: 0.25 };
  assert.equal(fadeGain(track, 0, 2), 0);
  assert.equal(fadeGain(track, 0.25, 2), 0.5);
  assert.equal(fadeGain(track, 1, 2), 1);
  assert.equal(fadeGain(track, 1.875, 2), 0.5);
  assert.equal(fadeGain(track, 2, 2), 0);
  const overlay = { start: 1.125, end: 1.25, value: "Text" };
  assert.deepEqual(activeText([overlay], 1.124), []);
  assert.deepEqual(activeText([overlay], 1.125), [overlay]);
  assert.deepEqual(activeText([overlay], 1.25), []);
});

test("ripple paste splits at the playhead and keeps the copied source interval", () => {
  const project = projectWithClip();
  const item = project.clips[0];
  const result = pasteItem(
    project,
    timeline(project.clips),
    { kind: "clip", item },
    3,
  );
  assert.equal(result.time, 3);
  assert.deepEqual(
    result.project.clips.map(({ in: start, out }) => [start, out]),
    [
      [4, 10],
      [4, 24],
      [10, 24],
    ],
  );
  const nearEnd = pasteItem(
    project,
    timeline(project.clips),
    { kind: "clip", item },
    9.998,
  );
  assert.equal(nearEnd.time, 10);
  assert.equal(nearEnd.project.clips[0], item);
});

test("split and detach preserve fade timing on independently editable layers", () => {
  const project = projectWithClip();
  Object.assign(project.clips[0], {
    fadeIn: 5,
    visual: { fadeIn: 8, fadeOut: 0 },
  });
  const split = splitClip(project, timeline(project.clips)[0], 3);
  const spans = timeline(split.project.clips);
  const right = spans[1];
  assert.equal(fadeGain(right.clip, 1, 7), 0.8);
  assert.equal(fadeGain(right.clip.visual, 1, 7), 0.5);
  const detached = detachAudio(split.project, right);
  assert.equal(detached.project.clips[1].mute, true);
  const layer = detached.project.audioTracks[0];
  assert.equal(layer.start, 3);
  assert.equal(layer.speed, 2);
  const audioSplit = splitTimed(
    detached.project,
    { kind: "audio", item: layer },
    4,
  );
  const [before, after] = audioSplit.project.audioTracks;
  assert.equal(before.out, after.in);
  assert.equal(fadeGain(after, 0, 6), fadeGain(layer, 1, 7));
  assert.equal(canSplitTimed("audio", { ...layer, speed: 0.5 }, 3.011), false);
});

test("a dragged left audio edge preserves its end and scales source time", () => {
  const item = { start: 1, in: 1, out: 5, speed: 2 };
  const update = timelineEdit({
    kind: "audio",
    item,
    edge: "start",
    delta: 0.5,
    sourceDuration: 8,
    timelineDuration: 8,
  });
  assert.equal(update.in, 2);
  assert.equal(update.start, 1.5);
  assert.equal(update.start + (item.out - update.in) / item.speed, 3);
});

test("export range dependencies include only intersecting video and audible audio", () => {
  const project = projectWithClip();
  const audio = {
    assetId: "wav",
    start: 1,
    in: 0,
    out: 3,
    speed: 1,
    volume: 1,
  };
  project.audioTracks.push(
    audio,
    { ...audio, assetId: "muted", start: 12, mute: true },
    { ...audio, assetId: "needed", start: 12 },
  );
  project.clips.push(newClip({ id: "second", duration: 10 }));
  project.range = { start: 12, end: 18 };
  const spans = timeline(project.clips);
  assert.deepEqual(exportRange(project, spans), {
    start: 12,
    end: 18,
    duration: 6,
  });
  assert.deepEqual([...requiredAssets(project, spans)], ["second", "needed"]);
});

test("loads the previous editor's single-audio project and rejects malformed fields", () => {
  const project = projectWithClip();
  Object.assign(project.assets[0], {
    origin: 0,
    kind: "video",
    size: 500,
    name: "recording.mp4",
  });
  project.assets.push({
    id: "music",
    origin: 0,
    kind: "audio",
    size: 500,
    name: "music.wav",
    duration: 10,
    audioCodec: "pcm",
  });
  const { audioTracks, range, ...old } = project;
  assert.equal(audioTracks.length, 0);
  assert.equal(range, null);
  old.version = 1;
  old.audio = {
    id: "music-track",
    assetId: "music",
    start: 1,
    in: 0,
    out: 8,
    volume: 0.7,
    fadeIn: 0,
    fadeOut: 1,
  };
  const { fadeIn, fadeOut, ...clip } = old.clips[0];
  assert.equal(fadeIn + fadeOut, 0);
  old.clips[0] = clip;
  const restored = deserializeProject(JSON.stringify(old));
  assert.equal(restored.version, 2);
  assert.equal(restored.audioTracks[0].speed, 1);
  assert.equal(restored.clips[0].out, 24);
  restored.clips[0].frame.zoom = -1;
  assert.throws(
    () => deserializeProject(JSON.stringify(restored)),
    /Invalid project/,
  );
});

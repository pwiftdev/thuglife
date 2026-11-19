import { editorItem, timelineEdit } from "./edit-operations.js";
import { byId, node } from "./fields.js";
import {
  audioDuration,
  clamp,
  durationOf,
  exportRange,
  timecode,
} from "./project.js";

const scroll = byId("tracks-scroll");
const root = byId("tracks");
const ruler = byId("ruler");
const videoLane = byId("video-lane");
const textLane = byId("text-lane");
const audioLane = byId("audio-lane");
const playhead = byId("playhead");
const zoom = byId("timeline-zoom");
const seek = byId("seek");
const rangeBand = byId("range-band");
const counter = byId("timecode");
const trackGroup = root.closest(".timeline-lanes");

function tickInterval(minimum) {
  const scale = 10 ** Math.floor(Math.log10(minimum));
  return [1, 2, 5, 10]
    .map((multiple) => multiple * scale)
    .find((value) => value >= minimum);
}

function arrangeRows(entries) {
  const rows = [];
  const items = [...entries]
    .sort((a, b) => a.start - b.start)
    .map((entry) => {
      let row = rows.findIndex((end) => end <= entry.start);
      if (row < 0) row = rows.length;
      rows[row] = entry.end;
      return { ...entry, row };
    });
  return { items, height: 10 + Math.max(1, rows.length) * 32 };
}

function bounds(kind, item, spans) {
  if (kind === "clip") return spans.find(({ clip }) => clip.id === item.id);
  return {
    start: item.start,
    end: kind === "text" ? item.end : item.start + audioDuration(item),
  };
}

export function createTimelineView({
  getState,
  getSelection,
  onSeek,
  onSelect,
  onMove,
  onEdit,
  onPause,
}) {
  let scale = 1;
  let length = 0;
  let lastEnd = 0;
  let trackWidth = 1;
  let viewportWidth = 1;
  let secondsLabel = timecode(0);
  let rulerKey;
  let selectedId;
  let drag;
  let draggedId;
  let frameRequest;
  let skipClick = false;
  const chips = new Map();

  function position(time, scrollIntoView) {
    const x = Math.min(trackWidth - 1, time * scale);
    playhead.style.transform = `translateX(${Math.max(0, x)}px)`;
    if (
      scrollIntoView &&
      (x < scroll.scrollLeft || x > scroll.scrollLeft + viewportWidth - 12)
    ) {
      scroll.scrollLeft = x - viewportWidth / 3;
    }
    if (Number(seek.value) !== time) seek.value = time;
    counter.value = `${timecode(time)} / ${secondsLabel}`;
  }

  function renderRuler() {
    const interval = tickInterval(Math.max(0.001, 95 / scale));
    const from = Math.max(
      0,
      Math.floor(scroll.scrollLeft / scale / interval) - 1,
    );
    const until = Math.min(
      lastEnd,
      (scroll.scrollLeft + viewportWidth) / scale + interval,
    );
    const end = Math.floor(until / interval);
    const key = `${scale}:${interval}:${from}:${end}`;
    if (key === rulerKey) return;
    rulerKey = key;
    const ticks = document.createDocumentFragment();
    for (let index = from; index <= end; index++) {
      const time = index * interval;
      const label = node("span", "tick", timecode(time));
      label.style.left = time * scale + "px";
      ticks.append(label);
    }
    ruler.replaceChildren(ticks);
  }

  function geometry(button, start, end) {
    const left = start * scale + "px";
    const width = Math.max(4, (end - start) * scale) + "px";
    if (button.style.left !== left) button.style.left = left;
    if (button.style.width !== width) button.style.width = width;
  }

  function createChip(kind, id) {
    const button = node("button", `clip-chip chip-${kind}`);
    button.type = "button";
    button.dataset.id = id;
    button.dataset.kind = kind;
    button.setAttribute("aria-pressed", String(selectedId === id));
    button.append(node("span", "chip-label"), node("span", "chip-duration"));
    for (const edge of ["start", "end"]) {
      const handle = node("span", `trim-handle trim-${edge}`);
      handle.dataset.edge = edge;
      handle.setAttribute("aria-hidden", "true");
      button.append(handle);
    }
    button.draggable = kind === "clip";
    chips.set(id, button);
    return button;
  }

  function renderLane(lane, kind, entries, labelFor, used) {
    let next = lane.firstElementChild;
    for (const { item, start, end, row = 0 } of entries) {
      used.add(item.id);
      const button = chips.get(item.id) ?? createChip(kind, item.id);
      if (button !== next) lane.insertBefore(button, next);
      next = button.nextElementSibling;
      const label = labelFor(item);
      const duration = timecode(end - start);
      if (button.firstElementChild.textContent !== label) {
        button.firstElementChild.textContent = label;
        button.setAttribute("aria-label", label);
      }
      if (button.children[1].textContent !== duration)
        button.children[1].textContent = duration;
      const description = `${label} · ${duration}`;
      if (button.title !== description) button.title = description;
      geometry(button, start, end);
      const top = 5 + row * 32 + "px";
      if (button.style.top !== top) button.style.top = top;
    }
  }

  function render() {
    if (drag) return;
    const { project, spans, assets, time } = getState();
    length = durationOf(spans);
    secondsLabel = timecode(length);
    select(getSelection());
    const text = arrangeRows(
      project.texts.map((item) => ({ item, start: item.start, end: item.end })),
    );
    const audio = arrangeRows(
      project.audioTracks.map((item) => ({
        item,
        start: item.start,
        end: item.start + audioDuration(item),
      })),
    );
    lastEnd = length;
    for (const { end } of [...text.items, ...audio.items])
      lastEnd = Math.max(lastEnd, end);
    viewportWidth = Math.max(1, scroll.clientWidth);
    const width = Math.min(
      1_000_000,
      viewportWidth * 2 ** (Number(zoom.value) / 12),
    );
    scale = lastEnd
      ? Math.min(width / (length || lastEnd), 1_000_000 / lastEnd)
      : 1;
    trackWidth = Math.max(viewportWidth, lastEnd * scale);
    root.style.width = trackWidth + "px";
    trackGroup.style.setProperty("--text-lane-height", text.height + "px");
    trackGroup.style.setProperty("--audio-lane-height", audio.height + "px");
    seek.max = length;
    seek.disabled = !length;
    const range = exportRange(project, spans);
    rangeBand.hidden = !project.range || range.duration <= 0;
    if (!rangeBand.hidden) geometry(rangeBand, range.start, range.end);

    const used = new Set();
    const sourceName = (item) => assets.get(item.assetId).name;
    renderLane(
      videoLane,
      "clip",
      spans.map(({ clip, start, end }) => ({ item: clip, start, end })),
      sourceName,
      used,
    );
    renderLane(
      textLane,
      "text",
      text.items,
      (item) => item.value.trim() || "Empty text overlay",
      used,
    );
    renderLane(audioLane, "audio", audio.items, sourceName, used);
    for (const [id, button] of chips) {
      if (used.has(id)) continue;
      chips.delete(id);
      button.remove();
    }
    renderRuler();
    position(time, true);
  }

  function select(selected) {
    const next = selected?.item.id;
    if (selectedId === next) return;
    chips.get(selectedId)?.setAttribute("aria-pressed", "false");
    selectedId = next;
    chips.get(selectedId)?.setAttribute("aria-pressed", "true");
  }

  const pointerTime = (x) =>
    (x - scroll.getBoundingClientRect().left + scroll.scrollLeft) / scale;

  function beginEdit(event, button, edge) {
    const { kind, id } = button.dataset;
    const { project, spans, assets, time } = getState();
    const item = editorItem(project, kind, id);
    const { start, end } = bounds(kind, item, spans);
    const markers = [0, length, time];
    for (const span of spans) {
      if (span.clip.id !== id) markers.push(span.start, span.end);
    }
    for (const track of project.audioTracks) {
      if (track.id !== id)
        markers.push(track.start, track.start + audioDuration(track));
    }
    for (const text of project.texts) {
      if (text.id !== id) markers.push(text.start, text.end);
    }
    onPause();
    onSelect(kind, id, false);
    drag = {
      button,
      edge,
      kind,
      item,
      start,
      end,
      markers,
      sourceDuration: assets.get(item.assetId)?.duration,
      pointer: event.pointerId,
      initial: pointerTime(event.clientX),
      initialX: event.clientX,
    };
    root.setPointerCapture(event.pointerId);
  }

  function editDelta(job, x, unsnapped) {
    const delta = pointerTime(x) - job.initial;
    if (unsnapped) return delta;
    const edges = job.edge === "move" ? [job.start, job.end] : [job[job.edge]];
    let nearest = 7 / scale;
    let snapped = delta;
    for (const edge of edges) {
      for (const mark of job.markers) {
        const distance = Math.abs(mark - edge - delta);
        if (distance < nearest) {
          nearest = distance;
          snapped = mark - edge;
        }
      }
    }
    return snapped;
  }

  function updatePointer(x, alt) {
    if (drag.scrub) {
      onSeek(clamp(pointerTime(x), 0, length));
      return;
    }
    if (Math.abs(x - drag.initialX) < 3 && !drag.moved) return;
    drag.moved = true;
    const { item, kind, edge, start, end } = drag;
    drag.update = timelineEdit({
      ...drag,
      delta: editDelta(drag, x, alt),
      timelineDuration: length,
    });
    const updated = { ...item, ...drag.update };
    const speed = item.speed ?? 1;
    if (kind === "clip") {
      geometry(
        drag.button,
        edge === "start" ? start + (updated.in - item.in) / speed : start,
        edge === "end" ? end + (updated.out - item.out) / speed : end,
      );
    } else {
      const right =
        kind === "text" ? updated.end : updated.start + audioDuration(updated);
      geometry(drag.button, updated.start, right);
    }
  }

  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const button = event.target.closest(".clip-chip");
    if (button) {
      const edge = event.target.closest("[data-edge]")?.dataset.edge;
      if (!edge && button.dataset.kind === "clip") return;
      if (edge) event.preventDefault();
      beginEdit(event, button, edge ?? "move");
    } else if (length) {
      drag = { scrub: true, pointer: event.pointerId };
      root.setPointerCapture(event.pointerId);
      updatePointer(event.clientX, event.altKey);
    }
  });
  root.addEventListener("pointermove", (event) => {
    if (event.pointerId !== drag?.pointer) return;
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = requestAnimationFrame(() => {
      frameRequest = undefined;
      updatePointer(event.clientX, event.altKey);
    });
  });
  function finish(event, committed) {
    if (drag?.pointer !== event.pointerId) return;
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = undefined;
    if (committed && (drag.moved || !drag.scrub))
      updatePointer(event.clientX, event.altKey);
    const { scrub, button, kind, item, update, start, end, moved } = drag;
    drag = undefined;
    if (scrub) return;
    geometry(button, start, end);
    if (moved) {
      skipClick = true;
      setTimeout(() => {
        skipClick = false;
      }, 0);
    }
    if (
      committed &&
      update &&
      Object.entries(update).some(
        ([key, value]) => key !== "envelope" && item[key] !== value,
      )
    )
      onEdit(kind, item.id, update);
    else if (committed && !moved) onSelect(kind, item.id, true);
  }
  root.addEventListener("pointerup", (event) => finish(event, true));
  root.addEventListener("lostpointercapture", (event) => finish(event, false));
  root.addEventListener("click", (event) => {
    const button = event.target.closest(".clip-chip");
    if (button && !skipClick)
      onSelect(button.dataset.kind, button.dataset.id, true);
  });
  root.addEventListener("dragstart", (event) => {
    const button = event.target.closest(".chip-clip");
    if (!button || drag) {
      event.preventDefault();
      return;
    }
    draggedId = button.dataset.id;
    event.dataTransfer.setData("text/plain", draggedId);
    event.dataTransfer.effectAllowed = "move";
  });
  root.addEventListener("dragend", () => {
    draggedId = undefined;
  });
  videoLane.addEventListener("dragover", (event) => {
    if (!draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  videoLane.addEventListener("drop", (event) => {
    if (!draggedId) return;
    event.preventDefault();
    const target = event.target.closest(".chip-clip")?.dataset.id;
    const spans = getState().spans;
    const index = target
      ? spans.findIndex(({ clip }) => clip.id === target)
      : spans.length - 1;
    if (index >= 0) onMove(draggedId, index);
    draggedId = undefined;
  });
  new ResizeObserver(render).observe(scroll);
  scroll.addEventListener("scroll", renderRuler);
  zoom.addEventListener("input", render);
  seek.addEventListener("input", () => onSeek(Number(seek.value)));

  return { render, position, select };
}

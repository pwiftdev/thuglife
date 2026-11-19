import { clamp, locate } from "./project.js";

export function installCanvasEditing({
  canvas,
  preview,
  getState,
  onSelect,
  onDraft,
  onFinish,
}) {
  let drag;
  let scheduled;
  let nextUpdate;
  const position = (event, bounds) => ({
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height,
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const bounds = canvas.getBoundingClientRect();
    const { x, y } = position(event, bounds);
    const text = preview.hitText(x, y);
    const clip = locate(getState().spans, preview.time)?.clip;
    const item = text ?? clip;
    if (!item) return;
    preview.pause();
    const kind = text ? "text" : "clip";
    onSelect(kind, item.id);
    drag = { item, kind, x, y, pointer: event.pointerId, bounds };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("moving-text");
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { x, y } = position(event, drag.bounds);
    const { kind, item } = drag;
    const a = x - drag.x;
    const b = y - drag.y;
    if (kind === "text")
      nextUpdate = { x: clamp(item.x + a, 0, 1), y: clamp(item.y + b, 0, 1) };
    else
      nextUpdate = {
        frame: {
          ...item.frame,
          x: clamp(item.frame.x + a, -1, 1),
          y: clamp(item.frame.y + b, -1, 1),
        },
      };
    if (scheduled) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = undefined;
      onDraft(drag.kind, drag.item.id, nextUpdate);
    });
  });

  function end(event, commit) {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (scheduled) cancelAnimationFrame(scheduled);
    if (commit && nextUpdate) onDraft(drag.kind, drag.item.id, nextUpdate);
    drag = scheduled = nextUpdate = undefined;
    canvas.classList.remove("moving-text");
    onFinish(commit);
  }
  canvas.addEventListener("pointerup", (event) => end(event, true));
  canvas.addEventListener("lostpointercapture", (event) => end(event, false));
}

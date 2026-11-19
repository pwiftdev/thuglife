import {
  inspectMedia
} from "./chunk-3PW7KLAI.js";

// src/media-worker.js
self.onmessage = async ({ data: { file, kind } }) => {
  try {
    postMessage({ asset: await inspectMedia(file, kind) });
  } catch (error) {
    postMessage({ error: error.message });
  }
};

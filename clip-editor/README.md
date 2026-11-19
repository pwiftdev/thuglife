# Clip Editor

A standalone browser editor built with Vicefeed’s HTML, CSS, and JavaScript stack. It runs on its own port and needs no server APIs.

## Run locally

Use Node.js 22 or later and run these commands from `clip-editor/`.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5181. To build for static hosting, run `npm run build` and serve `dist/` over HTTPS or from localhost. The build can be mounted under a subpath.

## Edit and export

Import or drop video and audio. Drag either edge of a timeline item to trim it. Drag video clips to reorder them, or use **Move earlier** and **Move later**. Drag audio or text to reposition it. Edges snap to nearby cuts and the playhead. Hold **Alt** while dragging for fine adjustments. Video edits ripple along the video lane. Audio and text keep their timeline positions.

Use the **Edit** menu for cut, copy, paste, duplicate, and detach source audio. The timeline has one video lane and supports overlapping audio clips and text overlays. Added audio can be split, muted, trimmed, faded, and sped up or slowed down independently. In **Properties**, set the output frame and adjust crop, flip, rotation, color, and video or audio fades. Drag the image or text in the preview to position it.

Use **Split** or **S** to split at the playhead. **Space** toggles playback when focus is outside a control. The arrow keys step through source frames. **Home** and **End** jump to the timeline boundaries. Standard Ctrl or Command shortcuts work for undo, redo, cut, copy, paste, and duplicate.

Use **Mark in** and **Mark out** or **I** and **O** to export a section without changing the edit. **Clear export range** returns to full-timeline export. In **Export**, choose the format, size, frame rate, and quality. **Save to file** opens the browser’s file picker when available. **Download** saves through the browser. Canceling or retrying preserves edits.

## Browsers and codecs

- Desktop Chrome 158 and Edge 157 on macOS passed the browser suite. Runtime support also depends on the OS, encoders, and selected output dimensions.
- Verified recording imports cover MP4 with H.264/AAC and WebM with VP8 or VP9 and Opus. The editor also accepts silent video. Audio imports recognize WAV, MP3, M4A/AAC, Ogg, WebM, and FLAC when the browser can decode their tracks. The separate-track workflow was tested with WAV.
- Exports use H.264/AAC in MP4 or VP8/Opus in WebM when supported. Silent edits export without an audio track. Codec padding can extend reported container duration by a few tens of milliseconds.
- The mix combines primary recording audio with separate audio clips. Speed changes also change pitch. Projects save edits and source references locally. After a reload, use **Relink** with the original files. Earlier single-audio projects reopen with their original track and edits.

## Media pipeline

[Mediabunny](https://mediabunny.dev/) demuxes local files by reading slices. WebCodecs decodes timestamped frames for paused preview and frame stepping. A worker handles import inspection. Native playback updates the preview on new frames and overlay changes. The preview uses the export’s layout at a lower raster resolution. For 1080p output it draws at 1280 × 720, while export draws at the requested resolution. The export worker samples the source by presentation timestamp, draws with OffscreenCanvas, and mixes bounded PCM blocks against the same timeline clock. WebCodecs encodes the result before Mediabunny muxes it into the selected container.

Exports stream to a chosen file or browser-private disk storage. If private disk storage is unavailable, the download fallback caps its buffer at 128 MB. Media and project data stay on the device. The editor uses no network services.

## Verify

```sh
npm test
npm run build
```

Install FFmpeg and FFprobe and start the development server. Run the browser suite with desktop Chrome or Edge.

```sh
BROWSER_CHANNEL=chrome BROWSER_LABEL=chrome LONG_TEST=1 npm run test:browser
BROWSER_CHANNEL=msedge BROWSER_LABEL=edge LONG_TEST=1 npm run test:browser
```

Set `BROWSER_PATH` to use a specific browser binary. The suite generates fixtures and saves output in the ignored `test-output/` folder. Run without `LONG_TEST=1` to skip generating and testing the roughly 700 MB, 30-minute 1080p60 input.

The suite checks pointer trims, range export, motion and color controls, layers, synchronization, variable-rate frame stepping, and reload and relink. With the long fixture it seeks and exports near minute 29 and checks cancellation, cleanup, retry, and renderer memory. Direct-save tests use browser test file handles and include an injected failure during the final write.

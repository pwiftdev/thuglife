import { context } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const serve = process.argv.includes("--serve");

const build = await context({
  absWorkingDir: root,
  entryPoints: {
    app: "src/app.js",
    "export-worker": "src/export-worker.js",
    "media-worker": "src/media-worker.js",

    index: "index.html",
    style: "style.css",
  },
  loader: { ".html": "copy" },
  outdir: process.env.OUTDIR || "dist",
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  legalComments: "linked",
  logLevel: "info",
});

if (serve) {
  await build.watch();
  const { port } = await build.serve({
    host: "127.0.0.1",
    port: Number(process.env.PORT) || 5181,
    servedir: fileURLToPath(new URL("../dist/", import.meta.url)),
  });
  console.log(`Clip editor http://127.0.0.1:${port}`);
} else {
  try {
    await build.rebuild();
  } finally {
    await build.dispose();
  }
}

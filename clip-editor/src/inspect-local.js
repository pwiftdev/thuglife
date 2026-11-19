let worker;

export function releaseInspector() {
  worker?.terminate();
  worker = undefined;
}

export function inspectLocalFile(file, kind) {
  return new Promise((resolve, reject) => {
    worker ??= new Worker(new URL("./media-worker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) =>
      data.error ? reject(new Error(data.error)) : resolve(data.asset);
    worker.onerror = (event) => {
      releaseInspector();
      reject(
        new Error(
          event.message || "The browser could not start the media reader.",
        ),
      );
    };
    worker.postMessage({ file, kind });
  });
}

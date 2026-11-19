import { StreamTarget } from "mediabunny";

const MEMORY_LIMIT = 128 * 1024 * 1024;
const PAGE_SIZE = 1024 * 1024;

async function removeExpiredDownloads(root) {
  const expiry = Date.now() - 30 * 60 * 1000;
  for await (const [name, entry] of root.entries()) {
    if (entry.kind !== "file" || !/^clip-editor-[0-9a-f-]{36}\.tmp$/.test(name))
      continue;
    try {
      const file = await entry.getFile();
      if (file.size > 0 && file.lastModified < expiry)
        await root.removeEntry(name);
    } catch {
      continue;
    }
  }
}

function memoryDestination(mimeType) {
  const pages = [];
  let length = 0;
  return {
    target: new StreamTarget(
      new WritableStream({
        write({ position, data }) {
          const end = position + data.length;
          if (end > MEMORY_LIMIT) {
            throw new Error(
              "Download exceeded the 128 MB memory limit. Choose Save to file or export a shorter clip.",
            );
          }
          length = Math.max(length, end);
          for (let offset = 0; offset < data.length;) {
            const address = position + offset;
            const index = Math.floor(address / PAGE_SIZE);
            const pageOffset = address % PAGE_SIZE;
            const count = Math.min(
              data.length - offset,
              PAGE_SIZE - pageOffset,
            );
            pages[index] ??= new Uint8Array(PAGE_SIZE);
            pages[index].set(data.subarray(offset, offset + count), pageOffset);
            offset += count;
          }
        },
      }),
    ),
    commit: () => ({
      blob: new Blob(
        Array.from({ length: Math.ceil(length / PAGE_SIZE) }, (_, index) => {
          const page = pages[index] ?? new Uint8Array(PAGE_SIZE);
          return page.subarray(
            0,
            Math.min(PAGE_SIZE, length - index * PAGE_SIZE),
          );
        }),
        { type: mimeType },
      ),
    }),
    discard() {
      pages.length = 0;
    },
  };
}

export async function exportDestination(handle, mimeType) {
  let scratch;
  let root;
  if (!handle) {
    try {
      root = await navigator.storage.getDirectory();
    } catch {
      return memoryDestination(mimeType);
    }
    await removeExpiredDownloads(root).catch(() => {});
    scratch = `clip-editor-${crypto.randomUUID()}.tmp`;
    handle = await root.getFileHandle(scratch, { create: true });
  }

  let writer;
  try {
    writer = await handle.createWritable();
  } catch (error) {
    if (scratch) await root.removeEntry(scratch).catch(() => {});
    throw error;
  }
  return {
    target: new StreamTarget(
      new WritableStream({
        write(chunk) {
          return writer.write(chunk);
        },
      }),
      { chunked: true, chunkSize: 1024 * 1024 },
    ),
    async commit() {
      await writer.close();
      return scratch
        ? {
            scratch,
            blob: (await handle.getFile()).slice(0, undefined, mimeType),
          }
        : {};
    },
    async discard() {
      await writer.abort().catch(() => {});
      if (scratch) await root.removeEntry(scratch).catch(() => {});
    },
  };
}

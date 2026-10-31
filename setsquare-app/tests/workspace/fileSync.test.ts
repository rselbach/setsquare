import type { FileId } from "@setsquare/element/types";
import type { BinaryFileData } from "@setsquare/setsquare/types";

import { AccountCache } from "../../workspace/remote/AccountCache";
import { ApiError, RequestFailure } from "../../workspace/remote/ApiError";
import { FileSync } from "../../workspace/remote/fileSync";
import { AccountClient } from "../../workspace/remote/transport";

import { fakeAccountServer } from "./fakeAccountServer";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const OTHER_PNG = "data:image/png;base64,iVBORw0KGgoA";
const id = "paintball" as FileId;

const image = (dataURL: string, version?: number): BinaryFileData => ({
  id,
  mimeType: "image/png",
  dataURL: dataURL as BinaryFileData["dataURL"],
  created: 1000,
  ...(version === undefined ? {} : { version }),
});

const caches: AccountCache[] = [];
let accounts = 0;

const setup = async () => {
  const server = fakeAccountServer({ userId: `greendale-${++accounts}` });
  const uploads = vi.fn();
  const client = new AccountClient({
    session: server.session,
    fetch: (input, init) => {
      if (init?.method === "POST" && String(input) === "/api/files") {
        uploads();
      }
      return server.fetch(input, init);
    },
    onSessionExpired: () => {},
  });
  const cache = await AccountCache.open(window, server.session.user.id);
  caches.push(cache);
  return { server, uploads, cache, files: new FileSync(client, cache) };
};

// another device signed in to the same account
const uploadElsewhere = async (
  server: ReturnType<typeof fakeAccountServer>,
  file: BinaryFileData,
) => {
  const response = await server.fetch("/api/files", {
    method: "POST",
    body: JSON.stringify({ files: [file] }),
    headers: {
      "X-CSRF-Token": server.session.csrfToken,
      "X-Setsquare-Account": server.session.user.id,
    },
  });
  expect(response.ok).toBe(true);
};

const cached = async (cache: AccountCache) => {
  const [file] = await cache.getFiles([id]);
  return file && { dataURL: file.dataURL, version: file.version ?? 1 };
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const cache of caches.splice(0)) {
    cache.close();
  }
});

describe("FileSync", () => {
  it("stages the first rendering of a version until a higher version arrives", async () => {
    const { cache, files } = await setup();
    const writes = vi.spyOn(cache, "saveFiles");
    await files.stage({ [id]: image(PNG) });
    await files.stage({ [id]: image(OTHER_PNG, 1) });
    expect(await cached(cache)).toEqual({ dataURL: PNG, version: 1 });
    expect(writes).toHaveBeenCalledTimes(1);
    await files.stage({ [id]: image(OTHER_PNG, 2) });
    expect(await cached(cache)).toEqual({ dataURL: OTHER_PNG, version: 2 });
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it("uploads each version once and answers with the confirmed bytes", async () => {
    const { server, uploads, files } = await setup();
    const first = await files.save({
      addedFiles: new Map([[id, image(PNG)]]),
    });
    expect(first.savedFiles.get(id)?.dataURL).toBe(PNG);
    const rendering = await files.save({
      addedFiles: new Map([[id, image(OTHER_PNG, 1)]]),
    });
    expect(rendering.savedFiles.get(id)?.dataURL).toBe(PNG);
    expect(uploads).toHaveBeenCalledTimes(1);
    const newer = await files.save({
      addedFiles: new Map([[id, image(OTHER_PNG, 2)]]),
    });
    expect(newer.savedFiles.get(id)?.dataURL).toBe(OTHER_PNG);
    expect(uploads).toHaveBeenCalledTimes(2);
    expect(server.image(id)).toMatchObject({ dataURL: OTHER_PNG, version: 2 });
  });

  it("adopts the bytes another device uploaded first at the same version", async () => {
    const { server, cache, files } = await setup();
    await uploadElsewhere(server, image(PNG));
    const result = await files.save({
      addedFiles: new Map([[id, image(OTHER_PNG)]]),
    });
    expect(result.errors.size).toBe(0);
    expect(result.savedFiles.get(id)?.dataURL).toBe(PNG);
    expect(await cached(cache)).toEqual({ dataURL: PNG, version: 1 });
  });

  it("adopts a higher version another device uploaded instead of older bytes", async () => {
    const { server, files } = await setup();
    await uploadElsewhere(server, image(PNG, 2));
    const result = await files.save({
      addedFiles: new Map([[id, image(OTHER_PNG, 1)]]),
    });
    expect(result.savedFiles.get(id)).toMatchObject({
      dataURL: PNG,
      version: 2,
    });
    expect(server.image(id)).toMatchObject({ dataURL: PNG, version: 2 });
  });

  it("replaces the cached rendering with the server's bytes on download", async () => {
    const { server, cache, files } = await setup();
    await files.stage({ [id]: image(OTHER_PNG) });
    await uploadElsewhere(server, image(PNG));
    const { loadedFiles, erroredFiles } = await files.get([id]);
    expect(loadedFiles.map((file) => file.dataURL)).toEqual([PNG]);
    expect(erroredFiles.size).toBe(0);
    expect(await cached(cache)).toEqual({ dataURL: PNG, version: 1 });
  });

  it("keeps syncing when the device cache cannot keep images", async () => {
    const { server, cache, files } = await setup();
    vi.spyOn(cache, "saveFiles").mockRejectedValue(
      new DOMException("Full", "QuotaExceededError"),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await files.save({
      addedFiles: new Map([[id, image(PNG)]]),
    });
    expect(result.savedFiles.get(id)?.dataURL).toBe(PNG);
    expect(server.image(id)?.dataURL).toBe(PNG);
    const { loadedFiles } = await files.get([id]);
    expect(loadedFiles.map((file) => file.dataURL)).toEqual([PNG]);
    await expect(files.stage({ [id]: image(PNG) })).rejects.toThrow("Full");
  });

  it("uploads images again when the server collected them before a command", async () => {
    const { uploads, files } = await setup();
    await files.save({ addedFiles: new Map([[id, image(PNG)]]) });
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError(400, "missing_files"))
      .mockResolvedValueOnce("saved");
    expect(await files.withFiles([id], run)).toBe("saved");
    expect(run).toHaveBeenCalledTimes(2);
    expect(uploads).toHaveBeenCalledTimes(2);
  });

  it("does not run a command whose images neither the device nor the server has", async () => {
    const { files } = await setup();
    const run = vi.fn(async () => "saved");
    const running = files.withFiles([id], run);
    await expect(running).rejects.toBeInstanceOf(RequestFailure);
    await expect(running).rejects.toHaveProperty("outcome", "not-committed");
    expect(run).not.toHaveBeenCalled();
  });
});

import { webcrypto } from "node:crypto";

import { arrayToMap } from "@setsquare/common";
import { LinearElementEditor } from "@setsquare/element";
import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";
import type { BinaryFileData } from "@setsquare/setsquare/types";

import {
  emptyDrawingContent,
  splitAppState,
} from "../../workspace/drawingAppState";
import { openDatabase, request, transact } from "../../workspace/local/idb";
import { AccountCache } from "../../workspace/remote/AccountCache";
import { ApiError } from "../../workspace/remote/ApiError";
import { RemoteWorkspaceStore } from "../../workspace/remote/RemoteWorkspaceStore";
import { newDrawingMeta } from "../../workspace/types";

import { contentWith, workspaceFixture } from "./helpers";

import type {
  CommandResponse,
  SessionInfo,
  WorkspaceCommand,
  WorkspaceData,
} from "../../workspace/api";
import type { DrawingMeta, DrawingId } from "../../workspace/types";

const stores: RemoteWorkspaceStore[] = [];
let accounts = 0;
const session = (
  account = `greendale-${++accounts}`,
): Extract<SessionInfo, { kind: "signedIn" }> => ({
  kind: "signedIn",
  user: {
    id: account,
    login: "troy-barnes",
    name: "Troy Barnes",
    avatarUrl: "https://avatars.githubusercontent.com/u/123",
  },
  csrfToken: "greendale-csrf-token",
});

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const drawing = () =>
  newDrawingMeta({ name: "Dreamatorium", folderId: null, fileIds: [] }, 1000);

const workspace = (meta: DrawingMeta): WorkspaceData => ({
  folders: [],
  drawings: [meta],
});

const open = async (
  fetch: typeof globalThis.fetch,
  account = session(),
  onSessionExpired = vi.fn(),
) => {
  const store = await RemoteWorkspaceStore.open({
    session: account,
    ownerWindow: window,
    onSessionExpired,
    fetch,
  });
  stores.push(store);
  return store;
};

const file = (id = "dreamatorium" as FileId): BinaryFileData => ({
  id,
  mimeType: "image/png",
  dataURL: "data:image/png;base64,AAAA" as BinaryFileData["dataURL"],
  created: 1000,
});

beforeAll(() => {
  vi.spyOn(window, "crypto", "get").mockReturnValue(webcrypto as Crypto);
});

afterAll(() => vi.restoreAllMocks());

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

describe("RemoteWorkspaceStore", () => {
  it.each([
    [400, "invalid_image"],
    [403, "csrf_failed"],
    [503, "unavailable"],
  ] as const)(
    "preserves each image's refusal (%s %s)",
    async (status, message) => {
      const expired = vi.fn();
      const fetch: typeof globalThis.fetch = async (input) =>
        String(input) === "/api/workspace"
          ? response(workspace(drawing()))
          : response({ error: message }, status);
      const store = await open(fetch, session(), expired);
      const image = file();
      const result = await store.files.save({
        addedFiles: new Map([[image.id, image]]),
      });
      expect(result.errors?.get(image.id)).toEqual(
        new ApiError(status, message),
      );
      expect(result.erroredFiles.get(image.id)).toEqual(image);
      expect(expired).toHaveBeenCalledTimes(status === 403 ? 1 : 0);
    },
  );

  it("uses a newer server image when importing an older local format", async () => {
    const original = file();
    const migrated = {
      ...original,
      dataURL: "data:image/png;base64,BBBB" as BinaryFileData["dataURL"],
      version: 2,
    };
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/workspace") {
        return response(workspace(drawing()));
      }
      return init?.method === "POST"
        ? response({ error: "image_collision" }, 409)
        : response({ files: [migrated] });
    };
    const store = await open(fetch);
    const saved = await store.files.save({
      addedFiles: new Map([[original.id, original]]),
    });
    expect(saved.savedFiles.get(original.id)).toEqual(migrated);
    expect(saved.erroredFiles.size).toBe(0);
  });
  it("uploads a newer image format version while refusing stale bytes", async () => {
    const meta = drawing();
    let stored = file();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input) === "/api/workspace") {
        return response(workspace(meta));
      }
      if (init?.method === "POST") {
        stored = JSON.parse(String(init.body)).files[0];
      }
      return response({ files: [stored] });
    };
    const store = await open(fetch);
    const original = stored;
    await store.files.save({ addedFiles: new Map([[original.id, original]]) });
    const migrated = {
      ...original,
      dataURL: "data:image/png;base64,BBBB" as BinaryFileData["dataURL"],
      version: 2,
    };
    await store.stageFiles({ [migrated.id]: migrated });
    const saved = await store.files.save({
      addedFiles: new Map([[migrated.id, migrated]]),
    });
    expect(saved.savedFiles.get(migrated.id)).toEqual(migrated);
    expect(stored).toEqual(migrated);
    const stale = await store.files.save({
      addedFiles: new Map([[original.id, original]]),
    });
    expect(stale.savedFiles.get(original.id)).toEqual(migrated);
    expect((await store.files.get([migrated.id])).loadedFiles).toEqual([
      migrated,
    ]);
  });
  it("pins credentials, CSRF and account identity on every request", async () => {
    const meta = drawing();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response(workspace(meta)),
    );
    const account = session();
    const store = await open(fetch, account);
    expect(store.getSnapshot().drawings.get(meta.id)).toEqual(meta);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "X-CSRF-Token": account.csrfToken,
        "X-Setsquare-Account": account.user.id,
      },
    });
  });

  it("ignores an older refresh that completes after a newer refresh", async () => {
    const meta = drawing();
    let finishOld: (value: Response) => void = () => {};
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(workspace(meta)))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishOld = resolve)),
      )
      .mockResolvedValueOnce(response(workspace({ ...meta, revision: 3 })));
    const store = await open(fetch);
    const old = store.refresh();
    await store.refresh();
    finishOld(response(workspace({ ...meta, revision: 2 })));
    await old;
    expect(store.getSnapshot().drawings.get(meta.id)?.revision).toBe(3);
  });

  it("retries an uncertain mutation with its original request and base revision", async () => {
    const meta = drawing();
    const next = { ...meta, revision: 2 };
    const saved: CommandResponse = {
      result: { kind: "save", result: { ok: true, meta: next } },
      snapshot: workspace(next),
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(workspace(meta)))
      .mockRejectedValueOnce(new TypeError("Connection lost after commit"))
      .mockResolvedValueOnce(response(saved));
    const store = await open(fetch);
    const listener = vi.fn();
    store.subscribe(listener);
    const result = await store.saveDrawingContent(
      meta.id,
      emptyDrawingContent(meta.name),
      [],
      { baseRevision: 1, requestId: "troy-save" },
    );
    expect(result).toEqual({ ok: true, meta: next });
    expect(fetch.mock.calls[1][1]?.body).toBe(fetch.mock.calls[2][1]?.body);
    expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toMatchObject({
      requestId: "troy-save",
      command: { baseRevision: 1 },
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns conflicts without silently changing the caller's base revision", async () => {
    const meta = drawing();
    const latest = { ...meta, revision: 4 };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(workspace(meta)))
      .mockResolvedValueOnce(
        response({
          result: {
            kind: "save",
            result: { ok: false, reason: "conflict", meta: latest },
          },
          snapshot: workspace(latest),
        }),
      );
    const store = await open(fetch);
    expect(
      await store.saveDrawingContent(
        meta.id,
        emptyDrawingContent(meta.name),
        [],
        {
          baseRevision: 1,
          requestId: "troy-stale-save",
        },
      ),
    ).toEqual({ ok: false, reason: "conflict", meta: latest });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().drawings.get(meta.id)?.revision).toBe(4);
  });

  it("reports expired sessions once and never retries unauthorized mutations", async () => {
    const meta = drawing();
    const expired = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(workspace(meta)))
      .mockImplementation(async () =>
        response({ error: "Sign in again" }, 401),
      );
    const store = await open(fetch, session(), expired);
    await expect(store.refresh()).rejects.toMatchObject({ status: 401 });
    await expect(
      store.trash({ kind: "drawing", id: meta.id }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().drawings.get(meta.id)).toEqual(meta);
  });

  it("restores content and keeps a drawing's view separate for each account", async () => {
    const meta = drawing();
    const arrow = API.createElement({ type: "arrow", id: "troy" });
    const content = {
      ...emptyDrawingContent(meta.name),
      elements: [arrow],
    };
    const fetch: typeof globalThis.fetch = async (input) =>
      String(input) === "/api/workspace"
        ? response(workspace(meta))
        : response({ meta, content });
    const troy = session();
    const first = await open(fetch, troy);
    const opened = await first.openDrawing(meta.id);
    expect(opened?.content.elements.map((element) => element.id)).toEqual([
      "troy",
    ]);
    expect(opened?.view).toBeNull();
    const view = {
      ...splitAppState(getDefaultAppState()).view,
      scrollX: 99,
      scrollY: 120,
      selectedElementIds: { [arrow.id]: true as const },
      selectedLinearElement: new LinearElementEditor(
        arrow,
        arrayToMap([arrow]),
      ),
    };
    await first.saveDrawingView(meta.id, view);
    const sameAccount = await open(fetch, troy);
    const reopened = await sameAccount.openDrawing(meta.id);
    expect(reopened?.content.elements).toMatchObject([
      {
        id: arrow.id,
        type: arrow.type,
        x: arrow.x,
        y: arrow.y,
        points: arrow.points,
      },
    ]);
    expect(reopened?.view).toMatchObject({
      ...view,
      selectedLinearElement: null,
    });
    const otherAccount = await open(fetch);
    expect((await otherAccount.openDrawing(meta.id))?.view).toBeNull();
  });

  it.each([
    {
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
      selectedLinearElement: { elementId: "x", pointerDownState: undefined },
    },
    { scrollX: 0, scrollY: 0, zoom: { value: 0 } },
  ])(
    "opens content and removes only the malformed cached view %j",
    async (view) => {
      const meta = drawing();
      const content = contentWith(meta.name, "troy");
      const fetch: typeof globalThis.fetch = async (input) =>
        String(input) === "/api/workspace"
          ? response(workspace(meta))
          : response({ meta, content });
      const account = session();
      const store = await open(fetch, account);
      const db = await openDatabase(
        `setsquare-account-${account.user.id}`,
        2,
        () => {},
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const image = file();
      try {
        await transact(
          db,
          ["views", "files", "drafts"],
          "readwrite",
          async (tx) => {
            await request(tx.objectStore("views").put(view, meta.id));
            await request(
              tx.objectStore("views").put({ scrollX: 50 }, "other"),
            );
            await request(tx.objectStore("files").put(image, image.id));
            await request(
              tx.objectStore("drafts").put({ id: meta.id }, "recovery"),
            );
          },
        );

        const opened = await store.openDrawing(meta.id);
        expect(opened?.view).toBeNull();
        expect(opened?.content.elements.map((element) => element.id)).toEqual([
          "troy",
        ]);
        expect(warn).toHaveBeenCalled();
        await transact(
          db,
          ["views", "files", "drafts"],
          "readonly",
          async (tx) => {
            expect(
              await request(tx.objectStore("views").get(meta.id)),
            ).toBeUndefined();
            expect(await request(tx.objectStore("views").get("other"))).toEqual(
              { scrollX: 50 },
            );
            expect(
              await request(tx.objectStore("files").get(image.id)),
            ).toEqual(image);
            expect(
              await request(tx.objectStore("drafts").get("recovery")),
            ).toEqual({ id: meta.id });
          },
        );
      } finally {
        warn.mockRestore();
        db.close();
      }
    },
  );

  it("opens server content when reading the optional cached view fails", async () => {
    const meta = drawing();
    const fetch: typeof globalThis.fetch = async (input) =>
      String(input) === "/api/workspace"
        ? response(workspace(meta))
        : response({ meta, content: contentWith(meta.name, "troy") });
    const store = await open(fetch);
    const failed = vi
      .spyOn(AccountCache.prototype, "getView")
      .mockRejectedValue(
        new DOMException("Cannot read views", "InvalidStateError"),
      );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const opened = await store.openDrawing(meta.id);
      expect(opened?.view).toBeNull();
      expect(opened?.content.elements.map((element) => element.id)).toEqual([
        "troy",
      ]);
      expect(warn).toHaveBeenCalled();
    } finally {
      failed.mockRestore();
      warn.mockRestore();
    }
  });

  it("keeps failed image uploads recoverable and uploads them before the drawing", async () => {
    const meta = drawing();
    const image = file();
    const account = session();
    const failingFetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input) === "/api/workspace"
        ? response(workspace(meta))
        : response({ error: "Storage unavailable" }, 503),
    );
    const failed = await open(failingFetch, account);
    const uploaded = await failed.files.save({
      addedFiles: new Map([[image.id, image]]),
    });
    expect(uploaded.savedFiles.size).toBe(0);
    expect(uploaded.erroredFiles.has(image.id)).toBe(true);
    const events: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const path = String(input);
      if (path === "/api/workspace") {
        return response(workspace(meta));
      }
      if (path.startsWith("/api/files?")) {
        return response({ files: [] });
      }
      if (path === "/api/files") {
        events.push("image");
        return response(JSON.parse(String(init?.body)));
      }
      events.push("drawing");
      return response({
        result: {
          kind: "save",
          result: {
            ok: true,
            meta: { ...meta, revision: 2, fileIds: [image.id] },
          },
        },
        snapshot: workspace({ ...meta, revision: 2, fileIds: [image.id] }),
      });
    };
    const recovered = await open(fetch, account);
    expect((await recovered.files.get([image.id])).loadedFiles).toEqual([
      image,
    ]);
    await recovered.saveDrawingContent(
      meta.id,
      emptyDrawingContent(meta.name),
      [image.id],
      {
        baseRevision: 1,
        requestId: "recover-image",
      },
    );
    expect(events).toEqual(["image", "drawing"]);
    const otherAccount = await open(failingFetch);
    expect((await otherAccount.files.get([image.id])).loadedFiles).toEqual([]);
  });

  it("uploads an image again after the server collected it", async () => {
    const meta = drawing();
    const image = file();
    const saved = { ...meta, revision: 2, fileIds: [image.id] };
    let collected = false;
    const events: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const path = String(input);
      if (path === "/api/workspace") {
        return response(workspace(meta));
      }
      if (path === "/api/files") {
        events.push("image");
        collected = false;
        return response(JSON.parse(String(init?.body)));
      }
      if (collected) {
        events.push("missing");
        return response({ error: "missing_files" }, 400);
      }
      events.push("drawing");
      return response({
        result: { kind: "save", result: { ok: true, meta: saved } },
        snapshot: workspace(saved),
      });
    };
    const store = await open(fetch);
    await store.files.save({ addedFiles: new Map([[image.id, image]]) });
    collected = true;
    const result = await store.saveDrawingContent(
      meta.id,
      emptyDrawingContent(meta.name),
      [image.id],
      { baseRevision: 1, requestId: "abed-save" },
    );
    expect(result).toEqual({ ok: true, meta: saved });
    expect(events).toEqual(["image", "missing", "image", "drawing"]);
  });

  it("rejects malformed metadata before changing the cached snapshot", async () => {
    const meta = drawing();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(workspace(meta)))
      .mockResolvedValueOnce(response(workspace({ ...meta, revision: -1 })));
    const store = await open(fetch);
    await expect(store.refresh()).rejects.toThrow();
    expect(store.getSnapshot().drawings.get(meta.id)).toEqual(meta);
  });

  it("waits for its own save before refreshing metadata", async () => {
    const meta = drawing();
    const latest = { ...meta, revision: 2 };
    let finishSave: (response: Response) => void = () => {};
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(workspace(meta)))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishSave = resolve)),
      )
      .mockResolvedValueOnce(response(workspace(latest)));
    const store = await open(fetch);
    const saving = store.saveDrawingContent(
      meta.id,
      emptyDrawingContent(meta.name),
      [],
      {
        baseRevision: 1,
        requestId: "troy-slow-save",
      },
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const refreshing = store.refresh();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    finishSave(
      response({
        result: { kind: "save", result: { ok: true, meta: latest } },
        snapshot: workspace(latest),
      }),
    );
    await Promise.all([saving, refreshing]);
    expect(store.getSnapshot().drawings.get(meta.id)?.revision).toBe(2);
  });

  it("loads available images when one file in a batch is missing", async () => {
    const meta = drawing();
    const image = file();
    const missing = "missing" as FileId;
    const fetch: typeof globalThis.fetch = async (input) => {
      const path = String(input);
      if (path === "/api/workspace") {
        return response(workspace(meta));
      }
      return path.endsWith(`ids=${image.id}`)
        ? response({ files: [image] })
        : response({ error: "Not found" }, 404);
    };
    const store = await open(fetch);
    const loaded = await store.files.get([image.id, missing]);
    expect(loaded.loadedFiles).toEqual([image]);
    expect(loaded.erroredFiles).toEqual(new Map([[missing, true]]));
  });

  it("refuses different image bytes without overwriting the recovery cache", async () => {
    const meta = drawing();
    const image = file();
    const fetch: typeof globalThis.fetch = async (input, init) =>
      String(input) === "/api/workspace"
        ? response(workspace(meta))
        : init?.method === "POST"
        ? response(JSON.parse(String(init.body)))
        : response({ files: [image] });
    const store = await open(fetch);
    await store.files.save({ addedFiles: new Map([[image.id, image]]) });
    await expect(
      store.files.save({
        addedFiles: new Map([
          [
            image.id,
            {
              ...image,
              dataURL:
                "data:image/png;base64,BBBB" as BinaryFileData["dataURL"],
            },
          ],
        ]),
      }),
    ).rejects.toThrow("different image data");
    expect((await store.files.get([image.id])).loadedFiles).toEqual([image]);
  });

  it("uploads images when the device cache cannot keep them", async () => {
    const meta = drawing();
    const image = file();
    const uploads: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const path = String(input);
      if (path === "/api/workspace") {
        return response(workspace(meta));
      }
      if (path === "/api/files") {
        uploads.push(path);
        return response(JSON.parse(String(init?.body)));
      }
      throw new Error(`Unexpected request: ${path}`);
    };
    const store = await open(fetch);
    const cacheSave = vi
      .spyOn(AccountCache.prototype, "saveFiles")
      .mockRejectedValue(new DOMException("Full", "QuotaExceededError"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await store.files.save({
        addedFiles: new Map([[image.id, image]]),
      });
      expect(uploads).toEqual(["/api/files"]);
      expect(result.savedFiles.get(image.id)).toEqual(image);
      expect(result.erroredFiles.size).toBe(0);
      expect(warn).toHaveBeenCalled();
    } finally {
      cacheSave.mockRestore();
      warn.mockRestore();
    }
  });

  it("confirms downloaded images when the device cache cannot keep them", async () => {
    const meta = drawing();
    const image = file();
    const requests: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const path = String(input);
      requests.push(path);
      if (path === "/api/workspace") {
        return response(workspace(meta));
      }
      if (path.startsWith("/api/files?")) {
        return response({ files: [image] });
      }
      if (path === "/api/commands") {
        return response({
          result: {
            kind: "save",
            result: { ok: true, meta: { ...meta, revision: 2 } },
          },
          snapshot: workspace({ ...meta, revision: 2 }),
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    };
    const store = await open(fetch);
    const cacheSave = vi
      .spyOn(AccountCache.prototype, "saveFiles")
      .mockRejectedValue(new DOMException("Full", "QuotaExceededError"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await store.files.get([image.id])).loadedFiles).toEqual([image]);
      requests.length = 0;
      await store.saveDrawingContent(
        meta.id,
        emptyDrawingContent(meta.name),
        [image.id],
        { baseRevision: 1, requestId: "troy-download" },
      );
      expect(requests).toEqual(["/api/commands"]);
    } finally {
      cacheSave.mockRestore();
      warn.mockRestore();
    }
  });

  it("treats a missing drawing as gone and ignores stale thumbnail conflicts", async () => {
    const meta = drawing();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(workspace(meta)))
      .mockResolvedValueOnce(response({ error: "Not found" }, 404))
      .mockResolvedValueOnce(response({ error: "Stale thumbnail" }, 409));
    const store = await open(fetch);
    expect(await store.openDrawing(meta.id)).toBeNull();
    expect(
      await store.saveThumbnail(meta.id, { src: file().dataURL, revision: 1 }),
    ).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("imports browser folders and images in order and resumes without duplicates", async () => {
    const local = workspaceFixture();
    try {
      const source = await local.open();
      const folder = await source.createFolder(null, "Greendale");
      const image = file();
      await source.files.save({ addedFiles: new Map([[image.id, image]]) });
      const meta = await source.createDrawing({
        folderId: folder.id,
        name: "Study group",
        fileIds: [image.id],
      });
      const events: string[] = [];
      const commands: WorkspaceCommand[] = [];
      const fetch: typeof globalThis.fetch = async (input, init) => {
        if (String(input) === "/api/workspace") {
          return response({ folders: [], drawings: [] });
        }
        if (String(input) === "/api/files") {
          events.push("image");
          return response(JSON.parse(String(init?.body)));
        }
        const body: { command: WorkspaceCommand } = JSON.parse(
          String(init?.body),
        );
        commands.push(body.command);
        events.push(body.command.kind);
        const result =
          body.command.kind === "importFolder"
            ? { kind: "folder", folder }
            : { kind: "drawing", drawing: meta };
        return response({
          result,
          snapshot: {
            folders: [folder],
            drawings: body.command.kind === "importDrawing" ? [meta] : [],
          },
        });
      };
      const account = session();
      const store = await open(fetch, account);
      expect(await store.pendingImports(source)).toBe(1);
      expect(await store.importLocalWorkspace(source)).toEqual({
        imported: 1,
        skipped: [],
      });
      expect(events).toEqual(["importFolder", "image", "importDrawing"]);
      const reopened = await open(fetch, account);
      expect(await reopened.pendingImports(source)).toBe(0);
      expect(await reopened.importLocalWorkspace(source)).toEqual({
        imported: 0,
        skipped: [],
      });
      expect(commands).toHaveLength(2);
      expect(source.getSnapshot().drawings.has(meta.id)).toBe(true);
    } finally {
      local.close();
    }
  });

  it("skips drawings it cannot import and imports the rest", async () => {
    const local = workspaceFixture();
    try {
      const source = await local.open();
      const missing = await source.createDrawing({
        folderId: null,
        name: "Missing paintball photo",
        fileIds: ["missing" as FileId],
      });
      const refused = await source.createDrawing({
        folderId: null,
        name: "Too much Chang",
      });
      const accepted = await source.createDrawing({
        folderId: null,
        name: "Study group",
      });
      const imported: string[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (String(input) === "/api/workspace") {
          return response({ folders: [], drawings: [] });
        }
        const body: { command: WorkspaceCommand } = JSON.parse(
          String(init?.body),
        );
        if (body.command.kind !== "importDrawing") {
          throw new Error(`Unexpected ${body.command.kind}`);
        }
        const { meta } = body.command.drawing;
        if (meta.id === refused.id) {
          return response({ error: "invalid_request" }, 400);
        }
        imported.push(meta.name ?? "");
        return response({
          result: { kind: "drawing", drawing: meta },
          snapshot: { folders: [], drawings: [meta] },
        });
      });
      const store = await open(fetch);
      const result = await store.importLocalWorkspace(source);
      expect(result.imported).toBe(1);
      expect(result.skipped.map(({ id }) => id).sort()).toEqual(
        [missing.id, refused.id].sort(),
      );
      expect(imported).toEqual([accepted.name]);
      expect(await store.pendingImports(source)).toBe(2);
      expect(source.getSnapshot().drawings.has(missing.id)).toBe(true);
    } finally {
      local.close();
    }
  });

  it("stops an import when the server cannot be reached", async () => {
    const local = workspaceFixture();
    try {
      const source = await local.open();
      await source.createDrawing({ folderId: null, name: "Study group" });
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(response({ folders: [], drawings: [] }))
        .mockRejectedValue(new TypeError("Failed to fetch"));
      const store = await open(fetch);
      await expect(store.importLocalWorkspace(source)).rejects.toThrow(
        "Failed to fetch",
      );
      expect(await store.pendingImports(source)).toBe(1);
    } finally {
      local.close();
    }
  });
});

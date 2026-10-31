import { arrayToMap } from "@setsquare/common";
import { LinearElementEditor } from "@setsquare/element";
import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import type { FileId } from "@setsquare/element/types";

import type {
  AppState,
  BinaryFileData,
  DataURL,
} from "@setsquare/setsquare/types";

import {
  SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  STORAGE_KEYS,
} from "../../app_constants";
import { createDrawingPersistence } from "../../web/drawingPersistence";
import {
  readAccountRecovery,
  recoverUnavailable,
  replayUnsaved,
  writeUnsaved,
} from "../../web/unsavedJournal";
import { splitAppState } from "../../workspace/drawingAppState";
import { openDatabase, request, transact } from "../../workspace/local/idb";
import { AccountCache } from "../../workspace/remote/AccountCache";
import { RemoteWorkspaceStore } from "../../workspace/remote/RemoteWorkspaceStore";
import { fakeAccountServer } from "../workspace/fakeAccountServer";
import { workspaceFixture } from "../workspace/helpers";

import { savedContent } from "./helpers";

import type {
  AccountDraft,
  DrawingContent,
  OpenedDrawing,
  SaveResult,
} from "../../workspace/types";
import type { WorkspaceStore } from "../../workspace/WorkspaceStore";

type AccountStore = WorkspaceStore &
  Required<
    Pick<
      WorkspaceStore,
      "recoveryKey" | "recoveryStorage" | "recoveryDrafts" | "stageFiles"
    >
  >;

const appState = (name = "Greendale"): AppState => ({
  ...getDefaultAppState(),
  width: 800,
  height: 600,
  offsetTop: 0,
  offsetLeft: 0,
  name,
});

let fixture: ReturnType<typeof workspaceFixture>;
let caches: AccountCache[];
let remotes: RemoteWorkspaceStore[];

beforeEach(() => {
  fixture = workspaceFixture();
  caches = [];
  remotes = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fixture.close();
  for (const cache of caches) {
    cache.close();
  }
  for (const store of remotes) {
    store.close();
  }
  localStorage.clear();
});

/** A browser workspace with an account's recovery bolted on. */
const openLocal = async (account: string): Promise<AccountStore> => {
  const cache = await AccountCache.open(window, account);
  caches.push(cache);
  return Object.assign(await fixture.open(), {
    recoveryKey: account,
    recoveryStorage: window.localStorage,
    recoveryDrafts: {
      save: (draft: Parameters<AccountCache["saveDraft"]>[0]) =>
        cache.saveDraft(draft),
      load: (id: Parameters<AccountCache["loadDrafts"]>[0]) =>
        cache.loadDrafts(id),
      remove: (id: string, notAfter?: number) =>
        cache.removeDraft(id, notAfter),
    },
    stageFiles: (files: Record<string, BinaryFileData>) =>
      cache.saveFiles(Object.values(files)),
  });
};

/** A tab of the account workspace the fake server holds. */
const openRemote = async (server: ReturnType<typeof fakeAccountServer>) => {
  const store = await RemoteWorkspaceStore.open({
    session: server.session,
    ownerWindow: window,
    onSessionExpired: vi.fn(),
    fetch: server.fetch,
  });
  remotes.push(store);
  return store;
};

const openStore = {
  local: openLocal,
  remote: (account: string) =>
    openRemote(fakeAccountServer({ userId: account })),
};

const withDrawing = async <T extends AccountStore>(store: T) => {
  const meta = await store.createDrawing({
    folderId: null,
    name: "Greendale",
    content: savedContent("Greendale", "troy"),
  });
  const drawing = await store.openDrawing(meta.id);
  if (!drawing) {
    throw new Error("The test drawing is missing");
  }
  return { store, drawing };
};

const remoteSession = async () => {
  const server = fakeAccountServer({ userId: fixture.dbName });
  return { server, ...(await withDrawing(await openRemote(server))) };
};

const persistenceFor = (store: AccountStore, drawing: OpenedDrawing) =>
  createDrawingPersistence({
    store,
    drawing,
    ownerWindow: window,
    onNotFound: vi.fn(),
  });

/** One copy of another editor session's draft, as it was at `updatedAt`. */
const draftAt = (
  drawing: OpenedDrawing,
  updatedAt: number,
  ...ids: string[]
): AccountDraft => {
  const { content, view } = splitAppState(appState());
  return {
    id: drawing.meta.id,
    baseRevision: drawing.meta.revision,
    elements: savedContent("Greendale", ...ids).elements,
    appState: { ...content, ...view },
    draftId: "britta",
    generation: `perry-${updatedAt}`,
    updatedAt,
  };
};

describe.each(["local", "remote"] as const)("with a %s store", (kind) => {
  const session = async () =>
    withDrawing(await openStore[kind](fixture.dbName));

  it("serializes overlapping saves and commits the newest edit last", async () => {
    const { store, drawing } = await session();
    const original = store.saveDrawingContent.bind(store);
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let maximum = 0;
    const save = vi
      .spyOn(store, "saveDrawingContent")
      .mockImplementation(async (...args) => {
        active++;
        maximum = Math.max(active, maximum);
        if (save.mock.calls.length === 1) {
          await blocked;
        }
        try {
          return await original(...args);
        } finally {
          active--;
        }
      });
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "troy", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    const first = persistence.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    persistence.save(
      savedContent("Greendale", "troy", "abed").elements,
      appState(),
      {},
      vi.fn(),
    );
    const second = persistence.flush();
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(maximum).toBe(1);
    expect(
      (await store.loadDrawingContent(drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["troy", "abed"]);
    expect(persistence.getSaveState().kind).toBe("saved");
    expect(persistence.unsaved()).toBe(null);
    await persistence.renderThumbnail();
  });

  it("waits for a pause in editing before saving edits made during a save", async () => {
    const { store, drawing } = await session();
    const original = store.saveDrawingContent.bind(store);
    let release = () => {};
    const calledAt: number[] = [];
    const save = vi
      .spyOn(store, "saveDrawingContent")
      .mockImplementation(async (...args) => {
        calledAt.push(Date.now());
        if (save.mock.calls.length < 3) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return original(...args);
      });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const persistence = persistenceFor(store, drawing);
    const edit = (...names: string[]) =>
      persistence.save(
        savedContent("Greendale", ...names).elements,
        appState(),
        {},
        vi.fn(),
      );
    edit("troy", "annie");
    await vi.advanceTimersByTimeAsync(SAVE_TO_LOCAL_STORAGE_TIMEOUT);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    edit("troy", "annie", "abed");
    edit("troy", "annie", "abed", "shirley");
    await vi.advanceTimersByTimeAsync(SAVE_TO_LOCAL_STORAGE_TIMEOUT);
    const saved = new Promise<void>((resolve) =>
      persistence.subscribeSaveState(() => {
        if (persistence.getSaveState().kind === "unsaved") {
          resolve();
        }
      }),
    );
    release();
    await saved;
    const savedAt = Date.now();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(calledAt[1] - savedAt).toBeGreaterThanOrEqual(
      SAVE_TO_LOCAL_STORAGE_TIMEOUT,
    );
    expect(save.mock.calls[1][1].elements.map(({ id }) => id)).toEqual([
      "troy",
      "annie",
      "abed",
      "shirley",
    ]);

    edit("troy", "annie", "abed", "shirley", "pierce");
    const flushed = persistence.flush();
    release();
    await flushed;
    expect(save).toHaveBeenCalledTimes(3);
    expect(persistence.getSaveState().kind).toBe("saved");
    expect(
      (await store.loadDrawingContent(drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["troy", "annie", "abed", "shirley", "pierce"]);
  });

  it("writes nothing for a change the drawing doesn't keep", async () => {
    const { store, drawing } = await session();
    const persistence = persistenceFor(store, drawing);
    const { elements } = savedContent("Greendale", "troy", "annie");
    persistence.save(elements, appState(), {}, vi.fn());
    await persistence.flush();
    const setItem = vi.spyOn(store.recoveryStorage, "setItem");
    const draft = vi.spyOn(store.recoveryDrafts, "save");
    const view = vi.spyOn(store, "saveDrawingView");
    const content = vi.spyOn(store, "saveDrawingContent");
    persistence.save(
      elements,
      { ...appState(), cursorButton: "down" },
      {},
      vi.fn(),
    );
    persistence.save(
      elements,
      { ...appState(), cursorButton: "up", openMenu: "canvas" },
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(setItem.mock.calls.map(([key]) => key)).toEqual([
      STORAGE_KEYS.LOCAL_STORAGE_PREFS,
    ]);
    expect(draft).not.toHaveBeenCalled();
    expect(view).not.toHaveBeenCalled();
    expect(content).not.toHaveBeenCalled();
    expect(persistence.getSaveState().kind).toBe("saved");
    expect(persistence.unsaved()).toBe(null);
  });

  it("replays an unacknowledged write before saving a newer draft", async () => {
    const { store, drawing } = await session();
    const original = store.saveDrawingContent.bind(store);
    let receipt: SaveResult | null = null;
    const ids: Array<string | undefined> = [];
    const save = vi
      .spyOn(store, "saveDrawingContent")
      .mockImplementation(async (id, content, files, options) => {
        ids.push(options?.requestId);
        if (ids.length === 2 && receipt) {
          return receipt;
        }
        const result = await original(id, content, files);
        if (ids.length === 1) {
          receipt = result;
          throw new Error("The acknowledgement was lost");
        }
        return result;
      });
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "troy", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("error");
    const draft = persistence.unsaved();
    expect(draft?.request?.requestId).toBe(ids[0]);
    persistence.save(
      savedContent("Greendale", "troy", "abed").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.retry();
    expect(save).toHaveBeenCalledTimes(3);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    expect((await store.getDrawingMeta(drawing.meta.id))?.revision).toBe(3);
    expect(persistence.getSaveState().kind).toBe("saved");
    await persistence.renderThumbnail();
  });

  it("resends an unacknowledged write after reload exactly as it was sent", async () => {
    const { store, drawing } = await session();
    const sent: Array<{ content: string; requestId?: string }> = [];
    vi.spyOn(store, "saveDrawingContent").mockImplementation(
      async (_id, content, _files, options) => {
        sent.push({
          content: JSON.stringify(content),
          requestId: options?.requestId,
        });
        throw new Error("The acknowledgement was lost");
      },
    );
    const persistence = persistenceFor(store, drawing);
    const rectangle = API.createElement({ type: "rectangle", id: "britta" });
    expect(rectangle.boundElements).toBe(null);
    persistence.save([rectangle], appState(), {}, vi.fn());
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("error");

    const reopened = persistenceFor(store, await replayUnsaved(store, drawing));
    await reopened.flush();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  it("keeps a conflicting draft across reload and recovers it as a copy", async () => {
    const { store, drawing } = await session();
    const original = store.saveDrawingContent.bind(store);
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "troy", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await original(drawing.meta.id, savedContent("Greendale", "abed"), []);
    const newer = await store.openDrawing(drawing.meta.id);
    if (!newer) {
      throw new Error("The updated drawing is missing");
    }
    vi.spyOn(store, "saveDrawingContent").mockResolvedValue({
      ok: false,
      reason: "conflict",
      meta: newer.meta,
    });
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("conflict");
    expect((await persistence.changedElsewhere()).scene).toBe(null);
    const recovered = await replayUnsaved(store, newer);
    expect(recovered.recovered?.elements.map(({ id }) => id)).toEqual([
      "troy",
      "annie",
    ]);
    const reopened = persistenceFor(store, recovered);
    expect(reopened.getSaveState().kind).toBe("conflict");
    expect((await reopened.load()).elements?.map(({ id }) => id)).toEqual([
      "troy",
      "annie",
    ]);
    const copy = await reopened.recoverAsCopy();
    expect(copy?.id).not.toBe(drawing.meta.id);
    expect(
      (await store.loadDrawingContent(drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["abed"]);
    expect(
      copy &&
        (await store.loadDrawingContent(copy.id))?.elements.map(({ id }) => id),
    ).toEqual(["troy", "annie"]);
    expect((await replayUnsaved(store, newer)).recovered).toBeUndefined();
  });

  it("does not commit drawing content when its images fail to upload", async () => {
    const { store, drawing } = await session();
    const fileId = "abed-image" as FileId;
    const file: BinaryFileData = {
      id: fileId,
      dataURL: "data:image/png;base64,AAAA" as DataURL,
      mimeType: "image/png",
      created: 1,
    };
    vi.spyOn(store.files, "save").mockResolvedValue({
      savedFiles: new Map(),
      erroredFiles: new Map([[fileId, file]]),
    });
    const save = vi.spyOn(store, "saveDrawingContent");
    const persistence = persistenceFor(store, drawing);
    const image = API.createElement({ type: "image", fileId });
    const content: DrawingContent = {
      ...savedContent("Greendale"),
      elements: [image],
    };
    persistence.save(content.elements, appState(), { [fileId]: file }, vi.fn());
    await persistence.flush();
    expect(save).not.toHaveBeenCalled();
    expect(persistence.unsaved()).not.toBe(null);
    expect(persistence.getSaveState().kind).toBe("error");
  });

  it("does not read another account's recovery draft", async () => {
    const { store, drawing } = await session();
    vi.spyOn(store, "saveDrawingContent").mockRejectedValue(
      new Error("Offline"),
    );
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(
      (await readAccountRecovery(store, drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["annie"]);
    const other = await openStore[kind](`${fixture.dbName}-abed`);
    expect((await replayUnsaved(other, drawing)).recovered).toBeUndefined();
    await persistence.renderThumbnail();
  });

  it("keeps another tab's draft when this tab finishes a save", async () => {
    const { store, drawing } = await session();
    const first = persistenceFor(store, drawing);
    const second = persistenceFor(store, drawing);
    const save = vi.spyOn(store, "saveDrawingContent");
    save.mockResolvedValueOnce({
      ok: false,
      reason: "conflict",
      meta: drawing.meta,
    });
    first.save(
      savedContent("Greendale", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await first.flush();
    second.save(
      savedContent("Greendale", "abed").elements,
      appState(),
      {},
      vi.fn(),
    );
    await second.flush();
    const recovered = await readAccountRecovery(store, drawing.meta.id);
    expect(recovered?.elements.map(({ id }) => id)).toEqual(["annie"]);
    await second.renderThumbnail();
  });

  it.each([
    ["IndexedDB", "localStorage"],
    ["localStorage", "IndexedDB"],
  ] as const)(
    "retires a recovered draft's older %s copy with its newer %s one",
    async (older, newer) => {
      const { store, drawing } = await session();
      const write = {
        IndexedDB: (draft: AccountDraft) => store.recoveryDrafts.save(draft),
        localStorage: async (draft: AccountDraft) =>
          expect(
            writeUnsaved(draft, store.recoveryKey, store.recoveryStorage),
          ).toBe(true),
      };
      await write[older](draftAt(drawing, 1_000, "annie"));
      await write[newer](draftAt(drawing, 2_000, "annie", "abed"));
      const recovered = await replayUnsaved(store, drawing);
      expect(recovered.recovered?.elements.map(({ id }) => id)).toEqual([
        "annie",
        "abed",
      ]);
      const persistence = persistenceFor(store, recovered);
      await persistence.flush();
      expect(persistence.getSaveState().kind).toBe("saved");
      expect(await readAccountRecovery(store, drawing.meta.id)).toBe(null);
    },
  );

  it("keeps a recovered draft's copy written after this tab adopted it", async () => {
    const { store, drawing } = await session();
    await store.recoveryDrafts.save(draftAt(drawing, 1_000, "annie"));
    const persistence = persistenceFor(
      store,
      await replayUnsaved(store, drawing),
    );
    const newer = draftAt(drawing, 2_000, "annie", "abed");
    await store.recoveryDrafts.save(newer);
    writeUnsaved(newer, store.recoveryKey, store.recoveryStorage);
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("saved");
    expect(
      (await readAccountRecovery(store, drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["annie", "abed"]);
    localStorage.clear();
    expect(
      (await readAccountRecovery(store, drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["annie", "abed"]);
  });

  it("reports a replayed receipt older than the drawing as changed elsewhere", async () => {
    const { store, drawing } = await session();
    const original = store.saveDrawingContent.bind(store);
    const receipt = await original(
      drawing.meta.id,
      savedContent("Greendale", "annie"),
      [],
    );
    await original(drawing.meta.id, savedContent("Greendale", "abed"), [], {
      baseRevision: 2,
      requestId: "shirley",
    });
    expect(store.getSnapshot().drawings.get(drawing.meta.id)?.revision).toBe(3);
    vi.spyOn(store, "saveDrawingContent").mockResolvedValue(receipt);
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    const state = persistence.getSaveState();
    expect(state.kind).toBe("conflict");
    expect(state.kind === "conflict" && state.meta.revision).toBe(3);
    expect(
      (await readAccountRecovery(store, drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["annie"]);
  });

  it("discards a conflicting draft and leaves no recovery behind", async () => {
    const { store, drawing } = await session();
    await store.recoveryDrafts.save(draftAt(drawing, 1_000, "annie"));
    await store.saveDrawingContent(
      drawing.meta.id,
      savedContent("Greendale", "abed"),
      [],
    );
    const newer = await store.openDrawing(drawing.meta.id);
    if (!newer) {
      throw new Error("The updated drawing is missing");
    }
    const persistence = persistenceFor(
      store,
      await replayUnsaved(store, newer),
    );
    expect(persistence.getSaveState().kind).toBe("conflict");
    persistence.save(
      savedContent("Greendale", "annie", "troy").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.discard();
    expect(persistence.unsaved()).toBe(null);
    expect(await readAccountRecovery(store, drawing.meta.id)).toBe(null);
    expect(
      (await store.loadDrawingContent(drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["abed"]);
  });

  it("opens a preserved draft after the server drawing is deleted", async () => {
    const { store, drawing } = await session();
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await store.deleteForever({ kind: "drawing", id: drawing.meta.id });
    await persistence.flush();
    const recovered = await recoverUnavailable(
      store,
      drawing.meta.id,
      "missing",
    );
    expect(recovered?.recovered?.elements.map(({ id }) => id)).toEqual([
      "annie",
    ]);
    if (!recovered) {
      throw new Error("The deleted drawing's draft is missing");
    }
    const reopened = persistenceFor(store, recovered);
    expect(reopened.getSaveState().kind).toBe("missing");
    const copy = await reopened.recoverAsCopy();
    expect(
      copy &&
        (await store.loadDrawingContent(copy.id))?.elements.map(({ id }) => id),
    ).toEqual(["annie"]);
  });

  it("includes edits made while a recovered copy is being created", async () => {
    const { store, drawing } = await session();
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    vi.spyOn(store, "saveDrawingContent").mockResolvedValueOnce({
      ok: false,
      reason: "conflict",
      meta: drawing.meta,
    });
    await persistence.flush();
    const create = store.createDrawing.bind(store);
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const creating = vi
      .spyOn(store, "createDrawing")
      .mockImplementation(async (input) => {
        await blocked;
        return create(input);
      });
    const copying = persistence.recoverAsCopy();
    await vi.waitFor(() => expect(creating).toHaveBeenCalledTimes(1));
    persistence.save(
      savedContent("Greendale", "annie", "abed").elements,
      appState(),
      {},
      vi.fn(),
    );
    release();
    const copy = await copying;
    expect(
      copy &&
        (await store.loadDrawingContent(copy.id))?.elements.map(({ id }) => id),
    ).toEqual(["annie", "abed"]);
    expect(persistence.unsaved()).toBe(null);
  });

  it("keeps recovery in IndexedDB when the synchronous fallback is full", async () => {
    const { store, drawing } = await session();
    vi.spyOn(store.recoveryStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    vi.spyOn(store, "saveDrawingContent").mockRejectedValue(
      new Error("Offline"),
    );
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.hasDurableDraft()).toBe(true);
    expect(persistence.getRecoveryError()).toBe(null);
    expect(
      (await readAccountRecovery(store, drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["annie"]);
  });

  it("reads valid IndexedDB drafts past an unreadable one and can remove it", async () => {
    const { store, drawing } = await session();
    vi.spyOn(store.recoveryStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    vi.spyOn(store, "saveDrawingContent").mockRejectedValue(
      new Error("Offline"),
    );
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    const cache = await AccountCache.open(window, fixture.dbName);
    caches.push(cache);
    const [valid] = await cache.loadDrafts(drawing.meta.id);
    const db = await openDatabase(
      `setsquare-account-${fixture.dbName}`,
      2,
      () => {},
    );
    await transact(db, ["drafts"], "readwrite", (tx) =>
      request(
        tx.objectStore("drafts").put(
          {
            ...JSON.parse(JSON.stringify(valid)),
            draftId: "pierce",
            generation: "hawthorne",
            elements: [{ id: "x", type: "unknown" }],
          },
          "pierce",
        ),
      ),
    );
    const stored = () =>
      transact(db, ["drafts"], "readonly", (tx) =>
        request(tx.objectStore("drafts").getAllKeys()),
      );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      (await cache.loadDrafts(drawing.meta.id)).map(({ draftId }) => draftId),
    ).toEqual([valid.draftId]);
    expect(
      (await readAccountRecovery(store, drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["annie"]);
    await cache.removeDraft("pierce", valid.updatedAt - 1);
    expect(await stored()).toContain("pierce");
    await cache.removeDraft("pierce", valid.updatedAt);
    expect(await stored()).toEqual([valid.draftId]);
    db.close();
  });

  it("reports failed local recovery and detects image bytes still being staged", async () => {
    const { store, drawing } = await session();
    vi.spyOn(store.recoveryStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    vi.spyOn(store.recoveryDrafts, "save").mockRejectedValue(
      new Error("IndexedDB full"),
    );
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(store, "stageFiles").mockReturnValue(blocked);
    vi.spyOn(store, "saveDrawingContent").mockRejectedValue(
      new Error("Offline"),
    );
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    expect(persistence.hasDurableDraft()).toBe(false);
    const saving = persistence.flush();
    release();
    await saving;
    expect(persistence.hasDurableDraft()).toBe(false);
    expect(persistence.getRecoveryError()).not.toBe(null);
  });

  it("keeps saving newer content when the view write fails", async () => {
    const { store, drawing } = await session();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const save = vi.spyOn(store, "saveDrawingContent");
    vi.spyOn(store, "saveDrawingView").mockRejectedValue(
      new DOMException("Full", "QuotaExceededError"),
    );
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "troy", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("saved");
    expect(persistence.unsaved()).toBe(null);
    expect(warn).toHaveBeenCalled();

    persistence.save(
      savedContent("Greendale", "troy", "abed").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1].elements.map(({ id }) => id)).toEqual([
      "troy",
      "abed",
    ]);
    expect(persistence.getSaveState().kind).toBe("saved");
    expect(
      (await store.loadDrawingContent(drawing.meta.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["troy", "abed"]);
  });

  it("still saves when staging images for recovery fails", async () => {
    const { store, drawing } = await session();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const staging = vi
      .spyOn(store, "stageFiles")
      .mockRejectedValue(new DOMException("Full", "QuotaExceededError"));
    const save = vi
      .spyOn(store, "saveDrawingContent")
      .mockRejectedValueOnce(new Error("Offline"));
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "troy").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(staging).toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
    expect(persistence.getSaveState().kind).toBe("error");
    expect(persistence.getRecoveryError()).not.toBe(null);
    expect(persistence.hasDurableDraft()).toBe(false);
    expect(warn).toHaveBeenCalled();

    await persistence.retry();
    expect(persistence.getSaveState().kind).toBe("saved");
    expect(persistence.getRecoveryError()).toBe(null);
    expect(persistence.unsaved()).toBe(null);
  });

  it("saves a scene whose deleted image can no longer be uploaded", async () => {
    const { store, drawing } = await session();
    const fileId = "pierce-image" as FileId;
    const file: BinaryFileData = {
      id: fileId,
      dataURL: "data:image/png;base64,AAAA" as DataURL,
      mimeType: "image/png",
      created: 1,
    };
    vi.spyOn(store.files, "save").mockImplementation(
      async ({ addedFiles }) => ({
        savedFiles: new Map(),
        erroredFiles: new Map(addedFiles),
      }),
    );
    const staging = vi.spyOn(store, "stageFiles");
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      [
        ...savedContent("Greendale", "troy").elements,
        API.createElement({ type: "image", fileId, isDeleted: true }),
      ],
      appState(),
      { [fileId]: file },
      vi.fn(),
    );
    await persistence.flush();
    expect(staging).toHaveBeenCalledWith({});
    expect(persistence.getSaveState().kind).toBe("saved");
  });

  it("never pairs old content with the revision of a newer metadata refresh", async () => {
    const { store, drawing } = await session();
    const persistence = persistenceFor(store, drawing);
    await store.saveDrawingContent(
      drawing.meta.id,
      savedContent("Greendale", "annie"),
      [],
    );
    const second = await store.getDrawingMeta(drawing.meta.id);
    if (!second) {
      throw new Error("The second revision is missing");
    }
    const content = await store.loadDrawingContent(drawing.meta.id);
    vi.spyOn(store, "getDrawingMeta").mockResolvedValueOnce(second);
    const original = store.saveDrawingContent.bind(store);
    vi.spyOn(store, "loadDrawingContent").mockImplementationOnce(async () => {
      await original(drawing.meta.id, savedContent("Greendale", "shirley"), []);
      return content;
    });
    const loaded = await persistence.changedElsewhere();
    expect(loaded.scene?.elements.map(({ id }) => id)).toEqual(["annie"]);
    expect(store.getSnapshot().drawings.get(drawing.meta.id)?.revision).toBe(3);
    const save = vi.spyOn(store, "saveDrawingContent");
    persistence.save(
      savedContent("Greendale", "annie", "abed").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(save.mock.calls[0][3]?.baseRevision).toBe(2);
    expect(persistence.getSaveState().kind).toBe("conflict");
  });

  it("finishes a recovery copy when metadata refresh reports an unchanged scene", async () => {
    const { store, drawing } = await session();
    const persistence = persistenceFor(store, drawing);
    const content = savedContent("Greendale", "annie");
    persistence.save(content.elements, appState(), {}, vi.fn());
    vi.spyOn(store, "saveDrawingContent").mockResolvedValueOnce({
      ok: false,
      reason: "conflict",
      meta: drawing.meta,
    });
    await persistence.flush();
    const create = store.createDrawing.bind(store);
    vi.spyOn(store, "createDrawing").mockImplementation(async (input) => {
      const copy = await create(input);
      persistence.save(content.elements, appState(), {}, vi.fn());
      return copy;
    });
    const save = vi.mocked(store.saveDrawingContent);
    save.mockClear();
    const copy = await persistence.recoverAsCopy();
    expect(copy).not.toBe(null);
    expect(save).not.toHaveBeenCalled();
    expect(persistence.unsaved()).toBe(null);
  });
});

describe("against the account server's rules", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=" as DataURL;
  const ids = (elements: readonly { id: string }[] | null | undefined) =>
    elements?.map(({ id }) => id);

  it("replays a write whose acknowledgement was lost and gets its receipt", async () => {
    const { server, store, drawing } = await remoteSession();
    const persistence = persistenceFor(store, drawing);
    server.failNext("POST /api/commands", "lost-response");
    server.failNext("POST /api/commands", "offline");
    persistence.save(
      savedContent("Greendale", "troy", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("error");
    const requestId = persistence.unsaved()?.request?.requestId;
    expect(server.drawing(drawing.meta.id)?.meta.revision).toBe(2);

    persistence.save(
      savedContent("Greendale", "troy", "abed").elements,
      appState(),
      {},
      vi.fn(),
    );
    await persistence.retry();
    expect(persistence.getSaveState().kind).toBe("saved");
    const saves = server.commands.filter(
      ({ command }) => command.kind === "saveDrawing",
    );
    expect(saves).toHaveLength(3);
    expect(saves[0].requestId).toBe(requestId);
    expect(saves[1]).toEqual(saves[0]);
    expect(saves[2].requestId).not.toBe(requestId);
    const saved = server.drawing(drawing.meta.id);
    expect(saved?.meta.revision).toBe(3);
    expect(ids(saved?.content.elements)).toEqual(["troy", "abed"]);
  });

  it("recovers a conflicting scene with a deleted image as a copy", async () => {
    const { server, store, drawing } = await remoteSession();
    const fileId = "pierce-image" as FileId;
    const file: BinaryFileData = {
      id: fileId,
      dataURL: PNG,
      mimeType: "image/png",
      created: 1,
    };
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      [
        ...savedContent("Greendale", "troy", "annie").elements,
        API.createElement({ type: "image", fileId, isDeleted: true }),
      ],
      appState(),
      { [fileId]: file },
      vi.fn(),
    );
    await store.saveDrawingContent(
      drawing.meta.id,
      savedContent("Greendale", "abed"),
      [],
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("conflict");
    const copy = await persistence.recoverAsCopy();
    expect(copy?.fileIds).toEqual([]);
    expect(
      ids(copy ? server.drawing(copy.id)?.content.elements : undefined),
    ).toEqual(["troy", "annie"]);
    expect(ids(server.drawing(drawing.meta.id)?.content.elements)).toEqual([
      "abed",
    ]);
    expect(persistence.getSaveState().kind).toBe("saved");
  });

  it("reopens a drawing whose cached view has an arrow selected", async () => {
    const { server, store, drawing } = await remoteSession();
    const arrow = API.createElement({ type: "arrow", id: "britta" });
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      [arrow],
      {
        ...appState(),
        selectedElementIds: { [arrow.id]: true },
        selectedLinearElement: new LinearElementEditor(
          arrow,
          arrayToMap([arrow]),
        ),
      },
      {},
      vi.fn(),
    );
    await persistence.flush();
    expect(persistence.getSaveState().kind).toBe("saved");

    const tab = await openRemote(server);
    const reopened = await tab.openDrawing(drawing.meta.id);
    if (!reopened) {
      throw new Error("The saved drawing is missing");
    }
    expect(reopened.view).toMatchObject({
      selectedElementIds: { [arrow.id]: true },
      selectedLinearElement: null,
    });
    const scene = await persistenceFor(tab, reopened).load();
    expect(ids(scene.elements)).toEqual([arrow.id]);
    expect(scene.appState?.selectedElementIds).toEqual({ [arrow.id]: true });
  });

  it.each([
    ["invalid", 400, { link: "x".repeat(10_001) }],
    ["too large", 413, { customData: { padding: "x".repeat(12 << 20) } }],
  ])(
    "releases content the server refuses as %s and saves corrected edits",
    async (_reason, status, change) => {
      const { server, store, drawing } = await remoteSession();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const persistence = persistenceFor(store, drawing);
      const [refused] = savedContent("Greendale", "chang").elements;
      persistence.save([{ ...refused, ...change }], appState(), {}, vi.fn());
      await persistence.flush();
      expect(persistence.getSaveState()).toMatchObject({
        kind: "rejected",
        error: { status },
      });
      expect(persistence.unsaved()?.request).toBeUndefined();

      persistence.save(
        savedContent("Greendale", "corrected").elements,
        appState(),
        {},
        vi.fn(),
      );
      await persistence.flush();
      expect(persistence.getSaveState().kind).toBe("saved");
      expect(ids(server.drawing(drawing.meta.id)?.content.elements)).toEqual([
        "corrected",
      ]);
    },
  );

  it.each(["rotateCsrfToken", "expireSession"] as const)(
    "keeps the draft and stops saving when the session ends (%s)",
    async (end) => {
      const { server, store, drawing } = await remoteSession();
      const persistence = persistenceFor(store, drawing);
      server[end]();
      persistence.save(
        savedContent("Greendale", "troy", "annie").elements,
        appState(),
        {},
        vi.fn(),
      );
      await persistence.flush();
      expect(persistence.getSaveState().kind).toBe("expired");

      const saving = vi.spyOn(store, "saveDrawingContent");
      const states = new Set<string>();
      persistence.subscribeSaveState(() =>
        states.add(persistence.getSaveState().kind),
      );
      persistence.save(
        savedContent("Greendale", "troy", "annie", "abed").elements,
        appState(),
        {},
        vi.fn(),
      );
      await persistence.flush();
      await persistence.retry();
      await persistence.changedElsewhere();
      expect(saving).not.toHaveBeenCalled();
      expect([...states]).toEqual(["expired"]);
      expect(persistence.getSaveState().kind).toBe("expired");
      expect(ids(persistence.unsaved()?.elements)).toEqual([
        "troy",
        "annie",
        "abed",
      ]);
      expect(server.drawing(drawing.meta.id)?.meta.revision).toBe(1);
    },
  );

  it("doesn't run a save queued behind the one that found the session expired", async () => {
    const { server, store, drawing } = await remoteSession();
    const original = store.saveDrawingContent.bind(store);
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi
      .spyOn(store, "saveDrawingContent")
      .mockImplementation(async (...args) => {
        await blocked;
        return original(...args);
      });
    const persistence = persistenceFor(store, drawing);
    persistence.save(
      savedContent("Greendale", "troy", "annie").elements,
      appState(),
      {},
      vi.fn(),
    );
    const first = persistence.flush();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    persistence.save(
      savedContent("Greendale", "troy", "abed").elements,
      appState(),
      {},
      vi.fn(),
    );
    const second = persistence.flush();
    const states = new Set<string>();
    persistence.subscribeSaveState(() =>
      states.add(persistence.getSaveState().kind),
    );
    server.expireSession();
    release();
    await Promise.all([first, second]);
    expect(save).toHaveBeenCalledTimes(1);
    expect([...states]).toEqual(["expired"]);
    expect(ids(persistence.unsaved()?.elements)).toEqual(["troy", "abed"]);
  });
});

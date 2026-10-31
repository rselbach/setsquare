import { z } from "zod";

import { STORAGE_KEYS } from "../app_constants";
import { splitAppState } from "../workspace/drawingAppState";
import {
  parseAccountDraft,
  parseDrawing,
  parseView,
} from "../workspace/remote/parse";

import { imageFileIds } from "./persistence/saveContent";

import type {
  AccountDraft,
  DrawingDraft,
  DrawingId,
  OpenedDrawing,
} from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

/** A drawing's scene as the page left it, before the store had it. */
export type UnsavedDrawing = DrawingDraft | AccountDraft;

/** A saved drawing with a separate, still-uncommitted local draft. */
export type RecoveredDrawing = OpenedDrawing & {
  recovered?: UnsavedDrawing;
  unavailable?: "missing" | "trashed";
};

const KEY = STORAGE_KEYS.LOCAL_STORAGE_UNSAVED;
const localPrefixFor = (id: DrawingId) => `${KEY}-local:${id}:`;
const prefixFor = (id: DrawingId, account: string) =>
  `${KEY}:${account}:${id}:`;
const keyFor = (id: DrawingId, account?: string, draftId?: string) =>
  account
    ? `${prefixFor(id, account)}${draftId}`
    : draftId
    ? `${localPrefixFor(id)}${draftId}`
    : KEY;

/**
 * The account's localStorage drafts as stored, without restoring them; a
 * value that is not JSON reads as `undefined`.
 */
export const storedAccountDrafts = (account: string, storage: Storage) => {
  const values: unknown[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(`${KEY}:${account}:`)) {
      continue;
    }
    try {
      values.push(JSON.parse(storage.getItem(key) ?? "null"));
    } catch {
      values.push(undefined);
    }
  }
  return values;
};

/** Writes the synchronous fallback for edits whose IndexedDB write is pending. */
export const writeUnsaved = (
  draft: UnsavedDrawing,
  account?: string,
  storage: Storage = localStorage,
): boolean => {
  if (account && !("draftId" in draft)) {
    return false;
  }
  try {
    storage.setItem(
      keyFor(draft.id, account, "draftId" in draft ? draft.draftId : undefined),
      JSON.stringify(draft),
    );
    return true;
  } catch {
    return false;
  }
};

/**
 * Removes an editor's own draft, or, given `notAfter`, every copy of a
 * recovered one last edited at or before it.
 */
export const clearUnsaved = (
  id: DrawingId,
  account?: string,
  storage: Storage = localStorage,
  draftId?: string,
  notAfter?: number,
) => {
  if (account && !draftId) {
    return;
  }
  try {
    const key = keyFor(id, account, draftId);
    if (key === KEY) {
      const saved = z
        .object({ id: z.string() })
        .safeParse(JSON.parse(storage.getItem(key) ?? "null"));
      if (!saved.success || saved.data.id !== id) {
        return;
      }
    }
    if (notAfter !== undefined) {
      const saved = z
        .object({ updatedAt: z.number() })
        .safeParse(JSON.parse(storage.getItem(key) ?? "null"));
      if (saved.success && saved.data.updatedAt > notAfter) {
        return;
      }
    }
    storage.removeItem(key);
  } catch (error) {
    console.error(error);
  }
};

const lockName = (draftId: string) => `setsquare-draft:${draftId}`;

/** Holds the draft's lock until `until` settles, queued behind any holder. */
export const holdDraft = (
  locks: LockManager | undefined,
  draftId: string,
  until: Promise<void>,
) => {
  locks
    ?.request(lockName(draftId), () => until)
    .catch((error) => console.warn("Could not lock a recovery draft", error));
};

/**
 * Takes the draft's lock unless an editor session holds it. Locks that fail
 * leave the draft to whoever reads it, as a browser without them does.
 */
const claimDraft = (locks: LockManager, draftId: string) =>
  new Promise<(() => void) | null>((resolve) => {
    locks
      .request(lockName(draftId), { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        return new Promise<void>((release) => resolve(() => release()));
      })
      .catch((error) => {
        console.warn("Could not lock a recovery draft", error);
        resolve(() => {});
      });
  });

/**
 * Each draft's newest copy, from IndexedDB and from the localStorage keys of
 * the account's drawings that `id` matches.
 */
const readDrafts = async (
  account: string,
  storage: Storage | undefined,
  saved: () => Promise<AccountDraft[]> | undefined,
  id?: DrawingId,
) => {
  const drafts = new Map<string, AccountDraft>();
  try {
    for (const draft of (await saved()) ?? []) {
      drafts.set(draft.draftId, draft);
    }
  } catch (error) {
    console.warn("Could not read IndexedDB recovery", error);
  }
  if (storage) {
    const prefix = id ? prefixFor(id, account) : `${KEY}:${account}:`;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) {
        continue;
      }
      try {
        const draft = parseAccountDraft(
          JSON.parse(storage.getItem(key) ?? "null"),
        );
        // so another account whose id this one's starts with keeps its own
        if (key !== keyFor(draft.id, account, draft.draftId)) {
          continue;
        }
        const previous = drafts.get(draft.draftId);
        if (!previous || previous.updatedAt <= draft.updatedAt) {
          drafts.set(draft.draftId, draft);
        }
      } catch (error) {
        console.warn("Could not read a recovery draft", error);
      }
    }
  }
  return [...drafts.values()].sort((a, b) => b.updatedAt - a.updatedAt);
};

/**
 * Reads recovery independently of whether the server still has the drawing.
 * Where the browser has locks, it skips drafts an open editor session holds,
 * such as another tab's, and keeps the draft it returns locked until the
 * current task ends, so the editor that adopts it must lock it before then.
 */
export const readAccountRecovery = async (
  store: WorkspaceStore,
  id: DrawingId,
): Promise<AccountDraft | null> => {
  if (!store.recoveryKey) {
    return null;
  }
  const drafts = await readDrafts(
    store.recoveryKey,
    store.recoveryStorage,
    () => store.recoveryDrafts?.load(id),
    id,
  );
  const locks = store.recoveryLocks;
  if (!locks) {
    return drafts[0] ?? null;
  }
  for (const draft of drafts) {
    const release = await claimDraft(locks, draft.draftId);
    if (release) {
      setTimeout(release);
      return draft;
    }
  }
  return null;
};

/** How long a draft of a drawing the workspace no longer has is kept. */
export const ORPHAN_DRAFT_AGE = 30 * 24 * 60 * 60 * 1000;

/**
 * Lists the newest draft of each drawing the workspace no longer has, such
 * as one deleted on another device, which opening the drawing recovers.
 * Drafts last edited more than `ORPHAN_DRAFT_AGE` ago are deleted instead,
 * unless an editor session holds them.
 */
export const collectOrphanDrafts = async (
  store: WorkspaceStore,
  now = Date.now(),
): Promise<AccountDraft[]> => {
  const account = store.recoveryKey;
  if (!account) {
    return [];
  }
  const storage = store.recoveryStorage;
  const drafts = await readDrafts(account, storage, () =>
    store.recoveryDrafts?.list(),
  );
  const { drawings } = store.getSnapshot();
  const orphans = new Map<DrawingId, AccountDraft>();
  for (const draft of drafts) {
    if (drawings.has(draft.id)) {
      continue;
    }
    if (now - draft.updatedAt <= ORPHAN_DRAFT_AGE) {
      if (!orphans.has(draft.id)) {
        orphans.set(draft.id, draft);
      }
      continue;
    }
    const release = store.recoveryLocks
      ? await claimDraft(store.recoveryLocks, draft.draftId)
      : () => {};
    if (!release) {
      continue;
    }
    try {
      await store.recoveryDrafts?.remove(draft.draftId, draft.updatedAt);
      if (storage) {
        clearUnsaved(
          draft.id,
          account,
          storage,
          draft.draftId,
          draft.updatedAt,
        );
      }
    } catch (error) {
      console.warn("Could not remove an expired recovery draft", error);
    } finally {
      release();
    }
  }
  return [...orphans.values()];
};

/** Opens a surviving draft even after the saved drawing was deleted or trashed. */
export const recoverUnavailable = async (
  store: WorkspaceStore,
  id: DrawingId,
  unavailable: "missing" | "trashed",
): Promise<RecoveredDrawing | null> => {
  const recovered = await readAccountRecovery(store, id);
  if (!recovered) {
    return null;
  }
  const { content: appState, view } = splitAppState(recovered.appState);
  return {
    meta: {
      id,
      name: appState.name,
      folderId: null,
      createdAt: recovered.updatedAt,
      updatedAt: recovered.updatedAt,
      openedAt: null,
      trashedAt: unavailable === "trashed" ? recovered.updatedAt : null,
      revision: recovered.baseRevision,
      fileIds: imageFileIds(recovered.elements),
    },
    content: { elements: recovered.elements, appState },
    view,
    recovered,
    unavailable,
  };
};

const readLegacy = (
  drawing: OpenedDrawing,
  storage: Storage,
): DrawingDraft | null => {
  try {
    const value = z
      .object({
        id: z.string(),
        baseRevision: z.number().int().positive(),
        elements: z.array(z.unknown()),
        appState: z.record(z.string(), z.unknown()),
      })
      .safeParse(JSON.parse(storage.getItem(KEY) ?? "null"));
    if (!value.success || value.data.id !== drawing.meta.id) {
      return null;
    }
    const content = parseDrawing({
      meta: drawing.meta,
      content: value.data,
    }).content;
    return {
      id: drawing.meta.id,
      baseRevision: value.data.baseRevision,
      elements: content.elements,
      appState: { ...content.appState, ...parseView(value.data.appState) },
    };
  } catch (error) {
    console.error(error);
    return null;
  }
};

const readLocalRecovery = (
  id: DrawingId,
  storage: Storage,
): AccountDraft | null => {
  const drafts: AccountDraft[] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(localPrefixFor(id))) {
        continue;
      }
      try {
        const draft = parseAccountDraft(
          JSON.parse(storage.getItem(key) ?? "null"),
        );
        if (draft.id === id) {
          drafts.push(draft);
        }
      } catch (error) {
        console.warn("Could not read a local recovery draft", error);
      }
    }
  } catch (error) {
    console.warn("Could not read local recovery", error);
  }
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
};

/** Restores local edits without rebasing them over a newer server revision. */
export const replayUnsaved = async (
  store: WorkspaceStore,
  drawing: OpenedDrawing,
  storage: Storage = localStorage,
): Promise<RecoveredDrawing> => {
  if (store.recoveryKey) {
    const recovered = await readAccountRecovery(store, drawing.meta.id);
    return recovered ? { ...drawing, recovered } : drawing;
  }
  const localDraft = readLocalRecovery(drawing.meta.id, storage);
  if (localDraft) {
    return { ...drawing, recovered: localDraft };
  }
  let unsaved = readLegacy(drawing, storage);
  if (!unsaved || unsaved.baseRevision !== drawing.meta.revision) {
    return drawing;
  }
  const { content: appState, view } = splitAppState(unsaved.appState);
  const content = { elements: unsaved.elements, appState };
  let replayed = drawing;
  try {
    const saved = await store.saveDrawingContent(
      drawing.meta.id,
      content,
      imageFileIds(unsaved.elements),
    );
    if (!saved.ok) {
      return { ...drawing, recovered: unsaved };
    }
    replayed = { meta: saved.meta, content, view: drawing.view };
    unsaved = { ...unsaved, baseRevision: saved.meta.revision };
    writeUnsaved(unsaved, undefined, storage);
    const savedView = await store.saveDrawingView(drawing.meta.id, view);
    if (!savedView.ok) {
      return { ...replayed, recovered: unsaved };
    }
    clearUnsaved(drawing.meta.id, undefined, storage);
    return { ...replayed, view };
  } catch (error) {
    console.warn("Could not save recovered drawing", error);
    return { ...replayed, recovered: unsaved };
  }
};

import { z } from "zod";

import { STORAGE_KEYS } from "../app_constants";
import { splitAppState } from "../workspace/drawingAppState";
import {
  parseAccountDraft,
  parseDrawing,
  parseView,
} from "../workspace/remote/parse";

import { imageFileIds } from "./drawingPersistence";

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

/** Removes an editor's own draft, or a recovered version that has not changed. */
export const clearUnsaved = (
  id: DrawingId,
  account?: string,
  storage: Storage = localStorage,
  draftId?: string,
  generation?: string,
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
    if (generation) {
      const saved = z
        .object({ generation: z.string() })
        .safeParse(JSON.parse(storage.getItem(key) ?? "null"));
      if (!saved.success || saved.data.generation !== generation) {
        return;
      }
    }
    storage.removeItem(key);
  } catch (error) {
    console.error(error);
  }
};

/** Reads recovery independently of whether the server still has the drawing. */
export const readAccountRecovery = async (
  store: WorkspaceStore,
  id: DrawingId,
): Promise<AccountDraft | null> => {
  if (!store.recoveryKey) {
    return null;
  }
  const drafts = new Map<string, AccountDraft>();
  try {
    for (const draft of (await store.recoveryDrafts?.load(id)) ?? []) {
      drafts.set(draft.draftId, draft);
    }
  } catch (error) {
    console.warn("Could not read IndexedDB recovery", error);
  }
  const storage = store.recoveryStorage;
  if (storage) {
    const prefix = prefixFor(id, store.recoveryKey);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) {
        continue;
      }
      try {
        const draft = parseAccountDraft(
          JSON.parse(storage.getItem(key) ?? "null"),
        );
        const previous = drafts.get(draft.draftId);
        if (!previous || previous.updatedAt <= draft.updatedAt) {
          drafts.set(draft.draftId, draft);
        }
      } catch (error) {
        console.warn("Could not read a recovery draft", error);
      }
    }
  }
  return (
    [...drafts.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  );
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

import { t } from "@setsquare/setsquare/i18n";

import { visibleFolder } from "../../workspace/tree";

import {
  contentSignature,
  persistedSignature,
  viewSignature,
} from "./saveContent";

import type { SaveOptions } from "../../workspace/api";
import type {
  DrawingContent,
  DrawingId,
  DrawingMeta,
  DrawingView,
} from "../../workspace/types";
import type { WorkspaceStore } from "../../workspace/WorkspaceStore";
import type { createThumbnailer } from "../thumbnail";
import type { RecoveredDrawing } from "../unsavedJournal";
import type { ContentWrite, PendingScene } from "./saveContent";

/** Every content write, to the drawing or to a copy of it, goes here. */
const commit = (
  store: WorkspaceStore,
  target: DrawingId,
  write: ContentWrite,
  options: SaveOptions,
) => store.saveDrawingContent(target, write.content, write.fileIds, options);

/**
 * What storage has of the drawing, as this session last confirmed it. It
 * changes only when a write is confirmed or a newer revision is reloaded.
 */
export const createStoredDrawing = ({
  store,
  drawing,
  thumbnailer,
}: {
  store: WorkspaceStore;
  drawing: RecoveredDrawing;
  thumbnailer: ReturnType<typeof createThumbnailer>;
}) => {
  const { id } = drawing.meta;
  let revision = drawing.recovered?.baseRevision ?? drawing.meta.revision;
  let content = contentSignature(
    drawing.content.elements,
    drawing.content.appState,
  );
  let view = drawing.view && viewSignature(drawing.view);
  let viewError: unknown | null = null;

  return {
    revision: () => revision,
    signature: () => ({ content, view }),
    viewError: () => viewError,
    /** Commits a write based on `options.baseRevision`. */
    sendContent: async (
      write: ContentWrite,
      options: SaveOptions,
      uncertain: boolean,
    ): Promise<
      { kind: "saved" | "notFound" } | { kind: "conflict"; meta: DrawingMeta }
    > => {
      const saved = await commit(store, id, write, options);
      if (!saved.ok) {
        if (saved.reason === "notFound") {
          return { kind: "notFound" };
        }
        // a request whose outcome is unknown, such as one a closed page
        // left, may be what moved the revision; unlike the server, this
        // device's storage keeps no receipt to say so
        const stored =
          uncertain && !store.recoveryKey
            ? await store.loadDrawingContent(id)
            : null;
        if (
          !stored ||
          contentSignature(stored.elements, stored.appState) !== write.signature
        ) {
          return { kind: "conflict", meta: saved.meta };
        }
      }
      // a resent request gets the receipt of its first commit, which a
      // later save elsewhere may have overwritten since
      const current = store.getSnapshot().drawings.get(id);
      if (current && current.revision > saved.meta.revision) {
        return { kind: "conflict", meta: current };
      }
      revision = saved.meta.revision;
      content = write.signature;
      thumbnailer.schedule(revision);
      return { kind: "saved" };
    },
    /** Saves where the drawing was left; false when the drawing is gone. */
    sendView: async (next: DrawingView) => {
      const signature = viewSignature(next);
      if (signature === view) {
        return true;
      }
      try {
        const saved = await store.saveDrawingView(id, next);
        if (!saved.ok) {
          return false;
        }
        view = signature;
        viewError = null;
      } catch (error) {
        viewError = error;
        // where this browser left the drawing is a convenience; its
        // content is already saved
        console.warn("Could not save the drawing's view", id, error);
      }
      return true;
    },
    reloaded: (nextRevision: number, next: DrawingContent) => {
      revision = nextRevision;
      content = contentSignature(next.elements, next.appState);
    },
  };
};

/** What storage has of the drawing. */
export type StoredDrawing = ReturnType<typeof createStoredDrawing>;

/**
 * Saves the pending scene as a new drawing named as a copy, then commits
 * each newer pending scene to the copy until the copy has the latest.
 */
export const saveCopy = async ({
  store,
  drawing,
  ownerWindow,
  pending,
  prepare,
}: {
  store: WorkspaceStore;
  drawing: RecoveredDrawing;
  ownerWindow: Window;
  pending: () => PendingScene | null;
  prepare: (scene: PendingScene) => Promise<ContentWrite>;
}) => {
  const first = pending();
  if (!first) {
    return null;
  }
  let write = await prepare(first);
  const name = t("workspace.saveCopyName", {
    name: write.content.appState.name || t("labels.untitled"),
  });
  const named = ({ content }: ContentWrite) => ({
    ...content,
    appState: { ...content.appState, name },
  });
  const copy = await store.createDrawing({
    folderId: visibleFolder(store.getSnapshot(), drawing.meta.folderId),
    name,
    content: named(write),
    fileIds: write.fileIds,
  });
  let revision = copy.revision;
  for (
    let scene = pending();
    scene &&
    persistedSignature(scene.elements, scene.appState).content !==
      write.signature;
    scene = pending()
  ) {
    write = await prepare(scene);
    const saved = await commit(
      store,
      copy.id,
      { ...write, content: named(write) },
      { baseRevision: revision, requestId: ownerWindow.crypto.randomUUID() },
    );
    if (!saved.ok) {
      throw new Error(
        "The recovered copy changed before the latest edit was saved",
      );
    }
    revision = saved.meta.revision;
  }
  return copy;
};

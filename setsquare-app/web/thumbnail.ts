import { getNonDeletedElements } from "@setsquare/element";
import { exportToCanvas } from "@setsquare/setsquare";

import type { SetsquareElement } from "@setsquare/element/types";
import type {
  AppState,
  BinaryFiles,
  DataURL,
} from "@setsquare/setsquare/types";

import type { DrawingId } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

const THUMBNAIL_MAX_SIZE = 480;
// long enough that a run of edits renders once, after the last of them
const THUMBNAIL_DELAY_MS = 2000;

/** A drawing as the editor last reported it, for its thumbnail. */
export type ThumbnailScene = {
  elements: readonly SetsquareElement[];
  appState: AppState;
  files: BinaryFiles;
};

/** Draws a scene small, as the workspace shows it. */
export const renderThumbnail = async ({
  elements,
  appState,
  files,
}: ThumbnailScene) => {
  const canvas = await exportToCanvas({
    elements: getNonDeletedElements(elements),
    // the drawing on its paper, whatever the last export chose; the export
    // scale would enlarge a small drawing past the size limit
    appState: {
      ...appState,
      exportBackground: true,
      exportWithDarkMode: false,
      exportScale: 1,
    },
    files,
    maxWidthOrHeight: THUMBNAIL_MAX_SIZE,
  });
  // a browser that can't encode WebP returns a PNG instead
  return canvas.toDataURL("image/webp", 0.8) as DataURL;
};

/**
 * Keeps one drawing's thumbnail current while the editor has it open. It
 * renders from what `scene` gives, since by the time the editor leaves the
 * drawing its API is gone, and only when the drawing has content the stored
 * thumbnail doesn't show yet. Failures are logged, never thrown.
 */
export const createThumbnailer = ({
  store,
  id,
  scene,
}: {
  store: WorkspaceStore;
  id: DrawingId;
  scene: () => ThumbnailScene | null;
}) => {
  let timer: number | null = null;
  let idle: number | null = null;
  // one render at a time, so an older one can't land after a newer one
  let rendering = Promise.resolve();

  const update = async (revision: number) => {
    const current = scene();
    if (!current?.elements.some((element) => !element.isDeleted)) {
      return;
    }
    try {
      // another tab has saved since, and renders its own
      if (store.getSnapshot().drawings.get(id)?.revision !== revision) {
        return;
      }
      const stored = (await store.getThumbnails([id])).get(id);
      if (stored?.revision === revision) {
        return;
      }
      const src = await renderThumbnail(current);
      await store.saveThumbnail(id, { src, revision });
    } catch (error) {
      // the drawing is saved either way; only its picture is behind
      console.error("Couldn't save the drawing's thumbnail", error);
    }
  };

  const render = (revision: number) => {
    rendering = rendering.then(() => update(revision));
    return rendering;
  };

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (idle !== null) {
      window.cancelIdleCallback(idle);
      idle = null;
    }
  };

  return {
    /** renders revision's thumbnail once the editor has been quiet a while */
    schedule: (revision: number) => {
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        if (typeof window.requestIdleCallback === "function") {
          idle = window.requestIdleCallback(() => {
            idle = null;
            render(revision);
          });
        } else {
          render(revision);
        }
      }, THUMBNAIL_DELAY_MS);
    },
    /** renders revision's thumbnail now, in place of a scheduled one */
    renderNow: (revision: number) => {
      cancel();
      return render(revision);
    },
    cancel,
  };
};

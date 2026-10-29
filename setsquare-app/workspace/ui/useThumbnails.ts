import { useEffect, useRef, useState } from "react";

import { useWorkspaceSnapshot } from "../../web/useWorkspaceSnapshot";

import type { DrawingId, DrawingMeta, Thumbnail } from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

const isSame = (a?: Thumbnail, b?: Thumbnail) =>
  a?.revision === b?.revision && a?.src === b?.src;

/**
 * The thumbnails of the drawings, by drawing, loading those that are new or
 * behind their drawing whenever the workspace changes, since an editor
 * saves them a while after its drawing. Drawings without one aren't in it.
 * Keep `drawings` the same array while it lists the same drawings.
 */
export const useThumbnails = (
  store: WorkspaceStore,
  drawings: readonly DrawingMeta[],
) => {
  const snapshot = useWorkspaceSnapshot(store);
  const [thumbnails, setThumbnails] = useState<
    ReadonlyMap<DrawingId, Thumbnail>
  >(() => new Map());
  const shown = useRef(thumbnails);

  useEffect(() => {
    shown.current = thumbnails;
  }, [thumbnails]);

  useEffect(() => {
    const ids = drawings
      .filter(
        (drawing) =>
          shown.current.get(drawing.id)?.revision !== drawing.revision,
      )
      .map((drawing) => drawing.id);
    if (!ids.length) {
      return;
    }
    let active = true;
    store.getThumbnails(ids).then(
      (loaded) => {
        if (!active) {
          return;
        }
        setThumbnails((current) => {
          // most changes are to other drawings, and leave these as they were
          if (ids.every((id) => isSame(current.get(id), loaded.get(id)))) {
            return current;
          }
          const next = new Map(current);
          for (const id of ids) {
            const thumbnail = loaded.get(id);
            if (thumbnail) {
              next.set(id, thumbnail);
            } else {
              next.delete(id);
            }
          }
          return next;
        });
      },
      (error) => console.error(error),
    );
    return () => {
      active = false;
    };
  }, [store, snapshot, drawings]);

  return thumbnails;
};

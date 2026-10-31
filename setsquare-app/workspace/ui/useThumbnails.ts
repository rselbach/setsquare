import { useEffect, useRef, useState } from "react";

import type { DrawingId, DrawingMeta, Thumbnail } from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

const isSame = (a?: Thumbnail, b?: Thumbnail) =>
  a?.revision === b?.revision && a?.src === b?.src;

// the revision a drawing's thumbnail was asked for at, and by which load
type Request = { revision: number; load: object };

/**
 * The thumbnails of the drawings, by drawing, loading those that are new or
 * behind their drawing. A drawing is asked for again once its revision
 * changes, or once the store says thumbnails may have, since an editor
 * saves them a while after its drawing. Drawings without one aren't in it.
 */
export const useThumbnails = (
  store: WorkspaceStore,
  drawings: readonly DrawingMeta[],
) => {
  const [thumbnails, setThumbnails] = useState<
    ReadonlyMap<DrawingId, Thumbnail>
  >(() => new Map());
  const shown = useRef(thumbnails);
  const requested = useRef(new Map<DrawingId, Request>());
  const [thumbnailChanges, setThumbnailChanges] = useState(0);

  useEffect(() => {
    shown.current = thumbnails;
  }, [thumbnails]);

  useEffect(() => {
    const unsubscribe = store.subscribeThumbnails(() => {
      requested.current = new Map();
      setThumbnailChanges((count) => count + 1);
    });
    return () => {
      unsubscribe();
      // what the old store loads isn't shown
      requested.current = new Map();
    };
  }, [store]);

  useEffect(() => {
    const asked = requested.current;
    const behind = drawings.filter(
      (drawing) =>
        shown.current.get(drawing.id)?.revision !== drawing.revision &&
        asked.get(drawing.id)?.revision !== drawing.revision,
    );
    if (!behind.length) {
      return;
    }
    const load = {};
    for (const drawing of behind) {
      asked.set(drawing.id, { revision: drawing.revision, load });
    }
    const ids = behind.map((drawing) => drawing.id);
    // a later load of the drawing, or a change of store, supersedes this one
    const latest = () =>
      ids.filter((id) => requested.current.get(id)?.load === load);
    store.getThumbnails(ids).then(
      (loaded) => {
        const shownIds = latest();
        setThumbnails((current) => {
          // most loads find what's shown already
          if (shownIds.every((id) => isSame(current.get(id), loaded.get(id)))) {
            return current;
          }
          const next = new Map(current);
          for (const id of shownIds) {
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
      (error) => {
        // so the next change asks again
        for (const id of latest()) {
          requested.current.delete(id);
        }
        console.error(error);
      },
    );
  }, [store, drawings, thumbnailChanges]);

  return thumbnails;
};

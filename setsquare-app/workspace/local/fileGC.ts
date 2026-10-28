import { delMany, getMany, keys } from "idb-keyval";

import type { FileId } from "@setsquare/element/types";
import type { BinaryFileData } from "@setsquare/setsquare/types";

import { filesStore } from "../../data/localFiles";

import type { DrawingMeta } from "../types";

// an open tab may still undo an image back, or not have saved the drawing
// that uses it yet
const UNUSED_FILE_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes the images in this browser that no drawing uses, trashed drawings
 * included, once none has used them for a day. Resolves with their ids.
 */
export const deleteUnusedFiles = async (
  drawings: Iterable<DrawingMeta>,
  now: number,
) => {
  const used = new Set<FileId>();
  for (const drawing of drawings) {
    for (const id of drawing.fileIds) {
      used.add(id);
    }
  }
  // only unused images need their data read, to see how old they are
  const unused = ((await keys(filesStore)) as FileId[]).filter(
    (id) => !used.has(id),
  );
  const files = await getMany<BinaryFileData | undefined>(unused, filesStore);
  const expired = unused.filter((_, index) => {
    const file = files[index];
    return (
      file !== undefined &&
      now - (file.lastRetrieved ?? file.created) > UNUSED_FILE_RETENTION_MS
    );
  });
  await delMany(expired, filesStore);
  return expired;
};

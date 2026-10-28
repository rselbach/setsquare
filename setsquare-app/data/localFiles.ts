import { createStore, entries, del, getMany, set, setMany } from "idb-keyval";

import type { FileId } from "@setsquare/element/types";
import type { BinaryFileData } from "@setsquare/setsquare/types";

import { FileManager } from "./FileManager";

/** The browser's IndexedDB store of images, keyed by file ID. */
export const filesStore = createStore("files-db", "files-store");

/** Images stored in this browser's {@link filesStore}. */
export class LocalFileManager extends FileManager {
  clearObsoleteFiles = async (opts: { currentFileIds: FileId[] }) => {
    await entries(filesStore).then((entries) => {
      for (const [id, imageData] of entries as [FileId, BinaryFileData][]) {
        // if image is unused (not on canvas) & is older than 1 day, delete it
        // from storage. We check `lastRetrieved` we care about the last time
        // the image was used (loaded on canvas), not when it was initially
        // created.
        if (
          (!imageData.lastRetrieved ||
            Date.now() - imageData.lastRetrieved > 24 * 3600 * 1000) &&
          !opts.currentFileIds.includes(id as FileId)
        ) {
          del(id, filesStore);
        }
      }
    });
  };
}

/** Loads images from {@link filesStore}, noting when each was last used. */
export const getLocalFiles = (ids: FileId[]) => {
  return getMany(ids, filesStore).then(
    async (filesData: (BinaryFileData | undefined)[]) => {
      const loadedFiles: BinaryFileData[] = [];
      const erroredFiles = new Map<FileId, true>();

      const filesToSave: [FileId, BinaryFileData][] = [];

      filesData.forEach((data, index) => {
        const id = ids[index];
        if (data) {
          const _data: BinaryFileData = {
            ...data,
            lastRetrieved: Date.now(),
          };
          filesToSave.push([id, _data]);
          loadedFiles.push(_data);
        } else {
          erroredFiles.set(id, true);
        }
      });

      try {
        // save loaded files back to storage with updated `lastRetrieved`
        setMany(filesToSave, filesStore);
      } catch (error) {
        console.warn(error);
      }

      return { loadedFiles, erroredFiles };
    },
  );
};

/** Saves images to {@link filesStore}. */
export const saveLocalFiles = async ({
  addedFiles,
}: {
  addedFiles: Map<FileId, BinaryFileData>;
}) => {
  const savedFiles = new Map<FileId, BinaryFileData>();
  const erroredFiles = new Map<FileId, BinaryFileData>();

  await Promise.all(
    [...addedFiles].map(async ([id, fileData]) => {
      try {
        await set(id, fileData, filesStore);
        savedFiles.set(id, fileData);
      } catch (error: any) {
        console.error(error);
        erroredFiles.set(id, fileData);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

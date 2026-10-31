import { getNonDeletedElements } from "@setsquare/element";

import type { FileId } from "@setsquare/element/types";
import type { BinaryFiles } from "@setsquare/setsquare/types";

import { FileManager, FileSaveError } from "../../data/FileManager";
import { FileStatusStore } from "../../data/fileStatusStore";

import { imageFileIds } from "./saveContent";

import type { WorkspaceStore } from "../../workspace/WorkspaceStore";
import type { ThumbnailScene } from "../thumbnail";
import type { PendingScene } from "./saveContent";

/**
 * Keeps a session's images on this device for its recovery draft, and
 * uploads them before the content that shows them saves. The images are
 * durable for the generation whose staging, or upload, last stored them.
 */
export const createImageSync = ({
  store,
  savedFileIds,
  generation,
  pending,
  onFailure,
}: {
  store: WorkspaceStore;
  /** the images the drawing had when it opened */
  savedFileIds: readonly FileId[];
  generation: () => string;
  pending: () => PendingScene | null;
  onFailure: () => void;
}) => {
  const fileStorage = new FileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    getFiles: store.files.get,
    saveFiles: store.files.save,
  });
  let staging = Promise.resolve();
  let storedGeneration: string | null = null;
  let error: unknown | null = null;

  const savedLocally = (scene: ThumbnailScene) =>
    imageFileIds(getNonDeletedElements(scene.elements)).every((id) =>
      scene.files[id]
        ? fileStorage.isFileSaved(scene.files[id])
        : savedFileIds.includes(id),
    );

  return {
    fileStorage,
    /** Stages the images the scene shows, and `pinned`, on this device. */
    stage: (scene: ThumbnailScene, pinned: readonly FileId[]) => {
      const stagingGeneration = generation();
      const ids = new Set<string>([
        ...imageFileIds(getNonDeletedElements(scene.elements)),
        ...pinned,
      ]);
      const files: BinaryFiles = Object.fromEntries(
        Object.entries(scene.files).filter(([id]) => ids.has(id)),
      );
      staging = (store.stageFiles?.(files) ?? Promise.resolve()).then(
        () => {
          const latest = pending();
          if (store.stageFiles || (latest && savedLocally(latest))) {
            storedGeneration = stagingGeneration;
            if (generation() === stagingGeneration) {
              error = null;
            }
          } else if (generation() === stagingGeneration) {
            error = new Error(
              "The drawing's images have not been stored on this device",
            );
          }
        },
        (stagingError) => {
          if (generation() === stagingGeneration) {
            error = stagingError;
          }
          onFailure();
          throw stagingError;
        },
      );
      staging.catch(() => {});
    },
    /** Waits for staging without letting a device-copy failure stop a save. */
    settle: async () => {
      try {
        await staging;
      } catch (stagingError) {
        console.warn(
          "Could not stage the drawing's images on this device",
          stagingError,
        );
      }
    },
    /** Uploads the images the scene shows, failing if any fails. */
    upload: async (scene: PendingScene) => {
      const uploadGeneration = generation();
      const { erroredFiles, errors } = await fileStorage.saveFiles({
        ...scene,
        elements: getNonDeletedElements(scene.elements),
      });
      if (erroredFiles.size) {
        throw new FileSaveError(
          new Map([...erroredFiles.keys()].map((id) => [id, errors?.get(id)])),
        );
      }
      if (!store.stageFiles && scene === pending() && savedLocally(scene)) {
        storedGeneration = uploadGeneration;
        error = null;
      }
      scene.onFilesSaved();
    },
    isStored: () => storedGeneration === generation(),
    error: () => error,
  };
};

/** A session's image staging and upload. */
export type ImageSync = ReturnType<typeof createImageSync>;

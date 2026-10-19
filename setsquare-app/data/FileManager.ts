import { CaptureUpdateAction } from "@setsquare/setsquare";
import { newElementWith } from "@setsquare/element";
import { isInitializedImageElement } from "@setsquare/element";

import type {
  SetsquareElement,
  SetsquareImageElement,
  FileId,
  InitializedSetsquareImageElement,
} from "@setsquare/element/types";
import type {
  BinaryFileData,
  SetsquareImperativeAPI,
  BinaryFiles,
} from "@setsquare/setsquare/types";

type FileVersion = Required<BinaryFileData>["version"];

export class FileManager {
  /** files being fetched */
  private fetchingFiles = new Map<SetsquareImageElement["fileId"], true>();
  private erroredFiles_fetch = new Map<SetsquareImageElement["fileId"], true>();
  /** files being saved */
  private savingFiles = new Map<SetsquareImageElement["fileId"], FileVersion>();
  /* files already saved to persistent storage */
  private savedFiles = new Map<SetsquareImageElement["fileId"], FileVersion>();
  private erroredFiles_save = new Map<
    SetsquareImageElement["fileId"],
    FileVersion
  >();

  private _getFiles;
  private _saveFiles;
  private _onFileStatusChange;

  constructor({
    getFiles,
    saveFiles,
    onFileStatusChange,
  }: {
    getFiles: (fileIds: FileId[]) => Promise<{
      loadedFiles: BinaryFileData[];
      erroredFiles: Map<FileId, true>;
    }>;
    saveFiles: (data: { addedFiles: Map<FileId, BinaryFileData> }) => Promise<{
      savedFiles: Map<FileId, BinaryFileData>;
      erroredFiles: Map<FileId, BinaryFileData>;
    }>;
    onFileStatusChange?: (
      updates: Array<[FileId, "loading" | "loaded" | "error"]>,
    ) => void;
  }) {
    this._getFiles = getFiles;
    this._saveFiles = saveFiles;
    this._onFileStatusChange = onFileStatusChange;
  }

  isFileSavedOrBeingSaved = (file: BinaryFileData) => {
    const fileVersion = this.getFileVersion(file);
    return (
      this.savedFiles.get(file.id) === fileVersion ||
      this.savingFiles.get(file.id) === fileVersion
    );
  };

  getFileVersion = (file: BinaryFileData) => {
    return file.version ?? 1;
  };

  saveFiles = async ({
    elements,
    files,
  }: {
    elements: readonly SetsquareElement[];
    files: BinaryFiles;
  }) => {
    const addedFiles: Map<FileId, BinaryFileData> = new Map();

    for (const element of elements) {
      const fileData =
        isInitializedImageElement(element) && files[element.fileId];

      if (
        fileData &&
        // NOTE if errored during save, won't retry due to this check
        !this.isFileSavedOrBeingSaved(fileData)
      ) {
        addedFiles.set(element.fileId, files[element.fileId]);
        this.savingFiles.set(element.fileId, this.getFileVersion(fileData));
      }
    }

    try {
      const { savedFiles, erroredFiles } = await this._saveFiles({
        addedFiles,
      });

      for (const [fileId, fileData] of savedFiles) {
        this.savedFiles.set(fileId, this.getFileVersion(fileData));
      }

      for (const [fileId, fileData] of erroredFiles) {
        this.erroredFiles_save.set(fileId, this.getFileVersion(fileData));
      }

      return {
        savedFiles,
        erroredFiles,
      };
    } finally {
      for (const [fileId] of addedFiles) {
        this.savingFiles.delete(fileId);
      }
    }
  };

  getFiles = async (
    ids: FileId[],
  ): Promise<{
    loadedFiles: BinaryFileData[];
    erroredFiles: Map<FileId, true>;
  }> => {
    if (!ids.length) {
      return {
        loadedFiles: [],
        erroredFiles: new Map(),
      };
    }
    for (const id of ids) {
      this.fetchingFiles.set(id, true);
    }

    this._onFileStatusChange?.(ids.map((id) => [id, "loading"]));

    try {
      const { loadedFiles, erroredFiles } = await this._getFiles(ids);

      for (const file of loadedFiles) {
        this.savedFiles.set(file.id, this.getFileVersion(file));
      }
      for (const [fileId] of erroredFiles) {
        this.erroredFiles_fetch.set(fileId, true);
      }

      this._onFileStatusChange?.([
        ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
        ...[...erroredFiles.keys()].map(
          (id) => [id, "error"] as [FileId, "error"],
        ),
      ]);

      return { loadedFiles, erroredFiles };
    } finally {
      for (const id of ids) {
        this.fetchingFiles.delete(id);
      }
    }
  };

  /** a file element prevents unload only if it's being saved regardless of
   *  its `status`. This ensures that elements who for any reason haven't
   *  beed set to `saved` status don't prevent unload in future sessions.
   *  Technically we should prevent unload when the origin client haven't
   *  yet saved the `status` update to storage, but that should be taken care
   *  of during regular beforeUnload unsaved files check.
   */
  shouldPreventUnload = (elements: readonly SetsquareElement[]) => {
    return elements.some((element) => {
      return (
        isInitializedImageElement(element) &&
        !element.isDeleted &&
        this.savingFiles.has(element.fileId)
      );
    });
  };

  /**
   * helper to determine if image element status needs updating
   */
  shouldUpdateImageElementStatus = (
    element: SetsquareElement,
  ): element is InitializedSetsquareImageElement => {
    return (
      isInitializedImageElement(element) &&
      this.savedFiles.has(element.fileId) &&
      element.status === "pending"
    );
  };
}

export const updateStaleImageStatuses = (params: {
  setsquareAPI: SetsquareImperativeAPI;
  erroredFiles: Map<FileId, true>;
  elements: readonly SetsquareElement[];
}) => {
  if (!params.erroredFiles.size) {
    return;
  }
  params.setsquareAPI.updateScene({
    elements: params.setsquareAPI
      .getSceneElementsIncludingDeleted()
      .map((element) => {
        if (
          isInitializedImageElement(element) &&
          params.erroredFiles.has(element.fileId)
        ) {
          return newElementWith(element, {
            status: "error",
          });
        }
        return element;
      }),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};

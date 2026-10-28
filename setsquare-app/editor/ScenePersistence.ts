import type {
  FileId,
  OrderedSetsquareElement,
  SetsquareElement,
} from "@setsquare/element/types";
import type {
  AppState,
  BinaryFiles,
  SetsquareInitialDataState,
} from "@setsquare/setsquare/types";

import type { FileManager } from "../data/FileManager";

/** Where the scene of one editor session is stored. */
export interface ScenePersistence {
  /** the scene to open; its images load separately through `fileStorage` */
  load(): Promise<SetsquareInitialDataState>;
  /** called once with the IDs of the images in the scene `load` opened */
  opened(fileIds: FileId[]): void;
  /** saves the scene shortly, calling `onFilesSaved` once its images are */
  save(
    elements: readonly OrderedSetsquareElement[],
    appState: AppState,
    files: BinaryFiles,
    onFilesSaved: () => void,
  ): void;
  /** saves pending changes now and resolves once they are stored */
  flush(): Promise<unknown>;
  /** whether saving is paused for now, such as while the tab is hidden */
  isSavePaused(): boolean;
  /** what other tabs saved that this tab hasn't, checked when it's focused */
  changedElsewhere(): Promise<{
    scene: {
      elements: readonly SetsquareElement[];
      // the editor keeps its own size and offsets, and whatever is left out
      appState: Partial<
        Omit<AppState, "offsetTop" | "offsetLeft" | "width" | "height">
      > | null;
    } | null;
    /** whether other tabs saved images this tab may not have loaded */
    files: boolean;
  }>;
  readonly fileStorage: FileManager;
}

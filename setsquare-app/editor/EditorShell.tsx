import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Setsquare,
  CaptureUpdateAction,
  useSetsquareAPI,
} from "@setsquare/setsquare";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@setsquare/setsquare/components/CommandPalette/CommandPalette";
import { OverwriteConfirmDialog } from "@setsquare/setsquare/components/OverwriteConfirm/OverwriteConfirm";
import {
  EVENT,
  debounce,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isDevEnv,
} from "@setsquare/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@setsquare/setsquare/i18n";

import { isElementLink } from "@setsquare/element";
import { newElementWith } from "@setsquare/element";
import { isInitializedImageElement } from "@setsquare/element";
import { useHandleLibrary } from "@setsquare/setsquare/data/library";

import type {
  FileId,
  NonDeletedSetsquareElement,
  OrderedSetsquareElement,
  Theme,
} from "@setsquare/element/types";
import type {
  AppState,
  BinaryFiles,
  SetsquareInitialDataState,
  UIAppState,
  SetsquareProps,
} from "@setsquare/setsquare/types";
import type { ResolvablePromise } from "@setsquare/common/utils";
import type { CommandPaletteItem } from "@setsquare/setsquare/components/CommandPalette/types";

import CustomStats from "../CustomStats";
import { useAtomValue } from "../app-jotai";
import { SYNC_BROWSER_TABS_TIMEOUT } from "../app_constants";
import { AppFooter } from "../components/AppFooter";

import { updateStaleImageStatuses } from "../data/FileManager";
import { FileStatusStore } from "../data/fileStatusStore";

import {
  LibraryIndexedDBAdapter,
  imageSaveFailedAtom,
  localStorageQuotaExceededAtom,
} from "../data/LocalData";
import { getPreferredLanguage } from "../app-language/language-detector";
import { useAppLangCode } from "../app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "../components/DebugCanvas";
import { useSimulatedCollaborators } from "../debugCollaborators";

import type { ScenePersistence } from "./ScenePersistence";

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

type EditorShellProps = {
  persistence: ScenePersistence;
  theme: Theme;
  onThemeChange: (theme: Theme | "system") => void;
  /**
   * whether the editor opens files over its scene, with its Open action and
   * the files the app is launched with; the host opens them otherwise.
   * Defaults to true.
   */
  loadScene?: boolean;
  /** commands the host adds to the command palette */
  commandPaletteItems?: CommandPaletteItem[];
  /**
   * opens the scene an element link points to if it's another one,
   * returning whether it did; the editor scrolls to links in its own scene
   */
  openLinkedScene?: (link: string) => boolean;
  /** what the host shows at the top left, before the main menu */
  renderTopLeftUI?: SetsquareProps["renderTopLeftUI"];
  /** what the host shows at the top right, beside Export and Library */
  renderTopRightUI?: SetsquareProps["renderTopRightUI"];
  /** the main menu, the welcome screen and anything else the editor shows */
  children: SetsquareProps["children"];
};

/** The editor for one scene, which `persistence` loads and saves. */
export const EditorShell = ({
  persistence,
  theme,
  onThemeChange,
  loadScene = true,
  commandPaletteItems = [],
  openLinkedScene,
  renderTopLeftUI,
  renderTopRightUI,
  children,
}: EditorShellProps) => {
  const setsquareAPI = useSetsquareAPI();

  const [langCode, setLangCode] = useAppLangCode();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<SetsquareInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<SetsquareInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useHandleLibrary({
    setsquareAPI,
    adapter: LibraryIndexedDBAdapter,
  });

  const [, forceRefresh] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [setsquareAPI]);

  // ?collaborators=<N> — populate the canvas with N static fake
  // collaborators for exercising avatar/UserList UI without a real
  // collab room
  useSimulatedCollaborators(setsquareAPI);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (scene: SetsquareInitialDataState) => {
      if (!setsquareAPI) {
        return;
      }

      const fileIds =
        scene.elements?.reduce((acc, element) => {
          if (isInitializedImageElement(element)) {
            return acc.concat(element.fileId);
          }
          return acc;
        }, [] as FileId[]) || [];

      if (fileIds.length) {
        persistence.fileStorage
          .getFiles(fileIds)
          .then(async ({ loadedFiles, erroredFiles }) => {
            if (loadedFiles.length) {
              setsquareAPI.addFiles(loadedFiles);
            }
            updateStaleImageStatuses({
              setsquareAPI,
              erroredFiles,
              elements: setsquareAPI.getSceneElementsIncludingDeleted(),
            });
          });
      }
      persistence.opened(fileIds);
    },
    [setsquareAPI, persistence],
  );

  useEffect(() => {
    if (!setsquareAPI) {
      return;
    }

    // the next run, or unmounting, ends this one; the first run of an editor
    // opened after another has the previous editor's API
    let active = true;
    persistence.load().then(
      (scene) => {
        if (!active) {
          return;
        }
        loadImages(scene);
        initialStatePromiseRef.current.promise.resolve(scene);
      },
      // shown by the error boundary; an empty scene in its place would save
      // over the stored one
      (error) => active && setLoadError(error),
    );

    const syncData = debounce(async () => {
      if (isTestEnv()) {
        return;
      }
      if (!document.hidden) {
        const changed = await persistence.changedElsewhere();
        if (!active) {
          return;
        }
        if (changed.scene) {
          const { elements, appState } = changed.scene;
          setLangCode(getPreferredLanguage());
          const current = setsquareAPI.getAppState();
          setsquareAPI.updateScene({
            elements,
            // the file handle isn't stored, so keep this tab's, and whatever
            // else wasn't saved elsewhere
            appState: appState && {
              ...current,
              ...appState,
              fileHandle: current.fileHandle,
            },
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then(
            (data) => {
              if (data) {
                setsquareAPI.updateLibrary({
                  libraryItems: data.libraryItems,
                });
              }
            },
            (error) => console.error("Couldn't load the library", error),
          );
        }

        if (changed.files) {
          const elements = setsquareAPI.getSceneElementsIncludingDeleted();
          const currFiles = setsquareAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            persistence.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  setsquareAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  setsquareAPI,
                  erroredFiles,
                  elements: setsquareAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      persistence.flush();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        persistence.flush();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      active = false;
      syncData.cancel();
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [setsquareAPI, setLangCode, loadImages, persistence]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      persistence.flush();

      if (
        setsquareAPI &&
        persistence.fileStorage.shouldPreventUnload(
          setsquareAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [setsquareAPI, persistence]);

  const onChange = (
    elements: readonly OrderedSetsquareElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!persistence.isSavePaused()) {
      persistence.save(elements, appState, files, () => {
        if (setsquareAPI) {
          let didChange = false;

          const elements = setsquareAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                persistence.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            setsquareAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && setsquareAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedSetsquareElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => setsquareAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);
  const imageSaveFailed = useAtomValue(imageSaveFailedAtom);

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<SetsquareProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  if (loadError) {
    // for the error boundary
    throw loadError;
  }

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  return (
    <div style={{ height: "100%" }} className="setsquare-app">
      <Setsquare
        aiEnabled={false}
        onChange={onChange}
        onExport={onExport}
        initialData={initialStatePromiseRef.current.promise}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            loadScene,
          },
          // the desktop app's menu bar carries the main menu's items
          mainMenu: !isTauri(),
        }}
        langCode={langCode}
        renderTopLeftUI={renderTopLeftUI}
        renderTopRightUI={renderTopRightUI}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={theme}
        onThemeChange={onThemeChange}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            if (openLinkedScene?.(element.link)) {
              return;
            }
            setsquareAPI?.setViewport({
              target: element.link,
              fit: "scale-down",
              animation: true,
            });
          } else if (element.link && isTauri()) {
            // the desktop app has no tabs, so links open in the browser
            event.preventDefault();
            openUrl(element.link).catch((error) =>
              console.error("Couldn't open link", error),
            );
          }
        }}
      >
        {children}
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => setsquareAPI?.refresh()} />
        {(localStorageQuotaExceeded || imageSaveFailed) && (
          <div className="alert alert--danger">
            {localStorageQuotaExceeded
              ? t("alerts.localStorageQuotaExceeded")
              : t("alerts.imageSaveFailed")}
          </div>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
            ...commandPaletteItems,
          ]}
        />
        {isVisualDebuggerEnabled() && setsquareAPI && (
          <DebugCanvas
            appState={setsquareAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Setsquare>
    </div>
  );
};

import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Setsquare,
  CaptureUpdateAction,
  SetsquareAPIProvider,
  useSetsquareAPI,
} from "@setsquare/setsquare";
import { trackEvent } from "@setsquare/setsquare/analytics";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@setsquare/setsquare/components/CommandPalette/CommandPalette";
import { OverwriteConfirmDialog } from "@setsquare/setsquare/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@setsquare/setsquare/components/OverwriteConfirm/OverwriteConfirmState";
import Trans from "@setsquare/setsquare/components/Trans";
import {
  APP_NAME,
  EVENT,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isDevEnv,
} from "@setsquare/common";
import polyfill from "@setsquare/setsquare/polyfill";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadFromBlob } from "@setsquare/setsquare/data/blob";
import { t } from "@setsquare/setsquare/i18n";

import { isElementLink } from "@setsquare/element";
import {
  restoreAppState,
  restoreElements,
} from "@setsquare/setsquare/data/restore";
import { newElementWith } from "@setsquare/element";
import { isInitializedImageElement } from "@setsquare/element";
import { useHandleLibrary } from "@setsquare/setsquare/data/library";

import type { RestoredDataState } from "@setsquare/setsquare/data/restore";
import type {
  FileId,
  NonDeletedSetsquareElement,
  OrderedSetsquareElement,
} from "@setsquare/element/types";
import type {
  AppState,
  BinaryFiles,
  SetsquareInitialDataState,
  UIAppState,
  SetsquareProps,
} from "@setsquare/setsquare/types";
import type { ResolvablePromise } from "@setsquare/common/utils";

import CustomStats from "./CustomStats";
import { Provider, useAtomValue, appJotaiStore } from "./app-jotai";
import { STORAGE_KEYS, SYNC_BROWSER_TABS_TIMEOUT } from "./app_constants";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import { TopErrorBoundary } from "./components/TopErrorBoundary";
import { DesktopMenu } from "./desktop/DesktopMenu";

import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";
import { importFromLocalStorage } from "./data/localStorage";

import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { useSimulatedCollaborators } from "./debugCollaborators";

import "./index.scss";

polyfill();

window.SETSQUARE_THROTTLE_RENDER = true;

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

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const getSceneUrl = () => window.location.hash.match(/^#url=(.*)$/)?.[1];

// fetches the scene a `#url=` link points to. Resolves to null when the user
// keeps the current scene.
const loadSceneFromUrl = async (url: string, hasElements: boolean) => {
  window.history.replaceState({}, APP_NAME, window.location.origin);

  const request = await fetch(window.decodeURIComponent(url));
  const data = await loadFromBlob(await request.blob(), null, null);
  if (!hasElements || (await openConfirmModal(shareableLinkConfirmDialog))) {
    return data;
  }
  return null;
};

const initializeScene = async (): Promise<SetsquareInitialDataState> => {
  const url = getSceneUrl();

  const localDataState = importFromLocalStorage();

  const scene: Omit<
    RestoredDataState,
    // we're not storing files in localStorage, and instead fetch them async
    // from a different store
    "files"
  > = {
    elements: restoreElements(localDataState?.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    }),
    appState: restoreAppState(localDataState?.appState, null),
  };

  if (url) {
    try {
      const data = await loadSceneFromUrl(url, scene.elements.length > 0);
      if (data) {
        return data;
      }
    } catch (error: any) {
      return {
        ...scene,
        appState: {
          ...scene.appState,
          errorMessage: t("alerts.invalidSceneUrl"),
        },
      };
    }
  }

  return scene;
};

const SetsquareWrapper = () => {
  const setsquareAPI = useSetsquareAPI();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

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

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  useHandleLibrary({
    setsquareAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);

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
        LocalData.fileStorage
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
      // on fresh load, clear unused files from IDB (from previous
      // session)
      LocalData.fileStorage.clearObsoleteFiles({
        currentFileIds: fileIds,
      });
    },
    [setsquareAPI],
  );

  useEffect(() => {
    if (!setsquareAPI) {
      return;
    }

    initializeScene().then(async (scene) => {
      loadImages(scene);
      initialStatePromiseRef.current.promise.resolve(scene);
    });

    // only `#url=` links load a scene; any other hash, such as a link to an
    // anchor, leaves the open scene alone
    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const url = getSceneUrl();
      if (!url) {
        return;
      }
      setsquareAPI.updateScene({ appState: { isLoading: true } });

      try {
        const scene = await loadSceneFromUrl(
          url,
          setsquareAPI.getSceneElements().length > 0,
        );
        if (!scene) {
          setsquareAPI.updateScene({ appState: { isLoading: false } });
          return;
        }
        setsquareAPI.addFiles(Object.values(scene.files));
        setsquareAPI.updateScene({
          elements: restoreElements(scene.elements, null, {
            repairBindings: true,
          }),
          appState: restoreAppState(scene.appState, null),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      } catch (error: any) {
        setsquareAPI.updateScene({
          appState: {
            isLoading: false,
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (!document.hidden) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          setLangCode(getPreferredLanguage());
          setsquareAPI.updateScene({
            ...localDataState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              setsquareAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
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
            LocalData.fileStorage
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
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [setsquareAPI, setLangCode, loadImages]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        setsquareAPI &&
        LocalData.fileStorage.shouldPreventUnload(
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
  }, [setsquareAPI]);

  const onChange = (
    elements: readonly OrderedSetsquareElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (setsquareAPI) {
          let didChange = false;

          const elements = setsquareAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
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

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

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
          },
          // the desktop app's menu bar carries the main menu's items
          mainMenu: !isTauri(),
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        onThemeChange={setAppTheme}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
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
        {isTauri() ? (
          <DesktopMenu theme={appTheme} setTheme={setAppTheme} />
        ) : (
          <AppMainMenu
            theme={appTheme}
            refresh={() => forceRefresh((prev) => !prev)}
          />
        )}
        <AppWelcomeScreen />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => setsquareAPI?.refresh()} />
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
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

const SetsquareApp = () => {
  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <SetsquareAPIProvider>
          <SetsquareWrapper />
        </SetsquareAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default SetsquareApp;

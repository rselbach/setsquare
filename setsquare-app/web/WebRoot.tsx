import { LoadingMessage } from "@setsquare/setsquare/components/LoadingMessage";
import { t } from "@setsquare/setsquare/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppMainMenu } from "../components/AppMainMenu";
import { AppWelcomeScreen } from "../components/AppWelcomeScreen";
import { useHandleAppTheme } from "../useHandleAppTheme";
import { LocalWorkspaceStore } from "../workspace/local/LocalWorkspaceStore";
import { RemoteWorkspaceStore } from "../workspace/remote/RemoteWorkspaceStore";
import {
  WorkspacePage,
  isSearching,
  usePageSearch,
} from "../workspace/ui/WorkspacePage";
import { WorkspaceShell, useNavState } from "../workspace/ui/WorkspaceShell";
import {
  WorkspaceToast,
  WorkspaceToastAnnouncer,
  WorkspaceToastContext,
  useWorkspaceToast,
} from "../workspace/ui/WorkspaceToast";

import { DrawingRoute } from "./DrawingRoute";
import { AccountContext } from "./accountContext";
import { AccountNotice } from "./accountControls";
import { EditorTasks, useEditorTasks } from "./editorTasks";
import { useLaunchedFiles } from "./importFiles";
import { openSceneUrl, useSceneUrlLinks } from "./importScene";
import { initRouter, navigate, parseRoute, useRoute } from "./router";
import { trashWithUndo, useDrawingActions } from "./workspaceActions";
import {
  isVersionError,
  openWorkspaceStore,
  readAccountSession,
} from "./workspaceStore";

import type { DrawingId, ItemRef } from "../workspace/types";
import type { OpenDrawing } from "../workspace/ui/NavDrawingRow";
import type { NavToggle } from "../workspace/ui/WorkspaceNav";
import type { WorkspaceToastState } from "../workspace/ui/WorkspaceToast";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { EditorTask, QueuedTasks } from "./editorTasks";
import type { AccountState } from "./accountContext";
import type { OpenWorkspaceOptions } from "./workspaceStore";

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
// for browsers without requestIdleCallback
const IDLE_FALLBACK_MS = 2000;
const LOADING_DELAY_MS = 250;

const ROOT = { kind: "drawings", folderId: null } as const;

/** The workspace, and what the app has to show once it can. */
type Booted = { store: WorkspaceStore; tasks: EditorTask[] };

// brings the workspace up to date before anything shows it
const boot = async (options: OpenWorkspaceOptions): Promise<Booted> => {
  const store = await openWorkspaceStore(options);
  let migrated: DrawingId | null = null;
  if (store instanceof LocalWorkspaceStore) {
    migrated = await store.migrateLegacyScene();
    await store.purgeExpiredTrash().catch((error) => console.error(error));
  }
  // before the page shows another drawing, which would be open for nothing
  const tasks = await openSceneUrl(store);
  // the first visit after the upgrade opens the drawing there was, once
  const route = parseRoute(options.ownerWindow?.location.href ?? "/");
  if (migrated && route.kind === "drawings" && route.folderId === null) {
    await navigate({ kind: "drawing", id: migrated }, { replace: true });
    tasks.push({ kind: "hint", message: () => t("workspace.allDrawingsHint") });
  }
  return { store, tasks };
};

// a newer build's service worker waits until every tab of the older one
// closes, and reloading this tab doesn't count, so it takes over first
const reloadToUpdate = async (ownerWindow: Window) => {
  const { serviceWorker } = ownerWindow.navigator;
  const waiting = await serviceWorker
    ?.getRegistration()
    .then((registration) => registration?.waiting)
    .catch(() => undefined);
  if (!waiting) {
    ownerWindow.location.reload();
    return;
  }
  serviceWorker.addEventListener(
    "controllerchange",
    () => ownerWindow.location.reload(),
    { once: true },
  );
  waiting.postMessage({ type: "SKIP_WAITING" });
};

const whenIdle = (ownerWindow: Window, callback: () => void) => {
  if (typeof ownerWindow.requestIdleCallback === "function") {
    const handle = ownerWindow.requestIdleCallback(callback);
    return () => ownerWindow.cancelIdleCallback(handle);
  }
  const handle = ownerWindow.setTimeout(callback, IDLE_FALLBACK_MS);
  return () => ownerWindow.clearTimeout(handle);
};

// the editor on a drawing, with the web app's menu, which create next to it,
// and the app's toast, which can't be the editor's own: that one can't
// carry Undo, and phones don't show it
const DrawingView = ({
  store,
  id,
  editorTheme,
  appTheme,
  setAppTheme,
  nav,
  onOpen,
  tasks,
  toast,
  trash,
}: {
  store: WorkspaceStore;
  id: DrawingId;
  nav: NavToggle;
  onOpen: (drawing: OpenDrawing | null) => void;
  tasks: QueuedTasks;
  toast: WorkspaceToastState;
  trash: (item: ItemRef) => void;
} & ReturnType<typeof useHandleAppTheme>) => {
  const [, forceRefresh] = useState(false);
  const actions = useDrawingActions(store, id, tasks.queueTask, trash);

  return (
    <DrawingRoute
      store={store}
      id={id}
      theme={editorTheme}
      onThemeChange={setAppTheme}
      actions={actions}
      nav={nav}
      onOpen={onOpen}
      tasks={tasks}
      toast={toast}
    >
      <AppMainMenu
        theme={appTheme}
        refresh={() => forceRefresh((prev) => !prev)}
        actions={actions}
      />
      <AppWelcomeScreen
        actions={actions}
        storage={store.recoveryKey ? "account" : "browser"}
      />
      <EditorTasks tasks={tasks.tasks} onRun={tasks.onRun} />
      <WorkspaceToast toast={toast} className="workspace-toast--editor" />
      <AccountNotice />
    </DrawingRoute>
  );
};

const Workspace = ({
  booted: { store, tasks: bootTasks },
  ownerWindow,
  ...theme
}: {
  booted: Booted;
  ownerWindow: Window;
} & ReturnType<typeof useHandleAppTheme>) => {
  const route = useRoute();
  const nav = useNavState();
  const [search, setSearch] = usePageSearch(route);
  const [editing, setEditing] = useState<OpenDrawing | null>(null);
  const tasks = useEditorTasks(bootTasks);
  // one toast for the page and the editor, so an Undo outlasts either
  const toast = useWorkspaceToast();
  const { show } = toast;
  const trash = useCallback(
    (item: ItemRef) => {
      void trashWithUndo(store, item, show);
    },
    [store, show],
  );

  useSceneUrlLinks(store, tasks.queueTask);
  useLaunchedFiles(store, tasks.queueTask);

  useEffect(() => {
    if (!(store instanceof LocalWorkspaceStore)) {
      return;
    }
    const purge = ownerWindow.setInterval(() => {
      store.purgeExpiredTrash().catch((error) => console.error(error));
    }, PURGE_INTERVAL_MS);
    const cancelCollecting = whenIdle(ownerWindow, () => {
      store.collectUnusedFiles().catch((error) => console.error(error));
    });
    return () => {
      ownerWindow.clearInterval(purge);
      cancelCollecting();
    };
  }, [store, ownerWindow]);

  // there's no page at other addresses
  useEffect(() => {
    if (route.kind === "notFound") {
      navigate(ROOT, { replace: true });
    }
  }, [route]);

  return (
    <WorkspaceToastContext.Provider value={show}>
      <WorkspaceShell
        store={store}
        route={route}
        searching={isSearching(route, search)}
        editing={editing}
        trash={trash}
        theme={theme.editorTheme}
        appTheme={theme.appTheme}
        onThemeChange={theme.setAppTheme}
        nav={nav}
      >
        {route.kind === "drawing" ? (
          <DrawingView
            store={store}
            id={route.id}
            nav={nav.toggle}
            onOpen={setEditing}
            tasks={tasks}
            toast={toast}
            trash={trash}
            {...theme}
          />
        ) : (
          <WorkspacePage
            store={store}
            route={route.kind === "notFound" ? ROOT : route}
            theme={theme.editorTheme}
            nav={nav.toggle}
            search={search}
            setSearch={setSearch}
            tasks={tasks}
            toast={toast}
            trash={trash}
          />
        )}
      </WorkspaceShell>
      <WorkspaceToastAnnouncer toast={toast} />
    </WorkspaceToastContext.Provider>
  );
};

/** The web workspace, opened locally or for a signed-in account. */
export const WebRoot = () => {
  const theme = useHandleAppTheme();
  const [booted, setBooted] = useState<Booted | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [account, setAccount] = useState<AccountState>({ kind: "local" });
  const [attempt, setAttempt] = useState(0);
  // this tab's open waits for older tabs to close
  const [blocked, setBlocked] = useState(false);
  // a newer tab's open closed this one's database
  const [updatedElsewhere, setUpdatedElsewhere] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const ownerWindow = host.current?.ownerDocument.defaultView ?? null;
  // a ref outlives StrictMode's second effect run, so the store opens once
  const booting = useRef<Promise<Booted> | null>(null);
  const initialSession = useRef<AccountState>({ kind: "local" });
  const expire = useCallback(() => {
    setAccount((current) =>
      current.kind === "signedIn"
        ? { kind: "expired", user: current.user }
        : current,
    );
  }, []);

  useEffect(() => {
    const mountedWindow = host.current?.ownerDocument.defaultView;
    return mountedWindow ? initRouter(mountedWindow) : undefined;
  }, []);

  useEffect(() => {
    const mountedWindow = host.current?.ownerDocument.defaultView;
    if (!mountedWindow) {
      return;
    }
    booting.current ??= boot({
      ownerWindow: mountedWindow,
      onSession: (session) => {
        initialSession.current = session;
        setAccount(session);
      },
      onSessionExpired: expire,
      onBlocked: () => setBlocked(true),
      onVersionChange: () => setUpdatedElsewhere(true),
    });
    let active = true;
    booting.current.then(
      (value) => active && setBooted(value),
      (error) => active && setError(error),
    );
    return () => {
      active = false;
    };
  }, [attempt, expire]);

  useEffect(() => {
    const { kind } = initialSession.current;
    if (!ownerWindow || !booted || kind === "local" || kind === "unreachable") {
      return;
    }
    const refreshAccount = async () => {
      const session = await readAccountSession(ownerWindow);
      // a server that doesn't answer says nothing about the session
      if (session.kind === "unreachable") {
        return;
      }
      const initial = initialSession.current;
      if (initial.kind === "signedIn") {
        if (
          session.kind !== "signedIn" ||
          initial.user.id !== session.user.id ||
          initial.csrfToken !== session.csrfToken
        ) {
          expire();
          return;
        }
      } else if (session.kind === "signedIn") {
        setAccount({ kind: "changed" });
        return;
      }
      if (booted.store instanceof RemoteWorkspaceStore) {
        await booted.store.refresh();
      }
    };
    const onFocus = () => {
      refreshAccount().catch((failure) => console.warn(failure));
    };
    ownerWindow.addEventListener("focus", onFocus);
    return () => ownerWindow.removeEventListener("focus", onFocus);
  }, [booted, ownerWindow, expire]);

  const retry = () => {
    booting.current = null;
    setError(null);
    setBlocked(false);
    setAttempt((current) => current + 1);
  };

  const reload = () => {
    if (ownerWindow) {
      reloadToUpdate(ownerWindow).catch((failure) => console.error(failure));
    }
  };

  return (
    <div className="setsquare-web-root" ref={host}>
      {isVersionError(error) ? (
        <div className="account-boot-error" role="alert">
          <h1>{t("workspace.outdatedTab")}</h1>
          <p>{t("workspace.outdatedTabHint")}</p>
          <button type="button" onClick={reload}>
            {t("workspace.accountReload")}
          </button>
        </div>
      ) : error ? (
        <div className="account-boot-error" role="alert">
          <h1>{t("workspace.accountLoadFailed")}</h1>
          <p>{t("workspace.accountLoadFailedHint")}</p>
          <button type="button" onClick={retry}>
            {t("workspace.accountRetry")}
          </button>
        </div>
      ) : updatedElsewhere ? (
        // the workspace closes, and its editor's unmount keeps a recovery
        // copy of what it hadn't saved, which the reload finds
        <div className="account-boot-error" role="alert">
          <h1>{t("workspace.updatedElsewhere")}</h1>
          <p>{t("workspace.updatedElsewhereHint")}</p>
          <button type="button" onClick={reload}>
            {t("workspace.accountReload")}
          </button>
        </div>
      ) : booted && ownerWindow ? (
        <AccountContext.Provider
          value={{ state: account, ownerWindow, store: booted.store, expire }}
        >
          <Workspace booted={booted} ownerWindow={ownerWindow} {...theme} />
        </AccountContext.Provider>
      ) : blocked ? (
        <div className="account-boot-error" role="status">
          <h1>{t("workspace.updateBlocked")}</h1>
          <p>{t("workspace.updateBlockedHint")}</p>
        </div>
      ) : (
        <LoadingMessage theme={theme.editorTheme} delay={LOADING_DELAY_MS} />
      )}
    </div>
  );
};

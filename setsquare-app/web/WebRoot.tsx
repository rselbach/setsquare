import { LoadingMessage } from "@setsquare/setsquare/components/LoadingMessage";
import { t } from "@setsquare/setsquare/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppMainMenu } from "../components/AppMainMenu";
import { AppWelcomeScreen } from "../components/AppWelcomeScreen";
import { useHandleAppTheme } from "../useHandleAppTheme";
import { LocalWorkspaceStore } from "../workspace/local/LocalWorkspaceStore";
import { RemoteWorkspaceStore } from "../workspace/remote/RemoteWorkspaceStore";
import { WorkspacePage } from "../workspace/ui/WorkspacePage";
import {
  WorkspaceToast,
  useWorkspaceToast,
} from "../workspace/ui/WorkspaceToast";

import { DrawingRoute } from "./DrawingRoute";
import { AccountContext } from "./accountContext";
import { AccountNotice } from "./accountControls";
import { EditorTasks, useEditorTasks } from "./editorTasks";
import { useLaunchedFiles } from "./importFiles";
import { openSceneUrl, sceneUrlFailed, useSceneUrlLinks } from "./importScene";
import { initRouter, navigate, parseRoute, useRoute } from "./router";
import { trashWithUndo, useDrawingActions } from "./workspaceActions";
import { openWorkspaceStore, readAccountSession } from "./workspaceStore";

import type { DrawingId, ItemRef } from "../workspace/types";
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
  const tasks = (await openSceneUrl(store)) ? [] : [sceneUrlFailed()];
  // the first visit after the upgrade opens the drawing there was, once
  const route = parseRoute(options.ownerWindow?.location.href ?? "/");
  if (migrated && route.kind === "drawings" && route.folderId === null) {
    await navigate({ kind: "drawing", id: migrated }, { replace: true });
    tasks.push({ kind: "hint", message: () => t("workspace.allDrawingsHint") });
  }
  return { store, tasks };
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
  tasks,
  toast,
  trash,
}: {
  store: WorkspaceStore;
  id: DrawingId;
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
  const tasks = useEditorTasks(bootTasks);
  // one toast for the page and the editor, so an Undo outlasts either
  const toast = useWorkspaceToast();
  const { show } = toast;
  const trash = useCallback(
    (item: ItemRef) => {
      trashWithUndo(store, item, show).catch((error) => console.error(error));
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

  if (route.kind === "drawing") {
    return (
      <DrawingView
        store={store}
        id={route.id}
        tasks={tasks}
        toast={toast}
        trash={trash}
        {...theme}
      />
    );
  }
  return (
    <WorkspacePage
      store={store}
      route={route.kind === "notFound" ? ROOT : route}
      theme={theme.editorTheme}
      appTheme={theme.appTheme}
      onThemeChange={theme.setAppTheme}
      tasks={tasks}
      toast={toast}
      trash={trash}
    />
  );
};

/** The web workspace, opened locally or for a signed-in account. */
export const WebRoot = () => {
  const theme = useHandleAppTheme();
  const [booted, setBooted] = useState<Booted | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [account, setAccount] = useState<AccountState>({ kind: "local" });
  const [attempt, setAttempt] = useState(0);
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
    if (!ownerWindow || !booted || initialSession.current.kind === "local") {
      return;
    }
    const refreshAccount = async () => {
      const session = await readAccountSession(ownerWindow);
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
    setAttempt((current) => current + 1);
  };
  const backToDrawings = () => {
    navigate(ROOT, { replace: true }).then(retry, (failure) =>
      setError(failure),
    );
  };

  return (
    <div className="setsquare-web-root" ref={host}>
      {error ? (
        <div className="account-boot-error" role="alert">
          <h1>{t("workspace.accountLoadFailed")}</h1>
          <p>{t("workspace.accountLoadFailedHint")}</p>
          <button type="button" onClick={retry}>
            {t("workspace.accountRetry")}
          </button>
          <button type="button" onClick={backToDrawings}>
            {t("workspace.accountBackToDrawings")}
          </button>
        </div>
      ) : booted && ownerWindow ? (
        <AccountContext.Provider
          value={{ state: account, ownerWindow, store: booted.store, expire }}
        >
          <Workspace booted={booted} ownerWindow={ownerWindow} {...theme} />
          <AccountNotice />
        </AccountContext.Provider>
      ) : (
        <LoadingMessage theme={theme.editorTheme} delay={LOADING_DELAY_MS} />
      )}
    </div>
  );
};

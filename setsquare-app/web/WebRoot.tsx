import { LoadingMessage } from "@setsquare/setsquare/components/LoadingMessage";
import { t } from "@setsquare/setsquare/i18n";
import { useEffect, useRef, useState } from "react";

import { AppMainMenu } from "../components/AppMainMenu";
import { AppWelcomeScreen } from "../components/AppWelcomeScreen";
import { useHandleAppTheme } from "../useHandleAppTheme";
import { WorkspacePage } from "../workspace/ui/WorkspacePage";

import { DrawingRoute } from "./DrawingRoute";
import { EditorTasks, useEditorTasks } from "./editorTasks";
import { useLaunchedFiles } from "./importFiles";
import { openSceneUrl, sceneUrlFailed, useSceneUrlLinks } from "./importScene";
import { initRouter, navigate, parseRoute, useRoute } from "./router";
import { useDrawingActions } from "./workspaceActions";
import { openWorkspaceStore } from "./workspaceStore";

import type { LocalWorkspaceStore } from "../workspace/local/LocalWorkspaceStore";
import type { DrawingId } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { EditorTask, QueuedTasks } from "./editorTasks";

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
// for browsers without requestIdleCallback
const IDLE_FALLBACK_MS = 2000;
const LOADING_DELAY_MS = 250;

const ROOT = { kind: "drawings", folderId: null } as const;

/** The workspace, and what the app has to show once it can. */
type Booted = { store: LocalWorkspaceStore; tasks: EditorTask[] };

// brings the workspace up to date before anything shows it
const boot = async (): Promise<Booted> => {
  const store = await openWorkspaceStore();
  const migrated = await store.migrateLegacyScene();
  await store.purgeExpiredTrash().catch((error) => console.error(error));
  // before the page shows another drawing, which would be open for nothing
  const tasks = (await openSceneUrl(store)) ? [] : [sceneUrlFailed()];
  // the first visit after the upgrade opens the drawing there was, once
  const route = parseRoute(window.location.href);
  if (migrated && route.kind === "drawings" && route.folderId === null) {
    await navigate({ kind: "drawing", id: migrated }, { replace: true });
    tasks.push({ kind: "hint", message: () => t("workspace.allDrawingsHint") });
  }
  return { store, tasks };
};

const whenIdle = (callback: () => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback);
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(handle);
};

// the editor on a drawing, with the web app's menu, which create next to it
const DrawingView = ({
  store,
  id,
  editorTheme,
  appTheme,
  setAppTheme,
  tasks,
}: {
  store: WorkspaceStore;
  id: DrawingId;
  tasks: QueuedTasks;
} & ReturnType<typeof useHandleAppTheme>) => {
  const [, forceRefresh] = useState(false);
  const actions = useDrawingActions(store, id, tasks.queueTask);

  return (
    <DrawingRoute
      store={store}
      id={id}
      theme={editorTheme}
      onThemeChange={setAppTheme}
      actions={actions}
    >
      <AppMainMenu
        theme={appTheme}
        refresh={() => forceRefresh((prev) => !prev)}
        actions={actions}
      />
      <AppWelcomeScreen actions={actions} />
      <EditorTasks tasks={tasks.tasks} onRun={tasks.onRun} />
    </DrawingRoute>
  );
};

const Workspace = ({
  booted: { store, tasks: bootTasks },
  ...theme
}: {
  booted: Booted;
} & ReturnType<typeof useHandleAppTheme>) => {
  const route = useRoute();
  const tasks = useEditorTasks(bootTasks);

  useSceneUrlLinks(store, tasks.queueTask);
  useLaunchedFiles(store, tasks.queueTask);

  useEffect(() => {
    const purge = window.setInterval(() => {
      store.purgeExpiredTrash().catch((error) => console.error(error));
    }, PURGE_INTERVAL_MS);
    const cancelCollecting = whenIdle(() => {
      store.collectUnusedFiles().catch((error) => console.error(error));
    });
    return () => {
      window.clearInterval(purge);
      cancelCollecting();
    };
  }, [store]);

  // there's no Trash page yet, nor any at other addresses
  useEffect(() => {
    if (route.kind === "trash" || route.kind === "notFound") {
      navigate(ROOT, { replace: true });
    }
  }, [route]);

  if (route.kind === "drawing") {
    return <DrawingView store={store} id={route.id} tasks={tasks} {...theme} />;
  }
  return (
    <WorkspacePage
      store={store}
      route={
        route.kind === "drawings" || route.kind === "recent" ? route : ROOT
      }
      theme={theme.editorTheme}
      appTheme={theme.appTheme}
      onThemeChange={theme.setAppTheme}
      tasks={tasks}
    />
  );
};

/** The web app: the workspace of drawings kept in this browser. */
export const WebRoot = () => {
  const theme = useHandleAppTheme();
  const [booted, setBooted] = useState<Booted | null>(null);
  const [error, setError] = useState<unknown>(null);
  // a ref outlives StrictMode's second effect run, so the store opens once
  const booting = useRef<Promise<Booted> | null>(null);

  useEffect(() => initRouter(), []);

  useEffect(() => {
    booting.current ??= boot();
    let active = true;
    booting.current.then(
      (value) => active && setBooted(value),
      (error) => active && setError(error),
    );
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    throw error;
  }
  if (!booted) {
    return (
      <LoadingMessage theme={theme.editorTheme} delay={LOADING_DELAY_MS} />
    );
  }
  return <Workspace booted={booted} {...theme} />;
};

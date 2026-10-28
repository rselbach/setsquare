import { LoadingMessage } from "@setsquare/setsquare/components/LoadingMessage";
import { useEffect, useRef, useState } from "react";

import type { Theme } from "@setsquare/element/types";

import { AppMainMenu } from "../components/AppMainMenu";
import { AppWelcomeScreen } from "../components/AppWelcomeScreen";
import { useHandleAppTheme } from "../useHandleAppTheme";
import { recentDrawings } from "../workspace/tree";

import { DrawingRoute } from "./DrawingRoute";
import { openSceneUrl, useSceneUrlLinks } from "./importScene";
import { initRouter, navigate, useRoute } from "./router";
import { openWorkspaceStore } from "./workspaceStore";

import type { LocalWorkspaceStore } from "../workspace/local/LocalWorkspaceStore";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;
// for browsers without requestIdleCallback
const IDLE_FALLBACK_MS = 2000;
const LOADING_DELAY_MS = 250;

type Booted = { store: LocalWorkspaceStore; openedSceneUrl: boolean };

// brings the workspace up to date before anything shows it
const boot = async (): Promise<Booted> => {
  const store = await openWorkspaceStore();
  await store.migrateLegacyScene();
  await store.purgeExpiredTrash().catch((error) => console.error(error));
  // before the page shows another drawing, which would be open for nothing
  const openedSceneUrl = await openSceneUrl(store);
  return { store, openedSceneUrl };
};

const whenIdle = (callback: () => void) => {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(callback);
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(callback, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(handle);
};

// the workspace has no pages of its own yet, so each opens the drawing used
// last, or a new one when there's none
const OpenRecentDrawing = ({
  store,
  theme,
}: {
  store: WorkspaceStore;
  theme: Theme;
}) => {
  const [error, setError] = useState<unknown>(null);
  // a ref outlives StrictMode's second effect run, so it creates one drawing
  const opening = useRef(false);

  useEffect(() => {
    if (opening.current) {
      return;
    }
    opening.current = true;
    const [recent] = recentDrawings(store.getSnapshot(), 1);
    (recent
      ? Promise.resolve(recent)
      : store.createDrawing({ folderId: null, name: null })
    ).then(
      (drawing) =>
        navigate({ kind: "drawing", id: drawing.id }, { replace: true }),
      setError,
    );
  }, [store]);

  if (error) {
    throw error;
  }
  return <LoadingMessage theme={theme} delay={LOADING_DELAY_MS} />;
};

const Workspace = ({
  booted: { store, openedSceneUrl },
  editorTheme,
  appTheme,
  setAppTheme,
}: {
  booted: Booted;
} & ReturnType<typeof useHandleAppTheme>) => {
  const route = useRoute();
  const [, forceRefresh] = useState(false);

  useSceneUrlLinks(store, { failedOnOpen: !openedSceneUrl });

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

  if (route.kind !== "drawing") {
    return <OpenRecentDrawing store={store} theme={editorTheme} />;
  }
  return (
    <DrawingRoute
      store={store}
      id={route.id}
      theme={editorTheme}
      onThemeChange={setAppTheme}
    >
      <AppMainMenu
        theme={appTheme}
        refresh={() => forceRefresh((prev) => !prev)}
      />
      <AppWelcomeScreen />
    </DrawingRoute>
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

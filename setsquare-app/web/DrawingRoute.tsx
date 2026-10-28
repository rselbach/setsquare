import { APP_NAME, EVENT } from "@setsquare/common";
import { useSetsquareAPI } from "@setsquare/setsquare";
import { LoadingMessage } from "@setsquare/setsquare/components/LoadingMessage";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { Theme } from "@setsquare/element/types";
import type { SetsquareProps } from "@setsquare/setsquare/types";

import { EditorShell } from "../editor/EditorShell";

import { createDrawingPersistence } from "./drawingPersistence";
import { navigate, setLeaveGuard } from "./router";
import { replayUnsaved, writeUnsaved } from "./unsavedJournal";

import type { DrawingId, OpenedDrawing } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { DrawingPersistence } from "./drawingPersistence";
import type { Route } from "./router";

const DRAWINGS: Route = { kind: "drawings", folderId: null };

const openDrawing = async (store: WorkspaceStore, id: DrawingId) => {
  const drawing = await store.openDrawing(id);
  return drawing && replayUnsaved(store, drawing);
};

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

type Session = { id: DrawingId; persistence: DrawingPersistence };

/**
 * The editor on one drawing of the workspace. It opens the drawing first,
 * going back to the drawings if it's gone, and saves it before the app
 * leaves it.
 */
export const DrawingRoute = ({
  store,
  id,
  theme,
  onThemeChange,
  children,
}: {
  store: WorkspaceStore;
  id: DrawingId;
  theme: Theme;
  onThemeChange: (theme: Theme | "system") => void;
  /** the main menu, the welcome screen and anything else the editor shows */
  children: SetsquareProps["children"];
}) => {
  const setsquareAPI = useSetsquareAPI();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>(null);
  // a ref outlives StrictMode's second effect run, so each id opens once
  const opening = useRef<{
    id: DrawingId;
    drawing: Promise<OpenedDrawing | null>;
  } | null>(null);

  useEffect(() => {
    if (opening.current?.id !== id) {
      opening.current = { id, drawing: openDrawing(store, id) };
    }
    let active = true;
    opening.current.drawing.then(
      (drawing) => {
        if (!active) {
          return;
        }
        if (!drawing) {
          navigate(DRAWINGS, { replace: true });
          return;
        }
        setSession({
          id,
          persistence: createDrawingPersistence({
            store,
            drawing,
            // such as when another tab deleted it
            onNotFound: () => navigate(DRAWINGS, { replace: true }),
          }),
        });
      },
      (error) => active && setError(error),
    );
    return () => {
      active = false;
    };
  }, [store, id]);

  // the session of an earlier id until this one opens
  const current = session?.id === id ? session : null;

  useEffect(() => {
    if (!current) {
      return;
    }
    const { persistence } = current;
    setLeaveGuard(async () => {
      // the text being typed is part of the drawing too
      setsquareAPI?.submitTextEditor();
      // so the editor has reported the change before it's flushed
      await nextFrame();
      await persistence.flush();
    });
    // the page may close before an IndexedDB write started now commits
    const onPageHide = () => {
      const unsaved = persistence.unsaved();
      if (unsaved) {
        writeUnsaved(unsaved);
      }
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener(EVENT.BEFORE_UNLOAD, onPageHide);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener(EVENT.BEFORE_UNLOAD, onPageHide);
      // a no-op after the leave guard, but not every unmount runs it
      persistence.flush();
    };
  }, [current, setsquareAPI]);

  const name = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
  ).drawings.get(id)?.name;
  useEffect(() => {
    document.title = name ? `${name} · ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [name]);

  if (error) {
    // for the error boundary
    throw error;
  }
  if (!current) {
    return <LoadingMessage theme={theme} delay={250} />;
  }
  return (
    <EditorShell
      key={id}
      persistence={current.persistence}
      theme={theme}
      onThemeChange={onThemeChange}
    >
      {children}
    </EditorShell>
  );
};

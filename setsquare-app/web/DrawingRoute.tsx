import { APP_NAME, EVENT } from "@setsquare/common";
import { useSetsquareAPI } from "@setsquare/setsquare";
import { getShortcutFromShortcutName } from "@setsquare/setsquare/actions/shortcuts";
import { DEFAULT_CATEGORIES } from "@setsquare/setsquare/components/CommandPalette/CommandPalette";
import { LoadingMessage } from "@setsquare/setsquare/components/LoadingMessage";
import { LoadIcon, TrashIcon } from "@setsquare/setsquare/components/icons";
import { t } from "@setsquare/setsquare/i18n";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Theme } from "@setsquare/element/types";
import type { CommandPaletteItem } from "@setsquare/setsquare/components/CommandPalette/types";
import type { SetsquareProps } from "@setsquare/setsquare/types";

import { EditorShell } from "../editor/EditorShell";
import { isTrashed } from "../workspace/tree";
import { DrawingNotice } from "../workspace/ui/DrawingNotice";

import { createDrawingPersistence } from "./drawingPersistence";
import { DrawingsSidebar } from "./DrawingsSidebar";
import { drawingsIcon, newDrawingIcon } from "./icons";
import { navigate, parseRoute, setLeaveGuard } from "./router";
import { replayUnsaved, writeUnsaved } from "./unsavedJournal";
import { useWorkspaceSnapshot } from "./useWorkspaceSnapshot";
import { discardIfUnused } from "./workspaceActions";

import type { DrawingId, OpenedDrawing } from "../workspace/types";
import type { NoticeKind } from "../workspace/ui/DrawingNotice";
import type { WorkspaceToastState } from "../workspace/ui/WorkspaceToast";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { DrawingPersistence } from "./drawingPersistence";
import type { QueuedTasks } from "./editorTasks";
import type { DrawingActions } from "./workspaceActions";

const drawingRef = (id: DrawingId) => ({ kind: "drawing", id } as const);

// a drawing in the Trash isn't opened, so it isn't marked as opened either
const openDrawing = async (
  store: WorkspaceStore,
  id: DrawingId,
): Promise<OpenedDrawing | NoticeKind> => {
  if (isTrashed(store.getSnapshot(), drawingRef(id))) {
    return "trashed";
  }
  const drawing = await store.openDrawing(id);
  if (!drawing) {
    return "missing";
  }
  // opening it brought the workspace up to date, which may show that
  // another tab trashed it
  if (isTrashed(store.getSnapshot(), drawingRef(id))) {
    return "trashed";
  }
  return replayUnsaved(store, drawing);
};

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * What shows of one opening of a drawing: the editor, or the notice that
 * it's in the Trash or isn't there. Restoring it opens it again.
 */
type Session = { id: DrawingId; attempt: number } & (
  | { kind: "editor"; persistence: DrawingPersistence }
  | { kind: NoticeKind }
);

type EditorSession = Extract<Session, { kind: "editor" }>;

/**
 * The editor on one drawing of the workspace, with the Drawings sidebar to
 * switch to others. It opens the drawing first, and saves it before the app
 * leaves it, discarding it then if it's a new drawing that was never used.
 * A drawing in the Trash or that isn't there shows a notice instead, as
 * does the open drawing when another tab trashes or deletes it.
 */
export const DrawingRoute = ({
  store,
  id,
  theme,
  onThemeChange,
  actions,
  tasks,
  toast,
  children,
}: {
  store: WorkspaceStore;
  id: DrawingId;
  theme: Theme;
  onThemeChange: (theme: Theme | "system") => void;
  actions: DrawingActions;
  /** what's left to show, which the notice shows in place of the editor */
  tasks: QueuedTasks;
  toast: WorkspaceToastState;
  /** the main menu, the welcome screen and anything else the editor shows */
  children: SetsquareProps["children"];
}) => {
  const setsquareAPI = useSetsquareAPI();
  const snapshot = useWorkspaceSnapshot(store);
  const [session, setSession] = useState<Session | null>(null);
  // restoring the drawing from the notice opens it again
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<unknown>(null);
  // a ref outlives StrictMode's second effect run, so each id opens once
  const opening = useRef<{
    id: DrawingId;
    attempt: number;
    drawing: Promise<OpenedDrawing | NoticeKind>;
  } | null>(null);
  // the editor that's leaving its drawing, which may delete the drawing as
  // it goes; that's no reason for a notice
  const leaving = useRef<EditorSession | null>(null);

  // the editor gives way to the notice, unless it's leaving anyway
  const giveWay = useCallback((editor: EditorSession, kind: NoticeKind) => {
    if (leaving.current !== editor) {
      setSession((session) =>
        session === editor
          ? { id: editor.id, attempt: editor.attempt, kind }
          : session,
      );
    }
  }, []);

  useEffect(() => {
    if (opening.current?.id !== id || opening.current.attempt !== attempt) {
      opening.current = { id, attempt, drawing: openDrawing(store, id) };
    }
    let active = true;
    opening.current.drawing.then(
      (drawing) => {
        if (!active) {
          return;
        }
        if (typeof drawing === "string") {
          setSession({ id, attempt, kind: drawing });
          return;
        }
        const editor: EditorSession = {
          id,
          attempt,
          kind: "editor",
          persistence: createDrawingPersistence({
            store,
            drawing,
            // such as when another tab deleted it
            onNotFound: () => giveWay(editor, "missing"),
          }),
        };
        setSession(editor);
      },
      (error) => active && setError(error),
    );
    return () => {
      active = false;
    };
  }, [store, id, attempt, giveWay]);

  // an earlier opening's session until this one opens
  const current =
    session?.id === id && session.attempt === attempt ? session : null;
  const editor = current?.kind === "editor" ? current : null;

  // saves what the editor has of the drawing
  const save = useCallback(
    async ({ persistence }: EditorSession) => {
      // the text being typed is part of the drawing too
      setsquareAPI?.submitTextEditor();
      // so the editor has reported the change before it's flushed
      await nextFrame();
      await persistence.flush();
    },
    [setsquareAPI],
  );

  useEffect(() => {
    if (!editor) {
      return;
    }
    const { persistence } = editor;
    setLeaveGuard(async () => {
      leaving.current = editor;
      await save(editor);
      await discardIfUnused(store, editor.id, persistence.unsaved() === null);
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
  }, [editor, save, store]);

  // once its last changes are saved, the thumbnail shows what the editor left
  useEffect(() => {
    if (!editor) {
      return;
    }
    const { persistence } = editor;
    return () => {
      persistence.flush().then(() => persistence.renderThumbnail());
    };
  }, [editor]);

  // another tab moved the drawing to the Trash or deleted it; what the
  // editor has still saves first, which a drawing in the Trash keeps
  const gone: NoticeKind | null = !snapshot.drawings.has(id)
    ? "missing"
    : isTrashed(snapshot, drawingRef(id))
    ? "trashed"
    : null;
  useEffect(() => {
    if (!editor || !gone || leaving.current === editor) {
      return;
    }
    let active = true;
    save(editor)
      .catch((error) => console.error(error))
      .then(() => active && giveWay(editor, gone));
    return () => {
      active = false;
    };
  }, [editor, gone, save, giveWay]);

  const name = snapshot.drawings.get(id)?.name;
  useEffect(() => {
    document.title = name ? `${name} · ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [name]);

  // a link to an element of another drawing opens that drawing, which then
  // scrolls to the element
  const openLinkedScene = useCallback(
    (link: string) => {
      const route = parseRoute(link);
      if (route.kind !== "drawing" || route.id === id) {
        return false;
      }
      navigate(route);
      return true;
    },
    [id],
  );

  if (error) {
    // for the error boundary
    throw error;
  }
  if (!current) {
    return <LoadingMessage theme={theme} delay={250} />;
  }
  if (current.kind !== "editor") {
    return (
      <DrawingNotice
        store={store}
        id={id}
        kind={current.kind}
        theme={theme}
        tasks={tasks}
        toast={toast}
        onRestore={() => {
          store.restore(drawingRef(id)).then(
            () => setAttempt((attempt) => attempt + 1),
            (error) => console.error(error),
          );
        }}
      />
    );
  }
  const commandPaletteItems: CommandPaletteItem[] = [
    {
      label: t("workspace.allDrawings"),
      category: DEFAULT_CATEGORIES.app,
      icon: drawingsIcon,
      perform: actions.allDrawings,
    },
    {
      label: t("workspace.newDrawing"),
      category: DEFAULT_CATEGORIES.app,
      icon: newDrawingIcon,
      perform: actions.newDrawing,
    },
    {
      label: t("workspace.openFile"),
      category: DEFAULT_CATEGORIES.app,
      icon: LoadIcon,
      shortcut: getShortcutFromShortcutName("loadScene"),
      perform: actions.openFile,
    },
    {
      label: t("workspace.moveDrawingToTrash"),
      category: DEFAULT_CATEGORIES.app,
      icon: TrashIcon,
      perform: actions.moveToTrash,
    },
  ];
  return (
    <EditorShell
      key={id}
      persistence={current.persistence}
      theme={theme}
      onThemeChange={onThemeChange}
      // the workspace opens files as new drawings instead
      loadScene={false}
      commandPaletteItems={commandPaletteItems}
      openLinkedScene={openLinkedScene}
    >
      {children}
      <DrawingsSidebar
        store={store}
        drawingId={id}
        onNewDrawing={actions.newDrawing}
        onTrash={actions.trashDrawing}
        saveDrawing={current.persistence.flush}
      />
    </EditorShell>
  );
};

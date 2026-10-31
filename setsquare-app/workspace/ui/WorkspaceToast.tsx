import { IconButton } from "@setsquare/setsquare/components/IconButton";
import { CloseIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { addToStoredLibrary } from "../../web/importFiles";

import "./WorkspaceToast.scss";

import type { EditorTask, QueuedTasks } from "../../web/editorTasks";

const INFO_DURATION_MS = 5000;
// long enough to notice what went and change one's mind
const UNDO_DURATION_MS = 8000;

/** Something the app tells the user, over the page or the editor. */
export type PageMessage = {
  text: string;
  error: boolean;
  /** takes back what the message reports, offered as Undo */
  undo?: () => void;
};

/**
 * The app's toast, which the page and the editor share so that it stays
 * while one gives way to the other. An error stays until it's dismissed or
 * another message replaces it; anything else goes after a while, longer when
 * it can be undone.
 */
export const useWorkspaceToast = () => {
  // counted, so that the same text shown again is read again
  const [shown, setShown] = useState<{
    message: PageMessage;
    count: number;
  } | null>(null);
  const message = shown?.message ?? null;

  useEffect(() => {
    if (!message || message.error) {
      return;
    }
    const timer = window.setTimeout(
      () => setShown(null),
      message.undo ? UNDO_DURATION_MS : INFO_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [message]);

  const show = useCallback(
    (message: PageMessage) =>
      setShown((shown) => ({ message, count: (shown?.count ?? 0) + 1 })),
    [],
  );
  const dismiss = useCallback(() => setShown(null), []);
  // once, so a second press can't undo what came after
  const undo = useCallback(() => {
    if (message?.undo) {
      setShown(null);
      message.undo();
    }
  }, [message]);

  return { message, count: shown?.count ?? 0, show, dismiss, undo };
};

/** The toast the app shows, and how to change it. */
export type WorkspaceToastState = ReturnType<typeof useWorkspaceToast>;

/**
 * Shows a message in the app's toast. The workspace provides it around the
 * page, the editor and the nav, so that what's in them can say what failed.
 */
export const WorkspaceToastContext = createContext<
  WorkspaceToastState["show"] | null
>(null);

/** Shows a message in the app's toast, from inside the workspace. */
export const useShowMessage = () => {
  const show = useContext(WorkspaceToastContext);
  if (!show) {
    throw new Error("useShowMessage needs a WorkspaceToastContext");
  }
  return show;
};

/**
 * Takes over the tasks there's no editor for while a page shows: errors
 * become messages, libraries merge into the stored element library, and
 * hints about the editor are dropped.
 */
export const useTasksOnPage = (
  { tasks, onRun }: QueuedTasks,
  show: (message: PageMessage) => void,
) => {
  const { t } = useI18n();
  // StrictMode runs the effect twice for the same tasks
  const taken = useRef(new WeakSet<EditorTask>());

  useEffect(() => {
    const fresh = tasks.filter((task) => !taken.current.has(task));
    if (!fresh.length) {
      return;
    }
    for (const task of fresh) {
      taken.current.add(task);
      switch (task.kind) {
        case "error":
          show({ text: task.message(), error: true });
          break;
        case "library":
          addToStoredLibrary(task.file).then(
            () => show({ text: t("workspace.libraryAdded"), error: false }),
            (error) => {
              console.error(error);
              show({ text: t("errors.importLibraryError"), error: true });
            },
          );
          break;
        case "hint":
          break;
      }
    }
    onRun(fresh);
  }, [tasks, onRun, show, t]);
};

/**
 * What screen readers hear of the app's toast: live regions there from the
 * start, as one that comes with its text is often not read, which take only
 * the text, while the toast's buttons stay out of them. The app has one,
 * which stays as the page and the editor give way to each other.
 */
export const WorkspaceToastAnnouncer = ({
  toast: { message, count },
}: {
  toast: WorkspaceToastState;
}) => (
  <div className="workspace-toast-announcer visually-hidden">
    {/* not a status, which the editor's save status is */}
    <div aria-live="polite" aria-atomic="true">
      {message && !message.error && <p key={count}>{message.text}</p>}
    </div>
    <div role="alert">
      {message?.error && <p key={count}>{message.text}</p>}
    </div>
  </div>
);

/**
 * The app's toast, on the page or over the editor, with Undo for what can
 * be undone. Its text is read from the announcer instead.
 */
export const WorkspaceToast = ({
  toast: { message, dismiss, undo },
  className,
}: {
  toast: WorkspaceToastState;
  className?: string;
}) => {
  const { t } = useI18n();

  if (!message) {
    return null;
  }
  return (
    <div
      className={clsx("workspace-toast", className, {
        "workspace-toast--error": message.error,
      })}
      // undoing from the sidebar's overlay mustn't close it
      data-prevent-outside-click
    >
      <p className="workspace-toast__message" aria-hidden="true">
        {message.text}
      </p>
      {message.undo && (
        <button type="button" className="workspace-toast__undo" onClick={undo}>
          {t("buttons.undo")}
        </button>
      )}
      <IconButton
        type="icon"
        icon={CloseIcon}
        aria-label={t("buttons.close")}
        title={t("buttons.close")}
        className="workspace-toast__close"
        onClick={dismiss}
      />
    </div>
  );
};

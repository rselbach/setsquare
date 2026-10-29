import { IconButton } from "@setsquare/setsquare/components/IconButton";
import { CloseIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";

import { addToStoredLibrary } from "../../web/importFiles";

import type { EditorTask, QueuedTasks } from "../../web/editorTasks";

const INFO_DURATION_MS = 5000;

/** Something the page tells the user. */
export type PageMessage = { text: string; error: boolean };

/**
 * Takes over the tasks there's no editor for while the page shows: errors
 * become messages, libraries merge into the stored element library, and
 * hints about the editor are dropped. Returns the message to show.
 */
export const useTasksOnPage = ({ tasks, onRun }: QueuedTasks) => {
  const { t } = useI18n();
  const [message, setMessage] = useState<PageMessage | null>(null);
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
          setMessage({ text: task.message(), error: true });
          break;
        case "library":
          addToStoredLibrary(task.file).then(
            () =>
              setMessage({ text: t("workspace.libraryAdded"), error: false }),
            (error) => {
              console.error(error);
              setMessage({ text: t("errors.importLibraryError"), error: true });
            },
          );
          break;
        case "hint":
          break;
      }
    }
    onRun(fresh);
  }, [tasks, onRun, t]);

  const dismiss = useCallback(() => setMessage(null), []);
  return { message, dismiss };
};

/**
 * The page's toast. An error stays until it's dismissed or another message
 * replaces it; anything else goes after a while.
 */
export const WorkspaceToast = ({
  message,
  onDismiss,
}: {
  message: PageMessage | null;
  onDismiss: () => void;
}) => {
  const { t } = useI18n();

  useEffect(() => {
    if (!message || message.error) {
      return;
    }
    const timer = window.setTimeout(onDismiss, INFO_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) {
    return null;
  }
  return (
    <div
      className={clsx("workspace-toast", {
        "workspace-toast--error": message.error,
      })}
      role={message.error ? "alert" : "status"}
    >
      <p className="workspace-toast__message">{message.text}</p>
      <IconButton
        type="icon"
        icon={CloseIcon}
        aria-label={t("buttons.close")}
        title={t("buttons.close")}
        className="workspace-toast__close"
        onClick={onDismiss}
      />
    </div>
  );
};

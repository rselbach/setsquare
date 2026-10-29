import { StandaloneUIProvider } from "@setsquare/setsquare";
import { FilledButton } from "@setsquare/setsquare/components/FilledButton";
import { useI18n } from "@setsquare/setsquare/i18n";
import { useMemo } from "react";

import type { Theme } from "@setsquare/element/types";

import { useAppLangCode } from "../../app-language/language-state";
import { drawingsIcon, restoreIcon } from "../../web/icons";
import { navigate } from "../../web/router";
import { useWorkspaceSnapshot } from "../../web/useWorkspaceSnapshot";

import { useThumbnails } from "./useThumbnails";
import { WorkspaceToast, useTasksOnPage } from "./WorkspaceToast";

import "./Workspace.scss";

import type { QueuedTasks } from "../../web/editorTasks";
import type { DrawingId } from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

import type { WorkspaceToastState } from "./WorkspaceToast";

/** Why a drawing's address shows a notice instead of the editor. */
export type NoticeKind = "trashed" | "missing";

type DrawingNoticeProps = {
  store: WorkspaceStore;
  id: DrawingId;
  kind: NoticeKind;
  theme: Theme;
  /** takes the drawing out of the Trash and opens it */
  onRestore: () => void;
  /** what's left to show, which there's no editor for */
  tasks: QueuedTasks;
  toast: WorkspaceToastState;
};

const NoticeView = ({
  store,
  id,
  kind,
  onRestore,
  tasks,
  toast,
}: Omit<DrawingNoticeProps, "theme">) => {
  const { t } = useI18n();
  const drawing = useWorkspaceSnapshot(store).drawings.get(id);
  const drawings = useMemo(() => (drawing ? [drawing] : []), [drawing]);
  const thumbnail = useThumbnails(store, drawings).get(id);
  useTasksOnPage(tasks, toast.show);

  return (
    <main className="drawing-notice">
      <div className={`drawing-notice__sheet drawing-notice__sheet--${kind}`}>
        <div className="drawing-notice__paper" aria-hidden="true">
          {kind === "trashed" && thumbnail ? (
            <img src={thumbnail.src} alt="" draggable={false} />
          ) : (
            <svg
              className="drawing-notice__blank"
              viewBox="0 0 48 48"
              focusable="false"
            >
              <circle cx="24" cy="24" r="9" />
              <path d="M24 8v32M8 24h32" />
            </svg>
          )}
          <span className="drawing-notice__stamp">
            {kind === "trashed"
              ? t("workspace.inTrashStamp")
              : t("workspace.missingStamp")}
          </span>
        </div>
        <div className="drawing-notice__block">
          <h1 className="drawing-notice__title">
            {kind === "trashed"
              ? t("workspace.trashedNoticeTitle", {
                  name: drawing?.name || t("labels.untitled"),
                })
              : t("workspace.missingNoticeTitle")}
          </h1>
          <p className="drawing-notice__hint">
            {kind === "trashed"
              ? t("workspace.trashedNoticeHint")
              : t("workspace.missingNoticeHint")}
          </p>
          <div className="drawing-notice__actions">
            {kind === "trashed" && (
              <FilledButton icon={restoreIcon} onClick={onRestore}>
                {t("workspace.restore")}
              </FilledButton>
            )}
            <FilledButton
              // the way on, unless Restore is
              variant={kind === "trashed" ? "outlined" : "filled"}
              icon={drawingsIcon}
              onClick={() => navigate({ kind: "drawings", folderId: null })}
            >
              {t("workspace.backToDrawings")}
            </FilledButton>
          </div>
        </div>
      </div>
      <WorkspaceToast toast={toast} />
    </main>
  );
};

/**
 * What a drawing's address shows when the drawing is in the Trash, with
 * Restore, or isn't there at all; Back to drawings either way. It looks
 * like the workspace page, and shows what's left from an editor that won't
 * come.
 */
export const DrawingNotice = ({ theme, ...props }: DrawingNoticeProps) => {
  const [langCode] = useAppLangCode();
  return (
    <StandaloneUIProvider
      theme={theme}
      langCode={langCode}
      className="setsquare-workspace"
    >
      <NoticeView {...props} />
    </StandaloneUIProvider>
  );
};

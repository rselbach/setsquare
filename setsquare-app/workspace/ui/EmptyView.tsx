import { FilledButton } from "@setsquare/setsquare/components/FilledButton";
import { PlusIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";

import { useWorkspaceAccount } from "../../web/accountContext";
import { importBrowserDrawings } from "../../web/accountControls";

import { EmptyState } from "./EmptyState";

import type { useBrowserImport } from "../../web/browserImport";
import type { ParentId } from "../types";

import type { PageView } from "./WorkspacePage";
import type { WorkspaceToastState } from "./WorkspaceToast";

type BrowserImport = NonNullable<ReturnType<typeof useBrowserImport>>;

type Toast = Pick<WorkspaceToastState, "show">;

// the offer to copy this browser's drawings into the account, once it's
// known there are some
const BrowserImportPrompt = ({
  browserImport: { state, run },
  toast,
}: {
  browserImport: BrowserImport;
  toast: Toast;
}) => {
  const { t } = useI18n();
  if (state.kind === "checking" || state.pending === 0) {
    return null;
  }
  return (
    <div className="workspace-empty__import">
      <p>
        {state.pending === 1
          ? t("workspace.emptyImportOne")
          : t("workspace.emptyImport", { count: state.pending })}
      </p>
      <button
        type="button"
        className="account-button"
        disabled={state.kind === "importing"}
        onClick={() => importBrowserDrawings(run, toast)}
      >
        {state.kind === "importing"
          ? t("workspace.accountImporting")
          : t("workspace.accountImport")}
      </button>
    </div>
  );
};

/** What the page shows in place of its items when the view has none. */
export const EmptyView = ({
  view,
  folderId,
  query,
  browserImport,
  newDrawing,
  toast,
}: {
  view: Exclude<PageView, "trash">;
  folderId: ParentId;
  /** the search, trimmed */
  query: string;
  browserImport: BrowserImport | null;
  newDrawing: () => void;
  toast: Toast;
}) => {
  const { t } = useI18n();
  const account = useWorkspaceAccount();
  switch (view) {
    case "search":
      return <EmptyState title={t("workspace.noResults", { query })} />;
    case "recent":
      return (
        <EmptyState title={t("workspace.emptyRecent")}>
          <p>{t("workspace.emptyRecentHint")}</p>
        </EmptyState>
      );
    case "folder":
      return folderId === null ? (
        <EmptyState title={t("workspace.emptyWorkspace")}>
          <FilledButton icon={PlusIcon} onClick={newDrawing}>
            {t("workspace.newDrawing")}
          </FilledButton>
          {(!account ||
            account.state.kind === "local" ||
            account.state.kind === "signedOut" ||
            account.state.kind === "unreachable") && (
            <p className="workspace-empty__warning">
              {t("welcomeScreen.app.center_heading")}{" "}
              {t("welcomeScreen.app.center_heading_line2")}
            </p>
          )}
          {browserImport && (
            <BrowserImportPrompt browserImport={browserImport} toast={toast} />
          )}
        </EmptyState>
      ) : (
        <EmptyState title={t("workspace.emptyFolder")}>
          <p>{t("workspace.emptyFolderHint")}</p>
        </EmptyState>
      );
  }
};

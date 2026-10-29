import { t } from "@setsquare/setsquare/i18n";
import { useState } from "react";

import { LocalWorkspaceStore } from "../workspace/local/LocalWorkspaceStore";
import { RemoteWorkspaceStore } from "../workspace/remote/RemoteWorkspaceStore";

import { useWorkspaceAccount } from "./accountContext";
import { navigate, useRoute } from "./router";

import "./accountControls.scss";

type AccountAction =
  | { kind: "idle" }
  | { kind: "importing" }
  | { kind: "signingOut" }
  | { kind: "imported"; count: number }
  | { kind: "error"; message: string };

const signInPath = (ownerWindow: Window) =>
  `/api/auth/github?returnTo=${encodeURIComponent(
    `${ownerWindow.location.pathname}${ownerWindow.location.search}`,
  )}`;

/** Account identity and actions shown in the workspace navigation. */
export const AccountControls = () => {
  const account = useWorkspaceAccount();
  const [action, setAction] = useState<AccountAction>({ kind: "idle" });
  if (!account || account.state.kind === "local") {
    return (
      <p className="workspace-nav__storage">
        <span className="workspace-caption">
          {t("workspace.storedInBrowser")}
        </span>
        {t("welcomeScreen.app.center_heading_line2")}
      </p>
    );
  }

  const { state, ownerWindow, store, expire } = account;
  if (state.kind === "signedOut") {
    return (
      <div className="workspace-account">
        <p className="workspace-nav__storage">
          <span className="workspace-caption">
            {t("workspace.storedInBrowser")}
          </span>
          {t("workspace.accountSignInHint")}
        </p>
        <a className="workspace-account__action" href={signInPath(ownerWindow)}>
          {t("workspace.accountSignIn")}
        </a>
      </div>
    );
  }
  if (state.kind !== "signedIn") {
    return (
      <p className="workspace-nav__storage">{t("workspace.accountPaused")}</p>
    );
  }

  const busy = action.kind === "importing" || action.kind === "signingOut";
  const signOut = async () => {
    setAction({ kind: "signingOut" });
    try {
      if (!(await navigate({ kind: "drawings", folderId: null }))) {
        setAction({ kind: "idle" });
        return;
      }
      const response = await ownerWindow.fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "X-CSRF-Token": state.csrfToken,
          "X-Setsquare-Account": state.user.id,
        },
      });
      if (response.status === 401) {
        expire();
        return;
      }
      if (!response.ok) {
        throw new Error("Sign out failed");
      }
      ownerWindow.location.assign("/");
    } catch (error) {
      console.error(error);
      setAction({
        kind: "error",
        message: t("workspace.accountSignOutFailed"),
      });
    }
  };
  const importDrawings = async () => {
    if (!(store instanceof RemoteWorkspaceStore)) {
      return;
    }
    setAction({ kind: "importing" });
    let local: LocalWorkspaceStore | null = null;
    try {
      local = await LocalWorkspaceStore.open();
      await local.migrateLegacyScene();
      const count = await store.importLocalWorkspace(local);
      setAction({ kind: "imported", count });
    } catch (error) {
      console.error(error);
      setAction({ kind: "error", message: t("workspace.accountImportFailed") });
    } finally {
      local?.close();
    }
  };

  return (
    <div className="workspace-account">
      <p className="workspace-nav__storage">
        <span className="workspace-caption">
          {t("workspace.accountSavedTo", { name: state.user.login })}
        </span>
        {t("workspace.accountPrivate")}
      </p>
      <button
        type="button"
        className="workspace-account__action"
        disabled={busy}
        onClick={importDrawings}
      >
        {t(
          action.kind === "importing"
            ? "workspace.accountImporting"
            : "workspace.accountImport",
        )}
      </button>
      <button
        type="button"
        className="workspace-account__action"
        disabled={busy}
        onClick={signOut}
      >
        {t("workspace.accountSignOut")}
      </button>
      {action.kind === "imported" && (
        <p className="workspace-account__message" role="status">
          {t(
            action.count === 1
              ? "workspace.accountImportedOne"
              : "workspace.accountImported",
            { count: action.count },
          )}
        </p>
      )}
      {action.kind === "error" && (
        <p className="workspace-account__message" role="alert">
          {action.message}
        </p>
      )}
    </div>
  );
};

/** Keeps reauthentication reachable without unmounting an unsaved drawing. */
export const AccountNotice = () => {
  const account = useWorkspaceAccount();
  const route = useRoute();
  if (!account) {
    return null;
  }
  const { state, ownerWindow } = account;
  switch (state.kind) {
    case "signedOut":
      if (
        route.kind !== "drawing" ||
        account.store.getSnapshot().drawings.has(route.id)
      ) {
        return null;
      }
      return (
        <div className="account-notice" role="status">
          <span>{t("workspace.accountSignInToOpen")}</span>
          <a href={signInPath(ownerWindow)}>{t("workspace.accountSignIn")}</a>
        </div>
      );
    case "expired":
      return (
        <div className="account-notice" role="alert">
          <span>{t("workspace.accountExpired")}</span>
          <a href={signInPath(ownerWindow)}>
            {t("workspace.accountSignInAgain")}
          </a>
        </div>
      );
    case "changed":
      return (
        <div className="account-notice" role="alert">
          <span>{t("workspace.accountChanged")}</span>
          <a href={ownerWindow.location.href}>{t("workspace.accountReload")}</a>
        </div>
      );
    default:
      return null;
  }
};

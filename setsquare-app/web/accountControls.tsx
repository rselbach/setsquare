import { t } from "@setsquare/setsquare/i18n";
import clsx from "clsx";
import { useState } from "react";

import { useWorkspaceAccount } from "./accountContext";
import { useBrowserImport } from "./browserImport";
import { githubIcon } from "./icons";
import { navigate, useRoute } from "./router";

import "./accountControls.scss";

import type { AccountUser } from "../workspace/api";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

import type { BrowserImportState } from "./browserImport";

const signInPath = (ownerWindow: Window) =>
  `/api/auth/github?returnTo=${encodeURIComponent(
    `${ownerWindow.location.pathname}${ownerWindow.location.search}`,
  )}`;

const SignInLink = ({
  ownerWindow,
  label = t("workspace.accountSignIn"),
}: {
  ownerWindow: Window;
  label?: string;
}) => (
  <a className="account-button" href={signInPath(ownerWindow)}>
    {githubIcon}
    {label}
  </a>
);

const Identity = ({ user }: { user: AccountUser }) => (
  <div className="workspace-account__identity">
    <img
      className="workspace-account__avatar"
      src={user.avatarUrl}
      alt=""
      width={32}
      height={32}
    />
    <div className="workspace-account__names">
      <span className="workspace-account__name">{user.name || user.login}</span>
      <span>{t("workspace.accountGitHubLogin", { login: user.login })}</span>
    </div>
  </div>
);

// what the import has done, and the browser drawings it can still copy
const importMessage = (state: BrowserImportState) => {
  switch (state.kind) {
    case "checking":
      return null;
    case "importing":
      return t("workspace.accountImporting");
    case "failed":
      return t("workspace.accountImportFailed");
    case "imported": {
      const { imported, skipped } = state.result;
      const messages = [];
      if (imported) {
        messages.push(
          imported === 1
            ? t("workspace.accountImportedOne")
            : t("workspace.accountImported", { count: imported }),
        );
      }
      if (skipped.length) {
        messages.push(
          t("workspace.accountImportSkipped", {
            names: skipped
              .map(({ name }) => `“${name || t("labels.untitled")}”`)
              .join(", "),
          }),
        );
      }
      return messages.join(" ") || null;
    }
    case "ready":
      if (!state.pending) {
        return null;
      }
      return state.pending === 1
        ? t("workspace.accountImportPendingOne")
        : t("workspace.accountImportPending", { count: state.pending });
  }
};

const ImportSection = ({ store }: { store: WorkspaceStore }) => {
  const browserImport = useBrowserImport(store);
  if (!browserImport) {
    return null;
  }
  const { state, run } = browserImport;
  const message = importMessage(state);
  const canImport =
    state.kind !== "checking" &&
    state.kind !== "importing" &&
    state.pending > 0;
  if (!message && !canImport) {
    return null;
  }
  return (
    <div className="workspace-account__import">
      {message && (
        <p
          className={clsx("workspace-account__message", {
            "workspace-account__message--error": state.kind === "failed",
          })}
          role={state.kind === "failed" ? "alert" : "status"}
        >
          {message}
        </p>
      )}
      {canImport && (
        <button type="button" className="account-button" onClick={run}>
          {state.kind === "ready"
            ? t("workspace.accountImport")
            : t("workspace.accountImportAgain")}
        </button>
      )}
    </div>
  );
};

/** Account identity and actions shown in the workspace navigation. */
export const AccountControls = () => {
  const account = useWorkspaceAccount();
  const [signOut, setSignOut] = useState<"idle" | "signingOut" | "failed">(
    "idle",
  );
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
  switch (state.kind) {
    case "signedOut":
      return (
        <div className="workspace-account">
          <p className="workspace-nav__storage">
            <span className="workspace-caption">
              {t("workspace.storedInBrowser")}
            </span>
            {t("workspace.accountSignInHint")}
          </p>
          <SignInLink ownerWindow={ownerWindow} />
        </div>
      );
    case "unreachable":
      return (
        <div className="workspace-account">
          <p className="workspace-nav__storage">
            <span className="workspace-caption">
              {t("workspace.accountUnreachable")}
            </span>
            {t("workspace.accountUnreachableHint")}
          </p>
          <button
            type="button"
            className="account-button"
            onClick={() => ownerWindow.location.reload()}
          >
            {t("workspace.accountTryAgain")}
          </button>
        </div>
      );
    case "expired":
      return (
        <div className="workspace-account">
          <Identity user={state.user} />
          <p className="workspace-nav__storage">
            <span className="workspace-caption">
              {t("workspace.accountSessionEnded")}
            </span>
            {t("workspace.accountExpired")}
          </p>
          <SignInLink
            ownerWindow={ownerWindow}
            label={t("workspace.accountSignInAgain")}
          />
        </div>
      );
    case "changed":
      return (
        <div className="workspace-account">
          <p className="workspace-nav__storage">
            {t("workspace.accountChanged")}
          </p>
          <button
            type="button"
            className="account-button"
            onClick={() => ownerWindow.location.reload()}
          >
            {t("workspace.accountReload")}
          </button>
        </div>
      );
  }

  const signOutOfAccount = async () => {
    setSignOut("signingOut");
    try {
      if (!(await navigate({ kind: "drawings", folderId: null }))) {
        setSignOut("idle");
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
      setSignOut("failed");
    }
  };

  return (
    <div className="workspace-account">
      <span className="workspace-caption">
        {t("workspace.accountSavedToAccount")}
      </span>
      <Identity user={state.user} />
      <ImportSection store={store} />
      <button
        type="button"
        className="workspace-account__sign-out"
        disabled={signOut === "signingOut"}
        onClick={signOutOfAccount}
      >
        {t("workspace.accountSignOut")}
      </button>
      {signOut === "failed" && (
        <p
          className="workspace-account__message workspace-account__message--error"
          role="alert"
        >
          {t("workspace.accountSignOutFailed")}
        </p>
      )}
    </div>
  );
};

/**
 * Explains an account problem where the navigation doesn't show it, keeping
 * whatever is open mounted so unsaved work stays put.
 */
export const AccountNotice = () => {
  const account = useWorkspaceAccount();
  const route = useRoute();
  if (!account) {
    return null;
  }
  const { state, ownerWindow } = account;
  const reload = (label: string) => (
    <button
      type="button"
      className="account-notice__action"
      onClick={() => ownerWindow.location.reload()}
    >
      {label}
    </button>
  );
  const signIn = (label: string) => (
    <a className="account-notice__action" href={signInPath(ownerWindow)}>
      {label}
    </a>
  );
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
          <p>{t("workspace.accountSignInToOpen")}</p>
          {signIn(t("workspace.accountSignIn"))}
        </div>
      );
    case "unreachable":
      return (
        <div className="account-notice account-notice--error" role="status">
          <p>{t("workspace.accountUnreachableNotice")}</p>
          {reload(t("workspace.accountTryAgain"))}
        </div>
      );
    case "expired":
      return (
        <div className="account-notice account-notice--error" role="alert">
          <p>{t("workspace.accountExpiredNotice")}</p>
          {signIn(t("workspace.accountSignInAgain"))}
        </div>
      );
    case "changed":
      return (
        <div className="account-notice account-notice--error" role="alert">
          <p>{t("workspace.accountChanged")}</p>
          {reload(t("workspace.accountReload"))}
        </div>
      );
    default:
      return null;
  }
};

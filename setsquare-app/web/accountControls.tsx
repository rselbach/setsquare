import DropdownMenu from "@setsquare/setsquare/components/dropdownMenu/DropdownMenu";
import { t } from "@setsquare/setsquare/i18n";
import clsx from "clsx";
import { useState } from "react";

import { useWorkspaceAccount } from "./accountContext";
import { useBrowserImport } from "./browserImport";
import { githubIcon } from "./icons";
import { navigate, useRoute } from "./router";

import "./accountControls.scss";

import type { AccountUser } from "../workspace/api";
import type { PageMessage } from "../workspace/ui/WorkspaceToast";

import type { BrowserImportState } from "./browserImport";

/** Where the account menu reports what it did. */
type Toast = { show: (message: PageMessage) => void };

const signInPath = (ownerWindow: Window) =>
  `/api/auth/github?returnTo=${encodeURIComponent(
    `${ownerWindow.location.pathname}${ownerWindow.location.search}`,
  )}`;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0].toUpperCase())
    .join("");

// GitHub gives every account an avatar; initials stand in while it can't load
const Avatar = ({ user }: { user: AccountUser }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="account-avatar account-avatar--initials" aria-hidden>
        {initials(user.name || user.login)}
      </span>
    );
  }
  return (
    <img
      className="account-avatar"
      src={user.avatarUrl}
      alt=""
      onError={() => setFailed(true)}
    />
  );
};

const importMessage = (state: BrowserImportState): PageMessage | null => {
  switch (state.kind) {
    case "checking":
    case "ready":
      return null;
    case "importing":
      return { text: t("workspace.accountImporting"), error: false };
    case "failed":
      return { text: t("workspace.accountImportFailed"), error: true };
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
      return messages.length
        ? { text: messages.join(" "), error: skipped.length > 0 }
        : null;
    }
  }
};

/** Copies the browser's drawings into the account and says how it went. */
export const importBrowserDrawings = async (
  run: () => Promise<BrowserImportState>,
  toast: Toast,
) => {
  const message = importMessage(await run());
  if (message) {
    toast.show(message);
  }
};

/** Where the workspace keeps its drawings, at the foot of the navigation. */
export const StorageNote = () => {
  const account = useWorkspaceAccount();
  if (account?.store.recoveryKey) {
    return (
      <p className="workspace-nav__storage">
        <span className="workspace-caption">
          {t("workspace.accountSavedToAccount")}
        </span>
        {t("workspace.accountPrivate")}
      </p>
    );
  }
  return (
    <p className="workspace-nav__storage">
      <span className="workspace-caption">
        {t("workspace.storedInBrowser")}
      </span>
      {account?.state.kind === "signedOut"
        ? t("workspace.accountSignInHint")
        : t("welcomeScreen.app.center_heading_line2")}
    </p>
  );
};

/**
 * The account at the top right of every page: a way to sign in, or who is
 * signed in, with the browser drawings to import and signing out.
 */
export const AccountMenu = ({ toast }: { toast: Toast }) => {
  const account = useWorkspaceAccount();
  const browserImport = useBrowserImport(account?.store ?? null);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  if (!account) {
    return null;
  }

  const { state, ownerWindow, expire } = account;
  const reload = () => ownerWindow.location.reload();
  switch (state.kind) {
    case "local":
      return null;
    case "signedOut":
    case "expired":
      return (
        <a
          className={clsx("account-menu__button", {
            "account-menu__button--alert": state.kind === "expired",
          })}
          href={signInPath(ownerWindow)}
          title={t("workspace.accountSignIn")}
        >
          {githubIcon}
          {state.kind === "expired"
            ? t("workspace.accountSignInAgain")
            : t("workspace.accountSignInShort")}
        </a>
      );
    case "unreachable":
    case "changed":
      return (
        <button
          type="button"
          className="account-menu__button account-menu__button--alert"
          title={
            state.kind === "changed"
              ? t("workspace.accountChanged")
              : t("workspace.accountUnreachableNotice")
          }
          onClick={reload}
        >
          {state.kind === "changed"
            ? t("workspace.accountReload")
            : t("workspace.accountReconnect")}
        </button>
      );
  }

  const { user } = state;
  const name = user.name || user.login;
  const pending =
    browserImport && browserImport.state.kind === "ready"
      ? browserImport.state.pending
      : 0;
  const signOut = async () => {
    setSigningOut(true);
    try {
      if (!(await navigate({ kind: "drawings", folderId: null }))) {
        return;
      }
      const response = await ownerWindow.fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "X-CSRF-Token": state.csrfToken,
          "X-Setsquare-Account": user.id,
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
      toast.show({ text: t("workspace.accountSignOutFailed"), error: true });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu open={open}>
      <DropdownMenu.Trigger
        className="account-menu__trigger"
        onToggle={() => setOpen(!open)}
        title={name}
        aria-label={t("workspace.accountMenu", { name })}
      >
        <Avatar user={user} />
        {pending > 0 && <span className="account-menu__badge" />}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        className="account-menu"
        onClickOutside={() => setOpen(false)}
        onSelect={() => setOpen(false)}
      >
        <DropdownMenu.ItemCustom className="account-menu__identity">
          <Avatar user={user} />
          <span className="account-menu__names">
            <span className="account-menu__name">{name}</span>
            <span>
              {t("workspace.accountGitHubLogin", { login: user.login })}
            </span>
          </span>
        </DropdownMenu.ItemCustom>
        <DropdownMenu.Separator />
        {browserImport && pending > 0 && (
          <DropdownMenu.Item
            onSelect={() => {
              importBrowserDrawings(browserImport.run, toast);
            }}
          >
            {pending === 1
              ? t("workspace.accountImportOne")
              : t("workspace.accountImportCount", { count: pending })}
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item
          onSelect={() => {
            if (!signingOut) {
              signOut();
            }
          }}
        >
          {t("workspace.accountSignOut")}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
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

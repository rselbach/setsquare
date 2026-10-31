import { LocalWorkspaceStore } from "../workspace/local/LocalWorkspaceStore";
import { RemoteWorkspaceStore } from "../workspace/remote/RemoteWorkspaceStore";
import { parseSession } from "../workspace/remote/parse";

import { collectOrphanDrafts } from "./unsavedJournal";

import type { SessionInfo } from "../workspace/api";
import type { LocalWorkspaceOptions } from "../workspace/local/LocalWorkspaceStore";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

const ACCOUNT_SERVER_KEY = "setsquare-account-server";

/** A session, or an account server this browser has used that didn't answer. */
export type AccountSession = SessionInfo | { kind: "unreachable" };

/** Reads the current session without changing an already open workspace. */
export const readAccountSession = async (
  ownerWindow: Window,
): Promise<AccountSession> => {
  const knownServer = ownerWindow.localStorage.getItem(ACCOUNT_SERVER_KEY);
  // without a server it has used, the browser keeps drawings itself
  const unavailable = knownServer
    ? ({ kind: "unreachable" } as const)
    : ({ kind: "local" } as const);
  let response: Response;
  try {
    response = await ownerWindow.fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return unavailable;
  }
  if (
    !response.ok ||
    response.headers.get("content-type")?.includes("text/html")
  ) {
    return unavailable;
  }
  const session = parseSession(await response.json());
  if (session.kind !== "local") {
    ownerWindow.localStorage.setItem(ACCOUNT_SERVER_KEY, "true");
  }
  return session;
};

/** The browser host and session notifications used by web startup. */
export type OpenWorkspaceOptions = LocalWorkspaceOptions & {
  ownerWindow?: Window;
  onSession?: (session: AccountSession) => void;
  onSessionExpired?: () => void;
};

/**
 * Opens the workspace the web app shows. Tests replace this module to give
 * each test a workspace of its own.
 */
export const openWorkspaceStore = async ({
  ownerWindow,
  onSession,
  onSessionExpired = () => {},
  ...localOptions
}: OpenWorkspaceOptions = {}): Promise<WorkspaceStore> => {
  if (!ownerWindow) {
    return LocalWorkspaceStore.open(localOptions);
  }
  const session = await readAccountSession(ownerWindow);
  if (session.kind !== "signedIn") {
    onSession?.(session);
    return LocalWorkspaceStore.open(localOptions);
  }
  try {
    const store = await RemoteWorkspaceStore.open({
      session,
      ownerWindow,
      onSessionExpired,
    });
    onSession?.(session);
    // drafts of drawings deleted elsewhere expire while the Trash lists them
    collectOrphanDrafts(store).catch((error) =>
      console.warn("Could not collect recovery drafts", error),
    );
    return store;
  } catch (error) {
    // the browser's own drawings stay usable while the account can't load
    console.error(error);
    onSession?.({ kind: "unreachable" });
    return LocalWorkspaceStore.open(localOptions);
  }
};

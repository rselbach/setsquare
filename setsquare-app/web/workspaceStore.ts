import { LocalWorkspaceStore } from "../workspace/local/LocalWorkspaceStore";
import { RemoteWorkspaceStore } from "../workspace/remote/RemoteWorkspaceStore";
import { parseSession } from "../workspace/remote/parse";

import type { SessionInfo } from "../workspace/api";
import type { LocalWorkspaceOptions } from "../workspace/local/LocalWorkspaceStore";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

const ACCOUNT_SERVER_KEY = "setsquare-account-server";

/** Reads the current session without changing an already open workspace. */
export const readAccountSession = async (
  ownerWindow: Window,
): Promise<SessionInfo> => {
  const response = await ownerWindow.fetch("/api/session", {
    credentials: "same-origin",
    cache: "no-store",
  });
  const knownServer = ownerWindow.localStorage.getItem(ACCOUNT_SERVER_KEY);
  if (
    !knownServer &&
    (response.status === 404 ||
      (response.ok &&
        response.headers.get("content-type")?.includes("text/html")))
  ) {
    return { kind: "local" };
  }
  if (!response.ok) {
    throw new Error("Could not load the account session");
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
  onSession?: (session: SessionInfo) => void;
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
  onSession?.(session);
  if (session.kind === "signedIn") {
    return RemoteWorkspaceStore.open({
      session,
      ownerWindow,
      onSessionExpired,
    });
  }
  return LocalWorkspaceStore.open(localOptions);
};

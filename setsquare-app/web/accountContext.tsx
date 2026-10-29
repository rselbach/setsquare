import { createContext, useContext } from "react";

import type { AccountUser, SessionInfo } from "../workspace/api";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

/** Account changes never replace an editor that may still have unsaved work. */
export type AccountState =
  | SessionInfo
  | { kind: "expired"; user: AccountUser }
  | { kind: "changed" };

/** The account that owns the mounted workspace and its browser host. */
export type WorkspaceAccount = {
  state: AccountState;
  store: WorkspaceStore;
  ownerWindow: Window;
  expire: () => void;
};

/** Provides the account for the workspace navigation and recovery notice. */
export const AccountContext = createContext<WorkspaceAccount | null>(null);

/** Returns the account attached to this mounted workspace, if there is one. */
export const useWorkspaceAccount = () => useContext(AccountContext);

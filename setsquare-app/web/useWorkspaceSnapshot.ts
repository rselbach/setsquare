import { useSyncExternalStore } from "react";

import type { WorkspaceStore } from "../workspace/WorkspaceStore";

/** Every folder and drawing in the workspace, rerendering as they change. */
export const useWorkspaceSnapshot = (store: WorkspaceStore) =>
  useSyncExternalStore(store.subscribe, store.getSnapshot);

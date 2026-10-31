import { useSyncExternalStore } from "react";

import { LocalWorkspaceStore } from "../workspace/local/LocalWorkspaceStore";
import { RemoteWorkspaceStore } from "../workspace/remote/RemoteWorkspaceStore";

import type { ImportResult } from "../workspace/remote/localImport";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

/**
 * Where copying this browser's drawings into the account stands. `pending`
 * counts the browser drawings the account doesn't have yet.
 */
export type BrowserImportState =
  | { kind: "checking" }
  | { kind: "ready"; pending: number }
  | { kind: "importing"; pending: number }
  | { kind: "imported"; pending: number; result: ImportResult }
  | { kind: "failed"; pending: number };

// one per account workspace, so the navigation and the empty workspace show
// the same import
class BrowserImport {
  state: BrowserImportState = { kind: "checking" };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: RemoteWorkspaceStore) {
    this.withLocal((local) => store.pendingImports(local)).then(
      (pending) => this.set({ kind: "ready", pending }),
      (error) => {
        console.error(error);
        this.set({ kind: "ready", pending: 0 });
      },
    );
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  run = async () => {
    if (this.state.kind === "checking" || this.state.kind === "importing") {
      return this.state;
    }
    const { pending } = this.state;
    this.set({ kind: "importing", pending });
    try {
      this.set({
        kind: "imported",
        ...(await this.withLocal(async (local) => ({
          result: await this.store.importLocalWorkspace(local),
          pending: await this.store.pendingImports(local),
        }))),
      });
    } catch (error) {
      console.error(error);
      this.set({ kind: "failed", pending });
    }
    return this.state;
  };

  private set(state: BrowserImportState) {
    this.state = state;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async withLocal<T>(run: (local: LocalWorkspaceStore) => Promise<T>) {
    const local = await LocalWorkspaceStore.open();
    try {
      await local.migrateLegacyScene();
      return await run(local);
    } finally {
      local.close();
    }
  }
}

const imports = new WeakMap<RemoteWorkspaceStore, BrowserImport>();

const importFor = (store: RemoteWorkspaceStore) => {
  const browserImport = imports.get(store) ?? new BrowserImport(store);
  imports.set(store, browserImport);
  return browserImport;
};

const noSubscription = () => () => {};
const noState = () => null;

/**
 * The import of this browser's drawings into the signed-in account, and
 * the action that starts it. Null for a workspace kept in the browser.
 */
export const useBrowserImport = (store: WorkspaceStore | null) => {
  const browserImport =
    store instanceof RemoteWorkspaceStore ? importFor(store) : null;
  const state = useSyncExternalStore(
    browserImport?.subscribe ?? noSubscription,
    browserImport ? () => browserImport.state : noState,
  );
  return browserImport && state && { state, run: browserImport.run };
};

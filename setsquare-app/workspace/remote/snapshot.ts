import { nextSnapshot } from "../types";

import { ApiError } from "./ApiError";
import { parseCommand, parseDrawing, parseWorkspace } from "./parse";

import type {
  CommandResponse,
  DrawingData,
  WorkspaceCommand,
  WorkspaceData,
} from "../api";
import type { DrawingMeta, WorkspaceSnapshot } from "../types";
import type { AccountClient } from "./transport";

/**
 * The account's folders and drawings as this tab last saw them. Commands run
 * one at a time, reads wait for this tab's earlier commands, and a response
 * older than the one already shown is dropped.
 */
export class SnapshotState {
  private readonly listeners = new Set<() => void>();
  private snapshot: WorkspaceSnapshot = {
    folders: new Map(),
    drawings: new Map(),
  };
  private requestsStarted = 0;
  private snapshotShown = 0;
  private closed = false;
  private mutations: Promise<void> = Promise.resolve();

  constructor(
    private readonly client: AccountClient,
    private readonly newRequestId: () => string,
  ) {}

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh() {
    await this.mutations;
    const sequence = ++this.requestsStarted;
    const data = parseWorkspace(await this.client.get("/api/workspace"));
    this.publish(data, sequence);
  }

  /** Reads a drawing and its current metadata, or null if it's gone. */
  async readDrawing(path: string) {
    await this.mutations;
    const sequence = ++this.requestsStarted;
    let drawing: DrawingData;
    try {
      drawing = parseDrawing(await this.client.get(path));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        return null;
      }
      throw error;
    }
    this.publishDrawing(drawing.meta, sequence);
    return drawing;
  }

  command(
    command: WorkspaceCommand,
    requestId: string = this.newRequestId(),
  ): Promise<CommandResponse> {
    const saving = this.mutations.then(async () => {
      const sequence = ++this.requestsStarted;
      const response = parseCommand(
        await this.client.post("/api/commands", { requestId, command }),
      );
      this.publish(response.snapshot, sequence);
      return response;
    });
    this.mutations = saving.then(
      () => {},
      () => {},
    );
    return saving;
  }

  /** Stops publishing snapshots and drops every listener. */
  close() {
    this.closed = true;
    this.listeners.clear();
  }

  private publish(data: WorkspaceData, sequence: number) {
    if (this.closed || sequence < this.snapshotShown) {
      return;
    }
    this.snapshotShown = sequence;
    this.show(nextSnapshot(this.snapshot, data.folders, data.drawings));
  }

  private publishDrawing(meta: DrawingMeta, sequence: number) {
    if (this.closed || sequence < this.snapshotShown) {
      return;
    }
    this.snapshotShown = sequence;
    const { folders, drawings } = this.snapshot;
    this.show(
      nextSnapshot(
        this.snapshot,
        [...folders.values()],
        [...new Map(drawings).set(meta.id, meta).values()],
      ),
    );
  }

  // tells the listeners only if the snapshot changed
  private show(snapshot: WorkspaceSnapshot) {
    if (snapshot === this.snapshot) {
      return;
    }
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * What another tab changed: the folders and drawings, or only thumbnails,
 * which aren't in the snapshot.
 */
export type WorkspaceChange = "changed" | "thumbnails";

const isChange = (data: unknown): data is WorkspaceChange =>
  data === "changed" || data === "thumbnails";

/** Tells this browser's other tabs that the workspace changed. */
export interface WorkspaceBroadcast {
  /** tells the other tabs; this tab doesn't hear its own posts */
  post(change: WorkspaceChange): void;
  close(): void;
}

/**
 * Joins the channel, calling onChange when another tab posts. Where the
 * browser has no BroadcastChannel, other tabs just aren't told.
 */
export const openBroadcast = (
  name: string,
  onChange: (change: WorkspaceChange) => void,
): WorkspaceBroadcast => {
  if (typeof BroadcastChannel === "undefined") {
    return { post: () => {}, close: () => {} };
  }
  const channel = new BroadcastChannel(name);
  channel.onmessage = (event: MessageEvent) => {
    if (isChange(event.data)) {
      onChange(event.data);
    }
  };
  return {
    post: (change) => channel.postMessage(change),
    close: () => channel.close(),
  };
};

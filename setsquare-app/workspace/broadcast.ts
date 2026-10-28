const CHANGED = "changed";

/** Tells this browser's other tabs that the workspace changed. */
export interface WorkspaceBroadcast {
  /** tells the other tabs; this tab doesn't hear its own posts */
  post(): void;
  close(): void;
}

/**
 * Joins the channel, calling onChange when another tab posts. Where the
 * browser has no BroadcastChannel, other tabs just aren't told.
 */
export const openBroadcast = (
  name: string,
  onChange: () => void,
): WorkspaceBroadcast => {
  if (typeof BroadcastChannel === "undefined") {
    return { post: () => {}, close: () => {} };
  }
  const channel = new BroadcastChannel(name);
  channel.onmessage = (event: MessageEvent) => {
    if (event.data === CHANGED) {
      onChange();
    }
  };
  return {
    post: () => channel.postMessage(CHANGED),
    close: () => channel.close(),
  };
};

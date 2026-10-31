import type {
  DrawingContent,
  DrawingId,
  DrawingMeta,
} from "../../workspace/types";
import type { WorkspaceStore } from "../../workspace/WorkspaceStore";

const NOTHING_CHANGED = { scene: null, files: false } as const;

/** What the remote check reads of a session, and what it may change. */
export type RemoteSession = {
  gone(): boolean;
  revision(): number;
  generation(): string;
  hasPending(): boolean;
  hasRequest(): boolean;
  /** storage moved past edits this session hasn't saved */
  conflicted(meta: DrawingMeta): void;
  readFailed(error: unknown): void;
  /** the session now edits `content`, stored at `revision` */
  reloaded(revision: number, content: DrawingContent): void;
};

/**
 * Loads a newer revision another tab or device saved, unless this session
 * has edits or a request of its own, before or after any read. A session
 * with edits learns of the newer revision as a conflict instead.
 */
export const checkRemoteChanges = async (
  store: WorkspaceStore,
  id: DrawingId,
  session: RemoteSession,
) => {
  if (session.gone()) {
    return NOTHING_CHANGED;
  }
  const seen = session.generation();
  try {
    const meta = await store.getDrawingMeta(id);
    if (!meta || meta.revision <= session.revision()) {
      return NOTHING_CHANGED;
    }
    const changedDuringRead = () => {
      const gone = session.gone();
      const pending = session.hasPending();
      const request = session.hasRequest();
      if (!gone && !request && !pending && session.generation() === seen) {
        return false;
      }
      if (!gone && pending && !request) {
        session.conflicted(meta);
      }
      return true;
    };
    if (changedDuringRead()) {
      return NOTHING_CHANGED;
    }
    const content = await store.loadDrawingContent(id);
    if (changedDuringRead() || !content) {
      return NOTHING_CHANGED;
    }
    // a later snapshot must not authorize writes over content we did not load
    session.reloaded(meta.revision, content);
    return { scene: content, files: true };
  } catch (error) {
    session.readFailed(error);
    return NOTHING_CHANGED;
  }
};

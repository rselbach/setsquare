import { clearUnsaved, holdDraft, writeUnsaved } from "../unsavedJournal";

import type {
  AccountDraft,
  DrawingDraft,
  DrawingId,
} from "../../workspace/types";
import type { WorkspaceStore } from "../../workspace/WorkspaceStore";
import type { UnsavedDrawing } from "../unsavedJournal";

/**
 * One editor session's recovery draft, written to localStorage and to the
 * store's IndexedDB drafts. Each edit starts a generation; the draft is
 * durable once either store has the current one.
 */
export const createRecoveryJournal = ({
  store,
  id,
  recovered,
  ownerWindow,
  onChange,
}: {
  store: WorkspaceStore;
  id: DrawingId;
  recovered: UnsavedDrawing | undefined;
  ownerWindow: Window;
  onChange: () => void;
}) => {
  const draftId = ownerWindow.crypto.randomUUID();
  const storage = store.recoveryStorage ?? ownerWindow.localStorage;
  let generation = ownerWindow.crypto.randomUUID();
  let updatedAt = Date.now();
  let storedGeneration: string | null = null;
  let fallbackGeneration: string | null = null;
  let error: unknown | null = null;
  let writing = Promise.resolve();
  // the draft this session adopted, retired once its edits are saved
  let source = recovered && "draftId" in recovered ? recovered : null;

  // until the last hold ends, another tab adopts neither this session's
  // draft nor the one it adopted
  let holds = 0;
  let unlock = () => {};
  const unlocked = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  holdDraft(store.recoveryLocks, draftId, unlocked);
  if (source) {
    holdDraft(store.recoveryLocks, source.draftId, unlocked);
  }

  const write = (draft: AccountDraft) => {
    const fallbackSaved = writeUnsaved(draft, store.recoveryKey, storage);
    if (fallbackSaved) {
      fallbackGeneration = draft.generation;
    }
    writing = writing.then(async () => {
      try {
        if (store.recoveryDrafts) {
          await store.recoveryDrafts.save(draft);
          storedGeneration = draft.generation;
        } else if (!fallbackSaved) {
          throw new Error("The browser could not keep a recovery copy");
        }
        error = null;
      } catch (writeError) {
        if (!fallbackSaved) {
          error = writeError;
        }
      }
      onChange();
    });
  };

  const retire = () => {
    clearUnsaved(id, store.recoveryKey, storage, draftId);
    if (!store.recoveryKey && recovered && !("draftId" in recovered)) {
      clearUnsaved(id, undefined, storage);
    }
    const retired = source;
    source = null;
    writing = writing
      .then(async () => {
        await store.recoveryDrafts?.remove(draftId);
        // the two stores' copies of the source can differ; a copy its
        // still-open editor wrote after the one adopted here stays
        if (retired) {
          await store.recoveryDrafts?.remove(
            retired.draftId,
            retired.updatedAt,
          );
          clearUnsaved(
            id,
            store.recoveryKey,
            storage,
            retired.draftId,
            retired.updatedAt,
          );
        }
      })
      .catch((removeError) =>
        console.warn("Could not remove completed recovery", removeError),
      );
  };

  return {
    generation: () => generation,
    /** Starts a generation for an edit the draft doesn't have yet. */
    edited: () => {
      generation = ownerWindow.crypto.randomUUID();
      updatedAt = Date.now();
    },
    /** This session's draft of `scene`, as of the current generation. */
    draft: ({ request, ...scene }: DrawingDraft): AccountDraft => ({
      ...scene,
      draftId,
      generation,
      updatedAt,
      ...(request && { request }),
    }),
    /** Writes the draft, or, given none, removes it and the one it adopted. */
    keep: (draft: AccountDraft | null) => (draft ? write(draft) : retire()),
    /** Resolves once every write and removal started so far has ended. */
    written: () => writing,
    isStored: () =>
      storedGeneration === generation || fallbackGeneration === generation,
    error: () => error,
    hold: () => {
      holds++;
      return () => {
        holds--;
        if (!holds) {
          unlock();
        }
      };
    },
  };
};

/** One editor session's recovery draft. */
export type RecoveryJournal = ReturnType<typeof createRecoveryJournal>;

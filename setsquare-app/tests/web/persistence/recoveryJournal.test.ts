import { getDefaultAppState } from "@setsquare/setsquare/appState";

import { createRecoveryJournal } from "../../../web/persistence/recoveryJournal";
import { writeUnsaved } from "../../../web/unsavedJournal";
import { splitAppState } from "../../../workspace/drawingAppState";

import type {
  AccountDraft,
  DrawingDraft,
  DrawingId,
} from "../../../workspace/types";
import type { WorkspaceStore } from "../../../workspace/WorkspaceStore";

const ACCOUNT = "greendale";
const { content, view } = splitAppState({
  ...getDefaultAppState(),
  name: "Greendale",
});
const scene: DrawingDraft = {
  id: "study-room" as DrawingId,
  baseRevision: 1,
  elements: [],
  appState: { ...content, ...view },
};

const drafts = () => {
  const saved = new Map<string, AccountDraft>();
  return {
    saved,
    save: vi.fn(async (draft: AccountDraft) => {
      saved.set(draft.draftId, draft);
    }),
    load: vi.fn(async () => [...saved.values()]),
    list: vi.fn(async () => [...saved.values()]),
    remove: vi.fn(async (draftId: string) => {
      saved.delete(draftId);
    }),
  };
};

const journalWith = ({
  recoveryDrafts = drafts(),
  recovered,
  storage = localStorage,
}: {
  recoveryDrafts?: ReturnType<typeof drafts>;
  recovered?: AccountDraft;
  storage?: Storage;
} = {}) => {
  const onChange = vi.fn();
  const store = {
    recoveryKey: ACCOUNT,
    recoveryStorage: storage,
    recoveryDrafts,
  } as Partial<WorkspaceStore> as WorkspaceStore;
  const journal = createRecoveryJournal({
    store,
    id: scene.id,
    recovered,
    ownerWindow: window,
    onChange,
  });
  return { journal, recoveryDrafts, onChange };
};

const storedDraftIds = () =>
  Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index)?.split(":").pop(),
  );

afterEach(() => {
  localStorage.clear();
});

describe("createRecoveryJournal", () => {
  it("is durable once either store has the current generation", async () => {
    const { journal, recoveryDrafts, onChange } = journalWith();
    const first = journal.draft(scene);
    journal.keep(first);
    expect(journal.isStored()).toBe(true);
    await journal.written();
    expect(recoveryDrafts.saved.get(first.draftId)).toEqual(first);
    expect(onChange).toHaveBeenCalledTimes(1);

    journal.edited();
    expect(journal.isStored()).toBe(false);
    const second = journal.draft(scene);
    expect(second.draftId).toBe(first.draftId);
    expect(second.generation).not.toBe(first.generation);
    journal.keep(second);
    await journal.written();
    expect(journal.isStored()).toBe(true);
  });

  it("reports an error only when neither store keeps the draft", async () => {
    const full = new DOMException("full", "QuotaExceededError");
    const storage = {
      setItem: () => {
        throw full;
      },
    } as Partial<Storage> as Storage;
    const recoveryDrafts = drafts();
    recoveryDrafts.save.mockRejectedValueOnce(full);
    const { journal } = journalWith({ recoveryDrafts, storage });
    journal.keep(journal.draft(scene));
    await journal.written();
    expect(journal.error()).toBe(full);
    expect(journal.isStored()).toBe(false);

    journal.keep(journal.draft(scene));
    await journal.written();
    expect(journal.error()).toBeNull();
    expect(journal.isStored()).toBe(true);
  });

  it("leaves a content request out of a draft that has none", () => {
    const { journal } = journalWith();
    expect(journal.draft(scene)).not.toHaveProperty("request");
  });

  it("retires its draft and the adopted draft's copies up to the adopted one", async () => {
    const recoveryDrafts = drafts();
    const adopted: AccountDraft = {
      ...scene,
      draftId: "abed",
      generation: "season-1",
      updatedAt: 100,
    };
    writeUnsaved(adopted, ACCOUNT, localStorage);
    const { journal } = journalWith({ recoveryDrafts, recovered: adopted });
    const own = journal.draft(scene);
    journal.keep(own);
    await journal.written();
    expect(storedDraftIds().sort()).toEqual(["abed", own.draftId].sort());

    journal.keep(null);
    await journal.written();
    expect(storedDraftIds()).toEqual([]);
    expect(recoveryDrafts.remove).toHaveBeenCalledWith(own.draftId);
    expect(recoveryDrafts.remove).toHaveBeenCalledWith("abed", 100);
  });

  it("keeps a copy of the adopted draft its editor wrote afterwards", async () => {
    const adopted: AccountDraft = {
      ...scene,
      draftId: "abed",
      generation: "season-1",
      updatedAt: 100,
    };
    const { journal } = journalWith({ recovered: adopted });
    writeUnsaved(
      { ...adopted, generation: "season-2", updatedAt: 200 },
      ACCOUNT,
      localStorage,
    );
    journal.keep(null);
    await journal.written();
    expect(storedDraftIds()).toEqual(["abed"]);
  });

  it("releases its locks once every hold ends", async () => {
    const requests: Array<{ name: string; until: Promise<unknown> }> = [];
    const recoveryLocks = {
      request: (name: string, callback: () => Promise<unknown>) => {
        requests.push({ name, until: callback() });
        return Promise.resolve();
      },
    } as unknown as LockManager;
    const store = {
      recoveryKey: ACCOUNT,
      recoveryLocks,
    } as Partial<WorkspaceStore> as WorkspaceStore;
    const journal = createRecoveryJournal({
      store,
      id: scene.id,
      recovered: { ...scene, draftId: "abed", generation: "g", updatedAt: 1 },
      ownerWindow: window,
      onChange: () => {},
    });
    expect(requests.map(({ name }) => name)).toEqual([
      expect.stringMatching(/^setsquare-draft:/),
      "setsquare-draft:abed",
    ]);
    const released = vi.fn();
    requests[0].until.then(released);
    const first = journal.hold();
    const second = journal.hold();
    first();
    await Promise.resolve();
    expect(released).not.toHaveBeenCalled();
    second();
    await requests[0].until;
    expect(released).toHaveBeenCalled();
  });
});

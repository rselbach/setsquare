import { getDefaultAppState } from "@setsquare/setsquare/appState";

import {
  contentWrite,
  sceneContent,
} from "../../../web/persistence/saveContent";
import {
  createStoredDrawing,
  saveCopy,
} from "../../../web/persistence/storedDrawing";
import { workspaceFixture } from "../../workspace/helpers";
import { savedContent } from "../helpers";

import type {
  ContentWrite,
  PendingScene,
} from "../../../web/persistence/saveContent";
import type { createThumbnailer } from "../../../web/thumbnail";
import type { DrawingContent } from "../../../workspace/types";

let fixture: ReturnType<typeof workspaceFixture>;

beforeEach(() => {
  fixture = workspaceFixture();
});

afterEach(() => {
  fixture.close();
});

const opened = async () => {
  const store = await fixture.open();
  const meta = await store.createDrawing({
    folderId: null,
    name: "Greendale",
    content: savedContent("Greendale", "troy"),
  });
  const drawing = await store.openDrawing(meta.id);
  if (!drawing) {
    throw new Error("The test drawing is missing");
  }
  const thumbnailer = { schedule: vi.fn() } as Partial<
    ReturnType<typeof createThumbnailer>
  > as ReturnType<typeof createThumbnailer>;
  const stored = createStoredDrawing({ store, drawing, thumbnailer });
  return { store, drawing, thumbnailer, stored };
};

describe("createStoredDrawing", () => {
  it("commits a write and moves to its revision", async () => {
    const { thumbnailer, stored } = await opened();
    const write = contentWrite(savedContent("Greendale", "troy", "abed"));
    expect(
      await stored.sendContent(
        write,
        { baseRevision: 1, requestId: "britta" },
        false,
      ),
    ).toEqual({ kind: "saved" });
    expect(stored.revision()).toBe(2);
    expect(stored.signature().content).toBe(write.signature);
    expect(thumbnailer.schedule).toHaveBeenCalledWith(2);
  });

  it("reports a write based on an older revision as a conflict", async () => {
    const { store, drawing, stored } = await opened();
    const before = stored.signature();
    await store.saveDrawingContent(
      drawing.meta.id,
      savedContent("Greendale", "annie"),
      [],
      { baseRevision: 1, requestId: "annie" },
    );
    const sent = await stored.sendContent(
      contentWrite(savedContent("Greendale", "troy", "abed")),
      { baseRevision: 1, requestId: "britta" },
      false,
    );
    expect(sent).toMatchObject({ kind: "conflict", meta: { revision: 2 } });
    expect(stored.revision()).toBe(1);
    expect(stored.signature()).toEqual(before);
  });

  it("takes an uncertain resend the drawing already has as saved", async () => {
    const { store, drawing, stored } = await opened();
    const write = contentWrite(savedContent("Greendale", "troy", "abed"));
    const options = { baseRevision: 1, requestId: "britta" };
    // the first send committed, but its answer was lost
    await store.saveDrawingContent(
      drawing.meta.id,
      write.content,
      write.fileIds,
      options,
    );
    expect(await stored.sendContent(write, options, false)).toMatchObject({
      kind: "conflict",
    });
    expect(await stored.sendContent(write, options, true)).toEqual({
      kind: "saved",
    });
    expect(stored.revision()).toBe(2);
  });

  it("reports a drawing deleted forever as gone", async () => {
    const { store, drawing, stored } = await opened();
    await store.deleteForever({ kind: "drawing", id: drawing.meta.id });
    expect(
      await stored.sendContent(
        contentWrite(savedContent("Greendale", "abed")),
        { baseRevision: 1, requestId: "britta" },
        false,
      ),
    ).toEqual({ kind: "notFound" });
  });

  it("writes a view only when it changed, and survives failing to", async () => {
    const { store, stored } = await opened();
    const saveView = vi.spyOn(store, "saveDrawingView");
    const view = { ...getDefaultAppState(), scrollX: 120 };
    expect(await stored.sendView(view)).toBe(true);
    expect(await stored.sendView(view)).toBe(true);
    expect(saveView).toHaveBeenCalledTimes(1);

    const full = new DOMException("full", "QuotaExceededError");
    saveView.mockRejectedValueOnce(full);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await stored.sendView({ ...view, scrollX: 240 })).toBe(true);
    expect(stored.viewError()).toBe(full);
  });

  it("moves to a revision it reloads", async () => {
    const { stored } = await opened();
    const content = savedContent("Greendale", "pierce");
    stored.reloaded(7, content);
    expect(stored.revision()).toBe(7);
    expect(stored.signature().content).toBe(contentWrite(content).signature);
  });
});

describe("saveCopy", () => {
  const scene = (content: DrawingContent): PendingScene => ({
    elements: content.elements,
    appState: {
      ...getDefaultAppState(),
      width: 800,
      height: 600,
      offsetTop: 0,
      offsetLeft: 0,
      ...content.appState,
    },
    files: {},
    onFilesSaved: () => {},
  });

  it("saves the latest edit to the copy, including one made while creating it", async () => {
    const { store, drawing } = await opened();
    let pending: PendingScene | null = scene(
      savedContent("Greendale", "troy", "abed"),
    );
    const newer = scene(savedContent("Greendale", "troy", "abed", "annie"));
    const prepared: ContentWrite[] = [];
    const copy = await saveCopy({
      store,
      drawing,
      ownerWindow: window,
      pending: () => pending,
      prepare: async (current) => {
        const write = contentWrite(sceneContent(current));
        prepared.push(write);
        pending = newer;
        return write;
      },
    });
    expect(prepared).toHaveLength(2);
    expect(copy?.id).not.toBe(drawing.meta.id);
    expect(copy?.name).not.toBe("Greendale");
    const content = copy && (await store.loadDrawingContent(copy.id));
    expect(content?.elements.map((element) => element.id)).toEqual([
      "troy",
      "abed",
      "annie",
    ]);
    expect(content?.appState.name).toBe(copy?.name);
    expect(
      (await store.loadDrawingContent(drawing.meta.id))?.elements.length,
    ).toBe(1);
  });

  it("copies nothing without a pending scene", async () => {
    const { store, drawing } = await opened();
    const prepare = vi.fn();
    expect(
      await saveCopy({
        store,
        drawing,
        ownerWindow: window,
        pending: () => null,
        prepare,
      }),
    ).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
});

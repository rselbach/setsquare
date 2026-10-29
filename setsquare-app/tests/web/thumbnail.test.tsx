import * as setsquare from "@setsquare/setsquare";
import { CaptureUpdateAction } from "@setsquare/setsquare";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act, waitFor } from "@setsquare/setsquare/tests/test-utils";

import type { DataURL } from "@setsquare/setsquare/types";

import { emptyDrawingContent } from "../../workspace/drawingAppState";

import {
  cleanUpWebApp,
  navigateTo,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingId, DrawingMeta } from "../../workspace/types";

const { h } = window;

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" as DataURL;

const thumbnailOf = async (store: LocalWorkspaceStore, id: DrawingId) =>
  (await store.getThumbnails([id])).get(id);

const addEllipse = (id: string) =>
  API.updateScene({
    elements: [...h.elements, API.createElement({ type: "ellipse", id })],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

// long enough for a thumbnail to have rendered if it was going to
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 100)));

let workspace: ReturnType<typeof setUpTestWorkspace>;
let store: LocalWorkspaceStore;
let plan: DrawingMeta;
let seating: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  store = await workspace.open();
  plan = await store.createDrawing({
    folderId: null,
    name: "Floor plan",
    content: savedContent("Floor plan", "troy"),
  });
  seating = await store.createDrawing({
    folderId: null,
    name: "Seating",
    content: savedContent("Seating", "abed"),
  });
});

afterEach(() => cleanUpWebApp(workspace));

describe("thumbnails on the web", () => {
  it("render a while after an edit is saved", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    addEllipse("annie");
    await waitForAutosave();

    expect((await store.getDrawingMeta(plan.id))?.revision).toBe(2);
    // not on every save, but once the editor is quiet
    expect(await thumbnailOf(store, plan.id)).toBe(undefined);
    await waitFor(
      async () =>
        expect(await thumbnailOf(store, plan.id)).toEqual({
          src: expect.stringMatching(/^data:image\/webp;/),
          revision: 2,
        }),
      { timeout: 3000 },
    );
  }, 10000);

  it("render when leaving the drawing", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    await navigateTo({ kind: "drawing", id: seating.id });

    await waitFor(async () =>
      expect(await thumbnailOf(store, plan.id)).toEqual({
        src: expect.stringMatching(/^data:image\/webp;/),
        revision: 1,
      }),
    );
    await waitForDrawing(seating.id, ["abed"]);
  });

  it("skip an empty drawing", async () => {
    const exportToCanvas = vi.spyOn(setsquare, "exportToCanvas");
    const blank = await store.createDrawing({
      folderId: null,
      name: null,
      content: emptyDrawingContent(null),
    });
    await renderWebAppAt(`/d/${blank.id}`);
    await waitForDrawing(blank.id, []);

    await navigateTo({ kind: "drawing", id: seating.id });
    await waitForDrawing(seating.id, ["abed"]);
    await settle();

    expect(exportToCanvas).not.toHaveBeenCalled();
    expect(await thumbnailOf(store, blank.id)).toBe(undefined);
  });

  it("go when the drawing is emptied", async () => {
    await store.saveThumbnail(plan.id, { src: PIXEL, revision: 1 });
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    API.updateScene({
      elements: h.elements.map((element) => ({ ...element, isDeleted: true })),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    await waitForAutosave();
    await navigateTo({ kind: "drawing", id: seating.id });
    await waitForDrawing(seating.id, ["abed"]);

    await waitFor(async () =>
      expect(await thumbnailOf(store, plan.id)).toBe(undefined),
    );
    expect((await store.getDrawingMeta(plan.id))?.revision).toBe(2);
  });

  it("skip a drawing whose thumbnail is current", async () => {
    const exportToCanvas = vi.spyOn(setsquare, "exportToCanvas");
    await store.saveThumbnail(plan.id, { src: PIXEL, revision: 1 });
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    await navigateTo({ kind: "drawing", id: seating.id });
    await waitForDrawing(seating.id, ["abed"]);
    await settle();

    expect(exportToCanvas).not.toHaveBeenCalled();
    expect(await thumbnailOf(store, plan.id)).toEqual({
      src: PIXEL,
      revision: 1,
    });
  });

  it("never get in the way of saving", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(setsquare, "exportToCanvas").mockRejectedValue(
      new Error("canvas too big"),
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    addEllipse("annie");

    await navigateTo({ kind: "drawing", id: seating.id });
    await waitForDrawing(seating.id, ["abed"]);

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        "Couldn't save the drawing's thumbnail",
        expect.any(Error),
      ),
    );
    expect(
      (await store.loadDrawingContent(plan.id))?.elements.map(({ id }) => id),
    ).toEqual(["troy", "annie"]);
    expect(await thumbnailOf(store, plan.id)).toBe(undefined);
  });
});

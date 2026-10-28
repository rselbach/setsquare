import { CaptureUpdateAction } from "@setsquare/setsquare";
import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act } from "@setsquare/setsquare/tests/test-utils";

import type { AppState } from "@setsquare/setsquare/types";

import { STORAGE_KEYS } from "../../app_constants";
import { writeUnsaved } from "../../web/unsavedJournal";
import { splitAppState } from "../../workspace/drawingAppState";

import {
  cleanUpWebApp,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
} from "./helpers";

import type { UnsavedDrawing } from "../../web/unsavedJournal";
import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingMeta } from "../../workspace/types";

const { h } = window;

const journal = (): UnsavedDrawing | null =>
  JSON.parse(
    localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_UNSAVED) ?? "null",
  );

// the scene a page closed on, edited from the drawing's first revision
const unsavedOf = (
  drawing: DrawingMeta,
  ids: string[],
  appState: Partial<AppState>,
): UnsavedDrawing => {
  const { content, view } = splitAppState({
    ...getDefaultAppState(),
    name: drawing.name,
    ...appState,
  });
  return {
    id: drawing.id,
    baseRevision: 1,
    elements: savedContent(drawing.name, ...ids).elements,
    appState: { ...content, ...view },
  };
};

let workspace: ReturnType<typeof setUpTestWorkspace>;
let store: LocalWorkspaceStore;
let plan: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  store = await workspace.open();
  plan = await store.createDrawing({
    folderId: null,
    name: "Floor plan",
    content: savedContent("Floor plan", "troy"),
  });
});

afterEach(() => cleanUpWebApp(workspace));

describe("the unsaved journal", () => {
  it("restores the scene a page closed on before saving it", async () => {
    writeUnsaved(unsavedOf(plan, ["troy", "annie"], { scrollX: 210 }));

    await renderWebAppAt(`/d/${plan.id}`);

    await waitForDrawing(plan.id, ["troy", "annie"]);
    expect(h.state.scrollX).toBe(210);
    expect(journal()).toBe(null);
    const content = await store.loadDrawingContent(plan.id);
    expect(content?.elements.map((element) => element.id)).toEqual([
      "troy",
      "annie",
    ]);
    expect((await store.getDrawingMeta(plan.id))?.revision).toBe(2);
  });

  it("drops the scene once the drawing changed since", async () => {
    writeUnsaved(unsavedOf(plan, ["troy", "annie"], { scrollX: 210 }));
    // another tab saved the drawing after this page closed
    await store.saveDrawingContent(
      plan.id,
      savedContent("Floor plan", "shirley"),
      [],
    );

    await renderWebAppAt(`/d/${plan.id}`);

    await waitForDrawing(plan.id, ["shirley"]);
    expect(h.state.scrollX).not.toBe(210);
    expect(journal()).toBe(null);
    expect((await store.getDrawingMeta(plan.id))?.revision).toBe(2);
  });

  it("keeps another drawing's scene for when that one opens", async () => {
    const seating = await store.createDrawing({
      folderId: null,
      name: "Seating",
      content: savedContent("Seating", "abed"),
    });
    const unsaved = unsavedOf(seating, ["abed", "annie"], {});
    writeUnsaved(unsaved);

    await renderWebAppAt(`/d/${plan.id}`);

    await waitForDrawing(plan.id, ["troy"]);
    expect(journal()).toEqual(unsaved);
  });

  it("keeps the scene when the page closes before it's saved", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    API.updateScene({
      elements: [
        ...h.elements,
        API.createElement({ type: "ellipse", id: "annie" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    act(() => h.setState({ scrollX: 210 }));

    window.dispatchEvent(new Event("pagehide"));

    expect(journal()).toMatchObject({
      id: plan.id,
      baseRevision: 1,
      elements: [{ id: "troy" }, { id: "annie" }],
      appState: { name: "Floor plan", scrollX: 210 },
    });
  });

  it("keeps nothing when the page closes with everything saved", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    act(() => h.setState({ scrollX: 210 }));
    await waitForAutosave();

    window.dispatchEvent(new Event("pagehide"));

    expect(journal()).toBe(null);
  });
});

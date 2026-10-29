import { CaptureUpdateAction } from "@setsquare/setsquare";
import { serializeAsJSON } from "@setsquare/setsquare/data/json";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import {
  act,
  fireEvent,
  screen,
  waitFor,
} from "@setsquare/setsquare/tests/test-utils";

import {
  cleanUpWebApp,
  renderPageAt,
  savedContent,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
  waitForPage,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingMeta } from "../../workspace/types";

const { h } = window;

// the drawing the app made, once this store hears of it
const madeDrawing = (store: LocalWorkspaceStore, kept: DrawingMeta) =>
  waitFor(() => {
    const made = [...store.getSnapshot().drawings.values()].filter(
      (drawing) => drawing.id !== kept.id,
    );
    expect(made).toHaveLength(1);
    return made[0];
  });

const goBack = async () => {
  act(() => window.history.back());
  await waitForPage("/", "Drawings");
  // the app's own store deletes it; let this one hear of it
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
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

describe("a new drawing", () => {
  it("is deleted for good when it's left unused", async () => {
    await renderPageAt("/");
    fireEvent.click(screen.getByRole("button", { name: "New drawing" }));
    const made = await madeDrawing(store, plan);
    await waitForDrawing(made.id, []);
    await waitForAutosave();
    // opening it saved nothing
    expect((await store.getDrawingMeta(made.id))?.revision).toBe(made.revision);

    await goBack();

    expect(await store.getDrawingMeta(made.id)).toBe(null);
    expect(store.getSnapshot().drawings.size).toBe(1);
    expect(screen.queryByRole("link", { name: "Untitled" })).toBe(null);
  });

  const edits: Record<string, () => void> = {
    named: () => act(() => h.setState({ name: "Paintball map" })),
    "drawn on": () =>
      API.updateScene({
        elements: [API.createElement({ type: "rectangle", id: "abed" })],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      }),
    "given a background": () =>
      act(() => h.setState({ viewBackgroundColor: "#ffc9c9" })),
  };

  it.each(Object.entries(edits))("is kept once it's %s", async (_, edit) => {
    await renderPageAt("/");
    fireEvent.click(screen.getByRole("button", { name: "New drawing" }));
    const made = await madeDrawing(store, plan);
    await waitForDrawing(made.id, []);

    // and left well within the autosave's debounce
    edit();
    await goBack();

    expect(await store.getDrawingMeta(made.id)).toMatchObject({
      trashedAt: null,
    });
    expect(store.getSnapshot().drawings.size).toBe(2);
  });

  it("is kept empty when a link opened it", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue({
      blob: async () =>
        new Blob([serializeAsJSON([], {}, {}, "local")], {
          type: "application/json",
        }),
    } as Response);
    await renderPageAt("/");

    window.history.replaceState(
      null,
      "",
      "/#url=https://greendale.edu/blank.setsquare",
    );
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    const made = await madeDrawing(store, plan);
    // so only how it was made tells it from one New drawing made
    expect(made.name).toBe(null);
    await waitForDrawing(made.id, []);
    await waitForAutosave();
    expect((await store.getDrawingMeta(made.id))?.revision).toBe(made.revision);

    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "All drawings" }),
    );
    await waitForPage("/", "Drawings");
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(await store.getDrawingMeta(made.id)).not.toBe(null);
  });
});

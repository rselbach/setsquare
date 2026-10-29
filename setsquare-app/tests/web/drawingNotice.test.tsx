import { CaptureUpdateAction } from "@setsquare/setsquare";
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
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForDrawing,
  waitForPage,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingMeta, Folder } from "../../workspace/types";

const { h } = window;

const storedIds = async (store: LocalWorkspaceStore, drawing: DrawingMeta) =>
  (await store.loadDrawingContent(drawing.id))?.elements.map(({ id }) => id);

const trashedHeading = () =>
  screen.findByRole("heading", { name: "“Floor plan” is in the Trash" });

let workspace: ReturnType<typeof setUpTestWorkspace>;
let store: LocalWorkspaceStore;
let greendale: Folder;
let plan: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  store = await workspace.open();
  greendale = await store.createFolder(null, "Greendale");
  plan = await store.createDrawing({
    folderId: greendale.id,
    name: "Floor plan",
    content: savedContent("Floor plan", "troy"),
  });
});

afterEach(() => cleanUpWebApp(workspace));

describe("a drawing in the Trash", () => {
  it("shows a notice at its address, and Restore opens it", async () => {
    await store.trash({ kind: "drawing", id: plan.id });

    await renderPageAt(`/d/${plan.id}`);

    expect(await trashedHeading()).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
    // it wasn't opened
    expect(store.getSnapshot().drawings.get(plan.id)?.openedAt).toBe(null);

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitForDrawing(plan.id, ["troy"]);
    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(plan.id)).toMatchObject({
        folderId: greendale.id,
        trashedAt: null,
      }),
    );
  });

  it("restores to the root out of a folder in the Trash", async () => {
    await store.trash({ kind: "folder", id: greendale.id });

    await renderPageAt(`/d/${plan.id}`);
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitForDrawing(plan.id, ["troy"]);
    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(plan.id)?.folderId).toBe(null),
    );
  });

  it("goes back to the drawings from the notice", async () => {
    await store.trash({ kind: "drawing", id: plan.id });
    await renderPageAt(`/d/${plan.id}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Back to drawings" }),
    );

    await waitForPage("/", "Drawings");
  });
});

describe("the open drawing", () => {
  it("gives way to the notice when another tab trashes it, saved first", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    // well within the autosave's debounce
    API.updateScene({
      elements: [
        ...h.elements,
        API.createElement({ type: "ellipse", id: "annie" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    await act(() => store.trash({ kind: "drawing", id: plan.id }));

    expect(await trashedHeading()).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
    expect(await storedIds(store, plan)).toEqual(["troy", "annie"]);

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitForDrawing(plan.id, ["troy", "annie"]);
  });
});

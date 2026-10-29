import { CaptureUpdateAction } from "@setsquare/setsquare";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@setsquare/setsquare/tests/test-utils";
import { KEYS } from "@setsquare/common";

import { toPrefs } from "../../workspace/drawingAppState";
import { savePrefs } from "../../workspace/prefs";

import {
  cleanUpWebApp,
  elementIds,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingMeta, Folder } from "../../workspace/types";

const { h } = window;

const DRAWINGS_TAB = { name: "default", tab: "drawings" };

const drawingList = (folderName: string) =>
  screen.findByRole("list", { name: folderName });

const rowLinks = async (folderName: string) =>
  within(await drawingList(folderName))
    .getAllByRole("link")
    .map((link) => ({
      name: link.querySelector(".drawings-sidebar__name")?.textContent,
      current: link.getAttribute("aria-current") === "page",
    }));

const openRowMenu = async (name: string) => {
  fireEvent.click(
    await screen.findByRole("button", { name: `Actions for ${name}` }),
  );
  return screen.findByTestId("dropdown-menu");
};

const chooseFromRowMenu = async (name: string, item: string) => {
  const menu = await openRowMenu(name);
  fireEvent.click(within(menu).getByRole("menuitem", { name: item }));
};

let workspace: ReturnType<typeof setUpTestWorkspace>;
let store: LocalWorkspaceStore;
let greendale: Folder;
let plan: DrawingMeta;
let seating: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  store = await workspace.open();
  greendale = await store.createFolder(null, "Greendale");
  plan = await store.createDrawing({
    folderId: greendale.id,
    name: "Floor plan",
    content: savedContent("Floor plan", "troy"),
  });
  workspace.clock.now += 1000;
  seating = await store.createDrawing({
    folderId: greendale.id,
    name: "Seating",
    content: savedContent("Seating", "abed"),
  });
  // elsewhere, so it's not listed
  await store.createDrawing({
    folderId: null,
    name: "Paintball",
    content: savedContent("Paintball", "chang"),
  });
  // the tab as the user left it open
  savePrefs(toPrefs({ openSidebar: DRAWINGS_TAB }));
});

afterEach(() => cleanUpWebApp(workspace));

describe("the Drawings sidebar tab", () => {
  it("lists the folder's drawings, the open one marked", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    expect(
      screen.getByRole("heading", { name: "Greendale" }),
    ).toBeInTheDocument();
    expect(await rowLinks("Greendale")).toEqual([
      { name: "Seating", current: false },
      { name: "Floor plan", current: true },
    ]);
  });

  it("switches drawings and stays open", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    fireEvent.click(
      within(await drawingList("Greendale")).getByRole("link", {
        name: /^Seating/,
      }),
    );

    await waitForDrawing(seating.id, ["abed"]);
    expect(h.state.openSidebar).toEqual(DRAWINGS_TAB);
    expect(await rowLinks("Greendale")).toContainEqual({
      name: "Seating",
      current: true,
    });
  });

  it("creates a drawing in the folder and opens it", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    fireEvent.click(await screen.findByRole("button", { name: "New drawing" }));

    const created = await waitFor(() => {
      const drawings = [...store.getSnapshot().drawings.values()];
      expect(drawings).toHaveLength(4);
      return drawings[3];
    });
    expect(created).toMatchObject({ folderId: greendale.id, name: null });
    await waitForDrawing(created.id, []);
    expect(await rowLinks("Greendale")).toContainEqual({
      name: "Untitled",
      current: true,
    });
  });

  it("renames the open drawing for good", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    await chooseFromRowMenu("Floor plan", "Rename");
    const field = await screen.findByRole("textbox", { name: "Drawing name" });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Paintball map" } });
    fireEvent.keyDown(field, { key: KEYS.ENTER });

    expect(h.state.name).toBe("Paintball map");
    await waitForAutosave();
    expect((await store.getDrawingMeta(plan.id))?.name).toBe("Paintball map");

    // the next save keeps it
    API.updateScene({
      elements: [
        ...h.elements,
        API.createElement({ type: "ellipse", id: "annie" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    await waitForAutosave();
    expect(await store.loadDrawingContent(plan.id)).toMatchObject({
      appState: { name: "Paintball map" },
    });
    expect((await store.getDrawingMeta(plan.id))?.name).toBe("Paintball map");
  });

  it("renames another drawing, or leaves it with Escape", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    await chooseFromRowMenu("Seating", "Rename");
    let field = await screen.findByRole("textbox", { name: "Drawing name" });
    fireEvent.change(field, { target: { value: "Study room" } });
    fireEvent.keyDown(field, { key: KEYS.ESCAPE });

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Drawing name" })).toBe(
        null,
      ),
    );
    expect(h.state.openSidebar).toEqual(DRAWINGS_TAB);
    expect(store.getSnapshot().drawings.get(seating.id)?.name).toBe("Seating");

    await chooseFromRowMenu("Seating", "Rename");
    field = await screen.findByRole("textbox", { name: "Drawing name" });
    fireEvent.change(field, { target: { value: "Study room" } });
    act(() => field.blur());

    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(seating.id)?.name).toBe(
        "Study room",
      ),
    );
    expect(h.state.name).toBe("Floor plan");
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
  });

  it("duplicates the open drawing as it is now, and stays on it", async () => {
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

    await chooseFromRowMenu("Floor plan", "Duplicate");

    const copy = await waitFor(() => {
      const copy = [...store.getSnapshot().drawings.values()].find(
        (drawing) => drawing.name === "Floor plan copy",
      );
      expect(copy).toBeDefined();
      return copy!;
    });
    expect(copy.folderId).toBe(greendale.id);
    expect(
      (await store.loadDrawingContent(copy.id))?.elements.map(({ id }) => id),
    ).toEqual(["troy", "annie"]);
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
    expect(elementIds()).toEqual(["troy", "annie"]);

    await chooseFromRowMenu("Floor plan", "Duplicate");

    await waitFor(() =>
      expect(
        [...store.getSnapshot().drawings.values()].map(({ name }) => name),
      ).toContain("Floor plan copy 2"),
    );
  });
});

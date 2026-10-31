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

import { STORAGE_KEYS } from "../../app_constants";

import { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";

import {
  cleanUpWebApp,
  findToast,
  elementIds,
  navigateTo,
  renderPageAt,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
  waitForPage,
} from "./helpers";

import type { DrawingMeta, Folder } from "../../workspace/types";

const { h } = window;

const nav = () =>
  screen.getByRole("navigation", { name: "Drawings and folders" });

// the drawings the nav lists in a folder, and which one is open
const drawingRows = (folderName: string) =>
  within(within(nav()).getByRole("link", { name: folderName }).closest("li")!)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("href")?.startsWith("/d/"))
    .map((link) => ({
      name: link.textContent,
      current: link.getAttribute("aria-current") === "page",
    }));

const chooseFromRowMenu = async (name: string, item: string) => {
  fireEvent.click(
    within(nav()).getByRole("button", { name: `Actions for ${name}` }),
  );
  const menu = await screen.findByTestId("dropdown-menu");
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
});

afterEach(() => cleanUpWebApp(workspace));

describe("the nav beside the editor", () => {
  it("lists the open drawing's folder by name, the drawing marked", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    expect(drawingRows("Greendale")).toEqual([
      { name: "Floor plan", current: true },
      { name: "Seating", current: false },
    ]);
    expect(within(nav()).queryByRole("link", { name: "Paintball" })).toBe(null);
  });

  it("stays as it switches drawings and goes to the folder", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    const shown = nav();

    fireEvent.click(within(shown).getByRole("link", { name: "Seating" }));

    await waitForDrawing(seating.id, ["abed"]);
    expect(nav()).toBe(shown);
    expect(drawingRows("Greendale")).toContainEqual({
      name: "Seating",
      current: true,
    });

    fireEvent.click(within(shown).getByRole("link", { name: "Greendale" }));

    await waitForPage(`/f/${greendale.id}`, "Greendale");
    expect(nav()).toBe(shown);
    expect(drawingRows("Greendale")).toEqual([
      { name: "Floor plan", current: false },
      { name: "Seating", current: false },
    ]);
  });

  it("goes between the page and the editor without a loading screen", async () => {
    await renderPageAt(`/f/${greendale.id}`);
    const loading: Element[] = [];
    const observer = new MutationObserver(() => {
      loading.push(...document.querySelectorAll(".LoadingMessage"));
    });
    observer.observe(document.body, { childList: true, subtree: true });

    await navigateTo({ kind: "drawing", id: plan.id });
    await waitForDrawing(plan.id, ["troy"]);
    await navigateTo({ kind: "drawings", folderId: greendale.id });
    await waitForPage(`/f/${greendale.id}`, "Greendale");

    observer.disconnect();
    expect(loading).toEqual([]);
  });

  it("shows from the editor's top bar once hidden", async () => {
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE_NAV_HIDDEN,
      "true",
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    const shell = document.querySelector(".workspace-shell");
    expect(shell).toHaveClass("workspace-shell--nav-hidden");

    const show = screen.getByRole("button", { name: "Show sidebar" });
    expect(show.closest(".setsquare-ui-top-left")).not.toBe(null);
    fireEvent.click(show);

    expect(shell).not.toHaveClass("workspace-shell--nav-hidden");
    expect(h.state.isLoading).toBe(false);
    expect(elementIds()).toEqual(["troy"]);
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
    // as the editor has it, before it's saved
    await waitFor(() =>
      expect(drawingRows("Greendale")).toContainEqual({
        name: "Paintball map",
        current: true,
      }),
    );
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

  it("gives the drawing's link the focus once Enter or Escape ends a rename", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    const link = () => within(nav()).getByRole("link", { name: /^Seating/ });

    await chooseFromRowMenu("Seating", "Rename");
    let field = await screen.findByRole("textbox", { name: "Drawing name" });
    fireEvent.keyDown(field, { key: KEYS.ESCAPE });

    expect(link()).toHaveFocus();

    await chooseFromRowMenu("Seating", "Rename");
    field = await screen.findByRole("textbox", { name: "Drawing name" });
    fireEvent.change(field, { target: { value: "Study room" } });
    fireEvent.keyDown(field, { key: KEYS.ENTER });

    await waitFor(() =>
      expect(
        within(nav()).getByRole("link", { name: /^Study room/ }),
      ).toHaveFocus(),
    );
  });

  it("says so over the editor when it can't duplicate a drawing", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    vi.spyOn(
      LocalWorkspaceStore.prototype,
      "duplicateDrawing",
    ).mockRejectedValue(
      new DOMException("The disk is full", "QuotaExceededError"),
    );

    await chooseFromRowMenu("Seating", "Duplicate");

    await findToast("Couldn't duplicate “Seating”.", "error");
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
    await waitFor(() =>
      expect(drawingRows("Greendale").map(({ name }) => name)).toEqual([
        "Floor plan",
        "Floor plan copy",
        "Seating",
      ]),
    );
  });

  it("trashes the open drawing from its folder, with Undo", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    await chooseFromRowMenu("Floor plan", "Move to Trash");

    await waitForPage(`/f/${greendale.id}`, "Greendale");
    await findToast("Moved “Floor plan” to Trash");
    await waitFor(() =>
      expect(drawingRows("Greendale")).toEqual([
        { name: "Seating", current: false },
      ]),
    );
  });
});

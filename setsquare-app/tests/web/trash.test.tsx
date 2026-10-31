import { KEYS } from "@setsquare/common";
import { CaptureUpdateAction } from "@setsquare/setsquare";
import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@setsquare/setsquare/tests/test-utils";

import * as workspaceStore from "../../web/workspaceStore";
import { splitAppState } from "../../workspace/drawingAppState";

import { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";

import {
  cleanUpWebApp,
  elementIds,
  renderPageAt,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForDrawing,
  waitForPage,
} from "./helpers";

import type {
  AccountDraft,
  DrawingId,
  DrawingMeta,
  Folder,
  FolderId,
} from "../../workspace/types";

const { h } = window;

const DAY = 24 * 60 * 60 * 1000;

const card = (section: "Folders" | "Drawings", name: string) =>
  within(screen.getByRole("region", { name: section })).getByRole("link", {
    name,
  });

// the page's menus, not the nav's for the same drawings
const chooseFromMenu = async (label: string, item: string) => {
  fireEvent.click(
    within(screen.getByRole("main")).getByRole("button", { name: label }),
  );
  const menu = await screen.findByTestId("dropdown-menu");
  fireEvent.click(within(menu).getByRole("menuitem", { name: item }));
};

const trashList = () => screen.getByRole("list", { name: "Trash" });

const trashRow = (name: string) =>
  within(trashList()).getByRole("listitem", { name });

const trashedNames = () =>
  within(trashList())
    .getAllByRole("listitem")
    .map((row) => row.getAttribute("aria-label"));

const isTrashed = (store: LocalWorkspaceStore, drawing: DrawingMeta) =>
  store.getSnapshot().drawings.get(drawing.id)?.trashedAt !== null;

let workspace: ReturnType<typeof setUpTestWorkspace>;
let store: LocalWorkspaceStore;
let greendale: Folder;
let studyGroup: Folder;
let plan: DrawingMeta;
let seating: DrawingMeta;
let chang: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  store = await workspace.open();
  greendale = await store.createFolder(null, "Greendale");
  studyGroup = await store.createFolder(greendale.id, "Study group");
  plan = await store.createDrawing({
    folderId: studyGroup.id,
    name: "Floor plan",
    content: savedContent("Floor plan", "troy"),
  });
  workspace.clock.now += 1000;
  seating = await store.createDrawing({
    folderId: studyGroup.id,
    name: "Seating",
    content: savedContent("Seating", "abed"),
  });
  chang = await store.createDrawing({
    folderId: null,
    name: "Señor Chang's office",
    content: savedContent("Señor Chang's office", "chang"),
  });
});

afterEach(() => cleanUpWebApp(workspace));

describe("moving to the Trash from the page", () => {
  it("trashes a card from its menu, and Undo takes it back", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    await chooseFromMenu("Actions for Floor plan", "Move to Trash");

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Moved “Floor plan” to Trash");
    expect(
      within(screen.getByRole("region", { name: "Drawings" })).queryByRole(
        "link",
        { name: "Floor plan" },
      ),
    ).toBe(null);
    await waitFor(() => expect(isTrashed(store, plan)).toBe(true));

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(card("Drawings", "Floor plan")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("status")).toBe(null);
    await waitFor(() => expect(isTrashed(store, plan)).toBe(false));
  });

  it("trashes the focused card with Delete, and Cmd+Z takes it back", async () => {
    await renderPageAt("/");

    // not from the search box, where the keys edit the text
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: KEYS.DELETE });
    expect(card("Drawings", "Señor Chang's office")).toBeInTheDocument();
    fireEvent.keyDown(card("Drawings", "Señor Chang's office"), {
      key: KEYS.DELETE,
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Moved “Señor Chang's office” to Trash",
    );
    expect(screen.queryByRole("region", { name: "Drawings" })).toBe(null);
    // nor while typing, where it undoes the typing
    fireEvent.keyDown(screen.getByRole("searchbox"), {
      key: "z",
      [KEYS.CTRL_OR_CMD]: true,
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "z", [KEYS.CTRL_OR_CMD]: true });

    await waitFor(() =>
      expect(card("Drawings", "Señor Chang's office")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("status")).toBe(null);

    fireEvent.keyDown(card("Folders", "Greendale"), { key: KEYS.BACKSPACE });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Moved “Greendale” to Trash",
    );
    await waitFor(() =>
      expect(store.getSnapshot().folders.get(greendale.id)?.trashedAt).not.toBe(
        null,
      ),
    );
  });
});

describe("the Trash", () => {
  it("lists what's in it, where each was and when it went", async () => {
    workspace.clock.now = Date.now() - 3 * DAY;
    await store.trash({ kind: "drawing", id: plan.id });
    workspace.clock.now = Date.now() - 2 * 60 * 60 * 1000;
    await store.trash({ kind: "drawing", id: chang.id });

    await renderPageAt("/trash");

    await waitForPage("/trash", "Trash");
    expect(
      within(
        screen.getByRole("navigation", { name: "Drawings and folders" }),
      ).getByRole("link", { name: "Trash" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByText(
        "Items in the Trash are deleted for good after 30 days.",
      ),
    ).toBeInTheDocument();
    // the latest first
    expect(trashedNames()).toEqual(["Señor Chang's office", "Floor plan"]);
    const row = trashRow("Floor plan");
    expect(
      within(row).getByText("Drawings › Greendale › Study group"),
    ).toBeInTheDocument();
    expect(within(row).getByText("Deleted 3 days ago")).toBeInTheDocument();
    // it doesn't open from here
    expect(within(row).queryByRole("link")).toBe(null);
    const changRow = trashRow("Señor Chang's office");
    expect(within(changRow).getByText("Drawings")).toBeInTheDocument();
    expect(
      within(changRow).getByText("Deleted 2 hours ago"),
    ).toBeInTheDocument();
  });

  it("restores without asking, to the root when its folder is gone", async () => {
    // as when the folder went in another browser
    const lost = await store.createDrawing({
      folderId: "city-college" as FolderId,
      name: "Paintball map",
      content: savedContent("Paintball map", "pierce"),
    });
    await store.trash({ kind: "drawing", id: lost.id });
    await store.trash({ kind: "drawing", id: plan.id });
    await renderPageAt("/trash");

    expect(
      within(trashRow("Paintball map")).getByText("Drawings"),
    ).toBeInTheDocument();
    fireEvent.click(
      within(trashRow("Floor plan")).getByRole("button", { name: "Restore" }),
    );
    fireEvent.click(
      within(trashRow("Paintball map")).getByRole("button", {
        name: "Restore",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "The Trash is empty" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).toBe(null);
    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(lost.id)).toMatchObject({
        folderId: null,
        trashedAt: null,
      }),
    );
    expect(store.getSnapshot().drawings.get(plan.id)).toMatchObject({
      folderId: studyGroup.id,
      trashedAt: null,
    });
  });

  it("deletes an item forever once that's confirmed", async () => {
    await store.trash({ kind: "drawing", id: plan.id });
    workspace.clock.now += 1000;
    await store.trash({ kind: "drawing", id: chang.id });
    await renderPageAt("/trash");

    fireEvent.click(
      within(trashRow("Floor plan")).getByRole("button", {
        name: "Delete forever",
      }),
    );
    let dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Delete “Floor plan” forever?",
      }),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBe(null);
    expect(trashedNames()).toEqual(["Señor Chang's office", "Floor plan"]);
    expect(await store.getDrawingMeta(plan.id)).not.toBe(null);

    fireEvent.click(
      within(trashRow("Floor plan")).getByRole("button", {
        name: "Delete forever",
      }),
    );
    dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete forever" }),
    );

    await waitFor(() =>
      expect(trashedNames()).toEqual(["Señor Chang's office"]),
    );
    expect(await store.getDrawingMeta(plan.id)).toBe(null);
    expect(await store.loadDrawingContent(plan.id)).toBe(null);
  });

  it("empties once that's confirmed", async () => {
    await store.trash({ kind: "drawing", id: plan.id });
    workspace.clock.now += 1000;
    await store.trash({ kind: "folder", id: greendale.id });
    workspace.clock.now += 1000;
    await store.trash({ kind: "drawing", id: chang.id });
    await renderPageAt("/trash");

    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    let dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Empty the Trash?" }),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(trashedNames()).toEqual(["Señor Chang's office", "Greendale"]);

    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Empty trash" }),
    );

    expect(
      await screen.findByRole("heading", { name: "The Trash is empty" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Empty trash" })).toBe(null);
    await waitFor(async () =>
      expect(await workspace.countRecords()).toMatchObject({
        folders: 0,
        drawings: 0,
        contents: 0,
      }),
    );
  });

  it("says so when it can't restore or empty", async () => {
    vi.spyOn(LocalWorkspaceStore.prototype, "restore").mockRejectedValue(
      new DOMException("The disk is full", "QuotaExceededError"),
    );
    vi.spyOn(LocalWorkspaceStore.prototype, "emptyTrash").mockRejectedValue(
      new DOMException("The disk is full", "QuotaExceededError"),
    );
    await store.trash({ kind: "drawing", id: plan.id });
    await renderPageAt("/trash");

    fireEvent.click(
      within(trashRow("Floor plan")).getByRole("button", { name: "Restore" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't restore “Floor plan”.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Empty trash" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't empty the Trash.",
      ),
    );
    expect(trashedNames()).toEqual(["Floor plan"]);
  });

  it("holds what a trashed folder had, until it's restored", async () => {
    await renderPageAt("/");

    await chooseFromMenu("Actions for Greendale", "Move to Trash");

    await waitFor(() =>
      expect(screen.queryByRole("treeitem", { name: "Greendale" })).toBe(null),
    );
    expect(screen.queryByRole("region", { name: "Folders" })).toBe(null);
    fireEvent.click(screen.getByRole("link", { name: "Trash" }));
    await waitForPage("/trash", "Trash");
    expect(trashedNames()).toEqual(["Greendale"]);
    expect(
      within(trashRow("Greendale")).getByRole("button", {
        name: "Delete forever",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(trashRow("Greendale")).getByRole("button", { name: "Restore" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("treeitem", { name: "Greendale" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      within(screen.getByRole("tree", { name: "Folders" })).getByRole("link", {
        name: "Greendale",
      }),
    );
    await waitForPage(`/f/${greendale.id}`, "Greendale");
    fireEvent.click(card("Folders", "Study group"));
    await waitForPage(`/f/${studyGroup.id}`, "Study group");
    expect(
      within(screen.getByRole("region", { name: "Drawings" }))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Seating", "Floor plan"]);
  });

  it("lists what this device kept of drawings deleted elsewhere", async () => {
    const { content, view } = splitAppState({
      ...getDefaultAppState(),
      width: 800,
      height: 600,
      offsetTop: 0,
      offsetLeft: 0,
      name: "Dean's office",
    });
    const draft: AccountDraft = {
      id: "deleted-elsewhere" as DrawingId,
      baseRevision: 3,
      elements: savedContent("Dean's office", "pelton").elements,
      appState: { ...content, ...view },
      draftId: "britta",
      generation: "perry",
      updatedAt: Date.now() - 2 * DAY,
    };
    const account = Object.assign(store, {
      recoveryKey: "troy-barnes",
      recoveryStorage: window.localStorage,
      recoveryDrafts: {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue([draft]),
        list: vi.fn().mockResolvedValue([draft]),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    });
    vi.spyOn(workspaceStore, "openWorkspaceStore").mockResolvedValue(account);

    await renderPageAt("/trash");

    const list = await screen.findByRole("list", {
      name: "Recovered on this device",
    });
    const row = within(list).getByRole("listitem", { name: "Dean's office" });
    expect(within(row).getByText("Deleted elsewhere")).toBeInTheDocument();
    expect(within(row).getByText("Edited 2 days ago")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Open" }));
    await waitForDrawing(draft.id, ["pelton"]);
    expect(
      screen.getByRole("button", { name: "Save as a copy" }),
    ).toBeInTheDocument();
  });

  it("says when there's nothing in it", async () => {
    await renderPageAt("/trash");

    expect(
      screen.getByRole("heading", { name: "The Trash is empty" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Empty trash" })).toBe(null);
  });
});

describe("moving to the Trash from the editor", () => {
  it("saves the drawing, then shows its folder with Undo", async () => {
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

    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Move drawing to Trash" }),
    );

    await waitForPage(`/f/${studyGroup.id}`, "Study group");
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Moved “Floor plan” to Trash");
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Drawings" })).queryByRole(
          "link",
          { name: "Floor plan" },
        ),
      ).toBe(null),
    );
    await waitFor(() => expect(isTrashed(store, plan)).toBe(true));
    expect(
      (await store.loadDrawingContent(plan.id))?.elements.map(({ id }) => id),
    ).toEqual(["troy", "annie"]);

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(card("Drawings", "Floor plan")).toBeInTheDocument(),
    );
  });

  it("is in the command palette", async () => {
    await renderWebAppAt(`/d/${chang.id}`);
    await waitForDrawing(chang.id, ["chang"]);

    act(() => h.setState({ openDialog: { name: "commandPalette" } }));
    fireEvent.click(
      (await screen.findByText("Move drawing to Trash")).closest(
        ".command-item",
      )!,
    );

    await waitForPage("/", "Drawings");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Moved “Señor Chang's office” to Trash",
    );
  });

  it("trashes another drawing from the nav, with Undo over the editor", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    const list = screen.getByRole("treeitem", { name: "Study group" });

    fireEvent.click(
      within(list).getByRole("button", { name: "Actions for Seating" }),
    );
    fireEvent.click(
      within(await screen.findByTestId("dropdown-menu")).getByRole("menuitem", {
        name: "Move to Trash",
      }),
    );

    const toast = await screen.findByText("Moved “Seating” to Trash");
    // over the editor, which stays
    expect(toast.closest(".setsquare-container")).not.toBe(null);
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
    await waitFor(() =>
      expect(within(list).queryByRole("link", { name: /^Seating/ })).toBe(null),
    );
    await waitFor(() => expect(isTrashed(store, seating)).toBe(true));

    fireEvent.click(
      within(toast.closest(".workspace-toast") as HTMLElement).getByRole(
        "button",
        { name: "Undo" },
      ),
    );

    await waitFor(() =>
      expect(
        within(list).getByRole("link", { name: /^Seating/ }),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(isTrashed(store, seating)).toBe(false));
    expect(elementIds()).toEqual(["troy"]);
  });
});

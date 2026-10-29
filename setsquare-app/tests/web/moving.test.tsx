import { KEYS } from "@setsquare/common";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@setsquare/setsquare/tests/test-utils";

import {
  cleanUpWebApp,
  renderPageAt,
  savedContent,
  setUpTestWorkspace,
  waitForPage,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingMeta, Folder } from "../../workspace/types";

const card = (section: "Folders" | "Drawings", name: string) =>
  within(screen.getByRole("region", { name: section })).getByRole("link", {
    name,
  });

const openMoveDialog = async (name: string) => {
  fireEvent.click(
    within(screen.getByRole("main")).getByRole("button", {
      name: `Actions for ${name}`,
    }),
  );
  const menu = await screen.findByTestId("dropdown-menu");
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Move to…" }));
  return screen.findByRole("dialog");
};

// a folder of the dialog's tree, and the button that chooses it, after
// the toggle on its own row
const choice = (dialog: HTMLElement, name: string) => {
  const item = within(dialog).getByRole("treeitem", { name });
  const row = item.querySelector<HTMLElement>(":scope > .folder-tree__row")!;
  return { item, button: within(row).getAllByRole("button").at(-1)! };
};

// the polyfilled DataTransfer has no clearData or setDragImage
const dataTransfer = () => {
  const data = new Map<string, string>();
  return {
    data,
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    clearData: () => data.clear(),
    setDragImage: () => {},
  };
};

// whether the target lets the drop through, as a browser shows it
const allowsDrop = (target: Element, transfer: object) =>
  !fireEvent.dragOver(target, { dataTransfer: transfer });

let workspace: ReturnType<typeof setUpTestWorkspace>;
let store: LocalWorkspaceStore;
let greendale: Folder;
let studyGroup: Folder;
let paintball: Folder;
let plan: DrawingMeta;
let chang: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  store = await workspace.open();
  greendale = await store.createFolder(null, "Greendale");
  studyGroup = await store.createFolder(greendale.id, "Study group");
  paintball = await store.createFolder(null, "Paintball");
  plan = await store.createDrawing({
    folderId: studyGroup.id,
    name: "Floor plan",
    content: savedContent("Floor plan", "troy"),
  });
  chang = await store.createDrawing({
    folderId: null,
    name: "Señor Chang's office",
    content: savedContent("Señor Chang's office", "chang"),
  });
});

afterEach(() => cleanUpWebApp(workspace));

describe("Move to…", () => {
  it("moves a drawing to the folder chosen, the current one marked", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    const dialog = await openMoveDialog("Floor plan");

    expect(
      within(dialog).getByRole("heading", { name: "Move “Floor plan” to" }),
    ).toBeInTheDocument();
    const here = choice(dialog, "Study group");
    expect(here.item).toHaveAttribute("aria-selected", "true");
    expect(here.button).toHaveAttribute("aria-current", "location");
    expect(within(here.button).getByText("Current")).toBeInTheDocument();
    expect(choice(dialog, "Drawings").button).not.toHaveAttribute(
      "aria-current",
    );
    // it's there already
    const move = within(dialog).getByRole("button", { name: "Move" });
    expect(move).toBeDisabled();

    fireEvent.click(choice(dialog, "Paintball").button);

    expect(choice(dialog, "Paintball").item).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(move);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(plan.id)?.folderId).toBe(
        paintball.id,
      ),
    );
    expect(screen.queryByRole("region", { name: "Drawings" })).toBe(null);
  });

  it("moves a folder, never into itself or what's in it", async () => {
    await renderPageAt("/");

    const dialog = await openMoveDialog("Greendale");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Show what's in Greendale" }),
    );

    for (const name of ["Greendale", "Study group"]) {
      expect(choice(dialog, name).button).toBeDisabled();
    }
    expect(choice(dialog, "Paintball").button).toBeEnabled();
    expect(choice(dialog, "Drawings").button).toHaveAttribute(
      "aria-current",
      "location",
    );

    fireEvent.click(choice(dialog, "Paintball").button);
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() =>
      expect(store.getSnapshot().folders.get(greendale.id)?.parentId).toBe(
        paintball.id,
      ),
    );
    expect(store.getSnapshot().folders.get(studyGroup.id)?.parentId).toBe(
      greendale.id,
    );
  });

  it("makes a folder in the one chosen, to move into", async () => {
    await renderPageAt("/");

    const dialog = await openMoveDialog("Señor Chang's office");
    fireEvent.click(choice(dialog, "Paintball").button);
    fireEvent.click(within(dialog).getByRole("button", { name: "New folder" }));

    const field = await within(dialog).findByRole("textbox", {
      name: "Folder name",
    });
    expect(field).toHaveValue("New folder");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Troy and Abed" } });
    fireEvent.keyDown(field, { key: KEYS.ENTER });

    const made = await waitFor(() => {
      const folder = [...store.getSnapshot().folders.values()].find(
        (each) => each.name === "Troy and Abed",
      );
      expect(folder).toMatchObject({ parentId: paintball.id });
      return folder!;
    });
    expect(choice(dialog, "Troy and Abed").item).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(chang.id)?.folderId).toBe(
        made.id,
      ),
    );
  });

  it("leaves the item where it was when cancelled", async () => {
    await renderPageAt("/");

    const dialog = await openMoveDialog("Señor Chang's office");
    fireEvent.click(choice(dialog, "Paintball").button);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBe(null);
    expect(card("Drawings", "Señor Chang's office")).toBeInTheDocument();
    expect(store.getSnapshot().drawings.get(chang.id)?.folderId).toBe(null);
  });
});

describe("dragging cards", () => {
  it("moves a card dropped on a folder card or a breadcrumb", async () => {
    await renderPageAt("/");
    const transfer = dataTransfer();
    const target = card("Folders", "Paintball").closest("li")!;

    fireEvent.dragStart(card("Drawings", "Señor Chang's office"), {
      dataTransfer: transfer,
    });

    // the link's address doesn't go with it
    expect([...transfer.data.keys()]).toEqual(["application/x-setsquare-item"]);
    expect(allowsDrop(target, transfer)).toBe(true);
    expect(target).toHaveClass("workspace-drop");
    fireEvent.drop(target, { dataTransfer: transfer });

    expect(target).not.toHaveClass("workspace-drop");
    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(chang.id)?.folderId).toBe(
        paintball.id,
      ),
    );

    fireEvent.click(card("Folders", "Greendale"));
    await waitForPage(`/f/${greendale.id}`, "Greendale");
    fireEvent.click(card("Folders", "Study group"));
    await waitForPage(`/f/${studyGroup.id}`, "Study group");
    const crumb = within(
      screen.getByRole("navigation", { name: "Breadcrumbs" }),
    ).getByRole("link", { name: "Drawings" });

    fireEvent.dragStart(card("Drawings", "Floor plan"), {
      dataTransfer: transfer,
    });
    expect(allowsDrop(crumb, transfer)).toBe(true);
    fireEvent.drop(crumb, { dataTransfer: transfer });

    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(plan.id)?.folderId).toBe(null),
    );
  });

  it("refuses a folder dropped into itself or what's in it", async () => {
    await renderPageAt("/");
    const tree = screen.getByRole("tree", { name: "Folders" });
    fireEvent.click(
      within(tree).getByRole("button", { name: "Show what's in Greendale" }),
    );
    const transfer = dataTransfer();

    fireEvent.dragStart(card("Folders", "Greendale"), {
      dataTransfer: transfer,
    });

    const inside = within(tree).getByRole("link", { name: "Study group" });
    expect(allowsDrop(inside, transfer)).toBe(false);
    expect(inside).not.toHaveClass("workspace-drop");
    expect(
      allowsDrop(
        within(tree).getByRole("link", { name: "Greendale" }),
        transfer,
      ),
    ).toBe(false);
    expect(
      allowsDrop(card("Folders", "Greendale").closest("li")!, transfer),
    ).toBe(false);
    // where it is already
    expect(
      allowsDrop(
        within(
          screen.getByRole("navigation", { name: "Drawings and folders" }),
        ).getByRole("link", { name: "Drawings" }),
        transfer,
      ),
    ).toBe(false);
    fireEvent.drop(inside, { dataTransfer: transfer });
    fireEvent.dragEnd(card("Folders", "Greendale"), { dataTransfer: transfer });

    const paintballLink = within(tree).getByRole("link", { name: "Paintball" });
    fireEvent.dragStart(card("Folders", "Greendale"), {
      dataTransfer: transfer,
    });
    expect(allowsDrop(paintballLink, transfer)).toBe(true);
    fireEvent.dragEnd(card("Folders", "Greendale"), { dataTransfer: transfer });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(store.getSnapshot().folders.get(greendale.id)?.parentId).toBe(null);
  });

  it("trashes a card dropped on Trash, with Undo", async () => {
    await renderPageAt("/");
    const transfer = dataTransfer();
    const trash = within(
      screen.getByRole("navigation", { name: "Drawings and folders" }),
    ).getByRole("link", { name: "Trash" });

    fireEvent.dragStart(card("Drawings", "Señor Chang's office"), {
      dataTransfer: transfer,
    });
    expect(allowsDrop(trash, transfer)).toBe(true);
    fireEvent.drop(trash, { dataTransfer: transfer });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Moved “Señor Chang's office” to Trash",
    );
    expect(screen.queryByRole("region", { name: "Drawings" })).toBe(null);
    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(chang.id)?.trashedAt).not.toBe(
        null,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(card("Drawings", "Señor Chang's office")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("status")).toBe(null);
  });
});

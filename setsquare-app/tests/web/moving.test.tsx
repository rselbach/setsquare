import { KEYS } from "@setsquare/common";
import * as filesystem from "@setsquare/setsquare/data/filesystem";
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@setsquare/setsquare/tests/test-utils";

import { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";

import {
  cleanUpWebApp,
  findToast,
  renderPageAt,
  savedContent,
  setUpTestWorkspace,
  toastRegion,
  waitForPage,
} from "./helpers";

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

// the radio that chooses a folder of the dialog's tree
const choice = (dialog: HTMLElement, name: string) =>
  within(within(dialog).getByRole("radiogroup", { name: "Folders" })).getByRole(
    "radio",
    { name },
  );

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

    expect(screen.getByRole("dialog", { name: "Move “Floor plan” to" })).toBe(
      dialog,
    );
    const here = choice(dialog, "Study group");
    expect(here).toBeChecked();
    expect(here).toHaveFocus();
    expect(here).toHaveAccessibleDescription("Current");
    expect(choice(dialog, "Drawings")).not.toHaveAccessibleDescription();
    // it's there already
    const move = within(dialog).getByRole("button", { name: "Move" });
    expect(move).toBeDisabled();

    fireEvent.click(choice(dialog, "Paintball"));

    expect(choice(dialog, "Paintball")).toBeChecked();
    expect(here).not.toBeChecked();
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
      expect(choice(dialog, name)).toBeDisabled();
    }
    expect(choice(dialog, "Paintball")).toBeEnabled();
    expect(choice(dialog, "Drawings")).toHaveAccessibleDescription("Current");

    fireEvent.click(choice(dialog, "Paintball"));
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
    fireEvent.click(choice(dialog, "Paintball"));
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
    expect(choice(dialog, "Troy and Abed")).toBeChecked();
    // still in the dialog, so Tab and Escape keep to it
    expect(choice(dialog, "Troy and Abed")).toHaveFocus();
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
    fireEvent.click(choice(dialog, "Paintball"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBe(null);
    expect(card("Drawings", "Señor Chang's office")).toBeInTheDocument();
    expect(store.getSnapshot().drawings.get(chang.id)?.folderId).toBe(null);
  });

  it("gives the focus back to the ⋯ button it was opened from", async () => {
    await renderPageAt("/");
    const more = () =>
      within(screen.getByRole("main")).getByRole("button", {
        name: "Actions for Señor Chang's office",
      });

    let dialog = await openMoveDialog("Señor Chang's office");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(more()).toHaveFocus());

    dialog = await openMoveDialog("Señor Chang's office");
    fireEvent.keyDown(dialog, { key: KEYS.ESCAPE });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
    await waitFor(() => expect(more()).toHaveFocus());

    // or once the card's gone from the page, to a card that's left
    dialog = await openMoveDialog("Señor Chang's office");
    fireEvent.click(choice(dialog, "Paintball"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));

    expect(screen.queryByRole("region", { name: "Drawings" })).toBe(null);
    expect(document.activeElement).toBe(
      within(screen.getByRole("region", { name: "Folders" })).getAllByRole(
        "link",
      )[0],
    );
  });

  it("gives the page's heading the focus when the last card moves away", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    const dialog = await openMoveDialog("Floor plan");
    fireEvent.click(choice(dialog, "Paintball"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Study group" }),
      ).toHaveFocus(),
    );
  });

  it("gives the page's heading the focus when the last card is trashed", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    fireEvent.click(
      within(screen.getByRole("main")).getByRole("button", {
        name: "Actions for Floor plan",
      }),
    );
    fireEvent.click(
      within(await screen.findByTestId("dropdown-menu")).getByRole("menuitem", {
        name: "Move to Trash",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Study group" }),
      ).toHaveFocus(),
    );
    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(plan.id)?.trashedAt).not.toBe(
        null,
      ),
    );
  });

  it("keeps the page's shortcuts from acting behind it", async () => {
    const fileOpen = vi.spyOn(filesystem, "fileOpen");
    await renderPageAt("/");
    fireEvent.keyDown(card("Drawings", "Señor Chang's office"), {
      key: KEYS.DELETE,
    });
    await findToast("Moved “Señor Chang's office” to Trash");

    const dialog = await openMoveDialog("Paintball");
    const here = choice(dialog, "Drawings");
    expect(here).toHaveFocus();

    expect(fireEvent.keyDown(here, { key: "/" })).toBe(true);
    expect(here).toHaveFocus();
    expect(
      fireEvent.keyDown(here, { key: "z", [KEYS.CTRL_OR_CMD]: true }),
    ).toBe(true);
    // nor the browser's own Open file, in place of the app
    expect(
      fireEvent.keyDown(here, { key: KEYS.O, [KEYS.CTRL_OR_CMD]: true }),
    ).toBe(false);

    expect(toastRegion()).not.toBeEmptyDOMElement();
    expect(store.getSnapshot().drawings.get(chang.id)?.trashedAt).not.toBe(
      null,
    );
    expect(fileOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("closes when another tab moves the item to the trash", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    await openMoveDialog("Floor plan");
    await store.trash({ kind: "folder", id: studyGroup.id });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
    expect(store.getSnapshot().drawings.get(plan.id)?.folderId).toBe(
      studyGroup.id,
    );

    await openMoveDialog("Señor Chang's office");
    await store.trash({ kind: "drawing", id: chang.id });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBe(null));
    expect(store.getSnapshot().drawings.get(chang.id)?.folderId).toBe(null);
  });

  it("stays open and says why when the folder chosen went to the Trash", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);
    const move = LocalWorkspaceStore.prototype.move;
    // another tab trashes it just before this one's move reaches the
    // database, which this tab hasn't heard of yet
    vi.spyOn(LocalWorkspaceStore.prototype, "move").mockImplementationOnce(
      async function (this: LocalWorkspaceStore, ...args) {
        await store.trash({ kind: "folder", id: paintball.id });
        return move.apply(this, args);
      },
    );

    const dialog = await openMoveDialog("Floor plan");
    fireEvent.click(choice(dialog, "Paintball"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));

    await findToast("That folder is in the Trash now.", "error");
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(store.getSnapshot().drawings.get(plan.id)?.folderId).toBe(
      studyGroup.id,
    );
  });

  it("goes back to the item's folder when the one chosen goes", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    const dialog = await openMoveDialog("Floor plan");
    fireEvent.click(choice(dialog, "Paintball"));
    await store.trash({ kind: "folder", id: paintball.id });

    await waitFor(() =>
      expect(within(dialog).queryByRole("radio", { name: "Paintball" })).toBe(
        null,
      ),
    );
    expect(choice(dialog, "Study group")).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Move" })).toBeDisabled();
  });
});

describe("dragging cards", () => {
  it("says why when a dropped card can't move", async () => {
    await renderPageAt("/");
    vi.spyOn(LocalWorkspaceStore.prototype, "move").mockResolvedValueOnce({
      ok: false,
      reason: "targetTrashed",
    });
    const transfer = dataTransfer();
    const target = card("Folders", "Paintball").closest("li")!;

    fireEvent.dragStart(card("Drawings", "Señor Chang's office"), {
      dataTransfer: transfer,
    });
    fireEvent.drop(target, { dataTransfer: transfer });

    await findToast("That folder is in the Trash now.", "error");
    expect(store.getSnapshot().drawings.get(chang.id)?.folderId).toBe(null);
  });

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
    const tree = screen.getByRole("list", { name: "Folders" });
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

    await findToast("Moved “Señor Chang's office” to Trash");
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
    expect(toastRegion()).toBeEmptyDOMElement();
  });
});

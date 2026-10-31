import { KEYS, MIME_TYPES } from "@setsquare/common";
import * as filesystem from "@setsquare/setsquare/data/filesystem";
import { serializeAsJSON } from "@setsquare/setsquare/data/json";
import { t } from "@setsquare/setsquare/i18n";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import {
  act,
  fireEvent,
  screen,
  unmountComponent,
  waitFor,
  within,
} from "@setsquare/setsquare/tests/test-utils";

import type { DataURL } from "@setsquare/setsquare/types";

import { STORAGE_KEYS } from "../../app_constants";
import { LibraryIndexedDBAdapter } from "../../data/LocalData";

import { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";

import {
  cleanUpWebApp,
  findToast,
  toastRegion,
  renderPageAt,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForDrawing,
  waitForPage,
} from "./helpers";

import type { DrawingMeta, Folder } from "../../workspace/types";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" as DataURL;

const { h, innerWidth, innerHeight } = window;

// the names on the cards of a section, in order
const cardNames = (section: "Folders" | "Drawings") =>
  within(screen.getByRole("region", { name: section }))
    .getAllByRole("link")
    .map((link) => link.textContent);

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
  return menu;
};

const searchBox = () =>
  screen.getByRole("searchbox", { name: "Search drawings" });

// pressing it returns false once something prevents its default
const pressOpen = () =>
  fireEvent.keyDown(document, { key: KEYS.O, ctrlKey: true });

const sceneFile = (name: string, ...ids: string[]) =>
  new File(
    [
      serializeAsJSON(
        ids.map((id) => API.createElement({ type: "rectangle", id })),
        {},
        {},
        "local",
      ),
    ],
    `${name}.setsquare`,
    { type: MIME_TYPES.setsquare },
  );

const newDrawingIn = (store: LocalWorkspaceStore, ...kept: DrawingMeta[]) =>
  waitFor(() => {
    const created = [...store.getSnapshot().drawings.values()].filter(
      (drawing) => !kept.some((each) => each.id === drawing.id),
    );
    expect(created).toHaveLength(1);
    return created[0];
  });

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
  workspace.clock.now += 1000;
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
  workspace.clock.now += 1000;
  chang = await store.createDrawing({
    folderId: null,
    name: "Señor Chang's office",
    content: savedContent("Señor Chang's office", "chang"),
  });
});

afterEach(async () => {
  Object.assign(window, { innerWidth, innerHeight });
  delete (window as any).launchQueue;
  await cleanUpWebApp(workspace);
});

describe("the workspace page", () => {
  it("shows a folder under its breadcrumbs, folders first", async () => {
    const paintball = await store.createFolder(studyGroup.id, "Paintball");

    await renderPageAt(`/f/${studyGroup.id}`);

    await waitForPage(`/f/${studyGroup.id}`, "Study group");
    const crumbs = within(
      screen.getByRole("navigation", { name: "Breadcrumbs" }),
    ).getAllByRole("link");
    expect(
      crumbs.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Drawings", "/"],
      ["Greendale", `/f/${greendale.id}`],
    ]);
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Folders", "Drawings"]);
    expect(cardNames("Folders")).toEqual(["Paintball"]);
    expect(cardNames("Drawings")).toEqual(["Seating", "Floor plan"]);
    for (const name of ["Greendale", "Study group"]) {
      expect(
        screen.getByRole("button", { name: `Hide what's in ${name}` }),
      ).toHaveAttribute("aria-expanded", "true");
    }

    fireEvent.click(crumbs[1]);

    await waitForPage(`/f/${greendale.id}`, "Greendale");
    expect(cardNames("Folders")).toEqual(["Study group"]);
    expect(screen.queryByRole("region", { name: "Drawings" })).toBe(null);

    fireEvent.click(card("Folders", "Study group"));
    await waitForPage(`/f/${studyGroup.id}`, "Study group");
    fireEvent.click(card("Folders", "Paintball"));
    await waitForPage(`/f/${paintball.id}`, "Paintball");
  });

  it("has cards that are links, so they can open in a new tab", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    expect(card("Drawings", "Floor plan")).toHaveAttribute(
      "href",
      `/d/${plan.id}`,
    );
    // a modified click is the browser's; jsdom can't open the tab itself
    const afterLink = vi.fn((event: MouseEvent) => event.preventDefault());
    document.addEventListener("click", afterLink);
    fireEvent.click(card("Drawings", "Floor plan"), { metaKey: true });
    document.removeEventListener("click", afterLink);
    expect(afterLink.mock.calls[0][0].defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe(`/f/${studyGroup.id}`);

    fireEvent.click(card("Drawings", "Floor plan"));

    await waitForDrawing(plan.id, ["troy"]);
  });

  it("opens and collapses folders in the tree", async () => {
    await store.createFolder(studyGroup.id, "Paintball");
    await renderPageAt("/");

    const tree = screen.getByRole("list", { name: "Folders" });
    const toggle = within(tree).getByRole("button", {
      name: "Show what's in Greendale",
    });
    const groupId = toggle.getAttribute("aria-controls")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(groupId)).toBe(null);
    expect(within(tree).queryByRole("link", { name: "Study group" })).toBe(
      null,
    );

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide what's in Greendale");
    const group = document.getElementById(groupId)!;
    expect(group).toHaveRole("list");
    fireEvent.click(within(group).getByRole("link", { name: "Study group" }));
    await waitForPage(`/f/${studyGroup.id}`, "Study group");
    expect(
      within(tree).getByRole("link", { name: "Study group" }),
    ).toHaveAttribute("aria-current", "page");
    expect(tree.querySelector("[aria-selected]")).toBe(null);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(groupId)).toBe(null);
  });

  it("shows thumbnails, and a blank sheet for a drawing without one", async () => {
    await store.saveThumbnail(plan.id, { src: PIXEL, revision: 1 });

    await renderPageAt(`/f/${studyGroup.id}`);

    const planCard = card("Drawings", "Floor plan").closest("li")!;
    const seatingCard = card("Drawings", "Seating").closest("li")!;
    await waitFor(() =>
      expect(planCard.querySelector("img")).toHaveAttribute("src", PIXEL),
    );
    expect(seatingCard.querySelector("img")).toBe(null);
    expect(seatingCard.querySelector(".drawing-card__blank")).not.toBe(null);

    // as when another tab empties the drawing
    await act(async () => {
      await store.saveDrawingContent(plan.id, savedContent("Floor plan"), []);
      await store.deleteThumbnail(plan.id);
    });

    await waitFor(() => expect(planCard.querySelector("img")).toBe(null));
  });

  it("creates a drawing in the folder shown and opens it", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    fireEvent.click(screen.getByRole("button", { name: "New drawing" }));

    const created = await newDrawingIn(store, plan, seating, chang);
    expect(created).toMatchObject({ folderId: studyGroup.id, name: null });
    await waitForDrawing(created.id, []);
  });

  it("creates a folder in the folder shown, named to rename", async () => {
    await store.createFolder(studyGroup.id, "New folder");
    await renderPageAt(`/f/${studyGroup.id}`);

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));

    const field = await screen.findByRole("textbox", { name: "Folder name" });
    expect(field).toHaveValue("New folder 2");
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Paintball" } });
    fireEvent.keyDown(field, { key: KEYS.ENTER });

    await waitFor(() => expect(card("Folders", "Paintball")).toHaveFocus());
    // this store hears of the app's changes a moment later
    await waitFor(() =>
      expect(
        [...store.getSnapshot().folders.values()]
          .filter((folder) => folder.parentId === studyGroup.id)
          .map((folder) => folder.name)
          .sort(),
      ).toEqual(["New folder", "Paintball"]),
    );
  });

  it("renames a drawing in place, and Escape leaves it", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    fireEvent.keyDown(card("Drawings", "Floor plan"), { key: "F2" });
    let field = screen.getByRole("textbox", { name: "Drawing name" });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Paintball map" } });
    fireEvent.keyDown(field, { key: KEYS.ESCAPE });

    expect(card("Drawings", "Floor plan")).toHaveFocus();
    expect(store.getSnapshot().drawings.get(plan.id)?.name).toBe("Floor plan");

    fireEvent.click(
      within(screen.getByRole("main")).getByRole("button", {
        name: "Actions for Floor plan",
      }),
    );
    const menu = await screen.findByTestId("dropdown-menu");
    // the editor's menu, on the page
    expect(menu.closest(".setsquare-workspace")).not.toBe(null);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    field = await screen.findByRole("textbox", { name: "Drawing name" });
    fireEvent.change(field, { target: { value: "Paintball map" } });
    act(() => field.blur());

    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(plan.id)?.name).toBe(
        "Paintball map",
      ),
    );
    expect(card("Drawings", "Paintball map")).toBeInTheDocument();

    fireEvent.keyDown(card("Drawings", "Paintball map"), { key: "F2" });
    field = screen.getByRole("textbox", { name: "Drawing name" });
    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.keyDown(field, { key: KEYS.ENTER });

    await waitFor(() =>
      expect(store.getSnapshot().drawings.get(plan.id)?.name).toBe(null),
    );
    expect(card("Drawings", "Untitled")).toBeInTheDocument();
  });

  it("renames a folder in place, but never to nothing", async () => {
    await renderPageAt("/");

    await chooseFromMenu("Actions for Greendale", "Rename");
    let field = await screen.findByRole("textbox", { name: "Folder name" });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.keyDown(field, { key: KEYS.ENTER });

    expect(card("Folders", "Greendale")).toBeInTheDocument();
    expect(store.getSnapshot().folders.get(greendale.id)?.name).toBe(
      "Greendale",
    );

    fireEvent.keyDown(card("Folders", "Greendale"), { key: "F2" });
    field = screen.getByRole("textbox", { name: "Folder name" });
    fireEvent.change(field, { target: { value: "Greendale CC" } });
    fireEvent.keyDown(field, { key: KEYS.ESCAPE });
    expect(store.getSnapshot().folders.get(greendale.id)?.name).toBe(
      "Greendale",
    );

    fireEvent.keyDown(card("Folders", "Greendale"), { key: "F2" });
    field = screen.getByRole("textbox", { name: "Folder name" });
    fireEvent.change(field, { target: { value: "Greendale CC" } });
    fireEvent.keyDown(field, { key: KEYS.ENTER });

    await waitFor(() =>
      expect(store.getSnapshot().folders.get(greendale.id)?.name).toBe(
        "Greendale CC",
      ),
    );
  });

  it("duplicates a drawing next to it", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    await chooseFromMenu("Actions for Seating", "Duplicate");

    const copy = await newDrawingIn(store, plan, seating, chang);
    expect(copy).toMatchObject({
      name: "Seating copy",
      folderId: studyGroup.id,
    });
    expect(window.location.pathname).toBe(`/f/${studyGroup.id}`);
  });

  it("says so when a rename meets a change from elsewhere", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);
    vi.spyOn(LocalWorkspaceStore.prototype, "renameDrawing").mockResolvedValue({
      ok: false,
      reason: "conflict",
      meta: plan,
    });

    fireEvent.keyDown(card("Drawings", "Floor plan"), { key: "F2" });
    const field = screen.getByRole("textbox", { name: "Drawing name" });
    fireEvent.change(field, { target: { value: "Paintball map" } });
    fireEvent.keyDown(field, { key: KEYS.ENTER });

    await findToast("“Paintball map” changed elsewhere. Try again.", "error");
  });

  it("gives the focus back to the button of a menu once it closes", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);
    const more = within(screen.getByRole("main")).getByRole("button", {
      name: "Actions for Seating",
    });

    fireEvent.click(more);
    fireEvent.keyDown(await screen.findByTestId("dropdown-menu"), {
      key: KEYS.ESCAPE,
    });
    await waitFor(() => expect(more).toHaveFocus());

    await chooseFromMenu("Actions for Seating", "Duplicate");
    await waitFor(() => expect(more).toHaveFocus());

    await chooseFromMenu("Sort Last edited", "Name");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sort Name" })).toHaveFocus(),
    );
  });

  it("says so when it can't duplicate a drawing", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);
    vi.spyOn(
      LocalWorkspaceStore.prototype,
      "duplicateDrawing",
    ).mockRejectedValue(
      new DOMException("The disk is full", "QuotaExceededError"),
    );

    await chooseFromMenu("Actions for Seating", "Duplicate");

    await findToast("Couldn't duplicate “Seating”.", "error");
  });

  it("searches the whole workspace, showing where each item is", async () => {
    await renderPageAt("/");

    fireEvent.keyDown(document.body, { key: "/" });

    expect(searchBox()).toHaveFocus();
    fireEvent.change(searchBox(), { target: { value: "SEAT" } });
    expect(
      screen.getByRole("heading", { level: 1, name: "Search results" }),
    ).toBeInTheDocument();
    expect(cardNames("Drawings")).toEqual(["Seating"]);
    expect(
      within(card("Drawings", "Seating").closest("li")!).getByText(
        "Drawings › Greendale › Study group",
      ),
    ).toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: "study" } });
    expect(cardNames("Folders")).toEqual(["Study group"]);
    expect(
      within(card("Folders", "Study group").closest("li")!).getByText(
        "Drawings › Greendale",
      ),
    ).toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: "Pierce" } });
    expect(
      screen.getByRole("heading", { name: "Nothing is named like “Pierce”" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(searchBox(), { key: KEYS.ESCAPE });

    expect(searchBox()).toHaveValue("");
    expect(searchBox()).toHaveFocus();
    expect(cardNames("Folders")).toEqual(["Greendale"]);
    fireEvent.keyDown(searchBox(), { key: KEYS.ESCAPE });
    expect(searchBox()).not.toHaveFocus();
  });

  it("creates at the root while searching", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);
    fireEvent.change(searchBox(), { target: { value: "Seat" } });

    fireEvent.click(screen.getByRole("button", { name: "New drawing" }));

    const created = await newDrawingIn(store, plan, seating, chang);
    expect(created.folderId).toBe(null);
    await waitForDrawing(created.id, []);
  });

  it("sorts by name or last edit, and remembers which", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);
    expect(cardNames("Drawings")).toEqual(["Seating", "Floor plan"]);

    await chooseFromMenu("Sort Last edited", "Name");

    expect(cardNames("Drawings")).toEqual(["Floor plan", "Seating"]);
    expect(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE_SORT),
    ).toBe("name");

    unmountComponent();
    await renderPageAt(`/f/${studyGroup.id}`);

    expect(cardNames("Drawings")).toEqual(["Floor plan", "Seating"]);
    expect(
      screen.getByRole("button", { name: "Sort Name" }),
    ).toBeInTheDocument();
  });

  it("lists the drawings used last under Recent, with their folders", async () => {
    workspace.clock.now += 1000;
    await store.openDrawing(plan.id);

    await renderPageAt("/recent");

    await waitForPage("/recent", "Recent");
    expect(screen.queryByRole("region", { name: "Folders" })).toBe(null);
    expect(cardNames("Drawings")).toEqual([
      "Floor plan",
      "Señor Chang's office",
      "Seating",
    ]);
    expect(
      within(card("Drawings", "Señor Chang's office").closest("li")!).getByText(
        "Drawings",
      ),
    ).toBeInTheDocument();
    // in the order they were used
    expect(screen.queryByRole("button", { name: /^Sort/ })).toBe(null);
    expect(
      within(
        screen.getByRole("navigation", { name: "Drawings and folders" }),
      ).getByRole("link", { name: "Recent" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("creates a folder from Recent at the root, to rename there", async () => {
    await renderPageAt("/recent");

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));

    await waitForPage("/", "Drawings");
    const field = await screen.findByRole("textbox", { name: "Folder name" });
    expect(field).toHaveValue("New folder");
    // this store hears of the app's changes a moment later
    await waitFor(() =>
      expect(
        [...store.getSnapshot().folders.values()].find(
          (each) => each.name === "New folder",
        ),
      ).toMatchObject({ parentId: null }),
    );
  });

  it("goes to the root from a folder in the Trash", async () => {
    await store.trash({ kind: "folder", id: greendale.id });

    await renderPageAt(`/f/${studyGroup.id}`);

    await waitForPage("/", "Drawings");
    expect(cardNames("Drawings")).toEqual(["Señor Chang's office"]);
    expect(screen.queryByRole("region", { name: "Folders" })).toBe(null);
  });

  it("hides the nav beside the page, and remembers it", async () => {
    const { unmount } = await renderPageAt(`/f/${studyGroup.id}`);
    const show = screen.getByRole("button", { name: "Show sidebar" });
    const shell = () => document.querySelector(".workspace-shell");
    expect(show).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

    expect(shell()).toHaveClass("workspace-shell--nav-hidden");
    expect(show).toHaveAttribute("aria-expanded", "false");

    unmount();
    await renderPageAt(`/f/${studyGroup.id}`);

    expect(shell()).toHaveClass("workspace-shell--nav-hidden");
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(shell()).not.toHaveClass("workspace-shell--nav-hidden");
    expect(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE_NAV_HIDDEN),
    ).toBe("false");
  });

  it("opens the nav as a drawer below 900 px, which closes when it's used", async () => {
    Object.assign(window, { innerWidth: 800 });
    await renderPageAt(`/f/${studyGroup.id}`);
    const toggle = screen.getByRole("button", { name: "Show sidebar" });
    const nav = screen.getByRole("navigation", {
      name: "Drawings and folders",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    const main = document.querySelector(".workspace-shell__main");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(nav).toHaveClass("workspace-nav--open");
    // like a modal dialog, over a page that can't be reached
    expect(
      within(nav).getByRole("button", { name: "Hide sidebar" }),
    ).toHaveFocus();
    expect(main).toHaveAttribute("inert");
    fireEvent.keyDown(document.activeElement!, { key: KEYS.ESCAPE });
    expect(nav).not.toHaveClass("workspace-nav--open");
    expect(toggle).toHaveFocus();
    expect(main).not.toHaveAttribute("inert");

    fireEvent.click(toggle);
    fireEvent.click(within(nav).getByRole("button", { name: "Hide sidebar" }));
    expect(nav).not.toHaveClass("workspace-nav--open");
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    fireEvent.click(within(nav).getByRole("link", { name: "Recent" }));

    await waitForPage("/recent", "Recent");
    expect(nav).not.toHaveClass("workspace-nav--open");
  });
});

describe("the workspace page on a phone", () => {
  beforeEach(() => {
    Object.assign(window, { innerWidth: 390, innerHeight: 844 });
  });

  it("goes back a folder, and folds creating into a + menu", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    expect(
      screen.getByRole("main").closest(".setsquare-workspace"),
    ).toHaveClass("setsquare--mobile");
    expect(screen.queryByRole("button", { name: "New drawing" })).toBe(null);
    expect(
      screen.getByRole("link", { name: "Back to Greendale" }),
    ).toHaveAttribute("href", `/f/${greendale.id}`);

    const menu = await chooseFromMenu("Create", "New folder");

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["New drawing", "New folder", "Open file…"]);
    expect(
      await screen.findByRole("textbox", { name: "Folder name" }),
    ).toHaveValue("New folder");
  });

  it("opens the search from its icon and the nav as a drawer", async () => {
    await renderPageAt("/");
    expect(screen.queryByRole("searchbox")).toBe(null);

    fireEvent.click(screen.getByRole("button", { name: "Search drawings" }));

    await waitFor(() => expect(searchBox()).toHaveFocus());
    fireEvent.change(searchBox(), { target: { value: "seat" } });
    expect(cardNames("Drawings")).toEqual(["Seating"]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("searchbox")).toBe(null);

    const toggle = screen.getByRole("button", { name: "Show sidebar" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("navigation", { name: "Drawings and folders" }),
    ).toHaveClass("workspace-nav--open");
  });
});

describe("an empty workspace page", () => {
  beforeEach(async () => {
    for (const drawing of [plan, seating, chang]) {
      await store.deleteForever({ kind: "drawing", id: drawing.id });
    }
  });

  it("offers to start a drawing, which stays in this browser", async () => {
    await store.deleteForever({ kind: "folder", id: greendale.id });
    await renderPageAt("/");

    expect(
      screen.getByRole("heading", { name: "No drawings yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Drawings stay in this browser\./),
    ).toBeInTheDocument();

    const empty = screen
      .getByRole("heading", { name: "No drawings yet" })
      .closest("div")!;
    fireEvent.click(within(empty).getByRole("button", { name: "New drawing" }));

    const created = await newDrawingIn(store);
    expect(created.folderId).toBe(null);
    await waitForDrawing(created.id, []);
  });

  it("says when a folder or Recent has nothing", async () => {
    await renderPageAt(`/f/${studyGroup.id}`);

    expect(
      screen.getByRole("heading", { name: "This folder is empty" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Recent" }));

    await waitForPage("/recent", "Recent");
    expect(
      screen.getByRole("heading", { name: "No recent drawings" }),
    ).toBeInTheDocument();
  });
});

describe("opening files from the workspace page", () => {
  it("opens a file as a new drawing in the folder shown", async () => {
    vi.spyOn(filesystem, "fileOpen").mockResolvedValue(
      sceneFile("Study room", "annie") as any,
    );
    await renderPageAt(`/f/${studyGroup.id}`);

    fireEvent.click(screen.getByRole("button", { name: "Open file…" }));

    const created = await newDrawingIn(store, plan, seating, chang);
    expect(created).toMatchObject({
      name: "Study room",
      folderId: studyGroup.id,
    });
    await waitForDrawing(created.id, ["annie"]);
  });

  it("says on the page when Cmd+O opens what isn't a drawing", async () => {
    vi.spyOn(filesystem, "fileOpen").mockResolvedValue(
      new File(["Señor Chang"], "notes.txt", { type: "text/plain" }) as any,
    );
    await renderPageAt("/");

    expect(pressOpen()).toBe(false);

    const toast = await findToast(t("alerts.couldNotLoadInvalidFile"), "error");
    expect(window.location.pathname).toBe("/");
    expect(store.getSnapshot().drawings.size).toBe(3);

    fireEvent.click(within(toast).getByRole("button", { name: "Close" }));
    expect(toastRegion("error")).toBeEmptyDOMElement();
  });

  it("says on the page which launched file couldn't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(window, {
      launchQueue: {
        setConsumer: (consumer: (params: { files: unknown[] }) => void) =>
          consumer({
            files: [
              {
                kind: "file",
                name: "abed.setsquare",
                getFile: () => Promise.reject(new Error("permission denied")),
              },
            ],
          }),
      },
    });

    await renderPageAt("/");

    await findToast(
      t("errors.openFileError", { name: "abed.setsquare" }),
      "error",
    );
    expect(window.location.pathname).toBe("/");
  });

  it("says it on the notice when the drawing it waited for is gone", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(window, {
      launchQueue: {
        setConsumer: (consumer: (params: { files: unknown[] }) => void) =>
          consumer({
            files: [
              {
                kind: "file",
                name: "abed.setsquare",
                getFile: () => Promise.reject(new Error("permission denied")),
              },
            ],
          }),
      },
    });

    await renderPageAt("/d/pierce");

    expect(
      screen.getByRole("heading", { name: "This drawing isn't here" }),
    ).toBeInTheDocument();
    await findToast(
      t("errors.openFileError", { name: "abed.setsquare" }),
      "error",
    );
  });

  it("adds a library to the element library without an editor", async () => {
    vi.spyOn(filesystem, "fileOpen").mockResolvedValue(
      (await API.loadFile("./fixtures/fixture_library.setsquarelib")) as any,
    );
    await renderPageAt("/");

    pressOpen();

    await findToast("Added to your library");
    expect((await LibraryIndexedDBAdapter.load())?.libraryItems).toHaveLength(
      1,
    );
    await LibraryIndexedDBAdapter.save({ libraryItems: [] });
  });
});

describe("All drawings", () => {
  it("goes from the editor to the drawing's folder", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "All drawings" }),
    );

    await waitForPage(`/f/${studyGroup.id}`, "Study group");
    expect(cardNames("Drawings")).toEqual(["Seating", "Floor plan"]);
  });

  it("is in the command palette", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    act(() => h.setState({ openDialog: { name: "commandPalette" } }));
    fireEvent.click(
      (await screen.findByText("All drawings")).closest(".command-item")!,
    );

    await waitForPage(`/f/${studyGroup.id}`, "Study group");
  });

  it("goes to the root when the drawing's folder is in the Trash", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    await act(() => store.trash({ kind: "folder", id: greendale.id }));

    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "All drawings" }),
    );

    await waitForPage("/", "Drawings");
  });
});

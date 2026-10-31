import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@setsquare/setsquare/tests/test-utils";

import {
  useDragSource,
  useDropTarget,
} from "../../workspace/ui/useWorkspaceDrag";

import { cleanUpWebApp, renderPageAt, setUpTestWorkspace } from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingMeta, Folder } from "../../workspace/types";

// each card calls useDragSource once as it renders, and each place to drop
// calls useDropTarget once, so their calls count renders
vi.mock("../../workspace/ui/useWorkspaceDrag", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../workspace/ui/useWorkspaceDrag")
    >();
  return {
    ...actual,
    useDragSource: vi.fn(actual.useDragSource),
    useDropTarget: vi.fn(actual.useDropTarget),
  };
});

const card = (section: "Folders" | "Drawings", name: string) =>
  within(screen.getByRole("region", { name: section })).getByRole("link", {
    name,
  });

// the polyfilled DataTransfer has no clearData or setDragImage
const dataTransfer = () => ({
  setData: () => {},
  getData: () => "",
  clearData: () => {},
  setDragImage: () => {},
});

let workspace: ReturnType<typeof setUpTestWorkspace>;
let store: LocalWorkspaceStore;
let greendale: Folder;
let paintball: Folder;
let plan: DrawingMeta;
let seating: DrawingMeta;
let chang: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  store = await workspace.open();
  greendale = await store.createFolder(null, "Greendale");
  paintball = await store.createFolder(null, "Paintball");
  plan = await store.createDrawing({ folderId: null, name: "Floor plan" });
  seating = await store.createDrawing({ folderId: null, name: "Seating" });
  chang = await store.createDrawing({ folderId: null, name: "Chang's office" });
});

afterEach(() => cleanUpWebApp(workspace));

describe("the workspace page", () => {
  it("rerenders only the card of the drawing that changed", async () => {
    await renderPageAt("/");
    await waitFor(() => card("Drawings", "Chang's office"));
    vi.mocked(useDragSource).mockClear();

    await act(() => store.renameDrawing(plan.id, "Study room"));
    await waitFor(() => card("Drawings", "Study room"));

    const rendered = vi
      .mocked(useDragSource)
      .mock.calls.map(([item]) => item.id);
    expect(rendered).toEqual([plan.id]);
    expect(rendered).not.toContain(seating.id);
    expect(rendered).not.toContain(chang.id);
  });

  it("rerenders only the targets a drag leaves and enters", async () => {
    await renderPageAt("/");
    const transfer = dataTransfer();
    const from = card("Folders", "Greendale").closest("li")!;
    const to = card("Folders", "Paintball").closest("li")!;
    fireEvent.dragStart(card("Drawings", "Floor plan"), {
      dataTransfer: transfer,
    });
    fireEvent.dragEnter(from, { dataTransfer: transfer });
    expect(from).toHaveClass("workspace-drop");
    vi.mocked(useDropTarget).mockClear();

    fireEvent.dragEnter(to, { dataTransfer: transfer });

    expect(from).not.toHaveClass("workspace-drop");
    expect(to).toHaveClass("workspace-drop");
    // the nav lists both folders too, as targets that stay as they were
    expect(
      vi
        .mocked(useDropTarget)
        .mock.calls.map(([target]) => target.kind === "folder" && target.id)
        .sort(),
    ).toEqual([greendale.id, paintball.id].sort());
  });
});

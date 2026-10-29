import { KEYS, MIME_TYPES } from "@setsquare/common";
import * as filesystem from "@setsquare/setsquare/data/filesystem";
import { serializeAsJSON } from "@setsquare/setsquare/data/json";
import { t } from "@setsquare/setsquare/i18n";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import {
  fireEvent,
  screen,
  waitFor,
} from "@setsquare/setsquare/tests/test-utils";

import {
  cleanUpWebApp,
  elementIds,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForDrawing,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingId, DrawingMeta, Folder } from "../../workspace/types";

const { h } = window;

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

const handleFor = (file: File) => ({
  kind: "file",
  name: file.name,
  getFile: async () => file,
});

// like the browser, hands over launched files once there's a consumer
const launch = (...fileHandles: unknown[]) => {
  Object.assign(window, {
    launchQueue: {
      setConsumer: (consumer: (params: { files: unknown[] }) => void) =>
        consumer({ files: fileHandles }),
    },
  });
};

// pressing it returns false once something prevents its default
const pressOpen = () =>
  fireEvent.keyDown(document, { key: KEYS.O, ctrlKey: true });

const storedIds = async (store: LocalWorkspaceStore, id: DrawingId) =>
  (await store.loadDrawingContent(id))?.elements.map((element) => element.id);

// the drawing the files created
const importedDrawing = (store: LocalWorkspaceStore, ...kept: DrawingId[]) =>
  waitFor(() => {
    const created = [...store.getSnapshot().drawings.values()].filter(
      (drawing) => !kept.includes(drawing.id),
    );
    expect(created).toHaveLength(1);
    return created[0];
  });

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

afterEach(async () => {
  delete (window as any).launchQueue;
  await h.app?.library.resetLibrary();
  await cleanUpWebApp(workspace);
});

describe("opening a file on the web", () => {
  it("opens a scene as a new drawing next to the open one", async () => {
    const fileOpen = vi
      .spyOn(filesystem, "fileOpen")
      .mockResolvedValue(sceneFile("Study room", "annie") as any);
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    expect(pressOpen()).toBe(false);

    const drawing = await importedDrawing(store, plan.id);
    expect(fileOpen).toHaveBeenCalledTimes(1);
    expect(drawing).toMatchObject({
      folderId: greendale.id,
      name: "Study room",
    });
    await waitForDrawing(drawing.id, ["annie"]);
    // nothing is replaced, so nothing asks first
    expect(screen.queryByRole("dialog")).toBe(null);
    await waitFor(async () =>
      expect(await storedIds(store, plan.id)).toEqual(["troy"]),
    );
  });

  it("opens a file from the main menu too", async () => {
    vi.spyOn(filesystem, "fileOpen").mockResolvedValue(
      sceneFile("Study room", "annie") as any,
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    fireEvent.click(screen.getByTestId("main-menu-trigger"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Open file/ }));

    const drawing = await importedDrawing(store, plan.id);
    await waitForDrawing(drawing.id, ["annie"]);
  });

  it("merges a library into the element library", async () => {
    vi.spyOn(filesystem, "fileOpen").mockResolvedValue(
      (await API.loadFile("./fixtures/fixture_library.setsquarelib")) as any,
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    pressOpen();

    await waitFor(async () =>
      expect(await h.app.library.getLatestLibrary()).toHaveLength(1),
    );
    expect(h.state.openSidebar).toMatchObject({ tab: "library" });
    expect(store.getSnapshot().drawings.size).toBe(1);
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
  });

  it("says so when the file isn't a drawing, and stays", async () => {
    vi.spyOn(filesystem, "fileOpen").mockResolvedValue(
      new File(["Señor Chang"], "notes.txt", { type: "text/plain" }) as any,
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    pressOpen();

    await waitFor(() =>
      expect(h.state.errorMessage).toBe(t("alerts.couldNotLoadInvalidFile")),
    );
    expect(store.getSnapshot().drawings.size).toBe(1);
    expect(elementIds()).toEqual(["troy"]);
  });

  it("says nothing when the picker is cancelled", async () => {
    vi.spyOn(filesystem, "fileOpen").mockRejectedValue(
      new DOMException("cancelled", "AbortError"),
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    pressOpen();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(h.state.errorMessage).toBe(null);
    expect(store.getSnapshot().drawings.size).toBe(1);
  });
});

describe("files the app is launched with on the web", () => {
  it("open as new drawings at the root, the last one shown", async () => {
    launch(
      handleFor(sceneFile("Study room", "annie")),
      handleFor(sceneFile("Paintball", "chang")),
    );

    await renderWebAppAt(`/d/${plan.id}`);

    await waitFor(() => expect(store.getSnapshot().drawings.size).toBe(3));
    const drawings = [...store.getSnapshot().drawings.values()];
    expect(drawings.slice(1)).toMatchObject([
      { name: "Study room", folderId: null },
      { name: "Paintball", folderId: null },
    ]);
    await waitForDrawing(drawings[2].id, ["chang"]);
    await waitFor(async () =>
      expect(await storedIds(store, plan.id)).toEqual(["troy"]),
    );
  });

  it("say which file couldn't be read in the drawing that opens", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    launch(
      {
        kind: "file",
        name: "abed.setsquare",
        getFile: () => Promise.reject(new Error("permission denied")),
      },
      handleFor(sceneFile("Study room", "annie")),
    );

    await renderWebAppAt(`/d/${plan.id}`);

    const drawing = await importedDrawing(store, plan.id);
    await waitForDrawing(drawing.id, ["annie"]);
    await waitFor(() =>
      expect(h.state.errorMessage).toBe(
        t("errors.openFileError", { name: "abed.setsquare" }),
      ),
    );
  });
});

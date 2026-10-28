import { CaptureUpdateAction } from "@setsquare/setsquare";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { render as renderPlain, screen, waitFor } from "@testing-library/react";
import { set } from "idb-keyval";

import type { FileId } from "@setsquare/element/types";
import type { BinaryFileData, DataURL } from "@setsquare/setsquare/types";

import SetsquareApp from "../../App";
import { STORAGE_KEYS } from "../../app_constants";
import { filesStore } from "../../data/localFiles";
import * as workspaceStore from "../../web/workspaceStore";
import { contentWith } from "../workspace/helpers";

import {
  cleanUpWebApp,
  elementIds,
  renderWebAppAt,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
} from "./helpers";

// the native menu bar needs the desktop app itself; DesktopMenu.test covers it
vi.mock("../../desktop/DesktopMenu", () => ({ DesktopMenu: () => null }));

const { h } = window;

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" as DataURL;

let workspace: ReturnType<typeof setUpTestWorkspace>;

beforeEach(() => {
  workspace = setUpTestWorkspace();
});

afterEach(() => cleanUpWebApp(workspace));

describe("web app boot", () => {
  it("creates a drawing at the root when there is none", async () => {
    await renderWebAppAt("/");

    const store = await workspace.open();
    const drawings = [...store.getSnapshot().drawings.values()];
    expect(drawings).toMatchObject([{ folderId: null, name: null }]);
    await waitForDrawing(drawings[0].id, []);
    expect(document.title).toBe("Setsquare");
  });

  it("opens the drawing used last", async () => {
    const store = await workspace.open();
    const plan = await store.createDrawing({
      folderId: null,
      name: "Floor plan",
      content: contentWith("Floor plan", "troy"),
    });
    workspace.clock.now += 1000;
    const seating = await store.createDrawing({
      folderId: null,
      name: "Seating",
      content: contentWith("Seating", "abed"),
    });
    workspace.clock.now += 1000;
    await store.openDrawing(plan.id);

    await renderWebAppAt("/");

    await waitForDrawing(plan.id, ["troy"]);
    expect(store.getSnapshot().drawings.has(seating.id)).toBe(true);
    expect(store.getSnapshot().drawings.size).toBe(2);
    expect(document.title).toBe("Floor plan · Setsquare");
  });

  // until the workspace has pages of its own
  it.each(["/recent", "/trash", "/f/greendale", "/paintball"])(
    "opens the drawing used last from %s",
    async (path) => {
      const store = await workspace.open();
      const plan = await store.createDrawing({
        folderId: null,
        name: "Floor plan",
        content: contentWith("Floor plan", "troy"),
      });

      await renderWebAppAt(path);

      await waitForDrawing(plan.id, ["troy"]);
    },
  );

  it("goes to the drawings when the drawing is gone", async () => {
    const store = await workspace.open();
    const plan = await store.createDrawing({
      folderId: null,
      name: "Floor plan",
      content: contentWith("Floor plan", "troy"),
    });

    await renderWebAppAt("/d/chang");

    await waitForDrawing(plan.id, ["troy"]);
  });

  it("opens the scene the web app kept before, with its image", async () => {
    const fileId = "pierce" as FileId;
    const file: BinaryFileData = {
      id: fileId,
      dataURL: PIXEL,
      mimeType: "image/png",
      created: Date.now(),
    };
    await set(fileId, file, filesStore);
    const image = API.createElement({ type: "image", fileId, id: "pierce" });
    const rect = API.createElement({ type: "rectangle", id: "troy" });

    await renderWebAppAt("/", {
      localStorageData: {
        elements: [rect, image],
        appState: { name: "Study group", currentItemStrokeColor: "#e03131" },
      },
    });

    const store = await workspace.open();
    const drawings = [...store.getSnapshot().drawings.values()];
    expect(drawings).toMatchObject([
      { name: "Study group", folderId: null, fileIds: [fileId] },
    ]);
    await waitForDrawing(drawings[0].id, ["troy", "pierce"]);
    await waitFor(() => expect(h.app.files[fileId]?.dataURL).toBe(PIXEL));
    expect(h.state.currentItemStrokeColor).toBe("#e03131");
    // kept as a backup
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)).toContain(
      "pierce",
    );
  });

  it("shows the error splash when the workspace can't open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(workspaceStore.openWorkspaceStore).mockRejectedValue(
      new DOMException("blocked", "InvalidStateError"),
    );
    window.history.replaceState(null, "", "/");

    renderPlain(<SetsquareApp />);

    expect(
      await screen.findByRole("button", { name: "back to your drawings" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "clearing the canvas" })).toBe(
      null,
    );
  });
});

describe("desktop app boot", () => {
  beforeEach(() => {
    Object.assign(window, { isTauri: true });
  });

  afterEach(() => {
    delete (window as any).isTauri;
  });

  it("keeps the single scene and never opens the workspace", async () => {
    window.history.replaceState(null, "", "/");
    const addEventListener = vi.spyOn(window, "addEventListener");
    const rect = API.createElement({ type: "rectangle", id: "troy" });

    await renderWebAppAt("/", { localStorageData: { elements: [rect] } });
    API.updateScene({
      elements: [rect, API.createElement({ type: "ellipse", id: "abed" })],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    await waitForAutosave();

    expect(workspaceStore.openWorkspaceStore).not.toHaveBeenCalled();
    // nor does it follow the address, as the web app's router would
    expect(addEventListener).not.toHaveBeenCalledWith(
      "popstate",
      expect.anything(),
    );
    expect(elementIds()).toEqual(["troy", "abed"]);
    expect(window.location.pathname).toBe("/");
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)!,
    );
    expect(saved.map((element: { id: string }) => element.id)).toEqual([
      "troy",
      "abed",
    ]);
  });
});

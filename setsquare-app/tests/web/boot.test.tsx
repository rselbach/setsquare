import { CaptureUpdateAction } from "@setsquare/setsquare";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { t } from "@setsquare/setsquare/i18n";
import { act, unmountComponent } from "@setsquare/setsquare/tests/test-utils";
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
  renderPageAt,
  renderWebAppAt,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
  waitForPage,
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
  it("shows the drawings at the root, opening none", async () => {
    const store = await workspace.open();
    const plan = await store.createDrawing({
      folderId: null,
      name: "Floor plan",
      content: contentWith("Floor plan", "troy"),
    });

    await renderPageAt("/");

    await waitForPage("/", "Drawings");
    expect(screen.getByRole("link", { name: "Floor plan" })).toHaveAttribute(
      "href",
      `/d/${plan.id}`,
    );
    expect(store.getSnapshot().drawings.get(plan.id)?.openedAt).toBe(null);
    expect(store.getSnapshot().drawings.size).toBe(1);
    expect(document.title).toBe("Setsquare");
  });

  it("creates nothing in an empty workspace", async () => {
    await renderPageAt("/");

    expect(
      await screen.findByRole("heading", { name: "No drawings yet" }),
    ).toBeInTheDocument();
    const store = await workspace.open();
    expect(store.getSnapshot().drawings.size).toBe(0);
  });

  // until there's a Trash page, and for folders and pages that aren't there
  it.each(["/trash", "/f/greendale", "/paintball"])(
    "goes to the drawings from %s in place",
    async (path) => {
      const length = window.history.length;

      await renderPageAt(path);

      await waitForPage("/", "Drawings");
      expect(window.history.length).toBe(length);
    },
  );

  it("goes to the drawings when the drawing is gone", async () => {
    const store = await workspace.open();
    await store.createDrawing({
      folderId: null,
      name: "Floor plan",
      content: contentWith("Floor plan", "troy"),
    });

    await renderPageAt("/d/chang");

    await waitForPage("/", "Drawings");
    expect(
      screen.getByRole("link", { name: "Floor plan" }),
    ).toBeInTheDocument();
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

  it("opens the upgraded scene once, pointing at All drawings", async () => {
    const rect = API.createElement({ type: "rectangle", id: "troy" });

    await renderWebAppAt("/", {
      localStorageData: { elements: [rect], appState: { name: "Study group" } },
    });

    const store = await workspace.open();
    const [migrated] = store.getSnapshot().drawings.values();
    await waitForDrawing(migrated.id, ["troy"]);
    await waitFor(() =>
      expect(h.state.toast?.message).toBe(t("workspace.allDrawingsHint")),
    );

    unmountComponent();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    await renderPageAt("/");

    await waitForPage("/", "Drawings");
    expect(
      screen.getByRole("link", { name: "Study group" }),
    ).toBeInTheDocument();
    expect(store.getSnapshot().drawings.size).toBe(1);
  });

  it("leaves a first visit elsewhere where it is after the upgrade", async () => {
    const rect = API.createElement({ type: "rectangle", id: "troy" });
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      JSON.stringify([rect]),
    );

    await renderPageAt("/recent");

    await waitForPage("/recent", "Recent");
    expect(screen.getByRole("link", { name: "Untitled" })).toBeInTheDocument();
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

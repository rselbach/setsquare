import { getNonDeletedElements } from "@setsquare/element";
import { CaptureUpdateAction } from "@setsquare/setsquare";
import { restoreElements } from "@setsquare/setsquare/data/restore";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import {
  act,
  unmountComponent,
  waitFor,
} from "@setsquare/setsquare/tests/test-utils";
import { fireEvent, screen, within } from "@testing-library/react";
import { set } from "idb-keyval";

import type { FileId } from "@setsquare/element/types";
import type { DataURL } from "@setsquare/setsquare/types";

import { filesStore } from "../../data/localFiles";
import * as workspaceStore from "../../web/workspaceStore";

import {
  cleanUpWebApp,
  elementIds,
  navigateTo,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingMeta } from "../../workspace/types";

const testEnv = vi.hoisted(() => ({ enabled: true }));

// tab sync is off in tests, so turn it on while the test syncs
vi.mock("@setsquare/common", async (importOriginal) => {
  const module = await importOriginal<typeof import("@setsquare/common")>();
  const { mockThrottleRAF } = await import(
    "@setsquare/setsquare/tests/helpers/mocks"
  );
  return {
    ...module,
    throttleRAF: mockThrottleRAF,
    isTestEnv: () => testEnv.enabled,
  };
});

const { h } = window;

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" as DataURL;

const focusWithSync = async (settled: () => void | Promise<void>) => {
  testEnv.enabled = false;
  try {
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(settled);
  } finally {
    testEnv.enabled = true;
  }
};

let workspace: ReturnType<typeof setUpTestWorkspace>;
// another tab's store
let otherTab: LocalWorkspaceStore;
let plan: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  otherTab = await workspace.open();
  plan = await otherTab.createDrawing({
    folderId: null,
    name: "Floor plan",
    content: savedContent("Floor plan", "troy"),
  });
});

afterEach(() => cleanUpWebApp(workspace));

describe("a drawing open in two tabs", () => {
  it("reloads what the other tab saved once it's focused", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    const fileHandle = { name: "Greendale.setsquare" } as any;
    act(() => h.setState({ scrollX: 345, fileHandle }));
    await waitForAutosave();

    const fileId = "shirley" as FileId;
    await set(
      fileId,
      { id: fileId, dataURL: PIXEL, mimeType: "image/png", created: 1 },
      filesStore,
    );
    // as the other tab's editor saves it
    const content = savedContent("Study group", "troy");
    const image = API.createElement({
      type: "image",
      fileId,
      id: "shirley",
      status: "saved",
    });
    await otherTab.saveDrawingContent(
      plan.id,
      {
        ...content,
        elements: getNonDeletedElements(
          restoreElements([...content.elements, image], null),
        ),
      },
      [fileId],
    );

    await focusWithSync(() => {
      expect(elementIds()).toEqual(["troy", "shirley"]);
      expect(h.app.files[fileId]?.dataURL).toBe(PIXEL);
    });

    expect(h.state.name).toBe("Study group");
    // the view and the file handle are this tab's own
    expect(h.state.scrollX).toBe(345);
    expect(h.state.fileHandle).toBe(fileHandle);
    await waitForAutosave();
    // nor is the reloaded drawing saved again as an edit
    expect((await otherTab.getDrawingMeta(plan.id))?.revision).toBe(2);
  });

  it("doesn't reload the edit this tab saved as it lost focus", async () => {
    vi.mocked(workspaceStore.openWorkspaceStore).mockImplementation(
      async () => {
        const store = await workspace.open();
        const save = store.saveDrawingContent.bind(store);
        // the edit is stored at once, but the tab only hears so later
        vi.spyOn(store, "saveDrawingContent").mockImplementation(
          async (...args) => {
            const saved = await save(...args);
            await new Promise((resolve) => setTimeout(resolve, 100));
            return saved;
          },
        );
        return store;
      },
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    API.updateScene({
      elements: [
        ...h.elements,
        API.createElement({ type: "ellipse", id: "abed" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const updateScene = vi.spyOn(h.app.api, "updateScene");

    testEnv.enabled = false;
    try {
      // blurring saves the edit, which bumps the revision as focus returns
      act(() => {
        window.dispatchEvent(new Event("blur"));
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(async () =>
        expect((await otherTab.getDrawingMeta(plan.id))?.revision).toBe(2),
      );
      // past the sync's own debounce and the tab hearing of its save
      await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    } finally {
      testEnv.enabled = true;
    }

    expect(updateScene).not.toHaveBeenCalled();
    expect(elementIds()).toEqual(["troy", "abed"]);
  });

  it("shows a conflict when the other tab saves between this tab's focus check and its save", async () => {
    let appStore!: LocalWorkspaceStore;
    vi.mocked(workspaceStore.openWorkspaceStore).mockImplementation(
      async () => {
        appStore = await workspace.open();
        return appStore;
      },
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    const getDrawingMeta = vi.spyOn(appStore, "getDrawingMeta");
    await focusWithSync(() => expect(getDrawingMeta).toHaveBeenCalled());
    await act(() => getDrawingMeta.mock.results[0].value);

    await otherTab.saveDrawingContent(
      plan.id,
      savedContent("Floor plan", "troy", "britta"),
      [],
    );
    API.updateScene({
      elements: [
        ...h.elements,
        API.createElement({ type: "ellipse", id: "abed" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    await waitForAutosave();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-state", "conflict");
    expect(
      (await otherTab.loadDrawingContent(plan.id))?.elements.map(
        ({ id }) => id,
      ),
    ).toEqual(["troy", "britta"]);
    fireEvent.click(
      within(status).getByRole("button", { name: "Save as a copy" }),
    );
    await waitFor(() =>
      expect(window.location.pathname).not.toBe(`/d/${plan.id}`),
    );
    const copyId = window.location.pathname.slice("/d/".length);
    await waitFor(async () =>
      expect(
        (
          await otherTab.loadDrawingContent(copyId)
        )?.elements.map(({ id }) => id),
      ).toEqual(["troy", "abed"]),
    );
  });

  it("doesn't sync a drawing it closed before the sync ran", async () => {
    let appStore!: LocalWorkspaceStore;
    vi.mocked(workspaceStore.openWorkspaceStore).mockImplementation(
      async () => {
        appStore = await workspace.open();
        return appStore;
      },
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    const getDrawingMeta = vi.spyOn(appStore, "getDrawingMeta");

    testEnv.enabled = false;
    try {
      act(() => {
        window.dispatchEvent(new Event("focus"));
        unmountComponent();
      });
      // past the sync's debounce
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      testEnv.enabled = true;
    }

    expect(getDrawingMeta).not.toHaveBeenCalled();
  });

  it("leaves the next drawing alone when the last one's sync finishes", async () => {
    const seating = await otherTab.createDrawing({
      folderId: null,
      name: "Seating",
      content: savedContent("Seating", "abed"),
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let appStore!: LocalWorkspaceStore;
    vi.mocked(workspaceStore.openWorkspaceStore).mockImplementation(
      async () => {
        appStore = await workspace.open();
        return appStore;
      },
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    const getDrawingMeta = appStore.getDrawingMeta.bind(appStore);
    let syncing!: Promise<unknown>;
    // the sync's check is still on its way when the drawing closes
    vi.spyOn(appStore, "getDrawingMeta").mockImplementationOnce((id) => {
      syncing = held.then(() => getDrawingMeta(id));
      return syncing as ReturnType<typeof getDrawingMeta>;
    });
    await otherTab.saveDrawingContent(
      plan.id,
      savedContent("Study group", "troy", "britta"),
      [],
    );
    const lastUpdateScene = vi.spyOn(h.app.api, "updateScene");

    await focusWithSync(() => expect(syncing).toBeDefined());
    await navigateTo({ kind: "drawing", id: seating.id });
    await waitForDrawing(seating.id, ["abed"]);
    const nextUpdateScene = vi.spyOn(h.app.api, "updateScene");
    release();
    await syncing;
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));

    expect(lastUpdateScene).not.toHaveBeenCalled();
    expect(nextUpdateScene).not.toHaveBeenCalled();
    expect(elementIds()).toEqual(["abed"]);
  });
});

import { KEYS } from "@setsquare/common";
import { getNonDeletedElements } from "@setsquare/element";
import { CaptureUpdateAction } from "@setsquare/setsquare";
import { getDefaultAppState } from "@setsquare/setsquare/appState";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { Keyboard } from "@setsquare/setsquare/tests/helpers/ui";
import {
  getTextEditor,
  updateTextEditor,
} from "@setsquare/setsquare/tests/queries/dom";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@setsquare/setsquare/tests/test-utils";
import { t } from "@setsquare/setsquare/i18n";
import { get } from "idb-keyval";

import type { FileId, SetsquareElement } from "@setsquare/element/types";
import type {
  AppState,
  DataURL,
  NormalizedZoomValue,
} from "@setsquare/setsquare/types";

import { filesStore } from "../../data/localFiles";
import * as workspaceStore from "../../web/workspaceStore";
import {
  emptyDrawingContent,
  splitAppState,
} from "../../workspace/drawingAppState";
import { ApiError } from "../../workspace/remote/ApiError";

import {
  cleanUpWebApp,
  navigateTo,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForAutosave,
  waitForDrawing,
  waitForPage,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingId, DrawingMeta } from "../../workspace/types";

const { h } = window;

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" as DataURL;

const viewWith = (appState: Partial<AppState>) =>
  splitAppState({ ...getDefaultAppState(), ...appState }).view;

const storedIds = async (store: LocalWorkspaceStore, id: DrawingId) =>
  (await store.loadDrawingContent(id))?.elements.map((element) => element.id);

let workspace: ReturnType<typeof setUpTestWorkspace>;
let store: LocalWorkspaceStore;
let plan: DrawingMeta;
let seating: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  // a second store on the app's database, as another tab would have
  store = await workspace.open();
  plan = await store.createDrawing({
    folderId: null,
    name: "Floor plan",
    content: savedContent("Floor plan", "troy"),
  });
  seating = await store.createDrawing({
    folderId: null,
    name: "Seating",
    content: savedContent("Seating", "abed"),
  });
});

afterEach(() => cleanUpWebApp(workspace));

describe("a drawing's page", () => {
  it("opens the drawing's content where this browser left it", async () => {
    await store.saveDrawingView(
      plan.id,
      viewWith({
        scrollX: 120,
        scrollY: -40,
        zoom: { value: 2 as NormalizedZoomValue },
      }),
    );

    await renderWebAppAt(`/d/${plan.id}`);

    await waitForDrawing(plan.id, ["troy"]);
    expect(h.state).toMatchObject({
      name: "Floor plan",
      scrollX: 120,
      scrollY: -40,
      zoom: { value: 2 },
    });
    expect(document.title).toBe("Floor plan · Setsquare");
  });

  it("saves edits to the drawing, and only to it", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    await waitForAutosave();
    // opening it changed nothing
    expect((await store.getDrawingMeta(plan.id))?.revision).toBe(1);

    const fileId = "pierce" as FileId;
    act(() => {
      h.app.addFiles([
        {
          id: fileId,
          dataURL: PIXEL,
          mimeType: "image/png",
          created: Date.now(),
        },
      ]);
    });
    API.updateScene({
      elements: [
        ...h.elements,
        API.createElement({ type: "image", fileId, id: "pierce" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    await waitForAutosave();

    expect(await storedIds(store, plan.id)).toEqual(["troy", "pierce"]);
    expect(await store.getDrawingMeta(plan.id)).toMatchObject({
      revision: 2,
      fileIds: [fileId],
    });
    expect(await get(fileId, filesStore)).toMatchObject({ dataURL: PIXEL });
    expect(await storedIds(store, seating.id)).toEqual(["abed"]);
    expect((await store.getDrawingMeta(seating.id))?.revision).toBe(1);
  });

  it("saves scrolling as this browser's view, not as an edit", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    act(() => h.setState({ scrollX: 345, scrollY: 67 }));
    await waitForAutosave();

    const opened = await store.openDrawing(plan.id);
    expect(opened?.view).toMatchObject({ scrollX: 345, scrollY: 67 });
    expect(opened?.meta.revision).toBe(1);
  });

  it("saves the drawing it leaves at once, and opens the next afresh", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    API.updateScene({
      elements: [
        ...h.elements,
        API.createElement({ type: "ellipse", id: "annie" }),
      ],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    expect(API.getUndoStack().length).toBeGreaterThan(0);

    // well within the autosave's debounce
    await navigateTo({ kind: "drawing", id: seating.id });

    expect(await storedIds(store, plan.id)).toEqual(["troy", "annie"]);
    await waitForDrawing(seating.id, ["abed"]);
    expect(API.getUndoStack()).toHaveLength(0);
    expect(document.title).toBe("Seating · Setsquare");
    await waitForAutosave();
    expect(await storedIds(store, seating.id)).toEqual(["abed"]);
  });

  it("keeps the text being typed when it leaves the drawing", async () => {
    const text = API.createElement({ type: "text", text: "Greendale" });
    const notes = await store.createDrawing({
      folderId: null,
      name: "Notes",
      content: {
        ...emptyDrawingContent("Notes"),
        elements: getNonDeletedElements([text]),
      },
    });
    await renderWebAppAt(`/d/${notes.id}`);
    await waitForDrawing(notes.id, [text.id]);
    API.setSelectedElements([h.elements[0] as typeof text]);
    Keyboard.keyPress(KEYS.ENTER);
    updateTextEditor(await getTextEditor(), "Greendale Community College");

    await navigateTo({ kind: "drawing", id: seating.id });

    const saved = await store.loadDrawingContent(notes.id);
    expect(saved?.elements).toMatchObject([
      { id: text.id, originalText: "Greendale Community College" },
    ]);
    await waitForDrawing(seating.id, ["abed"]);
  });

  it("carries preferences to the next drawing, but not scrolling", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    act(() => h.setState({ currentItemStrokeColor: "#c2255c", scrollX: 345 }));

    await navigateTo({ kind: "drawing", id: seating.id });
    await waitForDrawing(seating.id, ["abed"]);

    expect(h.state.currentItemStrokeColor).toBe("#c2255c");
    expect(h.state.scrollX).not.toBe(345);

    await navigateTo({ kind: "drawing", id: plan.id });
    await waitForDrawing(plan.id, ["troy"]);

    expect(h.state.scrollX).toBe(345);
    expect(h.state.currentItemStrokeColor).toBe("#c2255c");
  });

  it("names the browser tab after the drawing", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    act(() => h.setState({ name: "Paintball map" }));

    await waitFor(() =>
      expect(document.title).toBe("Paintball map · Setsquare"),
    );
    act(() => h.setState({ name: null }));
    await waitFor(() => expect(document.title).toBe("Setsquare"));
    expect((await store.getDrawingMeta(plan.id))?.name).toBe(null);
  });

  it("stops saving a drawing deleted elsewhere and says it's gone", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    await store.deleteForever({ kind: "drawing", id: plan.id });

    API.updateScene({
      elements: [API.createElement({ type: "ellipse", id: "chang" })],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    expect(
      await screen.findByRole("heading", { name: "This drawing isn't here" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
    expect(await store.getDrawingMeta(plan.id)).toBe(null);
    expect(screen.queryByRole("button", { name: "Restore" })).toBe(null);

    fireEvent.click(screen.getByRole("button", { name: "Back to drawings" }));

    await waitForPage("/", "Drawings");
    const page = within(screen.getByRole("main"));
    expect(page.getByRole("link", { name: "Seating" })).toBeInTheDocument();
    expect(page.queryByRole("link", { name: "Floor plan" })).toBe(null);
  });
});

describe("a drawing's save warnings", () => {
  const full = () => new DOMException("Full", "QuotaExceededError");

  const signedIn = async () => {
    // an account store keeps a device copy of images before uploading them
    const account = Object.assign(await workspace.open(), {
      recoveryKey: "troy-barnes",
      recoveryStorage: window.localStorage,
      stageFiles: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(workspaceStore.openWorkspaceStore).mockResolvedValue(account);
    return account;
  };

  const edit = (
    element: SetsquareElement = API.createElement({
      type: "ellipse",
      id: "annie",
    }),
  ) =>
    API.updateScene({
      elements: [...h.elements, element],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

  const banners = () => [
    screen.queryByText(t("alerts.imageSaveFailed")),
    screen.queryByText(t("alerts.localStorageQuotaExceeded")),
  ];

  it.each([
    {
      name: "refused",
      error: new ApiError(400, "invalid_image"),
      state: "rejected",
      want: t("workspace.saveImageRejected", { files: "pierce" }),
    },
    {
      name: "unreachable",
      error: new TypeError("Failed to fetch"),
      state: "error",
      want: t("workspace.saveFailed"),
    },
  ])(
    "blames the upload, not browser storage, when an image is $name",
    async ({ error, state, want }) => {
      const account = await signedIn();
      vi.spyOn(account.files, "save").mockImplementation(
        async ({ addedFiles }) => ({
          savedFiles: new Map(),
          erroredFiles: new Map(addedFiles),
          errors: new Map([...addedFiles.keys()].map((id) => [id, error])),
        }),
      );
      await renderWebAppAt(`/d/${plan.id}`);
      await waitForDrawing(plan.id, ["troy"]);
      const fileId = "pierce" as FileId;
      act(() => {
        h.app.addFiles([
          { id: fileId, dataURL: PIXEL, mimeType: "image/png", created: 1 },
        ]);
      });
      edit(API.createElement({ type: "image", fileId, id: "pierce" }));
      await waitForAutosave();

      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("data-state", state);
      expect(status).toHaveTextContent(want);
      expect(banners()).toEqual([null, null]);
    },
  );

  it("says the device is full when it can't stage a recovery copy", async () => {
    const account = await signedIn();
    account.stageFiles.mockRejectedValue(full());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(account, "saveDrawingContent").mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    edit();
    await waitForAutosave();

    expect(screen.getByRole("status")).toHaveTextContent(
      t("workspace.recoveryStorageFull"),
    );
    expect(banners()).toEqual([null, null]);
  });

  it("says the device is full, not that changes are lost, and only for that drawing", async () => {
    const account = await signedIn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const saveView = vi
      .spyOn(account, "saveDrawingView")
      .mockRejectedValue(full());
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);
    edit();
    await waitForAutosave();

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-state", "saved");
    expect(status).toHaveTextContent(t("workspace.deviceStorageFull"));
    expect(banners()).toEqual([null, null]);
    expect(await storedIds(account, plan.id)).toEqual(["troy", "annie"]);

    saveView.mockRestore();
    await navigateTo({ kind: "drawing", id: seating.id });
    await waitForDrawing(seating.id, ["abed"]);
    await waitForAutosave();

    expect(screen.getByRole("status")).toHaveAttribute("data-state", "saved");
    expect(screen.queryByText(t("workspace.deviceStorageFull"))).toBe(null);
  });
});

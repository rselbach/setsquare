import { CaptureUpdateAction } from "@setsquare/setsquare";
import { serializeAsJSON } from "@setsquare/setsquare/data/json";
import { t } from "@setsquare/setsquare/i18n";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act, screen, waitFor } from "@setsquare/setsquare/tests/test-utils";

import type { FileId } from "@setsquare/element/types";
import type { BinaryFiles, DataURL } from "@setsquare/setsquare/types";

import { savePrefs } from "../../workspace/prefs";
import { toPrefs } from "../../workspace/drawingAppState";

import {
  cleanUpWebApp,
  elementIds,
  renderWebAppAt,
  savedContent,
  setUpTestWorkspace,
  waitForDrawing,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingId, DrawingMeta } from "../../workspace/types";

const { h } = window;

const SCENE_URL = "https://greendale.edu/study-group.setsquare";
const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" as DataURL;

const serveScene = (json: string) =>
  vi.spyOn(window, "fetch").mockResolvedValue({
    blob: async () => new Blob([json], { type: "application/json" }),
  } as Response);

const changeHash = (path: string) => {
  window.history.replaceState(null, "", path);
  act(() => {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
};

// the drawing the link created
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
let plan: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  store = await workspace.open();
  plan = await store.createDrawing({
    folderId: null,
    name: "Floor plan",
    content: savedContent("Floor plan", "troy"),
  });
});

afterEach(() => cleanUpWebApp(workspace));

describe("#url= links on the web", () => {
  it("open the linked scene as a new drawing", async () => {
    savePrefs(toPrefs({ currentItemStrokeColor: "#c2255c" }));
    const linked = API.createElement({ type: "rectangle", id: "annie" });
    serveScene(
      serializeAsJSON(
        [linked],
        { viewBackgroundColor: "#ffc9c9" },
        {},
        "local",
      ),
    );

    await renderWebAppAt(`/#url=${SCENE_URL}`);

    const drawing = await importedDrawing(store, plan.id);
    expect(drawing).toMatchObject({ folderId: null, name: null });
    await waitForDrawing(drawing.id, ["annie"]);
    expect(window.location.hash).toBe("");
    // the file's background, but this browser's preferences
    expect(h.state.viewBackgroundColor).toBe("#ffc9c9");
    expect(h.state.currentItemStrokeColor).toBe("#c2255c");
    // nothing is replaced, so nothing asks first
    expect(screen.queryByRole("dialog")).toBe(null);
    expect(
      (await store.loadDrawingContent(plan.id))?.elements.map(({ id }) => id),
    ).toEqual(["troy"]);
  });

  it("keep the linked scene's images", async () => {
    const fileId = "pierce" as FileId;
    const image = API.createElement({ type: "image", fileId, id: "pierce" });
    const files: BinaryFiles = {
      [fileId]: {
        id: fileId,
        dataURL: PIXEL,
        mimeType: "image/png",
        created: Date.now(),
      },
    };
    serveScene(serializeAsJSON([image], {}, files, "local"));

    await renderWebAppAt(`/#url=${SCENE_URL}`);

    const drawing = await importedDrawing(store, plan.id);
    expect(drawing.fileIds).toEqual([fileId]);
    await waitForDrawing(drawing.id, ["pierce"]);
    await waitFor(() => expect(h.app.files[fileId]?.dataURL).toBe(PIXEL));
  });

  it("open a link followed while a drawing is open, saving that one", async () => {
    serveScene(
      serializeAsJSON(
        [API.createElement({ type: "rectangle", id: "annie" })],
        {},
        {},
        "local",
      ),
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

    changeHash(`/d/${plan.id}#url=${SCENE_URL}`);

    const drawing = await importedDrawing(store, plan.id);
    await waitForDrawing(drawing.id, ["annie"]);
    expect(window.location.hash).toBe("");
    expect(
      (await store.loadDrawingContent(plan.id))?.elements.map(({ id }) => id),
    ).toEqual(["troy", "abed"]);
  });

  it("say so and stay on the drawing when the scene can't load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(window, "fetch").mockRejectedValue(new TypeError("offline"));

    await renderWebAppAt(`/d/${plan.id}#url=${SCENE_URL}`);

    await waitForDrawing(plan.id, ["troy"]);
    await waitFor(() =>
      expect(h.state.errorMessage).toBe(t("alerts.invalidSceneUrl")),
    );
    expect(window.location.hash).toBe("");
    expect(store.getSnapshot().drawings.size).toBe(1);

    act(() => h.setState({ errorMessage: null }));
    changeHash(`/d/${plan.id}#url=${SCENE_URL}`);

    await waitFor(() =>
      expect(h.state.errorMessage).toBe(t("alerts.invalidSceneUrl")),
    );
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
    expect(elementIds()).toEqual(["troy"]);
    expect(store.getSnapshot().drawings.size).toBe(1);
  });

  it("leave the drawing alone when another hash changes", async () => {
    const fetch = vi.spyOn(window, "fetch");
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy"]);

    changeHash(`/d/${plan.id}#study-room`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(fetch).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
    expect(elementIds()).toEqual(["troy"]);
    expect(store.getSnapshot().drawings.size).toBe(1);
  });
});

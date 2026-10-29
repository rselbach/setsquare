import { EVENT } from "@setsquare/common";
import { getNonDeletedElements } from "@setsquare/element";
import { restoreElements } from "@setsquare/setsquare/data/restore";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act, waitFor } from "@setsquare/setsquare/tests/test-utils";

import type { NonDeletedSetsquareElement } from "@setsquare/element/types";

import { emptyDrawingContent } from "../../workspace/drawingAppState";

import {
  cleanUpWebApp,
  renderWebAppAt,
  setUpTestWorkspace,
  waitForDrawing,
} from "./helpers";

import type { LocalWorkspaceStore } from "../../workspace/local/LocalWorkspaceStore";
import type { DrawingContent, DrawingMeta } from "../../workspace/types";

const { h } = window;

const rect = (
  id: string,
  x: number,
  y: number,
  link: string | null = null,
) => ({
  ...API.createElement({ type: "rectangle", id, x, y, width: 100, height: 80 }),
  link,
});

const contentOf = (
  name: string,
  elements: ReturnType<typeof rect>[],
): DrawingContent => ({
  ...emptyDrawingContent(name),
  elements: getNonDeletedElements(restoreElements(elements, null)),
});

const elementLink = (path: string, element: string) =>
  `${window.location.origin}${path}?element=${element}`;

// as the editor does when the user follows the element's link
const followLink = (id: string) => {
  const element = h.elements.find(
    (element) => element.id === id,
  ) as NonDeletedSetsquareElement;
  const event = new CustomEvent(EVENT.SETSQUARE_LINK, {
    cancelable: true,
    detail: { nativeEvent: new MouseEvent("click") },
  });
  act(() => h.app.props.onLinkOpen!(element, event));
  return event;
};

// whether the editor's viewport has the element in its middle, where
// following a link to it puts it
const isCenteredOn = (id: string) => {
  const element = h.elements.find((element) => element.id === id)!;
  const { scrollX, scrollY, width, height, zoom } = h.state;
  return (
    Math.abs(
      width / 2 / zoom.value - scrollX - (element.x + element.width / 2),
    ) < 1 &&
    Math.abs(
      height / 2 / zoom.value - scrollY - (element.y + element.height / 2),
    ) < 1
  );
};

let workspace: ReturnType<typeof setUpTestWorkspace>;
let store: LocalWorkspaceStore;
let plan: DrawingMeta;
let seating: DrawingMeta;

beforeEach(async () => {
  workspace = setUpTestWorkspace();
  store = await workspace.open();
  seating = await store.createDrawing({
    folderId: null,
    name: "Seating",
    content: contentOf("Seating", [
      rect("abed", 0, 0),
      rect("annie", 8000, 6000),
    ]),
  });
  plan = await store.createDrawing({ folderId: null, name: "Floor plan" });
  // with links to its own address, known only now
  await store.saveDrawingContent(
    plan.id,
    contentOf("Floor plan", [
      rect("troy", 0, 0, elementLink(`/d/${seating.id}`, "annie")),
      rect("britta", 200, 0, elementLink(`/d/${plan.id}`, "pierce")),
      rect("shirley", 400, 0, elementLink("/", "pierce")),
      rect("pierce", 9000, 7000),
    ]),
    [],
  );
});

afterEach(() => cleanUpWebApp(workspace));

describe("element links on the web", () => {
  it("open the other drawing at the linked element", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy", "britta", "shirley", "pierce"]);

    expect(followLink("troy").defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(window.location.search).toBe("?element=annie");
      expect(h.state.isLoading).toBe(false);
      expect(h.elements.map(({ id }) => id)).toEqual(["abed", "annie"]);
    });
    expect(window.location.pathname).toBe(`/d/${seating.id}`);
    expect(isCenteredOn("annie")).toBe(true);
  });

  it("scroll within the drawing for its own elements", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy", "britta", "shirley", "pierce"]);
    const { length } = window.history;
    expect(isCenteredOn("pierce")).toBe(false);

    expect(followLink("britta").defaultPrevented).toBe(true);

    await waitFor(() => expect(isCenteredOn("pierce")).toBe(true));
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
    expect(window.history.length).toBe(length);
  });

  it("scroll within the drawing for links from before drawings had pages", async () => {
    await renderWebAppAt(`/d/${plan.id}`);
    await waitForDrawing(plan.id, ["troy", "britta", "shirley", "pierce"]);

    followLink("shirley");

    await waitFor(() => expect(isCenteredOn("pierce")).toBe(true));
    expect(window.location.pathname).toBe(`/d/${plan.id}`);
  });
});

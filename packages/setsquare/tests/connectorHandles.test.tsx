import React from "react";
import { vi } from "vitest";

import { arrayToMap, KEYS, reseed } from "@setsquare/common";
import { getTransformHandles } from "@setsquare/element";

import type { SetsquareArrowElement } from "@setsquare/element/types";

import { Setsquare } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import {
  fireEvent,
  GlobalTestState,
  render,
  unmountComponent,
} from "./test-utils";

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

// handles sit 20px out from the middle of each side of the shape's bounds
const source = () =>
  API.createElement({
    type: "rectangle",
    id: "source",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
  });
const RIGHT_HANDLE = [120, 30] as const;

const shapes = () => h.elements.filter((element) => element.type !== "arrow");
const arrows = () =>
  h.elements.filter(
    (element): element is SetsquareArrowElement => element.type === "arrow",
  );

/** hovers the source, then its right handle */
const hoverRightHandle = () => {
  mouse.moveTo(50, 30);
  mouse.moveTo(...RIGHT_HANDLE);
};

describe("connector handles", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mouse.reset();
    await render(<Setsquare handleKeyboardGlobally={true} />);
  });

  it("shows the handles of the shape under the pointer", () => {
    API.setElements([source()]);

    mouse.moveTo(50, 30);
    expect(h.app.connectorHandles.render).toEqual({
      elementId: "source",
      active: null,
      preview: null,
    });

    mouse.moveTo(...RIGHT_HANDLE);
    expect(h.app.connectorHandles.render?.active).toBe("right");

    mouse.moveTo(500, 500);
    expect(h.app.connectorHandles.render).toBe(null);
  });

  it("lets a shape under a handle take the click", () => {
    const neighbor = API.createElement({
      type: "rectangle",
      id: "neighbor",
      x: 110,
      y: 0,
      width: 60,
      height: 60,
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
    });
    API.setElements([source(), neighbor]);

    hoverRightHandle();
    expect(h.app.connectorHandles.render?.active).toBe(null);
    mouse.clickAt(...RIGHT_HANDLE);

    expect(h.elements).toHaveLength(2);
    expect(API.getSelectedElements().map(({ id }) => id)).toEqual(["neighbor"]);
  });

  it("lets a locked shape under a handle take the click", () => {
    const neighbor = API.createElement({
      type: "rectangle",
      id: "neighbor",
      x: 110,
      y: 0,
      width: 60,
      height: 60,
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
      locked: true,
    });
    API.setElements([source(), neighbor]);

    hoverRightHandle();
    expect(h.app.connectorHandles.render?.active).toBe(null);
    mouse.clickAt(...RIGHT_HANDLE);

    expect(h.elements).toHaveLength(2);
    expect(h.state.activeLockedId).toBe("neighbor");
  });

  it("hit-tests the scene once per hover", () => {
    API.setElements([source()]);
    mouse.moveTo(50, 30);
    const getElementsAtPosition = vi.spyOn(h.app, "getElementsAtPosition");

    mouse.moveTo(...RIGHT_HANDLE);
    mouse.moveTo(60, 30);

    expect(getElementsAtPosition).toHaveBeenCalledTimes(2);
    getElementsAtPosition.mockRestore();
  });

  it("keeps a handle over a hollow shape's empty inside", () => {
    const neighbor = API.createElement({
      type: "rectangle",
      id: "neighbor",
      x: 110,
      y: 0,
      width: 60,
      height: 60,
    });
    API.setElements([source(), neighbor]);

    hoverRightHandle();
    expect(h.app.connectorHandles.render?.active).toBe("right");

    // and the hollow shape's handles show once the pointer is in it
    mouse.moveTo(160, 30);
    expect(h.app.connectorHandles.render?.elementId).toBe("neighbor");
  });

  it("keeps the handles of a shape inside a hollow box", () => {
    const box = API.createElement({
      type: "rectangle",
      id: "box",
      x: -100,
      y: -100,
      width: 400,
      height: 300,
    });
    API.setElements([box, source()]);

    mouse.moveTo(50, 30);
    mouse.moveTo(110, 30);
    expect(h.app.connectorHandles.render?.elementId).toBe("source");
    mouse.moveTo(...RIGHT_HANDLE);
    expect(h.app.connectorHandles.render).toEqual(
      expect.objectContaining({ elementId: "source", active: "right" }),
    );
    mouse.clickAt(...RIGHT_HANDLE);

    expect(shapes()).toHaveLength(3);
    expect(arrows()[0].startBinding?.elementId).toBe("source");

    // the box's own handles show away from the shape, and the shape's again
    // on it
    mouse.moveTo(250, 150);
    expect(h.app.connectorHandles.render?.elementId).toBe("box");
    mouse.moveTo(50, 30);
    expect(h.app.connectorHandles.render?.elementId).toBe("source");
  });

  it("keeps a handle usable over the shape's own connector", () => {
    API.setElements([source()]);

    hoverRightHandle();
    mouse.clickAt(...RIGHT_HANDLE);
    hoverRightHandle();
    expect(h.app.connectorHandles.render?.active).toBe("right");
    mouse.clickAt(...RIGHT_HANDLE);

    expect(shapes()).toHaveLength(3);
    expect(arrows()).toHaveLength(2);
  });

  it("shows no handles with another tool", () => {
    API.setElements([source()]);
    UI.clickTool("rectangle");

    mouse.moveTo(50, 30);
    expect(h.app.connectorHandles.render).toBe(null);
  });

  it("adds a connected copy on the clicked handle's side", () => {
    API.setElements([source()]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    mouse.upAt(...RIGHT_HANDLE);

    const [, copy] = shapes();
    expect(copy.type).toBe("rectangle");
    expect(copy.x).toBeGreaterThan(100);
    expect(copy.y).toBe(0);
    expect(arrows()).toHaveLength(1);
    expect(arrows()[0].startBinding?.elementId).toBe("source");
    expect(arrows()[0].endBinding?.elementId).toBe(copy.id);
    expect(API.getSelectedElements().map(({ id }) => id)).toEqual([copy.id]);
  });

  it("connects to the shape a handle is dropped on", () => {
    const target = API.createElement({
      type: "ellipse",
      id: "target",
      x: 300,
      y: 200,
      width: 100,
      height: 60,
    });
    API.setElements([source(), target]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    mouse.moveTo(200, 120);
    mouse.moveTo(350, 230);
    mouse.upAt(350, 230);

    expect(shapes()).toHaveLength(2);
    expect(arrows()).toHaveLength(1);
    expect(arrows()[0].startBinding?.elementId).toBe("source");
    expect(arrows()[0].endBinding?.elementId).toBe("target");
  });

  it("adds a connected copy where a handle is dropped on empty canvas", () => {
    API.setElements([source()]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    mouse.moveTo(300, 300);
    mouse.moveTo(400, 400);
    mouse.upAt(400, 400);

    const [, copy] = shapes();
    expect(copy.x).toBe(350);
    expect(copy.y).toBe(370);
    expect(arrows()[0].startBinding?.elementId).toBe("source");
    expect(arrows()[0].endBinding?.elementId).toBe(copy.id);
  });

  it("adds a copy where a handle is dropped inside a hollow box around the shape", () => {
    const box = API.createElement({
      type: "rectangle",
      id: "box",
      x: -100,
      y: -100,
      width: 600,
      height: 400,
    });
    API.setElements([box, source()]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    mouse.moveTo(250, 100);
    mouse.moveTo(300, 150);
    expect(h.app.connectorHandles.render?.preview?.type).toBe("node");
    mouse.upAt(300, 150);

    const [, , copy] = shapes();
    expect(copy.x).toBe(250);
    expect(copy.y).toBe(120);
    expect(arrows()[0].startBinding?.elementId).toBe("source");
    expect(arrows()[0].endBinding?.elementId).toBe(copy.id);
  });

  it("adds the copy to the shape's frame", () => {
    const frame = API.createElement({
      type: "frame",
      id: "frame",
      x: -50,
      y: -50,
      width: 500,
      height: 300,
    });
    API.setElements([frame, { ...source(), frameId: "frame" }]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    mouse.moveTo(250, 100);
    mouse.moveTo(300, 100);
    mouse.upAt(300, 100);

    const copy = shapes().find(
      ({ id, type }) => type === "rectangle" && id !== "source",
    );
    expect(copy?.frameId).toBe("frame");
    expect(arrows()[0].frameId).toBe("frame");
  });

  it("adds nothing when a handle is dropped back on its shape", () => {
    API.setElements([source()]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    mouse.moveTo(300, 300);
    expect(h.app.connectorHandles.render?.preview?.type).toBe("node");
    mouse.moveTo(50, 30);
    expect(h.app.connectorHandles.render?.preview).toBe(null);
    mouse.upAt(50, 30);

    expect(h.elements).toHaveLength(1);
  });

  it("adds nothing when a drag is canceled with Escape", () => {
    API.setElements([source()]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    mouse.moveTo(300, 300);
    expect(h.app.connectorHandles.render?.preview?.type).toBe("node");
    Keyboard.keyPress(KEYS.ESCAPE);
    expect(h.app.connectorHandles.render).toBe(null);
    mouse.upAt(300, 300);

    expect(h.elements).toHaveLength(1);
  });

  it("adds nothing when the browser takes a dragged handle's pointer over", () => {
    API.setElements([source()]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    mouse.moveTo(300, 300);
    // no pointerup follows a pointercancel
    fireEvent.pointerCancel(GlobalTestState.interactiveCanvas, {
      pointerId: 1,
    });
    expect(h.app.connectorHandles.render).toBe(null);

    mouse.moveTo(400, 400);
    expect(h.app.connectorHandles.render).toBe(null);
    mouse.clickAt(400, 400);

    expect(h.elements).toHaveLength(1);
  });

  it("ignores another pointer's pointerup while a handle is pressed", () => {
    API.setElements([source()]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    new Pointer("touch", 2).upAt(500, 500);
    expect(h.elements).toHaveLength(1);

    mouse.upAt(...RIGHT_HANDLE);
    expect(shapes()).toHaveLength(2);
  });

  it("cancels a handle press when a second finger touches the canvas", () => {
    API.setElements([source()]);
    const first = new Pointer("touch", 1);
    const second = new Pointer("touch", 2);

    first.moveTo(50, 30);
    first.moveTo(...RIGHT_HANDLE);
    first.downAt(...RIGHT_HANDLE);
    expect(h.app.connectorHandles.render?.active).toBe("right");

    second.downAt(500, 500);
    expect(h.app.connectorHandles.render).toBe(null);
    second.upAt(500, 500);
    first.upAt(...RIGHT_HANDLE);

    expect(h.elements).toHaveLength(1);
  });

  it("marks the pointer up after a handle click", () => {
    API.setElements([source()]);

    hoverRightHandle();
    mouse.downAt(...RIGHT_HANDLE);
    expect(h.state.cursorButton).toBe("down");
    mouse.upAt(...RIGHT_HANDLE);

    expect(h.state.cursorButton).toBe("up");
  });

  it("leaves the rotation handle of a selected shape alone", () => {
    const rectangle = API.createElement({
      type: "rectangle",
      id: "rotated",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      angle: Math.PI / 4,
    });
    API.setElements([rectangle]);
    API.setSelectedElements([rectangle]);
    const [x, y, width, height] = getTransformHandles(
      h.elements[0],
      h.state.zoom,
      arrayToMap(h.elements),
      "mouse",
    ).rotation!;

    mouse.moveTo(50, 50);
    mouse.moveTo(x + width / 2, y + height / 2);

    expect(h.app.connectorHandles.render?.active ?? null).toBe(null);
  });
});

import React from "react";

import { KEYS, reseed } from "@excalidraw/common";

import type { ExcalidrawArrowElement } from "@excalidraw/element/types";

import { Excalidraw } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

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
    (element): element is ExcalidrawArrowElement => element.type === "arrow",
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
    await render(<Excalidraw handleKeyboardGlobally={true} />);
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
    });
    API.setElements([source(), neighbor]);

    hoverRightHandle();
    expect(h.app.connectorHandles.render?.active).toBe(null);
    mouse.clickAt(...RIGHT_HANDLE);

    expect(h.elements).toHaveLength(2);
    expect(API.getSelectedElements().map(({ id }) => id)).toEqual(["neighbor"]);
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
});

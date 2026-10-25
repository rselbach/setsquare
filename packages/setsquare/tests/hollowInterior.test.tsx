import React from "react";

import { reseed } from "@setsquare/common";

import { Setsquare } from "../index";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

const live = () =>
  h.elements.filter((element) => !element.isDeleted).map(({ id }) => id);

const box = (id: string, size: number, rest = {}) =>
  API.createElement({
    type: "rectangle",
    id,
    x: 0,
    y: 0,
    width: size,
    height: size,
    ...rest,
  });

// a shape without a fill is hit anywhere inside, but only through its
// outline when erasing, unlocking or finding the frame under a point
describe("the empty inside of a hollow shape", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mouse.reset();
    await render(<Setsquare handleKeyboardGlobally={true} />);
  });

  it("isn't erased by a click", () => {
    API.setElements([box("box", 400)]);

    UI.clickTool("eraser");
    mouse.clickAt(200, 200);

    expect(live()).toEqual(["box"]);
  });

  it("is erased by a click on its outline", () => {
    API.setElements([box("box", 400)]);

    UI.clickTool("eraser");
    mouse.clickAt(0, 200);

    expect(live()).toEqual([]);
  });

  it("doesn't keep a click from erasing a shape inside it", () => {
    API.setElements([
      box("container", 400),
      API.createElement({
        type: "rectangle",
        id: "inner",
        x: 100,
        y: 100,
        width: 50,
        height: 50,
        backgroundColor: "#ff0000",
        fillStyle: "solid",
      }),
    ]);

    UI.clickTool("eraser");
    mouse.clickAt(125, 125);

    expect(live()).toEqual(["container"]);
  });

  it("doesn't offer to unlock a locked shape", () => {
    API.setElements([box("box", 400, { locked: true })]);

    mouse.clickAt(200, 200);
    expect(h.state.activeLockedId).toBe(null);

    mouse.clickAt(0, 200);
    expect(h.state.activeLockedId).toBe("box");
  });

  it("doesn't keep new shapes out of the frame under it", () => {
    API.setElements([
      API.createElement({
        type: "frame",
        id: "frame",
        x: 0,
        y: 0,
        width: 500,
        height: 500,
      }),
      API.createElement({
        type: "rectangle",
        id: "boundary",
        x: -100,
        y: -100,
        width: 800,
        height: 800,
      }),
    ]);

    UI.clickTool("rectangle");
    mouse.downAt(200, 200);
    mouse.moveTo(240, 240);
    mouse.upAt(260, 260);

    const created = h.elements.find(
      (element) => element.type === "rectangle" && element.id !== "boundary",
    )!;
    expect(created.frameId).toBe("frame");
  });
});

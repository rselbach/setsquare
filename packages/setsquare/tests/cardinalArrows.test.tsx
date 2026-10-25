import React from "react";

import { KEYS, reseed } from "@setsquare/common";
import {
  getGlobalFixedPointForBindableElement,
  isBindableElement,
  LinearElementEditor,
} from "@setsquare/element";

import type { Radians } from "@setsquare/math";
import type {
  SetsquareArrowElement,
  FixedPointBinding,
} from "@setsquare/element/types";

import { Setsquare } from "../index";

import { API } from "./helpers/api";
import { Keyboard, Pointer, UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;
const mouse = new Pointer("mouse");

/** the side of its element a binding sits on, from where its point lies */
const sideOf = (binding: FixedPointBinding | null) => {
  if (!binding) {
    return null;
  }
  const [x, y] = binding.fixedPoint;
  return y < 0
    ? "up"
    : y > 1
    ? "down"
    : x < 0
    ? "left"
    : x > 1
    ? "right"
    : "inside";
};

const arrow = () =>
  h.elements.find(
    (element): element is SetsquareArrowElement => element.type === "arrow",
  )!;

const sides = () => [sideOf(arrow().startBinding), sideOf(arrow().endBinding)];

/** the arrow's bound ends, and where their bindings put them */
const endsAndBindingPoints = () => {
  const elementsMap = h.app.scene.getNonDeletedElementsMap();
  return ([0, -1] as const).flatMap((index) => {
    const binding = index === 0 ? arrow().startBinding : arrow().endBinding;
    const element = binding && elementsMap.get(binding.elementId);
    if (!binding || !element || !isBindableElement(element)) {
      return [];
    }
    return {
      end: LinearElementEditor.getPointAtIndexGlobalCoordinates(
        arrow(),
        index,
        elementsMap,
      ),
      binding: getGlobalFixedPointForBindableElement(
        binding.fixedPoint,
        element,
        elementsMap,
      ),
    };
  });
};

const expectEndsOnBindings = () => {
  for (const { end, binding } of endsAndBindingPoints()) {
    expect(end[0]).toBeCloseTo(binding[0], 0);
    expect(end[1]).toBeCloseTo(binding[1], 0);
  }
};

/** two 100x60 boxes, "top" at the origin and "bottom" 200px below it */
const setupBoxes = () => {
  API.setElements([
    API.createElement({
      type: "rectangle",
      id: "top",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    }),
    API.createElement({
      type: "rectangle",
      id: "bottom",
      x: 0,
      y: 200,
      width: 100,
      height: 60,
    }),
  ]);
};

const drawArrow = (
  from: readonly [number, number],
  to: readonly [number, number],
) => {
  UI.clickTool("arrow");
  mouse.downAt(...from);
  mouse.moveTo((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  mouse.moveTo(...to);
  mouse.upAt(...to);
};

/** drags the element under `from` by the offset to `to` */
const drag = (
  from: readonly [number, number],
  to: readonly [number, number],
) => {
  UI.clickTool("selection");
  mouse.downAt(...from);
  mouse.moveTo((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  mouse.moveTo(...to);
  mouse.upAt(...to);
};

describe.each(["elbow", "sharp", "round"] as const)(
  "cardinal %s arrows",
  (arrowType) => {
    beforeEach(async () => {
      localStorage.clear();
      reseed(7);
      mouse.reset();
      await render(<Setsquare handleKeyboardGlobally={true} />);
      API.setAppState({
        currentItemArrowType: arrowType,
        currentItemArrowCardinal: true,
      });
    });

    it("binds a new arrow to the sides facing each other", () => {
      setupBoxes();
      drawArrow([50, 30], [50, 230]);

      expect(arrow().cardinal).toBe(true);
      expect(arrow().startBinding?.elementId).toBe("top");
      expect(arrow().endBinding?.elementId).toBe("bottom");
      expect(sides()).toEqual(["down", "up"]);
    });

    it("switches sides as an element moves to the other side", () => {
      setupBoxes();
      drawArrow([50, 30], [50, 230]);

      drag([50, 230], [50, -270]);
      expect(h.elements.find(({ id }) => id === "bottom")?.y).toBe(-300);
      expect(sides()).toEqual(["up", "down"]);

      drag([50, -270], [350, -270]);
      expect(sides()).toEqual(["right", "left"]);
    });

    it("faces the bound end toward a free end", () => {
      setupBoxes();
      drawArrow([50, 30], [50, -300]);
      expect(arrow().endBinding).toBe(null);
      expect(sides()).toEqual(["up", null]);

      // drag the free end out to the right of the top box
      drag([50, -300], [400, 30]);
      expect(arrow().endBinding).toBe(null);
      expect(sides()).toEqual(["right", null]);
    });

    it("picks new sides when an end is dropped on another element", () => {
      setupBoxes();
      API.setElements([
        ...h.elements,
        API.createElement({
          type: "rectangle",
          id: "right",
          x: 300,
          y: 0,
          width: 100,
          height: 60,
        }),
      ]);
      drawArrow([50, 30], [50, 230]);
      const end = LinearElementEditor.getPointAtIndexGlobalCoordinates(
        arrow(),
        -1,
        h.app.scene.getNonDeletedElementsMap(),
      );

      drag([end[0], end[1]], [350, 30]);

      expect(arrow().endBinding?.elementId).toBe("right");
      expect(sides()).toEqual(["right", "left"]);
    });

    it("previews the sides while the end is dragged over an element", () => {
      setupBoxes();
      UI.clickTool("arrow");
      mouse.downAt(50, 30);
      mouse.moveTo(50, 130);
      mouse.moveTo(50, 230);

      const elementsMap = h.app.scene.getNonDeletedElementsMap();
      const [startX, startY] =
        LinearElementEditor.getPointAtIndexGlobalCoordinates(
          arrow(),
          0,
          elementsMap,
        );
      const [endX, endY] = LinearElementEditor.getPointAtIndexGlobalCoordinates(
        arrow(),
        -1,
        elementsMap,
      );
      // the middle of the facing sides, a binding gap out
      expect(startX).toBeCloseTo(50, 0);
      expect(startY).toBeGreaterThan(60);
      expect(startY).toBeLessThan(70);
      expect(endX).toBeCloseTo(50, 0);
      expect(endY).toBeGreaterThan(190);
      expect(endY).toBeLessThan(200);

      mouse.upAt(50, 230);
      expect(sides()).toEqual(["down", "up"]);
    });

    it("puts the ends on the side middles they're bound to", () => {
      API.setElements([
        API.createElement({
          type: "rectangle",
          id: "wide",
          x: 0,
          y: 100,
          width: 400,
          height: 40,
        }),
        API.createElement({
          type: "rectangle",
          id: "small",
          x: 360,
          y: 0,
          width: 60,
          height: 60,
        }),
      ]);
      drawArrow([200, 120], [390, 30]);

      expect(arrow().startBinding?.elementId).toBe("wide");
      expect(arrow().endBinding?.elementId).toBe("small");
      expect(sides()).toEqual(["right", "down"]);
      expectEndsOnBindings();

      // and again once a bound element moves
      drag([390, 30], [400, 20]);
      expect(sides()).toEqual(["right", "down"]);
      expectEndsOnBindings();
    });

    // elbow arrows route their own points
    if (arrowType !== "elbow") {
      it("puts the ends of a multi-point arrow on its side middles", () => {
        setupBoxes();
        // bent out to the left of the top box, then across to its right
        UI.clickTool("arrow");
        mouse.clickAt(50, 30);
        mouse.moveTo(-150, 30);
        mouse.clickAt(-150, 30);
        mouse.moveTo(400, -100);
        mouse.clickAt(400, -100);
        Keyboard.keyPress(KEYS.ENTER);
        expect(arrow().points).toHaveLength(3);

        // the start takes the side facing the free end
        drag([90, 50], [95, 50]);
        expect(sides()).toEqual(["right", null]);
        expectEndsOnBindings();
      });
    }

    it("loops an arrow drawn inside one element between two sides", () => {
      setupBoxes();
      drawArrow([30, 30], [70, 35]);

      expect(arrow().startBinding?.elementId).toBe("top");
      expect(arrow().endBinding?.elementId).toBe("top");
      const [start, end] = sides();
      expect(start).not.toBe(end);
      const [{ end: startPoint }, { end: endPoint }] = endsAndBindingPoints();
      expectEndsOnBindings();
      expect(
        Math.hypot(startPoint[0] - endPoint[0], startPoint[1] - endPoint[1]),
      ).toBeGreaterThan(30);
    });

    it("restores the sides on undo", () => {
      setupBoxes();
      drawArrow([50, 30], [50, 230]);
      drag([50, 230], [50, -270]);
      expect(sides()).toEqual(["up", "down"]);

      Keyboard.undo();

      expect(h.elements.find(({ id }) => id === "bottom")?.y).toBe(200);
      expect(sides()).toEqual(["down", "up"]);
    });

    it("moves the ends to the closest sides when the option is turned on", () => {
      API.setAppState({ currentItemArrowCardinal: false });
      setupBoxes();
      drawArrow([90, 62], [10, 198]);
      expect(arrow().cardinal).toBe(false);

      UI.clickOnTestId("arrow-ends-cardinal");

      expect(arrow().cardinal).toBe(true);
      expect(h.state.currentItemArrowCardinal).toBe(true);
      expect(sides()).toEqual(["down", "up"]);
      expect(arrow().startBinding?.fixedPoint[0]).toBeCloseTo(0.5);
      expect(arrow().endBinding?.fixedPoint[0]).toBeCloseTo(0.5);
    });

    it("faces the sides of rotated elements", () => {
      setupBoxes();
      // turned a quarter clockwise, the bottom box's left side faces up
      API.updateElement(h.elements.find(({ id }) => id === "bottom")!, {
        angle: (Math.PI / 2) as Radians,
      });
      drawArrow([50, 30], [50, 230]);

      expect(sides()).toEqual(["down", "left"]);
    });

    it("stays on the closest sides when the arrow type changes", () => {
      setupBoxes();
      drawArrow([50, 30], [50, 230]);

      UI.clickOnTestId(arrowType === "sharp" ? "elbow-arrow" : "sharp-arrow");
      expect(arrow().cardinal).toBe(true);
      expect(sides()).toEqual(["down", "up"]);

      drag([50, 230], [50, -270]);
      expect(sides()).toEqual(["up", "down"]);
    });

    it("keeps the anchors of an arrow that isn't cardinal", () => {
      API.setAppState({ currentItemArrowCardinal: false });
      setupBoxes();
      drawArrow([50, 62], [50, 198]);
      const anchors = () => [
        arrow().startBinding?.fixedPoint,
        arrow().endBinding?.fixedPoint,
      ];
      const before = anchors();

      drag([10, 250], [10, -250]);

      expect(arrow().cardinal).toBe(false);
      expect(arrow().endBinding?.elementId).toBe("bottom");
      expect(anchors()).toEqual(before);
    });
  },
);

describe("cardinal connector handles", () => {
  beforeEach(async () => {
    localStorage.clear();
    reseed(7);
    mouse.reset();
    await render(<Setsquare handleKeyboardGlobally={true} />);
  });

  it("connects with a cardinal arrow when the option is on", () => {
    API.setAppState({ currentItemArrowCardinal: true });
    setupBoxes();

    // the right handle of the top box
    mouse.moveTo(50, 30);
    mouse.moveTo(120, 30);
    mouse.downAt(120, 30);
    mouse.upAt(120, 30);

    expect(arrow().cardinal).toBe(true);
    expect(sides()).toEqual(["right", "left"]);

    const copy = h.elements.find(
      ({ id }) => id === arrow().endBinding?.elementId,
    )!;
    drag([copy.x + 10, copy.y + 10], [10, -290]);

    expect(sides()).toEqual(["up", "down"]);
  });
});

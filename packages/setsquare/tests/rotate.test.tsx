import React from "react";
import { expect } from "vitest";

import { arrayToMap, reseed } from "@setsquare/common";
import { getTransformHandles } from "@setsquare/element";

import { Setsquare } from "../index";

import { UI } from "./helpers/ui";
import { render, unmountComponent } from "./test-utils";

unmountComponent();

const { h } = window;

beforeEach(() => {
  localStorage.clear();
  reseed(7);
});

test("unselected bound arrow updates when rotating its target element", async () => {
  await render(<Setsquare />);
  const rectangle = UI.createElement("rectangle", {
    width: 200,
    height: 100,
  });
  const arrow = UI.createElement("arrow", {
    x: -80,
    y: 50,
    width: 85,
    height: 0,
  });

  expect(arrow.endBinding?.elementId).toEqual(rectangle.id);

  UI.rotate(rectangle, Math.PI / 3, { shift: true });

  expect(arrow.endBinding?.elementId).toEqual(rectangle.id);
  expect(arrow.x).toBeCloseTo(-80);
  expect(arrow.y).toBeCloseTo(50);
  expect(arrow.width).toBeCloseTo(132.491, 1);
  expect(arrow.height).toBeCloseTo(82.267, 1);
});

test("unselected bound arrows update when rotating their target elements", async () => {
  await render(<Setsquare />);
  const ellipse = UI.createElement("ellipse", {
    x: 0,
    y: 80,
    width: 300,
    height: 120,
  });
  const ellipseArrow = UI.createElement("arrow", {
    x: -10,
    y: 80,
    width: 50,
    height: 60,
  });
  const text = UI.createElement("text", {
    position: 220,
  });
  await UI.editText(text, "test");
  const textArrow = UI.createElement("arrow", {
    x: 360,
    y: 300,
    width: -140,
    height: -60,
  });

  expect(ellipseArrow.endBinding?.elementId).toEqual(ellipse.id);
  expect(textArrow.endBinding?.elementId).toEqual(text.id);

  UI.rotate([ellipse, text], -Math.PI / 4, { shift: true });

  expect(ellipseArrow.endBinding?.elementId).toEqual(ellipse.id);
  expect(ellipseArrow.x).toEqual(-10);
  expect(ellipseArrow.y).toEqual(80);
  expect(ellipseArrow.points[0]).toEqual([0, 0]);
  expect(ellipseArrow.points[1][0]).toBeCloseTo(66.317, 1);
  expect(ellipseArrow.points[1][1]).toBeCloseTo(144.38, 1);

  expect(textArrow.endBinding?.elementId).toEqual(text.id);
  expect(textArrow.x).toEqual(360);
  expect(textArrow.y).toEqual(300);
  expect(textArrow.points[0]).toEqual([0, 0]);
  expect(textArrow.points[1][0]).toBeCloseTo(-95.4635969899922, 0);
  expect(textArrow.points[1][1]).toBeCloseTo(-126.8785027399889, 0);
});

test("the rotation handle sits off the top-right corner", async () => {
  await render(<Setsquare />);
  const rectangle = UI.createElement("rectangle", { width: 200, height: 100 });

  const [x, y, width, height] = getTransformHandles(
    rectangle,
    h.state.zoom,
    arrayToMap(h.elements),
    "mouse",
  ).rotation!;

  expect(x).toBeGreaterThan(rectangle.x + rectangle.width);
  expect(y + height).toBeLessThan(rectangle.y);
  expect(width).toBeGreaterThan(0);
});

test("rotates a shape by the angle swept from where the handle was grabbed", async () => {
  await render(<Setsquare />);
  const rectangle = UI.createElement("rectangle", { width: 200, height: 100 });

  UI.rotate(rectangle, Math.PI / 7);

  expect(rectangle.angle).toBeCloseTo(Math.PI / 7);
});

test("rotates a selection by the angle swept from where the handle was grabbed", async () => {
  await render(<Setsquare />);
  const left = UI.createElement("rectangle", { width: 100, height: 100 });
  const right = UI.createElement("ellipse", {
    x: 200,
    width: 100,
    height: 100,
  });

  UI.rotate([left, right], Math.PI / 5);

  expect(left.angle).toBeCloseTo(Math.PI / 5);
  expect(right.angle).toBeCloseTo(Math.PI / 5);
});

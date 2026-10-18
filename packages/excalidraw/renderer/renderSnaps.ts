import { pointFrom, type GlobalPoint, type LocalPoint } from "@excalidraw/math";

import { THEME } from "@excalidraw/common";

import { roundRect } from "./roundRect";

import type { PointSnapLine, PointerSnapLine } from "../snapping";
import type { InteractiveCanvasAppState } from "../types";

// Snaps are construction marks, so they're drawn in the theme's non-photo
// blue: alignment guides in `--guide`, spacing dimensions in `--ink` (see
// theme.scss)
const GUIDE_COLOR = { [THEME.LIGHT]: "#2399bf", [THEME.DARK]: "#4cc3e6" };
const DIMENSION_COLOR = { [THEME.LIGHT]: "#0b7ea3", [THEME.DARK]: "#5cc8ea" };
const DIMENSION_LABEL_COLOR = {
  [THEME.LIGHT]: "#ffffff",
  [THEME.DARK]: "#171e1b",
};
const SNAP_WIDTH = 1;
const SNAP_CROSS_SIZE = 2;
const GUIDE_DASH = [4, 3];
/** how far an alignment guide runs past the aligned points, in screen px */
const GUIDE_OVERSHOOT = 14;
/** half the length of a dimension line's 45° end tick, in screen px */
const DIMENSION_TICK = 4;
const DIMENSION_TICK_WIDTH = 1.5;
const DIMENSION_LABEL_FONT_SIZE = 11;
const DIMENSION_LABEL_HEIGHT = 14;
const DIMENSION_LABEL_PADDING = 3;

export const renderSnaps = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  if (!appState.snapLines.length) {
    return;
  }

  const guideColor = GUIDE_COLOR[appState.theme];
  const dimensionColor = DIMENSION_COLOR[appState.theme];
  // in zen mode make the cross more visible since we don't draw the lines
  const snapWidth =
    (appState.zenModeEnabled ? SNAP_WIDTH * 1.5 : SNAP_WIDTH) /
    appState.zoom.value;

  context.save();
  context.translate(appState.scrollX, appState.scrollY);

  for (const snapLine of appState.snapLines) {
    context.lineWidth = snapWidth;
    if (snapLine.type === "pointer") {
      context.strokeStyle = guideColor;

      drawPointerSnapLine(snapLine, context, appState);
    } else if (snapLine.type === "gap") {
      context.strokeStyle = dimensionColor;

      drawDimensionLine(
        snapLine.points[0],
        snapLine.points[1],
        snapLine.direction,
        appState,
        context,
      );
    } else if (snapLine.type === "points") {
      context.strokeStyle = guideColor;
      drawPointsSnapLine(snapLine, context, appState);
    }
  }

  context.restore();
};

const drawPointsSnapLine = (
  pointSnapLine: PointSnapLine,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  if (!appState.zenModeEnabled) {
    const firstPoint = pointSnapLine.points[0];
    const lastPoint = pointSnapLine.points[pointSnapLine.points.length - 1];

    drawGuide(firstPoint, lastPoint, appState, context);
  }

  for (const point of pointSnapLine.points) {
    drawCross(point, appState, context);
  }
};

const drawPointerSnapLine = (
  pointerSnapLine: PointerSnapLine,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
) => {
  drawCross(pointerSnapLine.points[0], appState, context);
  if (!appState.zenModeEnabled) {
    drawGuide(
      pointerSnapLine.points[0],
      pointerSnapLine.points[1],
      appState,
      context,
    );
  }
};

/** a dashed alignment guide, running a little past both ends */
const drawGuide = <Point extends LocalPoint | GlobalPoint>(
  from: Point,
  to: Point,
  appState: InteractiveCanvasAppState,
  context: CanvasRenderingContext2D,
) => {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const overshoot = length ? GUIDE_OVERSHOOT / appState.zoom.value / length : 0;
  const dx = (to[0] - from[0]) * overshoot;
  const dy = (to[1] - from[1]) * overshoot;

  context.save();
  context.setLineDash(GUIDE_DASH.map((dash) => dash / appState.zoom.value));
  drawLine(
    pointFrom(from[0] - dx, from[1] - dy),
    pointFrom(to[0] + dx, to[1] + dy),
    context,
  );
  context.restore();
};

const drawCross = <Point extends LocalPoint | GlobalPoint>(
  [x, y]: Point,
  appState: InteractiveCanvasAppState,
  context: CanvasRenderingContext2D,
) => {
  context.save();
  const size =
    (appState.zenModeEnabled ? SNAP_CROSS_SIZE * 1.5 : SNAP_CROSS_SIZE) /
    appState.zoom.value;
  context.beginPath();

  context.moveTo(x - size, y - size);
  context.lineTo(x + size, y + size);

  context.moveTo(x + size, y - size);
  context.lineTo(x - size, y + size);

  context.stroke();
  context.restore();
};

const drawLine = <Point extends LocalPoint | GlobalPoint>(
  from: Point,
  to: Point,
  context: CanvasRenderingContext2D,
) => {
  context.beginPath();
  context.lineTo(from[0], from[1]);
  context.lineTo(to[0], to[1]);
  context.stroke();
};

/**
 * An equal-spacing snap, drawn as an architectural dimension line: 45° ticks
 * where it meets the shapes' edges and the gap measured on a filled label.
 * Every gap snap is an equal gap, so matching labels show the spacing is
 * even. In zen mode only the label is drawn.
 *
 * |/–––––– 40 ––––––/|
 */
const drawDimensionLine = <Point extends LocalPoint | GlobalPoint>(
  from: Point,
  to: Point,
  direction: "horizontal" | "vertical",
  appState: InteractiveCanvasAppState,
  context: CanvasRenderingContext2D,
) => {
  const zoom = appState.zoom.value;

  if (!appState.zenModeEnabled) {
    drawLine(from, to, context);

    const tick = DIMENSION_TICK / zoom;
    context.save();
    context.lineWidth = DIMENSION_TICK_WIDTH / zoom;
    for (const [x, y] of [from, to]) {
      drawLine(
        pointFrom(x - tick, y + tick),
        pointFrom(x + tick, y - tick),
        context,
      );
    }
    context.restore();
  }

  const gap =
    direction === "horizontal"
      ? Math.abs(to[0] - from[0])
      : Math.abs(to[1] - from[1]);
  const label = `${Math.round(gap)}`;

  context.save();
  context.font = `700 ${
    DIMENSION_LABEL_FONT_SIZE / zoom
  }px "D-DIN Condensed", sans-serif`;
  const width =
    context.measureText(label).width + (DIMENSION_LABEL_PADDING * 2) / zoom;
  const height = DIMENSION_LABEL_HEIGHT / zoom;
  const centerX = (from[0] + to[0]) / 2;
  const centerY = (from[1] + to[1]) / 2;

  // filled and outlined in the dimension color
  context.fillStyle = DIMENSION_COLOR[appState.theme];
  roundRect(
    context,
    centerX - width / 2,
    centerY - height / 2,
    width,
    height,
    2 / zoom,
  );

  context.fillStyle = DIMENSION_LABEL_COLOR[appState.theme];
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, centerX, centerY);
  context.restore();
};

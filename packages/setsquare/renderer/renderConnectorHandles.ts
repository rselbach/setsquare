import {
  OPPOSITE_LINK_DIRECTION,
  LINK_DIRECTION_VECTORS,
  getBoundsSidePoint,
  getConnectorHandles,
  getElementBounds,
  getLinkDirectionBetween,
} from "@setsquare/element";
import { pointFrom, type GlobalPoint } from "@setsquare/math";

import type { Bounds } from "@setsquare/common";
import type { SetsquareElement } from "@setsquare/element/types";

import type { InteractiveCanvasAppState } from "../types";
import type {
  ConnectorHandlesRenderConfig,
  RenderableElementsMap,
} from "../scene/types";

/** screen px: a handle is a drafting arrowhead pointing away from the shape */
const ARROWHEAD_LENGTH = 12;
const ARROWHEAD_HALF_WIDTH = 5;
const IDLE_OPACITY = 0.45;
const PREVIEW_DASH = [4, 3];

const drawArrowhead = (
  context: CanvasRenderingContext2D,
  [x, y]: GlobalPoint,
  [dx, dy]: readonly [number, number],
  zoom: number,
) => {
  const length = ARROWHEAD_LENGTH / zoom;
  const halfWidth = ARROWHEAD_HALF_WIDTH / zoom;
  context.beginPath();
  context.moveTo(x + (dx * length) / 2, y + (dy * length) / 2);
  context.lineTo(
    x - (dx * length) / 2 - dy * halfWidth,
    y - (dy * length) / 2 + dx * halfWidth,
  );
  context.lineTo(
    x - (dx * length) / 2 + dy * halfWidth,
    y - (dy * length) / 2 - dx * halfWidth,
  );
  context.closePath();
  context.fill();
};

/** the outline of the shape a click or drop would add, centered on `center` */
const strokeGhost = (
  context: CanvasRenderingContext2D,
  element: SetsquareElement,
  [cx, cy]: GlobalPoint,
) => {
  const halfWidth = element.width / 2;
  const halfHeight = element.height / 2;
  context.beginPath();
  if (element.type === "ellipse") {
    context.ellipse(cx, cy, halfWidth, halfHeight, 0, 0, Math.PI * 2);
  } else if (element.type === "diamond") {
    context.moveTo(cx, cy - halfHeight);
    context.lineTo(cx + halfWidth, cy);
    context.lineTo(cx, cy + halfHeight);
    context.lineTo(cx - halfWidth, cy);
    context.closePath();
  } else {
    context.rect(
      cx - halfWidth,
      cy - halfHeight,
      element.width,
      element.height,
    );
  }
  context.stroke();
};

/**
 * The connector handles around a hovered shape. They're construction marks,
 * drawn in the selection's non-photo blue: faint until one is under the
 * pointer, which then previews the connector it would add.
 */
export const renderConnectorHandles = (
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  elementsMap: RenderableElementsMap,
  connectorHandles: ConnectorHandlesRenderConfig,
  color: string,
) => {
  const element = elementsMap.get(connectorHandles.elementId);
  if (!element) {
    return;
  }
  const zoom = appState.zoom.value;

  context.save();
  context.translate(appState.scrollX, appState.scrollY);
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = 1 / zoom;

  for (const handle of getConnectorHandles(
    element,
    elementsMap,
    appState.zoom,
  )) {
    context.globalAlpha =
      handle.direction === connectorHandles.active ? 1 : IDLE_OPACITY;
    drawArrowhead(
      context,
      handle.center,
      LINK_DIRECTION_VECTORS[handle.direction],
      zoom,
    );
  }

  const { active, preview } = connectorHandles;
  if (active && preview) {
    const target =
      preview.type === "target" ? elementsMap.get(preview.elementId) : null;
    const endBounds: Bounds | null = target
      ? getElementBounds(target, elementsMap)
      : preview.type === "node"
        ? [
            preview.center[0] - element.width / 2,
            preview.center[1] - element.height / 2,
            preview.center[0] + element.width / 2,
            preview.center[1] + element.height / 2,
          ]
        : null;

    if (endBounds) {
      const startBounds = getElementBounds(element, elementsMap);
      const endDirection = getLinkDirectionBetween(
        pointFrom(
          (startBounds[0] + startBounds[2]) / 2,
          (startBounds[1] + startBounds[3]) / 2,
        ),
        pointFrom(
          (endBounds[0] + endBounds[2]) / 2,
          (endBounds[1] + endBounds[3]) / 2,
        ),
      );
      const [x1, y1] = getBoundsSidePoint(startBounds, active);
      const [x2, y2] = getBoundsSidePoint(
        endBounds,
        OPPOSITE_LINK_DIRECTION[endDirection],
      );

      context.globalAlpha = 1;
      context.setLineDash(PREVIEW_DASH.map((dash) => dash / zoom));
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();

      if (target) {
        const margin = 4 / zoom;
        context.strokeRect(
          endBounds[0] - margin,
          endBounds[1] - margin,
          endBounds[2] - endBounds[0] + margin * 2,
          endBounds[3] - endBounds[1] + margin * 2,
        );
      } else if (preview.type === "node") {
        strokeGhost(context, element, preview.center);
      }
    }
  }

  context.restore();
};

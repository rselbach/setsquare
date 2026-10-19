import { pointDistance, pointFrom, type GlobalPoint } from "@setsquare/math";

import type { Bounds } from "@setsquare/common";
import type { AppState } from "@setsquare/setsquare/types";

import { getElementBounds } from "./bounds";

import type { LinkDirection } from "./flowchart";
import type { ElementsMap, SetsquareElement } from "./types";

/** A handle beside a shape that offers to connect it in a direction. */
export type ConnectorHandle = {
  direction: LinkDirection;
  /** the handle's center, in scene coords */
  center: GlobalPoint;
};

/** screen px from a shape's bounds to its handles' centers */
const HANDLE_OFFSET = 20;
/** screen px around a handle's center that count as on it */
const HANDLE_HIT_RADIUS = 12;

export const LINK_DIRECTION_VECTORS: Readonly<
  Record<LinkDirection, readonly [dx: number, dy: number]>
> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

const LINK_DIRECTIONS = Object.keys(LINK_DIRECTION_VECTORS) as LinkDirection[];

export const OPPOSITE_LINK_DIRECTION: Readonly<
  Record<LinkDirection, LinkDirection>
> = {
  up: "down",
  right: "left",
  down: "up",
  left: "right",
};

/** The point `distance` out from the middle of the bounds' side facing `direction`. */
export const getBoundsSidePoint = (
  [x1, y1, x2, y2]: Bounds,
  direction: LinkDirection,
  distance = 0,
) => {
  const [dx, dy] = LINK_DIRECTION_VECTORS[direction];
  return pointFrom<GlobalPoint>(
    (x1 + x2) / 2 + dx * ((x2 - x1) / 2 + distance),
    (y1 + y2) / 2 + dy * ((y2 - y1) / 2 + distance),
  );
};

/** The direction `to` lies in from `from`, along the axis they're further apart on. */
export const getLinkDirectionBetween = (
  from: GlobalPoint,
  to: GlobalPoint,
): LinkDirection => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? "right" : "left";
  }
  return dy >= 0 ? "down" : "up";
};

export const getConnectorHandles = (
  element: SetsquareElement,
  elementsMap: ElementsMap,
  zoom: AppState["zoom"],
): ConnectorHandle[] => {
  const bounds = getElementBounds(element, elementsMap);
  return LINK_DIRECTIONS.map((direction) => ({
    direction,
    center: getBoundsSidePoint(bounds, direction, HANDLE_OFFSET / zoom.value),
  }));
};

export const getConnectorHandleAt = (
  handles: readonly ConnectorHandle[],
  point: GlobalPoint,
  zoom: AppState["zoom"],
) =>
  handles.find(
    (handle) =>
      pointDistance(handle.center, point) <= HANDLE_HIT_RADIUS / zoom.value,
  ) ?? null;

/** Whether the point is close enough to the element to be on its way to one of its handles. */
export const isNearConnectorHandles = (
  element: SetsquareElement,
  elementsMap: ElementsMap,
  point: GlobalPoint,
  zoom: AppState["zoom"],
) => {
  const [x1, y1, x2, y2] = getElementBounds(element, elementsMap);
  const margin = (HANDLE_OFFSET + HANDLE_HIT_RADIUS) / zoom.value;
  return (
    point[0] >= x1 - margin &&
    point[0] <= x2 + margin &&
    point[1] >= y1 - margin &&
    point[1] <= y2 + margin
  );
};

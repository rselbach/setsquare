import {
  lineSegment,
  pointDistanceSq,
  pointFrom,
  pointRotateRads,
  type GlobalPoint,
  type Radians,
} from "@setsquare/math";

import { getBindingGap, normalizeFixedPoint } from "./binding";
import { elementCenterPoint } from "./bounds";
import { intersectElementWithLineSegment } from "./collision";
import { LINK_DIRECTION_VECTORS } from "./connectorHandles";
import { isBindableElement } from "./typeChecks";

import type { LinkDirection } from "./flowchart";
import type {
  ElementsMap,
  SetsquareArrowElement,
  SetsquareBindableElement,
  FixedPoint,
  FixedPointBinding,
} from "./types";

/** Where a cardinal arrow end sticks to an element: the middle of a side. */
export type CardinalAnchor = {
  side: LinkDirection;
  /** one binding gap out from the side, where the arrow end sits */
  point: GlobalPoint;
};

/** An arrow end: the element it's bound to, or the point it's left at. */
type CardinalEnd = {
  element: SetsquareBindableElement | null;
  point: GlobalPoint;
};

const SIDES = Object.keys(LINK_DIRECTION_VECTORS) as LinkDirection[];

const getCardinalAnchors = (
  element: SetsquareBindableElement,
  elementsMap: ElementsMap,
): CardinalAnchor[] => {
  const center = elementCenterPoint(element, elementsMap);
  const gap = getBindingGap(element);
  const halfWidth = element.width / 2;
  const halfHeight = element.height / 2;
  const reach = Math.max(element.width, element.height) + gap * 2;

  return SIDES.map((side) => {
    const [dx, dy] = LINK_DIRECTION_VECTORS[side];
    const outward = (distance: number) =>
      pointRotateRads(
        pointFrom<GlobalPoint>(
          center[0] + dx * distance,
          center[1] + dy * distance,
        ),
        center,
        element.angle,
      );
    const far = outward(reach);
    // the outline crossing keeps the gap other bound arrows keep, which
    // matters for diamonds and rounded corners
    const [crossing] = intersectElementWithLineSegment(
      element,
      elementsMap,
      lineSegment(center, far),
      gap,
    ).sort((a, b) => pointDistanceSq(a, far) - pointDistanceSq(b, far));

    return {
      side,
      point: crossing ?? outward((dx ? halfWidth : halfHeight) + gap),
    };
  });
};

/**
 * The anchors on the two ends that lie closest to each other. An end that
 * isn't bound stays where it is, and the other end faces it.
 */
export const getClosestCardinalAnchors = (
  start: CardinalEnd,
  end: CardinalEnd,
  elementsMap: ElementsMap,
): { start: CardinalAnchor | null; end: CardinalAnchor | null } => {
  const startAnchors = start.element
    ? getCardinalAnchors(start.element, elementsMap)
    : [null];
  const endAnchors = end.element
    ? getCardinalAnchors(end.element, elementsMap)
    : [null];
  const isLoop = !!start.element && start.element.id === end.element?.id;

  let closest = { start: startAnchors[0], end: endAnchors[0] };
  let closestDistance = Infinity;
  for (const startAnchor of startAnchors) {
    for (const endAnchor of endAnchors) {
      // an arrow from an element back to itself leaves and enters on
      // different sides
      if (isLoop && startAnchor?.side === endAnchor?.side) {
        continue;
      }
      const distance = pointDistanceSq(
        startAnchor?.point ?? start.point,
        endAnchor?.point ?? end.point,
      );
      if (distance < closestDistance) {
        closest = { start: startAnchor, end: endAnchor };
        closestDistance = distance;
      }
    }
  }
  return closest;
};

/** The binding ratio that puts the arrow end at `point` on `element`. */
const getFixedPointAt = (
  element: SetsquareBindableElement,
  point: GlobalPoint,
  elementsMap: ElementsMap,
): FixedPoint => {
  const [x, y] = pointRotateRads(
    point,
    elementCenterPoint(element, elementsMap),
    -element.angle as Radians,
  );
  // the floor keeps the ratio bounded for elements thinner than the gap,
  // as `calculateFixedPointForElbowArrowBinding` does
  const sizeFloor = getBindingGap(element);
  return normalizeFixedPoint([
    (x - element.x) / Math.max(element.width, sizeFloor),
    (y - element.y) / Math.max(element.height, sizeFloor),
  ]);
};

/** `binding`, moved to `anchor`; the same object when it's there already. */
const getCardinalBinding = (
  binding: FixedPointBinding,
  element: SetsquareBindableElement,
  anchor: CardinalAnchor,
  elementsMap: ElementsMap,
): FixedPointBinding => {
  const fixedPoint = getFixedPointAt(element, anchor.point, elementsMap);
  return binding.mode === "orbit" &&
    binding.fixedPoint[0] === fixedPoint[0] &&
    binding.fixedPoint[1] === fixedPoint[1]
    ? binding
    : { ...binding, mode: "orbit", fixedPoint };
};

/**
 * The bindings of a cardinal arrow that move when its bound ends go to the
 * sides of their elements that lie closest to each other.
 */
export const getCardinalBindingUpdates = (
  arrow: Pick<
    SetsquareArrowElement,
    "x" | "y" | "points" | "startBinding" | "endBinding"
  >,
  elementsMap: ElementsMap,
): { startBinding?: FixedPointBinding; endBinding?: FixedPointBinding } => {
  const { startBinding, endBinding, points } = arrow;
  const startElement = getBoundElement(startBinding, elementsMap);
  const endElement = getBoundElement(endBinding, elementsMap);
  if (!startElement && !endElement) {
    return {};
  }

  const anchors = getClosestCardinalAnchors(
    {
      element: startElement,
      point: pointFrom(arrow.x + points[0][0], arrow.y + points[0][1]),
    },
    {
      element: endElement,
      point: pointFrom(
        arrow.x + points[points.length - 1][0],
        arrow.y + points[points.length - 1][1],
      ),
    },
    elementsMap,
  );
  const updates: {
    startBinding?: FixedPointBinding;
    endBinding?: FixedPointBinding;
  } = {};
  if (startBinding && startElement && anchors.start) {
    const next = getCardinalBinding(
      startBinding,
      startElement,
      anchors.start,
      elementsMap,
    );
    if (next !== startBinding) {
      updates.startBinding = next;
    }
  }
  if (endBinding && endElement && anchors.end) {
    const next = getCardinalBinding(
      endBinding,
      endElement,
      anchors.end,
      elementsMap,
    );
    if (next !== endBinding) {
      updates.endBinding = next;
    }
  }
  return updates;
};

const getBoundElement = (
  binding: FixedPointBinding | null,
  elementsMap: ElementsMap,
) => {
  const element = binding && elementsMap.get(binding.elementId);
  return element && !element.isDeleted && isBindableElement(element)
    ? element
    : null;
};

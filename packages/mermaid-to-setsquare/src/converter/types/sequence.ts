import { nanoid } from "nanoid";

import type { SetsquareElementSkeleton } from "@setsquare/element/transform";

import { GraphConverter } from "../GraphConverter.js";

import {
  transformToSetsquareLineSkeleton,
  transformToSetsquareTextSkeleton,
  transformToSetsquareContainerSkeleton,
  transformToSetsquareArrowSkeleton,
} from "../transformToSetsquareSkeleton.js";

import type { Sequence } from "../../parser/sequence.js";

const GROUP_RECT_PADDING = 10;
const GROUP_LABEL_FONT_SIZE = 16;
const GROUP_LABEL_VERTICAL_OFFSET = 24;
const GROUP_LABEL_HORIZONTAL_OFFSET = 4;

const isTransparentFill = (fill?: string) => {
  if (!fill) {
    return true;
  }
  const normalizedFill = fill.trim().toLowerCase();
  return (
    normalizedFill === "transparent" ||
    normalizedFill === "none" ||
    normalizedFill === "rgba(0,0,0,0)" ||
    normalizedFill === "rgba(0, 0, 0, 0)"
  );
};

const estimateTextWidth = (text: string, fontSize: number) => {
  return Math.max(20, Math.round(text.length * fontSize * 0.6));
};

const addGroupId = (
  element: SetsquareElementSkeleton,
  groupId: string,
  includeLabel = true,
) => {
  const mutableElement = element as any;
  const existingGroupIds = mutableElement.groupIds ?? [];
  if (!existingGroupIds.includes(groupId)) {
    mutableElement.groupIds = [...existingGroupIds, groupId];
  }

  if (!includeLabel || !mutableElement.label) {
    return;
  }

  const labelGroupIds = mutableElement.label.groupIds ?? [];
  if (!labelGroupIds.includes(groupId)) {
    mutableElement.label.groupIds = [...labelGroupIds, groupId];
  }
};

export const SequenceToSetsquareSkeletonConvertor = new GraphConverter({
  converter: (chart: Sequence) => {
    const elements: SetsquareElementSkeleton[] = [];
    const activations: SetsquareElementSkeleton[] = [];
    Object.values(chart.nodes).forEach((node) => {
      if (!node || !node.length) {
        return;
      }
      node.forEach((element) => {
        let setsquareElement: SetsquareElementSkeleton;

        switch (element.type) {
          case "line":
            setsquareElement = transformToSetsquareLineSkeleton(element);
            break;

          case "rectangle":
          case "ellipse":
            setsquareElement = transformToSetsquareContainerSkeleton(element);
            break;

          case "text":
            setsquareElement = transformToSetsquareTextSkeleton(element);
            break;
          default:
            throw new Error(`unknown type ${element.type}`);
        }
        if (element.type === "rectangle" && element?.subtype === "activation") {
          activations.push(setsquareElement);
        } else {
          elements.push(setsquareElement);
        }
      });
    });

    Object.values(chart.lines).forEach((line) => {
      if (!line) {
        return;
      }
      elements.push(transformToSetsquareLineSkeleton(line));
    });

    Object.values(chart.arrows).forEach((arrow) => {
      if (!arrow) {
        return;
      }

      elements.push(transformToSetsquareArrowSkeleton(arrow));
      if (arrow.sequenceNumber) {
        elements.push(
          transformToSetsquareContainerSkeleton(arrow.sequenceNumber),
        );
      }
    });
    elements.push(...activations);

    // loops
    if (chart.loops) {
      const { lines, texts, nodes } = chart.loops;
      lines.forEach((line) => {
        elements.push(transformToSetsquareLineSkeleton(line));
      });
      texts.forEach((text) => {
        elements.push(transformToSetsquareTextSkeleton(text));
      });
      nodes.forEach((node) => {
        elements.push(transformToSetsquareContainerSkeleton(node));
      });
    }

    if (chart.groups) {
      chart.groups.forEach((group) => {
        const { actorKeys, name } = group;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = 0;
        let maxY = 0;
        if (!actorKeys.length) {
          return;
        }
        const actors = elements.filter((ele) => {
          if (ele.id) {
            const hyphenIndex = ele.id.indexOf("-");
            const id = ele.id.substring(0, hyphenIndex);
            return actorKeys.includes(id);
          }
          return false;
        });
        if (!actors.length) {
          return;
        }

        actors.forEach((actor) => {
          if (
            actor.x === undefined ||
            actor.y === undefined ||
            actor.width === undefined ||
            actor.height === undefined
          ) {
            return;
          }
          minX = Math.min(minX, actor.x);
          minY = Math.min(minY, actor.y);
          maxX = Math.max(maxX, actor.x + actor.width);
          maxY = Math.max(maxY, actor.y + actor.height);
        });
        if (
          !Number.isFinite(minX) ||
          !Number.isFinite(minY) ||
          !Number.isFinite(maxX) ||
          !Number.isFinite(maxY)
        ) {
          return;
        }

        // Draw a plain rectangle that hugs the grouped content.
        const groupRectX = minX - GROUP_RECT_PADDING;
        const groupRectY = minY - GROUP_RECT_PADDING;
        const groupRectWidth = maxX - minX + GROUP_RECT_PADDING * 2;
        const groupRectHeight = maxY - minY + GROUP_RECT_PADDING * 2;
        const groupRectId = nanoid();
        const groupId = nanoid();
        const groupRect = transformToSetsquareContainerSkeleton({
          type: "rectangle",
          x: groupRectX,
          y: groupRectY,
          width: groupRectWidth,
          height: groupRectHeight,
          bgColor: isTransparentFill(group.fill) ? undefined : group.fill,
          strokeColor: "#1f1f1f",
          strokeWidth: 1,
          id: groupRectId,
          groupId,
        });
        elements.unshift(groupRect);

        elements.forEach((ele) => {
          if (ele.id === groupRectId) {
            return;
          }
          if (
            ele.x === undefined ||
            ele.y === undefined ||
            ele.width === undefined ||
            ele.height === undefined
          ) {
            return;
          }
          if (
            ele.x >= minX &&
            ele.x + ele.width <= maxX &&
            ele.y >= minY &&
            ele.y + ele.height <= maxY
          ) {
            addGroupId(ele, groupId);
          }
        });

        if (name) {
          const groupLabel = transformToSetsquareTextSkeleton({
            type: "text",
            id: nanoid(),
            text: name,
            x: groupRectX + GROUP_LABEL_HORIZONTAL_OFFSET,
            y: groupRectY - GROUP_LABEL_VERTICAL_OFFSET,
            width: estimateTextWidth(name, GROUP_LABEL_FONT_SIZE),
            height: GROUP_LABEL_FONT_SIZE + 8,
            fontSize: GROUP_LABEL_FONT_SIZE,
            color: "#1f1f1f",
            groupId,
          });
          addGroupId(groupLabel, groupId, false);
          elements.push(groupLabel);
        }
      });
    }
    return { elements };
  },
});

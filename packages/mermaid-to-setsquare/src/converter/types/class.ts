import { nanoid } from "nanoid";

import type { SetsquareElementSkeleton } from "@setsquare/element/transform";

import {
  transformToSetsquareArrowSkeleton,
  transformToSetsquareContainerSkeleton,
  transformToSetsquareLineSkeleton,
  transformToSetsquareTextSkeleton,
} from "../transformToSetsquareSkeleton.js";
import { GraphConverter } from "../GraphConverter.js";

import type { Class } from "../../parser/class.js";

export const classToSetsquareSkeletonConvertor = new GraphConverter({
  converter: (chart: Class) => {
    const elements: SetsquareElementSkeleton[] = [];

    chart.nodes.forEach((node) => {
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
        elements.push(setsquareElement);
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
      const setsquareElement = transformToSetsquareArrowSkeleton(arrow);
      elements.push(setsquareElement);
    });

    Object.values(chart.text).forEach((ele) => {
      const setsquareElement = transformToSetsquareTextSkeleton(ele);

      elements.push(setsquareElement);
    });

    Object.values(chart.namespaces).forEach((namespace) => {
      const classIds = Object.keys(namespace.classes);
      const children = [...classIds];
      const chartElements = [...chart.lines, ...chart.arrows, ...chart.text];
      classIds.forEach((classId) => {
        const childIds = chartElements
          .filter((ele) => ele.metadata && ele.metadata.classId === classId)
          .map((ele) => ele.id);

        if (childIds.length) {
          children.push(...(childIds as string[]));
        }
      });
      const frame: SetsquareElementSkeleton = {
        type: "frame",
        id: nanoid(),
        name: namespace.id,
        children,
      };
      elements.push(frame);
    });
    return { elements };
  },
});

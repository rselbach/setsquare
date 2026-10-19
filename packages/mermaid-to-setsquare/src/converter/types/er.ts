import type { SetsquareElementSkeleton } from "@setsquare/element/transform";

import {
  transformToSetsquareArrowSkeleton,
  transformToSetsquareContainerSkeleton,
  transformToSetsquareLineSkeleton,
  transformToSetsquareTextSkeleton,
} from "../transformToSetsquareSkeleton.js";
import { GraphConverter } from "../GraphConverter.js";

import type { ERD } from "../../parser/er.js";

export const erToSetsquareSkeletonConvertor = new GraphConverter({
  converter: (chart: ERD) => {
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

    chart.lines.forEach((line) => {
      elements.push(transformToSetsquareLineSkeleton(line));
    });

    chart.arrows.forEach((arrow) => {
      elements.push(transformToSetsquareArrowSkeleton(arrow));
    });

    chart.text.forEach((textElement) => {
      elements.push(transformToSetsquareTextSkeleton(textElement));
    });

    return { elements };
  },
});

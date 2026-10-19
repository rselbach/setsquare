import type { LocalPoint } from "@setsquare/math/types";

import { FlowchartToSetsquareSkeletonConverter } from "./converter/types/flowchart.js";
import { GraphImageConverter } from "./converter/types/graphImage.js";

import { SequenceToSetsquareSkeletonConvertor } from "./converter/types/sequence.js";

import { classToSetsquareSkeletonConvertor } from "./converter/types/class.js";

import { erToSetsquareSkeletonConvertor } from "./converter/types/er.js";

import { stateToSetsquareSkeletonConvertor } from "./converter/types/state.js";

import { dedupeConsecutivePoints } from "./utils.js";

import type { GraphImage, MermaidToSetsquareResult } from "./interfaces.js";
import type { Sequence } from "./parser/sequence.js";
import type { Flowchart } from "./parser/flowchart.js";
import type { Class } from "./parser/class.js";

import type { ERD } from "./parser/er.js";

import type { State } from "./parser/state.js";

import type { SetsquareConfig } from "./index.js";

const normalizeLinearElementPoints = (
  result: MermaidToSetsquareResult,
): MermaidToSetsquareResult => {
  return {
    ...result,
    elements: result.elements.map((element) => {
      if (!("points" in element) || !Array.isArray(element.points)) {
        return element;
      }

      const points = element.points as readonly LocalPoint[];
      if (points.length < 2) {
        return element;
      }

      const dedupedPoints = dedupeConsecutivePoints(points);
      if (dedupedPoints.length === points.length) {
        return element;
      }

      return {
        ...element,
        points: dedupedPoints,
      };
    }),
  };
};

export const graphToSetsquare = (
  graph: Flowchart | GraphImage | Sequence | Class | ERD | State,
  options: SetsquareConfig = {},
): MermaidToSetsquareResult => {
  const result = (() => {
    switch (graph.type) {
      case "graphImage": {
        return GraphImageConverter.convert(graph, options);
      }

      case "flowchart": {
        return FlowchartToSetsquareSkeletonConverter.convert(graph, options);
      }

      case "sequence": {
        return SequenceToSetsquareSkeletonConvertor.convert(graph, options);
      }

      case "class": {
        return classToSetsquareSkeletonConvertor.convert(graph, options);
      }

      case "erd": {
        return erToSetsquareSkeletonConvertor.convert(graph, options);
      }

      case "state": {
        return stateToSetsquareSkeletonConvertor.convert(graph, options);
      }

      default: {
        throw new Error(
          `graphToSetsquare: unknown graph type "${
            (graph as any).type
          }, only flowcharts are supported!"`,
        );
      }
    }
  })();

  return normalizeLinearElementPoints(result);
};

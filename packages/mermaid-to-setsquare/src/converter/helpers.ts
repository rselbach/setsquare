import type { SetsquareTextElement } from "@setsquare/element/types";
import type { Arrowhead } from "@setsquare/element/types";

import type { Mutable } from "@setsquare/common/utility-types";

import {
  CONTAINER_STYLE_PROPERTY,
  LABEL_STYLE_PROPERTY,
} from "../interfaces.js";

import { removeMarkdown } from "../markdownToText.js";

import type {
  ContainerStyle,
  LabelStyle,
  SubGraph,
  Vertex,
} from "../interfaces.js";
import type { SetsquareVertexElement } from "../types.js";

import type { Edge } from "../parser/flowchart.js";

/**
 * Compute groupIds for each element
 */
export interface ArrowType {
  startArrowhead?: Arrowhead | null;
  endArrowhead?: Arrowhead | null;
}
/**
 * Convert mermaid edge type to Setsquare arrow type
 */
const MERMAID_EDGE_TYPE_MAPPER: { [key: string]: ArrowType } = {
  arrow_circle: {
    endArrowhead: "circle",
  },
  arrow_cross: {
    endArrowhead: "bar",
  },
  arrow_open: {
    endArrowhead: null,
    startArrowhead: null,
  },
  double_arrow_circle: {
    endArrowhead: "circle",
    startArrowhead: "circle",
  },
  double_arrow_cross: {
    endArrowhead: "bar",
    startArrowhead: "bar",
  },
  double_arrow_point: {
    endArrowhead: "arrow",
    startArrowhead: "arrow",
  },
};

export const computeSetsquareArrowType = (
  mermaidArrowType: string,
): ArrowType => {
  return MERMAID_EDGE_TYPE_MAPPER[mermaidArrowType];
};

// Get text from graph elements, fallback markdown to text
export const getText = (element: Vertex | Edge | SubGraph): string => {
  let text = element.text;
  if (element.labelType === "markdown") {
    text = removeMarkdown(element.text);
  }

  return removeFontAwesomeIcons(text);
};

/**
 * Remove font awesome icons support from text
 */
const removeFontAwesomeIcons = (input: string): string => {
  const fontAwesomeRegex = /\s?(fa|fab):[a-zA-Z0-9-]+/g;
  return input.replace(fontAwesomeRegex, "");
};

/**
 * Compute style for vertex
 */
export const computeSetsquareVertexStyle = (
  style: ContainerStyle,
): Partial<Mutable<SetsquareVertexElement>> => {
  const setsquareProperty: Partial<Mutable<SetsquareVertexElement>> = {};
  Object.keys(style).forEach((property) => {
    switch (property) {
      case CONTAINER_STYLE_PROPERTY.FILL: {
        setsquareProperty.backgroundColor = style[property];
        setsquareProperty.fillStyle = "solid";
        break;
      }
      case CONTAINER_STYLE_PROPERTY.STROKE: {
        setsquareProperty.strokeColor = style[property];
        break;
      }
      case CONTAINER_STYLE_PROPERTY.STROKE_WIDTH: {
        setsquareProperty.strokeWidth = Number(style[property]?.split("px")[0]);
        break;
      }
      case CONTAINER_STYLE_PROPERTY.STROKE_DASHARRAY: {
        setsquareProperty.strokeStyle = "dashed";
        break;
      }
    }
  });
  return setsquareProperty;
};

/**
 * Compute style for label
 */
export const computeSetsquareVertexLabelStyle = (
  style: LabelStyle,
): Partial<Mutable<SetsquareTextElement>> => {
  const setsquareProperty: Partial<Mutable<SetsquareTextElement>> = {};
  Object.keys(style).forEach((property) => {
    switch (property) {
      case LABEL_STYLE_PROPERTY.COLOR: {
        setsquareProperty.strokeColor = style[property];
        break;
      }
    }
  });
  return setsquareProperty;
};

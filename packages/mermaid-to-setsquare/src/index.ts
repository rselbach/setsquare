import { DEFAULT_FONT_SIZE } from "./constants.js";
import { graphToSetsquare } from "./graphToSetsquare.js";
import { parseMermaid } from "./parseMermaid.js";

export interface MermaidConfig {
  /**
   * Whether to start the diagram automatically when the page loads.
   * @default false
   */
  startOnLoad?: boolean;
  /**
   * The flowchart curve style.
   * @default "linear"
   */
  flowchart?: {
    curve?: "linear" | "basis";
  };
  /**
   * Theme variables
   * @default { fontSize: "25px" }
   */
  themeVariables?: {
    fontSize?: string;
  };
  /**
   * Maximum number of edges to be rendered.
   * @default 1000
   */
  maxEdges?: number;
  /**
   * Maximum number of characters to be rendered.
   * @default 1000
   */
  maxTextSize?: number;
}

export interface SetsquareConfig {
  fontSize?: number;
}

const parseMermaidToSetsquare = async (
  definition: string,
  config?: MermaidConfig,
) => {
  const mermaidConfig = config || {};
  const fontSize =
    parseInt(mermaidConfig.themeVariables?.fontSize ?? "") || DEFAULT_FONT_SIZE;
  const parsedMermaidData = await parseMermaid(definition, {
    ...mermaidConfig,
    themeVariables: {
      ...mermaidConfig.themeVariables,
    },
  });
  // Only font size supported for setsquare elements
  const setsquareElements = graphToSetsquare(parsedMermaidData, {
    fontSize,
  });
  return setsquareElements;
};

export { parseMermaidToSetsquare };

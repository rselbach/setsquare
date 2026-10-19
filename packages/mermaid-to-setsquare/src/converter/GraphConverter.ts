import { DEFAULT_FONT_SIZE } from "../constants.js";

import type { SetsquareConfig } from "../index.js";
import type { MermaidToSetsquareResult } from "../interfaces.js";
import type { Flowchart } from "../parser/flowchart.js";
import type { Sequence } from "../parser/sequence.js";

export class GraphConverter<T = Flowchart | Sequence> {
  private converter;
  constructor({
    converter,
  }: {
    converter: (
      graph: T,
      config: Required<SetsquareConfig>,
    ) => MermaidToSetsquareResult;
  }) {
    this.converter = converter;
  }
  convert = (graph: T, config: SetsquareConfig) => {
    return this.converter(graph, {
      ...config,
      fontSize: config.fontSize || DEFAULT_FONT_SIZE,
    });
  };
}

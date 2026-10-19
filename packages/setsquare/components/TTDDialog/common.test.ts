import { describe, expect, it, vi } from "vitest";

import { convertMermaidToSetsquare } from "./common";

type ConvertMermaidArgs = Parameters<typeof convertMermaidToSetsquare>[0];
type ParseMermaidToSetsquare = Awaited<
  ConvertMermaidArgs["mermaidToSetsquareLib"]["api"]
>["parseMermaidToSetsquare"];

const createConvertArgs = (
  mermaidDefinition: string,
  parseMermaidToSetsquare: ParseMermaidToSetsquare,
): ConvertMermaidArgs => {
  const parent = document.createElement("div");
  const canvas = document.createElement("div");
  parent.appendChild(canvas);

  return {
    canvasRef: { current: canvas },
    mermaidToSetsquareLib: {
      loaded: true,
      api: Promise.resolve({ parseMermaidToSetsquare }),
    },
    mermaidDefinition,
    setError: vi.fn(),
    data: {
      current: {
        elements: [],
        files: null,
      },
    },
    theme: "light",
  };
};

describe("convertMermaidToSetsquare", () => {
  it("returns the original parse error when quote-normalized fallback also fails", async () => {
    const originalError = new Error("Parse error on line 9: ...");
    const fallbackError = new Error("Parse error on line 6: ...");

    const parseMermaidToSetsquare = vi
      .fn<ParseMermaidToSetsquare>()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(fallbackError);

    const mermaidDefinition =
      'graph TD\nA["One"]\nB["Two"]x\nC["Three"]\nD["Four"]';

    const result = await convertMermaidToSetsquare(
      createConvertArgs(mermaidDefinition, parseMermaidToSetsquare),
    );

    expect(parseMermaidToSetsquare).toHaveBeenCalledTimes(2);
    expect(parseMermaidToSetsquare).toHaveBeenNthCalledWith(
      1,
      mermaidDefinition,
    );
    expect(parseMermaidToSetsquare).toHaveBeenNthCalledWith(
      2,
      mermaidDefinition.replace(/"/g, "'"),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(originalError);
    }
  });

  it("does not retry quote normalization when the input has no double quotes", async () => {
    const originalError = new Error("Parse error on line 9: ...");
    const parseMermaidToSetsquare = vi
      .fn<ParseMermaidToSetsquare>()
      .mockRejectedValueOnce(originalError);

    const mermaidDefinition = "graph TD\nA[One]\nB[Two]x";

    const result = await convertMermaidToSetsquare(
      createConvertArgs(mermaidDefinition, parseMermaidToSetsquare),
    );

    expect(parseMermaidToSetsquare).toHaveBeenCalledTimes(1);
    expect(parseMermaidToSetsquare).toHaveBeenCalledWith(mermaidDefinition);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(originalError);
    }
  });
});

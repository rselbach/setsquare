import * as MermaidToSetsquare from "@setsquare/mermaid-to-setsquare";
import React from "react";
import { vi } from "vitest";

import type { parseMermaidToSetsquare } from "@setsquare/mermaid-to-setsquare";
import type { throttleRAF as throttleRAFType } from "@setsquare/common";

type ThrottledFn<T extends unknown[]> = ((...args: T) => void) & {
  flush: () => void;
  cancel: () => void;
};

export const mockThrottleRAF: typeof throttleRAFType = <T extends unknown[]>(
  fn: (...args: T) => void,
) => {
  const ret = ((...args: T) => {
    fn(...args);
  }) as ThrottledFn<T>;

  ret.flush = () => {};
  ret.cancel = () => {};

  return ret;
};

export const mockMermaidToSetsquare = (opts: {
  parseMermaidToSetsquare: typeof parseMermaidToSetsquare;
  mockRef?: boolean;
}) => {
  vi.mock("@setsquare/mermaid-to-setsquare", async (importActual) => {
    const module = (await importActual()) as any;

    return {
      __esModule: true,
      ...module,
    };
  });
  const parseMermaidToSetsquareSpy = vi.spyOn(
    MermaidToSetsquare,
    "parseMermaidToSetsquare",
  );

  parseMermaidToSetsquareSpy.mockImplementation(opts.parseMermaidToSetsquare);

  if (opts.mockRef) {
    vi.spyOn(React, "useRef").mockReturnValue({
      current: {
        parseMermaidToSetsquare: parseMermaidToSetsquareSpy,
      },
    });
  }
};

// Mock for HTMLImageElement (use with `vi.unstubAllGlobals()`)
// as jsdom.resources: "usable" throws an error on image load
export const mockHTMLImageElement = (
  naturalWidth: number,
  naturalHeight: number,
) => {
  vi.stubGlobal(
    "Image",
    class extends Image {
      constructor() {
        super();

        Object.defineProperty(this, "naturalWidth", {
          value: naturalWidth,
        });
        Object.defineProperty(this, "naturalHeight", {
          value: naturalHeight,
        });

        queueMicrotask(() => {
          this.onload?.({} as Event);
        });
      }
    },
  );
};

// Mocks for multiple HTMLImageElements (dimensions are assigned in the order of image initialization)
export const mockMultipleHTMLImageElements = (
  sizes: (readonly [number, number])[],
) => {
  const _sizes = [...sizes];

  vi.stubGlobal(
    "Image",
    class extends Image {
      constructor() {
        super();

        const size = _sizes.shift();
        if (!size) {
          throw new Error("Insufficient sizes");
        }

        Object.defineProperty(this, "naturalWidth", {
          value: size[0],
        });
        Object.defineProperty(this, "naturalHeight", {
          value: size[1],
        });

        queueMicrotask(() => {
          this.onload?.({} as Event);
        });
      }
    },
  );
};

import { diffStringsUnified } from "jest-diff";

declare module "vitest" {
  interface Matchers<T = any> {
    toCloselyEqualPoints(
      points: readonly [number, number][],
      precision?: number,
    ): T;
  }
}

expect.extend({
  toCloselyEqualPoints(received, expected, precision = 2) {
    if (!Array.isArray(received) || !Array.isArray(expected)) {
      throw new Error("expected and received are not point arrays");
    }

    const tolerance = 10 ** -precision;
    const pass =
      received.length === expected.length &&
      expected.every(
        (point, idx) =>
          Math.abs(received[idx][0] - point[0]) < tolerance &&
          Math.abs(received[idx][1] - point[1]) < tolerance,
      );

    if (!pass) {
      return {
        message: () => ` The provided array of points are not close enough.

${diffStringsUnified(
  JSON.stringify(expected, undefined, 2),
  JSON.stringify(received, undefined, 2),
)}`,
        pass: false,
      };
    }

    return {
      message: () => `expected ${received} to not be close to ${expected}`,
      pass: true,
    };
  },
});

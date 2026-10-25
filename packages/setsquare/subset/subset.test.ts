import { readFileSync } from "node:fs";
import { join } from "node:path";

import { subsetToBinary } from "./subset-shared.chunk";
import loadWoff2 from "./woff2/woff2-loader";

const fontPath = join(
  __dirname,
  "../fonts/Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTA3j6zbXWjgevT5.woff2",
);

const readFont = () => {
  const { buffer, byteOffset, byteLength } = readFileSync(fontPath);
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
};

describe("subsetting", () => {
  it("keeps a valid, smaller woff2 font with the requested glyphs", async () => {
    const font = readFont();
    const codePoints = [..."Greendale"].map((char) => char.codePointAt(0)!);

    const subset = await subsetToBinary(font, codePoints);

    expect(String.fromCharCode(...new Uint8Array(subset, 0, 4))).toBe("wOF2");
    expect(subset.byteLength).toBeLessThan(font.byteLength);

    const { decompress } = await loadWoff2();
    expect(decompress(subset).byteLength).toBeGreaterThan(0);
  });
});

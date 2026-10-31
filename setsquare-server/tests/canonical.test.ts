import { createHash } from "node:crypto";

import { canonical, legacyPayloadHash, payloadHash } from "../src/canonical";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

it("orders object keys by UTF-16 code unit at every depth", () => {
  expect(
    canonical({
      z: 1,
      aa: [{ a: 2, Z: 3 }],
      a: null,
      _x: "Greendale",
      Z: true,
    }),
  ).toBe('{"Z":true,"_x":"Greendale","a":null,"aa":[{"Z":3,"a":2}],"z":1}');
});

it("serializes keys that collate as equal the same in any insertion order", () => {
  const nfc = "caf\u00e9";
  const nfd = "cafe\u0301";
  expect(canonical({ [nfc]: 1, [nfd]: 2 })).toBe(
    canonical({ [nfd]: 2, [nfc]: 1 }),
  );
  expect(canonical({ "a\u00adb": 1, ab: 2 })).toBe(
    canonical({ ab: 2, "a\u00adb": 1 }),
  );
});

it("versions receipt hashes and keeps the legacy collation hash", () => {
  const value = { Z: 1, a: 2 };
  expect(payloadHash(value)).toBe(`v2:${sha256('{"Z":1,"a":2}')}`);
  expect(legacyPayloadHash(value)).toBe(sha256('{"a":2,"Z":1}'));
});

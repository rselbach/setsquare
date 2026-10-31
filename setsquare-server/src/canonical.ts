import { createHash } from "node:crypto";

type Order = (a: string, b: string) => number;

const codeUnits: Order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const serialize = (value: unknown, order: Order): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item, order)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => order(a, b))
      .map(([key, item]) => `${JSON.stringify(key)}:${serialize(item, order)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

/** Serializes JSON data with object keys in UTF-16 code-unit order. */
export const canonical = (value: unknown) => serialize(value, codeUnits);

/** The versioned hash a mutation receipt stores for its command. */
export const payloadHash = (value: unknown) => `v2:${sha256(canonical(value))}`;

/**
 * The unprefixed hash receipts stored before keys were ordered by code unit.
 * Import receipts never expire, so their retries still compare against it.
 */
export const legacyPayloadHash = (value: unknown) =>
  sha256(serialize(value, (a, b) => a.localeCompare(b)));

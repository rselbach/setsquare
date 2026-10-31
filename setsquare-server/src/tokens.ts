import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Hashes a secret to the hex SHA-256 form it is stored and compared in. */
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Returns a new 256-bit random secret, base64url-encoded. */
export const token = () => randomBytes(32).toString("base64url");

/** Compares two secrets in constant time, whatever their lengths. */
export const equalSecret = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));

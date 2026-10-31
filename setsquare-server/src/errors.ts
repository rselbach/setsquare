import type { z } from "zod";

/** An API failure whose message is safe to show to the client. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** A stored row that no longer matches its schema: a server fault, not bad input. */
export class StoredDataError extends Error {
  constructor(cause: z.ZodError) {
    super("Stored data does not match its schema", { cause });
    this.name = "StoredDataError";
  }
}

/** Parses a value read from storage, so a mismatch is never reported as invalid input. */
export const parseStored = <T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new StoredDataError(parsed.error);
  }
  return parsed.data;
};

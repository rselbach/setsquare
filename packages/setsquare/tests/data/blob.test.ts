import { MIME_TYPES } from "@setsquare/common";

import { normalizeFile } from "../../data/blob";

describe("normalizeFile", () => {
  it.each([
    ["greendale.setsquare", MIME_TYPES.setsquare],
    ["study-group.setsquarelib", MIME_TYPES.setsquarelib],
  ])("keeps the file handle when retyping %s", async (name, type) => {
    const handle = { kind: "file", name } as FileSystemFileHandle;
    const file = new File(["{}"], name);
    file.handle = handle;

    const normalized = await normalizeFile(file);

    expect(normalized.type).toBe(type);
    expect(normalized.handle).toBe(handle);
  });
});

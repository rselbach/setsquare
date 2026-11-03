import { commandSchema } from "../src/validation";

it.each([8_640_000_000_000_001, Number.MAX_SAFE_INTEGER])(
  "rejects timestamps outside the Date range: %s",
  (time) => {
    expect(
      commandSchema.safeParse({
        requestId: "greendale",
        command: {
          kind: "importFolder",
          folder: {
            id: "greendale",
            name: "Greendale",
            parentId: null,
            createdAt: time,
            updatedAt: time,
            trashedAt: time,
          },
        },
      }).success,
    ).toBe(false);
  },
);

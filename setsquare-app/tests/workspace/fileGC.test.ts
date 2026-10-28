import { clear, keys, setMany } from "idb-keyval";

import type { FileId } from "@setsquare/element/types";
import type { BinaryFileData, DataURL } from "@setsquare/setsquare/types";

import { filesStore } from "../../data/localFiles";

import { workspaceFixture } from "./helpers";

const HOUR = 60 * 60 * 1000;

let workspace: ReturnType<typeof workspaceFixture>;

const image = (
  id: string,
  ageInHours: { created: number; lastRetrieved?: number },
): [FileId, BinaryFileData] => [
  id as FileId,
  {
    id: id as FileId,
    dataURL: "data:image/png;base64,AAAA" as DataURL,
    mimeType: "image/png",
    created: workspace.clock.now - ageInHours.created * HOUR,
    lastRetrieved:
      ageInHours.lastRetrieved === undefined
        ? undefined
        : workspace.clock.now - ageInHours.lastRetrieved * HOUR,
  },
];

beforeEach(() => {
  workspace = workspaceFixture();
});

afterEach(async () => {
  workspace.close();
  await clear(filesStore);
});

describe("collecting unused images", () => {
  it("deletes only images no drawing has used for a day", async () => {
    await setMany(
      [
        image("floor-plan", { created: 48 }),
        image("trashed", { created: 48 }),
        image("recent", { created: 1 }),
        image("retrieved", { created: 48, lastRetrieved: 1 }),
        image("old", { created: 48 }),
        image("retrieved-long-ago", { created: 72, lastRetrieved: 25 }),
      ],
      filesStore,
    );
    const store = await workspace.open();
    await store.createDrawing({
      folderId: null,
      name: "Floor plan",
      fileIds: ["floor-plan" as FileId],
    });
    const paintball = await store.createDrawing({
      folderId: null,
      name: "Paintball",
      fileIds: ["trashed" as FileId],
    });
    await store.trash({ kind: "drawing", id: paintball.id });

    expect((await store.collectUnusedFiles()).sort()).toEqual([
      "old",
      "retrieved-long-ago",
    ]);
    expect((await keys(filesStore)).sort()).toEqual([
      "floor-plan",
      "recent",
      "retrieved",
      "trashed",
    ]);
  });
});

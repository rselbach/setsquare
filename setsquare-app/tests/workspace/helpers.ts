import { getNonDeletedElements } from "@setsquare/element";
import { API } from "@setsquare/setsquare/tests/helpers/api";

import { emptyDrawingContent } from "../../workspace/drawingAppState";
import {
  LocalWorkspaceStore,
  SCHEMA_VERSION,
} from "../../workspace/local/LocalWorkspaceStore";
import { openDatabase, request, transact } from "../../workspace/local/idb";

import type { UpgradeEvents } from "../../workspace/local/idb";
import type { DrawingContent } from "../../workspace/types";

let databases = 0;

/**
 * Opens stores on a database and channel of their own, with a clock the test
 * sets. Call `close` after each test.
 */
export const workspaceFixture = () => {
  const dbName = `greendale-${databases++}`;
  const clock = { now: Date.UTC(2026, 9, 1) };
  const stores: LocalWorkspaceStore[] = [];
  return {
    dbName,
    clock,
    open: async ({ onBlocked, onVersionChange }: UpgradeEvents = {}) => {
      const store = await LocalWorkspaceStore.open({
        dbName,
        channelName: dbName,
        now: () => clock.now,
        onBlocked,
        onVersionChange,
      });
      stores.push(store);
      return store;
    },
    close: () => {
      for (const store of stores.splice(0)) {
        store.close();
      }
    },
    /** how many records each store holds, read straight from the database */
    countRecords: async () => {
      const names = ["folders", "drawings", "contents", "views", "thumbnails"];
      const db = await openDatabase(dbName, SCHEMA_VERSION, () => {});
      try {
        const counts = await transact(db, names, "readonly", (tx) =>
          Promise.all(
            names.map((name) => request(tx.objectStore(name).count())),
          ),
        );
        return Object.fromEntries(names.map((name, i) => [name, counts[i]]));
      } finally {
        db.close();
      }
    },
    /**
     * writes a record straight to the database, for what the stores won't
     * make, such as a drawing in a folder that's gone; open stores see it
     * after their next change
     */
    putRecord: async (name: string, key: string, value: unknown) => {
      const db = await openDatabase(dbName, SCHEMA_VERSION, () => {});
      try {
        await transact(db, [name], "readwrite", (tx) =>
          request(tx.objectStore(name).put(value, key)),
        );
      } finally {
        db.close();
      }
    },
  };
};

/** A drawing's content with a rectangle for each id. */
export const contentWith = (
  name: string | null,
  ...ids: string[]
): DrawingContent => ({
  ...emptyDrawingContent(name),
  elements: getNonDeletedElements(
    ids.map((id) => API.createElement({ type: "rectangle", id })),
  ),
});

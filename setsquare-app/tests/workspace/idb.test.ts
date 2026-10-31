import {
  DatabaseClosedError,
  openDatabase,
  request,
  transact,
} from "../../workspace/local/idb";

let databases = 0;

const upgrade = (db: IDBDatabase) => {
  if (!db.objectStoreNames.contains("drawings")) {
    db.createObjectStore("drawings");
  }
};

const settled = (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 50)),
  ]);

let name: string;

beforeEach(() => {
  name = `greendale-idb-${databases++}`;
});

describe("openDatabase", () => {
  it("upgrades from version 0 when new, and from the old version on a bump", async () => {
    const upgradeFrom = vi.fn((db: IDBDatabase, _oldVersion: number) =>
      upgrade(db),
    );

    (await openDatabase(name, 1, upgradeFrom)).close();
    (await openDatabase(name, 1, upgradeFrom)).close();
    (await openDatabase(name, 2, upgradeFrom)).close();

    expect(upgradeFrom.mock.calls.map(([, oldVersion]) => oldVersion)).toEqual([
      0, 1,
    ]);
  });

  it("reports an upgrade blocked by an open connection, and opens once it closes", async () => {
    // a connection without the handshake, as an older build holds it
    const older = await request(indexedDB.open(name, 1));
    const onBlocked = vi.fn();

    const opening = openDatabase(name, 2, upgrade, { onBlocked });

    expect(await settled(opening)).toBe(false);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    older.close();
    const db = await opening;
    expect(db.version).toBe(2);
    db.close();
  });

  it("closes its connection for a newer version and says so", async () => {
    const onVersionChange = vi.fn();
    const older = await openDatabase(name, 1, upgrade, { onVersionChange });
    const onBlocked = vi.fn();

    const db = await openDatabase(name, 2, upgrade, { onBlocked });

    expect(db.version).toBe(2);
    expect(onBlocked).not.toHaveBeenCalled();
    expect(onVersionChange).toHaveBeenCalledTimes(1);
    await expect(
      transact(older, ["drawings"], "readonly", (tx) =>
        request(tx.objectStore("drawings").count()),
      ),
    ).rejects.toBeInstanceOf(DatabaseClosedError);
    db.close();
  });

  it("fails with a VersionError below the version a newer build left", async () => {
    (await openDatabase(name, 2, upgrade)).close();

    await expect(openDatabase(name, 1, upgrade)).rejects.toMatchObject({
      name: "VersionError",
    });
  });
});

describe("transact", () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    db = await openDatabase(name, 1, upgrade);
  });

  afterEach(() => {
    db.close();
  });

  const drawings = () =>
    transact(db, ["drawings"], "readonly", (tx) =>
      request(tx.objectStore("drawings").getAll()),
    );

  it("keeps none of the writes when the callback throws", async () => {
    const error = new Error("Chang ate the floor plan");

    await expect(
      transact(db, ["drawings"], "readwrite", async (tx) => {
        await request(tx.objectStore("drawings").put("Troy", "troy"));
        await request(tx.objectStore("drawings").put("Abed", "abed"));
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await drawings()).toEqual([]);
  });

  it("keeps none of the writes when a request fails", async () => {
    await transact(db, ["drawings"], "readwrite", (tx) =>
      request(tx.objectStore("drawings").put("Troy", "troy")),
    );

    await expect(
      transact(db, ["drawings"], "readwrite", async (tx) => {
        await request(tx.objectStore("drawings").put("Abed", "abed"));
        await request(tx.objectStore("drawings").add("Troy again", "troy"));
      }),
    ).rejects.toMatchObject({ name: "ConstraintError" });
    expect(await drawings()).toEqual(["Troy"]);
  });

  it("commits early when the callback awaits something else", async () => {
    await expect(
      transact(db, ["drawings"], "readwrite", async (tx) => {
        const store = tx.objectStore("drawings");
        await request(store.put("Troy", "troy"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        await request(store.put("Abed", "abed"));
      }),
    ).rejects.toMatchObject({ name: "TransactionInactiveError" });
    expect(await drawings()).toEqual(["Troy"]);
  });
});

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

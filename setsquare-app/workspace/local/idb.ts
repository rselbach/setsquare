/**
 * Promise helpers over IndexedDB.
 *
 * A transaction commits as soon as no request is pending once the current
 * task ends. So inside a `transact` callback, await only requests on its own
 * transaction: awaiting anything else, such as a fetch, a timer or another
 * database, lets the transaction commit early, and its next request throws a
 * TransactionInactiveError.
 */

/** How a tab hears about another tab opening its database at a newer version. */
export interface UpgradeEvents {
  /** an older connection is still open, so the open waits until it closes */
  onBlocked?: () => void;
  /** a newer version is opening, so this connection has closed */
  onVersionChange?: () => void;
}

/** A transaction was asked of a connection that has closed. */
export class DatabaseClosedError extends Error {
  constructor(name: string) {
    super(`The ${name} database is closed; reload the page to open it again`);
    this.name = "DatabaseClosedError";
  }
}

/**
 * Opens a database, running upgrade when it's new or its version rises. The
 * connection closes as soon as another tab opens a newer version, so that
 * open isn't left waiting on this tab.
 */
export const openDatabase = (
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void,
  {
    factory = indexedDB,
    onBlocked,
    onVersionChange,
  }: UpgradeEvents & { factory?: IDBFactory } = {},
) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(name, version);
    req.onupgradeneeded = (event) => {
      // set while the database upgrades
      const tx = req.transaction as IDBTransaction;
      upgrade(req.result, event.oldVersion, tx);
    };
    // the request stays pending, and succeeds once the other tabs close
    req.onblocked = () => onBlocked?.();
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        // transactions already running still finish
        db.close();
        onVersionChange?.();
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });

/** Resolves with a request's result, or rejects with its error. */
export const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const abort = (tx: IDBTransaction) => {
  try {
    tx.abort();
  } catch {
    // it already finished or aborted
  }
};

/**
 * Runs fn in one transaction and resolves with its result once the
 * transaction commits. If fn throws, the transaction aborts and none of its
 * writes stay.
 */
export const transact = async <T>(
  db: IDBDatabase,
  storeNames: readonly string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> => {
  let tx: IDBTransaction;
  try {
    tx = db.transaction([...storeNames], mode);
  } catch (error) {
    // what a closed or closing connection throws
    if (error instanceof Error && error.name === "InvalidStateError") {
      throw new DatabaseClosedError(db.name);
    }
    throw error;
  }
  const committed = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
  });
  // when fn fails, its own error explains more than the abort it causes
  committed.catch(() => {});
  try {
    const result = await fn(tx);
    await committed;
    return result;
  } catch (error) {
    abort(tx);
    throw error;
  }
};

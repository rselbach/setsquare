/**
 * Promise helpers over IndexedDB.
 *
 * A transaction commits as soon as no request is pending once the current
 * task ends. So inside a `transact` callback, await only requests on its own
 * transaction: awaiting anything else, such as a fetch, a timer or another
 * database, lets the transaction commit early, and its next request throws a
 * TransactionInactiveError.
 */

/** Opens a database, running upgrade when it's new or its version rises. */
export const openDatabase = (
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void,
) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (event) => {
      // set while the database upgrades
      const tx = req.transaction as IDBTransaction;
      upgrade(req.result, event.oldVersion, tx);
    };
    req.onsuccess = () => resolve(req.result);
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
  const tx = db.transaction([...storeNames], mode);
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

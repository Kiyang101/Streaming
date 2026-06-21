// src/lib/localStore.ts

/** Persists FileSystemFileHandles (NOT file bytes) so the /local queue survives
 *  reloads. Each record keeps the handle plus the file name captured at save
 *  time, so the queue can show names before the user re-grants permission. */

const DB_NAME = "local-playback";
const STORE = "handles";
const VERSION = 1;

export interface StoredHandle {
  id: string;
  name: string;
  handle: FileSystemFileHandle;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE);
        const req = run(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Append/replace records (keyed by id). */
export async function saveHandles(records: StoredHandle[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    for (const r of records) store.put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** All stored handles, in insertion order. */
export async function loadHandles(): Promise<StoredHandle[]> {
  return (await tx<StoredHandle[]>("readonly", (s) => s.getAll())) ?? [];
}

export async function removeHandle(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function clearHandles(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
}

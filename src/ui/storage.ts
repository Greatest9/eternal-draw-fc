const DB = "eternal-draw-fc";
const STORE = "saves";
const KEY = "career";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export const saveCareer = (json: string) => run("readwrite", (s) => s.put(json, KEY));
export const loadCareer = async () => (await run<string | undefined>("readonly", (s) => s.get(KEY))) ?? null;
export const clearCareer = () => run("readwrite", (s) => s.delete(KEY));

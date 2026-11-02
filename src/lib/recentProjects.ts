/**
 * Recently saved or opened projects, kept in IndexedDB. Projects embed their
 * artwork as data URLs and routinely exceed localStorage's ~5 MB quota, which
 * IndexedDB does not have. Every call fails soft: recents are a convenience.
 */
export interface RecentProject {
  id: string;
  name: string;
  styleLabel: string;
  savedAt: string;
  /** The full .pbox JSON text. */
  json: string;
}

const DB_NAME = "azm-box";
const STORE = "recent";
const MAX_RECENT = 8;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listRecent(): Promise<RecentProject[]> {
  try {
    const db = await open();
    const all = await done(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<RecentProject[]>);
    db.close();
    return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

/** Saving a project with the same name replaces its entry instead of piling up copies. */
export async function addRecent(entry: Omit<RecentProject, "id" | "savedAt">): Promise<void> {
  try {
    const db = await open();
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const existing = (await done(store.getAll() as IDBRequest<RecentProject[]>)).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    const same = existing.find((item) => item.name === entry.name);
    await done(store.put({ ...entry, id: same?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: new Date().toISOString() }));
    const others = existing.filter((item) => item !== same);
    for (const stale of others.slice(MAX_RECENT - 1)) await done(store.delete(stale.id));
    db.close();
  } catch {
    /* ignore */
  }
}

export async function removeRecent(id: string): Promise<void> {
  try {
    const db = await open();
    await done(db.transaction(STORE, "readwrite").objectStore(STORE).delete(id));
    db.close();
  } catch {
    /* ignore */
  }
}

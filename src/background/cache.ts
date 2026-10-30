// A small persistent cache for model output, in IndexedDB.

const DB = "sift";
const STORE = "kv";
const MAX = 20000;
const DAY = 24 * 60 * 60_000;
/** Nothing is kept longer than this: pages change, and old prompts leave orphans. */
const MAX_AGE = 30 * DAY;

interface Entry {
  v: string;
  /** When it was written. */
  ts: number;
  /** When it expires, if sooner than MAX_AGE (results from signed-in pages). */
  exp?: number;
}

const fresh = (e: Entry | undefined, now = Date.now()) => !!e && (!e.exp || e.exp > now) && now - e.ts < MAX_AGE;
let dbP: Promise<IDBDatabase> | null = null;
let writes = 0;

function db(): Promise<IDBDatabase> {
  return (dbP ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const s = r.result.createObjectStore(STORE);
      s.createIndex("ts", "ts");
    };
    r.onsuccess = () => {
      r.result.onclose = () => (dbP = null);
      resolve(r.result);
    };
    r.onerror = () => {
      dbP = null;
      reject(r.error);
    };
  }));
}

// The worker restarts often, so prune at startup rather than counting writes.
db()
  .then((d) => {
    prune(d);
    pruneOld(d);
  })
  .catch(() => {});

export async function cacheGet(key: string): Promise<string | undefined> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const q = d.transaction(STORE).objectStore(STORE).get(key);
      q.onsuccess = () => resolve(fresh(q.result) ? (q.result as Entry).v : undefined);
      q.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

/** `ttl`: keep it only this long (ms), for results from signed-in pages. */
export async function cacheSet(key: string, v: string, ttl?: number): Promise<void> {
  try {
    const d = await db();
    const ts = Date.now();
    const e: Entry = ttl ? { v, ts, exp: ts + ttl } : { v, ts };
    d.transaction(STORE, "readwrite").objectStore(STORE).put(e, key);
    if (++writes % 200 === 0) prune(d);
  } catch {
    /* cache is best effort */
  }
}

/**
 * Keeps a saved entry at most `ttl` (ms) more, never longer than it would
 * have been kept: a page found to be signed-in after it saved or read it.
 */
export async function cacheShorten(key: string, ttl: number): Promise<void> {
  try {
    const d = await db();
    const s = d.transaction(STORE, "readwrite").objectStore(STORE);
    const q = s.get(key);
    q.onsuccess = () => {
      const e = q.result as Entry | undefined;
      if (!fresh(e)) return;
      const exp = Math.min(e!.exp ?? e!.ts + MAX_AGE, Date.now() + ttl);
      if (exp !== e!.exp) s.put({ ...e!, exp }, key);
    };
  } catch {
    /* cache is best effort */
  }
}

function prune(d: IDBDatabase) {
  const tx = d.transaction(STORE, "readwrite");
  const s = tx.objectStore(STORE);
  const c = s.count();
  c.onsuccess = () => {
    let extra = c.result - MAX;
    if (extra <= 0) return;
    s.index("ts").openCursor().onsuccess = (e) => {
      const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cur || extra-- <= 0) return;
      cur.delete();
      cur.continue();
    };
  };
}

/**
 * Deletes expired and old entries, so private results do not stay on disk.
 * Entries younger than a day are never expired, so only older ones are read;
 * at most every few hours, since the worker restarts often.
 */
async function pruneOld(d: IDBDatabase) {
  const r = await chrome.storage.session.get("cachePruned").catch(() => ({}) as Record<string, unknown>);
  const now = Date.now();
  if (now - Number(r.cachePruned ?? 0) < DAY / 4) return;
  await chrome.storage.session.set({ cachePruned: now }).catch(() => {});
  const tx = d.transaction(STORE, "readwrite");
  tx.objectStore(STORE).index("ts").openCursor(IDBKeyRange.upperBound(now - DAY)).onsuccess = (e) => {
    const cur = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
    if (!cur) return;
    if (!fresh(cur.value as Entry, now)) cur.delete();
    cur.continue();
  };
}

/** Deletes every saved rewrite and Short version (Options, "Clear saved summaries"). */
export async function cacheClear(): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

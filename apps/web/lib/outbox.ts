// Offline queue (IndexedDB, survives reloads) for acts that are safe to replay: the daily log is an upsert per
// batch + day (save_daily_log), so a replay after a lost response changes nothing. Entries are tagged with the
// user who made them and only that user's session replays them (components/shell/OutboxSync.tsx).
// ponytail: daily log only; one-tap appends (mortality, payments) need an op-id receipt before they can queue.
export type Queued = { id?: number; user: string; act: string; input: Record<string, unknown>; at: number };
export const OUTBOX_EVENT = 'hp-outbox';
const DB = 'hatchpro', STORE = 'outbox';

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const q = f(db.transaction(STORE, mode).objectStore(STORE));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

export async function queue(user: string, act: string, input: Record<string, unknown>) {
  await run('readwrite', (s) => s.add({ user, act, input, at: Date.now() }));
  window.dispatchEvent(new Event(OUTBOX_EVENT));
}
export const pending = async (user: string) => (await run<Queued[]>('readonly', (s) => s.getAll())).filter((q) => q.user === user);
export const drop = (id: number) => run('readwrite', (s) => s.delete(id));

/** Offline page copies (sw.js) belong to one signed-in user: cleared at sign-out, on the login page and when a
 *  different user signs in on the same phone. Queued entries stay — they are tagged per user. */
export async function clearOfflineCopies() {
  if (typeof caches === 'undefined') return;
  await Promise.all((await caches.keys()).map((k) => caches.delete(k))).catch(() => {});
}

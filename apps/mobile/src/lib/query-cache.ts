/**
 * What screens have loaded this session, by key, so a screen opened again shows what it had at once and reads it again
 * behind it (stale while revalidate), and a list can hand a detail screen the row it already has (the owner's brief,
 * 2026-11-25: no waiting on a spinner when a tab, a post, a chat or a person is opened). Memory only, never the phone's
 * storage; emptied when the signed-in account changes (SessionProvider), so one account never sees another's.
 *
 * `prefetch` starts a load early (a finger touching a row) and shares it with whoever asks for the same key while it
 * runs, so the screen it opens waits on that one request instead of starting another.
 */

type Entry = { value: unknown; at: number };

const entries = new Map<string, Entry>();
const running = new Map<string, Promise<unknown>>();
/** Bumped by clearQueryCache: a load that started for the previous account never lands in the cache. */
let generation = 0;

/** Plenty for a session's screens (the entries hold what is already in memory, not copies); the oldest go first. */
const MAX_ENTRIES = 1000;
/** A result this young is shown without asking the server again (a row just pressed, a list just loaded). */
export const FRESH_MS = 15_000;

export function recall<T>(key: string): { value: T; at: number } | undefined {
  return entries.get(key) as { value: T; at: number } | undefined;
}

export function remember<T>(key: string, value: T): void {
  entries.delete(key);
  entries.set(key, { value, at: Date.now() });
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
}

/** A list's row kept for its own screen: the Explore lists and Events hand theirs over, so a tap opens at once. */
export type RowKind = "roommate" | "item" | "apartment" | "event";
export const rowKey = (kind: RowKind, id: string) => `${kind}:${id}`;

export function isFresh(key: string): boolean {
  const e = entries.get(key);
  return e !== undefined && Date.now() - e.at < FRESH_MS;
}

/** Loads `key` (or joins the load already running for it) and keeps the result. */
export function prefetch<T>(key: string, load: () => Promise<T>): Promise<T> {
  const already = running.get(key) as Promise<T> | undefined;
  if (already) return already;
  const gen = generation;
  const p = load().then((value) => {
    if (gen === generation) remember(key, value);
    return value;
  });
  running.set(key, p);
  const done = () => {
    if (running.get(key) === p) running.delete(key);
  };
  p.then(done, done);
  return p;
}

/** Warms `key` unless a fresh copy is already kept; errors are left for the screen that needs it to show. */
export function warm<T>(key: string, load: () => Promise<T>): void {
  if (isFresh(key)) return;
  prefetch(key, load).catch(() => {});
}

export function clearQueryCache(): void {
  generation++;
  entries.clear();
  running.clear();
}

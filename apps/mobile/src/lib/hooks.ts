import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { isFresh, prefetch, recall, remember, rowKey, type RowKind } from "./query-cache";

/**
 * Hands a list's rows to the screens they open (lib/query-cache): the list and the screen read the same row, so the
 * screen shows it at once and reads it again only once it is a few seconds old.
 */
export function useKeepRows<T extends { id: string }>(kind: RowKind, rows: readonly T[] | null | undefined) {
  useEffect(() => {
    if (rows) for (const r of rows) remember(rowKey(kind, r.id), r);
  }, [kind, rows]);
}

/**
 * Load something once (and again when `deps` change), with a manual refresh. With `key` (lib/query-cache) the result is
 * kept for the session: the screen opens at once on what was kept (a row a list handed over, the last visit, a load a
 * pressed row started), `loading` only while there is nothing to show, and the server is asked again behind it unless
 * the kept copy is a few seconds old; a load already running for the key (a prefetch) is joined, not repeated. `setData`
 * keeps the cache in step.
 */
export function useQuery<T>(load: () => Promise<T>, deps: unknown[], options?: { key?: string | null }) {
  const key = options?.key ?? null;
  const [data, setDataState] = useState<T | null>(() => (key ? (recall<T>(key)?.value ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !(key && recall(key)));
  const seq = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;
  const run = useCallback(
    async (force: boolean) => {
      const id = ++seq.current;
      const kept = key ? recall<T>(key) : undefined;
      if (kept) setDataState(kept.value);
      if (!force && key && isFresh(key)) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = key ? await prefetch(key, load) : await load();
        if (id === seq.current) {
          setDataState(result);
          setError(null);
        }
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        if (id === seq.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, key],
  );
  useEffect(() => {
    void run(false);
  }, [run]);
  const refresh = useCallback(() => run(true), [run]);
  const setData: Dispatch<SetStateAction<T | null>> = useCallback((action) => {
    setDataState((prev) => {
      const next = typeof action === "function" ? (action as (p: T | null) => T | null)(prev) : action;
      const k = keyRef.current;
      if (k && next !== null) remember(k, next);
      return next;
    });
  }, []);
  return { data, error, loading, refresh, setData };
}

/**
 * Paged feed: first page on mount, `loadMore` appends, `refresh` restarts. When `deps` change it starts again from page 1;
 * the rows on screen stay until the new first page arrives (no flicker while someone types a search), unless
 * `clearOnChange` empties the list at once, for a filter whose old rows would be wrong, so the list shows its loading state.
 */
export function useFeed<T extends { id: string }>(
  loadPage: (page: number) => Promise<{ data: T[]; totalPages: number }>,
  deps: unknown[],
  options?: { clearOnChange?: boolean },
) {
  const clearOnChange = options?.clearOnChange ?? false;
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** How many first pages have landed (the first load, a pull-to-refresh, a new query): a feed's ads follow it. */
  const [round, setRound] = useState(0);
  const seq = useRef(0);

  const fetchPage = useCallback(
    async (p: number, replace: boolean) => {
      const id = ++seq.current;
      try {
        const result = await loadPage(p);
        if (id !== seq.current) return;
        setItems((prev) => (replace ? result.data : [...prev, ...result.data.filter((r) => !prev.some((x) => x.id === r.id))]));
        if (replace) setRound((n) => n + 1);
        setTotalPages(result.totalPages);
        setPage(p);
        setError(null);
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : "Could not load");
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    // The page count belonged to the old query: if the new first page fails, `loadMore` must not fetch the new query's
    // page 2 and append it to the old rows.
    setPage(1);
    setTotalPages(1);
    setError(null);
    if (clearOnChange) setItems([]);
    setLoading(true);
    void fetchPage(1, true);
  }, [fetchPage, clearOnChange]);

  const loadMore = useCallback(() => {
    if (loading || refreshing || page >= totalPages) return;
    void fetchPage(page + 1, false);
  }, [fetchPage, loading, refreshing, page, totalPages]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void fetchPage(1, true);
  }, [fetchPage]);

  return { items, setItems, loading, refreshing, error, loadMore, refresh, round, hasMore: page < totalPages };
}

export function errorText(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof Error && e.message) return e.message;
  // supabase-js hands database errors over as plain objects ({ message, code, details }), not Error instances, and the
  // database's own messages ("That username is taken.", "You can pin up to 3 posts.") are written for people.
  if (e && typeof e === "object" && "message" in e) {
    const message = (e as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

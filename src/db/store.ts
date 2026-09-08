/**
 * A minimal reactive layer over IndexedDB.
 *
 * Reads are async, so every screen would otherwise need its own loading dance. Instead:
 * a global version counter bumps on every local write, and `useLive` re-runs its query
 * whenever that happens. The store is small (a decade is ~70k rows) so re-reading is
 * cheap and always correct — much cheaper than maintaining a duplicate cache that can
 * drift from the database.
 */

import { useCallback, useEffect, useRef, useState } from "react";

let version = 0;
const listeners = new Set<() => void>();

/** Call after any local write so open screens re-read. */
export function bump(): void {
  version++;
  listeners.forEach((l) => l());
}

export function onChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Run an async query, re-running it on every local write.
 * `deps` behaves like useEffect's dependency array.
 */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  const alive = useRef(true);
  // Keep the latest query without making it a dependency — callers pass inline lambdas.
  const q = useRef(query);
  q.current = query;

  const run = useCallback(() => {
    void q.current().then((v) => {
      if (alive.current) setValue(v);
    });
  }, []);

  useEffect(() => {
    alive.current = true;
    run();
    const off = onChange(run);
    return () => {
      alive.current = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}

/** Wrap a write so callers never forget to notify. */
export function writing<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const r = await fn(...args);
    bump();
    return r;
  };
}

export const currentVersion = () => version;

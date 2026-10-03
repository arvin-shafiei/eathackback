import { useEffect, useState } from 'react';

// Everything the dashboard reads is a copy made by web/scripts/sync-dashboard.mjs into public/data/dashboard/.
// `path` here is relative to that folder; SRC() maps it back to the repo file it came from.
const BASE = `${import.meta.env.BASE_URL}data/dashboard/`;
const cache = new Map<string, Promise<unknown>>();

export function fetchJSON<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(BASE + path).then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText} for data/dashboard/${path}`);
        return r.text().then((t) => JSON.parse(t.replace(/"\[mock\] /g, '"')));
      }),
    );
  }
  return cache.get(path) as Promise<T>;
}

export type Loaded<T> = { data?: T; error?: string; loading: boolean };

export function useJSON<T>(path: string | null): Loaded<T> {
  const [s, set] = useState<Loaded<T>>({ loading: !!path });
  useEffect(() => {
    if (!path) { set({ loading: false }); return; }
    let live = true;
    set({ loading: true });
    fetchJSON<T>(path)
      .then((data) => live && set({ data, loading: false }))
      .catch((e) => live && set({ error: String(e.message || e), loading: false }));
    return () => { live = false; };
  }, [path]);
  return s;
}

/** repo path of a synced dashboard file, for source footnotes */
export const repoPath: Record<string, string> = {
  'personas.json': 'data/personas/lens/*.json',
  'ocean.json': 'data/personas/ocean/*.json',
  'provenance/graph.json': 'data/provenance/graph.json',
  'provenance/corpus_stats.json': 'data/provenance/corpus_stats.json',
  'provenance/personas/index.json': 'data/provenance/personas/index.json',
  'layout/summary.json': 'data/sim/layout/summary.json',
  'swaps/claim_premium.json': 'data/sim/swaps/claim_premium.json',
};

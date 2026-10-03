import type { StoreConfig, Planogram, Product, Persona, Run, RunIndexEntry } from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function getJSON<T>(path: string, fallback?: T): Promise<T> {
  try {
    const r = await fetch(BASE + path, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return (await r.json()) as T;
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

export interface Loaded {
  config: StoreConfig;
  planogram: Planogram;
  catalog: Product[];
  personas: Persona[];
  runIndex: RunIndexEntry[];
}

export async function loadAll(): Promise<Loaded> {
  const [config, planogram, catalogRaw, personasRaw, idxRaw] = await Promise.all([
    getJSON<StoreConfig>('store.config.json'),
    getJSON<Planogram>('planogram.json'),
    getJSON<Product[] | { products: Product[] }>('catalog.json', []),
    getJSON<Persona[] | { personas: Persona[] }>('personas.json', []),
    getJSON<unknown[]>('runs/index.json', []),
  ]);
  const catalog = Array.isArray(catalogRaw) ? catalogRaw : catalogRaw.products ?? [];
  const personas = Array.isArray(personasRaw) ? personasRaw : personasRaw.personas ?? [];
  const runIndex: RunIndexEntry[] = (Array.isArray(idxRaw) ? idxRaw : []).map((r) =>
    typeof r === 'string' ? { run_id: r.replace(/\.json$/, ''), file: r.endsWith('.json') ? r : `${r}.json` } : (r as RunIndexEntry),
  );
  return { config, planogram, catalog, personas, runIndex };
}

export async function loadRun(entry: RunIndexEntry): Promise<Run> {
  const run = await getJSON<Run>(`runs/${entry.file}`);
  run.agents = (run.agents ?? []).map((a) => ({ ...a, path: a.path ?? [], events: (a.events ?? []).slice().sort((x, y) => x.step - y.step) }));
  return run;
}

export const SIM_SERVER = 'http://localhost:8787';

import type { StoreConfig, Planogram, Product, Persona, Run, RunIndexEntry } from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function getJSON<T>(path: string, fallback?: T): Promise<T> {
  try {
    const r = await fetch(BASE + path, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    // older run files prefix generated reasons with an engine tag; strip it so only the reason shows
    return JSON.parse((await r.text()).replace(/"\[mock\] /g, '"')) as T;
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
  stores: StoreEntry[];
}

export interface StoreEntry { id: string; dir: string; label?: string; fixture?: boolean }
/** `?store=<id>` picks a store layout from public/data/stores.json (standard, xl, fixtures6, fixturesxl…).
 *  default: the real XL store when `npm run sync` found data/store/store_xl.config.json, else the standard one */
export const STORE_PARAM = (() => { try { const v = new URLSearchParams(location.search).get('store'); return v && /^[\w-]+$/.test(v) ? v : null; } catch { return null; } })();
/** set once loadAll resolves: the store layout on screen (null = standard) */
export let STORE_VARIANT: StoreEntry | null = null;

export async function loadAll(): Promise<Loaded> {
  const stores = await getJSON<StoreEntry[]>('stores.json', []);
  const pick = STORE_PARAM ? stores.find((s) => s.id === STORE_PARAM) ?? (STORE_PARAM !== 'standard' ? { id: STORE_PARAM, dir: STORE_PARAM, fixture: true } : null)
    : stores.find((s) => s.id === 'xl' && !s.fixture) ?? null;
  STORE_VARIANT = pick && pick.dir ? pick : null;
  const sv = STORE_VARIANT ? `${STORE_VARIANT.dir}/` : '';
  const [config, planogram, catalogRaw, personasRaw, idxRaw, extra, aiPersonas, lensPersonas] = await Promise.all([
    getJSON<StoreConfig>(`${sv}store.config.json`),
    getJSON<Planogram>(`${sv}planogram.json`),
    getJSON<Product[] | { products: Product[] }>('catalog.json', []),
    getJSON<Persona[] | { personas: Persona[] }>('personas.json', []),
    getJSON<unknown[]>('runs/index.json', []),
    sv ? getJSON<Product[] | { products: Product[] }>(`${sv}catalog_extra.json`, []) : Promise.resolve([] as Product[]),
    getJSON<Persona[]>('personas_ai.json', []), // AI-agent archetypes (npm run sync writes it from data/personas/lens kind=ai_agent)
    getJSON<Persona[]>('personas_lens.json', []),
  ]);
  const base = Array.isArray(catalogRaw) ? catalogRaw : catalogRaw.products ?? [];
  const have = new Set(base.map((p) => p.code));
  const ex = Array.isArray(extra) ? extra : extra.products ?? [];
  const catalog = [...base, ...ex.filter((p) => !have.has(p.code))];
  const humans = Array.isArray(personasRaw) ? personasRaw : personasRaw.personas ?? [];
  // AI archetypes have ocean: null on purpose (not a human); keep the type an object so radar code never sees null
  const personas = [...new Map([...humans, ...lensPersonas, ...aiPersonas].map((p) => [p.id, { ...p, ocean: p.ocean ?? {} }])).values()];
  const runIndex: RunIndexEntry[] = (Array.isArray(idxRaw) ? idxRaw : []).map((r) =>
    typeof r === 'string' ? { run_id: r.replace(/\.json$/, ''), file: r.endsWith('.json') ? r : `${r}.json` } : (r as RunIndexEntry),
  );
  return { config, planogram, catalog, personas, runIndex, stores: stores.length ? stores : [{ id: 'standard', dir: '' }] };
}

/** any json under public/data (surfaces, ops, provenance); null when missing */
export async function getData<T>(path: string): Promise<T | null> {
  try { return await getJSON<T>(path); } catch { return null; }
}

export async function loadRun(entry: RunIndexEntry): Promise<Run> {
  const run = await getJSON<Run>(`runs/${entry.file}`);
  run.agents = (run.agents ?? []).map((a) => ({ ...a, path: a.path ?? [], events: (a.events ?? []).slice().sort((x, y) => x.step - y.step) }));
  return run;
}

export const SIM_SERVER = 'http://localhost:8788';

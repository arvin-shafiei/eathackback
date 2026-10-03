import type { OptimiseResponse, Placement, PlacementExperiment, PlacementScan, Planogram, Product, Run } from './types';
import { SIM_SERVER } from './data';

/** POST to the sim server: the vite dev proxy first (no CORS needed), then the server directly. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  let res = await fetch(path, init).catch(() => null);
  if (!res || !(res.headers.get('content-type') ?? '').includes('json')) res = await fetch(`${SIM_SERVER}${path}`, init);
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error ?? `sim server answered ${res.status}`);
  return data as T;
}

interface Common { planogram?: Planogram; products?: Product[]; mock?: boolean; models?: string[] }

/** what sim/tesco.py read for a product, with where each field came from */
export interface ImportDraft extends Partial<Product> {
  barcode?: string; imported_from?: string; off_found?: boolean; field_sources?: Record<string, string>;
}

export const api = {
  importProduct: (ref: string) => post<ImportDraft>('/api/import', { ref }),
  run: (b: Common & { agents: number; seed?: number; label?: string }) => post<Run>('/api/run', b),
  agentRun: (b: Common & { runs: number; seed?: number; exclude?: string[] }) => post<Run>('/api/agent_run', b),
  optimise: (b: Common & { product: string; agents: number; seeds?: number[]; edits?: string[]; price?: number }) =>
    post<OptimiseResponse>('/api/optimise', b),
  placementScan: (b: { product: string; planogram?: Planogram; products?: Product[]; agents?: number; seed?: number }) =>
    post<PlacementScan>('/api/placement/scan', b),
  placementExperiment: (b: Common & { product: string; placements: Placement[]; agents: number; seeds?: number[] }) =>
    post<PlacementExperiment>('/api/placement/experiment', b),
};

// The ops day (sim/ops.py → data/sim/ops/day_*.json, fixture until then): a per-minute timeline of the whole
// store: footfall by mission, queues per lane, stock per slot, staff tasks, spills, orders, café, alarms.
// The 3D replays it on a time-of-day clock; the HUD reads its KPIs (each with a source).
import type { StoreConfig } from './types';
import { slotStand, storePlan } from './layout';

export type At = string | { x: number; z: number };
export interface OpsStaff { id: string; role: 'restocker' | 'cleaner' | 'manager' | 'guard' | 'cashier' | string; lane?: string; name?: string }
export interface OpsMinute {
  t: number; in_store?: number; arrivals?: number;
  shoppers?: Record<string, number>; queues?: Record<string, number>;
  staff?: { id: string; task?: string; at?: At }[];
  spills?: { id: string; at: At; state?: string }[];
  orders?: { code: string; qty?: number; why?: string }[];
  alarms?: { gate?: string; kind?: string; value_gbp?: number; at?: At }[];
  cafe?: { occupied?: number; seats?: number; turned_away?: number };
  stock?: Record<string, number>;
  kpi?: Record<string, number>;
  events?: { kind: string; lane?: string }[];
}
export interface OpsDay {
  day: string; store?: string; open?: string; close?: string; _fixture?: string;
  params?: { name: string; value: unknown; unit?: string; source?: string }[];
  staff?: OpsStaff[]; minutes: OpsMinute[]; kpi_sources?: Record<string, string>;
}
export interface OpsIndexEntry { file: string; day?: string; fixture?: boolean }

/** replay seconds → ops minutes. 1 replay second = 15 shop-floor seconds, so a staff task of a few minutes plays out
 *  over tens of replay seconds and staff visibly walk. visual pacing only. */
export const OPS_RATE = 0.25;
export const DAY_START = 8 * 60, DAY_END = 22 * 60;

const parseT = (t: unknown) => {
  if (typeof t === 'number') return t;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
export function normaliseOps(raw: unknown): OpsDay | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const list = (Array.isArray(r.minutes) ? r.minutes : Array.isArray(r.timeline) ? r.timeline : []) as Record<string, unknown>[];
  const minutes = list.map((m) => ({ ...(m as object), t: parseT(m.t ?? m.minute ?? m.time) }) as OpsMinute).filter((m) => Number.isFinite(m.t)).sort((a, b) => a.t - b.t);
  if (!minutes.length) return null;
  return { ...(r as unknown as OpsDay), minutes };
}
export function minuteAt(day: OpsDay | null, t: number): OpsMinute | null {
  if (!day?.minutes.length) return null;
  const ms = day.minutes;
  let lo = 0, hi = ms.length - 1;
  if (t <= ms[0].t) return ms[0];
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ms[mid].t <= t) lo = mid; else hi = mid - 1; }
  return ms[lo];
}
export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;

/** where an ops location string lives in this store's geometry */
export function resolveAt(cfg: StoreConfig, at: At | undefined, spills?: OpsMinute['spills'], role?: string): { x: number; z: number } | null {
  if (!at) return null;
  if (typeof at === 'object') return at;
  const P = storePlan(cfg);
  if (at === 'stockroom') return { x: P.stockroom.door.x + 1.4, z: P.stockroom.door.z + (role === 'cleaner' ? 1 : 0) };
  if (at === 'office') return { x: P.stockroom.door.x - 1.6, z: P.stockroom.door.z - 1.5 };
  if (at === 'cafe') return { x: P.cafe.counter.x + 1.9, z: P.cafe.counter.z + 0.4 };
  if (at.startsWith('spill:')) { const sp = spills?.find((s) => s.id === at.slice(6)); const p = sp ? spillPos(cfg, sp.at) : null; return p ? { x: p.x + 0.7, z: p.z } : null; }
  const lane = P.lanes.find((l) => l.id === at);
  if (lane) return role === 'cashier' && lane.cashier ? lane.cashier : { x: lane.stand.x, z: lane.stand.z - 1.6 };
  const gate = gateFor(cfg, at);
  if (gate) return { x: gate.x + 0.9, z: gate.z - 1.4 };
  return slotStand(cfg, at, 1.0);
}
export function spillPos(cfg: StoreConfig, at: At) {
  if (typeof at === 'object') return at;
  return slotStand(cfg, at, 2.0);
}
/** gate ids from the ops engine may not match this layout (e.g. G2b in a one-exit store): fall back by index */
export function gateFor(cfg: StoreConfig, id: string | undefined) {
  const gates = storePlan(cfg).gates;
  if (!id) return gates[0];
  const g = gates.find((x) => x.id === id);
  if (g) return g;
  const m = /^G(\d+)([ab])?$/.exec(id);
  if (!m) return null;
  return gates[((Number(m[1]) - 1) * 2 + (m[2] === 'b' ? 1 : 0)) % gates.length];
}

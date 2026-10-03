// The ops day (sim/ops.py → data/sim/ops/day_*.json, fixture until then): a per-minute timeline of the whole
// store: footfall by mission, queues per lane, stock per slot, staff tasks, spills, orders, café, alarms.
// The 3D replays it on a time-of-day clock; the HUD reads its KPIs (each with a source).
import type { StoreConfig } from './types';
import { slotStand, storePlan } from './layout';
import { useEffect, useMemo, useState } from 'react';
import { bus } from './scene/fx';
import { getData } from './data';

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

// ---------------------------------------------------------------- KPI hooks (for the HUD)
// Every number comes straight from the ops day log at the current minute: the engine's own `kpi` block when it has
// one, else counted from that minute's raw fields (queues, stock, spills, café, alarms). `sources` says which.

export interface OpsKpis {
  /** minute of day + "hh:mm" */
  opsMin: number; time: string;
  /** people queueing per checkout lane, across lanes (counted from `queues`) */
  queueP50: number; queueP90: number; queueMax: number; queueTotal: number;
  /** checkout wait in seconds (engine `kpi.wait_p50_s` / `wait_p90_s`; null when the log has no wait KPI) */
  waitP50s: number | null; waitP90s: number | null;
  stockouts: number; lostSalesGbp: number; spillsOpen: number;
  cafeOccupied: number; cafeSeats: number; cafeOccupancy: number; cafeTurnedAway: number;
  /** EAS / skip-scan alarms so far today, and whether one fired in the last 2 ops minutes */
  alarms: number; alarmActive: boolean; shrinkGbp: number; incidents: number;
  inStore: number;
  /** kpi name → where the number came from (engine kpi_sources, else "counted from <field>") */
  sources: Record<string, string>;
  fixture: boolean;
}

const quant = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const alarmCum = new WeakMap<OpsDay, { t: number; n: number; gbp: number }[]>();
function alarmsUpTo(day: OpsDay, t: number) {
  let c = alarmCum.get(day);
  if (!c) {
    let n = 0, gbp = 0; c = [];
    for (const m of day.minutes) { for (const a of m.alarms ?? []) { n++; gbp += a.value_gbp ?? 0; } c.push({ t: m.t, n, gbp }); }
    alarmCum.set(day, c);
  }
  let lo = 0, hi = c.length - 1, best = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (c[mid].t <= t) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  return best < 0 ? { n: 0, gbp: 0 } : c[best];
}

/** pure: KPIs of `day` at minute-of-day `opsMin` */
export function opsKpisAt(day: OpsDay | null, opsMin: number): OpsKpis | null {
  const m = minuteAt(day, opsMin);
  if (!day || !m) return null;
  const k = m.kpi ?? {};
  const src = day.kpi_sources ?? {};
  const counted = (f: string) => `counted from minutes[t=${m.t}].${f} (ops day ${day.day})`;
  const engine = (key: string) => src[key] ?? `minutes[t=${m.t}].kpi.${key} (ops day ${day.day})`;
  const q = Object.values(m.queues ?? {}).map(Number).filter(Number.isFinite);
  const stockCount = Object.values(m.stock ?? {}).filter((v) => v < 0.05).length;
  const al = alarmsUpTo(day, m.t);
  const recent = day.minutes.some((x) => x.t > m.t - 2 && x.t <= m.t && (x.alarms?.length ?? 0) > 0);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const seats = m.cafe?.seats ?? 0, occ = m.cafe?.occupied ?? 0;
  const pick = (key: string, fallback: number, field: string) => (num(k[key]) !== null ? { v: k[key] as number, s: engine(key) } : { v: fallback, s: counted(field) });
  const stockouts = pick('stockouts', stockCount, 'stock (< 5%)');
  const spills = pick('spills_open', (m.spills ?? []).filter((s) => s.state !== 'done').length, 'spills');
  const cafeOcc = pick('cafe_occupancy', seats ? occ / seats : 0, 'cafe');
  const lost = pick('lost_sales_gbp', 0, 'kpi.lost_sales_gbp');
  const shrink = pick('shrink_gbp', al.gbp, 'alarms[].value_gbp (cumulative)');
  const incidents = pick('incidents', al.n, 'alarms (cumulative)');
  return {
    opsMin: m.t, time: hhmm(m.t),
    queueP50: quant(q, 0.5), queueP90: quant(q, 0.9), queueMax: q.length ? Math.max(...q) : 0, queueTotal: q.reduce((a, b) => a + b, 0),
    waitP50s: num(k.wait_p50_s), waitP90s: num(k.wait_p90_s),
    stockouts: stockouts.v, lostSalesGbp: lost.v, spillsOpen: spills.v,
    cafeOccupied: occ, cafeSeats: seats, cafeOccupancy: cafeOcc.v, cafeTurnedAway: m.cafe?.turned_away ?? 0,
    alarms: al.n, alarmActive: recent, shrinkGbp: shrink.v, incidents: incidents.v,
    inStore: m.in_store ?? 0,
    sources: {
      queue: counted('queues'), wait_p50_s: engine('wait_p50_s'), wait_p90_s: engine('wait_p90_s'),
      stockouts: stockouts.s, lost_sales_gbp: lost.s, spills_open: spills.s, cafe_occupancy: cafeOcc.s,
      alarms: counted('alarms (cumulative)'), shrink_gbp: shrink.s, incidents: incidents.s, in_store: counted('in_store'),
    },
    fixture: Boolean(day._fixture) || /fixture/i.test(day.day ?? ''),
  };
}

/** the day the 3D <Ops> layer is replaying (it registers itself), so the HUD needn't thread it through */
let activeDay: OpsDay | null = null;
const dayListeners = new Set<() => void>();
export function setActiveOpsDay(d: OpsDay | null) { if (d === activeDay) return; activeDay = d; dayListeners.forEach((f) => f()); }
export const getActiveOpsDay = () => activeDay;

/**
 * HUD hook. `time` = minute of day (e.g. 13*60+5); omit it to follow the 3D replay clock (bus.opsMin, polled 4×/s).
 * `day` = the ops day; omit it to use the one the <Ops> scene layer is replaying. Returns null until there's data.
 */
export function useOpsKpis(time?: number, day?: OpsDay | null): OpsKpis | null {
  const [, bump] = useState(0);
  const [clock, setClock] = useState(() => Math.floor(bus.opsMin));
  useEffect(() => { const f = () => bump((n) => n + 1); dayListeners.add(f); return () => { dayListeners.delete(f); }; }, []);
  useEffect(() => {
    if (time !== undefined) return;
    const id = setInterval(() => { const m = Math.floor(bus.opsMin); setClock((c) => (c === m ? c : m)); }, 250);
    return () => clearInterval(id);
  }, [time]);
  const d = day === undefined ? activeDay : day;
  const t = time ?? clock;
  return useMemo(() => opsKpisAt(d, t), [d, t]);
}

// ---------------------------------------------------------------- loading (so <Ops> works even when nobody passes `ops`)
/** fetch the newest real ops day (data/sim/ops/day_*.json synced into public/data/ops), else the fixture */
export async function loadOpsDay(file?: string): Promise<OpsDay | null> {
  const idx = (await getData<OpsIndexEntry[]>('ops/index.json')) ?? [];
  const pickEntry = file ? idx.find((e) => e.file === file) ?? { file } : idx.find((e) => !e.fixture) ?? idx[0];
  if (!pickEntry) return null;
  const raw = await getData<unknown>(`ops/${pickEntry.file}`);
  const d = normaliseOps(raw);
  if (d && pickEntry.fixture && !d._fixture) d._fixture = 'fixture ops day (public/data/ops/day_fixture.json)';
  return d;
}
const dayCache = new Map<string, Promise<OpsDay | null>>();
/** React hook around loadOpsDay; `enabled=false` skips the fetch (when the caller already has a day) */
export function useOpsDay(enabled = true, file?: string): OpsDay | null {
  const [d, setD] = useState<OpsDay | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const k = file ?? '';
    if (!dayCache.has(k)) dayCache.set(k, loadOpsDay(file).catch(() => null));
    void dayCache.get(k)!.then((x) => { if (live) setD(x); });
    return () => { live = false; };
  }, [enabled, file]);
  return d;
}
/** where the time-of-day clock starts when the app doesn't say: ?clock=HH:MM, else 12:00 (lunch rush) */
export function defaultClockStart(): number {
  try {
    const v = new URLSearchParams(location.search).get('clock');
    const m = v ? parseT(v) : NaN;
    if (Number.isFinite(m)) return m;
  } catch { /* no location */ }
  return 12 * 60;
}

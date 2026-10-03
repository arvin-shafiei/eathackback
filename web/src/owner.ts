// Store-owner numbers: pure functions over the replay timelines (layout.ts buildTimeline + scheduleCheckouts) and the
// sim run events. No React, no three. Every number below says where it comes from; nothing is fitted or guessed
// except the constants marked "assumption".
//
// IMPORTANT caveat shown in the UI: timelines are the replay's *visual pacing* of the sim run (walk speed, arrival gap
// and queue cap are App.tsx / layout.ts assumptions). Which aisles each shopper visited, what they picked and in what
// order are the sim's own events; how many seconds they spent there is replay pacing.
import type { Agent, Planogram, Product, Run, StoreConfig } from './types';
import { parseSlot, sampleTimeline, storePlan, type StorePlan, type Timeline, type Walkway } from './layout';

/** assumption: floor grid cell size in metres (owner-facing resolution; ~ one trolley + one person wide) */
export const CELL_M = 1.5;
/** assumption: timelines are sampled every SAMPLE_S seconds of replay time to accumulate occupancy */
export const SAMPLE_S = 0.5;
/** assumption: an aisle with fewer than QUIET_SHARE of shoppers walking it is "quiet" (0 = dead zone) */
export const QUIET_SHARE = 0.05;
/** assumption: half-width (m) of a numbered aisle's walkway when testing whether a floor point is "in aisle N" */
export const AISLE_HALF_W = 1.1;

export interface Window { t0: number; t1: number }

export interface OccGrid {
  /** world x of the grid's west edge, z of its north edge, cell size, columns, rows */
  x0: number; z0: number; cell: number; nx: number; nz: number;
  /** people-seconds accumulated per cell (row-major, index = iz * nx + ix) */
  ps: Float32Array;
  /** ps / cell area (m²) / window minutes = people-seconds per m² per minute */
  density: Float32Array;
  max: number;
  window: Window;
  minutes: number;
}

/**
 * Floor occupancy over a time window.
 * How: every timeline is sampled with layout.ts sampleTimeline every SAMPLE_S s inside [t0, t1]; each visible sample adds
 * SAMPLE_S people-seconds to the CELL_M x CELL_M cell under the shopper. density = people-seconds / cell area (m²) /
 * window length (minutes). Dividing density by 60 gives the average number of people standing on one m² during the window.
 * Source: replay timelines (sim run events placed by layout.ts; pacing is a replay assumption).
 */
export function occupancy(cfg: StoreConfig, tls: Record<string, Timeline>, win?: Partial<Window>): OccGrid {
  const B = storePlan(cfg).bounds;
  const cell = CELL_M;
  const x0 = B.xMin - 1, z0 = B.zMin - 1;
  const nx = Math.max(1, Math.ceil((B.xMax - B.xMin + 2) / cell)), nz = Math.max(1, Math.ceil((B.zMax - B.zMin + 2) / cell));
  const ps = new Float32Array(nx * nz);
  const all = Object.values(tls);
  const tEnd = Math.max(0, ...all.map((t) => t.end));
  const t0 = Math.max(0, win?.t0 ?? 0), t1 = Math.min(tEnd, win?.t1 ?? tEnd);
  for (const tl of all) {
    const a = Math.max(t0, tl.start), b = Math.min(t1, tl.end);
    for (let t = Math.ceil(a / SAMPLE_S) * SAMPLE_S; t < b; t += SAMPLE_S) {
      const s = sampleTimeline(tl, t);
      if (!s.visible) continue;
      const ix = Math.floor((s.x - x0) / cell), iz = Math.floor((s.z - z0) / cell);
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
      ps[iz * nx + ix] += SAMPLE_S;
    }
  }
  const minutes = Math.max(1 / 60, (t1 - t0) / 60);
  const density = new Float32Array(ps.length);
  let max = 0;
  for (let i = 0; i < ps.length; i++) { density[i] = ps[i] / (cell * cell) / minutes; if (density[i] > max) max = density[i]; }
  return { x0, z0, cell, nx, nz, ps, density, max, window: { t0, t1 }, minutes };
}

/** where a floor point is, in owner words: "aisle 12", a department name, "checkouts" or "entrance" */
export function placeName(sp: StorePlan, x: number, z: number): { name: string; aisleNo: number | null; walkway: Walkway | null } {
  const w = sp.walkways.find((w) => Math.abs(x - w.x) <= AISLE_HALF_W && z >= Math.min(w.z0, w.z1) - 0.3 && z <= Math.max(w.z0, w.z1) + 0.3);
  if (w) return { name: `aisle ${w.aisleNo}`, aisleNo: w.aisleNo, walkway: w };
  const b = sp.bank;
  if (x >= b.x0 - 1 && x <= b.x1 + 1 && z >= b.z0 - 8 && z <= b.z1 + 1) return { name: 'checkouts', aisleNo: null, walkway: null };
  const d = sp.depts.find((d) => x >= d.rect.x0 && x <= d.rect.x1 && z >= d.rect.z0 && z <= d.rect.z1);
  if (d) return { name: (d.name ?? d.id).toLowerCase(), aisleNo: null, walkway: null };
  if (z >= sp.lobbyZ) return { name: 'entrance', aisleNo: null, walkway: null };
  if (Math.abs(z - sp.crossFront) < 1.6) return { name: 'front cross aisle', aisleNo: null, walkway: null };
  if (Math.abs(z - sp.crossBack) < 1.6) return { name: 'back cross aisle', aisleNo: null, walkway: null };
  return { name: 'shop floor', aisleNo: null, walkway: null };
}

export interface Hotspot { x: number; z: number; density: number; peoplePerM2: number; name: string; aisleNo: number | null; cell: number }

/**
 * Busiest floor cells: cells ranked by density (people-seconds per m² per minute, see occupancy). Cells within
 * minGapM of an already chosen hotspot are skipped so the top N are distinct places.
 * peoplePerM2 = density / 60 (average people standing on one m² during the window).
 */
export function hotspots(cfg: StoreConfig, g: OccGrid, n = 3, minGapM = 4): Hotspot[] {
  const sp = storePlan(cfg);
  const idx = Array.from(g.density.keys()).filter((i) => g.density[i] > 0).sort((a, b) => g.density[b] - g.density[a]);
  const out: Hotspot[] = [];
  for (const i of idx) {
    const x = g.x0 + ((i % g.nx) + 0.5) * g.cell, z = g.z0 + (Math.floor(i / g.nx) + 0.5) * g.cell;
    if (out.some((h) => Math.hypot(h.x - x, h.z - z) < minGapM)) continue;
    const p = placeName(sp, x, z);
    out.push({ x, z, density: g.density[i], peoplePerM2: g.density[i] / 60, name: p.name, aisleNo: p.aisleNo, cell: i });
    if (out.length >= n) break;
  }
  return out;
}

export interface AisleStat {
  aisleNo: number; walkwayId: number; dept: string; cats: string[]; fixture: string;
  /** distinct shoppers with at least one replay segment on this walkway (Seg.a/b.walkway) */
  shoppers: number;
  /** share of all shoppers in the run */
  share: number;
  /** people-seconds spent in this walkway (dwell + move segments ending on it), replay pacing */
  peopleSeconds: number;
  /** sim events (shelf looks) that happened on units lining this aisle, by category */
  looksByCat: Record<string, number>;
  /** picks on units lining this aisle */
  picks: number;
}

/**
 * Per-aisle footfall. shoppers = distinct agents whose timeline has a segment starting or ending on the walkway
 * (layout.ts tags every waypoint with its walkway id). peopleSeconds = summed duration of segments whose end point is on
 * the walkway. looksByCat / picks come from the sim events attached to dwell segments (Seg.event), counted by the
 * category of the unit (cfg.units) the event's slot belongs to.
 */
export function aisleFootfall(cfg: StoreConfig, tls: Record<string, Timeline>): AisleStat[] {
  const sp = storePlan(cfg);
  const ids = Object.keys(tls);
  const unitCat: Record<string, string> = Object.fromEntries(cfg.units.map((u) => [u.id, u.category]));
  const by = new Map<number, AisleStat & { who: Set<string> }>();
  for (const w of sp.walkways) by.set(w.id, { aisleNo: w.aisleNo, walkwayId: w.id, dept: w.dept, cats: w.cats, fixture: w.fixture, shoppers: 0, share: 0, peopleSeconds: 0, looksByCat: {}, picks: 0, who: new Set() });
  for (const id of ids) {
    for (const s of tls[id].segs) {
      for (const wid of [s.a.walkway, s.b.walkway]) if (wid != null) by.get(wid)?.who.add(id);
      const wid = s.b.walkway; if (wid == null) continue;
      const st = by.get(wid); if (!st) continue;
      st.peopleSeconds += s.t1 - s.t0;
      if (s.kind === 'dwell' && s.event && s.slot) {
        const cat = unitCat[parseSlot(s.slot).unit] ?? 'other';
        st.looksByCat[cat] = (st.looksByCat[cat] ?? 0) + 1;
        if (s.event.decision === 'pick') st.picks++;
      }
    }
  }
  return [...by.values()].map(({ who, ...st }) => ({ ...st, shoppers: who.size, share: ids.length ? who.size / ids.length : 0 })).sort((a, b) => a.aisleNo - b.aisleNo);
}

/** dead zones = aisles no shopper walked (share 0); quiet = share below QUIET_SHARE (assumption) */
export function deadZones(aisles: AisleStat[]) {
  return { dead: aisles.filter((a) => a.shoppers === 0), quiet: aisles.filter((a) => a.shoppers > 0 && a.share < QUIET_SHARE) };
}

export interface QueueStat { group: string; kind: 'staffed' | 'self'; served: number; balked: number; waitP50: number; waitP90: number; waitMax: number; lenP90: number; lenMax: number }
const quant = (xs: number[], q: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))]; };

/**
 * Checkout queue stats per line (a staffed lane id, or 'self' for the shared self-checkout snake), from Timeline.queue
 * (layout.ts scheduleCheckouts). wait = tServe - tJoin (seconds of replay time). Line length is sampled every 1 s over the
 * time anyone is queuing at that line: length(t) = shoppers with tJoin <= t < tServe. p50/p90 = nearest-rank quantiles.
 */
export function queueStats(tls: Record<string, Timeline>): QueueStat[] {
  const groups = new Map<string, { kind: 'staffed' | 'self'; waits: number[]; spans: [number, number][]; balked: number }>();
  for (const tl of Object.values(tls)) {
    const q = tl.queue; if (!q) continue;
    const g = groups.get(q.group) ?? groups.set(q.group, { kind: q.kind, waits: [], spans: [], balked: 0 }).get(q.group)!;
    g.waits.push(Math.max(0, q.tServe - q.tJoin)); g.spans.push([q.tJoin, q.tServe]); if (q.balked) g.balked++;
  }
  const out: QueueStat[] = [];
  for (const [group, g] of groups) {
    const lo = Math.min(...g.spans.map((s) => s[0])), hi = Math.max(...g.spans.map((s) => s[1]));
    const lens: number[] = [];
    for (let t = Math.floor(lo); t < hi; t += 1) { let n = 0; for (const [a, b] of g.spans) if (t >= a && t < b) n++; lens.push(n); }
    out.push({ group, kind: g.kind, served: g.waits.length, balked: g.balked, waitP50: quant(g.waits, 0.5), waitP90: quant(g.waits, 0.9), waitMax: Math.max(0, ...g.waits), lenP90: quant(lens, 0.9), lenMax: Math.max(0, ...lens) });
  }
  return out.sort((a, b) => b.waitP90 - a.waitP90);
}

export interface SpreadTip { cat: string; fromAisle: number; toAisle: number; fromShare: number; toShare: number; fromLooks: number; why: string }

/**
 * Heuristic (labelled as such in the UI): pair the busiest category-aisle with the quietest compatible aisle.
 * busiest = aisle with most peopleSeconds; its category = the one with most sim looks there.
 * compatible = same fixture type (gondola ↔ gondola, freezer ↔ freezer…), a different aisle; quietest = fewest shoppers.
 * Idea: a footfall driver moved to a quiet aisle pulls people through it and thins the crowd where it was. Not simulated;
 * test it with the rearrange panel / a re-run.
 */
export function spreadTip(aisles: AisleStat[]): SpreadTip | null {
  const busy = [...aisles].filter((a) => a.peopleSeconds > 0).sort((a, b) => b.peopleSeconds - a.peopleSeconds)[0];
  if (!busy) return null;
  const cat = Object.entries(busy.looksByCat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? busy.cats[0];
  if (!cat) return null;
  const quiet = aisles.filter((a) => a.aisleNo !== busy.aisleNo && a.fixture === busy.fixture).sort((a, b) => a.shoppers - b.shoppers || a.peopleSeconds - b.peopleSeconds)[0];
  if (!quiet) return null;
  return { cat, fromAisle: busy.aisleNo, toAisle: quiet.aisleNo, fromShare: busy.share, toShare: quiet.share, fromLooks: busy.looksByCat[cat] ?? 0,
    why: `aisle ${busy.aisleNo} has the most people-seconds (${Math.round(busy.peopleSeconds)}); aisle ${quiet.aisleNo} is the quietest ${busy.fixture} aisle (${Math.round(quiet.share * 100)}% of shoppers)` };
}

// ---------------- which shelf: the notice model ----------------
export interface RowCoef { row: 'top' | 'eye' | 'bottom'; logit: number; p: number; source: string }
export interface NoticeCoefs { alpha0: number; pRef: number; rows: RowCoef[]; alphaF: number; alphaFSource: string; refSource: string; from: string }
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/**
 * Notice-model row effects. Read from run.notice_model.derived (written by sim/notice.py from sim/coefficients.json into
 * every run). If a run has none, the same derivation is redone here from the coefficients.json values
 * (p_ref 0.55, eye/bottom 1.39, top/bottom 1.17, facings elasticity 0.17), labelled as a fallback.
 * p(row) = sigmoid(alpha0 + alpha_row[row]) = chance of noticing one product, 1 facing, centre, on-mission shopper.
 */
export function noticeCoefs(run: Run | null): NoticeCoefs {
  const nm = (run?.notice_model ?? {}) as { derived?: Record<string, any>; inputs?: Record<string, any> };
  const d = nm.derived, inp = nm.inputs ?? {};
  if (d?.alpha0 && d.alpha_row) {
    const a0 = Number(d.alpha0.value);
    const rows = (['top', 'eye', 'bottom'] as const).map((r) => ({ row: r, logit: Number(d.alpha_row[r]?.value ?? 0), p: sigmoid(a0 + Number(d.alpha_row[r]?.value ?? 0)), source: String(d.alpha_row[r]?.source ?? '') }));
    return { alpha0: a0, pRef: sigmoid(a0), rows, alphaF: Number(d.alpha_f?.value ?? 0), alphaFSource: String(inp.facings_elasticity?.source ?? d.alpha_f?.source ?? ''), refSource: String(inp.p_ref_eye_centre_1facing?.source ?? ''), from: 'run.notice_model (sim/notice.py from sim/coefficients.json)' };
  }
  const pRef = 0.55, pB = pRef / 1.39, pT = pB * 1.17;
  return { alpha0: logit(pRef), pRef, alphaF: 0.17 / (1 - pRef), alphaFSource: 'sim/coefficients.json facings_elasticity (Eisend 2014)', refSource: 'sim/coefficients.json p_ref_eye_centre_1facing (assumption)', from: 'fallback: sim/coefficients.json values copied into owner.ts (run has no notice_model)',
    rows: [
      { row: 'top', logit: logit(pT) - logit(pRef), p: pT, source: 'eye_vs_bottom 1.39 + top_vs_bottom 1.17 (research/04 §1, Chandon et al. 2009)' },
      { row: 'eye', logit: 0, p: pRef, source: 'reference row' },
      { row: 'bottom', logit: logit(pB) - logit(pRef), p: pB, source: 'eye_vs_bottom 1.39 (research/04 §1)' },
    ] };
}

export interface CatShelf { cat: string; rows: Record<'top' | 'eye' | 'bottom', { shown: number; noticed: number; rate: number }>; picks: number }
/**
 * Observed noticing per category and shelf row in this run: for every sim event, row = event.notice_factors.row
 * (rows 4-5 on superstore gondolas are already mapped to "bottom" by sim/notice.py), noticed = event.noticed.
 * rate = noticed / shown. Category = the product's catalog category (falls back to the unit category).
 */
export function shelfByCategory(run: Run | null, products: Record<string, Product>, cfg: StoreConfig): CatShelf[] {
  if (!run) return [];
  const unitCat: Record<string, string> = Object.fromEntries(cfg.units.map((u) => [u.id, u.category]));
  const m = new Map<string, CatShelf>();
  for (const a of run.agents) for (const e of a.events) {
    const row = (e.notice_factors as { row?: string } | undefined)?.row;
    if (row !== 'top' && row !== 'eye' && row !== 'bottom') continue;
    const cat = products[e.product]?.category ?? unitCat[parseSlot(e.slot).unit] ?? 'other';
    const c = m.get(cat) ?? m.set(cat, { cat, picks: 0, rows: { top: { shown: 0, noticed: 0, rate: 0 }, eye: { shown: 0, noticed: 0, rate: 0 }, bottom: { shown: 0, noticed: 0, rate: 0 } } }).get(cat)!;
    c.rows[row].shown++; if (e.noticed) c.rows[row].noticed++;
    if (e.decision === 'pick') c.picks++;
  }
  for (const c of m.values()) for (const r of Object.values(c.rows)) r.rate = r.shown ? r.noticed / r.shown : 0;
  return [...m.values()].sort((a, b) => b.picks - a.picks);
}

export interface PairTip { a: string; b: string; count: number; catA: string; catB: string; slotA: string; slotB: string; apart: boolean }
/**
 * Co-purchase: for each shopper, the set of products they picked (event.decision === 'pick'). Every unordered pair in
 * that set counts 1. Top pairs by count; apart = the two products sit in different aisles/walls (planogram slot → unit
 * → storePlan unit aisle), which is where "put X next to Y" could save a walk. Count = number of shoppers.
 */
export function coPurchase(run: Run | null, plan: Planogram | null, cfg: StoreConfig, products: Record<string, Product>, n = 5): PairTip[] {
  if (!run) return [];
  const where: Record<string, string> = {};
  if (plan) for (const [slot, s] of Object.entries(plan)) for (const c of s?.products ?? []) where[c] ??= slot;
  const sp = storePlan(cfg);
  const loc = (code: string, fallback: string) => { const slot = where[code] ?? fallback; const u = sp.units[parseSlot(slot).unit]; return { slot, key: u ? (u.aisleNo != null ? `a${u.aisleNo}` : `w${u.wall}:${u.dept}`) : slot }; };
  const evSlot: Record<string, string> = {};
  const cnt = new Map<string, number>();
  for (const a of run.agents as Agent[]) {
    const picked = new Set<string>();
    for (const e of a.events) if (e.decision === 'pick' && e.product) { picked.add(e.product); evSlot[e.product] ??= e.slot; }
    const xs = [...picked].sort();
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) { const k = `${xs[i]}|${xs[j]}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
  }
  const out: PairTip[] = [];
  for (const [k, count] of [...cnt].sort((a, b) => b[1] - a[1])) {
    const [a, b] = k.split('|');
    const la = loc(a, evSlot[a]), lb = loc(b, evSlot[b]);
    out.push({ a, b, count, catA: products[a]?.category ?? '', catB: products[b]?.category ?? '', slotA: la.slot, slotB: lb.slot, apart: la.key !== lb.key });
    if (out.length >= n * 4) break;
  }
  // prefer pairs that are currently apart (the actionable ones), then by count
  return out.sort((x, y) => Number(y.apart) - Number(x.apart) || y.count - x.count).slice(0, n);
}

/** everything the owner panel shows, in one call (memoise on timelines / run) */
export function ownerReport(cfg: StoreConfig, plan: Planogram | null, products: Record<string, Product>, tls: Record<string, Timeline>, run: Run | null, win?: Partial<Window>) {
  const grid = occupancy(cfg, tls, win);
  const aisles = aisleFootfall(cfg, tls);
  return {
    grid, hot: hotspots(cfg, grid, 3), aisles, zones: deadZones(aisles), queues: queueStats(tls), spread: spreadTip(aisles),
    notice: noticeCoefs(run), shelves: shelfByCategory(run, products, cfg), pairs: coPurchase(run, plan, cfg, products), shoppers: Object.keys(tls).length,
  };
}
export type OwnerReport = ReturnType<typeof ownerReport>;

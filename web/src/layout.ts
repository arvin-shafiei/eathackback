// Store geometry derived entirely from store.config.json, so adding aisles/units/rows just works.
// Units: metres. Gondolas run along z; each aisle = one double-sided gondola with a centre divider,
// side L faces -x, side R faces +x. Shoppers walk the walkways between gondolas.
import type { StoreConfig, Planogram, Unit, Agent, SimEvent } from './types';

export const G = {
  spacing: 5.0, // gondola centre-to-centre (assumption: visual only, ~4m walkway so trolleys can pass + 1m gondola)
  depth: 1.0, // gondola depth, both sides
  height: 2.1,
  unitLen: 6.4,
  zCentre: 10,
  standOff: 1.3, // how far in front of the shelf face a shopper stands
  walkSpeed: 1.3, // m/s. assumption: typical in-store walking speed is slower than the ~1.4 m/s street pace
  aiWalkSpeed: 2.2, // m/s. assumption: visual only. ai agents read a feed, so their "walk" is just a way to show which slot they read
  crossGap: 2.4, // cross-aisle distance from the gondola ends (room for end caps + trolleys)
  endcapDepth: 0.7,
};

/** dwell (replay seconds) per decision. visual pacing only, never feeds a stat. */
export const DWELL = { pick: 2.4, reject: 2.8, walk_past: 1.1, not_noticed: 0.3, ai_walk_past: 0.45, ai_pick: 1.6 } as const;
/** within a dwell, as fractions: when the hand grabs the product, when a pick is thrown, when a reject goes back */
export const BEAT = { grab: 0.28, launch: 0.46, putBack: 0.66, backOnShelf: 0.84 } as const;

export function gondolaX(cfg: StoreConfig, aisle: number) {
  return (aisle - (cfg.aisles + 1) / 2) * G.spacing;
}
export const zRange = () => [G.zCentre - G.unitLen / 2, G.zCentre + G.unitLen / 2] as const;
export const crossFront = () => zRange()[0] - G.crossGap;
export const crossBack = () => zRange()[1] + G.crossGap;

/** checkout counters + the lane next to each one; count grows with the store */
export function checkoutLayout(cfg: StoreConfig) {
  const n = Math.max(3, Math.min(8, cfg.aisles));
  const pitch = 2.8;
  const counters = Array.from({ length: n }, (_, k) => cfg.checkout.x + (k - (n - 1) / 2) * pitch);
  return { counters, lanes: counters.map((x) => x - pitch / 2), z: cfg.checkout.z, len: 2.4 };
}
/** outer walls of the store, derived from the config so any aisle count fits */
export function storeBounds(cfg: StoreConfig) {
  const gx = Math.abs(gondolaX(cfg, cfg.aisles)) + G.depth / 2;
  const co = checkoutLayout(cfg);
  const halfX = Math.max(gx + G.spacing * 0.9, Math.abs(co.counters[0] - cfg.checkout.x) + 3, 10);
  const zMin = Math.min(cfg.entrance.z - 1.4, crossFront() - 5);
  const zMax = Math.max(cfg.checkout.z + 3.6, crossBack() + 4);
  return { xMin: cfg.entrance.x - halfX, xMax: cfg.entrance.x + halfX, zMin, zMax, cx: cfg.entrance.x, cz: (zMin + zMax) / 2, w: halfX * 2, d: zMax - zMin };
}

export function unitFrame(cfg: StoreConfig, u: Unit) {
  const gx = gondolaX(cfg, u.aisle);
  const dir = u.side === 'L' ? -1 : 1; // facing direction along x
  return { x: gx + dir * (G.depth / 2), z: G.zCentre, rotY: dir * Math.PI / 2, dir, gx };
}
/** local (along-row x, out-of-shelf z) → world xz */
export function unitLocalToWorld(cfg: StoreConfig, u: Unit, lx: number, lz: number) {
  const f = unitFrame(cfg, u);
  // rotation about y by rotY: local x → (cos, -sin), local z → (sin, cos)
  const c = Math.cos(f.rotY), s = Math.sin(f.rotY);
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c };
}

export function rowY(cfg: StoreConfig, row: number) {
  // row 1 = top. Spread rows from 0.12m to ~1.5m shelf base.
  const n = cfg.rows_per_unit;
  const lo = 0.12, hi = 1.45;
  return n === 1 ? 0.8 : hi - ((row - 1) * (hi - lo)) / (n - 1);
}
export const rowGap = (cfg: StoreConfig) => (cfg.rows_per_unit > 1 ? (1.45 - 0.12) / (cfg.rows_per_unit - 1) : 1);

export const parseSlot = (slot: string) => {
  const m = /^(.*)-r(\d+)$/.exec(slot);
  return m ? { unit: m[1], row: Number(m[2]) } : { unit: slot, row: 1 };
};

export interface ProductPlacement { code: string; slot: string; lx: number; width: number; facings: number; index: number }
/** lay products of a slot out along the row; facings contiguous */
export function slotPlacements(slot: string, set: { products: string[]; facings: Record<string, number> } | undefined): ProductPlacement[] {
  if (!set) return [];
  const total = set.products.reduce((s, c) => s + Math.max(1, set.facings?.[c] ?? 1), 0);
  const usable = G.unitLen - 0.4;
  const fw = Math.min(0.62, usable / Math.max(total, 1)); // facing width: fills more of the bigger shelf, still proportional to facings
  let x = -(total * fw) / 2;
  return set.products.map((code, index) => {
    const f = Math.max(1, set.facings?.[code] ?? 1);
    const p = { code, slot, lx: x + (f * fw) / 2, width: fw, facings: f, index };
    x += f * fw;
    return p;
  });
}

export function categoryHeight(cat: string) {
  return CAT_H[cat] ?? 0.3;
}
const CAT_H: Record<string, number> = {
  soft_drinks: 0.36, crisps_savoury: 0.34, snack_bars: 0.22, breakfast_cereal: 0.44, yoghurt: 0.2, biscuits_chocolate: 0.24,
  plant_milk_dairy_alt: 0.4, ready_meals_soup: 0.3, bakery_bread: 0.3, frozen_icecream: 0.26, hot_drinks: 0.32, confectionery_sweets: 0.2,
};
/** world centre of the front facing of `code` in `slot` (falls back to slot centre) */
export function productWorld(cfg: StoreConfig, plan: Planogram, rawSlot: string, code: string | null) {
  const slot = shelfSlotFor(plan, rawSlot, code);
  const { unit, row } = parseSlot(slot);
  const u = cfg.units.find((x) => x.id === unit);
  if (!u) return null;
  const pl = slotPlacements(slot, plan[slot]);
  const p = code ? pl.find((q) => q.code === code) : null;
  const w = unitLocalToWorld(cfg, u, p ? p.lx : 0, -0.2);
  const h = Math.min(categoryHeight(plan[slot]?.category ?? u.category), rowGap(cfg) - 0.1);
  return { x: w.x, y: rowY(cfg, row) + h / 2, z: w.z, slot, unit: u, h };
}

// ---------------- shopper routing & timeline ----------------
export interface WP { x: number; z: number; walkway: number | null }
export interface Seg { t0: number; t1: number; a: WP; b: WP; kind: 'move' | 'dwell'; event?: SimEvent; slot?: string; face?: number }
export interface Timeline { segs: Seg[]; start: number; end: number }

const walkwayOf = (cfg: StoreConfig, u: Unit) => (u.side === 'L' ? u.aisle - 1 : u.aisle); // walkway index 0..aisles

/** events from the ai-agent arm use slot "feed:<mission>"; place them at the product's shelf slot */
export function shelfSlotFor(plan: Planogram, slot: string, code: string | null): string {
  if (plan[slot] || !code) return slot;
  return Object.keys(plan).find((k) => plan[k]?.products?.includes(code)) ?? slot;
}

function standPoint(cfg: StoreConfig, units: Record<string, Unit>, plan: Planogram, rawSlot: string, code: string | null, jitter: number): WP | null {
  const slot = shelfSlotFor(plan, rawSlot, code);
  const { unit } = parseSlot(slot);
  const u = units[unit];
  if (!u) return null;
  const pl = slotPlacements(slot, plan[slot]);
  const p = code ? pl.find((q) => q.code === code) : null;
  const lx = p ? p.lx : 0;
  const w = unitLocalToWorld(cfg, u, lx, G.standOff + jitter);
  return { ...w, walkway: walkwayOf(cfg, u) };
}

function route(a: WP, b: WP): WP[] {
  if (a.walkway !== null && a.walkway === b.walkway) return [b];
  const [z0, z1] = zRange();
  const inside = (p: WP) => p.z > z0 - 0.5 && p.z < z1 + 0.5 && p.walkway !== null;
  if (!inside(a) && !inside(b)) return [b];
  const front = crossFront(), back = crossBack();
  const cost = (zc: number) => Math.abs(a.z - zc) + Math.abs(b.z - zc);
  const zc = cost(front) <= cost(back) ? front : back;
  const out: WP[] = [];
  if (inside(a)) out.push({ x: a.x, z: zc, walkway: null });
  else out.push({ x: a.x, z: zc, walkway: null });
  out.push({ x: b.x, z: zc, walkway: null });
  out.push(b);
  return out;
}

export function buildTimeline(cfg: StoreConfig, plan: Planogram, agent: Agent, startAt: number, seedIdx: number, ai = false): Timeline {
  const units = Object.fromEntries(cfg.units.map((u) => [u.id, u]));
  const jitter = ((seedIdx * 37) % 7) / 7 * 0.5 - 0.25;
  const speed = ai ? G.aiWalkSpeed : G.walkSpeed;
  const segs: Seg[] = [];
  let t = startAt;
  // spawn outside the sliding doors and walk in
  let cur: WP = { x: cfg.entrance.x + jitter * 3, z: cfg.entrance.z - 4.2, walkway: null };
  const moveTo = (b: WP) => {
    for (const w of route(cur, b)) {
      const d = Math.hypot(w.x - cur.x, w.z - cur.z);
      if (d < 1e-3) { cur = w; continue; }
      const dt = d / speed;
      segs.push({ t0: t, t1: t + dt, a: cur, b: w, kind: 'move' });
      t += dt; cur = w;
    }
  };
  moveTo({ x: cfg.entrance.x + jitter * 2, z: cfg.entrance.z + 0.6, walkway: null });
  // events grouped in order; if events are empty fall back to path
  const evs = agent.events.length ? agent.events : agent.path.map((slot, i) => ({ step: i, slot, product: '', p_notice: 0, noticed: false, decision: 'not_noticed' as const }));
  for (const e of evs) {
    const sp = standPoint(cfg, units, plan, e.slot, e.product || null, jitter);
    if (!sp) continue;
    moveTo(sp);
    const dwell = ai
      ? (e.decision === 'pick' ? DWELL.ai_pick : DWELL.ai_walk_past)
      : DWELL[e.decision] ?? DWELL.walk_past;
    const u = units[parseSlot(shelfSlotFor(plan, e.slot, e.product || null)).unit];
    const face = u ? Math.atan2(-unitFrame(cfg, u).dir, 0) : 0;
    segs.push({ t0: t, t1: t + dwell, a: cur, b: cur, kind: 'dwell', event: e, slot: e.slot, face });
    t += dwell;
  }
  // to a checkout lane: leave the aisles by the back cross-aisle, queue, pay
  const co = checkoutLayout(cfg);
  const laneX = co.lanes[seedIdx % co.lanes.length] + jitter * 0.6;
  if (cur.walkway !== null) moveTo({ x: cur.x, z: crossBack(), walkway: null });
  moveTo({ x: laneX, z: co.z - co.len / 2 - 1.2, walkway: null });
  moveTo({ x: laneX, z: co.z + co.len / 2 + 0.9, walkway: null });
  return { segs, start: startAt, end: t };
}

export function sampleTimeline(tl: Timeline, t: number): { x: number; z: number; heading: number; seg: Seg | null; visible: boolean } {
  if (!tl.segs.length || t < tl.start) return { x: 0, z: 0, heading: 0, seg: null, visible: false };
  if (t >= tl.end) { const s = tl.segs[tl.segs.length - 1]; return { x: s.b.x, z: s.b.z, heading: 0, seg: null, visible: false }; }
  let lo = 0, hi = tl.segs.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (tl.segs[mid].t1 < t) lo = mid + 1; else hi = mid; }
  const s = tl.segs[lo];
  const k = s.t1 > s.t0 ? Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))) : 1;
  const x = s.a.x + (s.b.x - s.a.x) * k, z = s.a.z + (s.b.z - s.a.z) * k;
  let heading = Math.atan2(s.b.x - s.a.x, s.b.z - s.a.z);
  if (s.kind === 'dwell') {
    heading = s.face ?? 0;
  }
  return { x, z, heading, seg: s, visible: true };
}

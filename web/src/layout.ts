// Store geometry derived entirely from store.config.json, so adding aisles/units/rows just works.
// Units: metres. Gondolas run along z; each aisle = one double-sided gondola with a centre divider,
// side L faces -x, side R faces +x. Shoppers walk the walkways between gondolas.
import type { StoreConfig, Planogram, Unit, Agent, SimEvent } from './types';

export const G = {
  spacing: 4.4, // gondola centre-to-centre (assumption: ~2.4m UK aisle walkway + 2x shelf depth)
  depth: 1.0, // gondola depth, both sides
  height: 2.0,
  unitLen: 5.6,
  zCentre: 10,
  standOff: 1.25, // how far in front of the shelf face a shopper stands
  walkSpeed: 1.3, // m/s. assumption: typical in-store walking speed is slower than the ~1.4 m/s street pace
};

export function gondolaX(cfg: StoreConfig, aisle: number) {
  return (aisle - (cfg.aisles + 1) / 2) * G.spacing;
}
export const zRange = () => [G.zCentre - G.unitLen / 2, G.zCentre + G.unitLen / 2] as const;
export const crossFront = () => zRange()[0] - 1.6;
export const crossBack = () => zRange()[1] + 1.6;

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
  const fw = Math.min(0.46, usable / Math.max(total, 1));
  let x = -(total * fw) / 2;
  return set.products.map((code, index) => {
    const f = Math.max(1, set.facings?.[code] ?? 1);
    const p = { code, slot, lx: x + (f * fw) / 2, width: fw, facings: f, index };
    x += f * fw;
    return p;
  });
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

export function buildTimeline(cfg: StoreConfig, plan: Planogram, agent: Agent, startAt: number, seedIdx: number): Timeline {
  const units = Object.fromEntries(cfg.units.map((u) => [u.id, u]));
  const jitter = ((seedIdx * 37) % 7) / 7 * 0.5 - 0.25;
  const segs: Seg[] = [];
  let t = startAt;
  let cur: WP = { x: cfg.entrance.x + jitter, z: cfg.entrance.z, walkway: null };
  const moveTo = (b: WP) => {
    for (const w of route(cur, b)) {
      const d = Math.hypot(w.x - cur.x, w.z - cur.z);
      if (d < 1e-3) { cur = w; continue; }
      const dt = d / G.walkSpeed;
      segs.push({ t0: t, t1: t + dt, a: cur, b: w, kind: 'move' });
      t += dt; cur = w;
    }
  };
  // events grouped in order; if events are empty fall back to path
  const evs = agent.events.length ? agent.events : agent.path.map((slot, i) => ({ step: i, slot, product: '', p_notice: 0, noticed: false, decision: 'not_noticed' as const }));
  for (const e of evs) {
    const sp = standPoint(cfg, units, plan, e.slot, e.product || null, jitter);
    if (!sp) continue;
    moveTo(sp);
    const dwell = e.decision === 'not_noticed' ? 0.25 : e.decision === 'walk_past' ? 1.1 : 2.2;
    const u = units[parseSlot(shelfSlotFor(plan, e.slot, e.product || null)).unit];
    const face = u ? Math.atan2(-unitFrame(cfg, u).dir, 0) : 0;
    segs.push({ t0: t, t1: t + dwell, a: cur, b: cur, kind: 'dwell', event: e, slot: e.slot, face });
    t += dwell;
  }
  moveTo({ x: cfg.checkout.x + jitter, z: cfg.checkout.z, walkway: null });
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

// Store geometry derived entirely from store.config.json, so more aisles, more units per side ("bays"),
// more rows, extra entrances, checkouts, a café and a stockroom all just work.
// Units: metres. Gondolas run along z; each aisle = one double-sided gondola with a centre divider,
// side L faces -x, side R faces +x. Shoppers walk the walkways between gondolas.
// Zones front→back: entrance(s) + meal deal + café | aisles | checkouts (staffed + self) | exit with EAS gates.
import type { StoreConfig, Planogram, Unit, Agent, SimEvent } from './types';

export const G = {
  spacing: 5.0, // gondola centre-to-centre (assumption: visual only, ~4m walkway so trolleys can pass + 1m gondola)
  depth: 1.0, // gondola depth, both sides
  height: 2.1,
  unitLen: 6.4, // one bay of shelving along the aisle
  z0: 6.8, // front end of every gondola
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
/** checkout choreography (replay seconds, visual pacing only: the ops engine owns the real service times) */
export const TILL = { unloadPer: 0.32, scanPer: 0.55, selfScanPer: 0.8, bag: 1.1, pay: 1.4, selfMaxItems: 6 } as const;

// ---------------------------------------------------------------- plan
interface XY { x: number; z: number }
export interface Lane {
  id: string; kind: 'staffed' | 'self'; idx: number;
  /** staffed: counter centre; self: kiosk centre */
  x: number; z: number;
  /** where the shopper stands to load / scan, queue grows toward -z from here */
  stand: XY; queueDir: XY;
  /** staffed only: belt from load end → scanner, then bagging */
  beltStart?: XY; beltEnd?: XY; scanner: XY & { y: number }; bag: XY & { y: number }; cashier?: XY;
}
export interface StorePlan {
  bays: number; z0: number; z1: number; crossFront: number; crossBack: number;
  frontZ: number; entrances: XY[]; exits: XY[]; gates: (XY & { id: string })[];
  lanes: Lane[]; checkoutZ: number;
  cafe: { x: number; z: number; w: number; d: number; counter: XY; seats: (XY & { table: number; yaw: number })[]; tables: XY[] };
  stockroom: { x: number; z: number; w: number; d: number; door: XY };
  mealDeal: XY;
  bounds: { xMin: number; xMax: number; zMin: number; zMax: number; cx: number; cz: number; w: number; d: number };
  unitPos: Record<string, { bay: number; nb: number }>;
}

const plans = new WeakMap<StoreConfig, StorePlan>();
export function gondolaX(cfg: StoreConfig, aisle: number) {
  return (aisle - (cfg.aisles + 1) / 2) * G.spacing;
}
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const asPts = (v: unknown): XY[] | null => (Array.isArray(v) && v.length && v.every((p) => p && typeof p === 'object' && 'x' in p && 'z' in p) ? (v as XY[]) : null);

export function storePlan(cfg: StoreConfig): StorePlan {
  const hit = plans.get(cfg); if (hit) return hit;
  const x = cfg as StoreConfig & Record<string, unknown>;
  // bays: units sharing an aisle+side are laid end to end (explicit `bay` wins, else config order)
  const unitPos: StorePlan['unitPos'] = {};
  let bays = 1;
  const groups = new Map<string, Unit[]>();
  for (const u of cfg.units) { const k = `${u.aisle}${u.side}`; groups.set(k, [...(groups.get(k) ?? []), u]); }
  for (const list of groups.values()) {
    const sorted = list.slice().sort((a, b) => num((a as unknown as Record<string, unknown>).bay, list.indexOf(a)) - num((b as unknown as Record<string, unknown>).bay, list.indexOf(b)));
    sorted.forEach((u, i) => { unitPos[u.id] = { bay: i, nb: sorted.length }; });
    bays = Math.max(bays, sorted.length);
  }
  const z0 = G.z0, z1 = z0 + bays * G.unitLen;
  const crossFront = z0 - G.crossGap, crossBack = z1 + G.crossGap;
  const frontZ = Math.min(num(cfg.entrance?.z, -2), crossFront - 6.5) - 1.4;
  const gx = Math.abs(gondolaX(cfg, cfg.aisles)) + G.depth / 2;

  // checkouts: staffed tills + self-checkout kiosks (counts from config, else scaled with the store)
  const co = (x.checkouts ?? {}) as Record<string, unknown>;
  const staffedPts = asPts(co.staffed), selfPts = asPts(co.self);
  const nStaffed = staffedPts?.length ?? num(co.staffed, Math.max(3, Math.min(6, cfg.aisles - 1)));
  const nSelf = selfPts?.length ?? num(co.self, Math.max(4, Math.min(12, cfg.aisles * 2)));
  const checkoutZ = Math.max(num(cfg.checkout?.z, 0), crossBack + 4.4);
  const pitch = 2.9, kpitch = 1.45, belt = 2.6;
  const staffedW = nStaffed * pitch, selfCols = Math.ceil(nSelf / 2), selfW = selfCols * kpitch;
  const totalW = staffedW + 1.6 + selfW;
  const left = num(cfg.checkout?.x, 0) - totalW / 2;
  const lanes: Lane[] = [];
  for (let i = 0; i < nStaffed; i++) {
    const p = staffedPts?.[i];
    const cx = p?.x ?? left + (i + 0.5) * pitch, cz = p?.z ?? checkoutZ;
    const sx = cx - 0.95; // shopper walks down the left of the counter
    lanes.push({
      id: `T${i + 1}`, kind: 'staffed', idx: i, x: cx, z: cz,
      stand: { x: sx, z: cz - belt / 2 + 0.1 }, queueDir: { x: 0, z: -1 },
      beltStart: { x: cx - 0.12, z: cz - belt / 2 + 0.25 }, beltEnd: { x: cx - 0.12, z: cz + 0.35 },
      scanner: { x: cx - 0.1, y: 0.99, z: cz + 0.55 }, bag: { x: cx - 0.2, y: 0.99, z: cz + belt / 2 - 0.25 }, cashier: { x: cx + 0.65, z: cz + 0.5 },
    });
  }
  const sLeft = left + staffedW + 1.6;
  for (let i = 0; i < nSelf; i++) {
    const p = selfPts?.[i];
    const col = i % selfCols, row = Math.floor(i / selfCols);
    // two rows facing each other across a corridor (front row's backs to the shop floor)
    const face = row === 0 ? 1 : -1; // direction from kiosk to where the shopper stands
    const kx = p?.x ?? sLeft + (col + 0.5) * kpitch, kz = p?.z ?? checkoutZ + (row === 0 ? -1.35 : 1.35);
    lanes.push({
      id: `S${i + 1}`, kind: 'self', idx: i, x: kx, z: kz,
      stand: { x: kx, z: kz + face * 0.72 }, queueDir: { x: -1, z: 0 },
      scanner: { x: kx - 0.1, y: 1.0, z: kz + face * 0.2 }, bag: { x: kx + 0.45, y: 0.82, z: kz + face * 0.12 },
    });
  }
  const laneMinX = Math.min(...lanes.map((l) => l.x)) - 1.5, laneMaxX = Math.max(...lanes.map((l) => l.x)) + 1.5;
  const halfX = Math.max(gx + G.spacing * 0.9 + 0.5, Math.abs(laneMinX) + 1, Math.abs(laneMaxX) + 1, 13);
  const cxs = 0;
  const xMin = cxs - halfX, xMax = cxs + halfX;
  const zMax = checkoutZ + belt / 2 + 6.2;

  const ents = asPts(x.entrances) ?? [{ x: num(cfg.entrance?.x, 0), z: frontZ }];
  const entrances = ents.map((e) => ({ x: e.x, z: frontZ }));
  const exitsCfg = asPts(x.exits);
  const exits = exitsCfg ? exitsCfg.map((e) => ({ x: e.x, z: zMax })) : (cfg.aisles >= 5 ? [{ x: -halfX * 0.45, z: zMax }, { x: halfX * 0.45, z: zMax }] : [{ x: 0, z: zMax }]);
  const gates = exits.flatMap((e, i) => [{ id: `G${i + 1}a`, x: e.x - 1.15, z: zMax - 1.3 }, { id: `G${i + 1}b`, x: e.x + 1.15, z: zMax - 1.3 }]);

  // café: front-left corner (explicit `cafe` in config wins)
  const cafeCfg = (x.cafe ?? {}) as Record<string, unknown>;
  const cw = num(cafeCfg.w, Math.min(8, halfX - 4)), cd = num(cafeCfg.d, Math.min(7, crossFront - frontZ - 2.2));
  const ccx = num(cafeCfg.x, xMin + 0.4 + cw / 2), ccz = num(cafeCfg.z, frontZ + 0.8 + cd / 2);
  const nTables = num(cafeCfg.tables, Math.max(4, Math.floor((cw - 1.6) / 2.1) * Math.floor((cd - 1.6) / 2.2)));
  const tables: XY[] = [];
  const tcols = Math.max(1, Math.floor((cw - 0.6) / 2.1)), trows = Math.max(1, Math.ceil(nTables / tcols));
  for (let i = 0; i < nTables; i++) tables.push({ x: ccx - cw / 2 + 1.05 + (i % tcols) * 2.1, z: ccz - cd / 2 + 2.3 + Math.floor(i / tcols) * Math.min(2.2, (cd - 2.6) / Math.max(1, trows - 1) || 2.2) });
  const seatsCfg = asPts(cafeCfg.seats);
  const seats = seatsCfg ? seatsCfg.map((s, i) => ({ x: s.x, z: s.z, table: i >> 1, yaw: 0 })) :
    tables.flatMap((t, ti) => [{ x: t.x - 0.62, z: t.z, table: ti, yaw: Math.PI / 2 }, { x: t.x + 0.62, z: t.z, table: ti, yaw: -Math.PI / 2 }]);
  const cafe = { x: ccx, z: ccz, w: cw, d: cd, counter: { x: ccx, z: ccz - cd / 2 + 0.75 }, seats, tables };

  const sr = (x.stockroom ?? {}) as Record<string, unknown>;
  const stockroom = { x: num(sr.x, xMax + 3), z: num(sr.z, (z0 + z1) / 2), w: num(sr.w, 6), d: num(sr.d, Math.max(6, z1 - z0)), door: { x: xMax, z: (z0 + z1) / 2 } };
  const mealDeal = { x: Math.min(5.5, halfX - 3), z: frontZ + 3.8 };

  const zMin = frontZ;
  const bounds = { xMin, xMax, zMin, zMax, cx: cxs, cz: (zMin + zMax) / 2, w: halfX * 2, d: zMax - zMin };
  const plan: StorePlan = { bays, z0, z1, crossFront, crossBack, frontZ, entrances, exits, gates, lanes, checkoutZ, cafe, stockroom, mealDeal, bounds, unitPos };
  plans.set(cfg, plan);
  return plan;
}

export const zRange = (cfg: StoreConfig) => { const p = storePlan(cfg); return [p.z0, p.z1] as const; };
export const storeBounds = (cfg: StoreConfig) => storePlan(cfg).bounds;

export function unitFrame(cfg: StoreConfig, u: Unit) {
  const gx = gondolaX(cfg, u.aisle);
  const dir = u.side === 'L' ? -1 : 1; // facing direction along x
  const bp = storePlan(cfg).unitPos[u.id] ?? { bay: 0, nb: 1 };
  return { x: gx + dir * (G.depth / 2), z: G.z0 + (bp.bay + 0.5) * G.unitLen, rotY: dir * Math.PI / 2, dir, gx };
}
/** local (along-row x, out-of-shelf z) → world xz */
export function unitLocalToWorld(cfg: StoreConfig, u: Unit, lx: number, lz: number) {
  const f = unitFrame(cfg, u);
  const c = Math.cos(f.rotY), s = Math.sin(f.rotY);
  return { x: f.x + lx * c + lz * s, z: f.z - lx * s + lz * c };
}

export function rowY(cfg: StoreConfig, row: number) {
  // row 1 = top. Spread rows from 0.12m to ~1.5m shelf base (4+ rows go a little higher).
  const n = cfg.rows_per_unit;
  const lo = 0.12, hi = n >= 4 ? 1.6 : 1.45;
  return n === 1 ? 0.8 : hi - ((row - 1) * (hi - lo)) / (n - 1);
}
export const rowGap = (cfg: StoreConfig) => (cfg.rows_per_unit > 1 ? ((cfg.rows_per_unit >= 4 ? 1.6 : 1.45) - 0.12) / (cfg.rows_per_unit - 1) : 1);

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
  const fw = Math.min(0.62, usable / Math.max(total, 1));
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
const unitCache = new WeakMap<StoreConfig, Record<string, Unit>>();
export const unitsById = (cfg: StoreConfig) => { let m = unitCache.get(cfg); if (!m) { m = Object.fromEntries(cfg.units.map((u) => [u.id, u])); unitCache.set(cfg, m); } return m; };
/** world centre of the front facing of `code` in `slot` (falls back to slot centre) */
export function productWorld(cfg: StoreConfig, plan: Planogram, rawSlot: string, code: string | null) {
  const slot = shelfSlotFor(plan, rawSlot, code);
  const { unit, row } = parseSlot(slot);
  const u = unitsById(cfg)[unit];
  if (!u) return null;
  const pl = slotPlacements(slot, plan[slot]);
  const p = code ? pl.find((q) => q.code === code) : null;
  const w = unitLocalToWorld(cfg, u, p ? p.lx : 0, -0.2);
  const h = Math.min(categoryHeight(plan[slot]?.category ?? u.category), rowGap(cfg) - 0.1);
  return { x: w.x, y: rowY(cfg, row) + h / 2, z: w.z, slot, unit: u, h };
}
/** where a person stands to work on a slot (restockers, spills) */
export function slotStand(cfg: StoreConfig, slot: string, off = G.standOff) {
  const u = unitsById(cfg)[parseSlot(slot).unit];
  if (!u) return null;
  return unitLocalToWorld(cfg, u, 0, off);
}

// ---------------- shopper routing & timeline ----------------
export interface WP { x: number; z: number; walkway: number | null }
export type Phase = 'queue' | 'unload' | 'scan' | 'bag' | 'pay' | 'cafe' | 'exit';
export interface Seg { t0: number; t1: number; a: WP; b: WP; kind: 'move' | 'dwell' | 'phase'; event?: SimEvent; slot?: string; face?: number; phase?: Phase; lane?: string }
export interface CheckoutPlan { lane: Lane; tArrive: number; tUnload0: number; tScan: number[]; tBag: number; tPay: number; tDone: number; items: number }
export interface Timeline { segs: Seg[]; start: number; end: number; checkout?: CheckoutPlan; cafeSeat?: number }

const walkwayOf = (u: Unit) => (u.side === 'L' ? u.aisle - 1 : u.aisle); // walkway index 0..aisles

/** events from the ai-agent arm use slot "feed:<mission>"; place them at the product's shelf slot */
const slotIndex = new WeakMap<Planogram, Record<string, string>>();
export function shelfSlotFor(plan: Planogram, slot: string, code: string | null): string {
  if (plan[slot] || !code) return slot;
  let idx = slotIndex.get(plan);
  if (!idx) { idx = {}; for (const [k, s] of Object.entries(plan)) for (const c of s?.products ?? []) idx[c] ??= k; slotIndex.set(plan, idx); }
  return idx[code] ?? slot;
}

function standPoint(cfg: StoreConfig, plan: Planogram, rawSlot: string, code: string | null, jitter: number): WP | null {
  const slot = shelfSlotFor(plan, rawSlot, code);
  const u = unitsById(cfg)[parseSlot(slot).unit];
  if (!u) return null;
  const pl = slotPlacements(slot, plan[slot]);
  const p = code ? pl.find((q) => q.code === code) : null;
  const w = unitLocalToWorld(cfg, u, p ? p.lx : 0, G.standOff + jitter);
  return { ...w, walkway: walkwayOf(u) };
}

function route(sp: StorePlan, a: WP, b: WP, lane: number): WP[] {
  if (a.walkway !== null && a.walkway === b.walkway) return [b];
  const inside = (p: WP) => p.z > sp.z0 - 0.5 && p.z < sp.z1 + 0.5 && p.walkway !== null;
  if (!inside(a) && !inside(b)) return [b];
  // spread crowds across the cross-aisle so they don't all walk the same line
  const off = (lane - 0.5) * 1.1;
  const front = sp.crossFront + off, back = sp.crossBack - off;
  const cost = (zc: number) => Math.abs(a.z - zc) + Math.abs(b.z - zc);
  const zc = cost(front) <= cost(back) ? front : back;
  return [{ x: a.x, z: zc, walkway: null }, { x: b.x, z: zc, walkway: null }, b];
}

/** shopping part of a trip: in through a door, every logged event in order, then to the back cross-aisle */
export function buildTimeline(cfg: StoreConfig, plan: Planogram, agent: Agent, startAt: number, seedIdx: number, ai = false): Timeline {
  const sp = storePlan(cfg);
  const jitter = ((seedIdx * 37) % 7) / 7 * 0.5 - 0.25;
  const lane = ((seedIdx * 53) % 11) / 10;
  const speed = ai ? G.aiWalkSpeed : G.walkSpeed;
  const segs: Seg[] = [];
  let t = startAt;
  const door = sp.entrances[seedIdx % sp.entrances.length];
  let cur: WP = { x: door.x + jitter * 3, z: door.z - 4.2, walkway: null };
  const moveTo = (b: WP) => {
    for (const w of route(sp, cur, b, lane)) {
      const d = Math.hypot(w.x - cur.x, w.z - cur.z);
      if (d < 1e-3) { cur = w; continue; }
      const dt = d / speed;
      segs.push({ t0: t, t1: t + dt, a: cur, b: w, kind: 'move' });
      t += dt; cur = w;
    }
  };
  moveTo({ x: door.x + jitter * 2, z: door.z + 2.0, walkway: null });
  const evs = agent.events.length ? agent.events : agent.path.map((slot, i) => ({ step: i, slot, product: '', p_notice: 0, noticed: false, decision: 'not_noticed' as const }));
  const units = unitsById(cfg);
  for (const e of evs) {
    const st = standPoint(cfg, plan, e.slot, e.product || null, jitter);
    if (!st) continue;
    moveTo(st);
    const dwell = ai ? (e.decision === 'pick' ? DWELL.ai_pick : DWELL.ai_walk_past) : DWELL[e.decision] ?? DWELL.walk_past;
    const u = units[parseSlot(shelfSlotFor(plan, e.slot, e.product || null)).unit];
    const face = u ? Math.atan2(-unitFrame(cfg, u).dir, 0) : 0;
    segs.push({ t0: t, t1: t + dwell, a: cur, b: cur, kind: 'dwell', event: e, slot: e.slot, face });
    t += dwell;
  }
  if (cur.walkway !== null) moveTo({ x: cur.x, z: sp.crossBack - (lane - 0.5) * 1.1, walkway: null });
  return { segs, start: startAt, end: t };
}

/**
 * Checkout + exit for every shopper, scheduled together so lanes queue properly (first come, first served).
 * Routing: small baskets go to self-checkout, trolleys and bigger shops to a staffed till; within a kind the lane
 * that frees up first wins. assumption: a simple stand-in for the ops engine's routing (sim/ops.py) until its
 * per-shopper lane choice is in the run log. Visual only: no decision or stat depends on it.
 */
export function scheduleCheckouts(cfg: StoreConfig, tls: Record<string, Timeline>, items: Record<string, number>, carriers: Record<string, string>, aiIds: Set<string>, cafeIds: Set<string>) {
  const sp = storePlan(cfg);
  const free: Record<string, number> = Object.fromEntries(sp.lanes.map((l) => [l.id, 0]));
  const qlen: Record<string, number[]> = Object.fromEntries(sp.lanes.map((l) => [l.id, []]));
  const order = Object.keys(tls).sort((a, b) => tls[a].end - tls[b].end);
  const seatFree = sp.cafe.seats.map(() => 0);
  order.forEach((id, k) => {
    const tl = tls[id];
    let t = tl.end;
    const last = tl.segs[tl.segs.length - 1];
    let cur: WP = last ? { ...last.b } : { x: 0, z: sp.crossBack, walkway: null };
    const ai = aiIds.has(id);
    const speed = ai ? G.aiWalkSpeed : G.walkSpeed;
    const go = (b: WP, phase?: Phase, lane?: string) => {
      const d = Math.hypot(b.x - cur.x, b.z - cur.z);
      if (d < 1e-3) return;
      const dt = d / speed;
      tl.segs.push({ t0: t, t1: t + dt, a: cur, b, kind: 'move', phase, lane }); t += dt; cur = b;
    };
    const hold = (dur: number, phase: Phase, face: number, lane?: string) => { tl.segs.push({ t0: t, t1: t + dur, a: cur, b: cur, kind: 'phase', phase, face, lane }); t += dur; };
    const n = items[id] ?? 0;
    if (!ai && n > 0) {
      const wantSelf = carriers[id] !== 'trolley' && n <= TILL.selfMaxItems;
      const pool = sp.lanes.filter((l) => (wantSelf ? l.kind === 'self' : l.kind === 'staffed'));
      const lanes = pool.length ? pool : sp.lanes;
      // earliest-free lane, nearest x breaks ties
      let best = lanes[0], bestT = Infinity;
      for (const l of lanes) { const arrive = t + Math.hypot(l.stand.x - cur.x, l.stand.z - cur.z) / speed; const f = Math.max(arrive, free[l.id]) + Math.abs(l.x - cur.x) * 0.02; if (f < bestT) { bestT = f; best = l; } }
      const L = best;
      // walk to the queue end, wait, step up
      const q = qlen[L.id].filter((x) => x > t).length;
      const back = 1.0 * (1 + Math.min(q, 4));
      go({ x: L.stand.x + L.queueDir.x * back, z: L.stand.z + L.queueDir.z * back, walkway: null }, 'queue', L.id);
      const startService = Math.max(t, free[L.id]);
      const faceQ = L.kind === 'staffed' ? 0 : -Math.PI / 2;
      if (startService > t) hold(startService - t, 'queue', faceQ, L.id);
      go({ ...L.stand, walkway: null }, 'queue', L.id);
      const tArrive = t;
      const faceTill = L.kind === 'staffed' ? Math.PI / 2 : (L.stand.z > L.z ? Math.PI : 0);
      let tScan: number[] = [], tUnload0 = t;
      if (L.kind === 'staffed') {
        hold(n * TILL.unloadPer + 0.3, 'unload', faceTill, L.id);
        const s0 = tUnload0 + 0.9;
        tScan = Array.from({ length: n }, (_, i) => Math.max(s0 + i * TILL.scanPer, tUnload0 + (i + 1) * TILL.unloadPer + 0.7));
        // walk to the bagging end while the cashier scans
        const bagSpot = { x: L.stand.x, z: L.bag.z, walkway: null };
        const ends = tScan[n - 1];
        go(bagSpot, 'scan', L.id);
        if (ends > t) hold(ends - t, 'scan', faceTill, L.id);
      } else {
        tScan = Array.from({ length: n }, (_, i) => t + 0.35 + (i + 1) * TILL.selfScanPer);
        hold(n * TILL.selfScanPer + 0.5, 'scan', faceTill, L.id);
      }
      const tBag = t; hold(TILL.bag, 'bag', faceTill, L.id);
      const tPay = t; hold(TILL.pay, 'pay', faceTill, L.id);
      free[L.id] = t - (L.kind === 'staffed' ? TILL.bag + TILL.pay - 0.4 : 0);
      qlen[L.id].push(t);
      tl.checkout = { lane: L, tArrive, tUnload0, tScan, tBag, tPay, tDone: t, items: n };
    } else {
      // nothing to pay for (ai agents read a feed; empty-handed humans): straight past the tills
      const gapX = sp.lanes.length ? (Math.max(...sp.lanes.map((l) => l.x)) + 1.6) : 0;
      go({ x: gapX, z: sp.checkoutZ - 2.4, walkway: null });
      go({ x: gapX, z: sp.checkoutZ + 2.6, walkway: null });
    }
    // café: some shoppers sit down with a drink before leaving
    if (cafeIds.has(id) && sp.cafe.seats.length) {
      let si = 0; for (let i = 1; i < seatFree.length; i++) if (seatFree[i] < seatFree[si]) si = i;
      const seat = sp.cafe.seats[si];
      // walk out of the till area toward the front via the side aisle, then the counter, then the seat
      const sideX = sp.bounds.xMin + 1.4;
      go({ x: cur.x, z: sp.checkoutZ + 2.6, walkway: null });
      go({ x: sideX, z: sp.checkoutZ + 2.6, walkway: null });
      go({ x: sideX, z: sp.cafe.counter.z + 0.9, walkway: null });
      go({ x: sp.cafe.counter.x, z: sp.cafe.counter.z + 0.8, walkway: null });
      hold(1.2, 'cafe', Math.PI, 'counter');
      go({ x: seat.x, z: seat.z, walkway: null });
      const sit = 9 + ((k * 7) % 6);
      hold(sit, 'cafe', seat.yaw, `seat:${si}`);
      seatFree[si] = t;
      tl.cafeSeat = si;
      const door = sp.entrances[0];
      go({ x: door.x - 1, z: sp.frontZ + 1.2, walkway: null }, 'exit');
      go({ x: door.x - 1, z: sp.frontZ - 3.5, walkway: null }, 'exit');
    } else {
      const ex = sp.exits.reduce((b, e) => (Math.abs(e.x - cur.x) < Math.abs(b.x - cur.x) ? e : b), sp.exits[0]);
      go({ x: cur.x + (ex.x - cur.x) * 0.3, z: sp.checkoutZ + 2.6 + ((k % 3) - 1) * 0.4, walkway: null }, 'exit');
      go({ x: ex.x + ((k % 3) - 1) * 0.35, z: ex.z - 2.2, walkway: null }, 'exit');
      go({ x: ex.x + ((k % 3) - 1) * 0.35, z: ex.z + 3.5, walkway: null }, 'exit');
    }
    tl.end = t;
  });
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
  if (s.kind !== 'move') heading = s.face ?? 0;
  return { x, z, heading, seg: s, visible: true };
}

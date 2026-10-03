// Café + wet-floor shared state: the café spill list (Cafe.tsx spawns, the cleaner in Staff.tsx mops), the ops aisle
// spills (Staff.tsx Spills registers them) and `wetZones()` for anyone (CROWD) who wants to steer around wet floor.
// Rule zero: every number below carries its source. Café / spill numbers are LOW-confidence assumptions in the sim's
// own param files; the replay compresses them with OPS_RATE (1 replay s = 15 shop-floor s, ops.ts).
import { OPS_RATE } from '../../ops';

const P = (minutes: number) => minutes / OPS_RATE; // shop-floor minutes → replay seconds

/** data/ops/params.json spill_rate_per_1000_shoppers = 2 (assumption: no public per-shopper spill frequency) */
export const SPILL_P_BASE = 2 / 1000;
/** data/ops/params.json spill_prob_multiplier_on_collision = 5 (assumption: links spills to crowding) */
export const SPILL_BUMP_MULT = 5;
/** data/ops/params.json spill_clean_and_dry_min = 3 (assumption: mop + wet-floor sign) → replay s */
export const CLEAN_DRY_S = P(3);
/** data/ops/params.json cleaner_response_target_min = 5 (assumption, HSE INDG225 "promptly") → replay s.
 *  used only when no cleaner is on the roster: the spill clears itself after the target */
export const RESPONSE_TARGET_S = P(5);
/** data/sim/ops/params_extra.json cafe.dwell_min_mean = 20 (assumption) → replay s */
export const DWELL_S = P(20);
/** data/sim/ops/params_extra.json cafe.wait_for_seat_max_min = 3 (assumption) → replay s; then it's a takeaway */
export const WAIT_SEAT_S = P(3);
/** assumption (unsourced): ~25 s to order and ~10 s to pay at a café counter → replay s (visual pacing) */
export const ORDER_S = P(25 / 60), PAY_S = P(10 / 60);
/** presentation only: ?cafespill=N multiplies the spill chance so a demo shows one inside a minute (default 1 = params) */
export const SPILL_DEMO_MULT = (() => {
  try { const v = Number(new URLSearchParams(location.search).get('cafespill')); return Number.isFinite(v) && v > 0 ? v : 1; } catch { return 1; }
})();

export interface CafeSpill {
  id: number; x: number; z: number; t0: number;
  state: 'open' | 'cleaning' | 'done';
  /** cleaner walker id that's on it */
  claimed: string | null;
  tClean: number; tDone: number; bumped: boolean;
}

export const cafeSpills: CafeSpill[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
export function onSpills(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function spillsChanged() { listeners.forEach((f) => f()); }

export function addCafeSpill(x: number, z: number, t: number, bumped: boolean) {
  if (cafeSpills.filter((s) => s.state !== 'done').length >= 4) return null; // presentation cap
  const s: CafeSpill = { id: nextId++, x, z, t0: t, state: 'open', claimed: null, tClean: 0, tDone: 0, bumped };
  cafeSpills.push(s);
  spillsChanged();
  return s;
}
export function clearCafeSpills() { if (!cafeSpills.length) return; cafeSpills.length = 0; spillsChanged(); }
/** drop fully-faded spills */
export function pruneCafeSpills(t: number) {
  const n = cafeSpills.length;
  for (let i = cafeSpills.length - 1; i >= 0; i--) if (cafeSpills[i].state === 'done' && t - cafeSpills[i].tDone > 3) cafeSpills.splice(i, 1);
  if (cafeSpills.length !== n) spillsChanged();
}

/** ops aisle spills currently on the floor (Staff.tsx Spills keeps this in sync) */
export const opsWet: { id: string; x: number; z: number }[] = [];

export interface WetZone { x: number; z: number; r: number; kind: 'cafe' | 'aisle' }
/** wet floor right now: café spills (until mopped dry) + ops aisle spills. r = avoid radius in metres
 *  (presentation: puddle 0.75 m + the A-frame sign) */
export function wetZones(): WetZone[] {
  const out: WetZone[] = [];
  for (const s of cafeSpills) if (s.state !== 'done') out.push({ x: s.x, z: s.z, r: 1.1, kind: 'cafe' });
  for (const s of opsWet) out.push({ x: s.x, z: s.z, r: 1.2, kind: 'aisle' });
  return out;
}

// café bus: CROWD emits { type: 'cafe_enter', shopperId, t } when a replay shopper reaches the café
export type CafeEvent = { type: 'cafe_enter'; shopperId: string; t: number };
const cafeSubs = new Set<(e: CafeEvent) => void>();
export function onCafe(fn: (e: CafeEvent) => void) { cafeSubs.add(fn); return () => { cafeSubs.delete(fn); }; }
export function emitCafe(e: CafeEvent) { for (const f of cafeSubs) { try { f(e); } catch { /* never break the emitter */ } } }

if (typeof window !== 'undefined') (window as unknown as { __cafe?: unknown }).__cafe = { wetZones, emitCafe, cafeSpills, addCafeSpill };

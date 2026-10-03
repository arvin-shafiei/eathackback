// Fresh floor for the big stores (superstore, xl): fills the empty produce / bakery floor with wooden produce
// displays (crate tables, angled tables, a misting veg stand, pumpkin + melon bins, potato sacks) and bread tables,
// puts a small pharmacy on a free stretch of side wall near the front, and a back-of-house bakehouse annex outside
// the bakery wall. Pure layout: every solid shop-floor piece is returned as a rect so layout.storePlan adds it to
// the router obstacles (walkers go round it); the annex is outside the shell (staff only, no router change).
// Visual only: no product, planogram or sim number depends on any of this.
import type { Rect, StorePlan } from './layout';

export type FreshKind = 'crates' | 'angled' | 'mist' | 'bins' | 'sacks' | 'bread' | 'baskets';
export interface FreshFloor {
  /** freestanding displays, footprint w (x) × d (z) centred at x, z */
  fixtures: { kind: FreshKind; x: number; z: number; w: number; d: number; seed: number }[];
  /** pharmacy against a side wall: wall x, s = +1 (left wall, faces +x) / -1 (right wall), z span */
  pharmacy: { wallX: number; s: 1 | -1; z0: number; z1: number } | null;
  /** bakehouse annex outside a side wall: wall x, s = outward direction (-1 left, +1 right), z span, depth, doorway centre z */
  bakehouse: { wallX: number; s: 1 | -1; z0: number; z1: number; depth: number; doorZ: number | null } | null;
  rects: Rect[];
}

const MIN_STORE_W = 70; // assumption (visual): only stores at least this wide (xl, superstore)
const WALK = 2.4; // walkway kept round every new fixture (two trolleys)
const FW = 2.6, FD = 1.6; // display footprint
const PH_D = 3.3; // pharmacy depth from the wall: shelves + staff aisle + counter + queue rope
const ANNEX_D = 7; // bakehouse depth outside the wall
const PRODUCE: FreshKind[] = ['crates', 'angled', 'mist', 'bins', 'crates', 'sacks', 'angled'];

export function freshFloor(P: StorePlan): FreshFloor | null {
  const B = P.bounds;
  if (B.w < MIN_STORE_W) return null;
  const out: FreshFloor = { fixtures: [], pharmacy: null, bakehouse: null, rects: [] };
  const cafe: Rect | null = P.cafe.w > 0 ? { x0: P.cafe.x - P.cafe.w / 2, x1: P.cafe.x + P.cafe.w / 2, z0: P.cafe.z - P.cafe.d / 2, z1: P.cafe.z + P.cafe.d / 2 } : null;
  const extra: Rect[] = []; // reserved floor that is not an obstacle (doorway clearances)
  const hit = (r: Rect, pad = 0) => [...P.obstacles, ...out.rects, ...extra, ...(cafe ? [cafe] : [])].some((o) => o.x1 > r.x0 - pad && o.x0 < r.x1 + pad && o.z1 > r.z0 - pad && o.z0 < r.z1 + pad);
  const doors = [...P.entrances, ...P.exits, P.stockroom.door, P.goodsIn];
  const nearDoor = (r: Rect, pad: number) => doors.some((d) => d.x > r.x0 - pad && d.x < r.x1 + pad && d.z > r.z0 - pad && d.z < r.z1 + pad);

  // ---- 1. bakehouse annex behind the bakery wall run
  const bake = Object.values(P.units).filter((u) => u.fixture === 'bakery' && (u.wall === 'L' || u.wall === 'R'));
  const bakeSide = bake.length ? bake[0].wall : null;
  let bakeZ: [number, number] | null = null;
  if (bakeSide) {
    const us = bake.filter((u) => u.wall === bakeSide);
    const z0 = Math.min(...us.map((u) => u.z - u.len / 2)), z1 = Math.max(...us.map((u) => u.z + u.len / 2));
    bakeZ = [z0, z1];
    const s: 1 | -1 = bakeSide === 'L' ? -1 : 1, wallX = bakeSide === 'L' ? B.xMin : B.xMax;
    const st = P.stockroom, stR: Rect = { x0: st.x - st.w / 2, x1: st.x + st.w / 2, z0: st.z - st.d / 2, z1: st.z + st.d / 2 };
    let a0 = z0 - 2.6, a1 = z1;
    const ax0 = s < 0 ? wallX - ANNEX_D : wallX, ax1 = s < 0 ? wallX : wallX + ANNEX_D;
    if (stR.x1 > ax0 && stR.x0 < ax1 && stR.z1 > a0 - 1 && stR.z0 < a1) a0 = Math.max(a0, stR.z1 + 0.4); // clear of the stockroom
    a1 = Math.min(a1, B.zMax - 3); // behind the shopfront, never out into the car park
    if (a1 - a0 >= 6) {
      // doorway through to the shop floor at the end of the bakery run (needs free floor inside)
      const tryDoor = (z: number) => {
        const r: Rect = { x0: s < 0 ? wallX : wallX - 1.8, x1: s < 0 ? wallX + 1.8 : wallX, z0: z - 1.1, z1: z + 1.1 };
        return z - 1.1 >= a0 && z + 1.1 <= a1 + 2.6 && !hit(r, 0) && !nearDoor(r, 2) ? z : null;
      };
      const doorZ = tryDoor(z0 - 1.25) ?? tryDoor(z1 + 1.25);
      out.bakehouse = { wallX, s, z0: a0, z1: Math.max(a1, doorZ ?? a1), depth: ANNEX_D, doorZ };
      if (doorZ !== null) extra.push({ x0: s < 0 ? wallX : wallX - 2.6, x1: s < 0 ? wallX + 2.6 : wallX, z0: doorZ - 1.2, z1: doorZ + 1.2 });
    }
  }

  // ---- 2. pharmacy: the front-most free stretch of side wall (5.5 m+), clear of doors, café and fixtures
  let best: { side: 'L' | 'R'; z0: number; z1: number } | null = null;
  for (const side of ['L', 'R'] as const) {
    const wx = side === 'L' ? B.xMin : B.xMax, k = side === 'L' ? 1 : -1;
    const span = (d0: number, d1: number) => (k > 0 ? [wx + d0, wx + d1] : [wx - d1, wx - d0]);
    let start: number | null = null;
    const step = 0.25;
    for (let z = B.zMin + 1; z <= B.zMax - 5; z += step) {
      const [cx0, cx1] = span(0, PH_D), [wx0, wx1] = span(PH_D, PH_D + WALK);
      const core: Rect = { x0: cx0, x1: cx1, z0: z, z1: z + step }, walk: Rect = { x0: wx0, x1: wx1, z0: z, z1: z + step };
      const free = z + step <= B.zMax - 5 && !hit(core, 1.2) && !hit(walk, 0) && !nearDoor(core, 3);
      if (free && start === null) start = z;
      if ((!free || z + step > B.zMax - 5) && start !== null) {
        if (z - start >= 5.5 && (!best || z > best.z1)) best = { side, z0: start, z1: z };
        start = null;
      }
    }
  }
  if (best) {
    const L = Math.min(8, best.z1 - best.z0), z1 = best.z1, z0 = z1 - L;
    const s: 1 | -1 = best.side === 'L' ? 1 : -1, wallX = best.side === 'L' ? B.xMin : B.xMax;
    out.pharmacy = { wallX, s, z0, z1 };
    const x0 = s > 0 ? wallX : wallX - PH_D, x1 = s > 0 ? wallX + PH_D : wallX;
    out.rects.push({ x0, x1, z0, z1 });
  }

  // ---- 3. produce + bread displays on the free produce / bakery floor (greedy grid, walkways kept round each)
  const zones = [P.produce.rect, ...P.depts.filter((d) => d.id === 'bakery' && d.kind === 'wall').map((d) => d.rect)].filter((r): r is Rect => !!r);
  if (zones.length) {
    const R: Rect = { x0: Math.min(...zones.map((r) => r.x0)), x1: Math.max(...zones.map((r) => r.x1)), z0: Math.min(...zones.map((r) => r.z0)), z1: Math.max(...zones.map((r) => r.z1)) };
    const bands: [number, number][] = [];
    for (let i = 0; i + 1 < P.blocks.length; i++) bands.push([P.blocks[i].z1, P.blocks[i + 1].z0]); // cross aisles stay open
    bands.push([P.crossBack - 1.6, P.crossBack + 1.6], [P.crossFront - 1.6, P.crossFront + 1.6]);
    const bakeX = bakeSide === 'L' ? B.xMin : bakeSide === 'R' ? B.xMax : null;
    let n = 0, seed = 1;
    for (let z = R.z0 + 0.2; z + FD <= R.z1 - 0.2; z += 0.25) {
      for (let x = R.x0 + 0.2; x + FW <= R.x1 - 0.2; x += 0.25) {
        const r: Rect = { x0: x, x1: x + FW, z0: z, z1: z + FD };
        if (bands.some(([a, b]) => r.z1 > a && r.z0 < b)) continue;
        if (hit(r, WALK) || nearDoor(r, 3.5) || r.z1 > B.zMax - 4) continue;
        const cx = x + FW / 2, cz = z + FD / 2;
        const nearBake = bakeX !== null && bakeZ && Math.abs(cx - bakeX) < 5.6 && cz > bakeZ[0] - 3 && cz < bakeZ[1] + 1;
        const kind: FreshKind = nearBake ? (seed % 2 ? 'bread' : 'baskets') : PRODUCE[n++ % PRODUCE.length];
        out.fixtures.push({ kind, x: cx, z: cz, w: FW, d: FD, seed: seed++ });
        out.rects.push(r);
      }
    }
  }

  return out.fixtures.length || out.pharmacy || out.bakehouse ? out : null;
}

// Tech & seasonal decor floor for the big stores (superstore, xl). Pure layout: finds free floor in a finished
// StorePlan (the longest clear stretch of back wall, and the empty corner in front of it), then places a TV wall,
// glass phone / tablet / headphone / watch / console cases, laptop tables, promo standees, a seasonal row (pumpkins,
// flowers, a toy bay end), lobby displays between the doors and hanging bunting. Every solid piece is returned as a
// rect so layout.storePlan can add it to the router obstacles (walkers go round it). Visual only: no product,
// planogram or sim number depends on any of this.
import type { Rect, StorePlan } from './layout';

export type DeviceKind = 'phones' | 'tablets' | 'headphones' | 'watches' | 'consoles';
export type DecorKind = 'seasonal' | 'flowers' | 'toys';
export interface TechFloor {
  /** tinted floor of the tech corner (null: only the wall of TVs fits) */
  zone: Rect | null;
  /** TV wall on the back wall: centre x, inner wall face z, grid size, one TV's size, centre y of the bottom row */
  tvWall: { x: number; z: number; cols: number; rows: number; tvW: number; tvH: number; gap: number; y0: number } | null;
  cases: { x: number; z: number; w: number; d: number; kind: DeviceKind }[];
  laptops: { x: number; z: number; w: number; d: number }[];
  standees: { x: number; z: number; rot: number; face: number }[];
  decor: { kind: DecorKind; x: number; z: number; w: number; d: number }[];
  /** bunting lines hung across the cross aisles (no floor) */
  bunting: { ax: number; bx: number; z: number }[];
  /** hanging sign over the tech corner */
  sign: { x: number; z: number } | null;
  rects: Rect[];
}

const MIN_STORE_W = 70; // assumption (visual): only stores at least this wide (xl, superstore) get the tech floor
const CLEAR = 3.0; // walkway kept between the corner's fixtures and any other fixture
const GAP = 2.4; // walkway between rows / columns inside the corner (two trolleys)
const TV = { w: 1.6, h: 0.9, gap: 0.1, rows: 2, y0: 1.42 };
const DEVICES: DeviceKind[] = ['phones', 'tablets', 'headphones', 'watches', 'consoles'];
const DECOR: DecorKind[] = ['seasonal', 'flowers', 'toys'];

export function techFloor(P: StorePlan): TechFloor | null {
  const B = P.bounds;
  if (B.w < MIN_STORE_W) return null;
  const obs = P.obstacles;
  const cafe: Rect | null = P.cafe.w > 0 ? { x0: P.cafe.x - P.cafe.w / 2, x1: P.cafe.x + P.cafe.w / 2, z0: P.cafe.z - P.cafe.d / 2, z1: P.cafe.z + P.cafe.d / 2 } : null;
  const hit = (r: Rect, pad = 0) => [...obs, ...(cafe ? [cafe] : [])].some((o) => o.x1 > r.x0 - pad && o.x0 < r.x1 + pad && o.z1 > r.z0 - pad && o.z0 < r.z1 + pad);
  const doors = [P.stockroom.door, P.goodsIn];
  const nearDoor = (r: Rect, pad: number) => doors.some((d) => d.x > r.x0 - pad && d.x < r.x1 + pad && d.z > r.z0 - pad && d.z < r.z1 + pad);
  const out: TechFloor = { zone: null, tvWall: null, cases: [], laptops: [], standees: [], decor: [], bunting: [], sign: null, rects: [] };

  // ---- 1. longest clear stretch of back wall
  const step = 0.25;
  let best: [number, number] = [0, 0], start: number | null = null;
  for (let x = B.xMin; x <= B.xMax; x += step) {
    const cell: Rect = { x0: x, x1: x + step, z0: B.zMin, z1: B.zMin + 1.6 };
    const free = x + step <= B.xMax && !hit(cell) && !nearDoor(cell, 2.5);
    if (free && start === null) start = x;
    if ((!free || x + step > B.xMax) && start !== null) { if (x - start > best[1] - best[0]) best = [start, x]; start = null; }
  }
  const [a, b] = best;
  if (b - a < 8) return null;
  const pitch = TV.w + TV.gap;
  const cols = Math.min(10, Math.floor((b - a - 1.2) / pitch / 2) * 2);
  if (cols >= 4) {
    const cx = (a + b) / 2;
    out.tvWall = { x: cx, z: B.zMin + 0.12, cols, rows: TV.rows, tvW: TV.w, tvH: TV.h, gap: TV.gap, y0: TV.y0 };
    const half = (cols * pitch) / 2 + 0.1;
    out.rects.push({ x0: cx - half, x1: cx + half, z0: B.zMin, z1: B.zMin + 0.62 }); // low media console under the TVs
  }

  // ---- 2. the empty corner in front of it (only when it is deep enough to stay clear of the walkways)
  const toL = a - B.xMin < 3.2, toR = B.xMax - b < 3.2;
  const X0 = toL ? B.xMin + 2.8 : a + CLEAR, X1 = toR ? B.xMax - 2.8 : b - CLEAR;
  const Z0 = B.zMin + 3.6; // TV viewing walkway in front of the wall
  let Z1 = Z0;
  if (X1 - X0 >= 7) while (Z1 + 0.25 < B.zMin + B.d * 0.45 && !hit({ x0: X0, x1: X1, z0: Z0, z1: Z1 + 0.25 }, CLEAR)) Z1 += 0.25;
  if (X1 - X0 >= 7 && Z1 - Z0 >= 6.5) {
    out.zone = { x0: toL ? B.xMin + 0.2 : X0 - 1.2, x1: toR ? B.xMax - 0.2 : X1 + 1.2, z0: B.zMin + 0.7, z1: Z1 + 0.6 };
    out.sign = { x: (X0 + X1) / 2, z: Z0 + 1.6 };
    const FW = 2.4; // fixture width along x
    const nCols = Math.max(1, Math.floor((X1 - X0 + GAP) / (FW + GAP)));
    const span = nCols * FW + (nCols - 1) * GAP, left = (X0 + X1) / 2 - span / 2;
    const colX = Array.from({ length: nCols }, (_, i) => left + FW / 2 + i * (FW + GAP));
    const frontReserve = 1.8 + GAP + 0.5; // seasonal row + walkway + standees
    const deep = Z1 - Z0 >= 3 + frontReserve;
    let z = Z0, row = 0, nCase = 0;
    while (row < 3) {
      const kind = row % 2 === 0 ? 'case' : 'laptop', d = kind === 'case' ? 0.9 : 1.1;
      if (z + d > Z1 - (deep ? frontReserve : 0)) break;
      for (const x of colX) {
        if (kind === 'case') out.cases.push({ x, z: z + d / 2, w: FW, d, kind: DEVICES[nCase++ % DEVICES.length] });
        else out.laptops.push({ x, z: z + d / 2, w: FW, d });
        out.rects.push({ x0: x - FW / 2, x1: x + FW / 2, z0: z, z1: z + d });
      }
      z += d + GAP; row++;
    }
    if (deep && z + 1.8 <= Z1) {
      colX.forEach((x, i) => {
        const kind = DECOR[i % DECOR.length], w = kind === 'seasonal' ? 2.4 : 1.8, d = kind === 'toys' ? 1.0 : 1.6;
        out.decor.push({ kind, x, z: z + 0.9, w, d });
        out.rects.push({ x0: x - w / 2, x1: x + w / 2, z0: z + 0.9 - d / 2, z1: z + 0.9 + d / 2 });
      });
      z += 1.8 + GAP;
    }
    if (z + 0.4 <= Z1 + 0.4) colX.forEach((x, i) => {
      out.standees.push({ x, z: Math.min(z + 0.2, Z1), rot: 0, face: i });
      out.rects.push({ x0: x - 0.6, x1: x + 0.6, z0: Math.min(z, Z1 - 0.2), z1: Math.min(z + 0.4, Z1 + 0.2) });
    });
  }

  // ---- 3. lobby displays between the doors on the street side (clear of tills, café, gates and door paths)
  const doorXs = [...P.entrances.map((e) => e.x), ...P.exits.map((e) => e.x)].sort((p, q) => p - q);
  const lw = 2.6, ld = 1.4, lz = P.lobbyZ + 0.9;
  let lobby = 0;
  for (let i = 0; i + 1 < doorXs.length && lobby < 2; i++) {
    const p = doorXs[i], q = doorXs[i + 1];
    if (q - p < lw + 2 * 3.2) continue;
    const x = (p + q) / 2;
    const r: Rect = { x0: x - lw / 2, x1: x + lw / 2, z0: lz - ld / 2, z1: lz + ld / 2 };
    if (r.z1 > B.zMax - 1.8 || hit(r, 1.4) || P.gates.some((g) => Math.abs(g.x - x) < lw / 2 + 2.2)) continue;
    if (r.x0 < P.bank.x1 + 1 && r.x1 > P.bank.x0 - 1) continue; // never in the till lobby itself
    out.decor.push({ kind: 'seasonal', x, z: lz, w: lw, d: ld });
    out.rects.push(r);
    lobby++;
  }

  // ---- 4. bunting over the cross aisles (hung above the aisle signs, no floor)
  if (P.gondolas.length) {
    const gx0 = Math.min(...P.gondolas.map((g) => g.x)) - 0.6, gx1 = Math.max(...P.gondolas.map((g) => g.x)) + 0.6;
    const zs = [P.crossBack - 1.2];
    for (let i = 0; i + 1 < P.blocks.length; i++) zs.push((P.blocks[i].z1 + P.blocks[i + 1].z0) / 2);
    for (const z of zs) out.bunting.push({ ax: gx0, bx: gx1, z });
  }

  return out.tvWall || out.zone || out.decor.length ? out : null;
}

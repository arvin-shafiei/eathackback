// Easter egg: a cartoon "plane crash" in an empty field well away from the store (nobody hurt, minion-style).
// Rarely on its own (seeded, like the UFO), ?crash=now triggers it at once, window.__crash() from the console.
// Sequence: a small generic twin-prop plane appears in the hazy distance, coughs a puff of smoke, trails smoke and
// wobbles, glides down at a shallow angle and belly-lands in the grass (bounce + skid + dust). Three minions bail out
// on striped parachutes and land safely beside it. A small fire + smoke column starts; a red fire engine with flashing
// blue beacons drives out of the car park to the wreck, sprays a water arc, the fire goes out (steam), the smoke thins,
// the minions cheer, the engine drives off and the wreck fades away. ~85 s (superstore).
// The landing site is chosen once from the world's own scatter (trees, houses, town blocks, store + car park, road,
// station): skid strip, glide path (with height), parachute landings and the fire engine's grass leg are all checked
// clear, so it never touches a building or tower. Falls back to the open field beyond the house terraces.
// Perf: render nothing when idle (root hidden, frame loop returns at once). Active: ~11 draw calls (plane, engine,
// beacons, smoke/fire/water instanced, 3 minion meshes instanced, 2 ground decals); no lights, one useFrame.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Geo, cylGeo, mat, rng } from './geo';
import { CAR_FX, urlFlag, ease, clamp01 } from './eggs';
import { minionGeo, MINION_MAT } from '../minion';
import type { WorldPlan } from './World';

const noRay = () => null;
type Inst = { m: THREE.Matrix4 };
/** World.tsx's scatter (only what the site search needs) */
export interface CrashScatter { trees: Inst[]; lamps: Inst[]; houses: Inst[]; blocks: Inst[] }

// assumption: visual - every timing / speed / size constant in this file is look-and-feel only
const FIRST_MIN = 120, FIRST_RAND = 120;        // assumption: visual (first + repeat delay, s; UFO is 45-90)
const V = 22;                                    // assumption: visual (approach ground speed, m/s)
const T = { smoke: 1.5, td: 15, rest: 19.5, go: 21, bail: [8.2, 8.9, 9.6], land: [23, 24.2, 25.4] }; // assumption: visual
/** wreck distance from the store's right-hand outer edge, metres (assumption: visual, beside the wall) */
const BESIDE = 14;
const CRUISE = 46, SLOPE = 0.16;                 // assumption: visual (start altitude m, glide slope ~9 deg)
const L_APPROACH = V * T.td;                     // horizontal distance flown before touchdown
const SKID = (V * (T.rest - T.td)) / 2;          // decelerating skid length
const EV = 22;                                   // assumption: visual (fire engine speed at the road end, m/s)
const BELLY = 1.1;                               // fuselage centre height when sitting on its belly
const MSCALE = 1.5;                              // assumption: visual (minions a touch bigger so they read at range)
const N_S = 170, N_F = 18, N_W = 60, N_M = 3;

// ---------------------------------------------------------------- geometry
function planeGeometry() {
  // ~19 m generic twin-prop commuter, nose +x, origin on the fuselage axis. Pastel, no markings.
  const g = new Geo();
  g.add(cylGeo(14), '#f7f5f1', mat(0, 0, 0, 0, 1.2, 13, 1.2, 0, Math.PI / 2));
  g.add(new THREE.SphereGeometry(1.2, 14, 8), '#f7f5f1', mat(6.5, 0, 0, 0, 1.7, 1, 1));
  g.add(new THREE.ConeGeometry(1.2, 4.2, 14), '#f7f5f1', mat(-8.6, 0.25, 0, 0, 1, 1, 0.95, 0, Math.PI / 2 + 0.1));
  g.box(7.25, 0.5, 0, 0.9, 0.5, 1.5, '#2a3140');                       // windscreen
  for (const s of [-1, 1]) {
    g.box(0, 0.12, s * 1.17, 13, 0.22, 0.06, '#3fb8af');               // cheat line
    for (let i = 0; i < 8; i++) g.box(4.2 - i * 1.25, 0.5, s * 1.13, 0.42, 0.34, 0.08, '#33405a'); // cabin windows
    g.add(cylGeo(10), '#dfe3ea', mat(0.6, -0.15, s * 3.6, 0, 0.55, 2.8, 0.55, 0, Math.PI / 2)); // nacelle
    g.add(new THREE.ConeGeometry(0.32, 0.6, 10), '#ff8a3d', mat(2.25, -0.15, s * 3.6, 0, 1, 1, 1, 0, -Math.PI / 2)); // spinner
    g.box(2.05, -0.15, s * 3.6, 0.07, 2.6, 0.22, '#2d2a33');           // prop blade (vertical)
    g.box(2.05, -0.15, s * 3.6, 0.07, 0.22, 2.6, '#2d2a33');           // prop blade (horizontal)
  }
  g.box(0.4, -0.35, 0, 2.5, 0.28, 17, '#eceef3');                      // wing
  g.box(-9.2, 0.55, 0, 1.6, 0.18, 6.2, '#eceef3');                     // tailplane
  g.add(new THREE.BoxGeometry(1, 1, 1), '#ff8a3d', mat(-9.3, 2.1, 0, 0, 2.2, 3.0, 0.26, 0, 0.38)); // fin
  return g.build();
}

function engineGeometry() {
  // fire engine ~8 m, front +x, origin on the ground under the middle
  const g = new Geo();
  g.box(0, 0.72, 0, 8, 0.45, 2.3, '#2b2a30');                          // chassis
  g.box(-1.0, 1.8, 0, 5.6, 1.9, 2.5, '#e8322e');                       // body (lockers)
  g.box(2.75, 1.7, 0, 2.3, 1.95, 2.5, '#e8322e');                      // cab
  g.box(0, 1.3, 0, 8.04, 0.18, 2.54, '#fbf7f2');                       // white stripe
  g.box(3.92, 2.1, 0, 0.06, 0.8, 2.2, '#2a2f3a');                      // windscreen
  for (const s of [-1, 1]) g.box(2.9, 2.1, s * 1.255, 1.2, 0.7, 0.04, '#2a2f3a'); // side windows
  g.box(4.0, 0.75, 0, 0.18, 0.35, 2.5, '#c9ced6');                     // bumper
  for (const s of [-1, 1]) g.box(4.0, 1.15, s * 0.9, 0.06, 0.22, 0.4, '#fff3c0'); // headlights
  for (const s of [-1, 1]) g.box(-1.0, 3.0, s * 0.48, 5.8, 0.12, 0.1, '#d9dde3'); // ladder rails
  for (let x = -3.6; x <= 1.6; x += 0.65) g.box(x, 3.0, 0, 0.08, 0.08, 0.96, '#d9dde3'); // rungs
  g.cyl(-3.2, 2.9, 0, 0.22, 0.25, '#c9ced6', 8);                        // ladder turntable
  g.cyl(1.1, 2.95, 0, 0.2, 0.35, '#c9ced6', 8);                         // roof monitor
  g.box(1.5, 3.12, 0, 0.8, 0.14, 0.14, '#c9ced6');                     // monitor nozzle
  for (const x of [2.7, -1.6, -2.8]) for (const s of [-1, 1]) g.add(cylGeo(12), '#17151a', mat(x, 0.5, s * 1.15, 0, 0.5, 0.36, 0.5, Math.PI / 2, 0));
  return g.build();
}
const NOZZLE = new THREE.Vector3(1.95, 3.15, 0);

function chuteGeometry() {
  // striped canopy + 4 lines, in minion-local units (origin = feet), canopy ~2.6 above the feet
  const g = new Geo();
  const W = 8;
  for (let i = 0; i < W; i++) {
    g.add(new THREE.SphereGeometry(1.15, 3, 4, (i / W) * Math.PI * 2, (Math.PI * 2) / W, 0, Math.PI / 2), i % 2 ? '#fbf7f2' : '#ff6b5a', mat(0, 2.55, 0, 0, 1, 0.55, 1));
  }
  const top = new THREE.Vector3(), bot = new THREE.Vector3(), mid = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    top.set(Math.cos(a) * 1.1, 2.55, Math.sin(a) * 1.1);
    bot.set(Math.cos(a) * 0.22, 0.95, Math.sin(a) * 0.22);
    mid.addVectors(top, bot).multiplyScalar(0.5);
    const len = top.distanceTo(bot);
    q.setFromUnitVectors(up, top.clone().sub(bot).normalize());
    g.add(cylGeo(4), '#4a4650', new THREE.Matrix4().compose(mid, q, new THREE.Vector3(0.015, len, 0.015)));
  }
  return g.build();
}

// ---------------------------------------------------------------- site search
interface Site {
  td: THREE.Vector2; rest: THREE.Vector2; dir: THREE.Vector2;
  arrive: THREE.Vector2[]; leave: THREE.Vector2[]; land: THREE.Vector2[];
}

function findSite(W: WorldPlan, sc: CrashScatter): Site {
  const { B, xL, xR, zC, zF, lanes, zRoad, roadW } = W;
  type C = { x: number; z: number; r: number; top: number };
  type R = { x0: number; z0: number; x1: number; z1: number; top: number; veh: boolean };
  const circles: C[] = [];
  const dec = (it: Inst, f: (x: number, z: number, sx: number, sy: number, sz: number) => C) => {
    const e = it.m.elements;
    circles.push(f(e[12], e[14], Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])));
  };
  sc.blocks.forEach((b) => dec(b, (x, z, sx, sy, sz) => ({ x, z, r: Math.hypot(sx, sz) / 2, top: sy })));
  sc.houses.forEach((b) => dec(b, (x, z, sx, sy, sz) => ({ x, z, r: Math.hypot(sx, sz) / 2, top: sy + 2.4 })));
  // trees are left out on purpose: a cartoon belly-landing may skid past them, so the site can sit right beside the store
  sc.lamps.forEach((b) => dec(b, (x, z) => ({ x, z, r: 1.4, top: 7.2 })));
  const farEdge = zRoad + roadW / 2 + 3;
  const rects: R[] = [
    { x0: xL - 6, z0: B.zMin - 16, x1: xR + 6, z1: zC + 3, top: 18, veh: false },  // store + yard + car park
    { x0: xL - 6, z0: B.zMin - 16, x1: xR + 6, z1: zF + 0.5, top: 18, veh: true },  // store + yard (vehicles)
    { x0: -1e5, z0: zC - 0.5, x1: 1e5, z1: farEdge, top: 1.5, veh: false },         // verge, pavements, road
    { x0: xL - 36, z0: zF - 11, x1: xL + 1, z1: zC + 1, top: 12, veh: true },       // station + interchange
  ];
  // spatial hash for the circles
  const CELL = 16, PAD = 20, grid = new Map<number, C[]>();
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  for (const c of circles) {
    const i0 = Math.floor((c.x - c.r - PAD) / CELL), i1 = Math.floor((c.x + c.r + PAD) / CELL);
    const j0 = Math.floor((c.z - c.r - PAD) / CELL), j1 = Math.floor((c.z + c.r + PAD) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = key(i, j); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(c); }
  }
  const CLEAR = 3;
  const hit = (x: number, z: number, alt: number, margin: number, veh = false) => {
    const l = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (l) for (const c of l) { const dx = x - c.x, dz = z - c.z, rr = c.r + margin; if (dx * dx + dz * dz < rr * rr && alt < c.top + CLEAR) return true; }
    for (const r of rects) {
      if (veh ? !r.veh : r.veh) continue;
      if (x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin && alt < r.top + CLEAR) return true;
    }
    return false;
  };
  const segClear = (a: THREE.Vector2, b: THREE.Vector2, margin: number, veh: boolean) => {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 2));
    for (let i = 0; i <= n; i++) { const u = i / n; if (hit(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, 0, margin, veh)) return false; }
    return true;
  };
  const flightClear = (td: THREE.Vector2, d: THREE.Vector2) => {
    for (let s = 0; s <= SKID + 12; s += 3) if (hit(td.x + d.x * s, td.y + d.y * s, 0, 9)) return false;            // skid strip (wingspan + margin)
    for (let s = 0; s <= L_APPROACH; s += 4) if (hit(td.x - d.x * s, td.y - d.y * s, Math.min(CRUISE, s * SLOPE), 11)) return false; // glide path + chutes
    return true;
  };
  const V2 = (x: number, z: number) => new THREE.Vector2(x, z);
  const finish = (td: THREE.Vector2, d: THREE.Vector2, G: THREE.Vector2) => {
    const rest = td.clone().addScaledVector(d, SKID);
    const toG = G.clone().sub(rest).normalize();
    const E = rest.clone().addScaledVector(toG, 16);
    const away = toG.clone().negate(), perp = V2(-away.y, away.x);
    const land = [0, 1, 2].map((i) => rest.clone().addScaledVector(away, 13 + (i % 2) * 1.5).addScaledVector(perp, (i - 1) * 4.5));
    return { rest, E, land };
  };

  // 1) open grass to the right of the car park / store (in view of the overview camera)
  const G = V2(xR + 3, lanes[2]);
  const cands: { rest: THREE.Vector2; d: THREE.Vector2; score: number }[] = [];
  for (let x = xR + 12; x <= xR + 230; x += 4) for (let z = B.zMin - 150; z <= zC - 8; z += 6) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, d = V2(Math.cos(a), Math.sin(a));
    cands.push({ rest: V2(x, z), d, score: Math.hypot(x - (xR + 12), z - (W.zA + 10)) + 20 * Math.abs(d.y) });
  }
  cands.sort((a, b) => a.score - b.score);
  // the engine's drive over the grass: BFS on a 3 m grid from the car park edge, then string-pulled
  const GC = 3, gx0 = xR + 2, gz0 = B.zMin - 175, NX = Math.ceil(250 / GC), NZ = Math.ceil((zC - 2 - gz0) / GC);
  const cell = (x: number, z: number) => { const i = Math.floor((x - gx0) / GC), j = Math.floor((z - gz0) / GC); return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : j * NX + i; };
  const ctr = (k: number) => V2(gx0 + ((k % NX) + 0.5) * GC, gz0 + (Math.floor(k / NX) + 0.5) * GC);
  const par = new Int32Array(NX * NZ).fill(-2), q: number[] = [];
  const k0 = cell(G.x, G.y);
  if (k0 >= 0) { par[k0] = -1; q.push(k0); }
  for (let h = 0; h < q.length; h++) {
    const k = q[h], i = k % NX, j = (k / NX) | 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ni = i + di, nj = j + dj; if ((!di && !dj) || ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
      const nk = nj * NX + ni; if (par[nk] !== -2) continue;
      const c = ctr(nk);
      if (hit(c.x, c.y, 0, 2.6, true)) { par[nk] = -3; continue; }
      par[nk] = k; q.push(nk);
    }
  }
  // keep the engine's drive clear of the wreck itself (it parks 16 m off; nothing may cut within 12.5 m)
  const segFar = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2) => {
    const abx = b.x - a.x, aby = b.y - a.y, l2 = abx * abx + aby * aby || 1;
    const u = Math.max(0, Math.min(1, ((c.x - a.x) * abx + (c.y - a.y) * aby) / l2));
    return Math.hypot(a.x + abx * u - c.x, a.y + aby * u - c.y) > 12.5;
  };
  const drive = (E: THREE.Vector2, rest: THREE.Vector2) => {
    let k = cell(E.x, E.y); if (k < 0 || par[k] < -1) return null;
    const pts: THREE.Vector2[] = [E];
    while (k >= 0) { pts.push(ctr(k)); k = par[k]; }
    pts.push(G); pts.reverse();
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < pts.length - 1;) { let j = pts.length - 1; while (j > i + 1 && !(segClear(pts[i], pts[j], 3, true) && segFar(pts[i], pts[j], rest))) j--; out.push(pts[j]); i = j; }
    const chain = [G, ...out]; // every leg (incl. the last one into E) stays outside the wreck
    for (let i = 0; i < chain.length - 1; i++) if (!segFar(chain[i], chain[i + 1], rest)) return null;
    return out.slice(0, -1); // waypoints between G and E
  };
  // 0) right beside the store: belly-land along its right-hand side wall, sliding from the back towards the car park,
  //    stopping level with the middle of the store; the engine comes straight across from the car park
  if (BESIDE > 0) {
    const d = V2(0, 1);
    const rest = V2(xR + BESIDE, (B.zMin + zF) / 2);
    const td = rest.clone().addScaledVector(d, -SKID);
    const f = finish(td, d, G);
    const arrive = [V2(xR + 60, W.zFar), V2(xR - 4, W.zFar), V2(xR - 4, lanes[2]), G, f.E];
    const leave = [...arrive.slice(3)].reverse().concat([V2(xR - 4, zC - 0.5), V2(xR - 4, W.zNear), V2(xR + 60, W.zNear)]);
    return { td, rest: f.rest, dir: d, arrive, leave, land: f.land };
  }
  for (const c of cands) {
    const td = c.rest.clone().addScaledVector(c.d, -SKID);
    if (!flightClear(td, c.d)) continue;
    const rest = td.clone().addScaledVector(c.d, SKID);
    // stop 16 m off the wreck, on whichever side the engine can reach soonest
    let best: { E: THREE.Vector2; way: THREE.Vector2[] } | null = null;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, E = V2(rest.x + Math.cos(a) * 16, rest.y + Math.sin(a) * 16);
      const way = drive(E, rest);
      if (way && (!best || way.length < best.way.length)) best = { E, way };
    }
    if (!best) continue;
    const f = finish(td, c.d, best.E);
    if (f.land.some((p) => hit(p.x, p.y, 0, 3))) continue;
    const arrive = [V2(xR + 60, W.zFar), V2(xR - 4, W.zFar), V2(xR - 4, lanes[2]), G, ...best.way, best.E];
    const leave = [...arrive.slice(3)].reverse().concat([V2(xR - 4, zC - 0.5), V2(xR - 4, W.zNear), V2(xR + 60, W.zNear)]);
    return { td, rest, dir: c.d, arrive, leave, land: f.land };
  }
  // 2) fallback: the empty field beyond the house terraces (nothing is ever placed there)
  const d = V2(-1, 0);
  const rest = V2(Math.max(W.cx + 140, xR + 100), farEdge + 90);
  const td = rest.clone().addScaledVector(d, -SKID);
  let turnX = rest.x + 20;
  for (let x = rest.x; x < rest.x + 120; x += 3) {
    const g2 = V2(x, farEdge - 0.5), f = finish(td, d, g2);
    if (segClear(g2, f.E, 3, true)) { turnX = x; break; }
  }
  const G2 = V2(turnX, farEdge - 0.5), f = finish(td, d, G2);
  const arrive = [V2(turnX + 60, W.zFar), V2(turnX, W.zFar), G2, f.E];
  return { td, rest: f.rest, dir: d, arrive, leave: [...arrive].reverse(), land: f.land };
}

/** polyline helper: point + heading at distance s */
function path(pts: THREE.Vector2[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const len = cum[cum.length - 1];
  return {
    len,
    at(s: number, out: THREE.Vector3) {
      s = Math.max(0, Math.min(len, s));
      let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1], b = pts[i], u = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      out.set(a.x + (b.x - a.x) * u, 0, a.y + (b.y - a.y) * u);
      return Math.atan2(-(b.y - a.y), b.x - a.x); // yaw for a +x-facing model
    },
  };
}

const angLerp = (a: number, b: number, k: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; };

// ---------------------------------------------------------------- component
export function PlaneCrash({ W, sc }: { W: WorldPlan; sc: CrashScatter }) {
  const geo = useMemo(() => ({
    plane: planeGeometry(), engine: engineGeometry(), chute: chuteGeometry(),
    puff: new THREE.IcosahedronGeometry(1, 0),
    flame: new THREE.ConeGeometry(0.5, 1, 6).translate(0, 0.5, 0),
    drop: new THREE.SphereGeometry(0.3, 6, 4),
    beacon: new THREE.BoxGeometry(0.34, 0.22, 0.4),
    scorch: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
    skid: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0),
  }), []);
  const mats = useMemo(() => ({
    plane: new THREE.MeshLambertMaterial({ vertexColors: true }),
    engine: new THREE.MeshLambertMaterial({ vertexColors: true }),
    chute: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    puff: new THREE.MeshLambertMaterial({ flatShading: true }),
    flame: new THREE.MeshBasicMaterial(),
    drop: new THREE.MeshBasicMaterial({ color: '#a8dcff' }),
    beacon: new THREE.MeshBasicMaterial(),
    decal: new THREE.MeshBasicMaterial({ color: '#3a2f27', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    skid: new THREE.MeshBasicMaterial({ color: '#5a4a3a', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  }), []);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); Object.values(mats).forEach((m) => m.dispose()); }, [geo, mats]);
  const mg = minionGeo();
  const site = useRef<Site | null>(null);

  const root = useRef<THREE.Group>(null), plane = useRef<THREE.Mesh>(null), engine = useRef<THREE.Group>(null);
  const beacons = useRef<THREE.InstancedMesh>(null), smoke = useRef<THREE.InstancedMesh>(null), fire = useRef<THREE.InstancedMesh>(null);
  const water = useRef<THREE.InstancedMesh>(null), mHead = useRef<THREE.InstancedMesh>(null), mBody = useRef<THREE.InstancedMesh>(null);
  const chute = useRef<THREE.InstancedMesh>(null), scorch = useRef<THREE.Mesh>(null), skid = useRef<THREE.Mesh>(null);

  const S = useRef({
    r: rng(9113), clock: 0, next: 0, t: -1, fire: false,
    tl: { arrive: 0, spray: 0, out: 0, leave: 0, leaveEnd: 0, fade0: 0, fade1: 0, done: 0 },
    pIn: null as null | ReturnType<typeof path>, pOut: null as null | ReturnType<typeof path>,
    eYaw: 0, ring: 0, coughed: false, acc: { trail: 0, dust: 0, smoke: 0, steam: 0 },
    bail: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], bailed: [false, false, false],
  });
  // particle pool (CPU side)
  const P = useMemo(() => ({
    pos: new Float32Array(N_S * 3), vel: new Float32Array(N_S * 3), age: new Float32Array(N_S), life: new Float32Array(N_S), size: new Float32Array(N_S),
  }), []);
  const flameLocal = useMemo(() => {
    const r = rng(31), anchors = [[-0.6, 0.3, -3.6], [-0.6, 0.3, 3.6], [0.8, 1.0, 0], [-2.6, 1.0, 0], [-5, 0.8, 0]];
    return Array.from({ length: N_F }, (_, i) => {
      const a = anchors[i % anchors.length];
      return { p: new THREE.Vector3(a[0] + (r() - 0.5) * 2.2, a[1], a[2] + (r() - 0.5) * 1.4), w: 0.7 + r() * 0.7, h: 1.6 + r() * 1.8, k: 6 + r() * 6, ph: r() * 10 };
    });
  }, []);

  const tmp = useMemo(() => ({
    m: new THREE.Matrix4(), v: new THREE.Vector3(), v2: new THREE.Vector3(), c: new THREE.Color(), q: new THREE.Quaternion(), e: new THREE.Euler(), s: new THREE.Vector3(),
    zero: new THREE.Matrix4().makeScale(0, 0, 0), white: new THREE.Color('#ffffff'), soot: new THREE.Color('#77706b'),
    blue: new THREE.Color('#3d7bff'), dark: new THREE.Color('#0e1a3a'),
  }), []);

  const spawn = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, col: string | THREE.Color) => {
    const s = S.current, i = s.ring; s.ring = (s.ring + 1) % N_S;
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
    P.age[i] = 0; P.life[i] = life; P.size[i] = size;
    smoke.current!.setColorAt(i, typeof col === 'string' ? tmp.c.set(col) : col);
    if (smoke.current!.instanceColor) smoke.current!.instanceColor.needsUpdate = true;
  };

  const resetAll = () => {
    const { zero } = tmp;
    for (const ref of [smoke, fire, water, mHead, mBody, chute]) {
      const im = ref.current; if (!im) continue;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, zero);
      im.instanceMatrix.needsUpdate = true;
    }
    P.life.fill(0);
    mats.plane.transparent = false; mats.plane.opacity = 1; mats.plane.color.set('#ffffff'); mats.plane.needsUpdate = true;
    mats.decal.opacity = 0; mats.skid.opacity = 0;
  };

  useEffect(() => {
    const s = S.current;
    s.next = urlFlag('crash') === 'now' ? 1.5 : FIRST_MIN + s.r() * FIRST_RAND;
    const w = window as unknown as Record<string, unknown>;
    w.__crash = () => { s.fire = true; return 'mayday (cartoon, nobody gets hurt)'; };
    w.__crashState = s; // debug / screenshot framing (sim time, routes, timeline)
    // instance colours: one-off init
    const fi = fire.current, wa = water.current, mb = mBody.current, sm = smoke.current, be = beacons.current;
    const FL = ['#ff7a1a', '#ffb627', '#ff4d1a', '#ffd23f'];
    if (fi) { for (let i = 0; i < N_F; i++) fi.setColorAt(i, tmp.c.set(FL[i % FL.length])); if (fi.instanceColor) fi.instanceColor.needsUpdate = true; }
    if (mb) { for (let i = 0; i < N_M; i++) mb.setColorAt(i, tmp.c.set('#3c6fd6')); if (mb.instanceColor) mb.instanceColor.needsUpdate = true; }
    if (sm) { for (let i = 0; i < N_S; i++) sm.setColorAt(i, tmp.white); }
    if (be) { for (let i = 0; i < 2; i++) { be.setMatrixAt(i, mat(2.6, 2.75, (i ? 1 : -1) * 0.7)); be.setColorAt(i, tmp.dark); } be.instanceMatrix.needsUpdate = true; }
    if (wa) { for (let i = 0; i < N_W; i++) wa.setMatrixAt(i, tmp.zero); }
    resetAll();
    return () => { delete w.__crash; delete w.__crashState; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    const s = S.current;
    const st = (site.current ??= findSite(W, sc));
    s.pIn = path(st.arrive); s.pOut = path(st.leave);
    const tIn = (1.6 * s.pIn.len) / EV, tOut = (1.6 * s.pOut.len) / EV;
    const arrive = T.go + tIn, spray = arrive + 1.2, out = spray + 11, leave = out + 4;
    s.tl = { arrive, spray, out, leave, leaveEnd: leave + tOut, fade0: out + 9, fade1: out + 17, done: Math.max(leave + tOut, out + 17) + 0.5 };
    s.eYaw = 0; s.ring = 0; s.acc = { trail: 0, dust: 0, smoke: 0, steam: 0 };
    s.bailed = [false, false, false]; s.coughed = false;
    resetAll();
    const E = st.arrive[st.arrive.length - 1];
    CAR_FX.focus = { x: st.rest.x, z: st.rest.y, who: 'crash', tx: E.x, tz: E.y }; // tx/tz: where the fire engine parks
    s.t = 0;
  };

  useFrame((_, dtRaw) => {
    const s = S.current, dt = Math.min(dtRaw, 0.1);
    s.clock += dt;
    const g = root.current; if (!g) return;
    if (s.t < 0) {
      if (s.fire || s.clock > s.next) { s.fire = false; start(); }
      else { if (g.visible) g.visible = false; return; }
    }
    s.t += dt;
    g.visible = true;
    const t = s.t, st = site.current!, tl = s.tl, r = s.r;
    const pl = plane.current!, en = engine.current!, sm = smoke.current!, fi = fire.current!, wa = water.current!;
    const d = st.dir, yaw0 = Math.atan2(-d.y, d.x), px = -d.y, pz = d.x;
    const { m, v, v2, c, zero } = tmp;

    // ---- plane: glide, touchdown, skid, rest
    pl.rotation.order = 'YZX';
    let grounded = false;
    const sk = skid.current!;
    if (t < T.td) {
      const sBack = V * (T.td - t), alt = Math.min(CRUISE, sBack * SLOPE);
      const sick = t > T.smoke ? 1 : 0.3;
      const lat = Math.sin(t * 0.8) * 2.5 * (sBack / L_APPROACH);
      pl.position.set(st.td.x - d.x * sBack + px * lat, alt + BELLY, st.td.y - d.y * sBack + pz * lat);
      const flare = clamp01(1 - sBack / 25);
      pl.rotation.set(Math.sin(s.clock * 2.3) * 0.2 * sick + Math.sin(s.clock * 5.1) * 0.06 * sick, yaw0 + Math.sin(s.clock * 1.1) * 0.06 * sick, -0.06 + flare * 0.14);
    } else {
      grounded = true;
      const tau = Math.min(t - T.td, T.rest - T.td), u = tau / (T.rest - T.td);
      const dist = SKID * (1 - (1 - u) * (1 - u));
      const bounce = tau < 2.4 ? 1.3 * Math.abs(Math.sin((tau * Math.PI) / 0.8)) * Math.exp(-tau * 1.5) : 0;
      pl.position.set(st.td.x + d.x * dist, BELLY - 0.08 * u + bounce, st.td.y + d.y * dist);
      pl.rotation.set(Math.sin(tau * 9) * 0.12 * (1 - u) + 0.08 * u, yaw0 + 0.25 * ease(u), 0.08 * (1 - u) - 0.04 * u);
      // skid marks behind it
      sk.visible = true; sk.position.set(st.td.x, 0.02, st.td.y); sk.rotation.y = yaw0; sk.scale.set(Math.max(0.01, dist), 1, 2.2);
    }
    if (!grounded) sk.visible = false;
    if (t >= tl.fade0) pl.position.y -= ease((t - tl.fade0) / (tl.fade1 - tl.fade0)) * 0.8;
    pl.updateMatrixWorld();

    // ---- fire intensity + soot + fade
    const fireK = t < T.rest ? 0 : t < tl.spray + 1 ? ease((t - T.rest) / 3) : clamp01(1 - (t - tl.spray - 1) / (tl.out - tl.spray - 1));
    mats.plane.color.lerpColors(tmp.white, tmp.soot, clamp01((t - T.rest) / 8) * 0.7);
    const fade = clamp01((t - tl.fade0) / (tl.fade1 - tl.fade0));
    if (fade > 0 && !mats.plane.transparent) { mats.plane.transparent = true; mats.plane.needsUpdate = true; }
    mats.plane.opacity = 1 - fade;
    pl.visible = fade < 0.999;
    mats.decal.opacity = 0.45 * clamp01((t - T.rest) / 4) * (1 - fade);
    mats.skid.opacity = (grounded ? 0.28 : 0) * (1 - fade);
    const sc_ = scorch.current!; sc_.visible = t > T.rest; sc_.position.set(st.rest.x, 0.015, st.rest.y); sc_.scale.setScalar(9);

    // ---- flames: 2 on the sick engine in the air, a proper fire once it's down
    for (let i = 0; i < N_F; i++) {
      const f = flameLocal[i];
      let k = 0;
      if (t > T.smoke && t < T.rest && i < 2) k = 0.45;
      if (t >= T.rest) k = fireK;
      if (k <= 0.01) { fi.setMatrixAt(i, zero); continue; }
      const fl = 1 + 0.35 * Math.sin(s.clock * f.k + f.ph), fw = 1 + 0.2 * Math.sin(s.clock * f.k * 1.3 + f.ph * 2);
      v.copy(t < T.rest ? flameLocal[0].p : f.p).applyMatrix4(pl.matrixWorld);
      if (t < T.rest) v.x += (i - 0.5) * 0.4;
      m.makeScale(f.w * k * fw, f.h * k * fl, f.w * k * fw).setPosition(v.x, v.y - 0.2, v.z);
      fi.setMatrixAt(i, m);
    }
    fi.instanceMatrix.needsUpdate = true;

    // ---- smoke / dust / steam emitters
    if (t > T.smoke && !s.coughed) { // engine "cough": a dark burst
      v.set(-1.2, 0, -3.6).applyMatrix4(pl.matrixWorld);
      for (let i = 0; i < 7; i++) spawn(v.x, v.y, v.z, (r() - 0.5) * 3, (r() - 0.2) * 2, (r() - 0.5) * 3, 2.2, 1.4 + r() * 0.8, '#3a3640');
      s.coughed = true;
    }
    if (t > T.smoke && t < T.rest + 0.5) {
      s.acc.trail += dt * 24;
      v.set(-1.4, -0.1, -3.6).applyMatrix4(pl.matrixWorld);
      while (s.acc.trail >= 1) { s.acc.trail -= 1; spawn(v.x + (r() - 0.5) * 0.6, v.y, v.z + (r() - 0.5) * 0.6, (r() - 0.5) * 0.6, 0.5 + r() * 0.5, (r() - 0.5) * 0.6, 2.8, 0.7 + r() * 0.5, r() < 0.5 ? '#4a4650' : '#5d5862'); }
    }
    if (grounded && t < T.rest) {
      s.acc.dust += dt * 30;
      while (s.acc.dust >= 1) { s.acc.dust -= 1; spawn(pl.position.x + (r() - 0.5) * 4, 0.4, pl.position.z + (r() - 0.5) * 4, (r() - 0.5) * 4, 1 + r() * 1.5, (r() - 0.5) * 4, 1.6, 1.0 + r() * 0.7, r() < 0.5 ? '#cbb894' : '#b9a57f'); }
    }
    const after = t > tl.out ? clamp01(1 - (t - tl.out) / 12) : 0;
    const smokeRate = fireK * 10 + after * 5;
    if (smokeRate > 0) {
      s.acc.smoke += dt * smokeRate;
      while (s.acc.smoke >= 1) {
        s.acc.smoke -= 1;
        const f = flameLocal[(r() * N_F) | 0];
        v.copy(f.p).applyMatrix4(pl.matrixWorld);
        const light = fireK < 0.3;
        c.set(light ? '#b4b0b8' : '#7a7480').offsetHSL(0, 0, (r() - 0.5) * 0.08);
        spawn(v.x, v.y + 1.4, v.z, 0.9 + (r() - 0.5) * 0.6, 2.2 + r() * 1.2, 0.35 + (r() - 0.5) * 0.6, light ? 5 : 6, 0.7 + r() * 0.5, c);
      }
    }

    // ---- fire engine
    const enOn = t >= T.go && t < tl.leaveEnd;
    en.visible = enOn;
    if (enOn) {
      let yaw: number;
      if (t < tl.leave) {
        const u = clamp01((t - T.go) / (tl.arrive - T.go));
        yaw = s.pIn!.at(s.pIn!.len * (1 - Math.pow(1 - u, 1.6)), v);
      } else {
        const u = clamp01((t - tl.leave) / (tl.leaveEnd - tl.leave));
        yaw = s.pOut!.at(s.pOut!.len * Math.pow(u, 1.6), v);
      }
      if (t - T.go < 0.05) s.eYaw = yaw;
      s.eYaw = angLerp(s.eYaw, yaw, Math.min(1, dt * 4));
      en.position.copy(v);
      en.rotation.y = s.eYaw;
      const pop = Math.min(clamp01((t - T.go) / 0.5), clamp01((tl.leaveEnd - t) / 0.5));
      en.scale.setScalar(Math.max(0.001, pop));
      const be = beacons.current!, ph = Math.floor(s.clock * 6) % 2;
      be.setColorAt(0, ph ? tmp.blue : tmp.dark); be.setColorAt(1, ph ? tmp.dark : tmp.blue);
      if (be.instanceColor) be.instanceColor.needsUpdate = true;
      en.updateMatrixWorld();
    }

    // ---- water arc + steam
    const sprayOn = t >= tl.spray && t < tl.out + 1;
    wa.visible = sprayOn;
    if (sprayOn) {
      const uMax = clamp01((t - tl.spray) / 0.6), uMin = clamp01((t - tl.out - 0.4) / 0.6);
      v.copy(NOZZLE).applyMatrix4(en.matrixWorld);
      v2.set(st.rest.x, 1.6, st.rest.y);
      const H = 4 + v.distanceTo(v2) * 0.12;
      for (let i = 0; i < N_W; i++) {
        const u = (i / N_W + t * 0.9) % 1;
        if (u > uMax || u < uMin) { wa.setMatrixAt(i, zero); continue; }
        const j = Math.sin(i * 12.9898) * 0.25;
        const ds = 1 + 0.5 * Math.sin(i * 3.1 + t * 9);
        m.makeScale(ds, ds, ds).setPosition(v.x + (v2.x - v.x) * u + j, v.y + (v2.y - v.y) * u + 4 * H * u * (1 - u), v.z + (v2.z - v.z) * u - j);
        wa.setMatrixAt(i, m);
      }
      wa.instanceMatrix.needsUpdate = true;
      if (t > tl.spray + 0.8 && t < tl.out + 1.5) {
        s.acc.steam += dt * 8;
        while (s.acc.steam >= 1) { s.acc.steam -= 1; spawn(v2.x + (r() - 0.5) * 4, 1.2, v2.z + (r() - 0.5) * 4, (r() - 0.5) * 1.2, 2.5 + r() * 1.5, (r() - 0.5) * 1.2, 2.4, 0.9 + r() * 0.6, '#f4f6f8'); }
      }
    }

    // ---- particle integrate
    for (let i = 0; i < N_S; i++) {
      if (P.life[i] <= 0) continue;
      P.age[i] += dt;
      const a = P.age[i] / P.life[i];
      if (a >= 1) { P.life[i] = 0; sm.setMatrixAt(i, zero); continue; }
      const k = i * 3;
      P.vel[k + 1] *= 1 - dt * 0.15;
      P.pos[k] += P.vel[k] * dt; P.pos[k + 1] += P.vel[k + 1] * dt; P.pos[k + 2] += P.vel[k + 2] * dt;
      const sz = P.size[i] * (0.35 + 1.15 * Math.sqrt(a)) * (a > 0.75 ? (1 - a) / 0.25 : 1);
      m.makeScale(sz, sz, sz).setPosition(P.pos[k], P.pos[k + 1], P.pos[k + 2]);
      sm.setMatrixAt(i, m);
    }
    sm.instanceMatrix.needsUpdate = true;

    // ---- minions on parachutes
    const hh = mHead.current!, hb = mBody.current!, ch = chute.current!;
    for (let i = 0; i < N_M; i++) {
      const tb = T.bail[i], tland = T.land[i], L = st.land[i];
      if (t < tb) { hh.setMatrixAt(i, zero); hb.setMatrixAt(i, zero); ch.setMatrixAt(i, zero); continue; }
      if (!s.bailed[i]) { s.bailed[i] = true; s.bail[i].copy(pl.position).addScaledVector(v.set(px, 0, pz), (i - 1) * 1.2); s.bail[i].y -= 1.2; }
      const b = s.bail[i];
      let x: number, y: number, z: number, rx = 0, rz = 0, chuteK = 0, face = yaw0 + Math.PI / 2;
      let ms = MSCALE, hop = 0;
      if (t < tland) {
        const u = clamp01((t - tb) / (tland - tb));
        const fall = Math.min(1, (t - tb) / 0.6);             // little free-fall pop before the chute opens
        x = b.x + (L.x - b.x) * u; z = b.z + (L.y - b.z) * u;
        y = b.y * (1 - u) - (1 - fall) * fall * 1.5;
        chuteK = clamp01((t - tb - 0.5) / 0.45); chuteK = chuteK < 1 ? ease(chuteK) * 1.12 : 1;
        rx = Math.sin(s.clock * 1.7 + i) * 0.12; rz = Math.cos(s.clock * 1.3 + i * 2) * 0.12;
        face = Math.atan2(L.x - b.x, L.y - b.z);
      } else {
        x = L.x; z = L.y; y = 0;
        face = Math.atan2(st.rest.x - x, st.rest.y - z);
        const lt = t - tland;
        chuteK = lt < 1.2 ? 1 - lt / 1.2 : 0;                  // canopy collapses
        // cheer when the fire is out
        const ct = t - tl.out - i * 0.2;
        if (ct > 0 && ct < 3.2) hop = Math.abs(Math.sin(ct * Math.PI * 2.2)) * 0.6;
        if (lt < 0.4) hop = Math.max(hop, Math.sin((lt / 0.4) * Math.PI) * 0.3);
        // pop away with the wreck
        const gone = clamp01((t - tl.fade1 + 1.2 - i * 0.2) / 0.6);
        ms = MSCALE * (1 - ease(gone));
      }
      tmp.q.setFromEuler(tmp.e.set(rx, face, rz));
      m.compose(v.set(x, y + hop, z), tmp.q, tmp.s.setScalar(Math.max(0.001, ms)));
      hh.setMatrixAt(i, m); hb.setMatrixAt(i, m);
      if (chuteK > 0.01) {
        if (t < tland) m.compose(v.set(x, y, z), tmp.q, tmp.s.set(ms * chuteK, ms * chuteK, ms * chuteK));
        else { tmp.q.setFromEuler(tmp.e.set(0, face, (1 - chuteK) * 1.2)); m.compose(v.set(x - Math.sin(face) * 1.5 * (1 - chuteK), 0, z - Math.cos(face) * 1.5 * (1 - chuteK)), tmp.q, tmp.s.set(ms, ms * chuteK, ms)); }
        ch.setMatrixAt(i, m);
      } else ch.setMatrixAt(i, zero);
    }
    hh.instanceMatrix.needsUpdate = true; hb.instanceMatrix.needsUpdate = true; ch.instanceMatrix.needsUpdate = true;

    // ---- done
    if (t >= tl.done) {
      resetAll();
      s.t = -1; s.next = s.clock + FIRST_MIN + s.r() * FIRST_RAND;
      if (CAR_FX.focus?.who === 'crash') CAR_FX.focus = null;
      g.visible = false;
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={plane} geometry={geo.plane} material={mats.plane} raycast={noRay} />
      <group ref={engine} visible={false}>
        <mesh geometry={geo.engine} material={mats.engine} raycast={noRay} />
        <instancedMesh ref={beacons} args={[geo.beacon, mats.beacon, 2]} raycast={noRay} frustumCulled={false} />
      </group>
      <mesh ref={scorch} geometry={geo.scorch} material={mats.decal} raycast={noRay} visible={false} renderOrder={1} />
      <mesh ref={skid} geometry={geo.skid} material={mats.skid} raycast={noRay} visible={false} renderOrder={1} />
      <instancedMesh ref={smoke} args={[geo.puff, mats.puff, N_S]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={fire} args={[geo.flame, mats.flame, N_F]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={water} args={[geo.drop, mats.drop, N_W]} raycast={noRay} frustumCulled={false} visible={false} />
      <instancedMesh ref={mHead} args={[mg.head, MINION_MAT.head, N_M]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={mBody} args={[mg.overalls, MINION_MAT.tint, N_M]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={chute} args={[geo.chute, mats.chute, N_M]} raycast={noRay} frustumCulled={false} />
    </group>
  );
}

// Customer car park in front of the store: marked bays on dark asphalt (disabled + parent & child bays by the door),
// zebra crossings to the entrance(s), trolley shelters with stacked trolleys, bollards, a recycling point, lamps,
// parked cars (one InstancedMesh, varied colours) and a few cars slowly circling / driving in and out.
// Static parts are merged into one vertex-coloured mesh; cars + blob shadows are instanced (3 draw calls total).
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Geo, cylGeo, mat, rng } from './geo';
import type { WorldPlan } from './World';

const CAR_COLORS = ['#e8434b', '#2d6cdf', '#f4f2ee', '#1f1d24', '#9aa3ad', '#ffcf3f', '#3aa76d', '#ff7a3d', '#7b4fd6', '#c9c2b8', '#14406e', '#ff4f8b', '#5ec2d9', '#f4f2ee', '#2b2b30'];
const noRay = () => null;

/** one low-poly car (facing +z, 4.2 m), white body (instance colour tints it), dark glass + tyres */
function carGeometry() {
  const g = new Geo();
  g.box(0, 0.62, 0, 1.78, 0.56, 4.2, '#ffffff');               // body
  g.box(0, 0.62, 2.02, 1.7, 0.36, 0.2, '#ffffff');              // bumper bulk
  g.box(0, 1.12, -0.25, 1.56, 0.5, 2.2, '#ffffff');             // cabin
  g.box(0, 1.13, -0.25, 1.6, 0.36, 2.0, '#2a2f3a');             // side glass band
  g.box(0, 1.1, 0.88, 1.5, 0.36, 0.06, '#2a2f3a');              // windscreen
  g.box(0, 1.1, -1.37, 1.5, 0.32, 0.06, '#2a2f3a');             // rear screen
  g.box(0.6, 0.72, 2.11, 0.36, 0.14, 0.04, '#fff8d8');          // headlights
  g.box(-0.6, 0.72, 2.11, 0.36, 0.14, 0.04, '#fff8d8');
  g.box(0.62, 0.74, -2.11, 0.32, 0.12, 0.04, '#ff3b3b');        // tail lights
  g.box(-0.62, 0.74, -2.11, 0.32, 0.12, 0.04, '#ff3b3b');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cylGeo(10), '#1c1a1f', mat(sx * 0.82, 0.34, sz * 1.35, 0, 0.34, 0.26, 0.34, 0, Math.PI / 2));
  return g.build();
}

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const gr = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(20,16,20,0.55)'); gr.addColorStop(1, 'rgba(20,16,20,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
let BLOB: THREE.Texture | null = null;
export const blob = () => (BLOB ??= blobTexture());

/** bay icon decal (wheelchair / family), white on transparent */
function iconTex(emoji: string) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = '96px "Apple Color Emoji","Segoe UI Emoji",system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface Bay { x: number; z: number; face: 1 | -1; kind: 'std' | 'dis' | 'pc' }

export function buildCarPark(W: WorldPlan) {
  const { B, zA, rows, doorXs } = W;
  const r = rng(1234);
  const g = new Geo();
  const LINE = '#f7f3ee', Y = '#ffd23f';
  const bayW = 2.5;
  // bay columns across the store width, leaving a 3 m walkway lined up with every door
  const xs: number[] = [];
  for (let x = B.xMin + bayW / 2 + 1; x + bayW / 2 <= B.xMax - 1; x += bayW) {
    if (doorXs.some((d) => Math.abs(x - d) < bayW / 2 + 1.6)) continue;
    xs.push(x);
  }
  // trolley shelters replace two bays at ~1/4 and ~3/4 of the width in the middle rows
  const shelterAt = [0.22, 0.78].map((f) => B.xMin + B.w * f);
  const bays: Bay[] = [];
  const shelters: { x: number; z: number }[] = [];
  const ent = doorXs[0];
  const rowA = [...xs].sort((a, b) => Math.abs(a - ent) - Math.abs(b - ent));
  const dis = new Set(rowA.slice(0, 6)), pc = new Set(rowA.slice(6, 12));
  rows.forEach((row, ri) => {
    for (const x of xs) {
      const isShelter = (ri === 1 || ri === 2) && shelterAt.some((s) => Math.abs(x - s) < bayW * 0.75);
      if (isShelter) { if (shelterAt.some((s) => Math.abs(x - s) < bayW / 2)) shelters.push({ x, z: row.z }); continue; }
      bays.push({ x, z: row.z, face: row.face, kind: ri === 0 ? (dis.has(x) ? 'dis' : pc.has(x) ? 'pc' : 'std') : 'std' });
    }
  });
  // ---- markings
  const yM = 0.03;
  for (const b of bays) {
    const x0 = b.x - bayW / 2, x1 = b.x + bayW / 2, z0 = b.z - 2.5, z1 = b.z + 2.5;
    if (b.kind === 'dis') g.quad(x0 + 0.06, z0 + 0.06, x1 - 0.06, z1 - 0.06, yM - 0.006, '#3f72d9');
    if (b.kind === 'pc') g.quad(x0 + 0.06, z0 + 0.06, x1 - 0.06, z1 - 0.06, yM - 0.006, '#ff6f9f');
    const col = b.kind === 'std' ? LINE : b.kind === 'dis' ? '#ffffff' : '#ffffff';
    g.quad(x0 - 0.05, z0, x0 + 0.05, z1, yM, col); g.quad(x1 - 0.05, z0, x1 + 0.05, z1, yM, col);
    // closed end of the bay (the double-row spine)
    const ze = b.face > 0 ? z0 : z1;
    g.quad(x0, ze - 0.05, x1, ze + 0.05, yM, col);
  }
  // zebra crossings over the front drive lane and the middle aisle, at every door
  for (const d of doorXs) for (const [za, zb] of W.crossings) {
    for (let x = d - 1.5; x <= d + 1.3; x += 0.7) g.quad(x, za, x + 0.4, zb, yM, LINE);
    g.quad(d - 1.6, za - 0.25, d + 1.6, za - 0.15, yM, Y); g.quad(d - 1.6, zb + 0.15, d + 1.6, zb + 0.25, yM, Y);
  }
  // pedestrian walkways through the bay rows (pale green paint) to the crossings
  for (const d of doorXs) for (const row of rows) g.quad(d - 1.5, row.z - 2.5, d + 1.5, row.z + 2.5, yM - 0.008, '#8fb9a0');
  // drive-lane arrows / "SLOW" bars: dashed centre line on the drive lanes
  for (const lz of W.lanes) for (let x = W.xL + 2; x < W.xR - 2; x += 6) {
    if (doorXs.some((d) => Math.abs(x + 1.5 - d) < 3)) continue;
    g.quad(x, lz - 0.06, x + 3, lz + 0.06, yM, LINE);
  }
  // ---- trolley shelters: posts, roof, pink end panel + a row of nested trolleys
  for (const s of shelters) {
    const L = 4.6, Wd = 1.6;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.box(s.x + sx * Wd / 2, 1.1, s.z + sz * L / 2, 0.08, 2.2, 0.08, '#2a2328');
    g.box(s.x, 2.24, s.z, Wd + 0.3, 0.1, L + 0.3, '#f4f2ee');
    g.box(s.x, 2.12, s.z, Wd + 0.32, 0.14, L + 0.32, '#FF4079');
    g.box(s.x, 1.3, s.z - L / 2, Wd, 1.3, 0.05, '#FE831B');
    for (let i = 0; i < 9; i++) {
      const tz = s.z - L / 2 + 0.6 + i * 0.4;
      g.box(s.x, 0.62, tz, 0.56, 0.5, 0.82, '#c9ced6');
      g.box(s.x, 1.0, tz + 0.42, 0.52, 0.05, 0.05, '#FF4079');
      for (const wx of [-0.22, 0.22]) g.box(s.x + wx, 0.12, tz, 0.06, 0.16, 0.7, '#3a3540');
    }
  }
  // ---- bollards along the store apron (gaps at the doors) — instanced below, positions here
  const bollards: [number, number][] = [];
  for (let x = B.xMin + 0.5; x <= B.xMax - 0.5; x += 2.2) if (!doorXs.some((d) => Math.abs(x - d) < 2.4)) bollards.push([x, zA - 0.35]);
  // ---- recycling point: pad + four coloured banks on the right-hand side lane edge
  const rx = B.xMax + 3.2, rz = zA + 9;
  g.quad(rx - 2.2, rz - 1.4, rx + 2.2, rz + 7.4, 0.04, '#d8d0c8');
  ['#2f9e5f', '#2d6cdf', '#7b4fd6', '#6b6f7d'].forEach((c, i) => {
    const bz = rz + i * 1.6;
    g.box(rx, 0.8, bz, 1.5, 1.6, 1.3, c);
    g.box(rx, 1.64, bz, 1.56, 0.1, 1.36, '#2a2328');
    g.box(rx - 0.76, 1.2, bz, 0.04, 0.22, 0.6, '#141014');
  });
  // ---- parked cars (denser near the door)
  const parked: { x: number; z: number; yaw: number; color: THREE.Color }[] = [];
  for (const b of bays) {
    const near = 1 - Math.min(1, Math.abs(b.x - ent) / (B.w * 0.6));
    const p = b.kind === 'dis' ? 0.45 : 0.18 + near * 0.5;
    if (r() > p) continue;
    const yaw = (b.face > 0 ? Math.PI : 0) + (r() < 0.3 ? Math.PI : 0) + (r() - 0.5) * 0.08;
    parked.push({ x: b.x + (r() - 0.5) * 0.25, z: b.z + (r() - 0.5) * 0.3, yaw, color: new THREE.Color(CAR_COLORS[(r() * CAR_COLORS.length) | 0]) });
  }
  return { geo: g.build(), parked, bollards, bays };
}

/** a closed driving loop through rounded corners (a polyline with its corners eased) */
function loop(pts: [number, number][], round = 3.5) {
  const out: THREE.Vector3[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [px, pz] = pts[(i - 1 + n) % n], [cx, cz] = pts[i], [nx, nz] = pts[(i + 1) % n];
    const a = new THREE.Vector2(px - cx, pz - cz), b = new THREE.Vector2(nx - cx, nz - cz);
    const ra = Math.min(round, a.length() / 2.2), rb = Math.min(round, b.length() / 2.2);
    a.normalize(); b.normalize();
    out.push(new THREE.Vector3(cx + a.x * ra, 0, cz + a.y * ra));
    out.push(new THREE.Vector3(cx + (a.x + b.x) * 0.3 * Math.min(ra, rb), 0, cz + (a.y + b.y) * 0.3 * Math.min(ra, rb)));
    out.push(new THREE.Vector3(cx + b.x * rb, 0, cz + b.y * rb));
  }
  return new THREE.CatmullRomCurve3(out, true, 'centripetal');
}

export function CarPark({ W }: { W: WorldPlan }) {
  const built = useMemo(() => buildCarPark(W), [W]);
  const carGeo = useMemo(carGeometry, []);
  const lambert = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  const blobMat = useMemo(() => new THREE.MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false }), []);
  const disMat = useMemo(() => new THREE.MeshBasicMaterial({ map: iconTex('\u267F'), transparent: true, depthWrite: false }), []);
  const pcMat = useMemo(() => new THREE.MeshBasicMaterial({ map: iconTex('\u{1F46A}'), transparent: true, depthWrite: false }), []);
  // moving cars: two circling the car park, one in-and-out via the road, three on the main road
  const routes = useMemo(() => {
    const { xL, xR, lanes, zNear, zFar, cx } = W;
    const [l1, l2, l3] = lanes;
    const park = loop([[xR - 4, l1], [xL + 4, l1], [xL + 4, l3], [xR - 4, l3]]);
    const mid = loop([[xL + 4, l2], [xR - 4, l2], [xR - 4, l3], [xL + 4, l3]]);
    const inout = loop([[xL + 4, l2], [xR - 4, l2], [xR - 4, zNear], [xR + 80, zNear], [xR + 80, zFar], [xL - 80, zFar], [xL - 80, zNear], [xL + 4, zNear]], 4.5);
    const road = (z: number, dir: 1 | -1) => ({ z, dir, x0: cx - 260, x1: cx + 260 });
    return { loops: [park, mid, inout], loopSpeed: [5, 4.2, 7], loopOff: [0, 0.5, 0.2], roads: [road(zNear, 1), road(zFar, -1), road(zNear, 1), road(zFar, -1)], roadOff: [0, 0.1, 0.55, 0.7] };
  }, [W]);
  const nMove = routes.loops.length + routes.roads.length;
  const cars = useRef<THREE.InstancedMesh>(null), shadows = useRef<THREE.InstancedMesh>(null);
  const bolRef = useRef<THREE.InstancedMesh>(null), disRef = useRef<THREE.InstancedMesh>(null), pcRef = useRef<THREE.InstancedMesh>(null);
  const total = built.parked.length + nMove;
  const bollardGeo = useMemo(() => { const g = new Geo(); g.cyl(0, 0.45, 0, 0.11, 0.9, '#2a2328', 8); g.cyl(0, 0.78, 0, 0.115, 0.12, '#FE831B', 8); g.add(new THREE.SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#2a2328', mat(0, 0.9, 0)); return g.build(); }, []);
  const dis = built.bays.filter((b) => b.kind === 'dis'), pc = built.bays.filter((b) => b.kind === 'pc');

  useEffect(() => {
    const c = cars.current, s = shadows.current; if (!c || !s) return;
    const m = new THREE.Matrix4();
    built.parked.forEach((p, i) => {
      c.setMatrixAt(i, mat(p.x, 0, p.z, p.yaw)); c.setColorAt(i, p.color);
      s.setMatrixAt(i, mat(p.x, 0.035, p.z, p.yaw, 2.5, 1, 5));
    });
    const mc = ['#e8434b', '#2d6cdf', '#ffcf3f', '#f4f2ee', '#3aa76d', '#1f1d24', '#ff7a3d'];
    for (let k = 0; k < nMove; k++) c.setColorAt(built.parked.length + k, new THREE.Color(mc[k % mc.length]));
    c.instanceMatrix.needsUpdate = true; if (c.instanceColor) c.instanceColor.needsUpdate = true;
    s.instanceMatrix.needsUpdate = true;
    const b = bolRef.current;
    if (b) { built.bollards.forEach(([x, z], i) => b.setMatrixAt(i, m.makeTranslation(x, 0, z))); b.instanceMatrix.needsUpdate = true; }
    [[disRef.current, dis], [pcRef.current, pc]].forEach(([im, list]) => {
      const mesh = im as THREE.InstancedMesh | null; if (!mesh) return;
      (list as Bay[]).forEach((bay, i) => mesh.setMatrixAt(i, mat(bay.x, 0.04, bay.z, 0, 1.5, 1, 1.5)));
      mesh.instanceMatrix.needsUpdate = true;
    });
  }, [built, nMove, dis, pc]);

  const t = useRef(0);
  const tmpP = useMemo(() => new THREE.Vector3(), []), tmpT = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const c = cars.current, s = shadows.current; if (!c || !s) return;
    t.current += Math.min(dt, 0.1);
    let i = built.parked.length;
    routes.loops.forEach((curve, k) => {
      const len = curve.getLength();
      const u = (routes.loopOff[k] + (t.current * routes.loopSpeed[k]) / len) % 1;
      curve.getPointAt(u, tmpP); curve.getTangentAt(u, tmpT);
      const yaw = Math.atan2(tmpT.x, tmpT.z);
      c.setMatrixAt(i, mat(tmpP.x, 0, tmpP.z, yaw)); s.setMatrixAt(i, mat(tmpP.x, 0.035, tmpP.z, yaw, 2.5, 1, 5)); i++;
    });
    routes.roads.forEach((r, k) => {
      const span = r.x1 - r.x0;
      const u = (routes.roadOff[k] + (t.current * 11) / span) % 1;
      const x = r.dir > 0 ? r.x0 + u * span : r.x1 - u * span;
      const yaw = r.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      c.setMatrixAt(i, mat(x, 0, r.z, yaw)); s.setMatrixAt(i, mat(x, 0.035, r.z, yaw, 2.5, 1, 5)); i++;
    });
    c.instanceMatrix.needsUpdate = true; s.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <mesh geometry={built.geo} material={lambert} raycast={noRay} />
      <instancedMesh ref={shadows} args={[BOX_PLANE, blobMat, total]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={cars} args={[carGeo, lambert, total]} raycast={noRay} frustumCulled={false} />
      {built.bollards.length > 0 && <instancedMesh ref={bolRef} args={[bollardGeo, lambert, built.bollards.length]} raycast={noRay} frustumCulled={false} />}
      {dis.length > 0 && <instancedMesh ref={disRef} args={[BOX_PLANE, disMat, dis.length]} raycast={noRay} frustumCulled={false} />}
      {pc.length > 0 && <instancedMesh ref={pcRef} args={[BOX_PLANE, pcMat, pc.length]} raycast={noRay} frustumCulled={false} />}
    </group>
  );
}

const BOX_PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

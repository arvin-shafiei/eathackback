// The world outside the store: pastel late-afternoon sky dome, grass to the horizon, a service yard round the
// store, the shopfront canopy + a big "simsbury" roof sign, the car park (CarPark.tsx), a verge with a hedge,
// pavements, a two-lane road with markings, a bus stop, a pylon sign, street lamps, houses + town blocks and trees.
// Sized from storePlan(cfg).bounds so it fits every format. Perf: everything static is ONE merged vertex-coloured
// Lambert mesh; repeated things (trees, lamps, houses, blocks, cars, bollards) are InstancedMeshes; no shadows
// (blob decals instead). Roughly 15 draw calls for the whole outdoor world.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { StoreConfig } from '../../types';
import { storePlan, type StorePlan } from '../../layout';
import { stickerSign } from '../textures';
import { Geo, cylGeo, mat, rng } from './geo';
import { CarPark, blob } from './CarPark';
import { Sky } from './Sky';
import { Weather } from './Weather';
import { Transit, transitSpots } from './Transit';
import { Air } from './Air';
import { snowable } from './wxState';

const noRay = () => null;

export interface WorldPlan {
  B: StorePlan['bounds']; cx: number;
  /** front of the store / start of the car park asphalt */
  zF: number; zA: number; zC: number;
  xL: number; xR: number;
  rows: { z: number; face: 1 | -1 }[];
  lanes: number[]; crossings: [number, number][];
  zRoad: number; zNear: number; zFar: number; roadW: number;
  doorXs: number[];
  P: StorePlan;
}

const plans = new WeakMap<StorePlan, WorldPlan>();
export function worldPlan(P: StorePlan): WorldPlan {
  const hit = plans.get(P); if (hit) return hit;
  const B = P.bounds;
  const zF = B.zMax, zA = zF + 5;
  const xL = B.xMin - 8, xR = B.xMax + 8;
  // drive lane | row A | row B | aisle | row C | row D | perimeter lane
  const rows: WorldPlan['rows'] = [
    { z: zA + 6.5 + 2.5, face: -1 }, { z: zA + 11.5 + 2.5, face: 1 },
    { z: zA + 23 + 2.5, face: -1 }, { z: zA + 28 + 2.5, face: 1 },
  ];
  const lanes = [zA + 3.25, zA + 19.75, zA + 36.25];
  const crossings: [number, number][] = [[zA + 0.4, zA + 6.1], [zA + 16.9, zA + 22.6]];
  const zC = zA + 39.5;
  const roadW = 9, zRoad = zC + 6 + roadW / 2;
  const doorXs = [...P.entrances.map((e) => e.x), ...P.exits.map((e) => e.x)];
  const W: WorldPlan = { B, cx: B.cx, zF, zA, zC, xL, xR, rows, lanes, crossings, zRoad, zNear: zRoad - 2.2, zFar: zRoad + 2.2, roadW, doorXs, P };
  plans.set(P, W);
  return W;
}

function windowTex(cols: number, rows: number, door: boolean) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 256, 256);
  const cw = 256 / cols, rh = 256 / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    if (door && j === rows - 1 && i === Math.floor(cols / 2)) { ctx.fillStyle = '#6b4a45'; ctx.fillRect(i * cw + cw * 0.28, j * rh + rh * 0.2, cw * 0.44, rh * 0.8); continue; }
    ctx.fillStyle = '#5d6f86'; ctx.fillRect(i * cw + cw * 0.22, j * rh + rh * 0.22, cw * 0.56, rh * 0.5);
    ctx.fillStyle = 'rgba(255,240,220,0.55)'; ctx.fillRect(i * cw + cw * 0.22, j * rh + rh * 0.22, cw * 0.56, rh * 0.12);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** all static outdoor geometry, one merged mesh */
function buildStatic(W: WorldPlan) {
  const { B, P, zF, zA, zC, xL, xR, zRoad, roadW, doorXs } = W;
  const g = new Geo();
  const R = 640; // world radius
  // grass to the horizon (vertex colour) + service yard concrete around the store
  g.add(new THREE.CircleGeometry(R, 48).rotateX(-Math.PI / 2), '#bfd69a', mat(W.cx, -0.08, B.cz));
  g.quad(xL - 4, B.zMin - 14, xR + 4, zF, -0.04, '#d9d0c9');
  // front apron (pavement in front of the shopfront) + kerb
  g.quad(xL, zF, xR, zA, 0.02, '#e9e0d8');
  g.box(W.cx, 0.06, zA - 0.08, xR - xL, 0.12, 0.16, '#cfc5bd');
  // car park asphalt + white edge
  g.quad(xL, zA, xR, zC, 0.0, '#45414a');
  // planting islands with low hedges between the double rows' outer ends
  for (const z of [W.rows[0].z + 2.5, W.rows[2].z + 2.5]) for (const x of [xL + 1, xR - 9]) {
    g.box(x + 4, 0.08, z, 7.8, 0.16, 1.2, '#cfc5bd');
    g.box(x + 4, 0.45, z, 7.4, 0.6, 0.9, '#6fa860');
  }
  // verge with a hedge, then pavement, road, far pavement
  g.quad(xL - 300, zC, xR + 300, zC + 3, -0.02, '#a9cc86');
  const gap0 = xL, gap1 = xL + 8, gap2 = xR - 8, gap3 = xR;
  for (const [a, b] of [[xL - 300, gap0], [gap1, gap2], [gap3, xR + 300]] as [number, number][]) g.box((a + b) / 2, 0.55, zC + 1.5, b - a, 1.1, 1.1, '#5d9a52');
  g.quad(xL - 300, zC + 3, xR + 300, zC + 6, 0.03, '#ddd3cb');
  g.quad(xL - 300, zRoad - roadW / 2, xR + 300, zRoad + roadW / 2, 0.0, '#3d3a42');
  g.quad(xL - 300, zRoad + roadW / 2, xR + 300, zRoad + roadW / 2 + 3, 0.03, '#ddd3cb');
  for (const z of [zRoad - roadW / 2, zRoad + roadW / 2]) g.box(W.cx, 0.07, z, xR - xL + 600, 0.14, 0.18, '#bdb3ab');
  // access roads (in on the left, out on the right) across verge + pavement
  for (const [a, b] of [[gap0, gap1], [gap2, gap3]]) g.quad(a, zC - 0.01, b, zRoad - roadW / 2 + 0.01, 0.005, '#45414a');
  // road markings: dashed centre line, solid edge lines, give-way lines at the junctions
  for (let x = xL - 300; x < xR + 300; x += 7) g.quad(x, zRoad - 0.07, x + 3.5, zRoad + 0.07, 0.03, '#f7f3ee');
  for (const z of [zRoad - roadW / 2 + 0.35, zRoad + roadW / 2 - 0.35]) g.quad(xL - 300, z - 0.05, xR + 300, z + 0.05, 0.03, '#f7f3ee');
  for (const [a, b] of [[gap0, gap1], [gap2, gap3]]) for (let x = a + 0.3; x < b - 0.3; x += 0.9) g.quad(x, zRoad - roadW / 2 - 0.5, x + 0.5, zRoad - roadW / 2 - 0.25, 0.03, '#f7f3ee');
  // zebra across the main road in front of the store (to the bus stop / houses)
  const zx = W.cx + B.w * 0.25 - 8;
  for (let z = zRoad - roadW / 2 + 0.3; z < zRoad + roadW / 2 - 0.3; z += 0.9) g.quad(zx - 1.6, z, zx + 1.6, z + 0.5, 0.032, '#f7f3ee');
  for (const s of [-1, 1]) { g.cyl(zx + s * 2.1, 1.4, zRoad - s * (roadW / 2 + 0.6), 0.06, 2.8, '#2a2328', 6); g.add(new THREE.SphereGeometry(0.28, 10, 6), '#ffb43a', mat(zx + s * 2.1, 2.9, zRoad - s * (roadW / 2 + 0.6))); }
  // entrance mats outside every door
  for (const d of doorXs) g.quad(d - 1.7, zF + 0.15, d + 1.7, zF + 1.7, 0.03, '#3a3238');
  // shopfront canopy (sits under the door signs, over the apron) with a brand fascia and slim columns
  const cy = 2.66;
  g.box(W.cx, cy, zF + 1.35, B.w + 0.4, 0.1, 2.5, '#fbf4ee');
  g.box(W.cx, cy - 0.04, zF + 2.62, B.w + 0.44, 0.22, 0.08, '#FF4079');
  g.box(W.cx, cy + 0.1, zF + 2.62, B.w + 0.44, 0.08, 0.09, '#FE831B');
  for (let x = B.xMin + 1; x <= B.xMax - 1; x += 9) if (!doorXs.some((d) => Math.abs(x - d) < 2.6)) g.box(x, cy / 2, zF + 2.45, 0.14, cy, 0.14, '#2a2328');
  // goods-in yard at the back: a lorry backed up to the dock
  const gi = P.goodsIn;
  const out = Math.abs(gi.z - B.zMin) < 1 ? -1 : 0;
  if (out) {
    const lz = B.zMin - 7.6;
    g.box(gi.x, 1.0, B.zMin - 0.6, 3.6, 2.0, 1.2, '#b9b2ad');
    g.box(gi.x, 2.25, lz, 2.5, 2.7, 9.5, '#fbf7f2');
    g.box(gi.x, 2.25, lz, 2.52, 0.5, 9.52, '#FF4079');
    g.box(gi.x, 1.75, lz - 6.0, 2.4, 2.3, 2.2, '#2d6cdf');
    g.box(gi.x, 2.3, lz - 7.12, 2.1, 0.8, 0.06, '#2a2f3a');
    for (const z of [lz - 6.2, lz + 2.4, lz + 3.6]) for (const s of [-1, 1]) g.add(cylGeo(10), '#1c1a1f', mat(gi.x + s * 1.15, 0.45, z, 0, 0.45, 0.3, 0.45, 0, Math.PI / 2));
  }
  // (bus interchange + tube station live in Transit.tsx)
  // pylon sign posts at the car park entrance (the sign face is a textured plane)
  const px = xL - 2.6, pz = zC - 1.5;
  g.box(px, 4.2, pz, 0.5, 8.4, 0.5, '#2a2328');
  g.box(px, 5.6, pz, 4.2, 2.6, 0.3, '#141014');
  // roof sign legs on top of the canopy
  const sx = P.entrances[0]?.x ?? W.cx;
  const sw = signW(W);
  for (const s of [-0.35, 0.35]) g.box(sx + s * sw, cy + 0.6, zF + 2.35, 0.16, 1.2, 0.16, '#141014');
  return g.build();
}
const signW = (W: WorldPlan) => Math.min(16, Math.max(5.5, W.B.w * 0.14));

interface Inst { m: THREE.Matrix4; c?: THREE.Color }
function useInstances(ref: React.RefObject<THREE.InstancedMesh>, list: Inst[]) {
  useEffect(() => {
    const im = ref.current; if (!im) return;
    list.forEach((it, i) => { im.setMatrixAt(i, it.m); if (it.c) im.setColorAt(i, it.c); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }, [ref, list]);
}

function buildScatter(W: WorldPlan) {
  const { B, zF, zC, xL, xR, zRoad, roadW } = W;
  const r = rng(99);
  const trees: Inst[] = [], lamps: Inst[] = [], houses: Inst[] = [], roofs: Inst[] = [], blocks: Inst[] = [], blobs: Inst[] = [];
  const HOUSE = ['#f6d8c8', '#fbe7c6', '#d9e7f2', '#f2c6d2', '#e8dccb', '#cfe5d1', '#fff1e0', '#f0d0b8'];
  const ROOF = ['#8a4b4b', '#5b4a5c', '#a0603f', '#6b6f7d', '#7a5245'];
  const BLOCK = ['#f3e2d6', '#e7d3dc', '#d8dde8', '#efe4cf', '#dbe6d8', '#f6d2c2'];
  const TREE = ['#7fb069', '#6aa35a', '#8cbf6e', '#5e9550', '#9cc47a', '#c8a94e'];
  const zFar = zRoad + roadW / 2 + 3;
  // free of store, yard, car park, road
  const ko = transitSpots(W).keepOut;
  const blocked = (x: number, z: number, pad = 2) =>
    (x > ko[0] - pad && x < ko[2] + pad && z > ko[1] - pad && z < ko[3] + pad) ||
    (x > xL - 6 - pad && x < xR + 6 + pad && z > B.zMin - 16 - pad && z < zC + 3 + pad) ||
    (z > zC - pad && z < zFar + pad);
  const tree = (x: number, z: number, s: number) => {
    trees.push({ m: mat(x, 0, z, r() * 6, s, s * (0.9 + r() * 0.3), s), c: new THREE.Color(TREE[(r() * TREE.length) | 0]) });
    blobs.push({ m: mat(x, -0.05, z, 0, s * 3.4, 1, s * 3.4) });
  };
  // trees along the verge and the far pavement
  for (let x = xL - 120; x < xR + 120; x += 9 + r() * 3) {
    if (x > xL - 2 && x < xL + 10) continue; if (x > xR - 10 && x < xR + 2) continue;
    tree(x, zC + 1.5 + (r() - 0.5) * 0.4, 0.9 + r() * 0.4);
    if (r() < 0.7) tree(x + 3, zFar + 1.6, 0.8 + r() * 0.4);
  }
  // street lamps: both pavements + over the car park islands
  for (let x = xL - 110; x < xR + 110; x += 24) {
    lamps.push({ m: mat(x, 0, zC + 5.4, Math.PI) });
    lamps.push({ m: mat(x + 12, 0, zFar + 0.6, 0) });
  }
  for (const z of [W.rows[0].z + 2.5, W.rows[2].z + 2.5]) for (let x = B.xMin + 6; x < B.xMax - 3; x += 22) lamps.push({ m: mat(x, 0, z, (x | 0) % 2 ? 0 : Math.PI) });
  // houses facing the road: two terraces
  for (let row = 0; row < 3; row++) {
    const z = zFar + 10 + row * 16;
    for (let x = W.cx - 170; x < W.cx + 170; x += 9 + r() * 4) {
      if (r() < 0.12) { tree(x, z, 1 + r() * 0.5); continue; }
      const w = 6.5 + r() * 2, h = 4.5 + r() * 2.5, d = 7 + r() * 2;
      houses.push({ m: mat(x, h / 2, z, 0, w, h, d), c: new THREE.Color(HOUSE[(r() * HOUSE.length) | 0]) });
      roofs.push({ m: mat(x, h + 1.2, z, 0, w + 0.5, 2.4, d + 0.6), c: new THREE.Color(ROOF[(r() * ROOF.length) | 0]) });
      if (r() < 0.5) tree(x + w / 2 + 1.2, z - d / 2 - 3, 0.7 + r() * 0.4);
    }
  }
  // town blocks + trees around the sides and the back
  for (let k = 0; k < 160; k++) {
    const a = r() * Math.PI * 2, rad = Math.max(B.w, B.d) * 0.65 + 25 + r() * 160;
    const x = W.cx + Math.cos(a) * rad, z = B.cz + Math.sin(a) * rad;
    if (blocked(x, z, 6) || z > zFar - 2) continue;
    if (r() < 0.45) {
      const w = 12 + r() * 18, d = 12 + r() * 16, h = 8 + r() * (rad > 120 ? 26 : 12);
      blocks.push({ m: mat(x, h / 2, z, Math.round(r() * 4) * Math.PI / 2 + (r() - 0.5) * 0.2, w, h, d), c: new THREE.Color(BLOCK[(r() * BLOCK.length) | 0]) });
    } else for (let j = 0; j < 4; j++) { const tx = x + (r() - 0.5) * 14, tz = z + (r() - 0.5) * 14; if (!blocked(tx, tz)) tree(tx, tz, 0.9 + r() * 0.7); }
  }
  // a row of trees screening the service yard
  for (let x = xL - 8; x <= xR + 8; x += 7) tree(x + (r() - 0.5) * 2, B.zMin - 19 - r() * 2, 1 + r() * 0.4);
  for (let z = B.zMin - 14; z < zF; z += 7) { tree(xL - 9 - r() * 2, z, 1 + r() * 0.3); tree(xR + 9 + r() * 2, z, 1 + r() * 0.3); }
  return { trees, lamps, houses, roofs, blocks, blobs };
}

function treeGeo() {
  const g = new Geo();
  g.add(cylGeo(6), '#7a5a44', mat(0, 1.1, 0, 0, 0.18, 2.2, 0.18));
  g.add(new THREE.IcosahedronGeometry(1.7, 0), '#ffffff', mat(0, 3.4, 0, 0, 1, 1.15, 1));
  g.add(new THREE.IcosahedronGeometry(1.1, 0), '#f2f2f2', mat(0.6, 4.4, 0.3, 0.7, 1, 1.1, 1));
  return g.build();
}
function lampGeo() {
  const g = new Geo();
  g.add(cylGeo(6), '#3a3540', mat(0, 3.5, 0, 0, 0.08, 7, 0.08));
  g.box(0, 6.95, 0.7, 0.08, 0.08, 1.4, '#3a3540');
  g.box(0, 6.85, 1.35, 0.32, 0.12, 0.7, '#2a2328');
  g.box(0, 6.78, 1.35, 0.26, 0.04, 0.6, '#fff4c8');
  return g.build();
}
function roofGeo() {
  // gable prism, unit size, ridge along x
  const s = new THREE.Shape(); s.moveTo(-0.5, -0.5); s.lineTo(0.5, -0.5); s.lineTo(0, 0.5); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5); g.rotateY(Math.PI / 2);
  return g;
}

export function World({ cfg }: { cfg: StoreConfig }) {
  const P = storePlan(cfg);
  const W = useMemo(() => worldPlan(P), [P]);
  const stat = useMemo(() => buildStatic(W), [W]);
  const sc = useMemo(() => buildScatter(W), [W]);
  useEffect(() => () => stat.dispose(), [stat]);
  const lambert = useMemo(() => snowable(new THREE.MeshLambertMaterial({ vertexColors: true })), []);
  const geos = useMemo(() => ({ tree: treeGeo(), lamp: lampGeo(), roof: roofGeo(), box: new THREE.BoxGeometry(1, 1, 1), plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) }), []);
  const houseMat = useMemo(() => snowable(new THREE.MeshLambertMaterial({ map: windowTex(2, 2, true) })), []);
  const blockMat = useMemo(() => snowable(new THREE.MeshLambertMaterial({ map: windowTex(5, 7, false) })), []);
  const roofMat = useMemo(() => snowable(new THREE.MeshLambertMaterial({ color: '#ffffff' })), []);
  const blobMat = useMemo(() => new THREE.MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false, opacity: 0.7 }), []);
  const signTex = useMemo(() => stickerSign([{ text: 'simsbury', size: 190 }], { w: 1024, h: 300, brand: true }), []);
  const pylonTex = useMemo(() => stickerSign([{ text: 'simsbury', size: 120 }, { text: 'same shelf · two shoppers', size: 44, font: '700 44px Inter, system-ui' }], { w: 1024, h: 300, brand: true }), []);
  const refs = { trees: useRef<THREE.InstancedMesh>(null), lamps: useRef<THREE.InstancedMesh>(null), houses: useRef<THREE.InstancedMesh>(null), roofs: useRef<THREE.InstancedMesh>(null), blocks: useRef<THREE.InstancedMesh>(null), blobs: useRef<THREE.InstancedMesh>(null) };
  useInstances(refs.trees, sc.trees); useInstances(refs.lamps, sc.lamps); useInstances(refs.houses, sc.houses);
  useInstances(refs.roofs, sc.roofs); useInstances(refs.blocks, sc.blocks); useInstances(refs.blobs, sc.blobs);
  const sx = P.entrances[0]?.x ?? W.cx, sw = signW(W);
  return (
    <group>
      <Sky cx={W.cx} cz={P.bounds.cz} />
      <mesh geometry={stat} material={lambert} raycast={noRay} />
      <instancedMesh ref={refs.blobs} args={[geos.plane, blobMat, sc.blobs.length]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={refs.trees} args={[geos.tree, lambert, sc.trees.length]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={refs.lamps} args={[geos.lamp, lambert, sc.lamps.length]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={refs.houses} args={[geos.box, houseMat, sc.houses.length]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={refs.roofs} args={[geos.roof, roofMat, sc.roofs.length]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={refs.blocks} args={[geos.box, blockMat, sc.blocks.length]} raycast={noRay} frustumCulled={false} />
      {/* big sticker roof sign over the main entrance, leaned back so it reads from the overview without hiding the tills */}
      <mesh position={[sx, 2.66 + 1.0 + sw * 0.13, W.zF + 2.35]} rotation={[-0.55, 0, 0]} raycast={noRay}>
        <planeGeometry args={[sw, sw * 0.293]} />
        <meshBasicMaterial map={signTex} transparent alphaTest={0.05} side={THREE.DoubleSide} />
      </mesh>
      {/* pylon sign by the car park entrance, both faces */}
      {[-1, 1].map((k) => (
        <mesh key={k} position={[W.xL - 2.6, 5.6, W.zC - 1.5 + k * 0.16]} rotation={[0, k < 0 ? Math.PI : 0, 0]} raycast={noRay}>
          <planeGeometry args={[4.4, 1.29]} />
          <meshBasicMaterial map={pylonTex} transparent alphaTest={0.05} />
        </mesh>
      ))}
      <CarPark W={W} />
      <Transit W={W} />
      <Air W={W} />
      <Weather W={W} />
    </group>
  );
}

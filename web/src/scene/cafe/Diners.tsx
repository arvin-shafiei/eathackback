// All café diners in ~13 draw calls: one InstancedMesh per body part, posed every frame through a reusable dummy rig
// (root → arms → hand cup; root → table plate / pastry / cup). Hidden diners get a zero-scale matrix.
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { WHITE } from '../Staff';
import { minionGeo, MINION_MAT, MINION_SKIN_ARM, MINION_SHOULDER } from '../minion';
import type { MenuItem } from './menu';

export type XZ = { x: number; z: number };
export type Phase = 'off' | 'queue' | 'order' | 'pay' | 'wait' | 'toSeat' | 'sit' | 'leave';
export interface D {
  i: number; phase: Phase; x: number; z: number; yaw: number; path: XZ[]; tPhase: number;
  seat: number; drink: MenuItem; bite: MenuItem | null; color: string; order: number;
  bumped: boolean; walking: boolean; carrying: boolean; takeaway: boolean; tSit: number; slot: number;
}

const CUP = new THREE.CylinderGeometry(0.05, 0.04, 0.11, 10);
const PLATE = new THREE.CylinderGeometry(0.13, 0.11, 0.015, 14);
const PASTRY = new THREE.SphereGeometry(0.07, 10, 6).scale(1.4, 0.6, 1);
const LIT = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45 });
const TINT = LIT('#ffffff'); // instanceColor multiplies this
const CUP_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });

type Part = 'body' | 'ink' | 'overalls' | 'armR' | 'armL' | 'hCup' | 'hSleeve' | 'plate' | 'pastry' | 'tCup' | 'tSleeve';
const MG = minionGeo();
// minion diners: yellow body + goggles + eyes (one mesh), overalls in the diner's colour, yellow gloved arms
const DEFS: { k: Part; geo: THREE.BufferGeometry; mat: THREE.Material; tint?: 'body' | 'skin' | 'drink' | 'bite'; shadow?: boolean }[] = [
  { k: 'body', geo: MG.head, mat: MINION_MAT.head, shadow: true },
  { k: 'ink', geo: MG.hull, mat: MINION_MAT.hull },
  { k: 'overalls', geo: MG.overalls, mat: MINION_MAT.tint, tint: 'body' },
  { k: 'armR', geo: MG.arm, mat: MINION_MAT.tint, tint: 'skin' }, { k: 'armL', geo: MG.arm, mat: MINION_MAT.tint, tint: 'skin' },
  { k: 'hCup', geo: CUP, mat: CUP_MAT }, { k: 'hSleeve', geo: CUP, mat: TINT, tint: 'drink' },
  { k: 'plate', geo: PLATE, mat: WHITE }, { k: 'pastry', geo: PASTRY, mat: TINT, tint: 'bite' },
  { k: 'tCup', geo: CUP, mat: CUP_MAT }, { k: 'tSleeve', geo: CUP, mat: TINT, tint: 'drink' },
];

function rig() {
  const o = () => new THREE.Object3D();
  const root = o(), armR = o(), armL = o(), hand = o(), food = o();
  const n = { body: root, ink: o(), overalls: o(), armR, armL, hCup: o(), hSleeve: o(), plate: o(), pastry: o(), tCup: o(), tSleeve: o() } as Record<Part, THREE.Object3D>;
  root.add(n.ink, n.overalls, armR, armL, food);
  armR.position.set(MINION_SHOULDER.x, MINION_SHOULDER.y, MINION_SHOULDER.z); armL.position.set(-MINION_SHOULDER.x, MINION_SHOULDER.y, MINION_SHOULDER.z);
  armR.add(hand); hand.position.set(0, -0.32, 0.04); hand.add(n.hCup, n.hSleeve); n.hSleeve.scale.set(1.06, 0.45, 1.06);
  food.add(n.plate, n.pastry, n.tCup, n.tSleeve); n.pastry.position.set(0, 0.04, 0);
  n.tCup.position.set(0.16, 0.06, 0); n.tSleeve.position.set(0.16, 0.06, 0); n.tSleeve.scale.set(1.06, 0.45, 1.06);
  return { root, armR, armL, hand, food, n };
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const col = new THREE.Color();

export function Diners({ pool, seats, tables }: { pool: D[]; seats: (XZ & { yaw: number; table: number })[]; tables: XZ[] }) {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const R = useMemo(rig, []);
  const steps = useMemo(() => pool.map(() => Math.random() * 6), [pool]);
  const colorKey = useRef<string[]>([]);
  useFrame((s3, dt) => {
    const now = s3.clock.elapsedTime;
    const ms = meshes.current;
    if (ms.some((m) => !m)) return;
    for (const d of pool) {
      const i = d.i;
      // colours only when they change (drink / bite swap on respawn)
      const ck = d.color + d.drink?.color + (d.bite?.color ?? '');
      if (colorKey.current[i] !== ck) {
        colorKey.current[i] = ck;
        DEFS.forEach((df, j) => {
          if (!df.tint) return;
          col.set(df.tint === 'body' ? d.color : df.tint === 'skin' ? MINION_SKIN_ARM : df.tint === 'drink' ? (d.drink?.color ?? '#FE831B') : (d.bite?.color ?? '#e8a85c'));
          ms[j]!.setColorAt(i, col);
          if (ms[j]!.instanceColor) ms[j]!.instanceColor!.needsUpdate = true;
        });
      }
      if (d.phase === 'off') { for (const m of ms) m!.setMatrixAt(i, ZERO); continue; }
      const sit = d.phase === 'sit';
      steps[i] += dt * (d.walking ? 9 : 1);
      const step = steps[i];
      const chill = Math.sin(now * 0.6 + d.order * 1.7);
      const y = sit ? 0.16 + Math.max(0, Math.sin(now * 7 + d.order)) * (chill > 0.85 ? 0.03 : 0) : d.walking ? Math.abs(Math.sin(step)) * 0.05 : 0;
      const ordering = d.phase === 'order' || d.phase === 'pay';
      R.root.position.set(d.x, y + (ordering ? Math.max(0, Math.sin(now * 9)) * 0.04 : 0), d.z);
      const sway = d.phase === 'queue' && !d.walking ? Math.sin(now * 2 + d.order) * 0.06 : 0;
      R.root.rotation.set(sit ? 0.05 + Math.max(0, chill) * 0.08 : 0, d.yaw + (sit ? Math.sin(now * 0.4 + d.order) * 0.12 : 0), d.walking ? Math.sin(step) * 0.1 : sway);
      R.root.scale.set(1, sit ? 0.88 : 1, 1);
      const cyc = (now + d.order * 1.3) % 4.2;
      const lift = sit && cyc < 1.1 ? Math.sin((cyc / 1.1) * Math.PI) : 0; // sip
      R.armR.rotation.x = d.walking && !d.carrying ? Math.sin(step) * 0.6 : d.carrying && !sit ? -1.0 : sit ? -0.9 - lift * 1.5 : d.phase === 'pay' ? -1.6 : -0.1;
      R.armL.rotation.x = d.walking ? -Math.sin(step) * 0.6 : sit ? -0.7 : 0.05;
      const handOn = (d.carrying && !sit) || (sit && lift > 0.05);
      if (sit && d.seat >= 0) {
        const s = seats[d.seat], tb = tables[s.table] ?? s;
        const tx = (tb.x - s.x) * 0.55, tz = (tb.z - s.z) * 0.55, cy = Math.cos(d.yaw), sy = Math.sin(d.yaw);
        R.food.position.set(tx * cy - tz * sy, (0.775 - y) / 0.88, tx * sy + tz * cy);
      }
      R.root.updateMatrixWorld(true);
      DEFS.forEach((df, j) => {
        const k = df.k;
        const hidden = ((k === 'hCup' || k === 'hSleeve') && !handOn)
          || ((k === 'plate' || k === 'pastry' || k === 'tCup' || k === 'tSleeve') && !sit)
          || (k === 'tCup' || k === 'tSleeve' ? lift > 0.05 : false) // the cup is in the hand mid-sip
          || (k === 'pastry' && !d.bite);
        ms[j]!.setMatrixAt(i, hidden ? ZERO : R.n[k].matrixWorld);
      });
    }
    for (const m of ms) m!.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      {DEFS.map((df, j) => (
        <instancedMesh key={df.k} ref={(m) => { meshes.current[j] = m; }} args={[df.geo, df.mat, pool.length]} castShadow={!!df.shadow} frustumCulled={false} raycast={() => null} />
      ))}
    </>
  );
}

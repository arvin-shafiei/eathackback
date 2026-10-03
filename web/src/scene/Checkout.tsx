// Checkout theatre for the ops crowd: the checkout queues in the ops day log (minutes[].queues per lane) become
// people standing in line, and the head of each line is served item by item:
//   staffed till: unload onto the conveyor → belt carries packs to the scanner → cashier scans (beep + flash) →
//                 packs slide into the bagging well → card machine (tap, approved ✓) → walk out through the gates
//   self-checkout: one shared snake queue → kiosk → each pack basket → scanner (beep + glow) → bagging shelf → pay
// Replay shoppers (the run log) use the same lanes; while one is at a lane (crowdBus queue/unload/scan events) the
// ops customer steps back so they never stand inside each other.
// assumption: visual pacing only (items per basket, scan cadence). The ops engine owns queue lengths and waits; the
// HUD numbers come from the log via useOpsKpis, never from this animation.
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Product, StoreConfig } from '../types';
import { storePlan, type Lane } from '../layout';
import { productMaterials } from './textures';
import { bus, sfx } from './fx';
import { onCrowd } from './crowdBus';
import { BODY_GEO, EYE_GEO, INK_MAT, PUPIL_GEO, type OpsLive } from './Staff';
import { INK } from '../theme';

type XZ = { x: number; z: number };
interface Cust {
  t0: number; n: number; mats: number[]; color: number;
  from: XZ; scans: number[]; unload: number[]; tWalk: number; tPay0: number; tPayEnd: number; tLeaveEnd: number;
  approved: boolean; beeped: number; exitPath: XZ[];
}
interface LaneSim { lane: Lane; custs: Cust[]; next: number }

const BELT_V = 0.9; // m/s along the belt
const UNLOAD = 0.32, SCAN_GAP = 0.55, SELF_SCAN = 0.8, PAY = 1.4, LEAVE = 3.2;
const ITEM = new THREE.BoxGeometry(0.13, 0.17, 0.09);
const PALETTE = ['#f6a6b2', '#ffc98a', '#a7d8f0', '#b8e0a8', '#d7c2f2', '#f2d38a', '#9fd6cf', '#f0b6d8', '#c9cfdc', '#ffb199'].map((c) => new THREE.Color(c));
const MAX_PEOPLE = 220, MAX_ITEMS = 160;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };

let lastBeep = 0;
function beep(now: number) { if (now - lastBeep > 0.07) { lastBeep = now; sfx.beep(); } }

const lerp = (a: XZ, b: XZ, k: number): XZ => ({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k });
function along(path: XZ[], k: number): { p: XZ; yaw: number } {
  // constant-speed walk along a polyline, k in 0..1
  const lens = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.z - path[i].z));
  const tot = lens.reduce((a, b) => a + b, 0) || 1;
  let d = Math.min(1, Math.max(0, k)) * tot;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const kk = lens[i] ? Math.min(1, d / lens[i]) : 1;
      return { p: lerp(path[i], path[i + 1], kk), yaw: Math.atan2(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z) };
    }
    d -= lens[i];
  }
  return { p: path[path.length - 1], yaw: 0 };
}

interface Props { cfg: StoreConfig; live: MutableRefObject<OpsLive>; products: Record<string, Product> }

export function Checkout({ cfg, live, products }: Props) {
  const P = storePlan(cfg);
  const staffed = useMemo(() => P.lanes.filter((l) => l.kind === 'staffed'), [P]);
  const selfLanes = useMemo(() => P.lanes.filter((l) => l.kind === 'self'), [P]);
  const sims = useMemo<LaneSim[]>(() => P.lanes.map((lane) => ({ lane, custs: [], next: 0 })), [P]);
  // shared self-checkout queue head: the gap between the staffed bank and the kiosks, line grows toward the shop floor
  const selfHead = useMemo<XZ>(() => (selfLanes.length ? { x: Math.min(...selfLanes.map((l) => l.x)) - 1.0, z: P.checkoutZ } : { x: 0, z: P.checkoutZ }), [selfLanes, P]);

  // real products (with pack images) ride the belts
  const itemMats = useMemo(() => {
    const ps = Object.values(products);
    const withImg = ps.filter((p) => p.image);
    const pick = (withImg.length >= 4 ? withImg : ps).slice().sort((a, b) => hash(a.code) - hash(b.code)).slice(0, 10);
    return pick.map((p) => productMaterials(p));
  }, [products]);
  const itemMeshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const bodies = useRef<THREE.InstancedMesh>(null), hulls = useRef<THREE.InstancedMesh>(null);
  const eyes = useRef<THREE.InstancedMesh>(null), pupils = useRef<THREE.InstancedMesh>(null);
  const cards = useRef<Record<string, THREE.MeshBasicMaterial | null>>({});
  const beams = useRef<Record<string, THREE.Mesh | null>>({});

  // replay shoppers at a lane → the ops customer gives way
  const replayBusy = useRef<Record<string, number>>({});
  useEffect(() => onCrowd((e) => {
    if ((e.type === 'queue' || e.type === 'unload' || e.type === 'scan' || e.type === 'bag') && 'lane' in e) replayBusy.current[e.lane] = performance.now() / 1000 + 5;
    if (e.type === 'pay') replayBusy.current[e.lane] = performance.now() / 1000 + 2;
  }), []);

  const exitPath = (from: XZ, k: number): XZ[] => {
    const ex = P.exits.reduce((b, e) => (Math.abs(e.x - from.x) < Math.abs(b.x - from.x) ? e : b), P.exits[0] ?? { x: 0, z: P.bounds.zMax });
    const j = ((k % 3) - 1) * 0.35;
    return [from, { x: from.x, z: P.checkoutZ + 2.6 + j }, { x: ex.x + j, z: ex.z - 1.6 }, { x: ex.x + j, z: ex.z + 2.5 }];
  };

  function spawn(s: LaneSim, t: number, k: number) {
    const L = s.lane, self = L.kind === 'self';
    const n = self ? 2 + Math.floor(hash(`${L.id}${k}n`) * 5) : 4 + Math.floor(hash(`${L.id}${k}n`) * 9);
    const mats = Array.from({ length: n }, (_, i) => Math.floor(hash(`${L.id}${k}${i}`) * Math.max(1, itemMats.length)));
    const from = self ? selfHead : { x: L.stand.x + L.queueDir.x * 1.0, z: L.stand.z + L.queueDir.z * 1.0 };
    const tWalk = self ? 1.4 : 0.9;
    let scans: number[] = [], unload: number[] = [];
    if (self) scans = Array.from({ length: n }, (_, i) => tWalk + 0.5 + i * SELF_SCAN);
    else {
      const lb = Math.max(0.4, (L.beltEnd?.z ?? L.z) - (L.beltStart?.z ?? L.z - 1));
      unload = Array.from({ length: n }, (_, i) => tWalk + i * UNLOAD);
      let prev = -Infinity;
      scans = unload.map((u) => (prev = Math.max(u + lb / BELT_V + 0.2, prev + SCAN_GAP)));
    }
    const tPay0 = scans[n - 1] + 0.5;
    const tPayEnd = tPay0 + PAY;
    const payAt = self ? L.stand : { x: L.stand.x, z: L.bag.z - 0.35 };
    const c: Cust = { t0: t, n, mats, color: Math.floor(hash(`${L.id}${k}c`) * PALETTE.length), from, scans, unload, tWalk, tPay0, tPayEnd, tLeaveEnd: tPayEnd + LEAVE, approved: false, beeped: 0, exitPath: exitPath(payAt, k) };
    s.custs.push(c);
  }

  const spawnCount = useRef(0);
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();

  useFrame((st) => {
    const Lv = live.current, t = Lv.t, now = st.clock.elapsedTime, wall = performance.now() / 1000;
    const rec = Lv.rec;
    if (Lv.jump) for (const s of sims) { s.custs = []; s.next = t; }
    const busyFrac = Math.min(0.9, Math.max(0.2, (rec?.in_store ?? 0) / Math.max(1, P.lanes.length * 3)));
    const minute = rec?.t ?? 0;
    const q = rec?.queues ?? {};
    let selfWaiting = 0;
    for (const L of selfLanes) selfWaiting += Math.max(0, (q[L.id] ?? 0) - 1);

    let np = 0, ni = 0;
    const counts = itemMats.map(() => 0);
    const person = (p: XZ, yaw: number, ci: number, sit = 1) => {
      if (np >= MAX_PEOPLE || !bodies.current) return;
      tmpQ.setFromAxisAngle(UP, yaw);
      tmpS.set(0.92, 0.92 * sit, 0.92);
      tmpM.compose(tmpP.set(p.x, 0, p.z), tmpQ, tmpS);
      bodies.current.setMatrixAt(np, tmpM); hulls.current?.setMatrixAt(np, tmpM);
      bodies.current.setColorAt(np, PALETTE[ci % PALETTE.length]);
      for (let e = 0; e < 2; e++) {
        const ex = (e ? 1 : -1) * 0.11 * 0.92;
        const off = new THREE.Vector3(ex, 0.93 * 0.92 * sit, 0.22 * 0.92).applyQuaternion(tmpQ);
        tmpM.compose(tmpP.set(p.x + off.x, off.y, p.z + off.z), tmpQ, tmpS.set(0.92, 0.92, 0.92));
        eyes.current?.setMatrixAt(np * 2 + e, tmpM);
        const off2 = new THREE.Vector3(ex, 0.93 * 0.92 * sit - 0.01, 0.22 * 0.92 + 0.065).applyQuaternion(tmpQ);
        tmpM.compose(tmpP.set(p.x + off2.x, off2.y, p.z + off2.z), tmpQ, tmpS);
        pupils.current?.setMatrixAt(np * 2 + e, tmpM);
      }
      np++;
    };
    const item = (mi: number, x: number, y: number, z: number, yaw = 0, tilt = 0) => {
      const m = itemMeshes.current[mi]; if (!m || counts[mi] >= MAX_ITEMS || ni > MAX_ITEMS * 4) return;
      tmpQ.setFromEuler(tmpE.set(tilt, yaw, 0));
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(1, 1, 1));
      m.setMatrixAt(counts[mi]++, tmpM); ni++;
    };

    for (const s of sims) {
      const L = s.lane, self = L.kind === 'self';
      const dem = q[L.id] ?? 0;
      const busy = (replayBusy.current[L.id] ?? 0) > wall;
      // retire finished customers, spawn the next one when the till is free
      s.custs = s.custs.filter((c) => t - c.t0 < c.tLeaveEnd);
      const active = s.custs.find((c) => t - c.t0 < c.tPayEnd);
      if (!active && !busy && rec && t >= s.next && Lv.dtR > 0) {
        const k = spawnCount.current++;
        const want = dem >= 1 || hash(`${L.id}@${minute}`) < busyFrac;
        if (want) spawn(s, t, k);
        else s.next = t + 1.5;
      }
      // waiting line (staffed lanes: own line; self: drawn once below)
      if (!self) {
        const waiting = Math.min(6, Math.max(0, dem - (s.custs.some((c) => t - c.t0 < c.tPayEnd) ? 1 : 0)));
        const shift = busy ? 1 : 0;
        const yaw = Math.atan2(-L.queueDir.x, -L.queueDir.z);
        for (let w = 0; w < waiting; w++) {
          const d = 1.0 * (w + 1 + shift) + (hash(`${L.id}w${w}`) - 0.5) * 0.15;
          person({ x: L.stand.x + L.queueDir.x * d + (hash(`${L.id}x${w}`) - 0.5) * 0.18, z: L.stand.z + L.queueDir.z * d }, yaw + Math.sin(now * 0.7 + w) * 0.15, Math.floor(hash(`${L.id}c${w}`) * 10));
        }
      }
      // card machine screen state
      const cm = cards.current[L.id];
      let screen = 'idle';
      for (const c of s.custs) {
        const tau = t - c.t0;
        // ----- the customer
        let pos: XZ, yaw: number;
        const tillYaw = self ? (L.stand.z > L.z ? Math.PI : 0) : Math.PI / 2;
        const bagSpot = self ? L.stand : { x: L.stand.x, z: L.bag.z - 0.35 };
        if (tau < c.tWalk) {
          const path = self ? [c.from, { x: L.stand.x, z: c.from.z }, L.stand] : [c.from, L.stand];
          const a = along(path, tau / c.tWalk); pos = a.p; yaw = a.yaw;
        } else if (!self && tau < c.unload[c.n - 1] + UNLOAD) { pos = L.stand; yaw = tillYaw; }
        else if (!self && tau < c.unload[c.n - 1] + UNLOAD + 0.8) { pos = lerp(L.stand, bagSpot, (tau - c.unload[c.n - 1] - UNLOAD) / 0.8); yaw = 0; }
        else if (tau < c.tPayEnd) { pos = bagSpot; yaw = tillYaw; }
        else { const a = along(c.exitPath, (tau - c.tPayEnd) / LEAVE); pos = a.p; yaw = a.yaw; }
        if (tau < c.tLeaveEnd - 0.25) person(pos, yaw + (tau >= c.tWalk && tau < c.tPayEnd ? Math.sin(now * 3 + c.color) * 0.06 : 0), c.color);

        // ----- the packs
        for (let i = 0; i < c.n; i++) {
          const mi = c.mats[i], tS = c.scans[i];
          if (tau >= c.tPayEnd) break; // bagged up and carried out
          const bagX = L.bag.x + ((i % 3) - 1) * 0.12, bagZ = L.bag.z + (Math.floor(i / 3) % 2) * 0.12 - 0.06, bagY = L.bag.y + 0.1 + Math.floor(i / 6) * 0.17;
          if (self) {
            const basket = { x: pos.x + (L.x - pos.x) * 0.25 + 0.3, z: pos.z + (L.z - pos.z) * 0.25 };
            if (tau < tS - 0.4) { if (tau >= c.tWalk) item(mi, basket.x + (i % 3) * 0.06, 0.62 + (i % 2) * 0.05, basket.z, i); }
            else if (tau < tS) { const k = (tau - (tS - 0.4)) / 0.4; item(mi, basket.x + (L.scanner.x - basket.x) * k, 0.62 + (L.scanner.y + 0.12 - 0.62) * k + Math.sin(k * Math.PI) * 0.15, basket.z + (L.scanner.z - basket.z) * k, 0, -0.3 * k); }
            else if (tau < tS + 0.35) { const k = (tau - tS) / 0.35; item(mi, L.scanner.x + (bagX - L.scanner.x) * k, L.scanner.y + 0.12 + (bagY - L.scanner.y - 0.12) * k + Math.sin(k * Math.PI) * 0.12, L.scanner.z + (bagZ - L.scanner.z) * k); }
            else item(mi, bagX, bagY, bagZ, i * 0.4);
          } else {
            const bs = L.beltStart!, be = L.beltEnd!;
            const u = c.unload[i];
            if (tau < u) continue; // still in the basket / trolley
            if (tau < tS - 0.25) {
              // on the belt, queued behind the pack ahead of it
              const ahead = i - c.scans.filter((x) => x - 0.25 <= tau).length;
              const zMax = be.z - Math.max(0, ahead) * 0.17;
              const z = Math.min(bs.z + (tau - u) * BELT_V, zMax);
              item(mi, bs.x, 0.965 + 0.085, z, 0.1 * (i % 3));
            } else if (tau < tS + 0.3) {
              const k = (tau - (tS - 0.25)) / 0.55;
              const x = be.x + (L.scanner.x - be.x) * Math.min(1, k * 2) + (bagX - L.scanner.x) * Math.max(0, k * 2 - 1);
              const z = be.z + (L.scanner.z - be.z) * Math.min(1, k * 2) + (bagZ - L.scanner.z) * Math.max(0, k * 2 - 1);
              item(mi, x, 1.05 + Math.sin(k * Math.PI) * 0.12, z, 0, -0.4 * Math.sin(k * Math.PI));
            } else item(mi, bagX, bagY, bagZ, i * 0.4);
          }
          // beep + flash as each pack crosses the scanner (forward play only)
          if (i === c.beeped && tau >= tS && Lv.dtR > 0) { c.beeped++; bus.flash[L.id] = now; beep(now); }
        }
        if (c.beeped < c.n && tau > c.scans[c.beeped] + 0.5) c.beeped = c.scans.filter((x) => x <= tau).length; // after a scrub
        if (tau >= c.tPay0 && tau < c.tPay0 + 1.0) screen = 'tap';
        else if (tau >= c.tPay0 + 1.0 && tau < c.tPayEnd + 0.6) { screen = 'ok'; if (!c.approved && Lv.dtR > 0) { c.approved = true; sfx.blip(1320, 1980, 0.12, 'sine', 0.04); } }
      }
      if (cm) cm.color.set(screen === 'ok' ? '#22c55e' : screen === 'tap' ? (Math.sin(now * 14) > 0 ? '#7CC8FF' : '#ffffff') : '#24324a');
      const beam = beams.current[L.id];
      if (beam) { const since = now - (bus.flash[L.id] ?? -9); const k = Math.max(0, 1 - since / 0.22); beam.visible = k > 0.01; beam.scale.set(1, 0.4 + k * 0.6, 1); ((beam.material as THREE.MeshBasicMaterial).opacity = k * 0.55); }
    }
    // shared self-checkout snake
    const sw = Math.min(10, selfWaiting);
    for (let w = 0; w < sw; w++) {
      const row = Math.floor(w / 5), col = w % 5;
      const z = selfHead.z - 0.9 - col * 0.9, x = selfHead.x - row * 0.9;
      person({ x: x + (hash(`sq${w}`) - 0.5) * 0.15, z }, Math.sin(now * 0.6 + w) * 0.2, Math.floor(hash(`sqc${w}`) * 10));
    }

    for (const m of [bodies.current, hulls.current]) if (m) { m.count = np; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const m of [eyes.current, pupils.current]) if (m) { m.count = np * 2; m.instanceMatrix.needsUpdate = true; }
    itemMeshes.current.forEach((m, i) => { if (m) { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; } });
  });

  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45 }), []);
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25 }), []);
  const ink = useMemo(() => new THREE.MeshBasicMaterial({ color: INK }), []);
  const beamMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff2a4f', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), []);

  return (
    <group>
      <instancedMesh ref={bodies} args={[BODY_GEO, bodyMat, MAX_PEOPLE]} frustumCulled={false} castShadow raycast={noRay} />
      <instancedMesh ref={hulls} args={[BODY_GEO, INK_MAT, MAX_PEOPLE]} frustumCulled={false} raycast={noRay} />
      <instancedMesh ref={eyes} args={[EYE_GEO, white, MAX_PEOPLE * 2]} frustumCulled={false} raycast={noRay} />
      <instancedMesh ref={pupils} args={[PUPIL_GEO, ink, MAX_PEOPLE * 2]} frustumCulled={false} raycast={noRay} />
      {itemMats.map((mats, i) => (
        <instancedMesh key={i} ref={(m) => { itemMeshes.current[i] = m; }} args={[ITEM, mats, MAX_ITEMS]} frustumCulled={false} castShadow raycast={noRay} />
      ))}
      {/* card machines on every staffed till (screen: idle → tap → ✓ green) */}
      {staffed.map((L) => (
        <group key={L.id} position={[L.x - 0.38, 0.94, L.bag.z - 0.62]} rotation={[0, -Math.PI / 2, 0]}>
          <mesh position={[0, 0.08, 0]} material={ink}><cylinderGeometry args={[0.02, 0.03, 0.16, 8]} /></mesh>
          <mesh position={[0, 0.2, 0]} rotation={[-0.5, 0, 0]} material={ink}><boxGeometry args={[0.13, 0.2, 0.04]} /></mesh>
          <mesh position={[0, 0.215, 0.022]} rotation={[-0.5, 0, 0]}>
            <planeGeometry args={[0.1, 0.08]} />
            <meshBasicMaterial ref={(m) => { cards.current[L.id] = m; }} color="#24324a" />
          </mesh>
        </group>
      ))}
      {/* scanner beams: a red fan of light on every beep */}
      {P.lanes.map((L) => (
        <mesh key={L.id} ref={(m) => { beams.current[L.id] = m; }} position={[L.scanner.x, L.scanner.y + 0.14, L.scanner.z]} material={beamMat.clone()} visible={false} raycast={noRay}>
          <coneGeometry args={[0.2, 0.28, 18, 1, true]} />
        </mesh>
      ))}
    </group>
  );
}
const UP = new THREE.Vector3(0, 1, 0);
const noRay = () => null;

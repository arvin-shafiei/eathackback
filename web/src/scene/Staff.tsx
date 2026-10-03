// Store staff, driven by the ops day log (sim/ops.py → data/sim/ops/day_*.json; fixture until it exists).
// Restockers push roll cages from the stockroom to low-stock slots and refill them (restockShelf), the cleaner walks
// to spills behind a yellow wet-floor sign, the manager taps orders into a tablet ("order placed: …" pop-ups come
// from the Ops layer), the guard patrols and runs to EAS alarms, cashiers scan at every staffed till.
// Staff are kinematic rapier bodies, so shoppers bonk off them. Tasks/targets come from the log; paths and
// animation are presentation only.
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { Planogram, StoreConfig } from '../types';
import { productWorld, routeBetween, storePlan } from '../layout';
import { resolveAt, spillPos, type OpsMinute, type OpsStaff } from '../ops';
import { inkHull } from './parts';
import { canvasTex } from './textures';
import { bus } from './fx';
import { restockShelf } from './shelfBus';
import { INK } from '../theme';
import { cafeSpills, opsWet, spillsChanged, CLEAN_DRY_S, type CafeSpill } from './cafe/cafeState';

/** what the Ops layer computes once per frame (priority -1) and every ops child reads */
export interface OpsLive {
  rec: OpsMinute | null; t: number; dtR: number; jump: boolean; now: number;
  /** EAS alarm the guard should answer even if the log row hasn't caught up yet */
  guard: { x: number; z: number; until: number } | null;
}

export const ROLE: Record<string, { body: string; label: string }> = {
  restocker: { body: '#FE831B', label: 'restocker' },
  cleaner: { body: '#22b8b0', label: 'cleaner' },
  manager: { body: '#6d28d9', label: 'manager' },
  guard: { body: '#24324a', label: 'security' },
  cashier: { body: '#16a34a', label: 'cashier' },
  barista: { body: '#7a4b2a', label: 'barista' },
};
export const INK_MAT = inkHull(0.026);
export const BODY_GEO = new THREE.CapsuleGeometry(0.28, 0.58, 8, 18).translate(0, 0.57, 0);
export const EYE_GEO = new THREE.SphereGeometry(0.095, 14, 10);
export const PUPIL_GEO = new THREE.SphereGeometry(0.048, 10, 8);
export const ARM_GEO = new THREE.CapsuleGeometry(0.05, 0.24, 4, 8).translate(0, -0.17, 0);
export const WHITE = new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.25 });
export const INKM = new THREE.MeshBasicMaterial({ color: INK });

export interface Walker { pos: THREE.Vector3; yaw: number; path: { x: number; z: number }[]; goal: string; body: RigidBody | null; moving: boolean; task: string; work: number }

type XZ = { x: number; z: number };
/** staff paths: the layout's fixture-aware router (around gondolas, tills, café, wall runs), plus the stockroom door
 *  (the stockroom sits outside the sales floor). presentation only */
export function routeStaff(cfg: StoreConfig, a: XZ, b: XZ): XZ[] {
  const P = storePlan(cfg);
  const door = P.stockroom.door;
  const inStock = (p: XZ) => p.x > P.bounds.xMax + 0.1;
  const inside = { x: door.x - 1, z: door.z }, outside = { x: door.x + 0.9, z: door.z };
  const pts: XZ[] = [];
  let from = a;
  if (inStock(a)) { pts.push(outside, inside); from = inside; }
  const to = inStock(b) ? inside : b;
  try { pts.push(...routeBetween(cfg, from, to, 0.3)); } catch { pts.push(to); }
  if (inStock(b)) pts.push(outside, b);
  return pts;
}

const CAGE_BOX = new THREE.BoxGeometry(0.6, 0.28, 0.5);
const CAGE_MATS = [new THREE.MeshStandardMaterial({ color: '#d9a05b', roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: '#c48a4a', roughness: 0.8 })];
const CAGE_WIRE = new THREE.MeshStandardMaterial({ color: '#9aa3b5', wireframe: true });

/** one staff member. `wref` is moved by whoever owns it (StaffCrew steering, or a static post like the barista) */
export function Person({ role, wref, cashierLane }: { role: string; wref: MutableRefObject<Walker | null>; cashierLane?: string }) {
  const g = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null), armL = useRef<THREE.Group>(null), prop = useRef<THREE.Group>(null);
  const boxes = useRef<(THREE.Mesh | null)[]>([]);
  const tabletGlow = useRef<THREE.MeshStandardMaterial>(null);
  const r = ROLE[role] ?? ROLE.manager;
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: r.body, roughness: 0.35 }), [r.body]);
  const step = useRef(Math.random() * 6);
  useFrame((st, dt) => {
    const w = wref.current; if (!w || !g.current) return;
    const now = st.clock.elapsedTime;
    step.current += dt * (w.moving ? 9 : 1.5);
    const bob = w.moving ? Math.abs(Math.sin(step.current)) * 0.05 : Math.sin(now * 2) * 0.01;
    g.current.position.set(w.pos.x, bob, w.pos.z);
    g.current.rotation.set(0, w.yaw, w.moving ? Math.sin(step.current) * 0.1 : 0);
    let thR = w.moving ? Math.sin(step.current) * 0.6 : 0.05, thL = w.moving ? -Math.sin(step.current) * 0.6 : 0.05;
    const working = !w.moving;
    if (role === 'restocker') {
      thR = thL = -1.3; // both hands on the cage
      if (w.task === 'restock' && working) { thR = -1.4 - Math.abs(Math.sin(now * 3)) * 1.2; thL = -1.4 - Math.abs(Math.cos(now * 3)) * 1.2; }
      // the cage empties while they fill the shelf, and is full again after a stockroom trip
      const left = Math.round(3 * (1 - Math.min(1, w.work)));
      boxes.current.forEach((b, i) => { if (b) b.visible = i < left; });
    }
    if (role === 'cleaner') { thR = -0.9; thL = -0.7; if (prop.current) prop.current.rotation.y = w.task === 'clean' && working ? Math.sin(now * 6) * 0.6 : 0; }
    if (role === 'manager') {
      thL = -1.25;
      if (w.task === 'order' && working) thR = -1.1 - Math.abs(Math.sin(now * 8)) * 0.25;
      if (tabletGlow.current) tabletGlow.current.emissiveIntensity = w.task === 'order' ? 0.5 + Math.abs(Math.sin(now * 4)) * 0.6 : 0.35;
    }
    if (role === 'guard' && w.task === 'respond' && working) thR = -2.6; // "stop right there"
    if (role === 'barista') { thR = -1.0 - Math.abs(Math.sin(now * 2.2)) * 0.5; thL = -0.6; }
    if (role === 'cashier' && cashierLane) {
      const since = now - (bus.flash[cashierLane] ?? -9);
      const k = since < 0.5 ? Math.sin(Math.PI * since / 0.5) : 0;
      thR = -1.2 - k * 0.6; thL = -1.0;
      g.current.rotation.y = w.yaw + k * 0.25; // glance at the scanner
    }
    if (armR.current) armR.current.rotation.x = thR;
    if (armL.current) armL.current.rotation.x = thL;
  });
  return (
    <group ref={g}>
      <mesh geometry={BODY_GEO} material={mat} castShadow />
      <mesh geometry={BODY_GEO} material={INK_MAT} />
      {[-1, 1].map((k) => (
        <group key={k} position={[k * 0.11, 0.93, 0.22]}>
          <mesh geometry={EYE_GEO} material={WHITE} />
          <mesh geometry={PUPIL_GEO} material={INKM} position={[0, -0.01, 0.07]} />
        </group>
      ))}
      <group ref={armR} position={[0.31, 0.74, 0.02]}><mesh geometry={ARM_GEO} material={mat} /></group>
      <group ref={armL} position={[-0.31, 0.74, 0.02]}><mesh geometry={ARM_GEO} material={mat} /></group>
      {role === 'restocker' && (
        <group position={[0, 0, 0.85]}>
          <mesh position={[0, 0.75, 0]} material={CAGE_WIRE}><boxGeometry args={[0.7, 1.4, 0.6]} /></mesh>
          {[0.25, 0.6, 0.95].map((y, i) => <mesh key={y} ref={(m) => { boxes.current[i] = m; }} position={[0, y, 0]} geometry={CAGE_BOX} material={CAGE_MATS[i % 2]} castShadow />)}
          {[[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]].map(([x, z]) => <mesh key={`${x}${z}`} position={[x, 0.05, z]} material={INKM}><sphereGeometry args={[0.05, 8, 6]} /></mesh>)}
        </group>
      )}
      {role === 'restocker' && <mesh position={[0, 1.18, 0.02]}><cylinderGeometry args={[0.27, 0.29, 0.1, 18]} /><meshStandardMaterial color="#FF4079" /></mesh>}
      {role === 'cleaner' && (
        <group ref={prop} position={[0.32, 0, 0.32]}>
          <mesh position={[0, 0.6, 0]} rotation={[0.2, 0, 0]}><cylinderGeometry args={[0.018, 0.018, 1.2]} /><meshStandardMaterial color="#c9cfdc" metalness={0.5} /></mesh>
          <mesh position={[0, 0.05, 0.1]}><boxGeometry args={[0.36, 0.08, 0.14]} /><meshStandardMaterial color="#e8f1f7" /></mesh>
        </group>
      )}
      {role === 'cleaner' && (
        // mop bucket on wheels, yellow like the sign
        <group position={[-0.35, 0, 0.45]}>
          <mesh position={[0, 0.17, 0]}><cylinderGeometry args={[0.16, 0.13, 0.3, 14]} /><meshStandardMaterial color="#FFE14D" /></mesh>
          <mesh position={[0, 0.31, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.14, 14]} /><meshStandardMaterial color="#7fd4ff" /></mesh>
        </group>
      )}
      {role === 'manager' && (
        <>
          <mesh position={[0, 0.6, 0.28]} rotation={[-0.14, 0, 0]}><boxGeometry args={[0.08, 0.28, 0.03]} /><meshStandardMaterial color="#e63946" /></mesh>
          <mesh position={[-0.3, 0.55, 0.32]} rotation={[-0.9, 0, 0]}><boxGeometry args={[0.26, 0.34, 0.025]} /><meshStandardMaterial ref={tabletGlow} color={INK} emissive="#7CC8FF" emissiveIntensity={0.35} /></mesh>
        </>
      )}
      {role === 'guard' && (
        <>
          <mesh position={[0, 1.13, 0]}><cylinderGeometry args={[0.27, 0.3, 0.12, 18]} /><meshStandardMaterial color="#141b2b" /></mesh>
          <mesh position={[0, 1.12, 0.26]} rotation={[0.25, 0, 0]}><boxGeometry args={[0.34, 0.03, 0.16]} /><meshStandardMaterial color="#141b2b" /></mesh>
          <mesh position={[0, 0.62, 0]}><cylinderGeometry args={[0.296, 0.296, 0.12, 20, 1, true]} /><meshStandardMaterial color="#d6ff3d" emissive="#d6ff3d" emissiveIntensity={0.2} side={THREE.DoubleSide} /></mesh>
        </>
      )}
      {role === 'cashier' && <mesh position={[0, 0.5, 0.05]}><cylinderGeometry args={[0.292, 0.31, 0.5, 20, 1, true]} /><meshStandardMaterial color="#e9fbe9" side={THREE.DoubleSide} /></mesh>}
      {role === 'barista' && (
        <>
          <mesh position={[0, 0.48, 0.04]}><cylinderGeometry args={[0.292, 0.31, 0.56, 20, 1, true]} /><meshStandardMaterial color="#2a2230" side={THREE.DoubleSide} /></mesh>
          <mesh position={[0, 1.13, 0]}><cylinderGeometry args={[0.24, 0.27, 0.1, 18]} /><meshStandardMaterial color="#2a2230" /></mesh>
        </>
      )}
    </group>
  );
}

const SIGN_TEX = () => canvasTex(128, 160, (ctx) => {
  ctx.fillStyle = '#FFE14D'; ctx.fillRect(0, 0, 128, 160); ctx.strokeStyle = INK; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 120, 152);
  ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(64, 18); ctx.lineTo(108, 92); ctx.lineTo(20, 92); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#FFE14D'; ctx.font = '800 54px "Baloo 2", system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', 64, 86);
  ctx.fillStyle = INK; ctx.font = '800 22px "Baloo 2", system-ui'; ctx.fillText('wet floor', 64, 128);
});
let signTex: THREE.Texture | null = null;

/** spill decal + yellow A-frame wet-floor sign. The puddle shrinks while it's being cleaned.
 *  color: puddle colour (aisle water blue; café coffee brown). sign: show the A-frame (default on).
 *  fade(): 0..1 visibility read every frame (café spills fade out as they dry) */
export function WetFloor({ x, z, cleaning, color = '#7fd4ff', sign = true, fade, size = 1 }: { x: number; z: number; cleaning: boolean; color?: string; sign?: boolean; fade?: () => number; size?: number }) {
  const tex = useMemo(() => (signTex ??= SIGN_TEX()), []);
  const puddle = useRef<THREE.Mesh>(null);
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useFrame((st) => {
    const now = st.clock.elapsedTime;
    const k = fade ? Math.max(0, Math.min(1, fade())) : 1;
    if (puddle.current) puddle.current.scale.setScalar(size * (0.35 + 0.65 * k) * (cleaning ? 0.8 + Math.sin(now * 3) * 0.05 : 1 + Math.sin(now * 1.5) * 0.03));
    mats.current.forEach((m, i) => { if (m) m.opacity = (i ? 0.55 : 0.7) * k; });
  });
  return (
    <group position={[x, 0, z]}>
      <mesh ref={puddle} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.75, 28]} />
        <meshStandardMaterial ref={(m) => { mats.current[0] = m; }} color={color} transparent opacity={0.7} roughness={0.02} metalness={0.2} depthWrite={false} />
      </mesh>
      {[[0.3, -0.2], [-0.25, 0.35]].map(([dx, dz], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[dx * size, 0.013, dz * size]}><circleGeometry args={[0.28 * size, 18]} /><meshStandardMaterial ref={(m) => { mats.current[i + 1] = m; }} color={color} transparent opacity={0.55} roughness={0.02} depthWrite={false} /></mesh>
      ))}
      {sign && (
        <group position={[-0.9, 0, -0.4]} rotation={[0, 0.6, 0]}>
          {[-1, 1].map((k) => (
            <mesh key={k} position={[0, 0.36, k * 0.12]} rotation={[k * 0.3, k < 0 ? Math.PI : 0, 0]}>
              <planeGeometry args={[0.36, 0.72]} />
              <meshBasicMaterial map={tex} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

interface CrewProps {
  cfg: StoreConfig; roster: OpsStaff[]; live: MutableRefObject<OpsLive>; planogram: Planogram;
  /** written by the crew so the Ops layer can float the manager's order pop-ups over their head */
  walkersOut?: MutableRefObject<Record<string, Walker | null>>;
}

/** restock rate while a restocker stands at a slot: one pack per product every this many replay seconds */
const RESTOCK_EVERY = 0.9;

export function StaffCrew({ cfg, roster, live, planogram, walkersOut }: CrewProps) {
  const { world, rapier } = useRapier();
  const P = storePlan(cfg);
  const walkers = useMemo(() => roster.map(() => ({ current: null as Walker | null })), [roster]);
  const restockClock = useRef<Record<string, number>>({});

  useEffect(() => {
    const made: RigidBody[] = [];
    roster.forEach((s, i) => {
      const start = s.role === 'cashier'
        ? P.lanes.find((l) => l.id === s.lane)?.cashier ?? { x: 0, z: 0 }
        : resolveAt(cfg, s.role === 'guard' ? 'G1a' : 'stockroom', [], s.role) ?? { x: 0, z: 0 };
      const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, 0.6, start.z));
      world.createCollider(rapier.ColliderDesc.capsule(0.3, 0.3).setRestitution(0.4), body);
      if (s.role === 'restocker') world.createCollider(rapier.ColliderDesc.cuboid(0.36, 0.5, 0.32).setTranslation(0, 0.1, 0.85), body);
      made.push(body);
      walkers[i].current = { pos: new THREE.Vector3(start.x, 0, start.z), yaw: s.role === 'cashier' ? -Math.PI / 2 : 0, path: [], goal: '', body, moving: false, task: s.role === 'cashier' ? 'serve' : 'idle', work: 0 };
      if (walkersOut) walkersOut.current[s.id] = walkers[i].current;
    });
    return () => {
      for (const b of made) { try { world.removeRigidBody(b); } catch { /* gone */ } }
      if (walkersOut) for (const s of roster) delete walkersOut.current[s.id];
    };
  }, [roster, walkers, world, rapier, cfg, P, walkersOut]);

  useBeforePhysicsStep(() => {
    for (const w of walkers) {
      const c = w.current; if (!c?.body) continue;
      tmpQ.setFromAxisAngle(UPV, c.yaw);
      c.body.setNextKinematicTranslation({ x: c.pos.x, y: 0.6, z: c.pos.z });
      c.body.setNextKinematicRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
    }
  });

  useFrame(() => {
    const L = live.current;
    const r = L.rec, spills = r?.spills, dtR = L.dtR, jump = L.jump;
    roster.forEach((s, i) => {
      const w = walkers[i].current; if (!w) return;
      if (s.role === 'cashier') {
        const lane = P.lanes.find((l) => l.id === s.lane);
        if (lane?.cashier) { w.pos.set(lane.cashier.x, 0, lane.cashier.z); w.yaw = -Math.PI / 2; }
        return;
      }
      let row = r?.staff?.find((x) => x.id === s.id);
      // the guard answers a live alarm even before the log's next row says "respond"
      if (s.role === 'guard' && L.guard && L.t < L.guard.until && row?.task !== 'respond') row = { id: s.id, task: 'respond', at: { x: L.guard.x + 0.9, z: L.guard.z - 1.4 } };
      // café spills: a cleaner the log has free (anything but an ops 'clean') grabs mop + sign and goes over
      let cafeSp: CafeSpill | undefined;
      if (s.role === 'cleaner' && row?.task !== 'clean') {
        cafeSp = cafeSpills.find((x) => x.state !== 'done' && x.claimed === s.id) ?? cafeSpills.find((x) => x.state !== 'done' && !x.claimed);
        if (cafeSp) { cafeSp.claimed = s.id; row = { id: s.id, task: 'clean', at: { x: cafeSp.x + 0.75, z: cafeSp.z + 0.1 } }; }
      } else if (s.role === 'cleaner') for (const x of cafeSpills) if (x.claimed === s.id) x.claimed = null; // log pulled them away
      const goalKey = row ? `${row.task}@${typeof row.at === 'object' ? `${row.at.x.toFixed(1)},${row.at.z.toFixed(1)}` : row.at}` : 'idle';
      w.task = row?.task ?? 'idle';
      if (goalKey !== w.goal) {
        w.goal = goalKey;
        const tgt = resolveAt(cfg, row?.at, spills, s.role) ?? resolveAt(cfg, 'stockroom', spills, s.role)!;
        if (jump) w.pos.set(tgt.x, 0, tgt.z);
        w.path = jump ? [] : routeStaff(cfg, w.pos, tgt);
        if (row?.at === 'stockroom') w.work = 0; // fresh cage
      }
      const speed = (s.role === 'guard' && w.task === 'respond' ? 3.2 : 1.5) * Math.max(0, dtR);
      let budget = speed;
      w.moving = false;
      while (budget > 0 && w.path.length) {
        const nx = w.path[0];
        const dx = nx.x - w.pos.x, dz = nx.z - w.pos.z, d = Math.hypot(dx, dz);
        if (d < 1e-3) { w.path.shift(); continue; }
        const stp = Math.min(d, budget);
        w.pos.x += (dx / d) * stp; w.pos.z += (dz / d) * stp; budget -= stp;
        const want = Math.atan2(dx, dz);
        w.yaw += Math.atan2(Math.sin(want - w.yaw), Math.cos(want - w.yaw)) * 0.25;
        w.moving = true;
        if (stp >= d) w.path.shift();
      }
      if (cafeSp && !w.moving && dtR > 0 && Math.hypot(w.pos.x - cafeSp.x - 0.75, w.pos.z - cafeSp.z - 0.1) < 0.6) {
        w.yaw = Math.atan2(cafeSp.x - w.pos.x, cafeSp.z - w.pos.z);
        if (cafeSp.state === 'open') { cafeSp.state = 'cleaning'; cafeSp.tClean = L.t; spillsChanged(); }
        // mop for spill_clean_and_dry_min (params.json, assumption) in replay seconds
        else if (L.t - cafeSp.tClean >= CLEAN_DRY_S) { cafeSp.state = 'done'; cafeSp.tDone = L.t; cafeSp.claimed = null; spillsChanged(); }
      }
      if (w.moving || dtR <= 0 || !row?.at || typeof row.at !== 'string') return;
      const at = row.at;
      // face the work
      if (at.startsWith('spill:')) { const look = resolveAt(cfg, at, spills); if (look) w.yaw = Math.atan2(look.x - 0.7 - w.pos.x, look.z - w.pos.z); }
      else if (planogram[at]) {
        const shelf = productWorld(cfg, planogram, at, null);
        if (shelf) w.yaw = Math.atan2(shelf.x - w.pos.x, shelf.z - w.pos.z);
      }
      // restockers refill the slot pack by pack while the cage empties
      if (s.role === 'restocker' && w.task === 'restock' && planogram[at]) {
        w.work = Math.min(1, w.work + dtR / 12);
        const key = `${s.id}@${at}`;
        const acc = (restockClock.current[key] ?? 0) + dtR;
        if (acc >= RESTOCK_EVERY) {
          restockClock.current[key] = 0;
          for (const code of planogram[at].products) restockShelf(at, code, 1);
        } else restockClock.current[key] = acc;
      }
    });
  });

  return (
    <>
      {roster.map((s, i) => <Person key={s.id} role={s.role} wref={walkers[i]} cashierLane={s.lane} />)}
    </>
  );
}

/** spills from the ops minute (state open/cleaning); rendered by the Ops layer */
export function Spills({ cfg, spills }: { cfg: StoreConfig; spills: OpsMinute['spills'] }) {
  // keep wetZones() (cafe/cafeState) in sync so the crowd can steer round wet aisles
  useEffect(() => {
    opsWet.length = 0;
    for (const sp of spills ?? []) { if (sp.state === 'done') continue; const p = spillPos(cfg, sp.at); if (p) opsWet.push({ id: sp.id, x: p.x, z: p.z }); }
    return () => { opsWet.length = 0; };
  }, [cfg, spills]);
  return <>{(spills ?? []).filter((sp) => sp.state !== 'done').map((sp) => { const p = spillPos(cfg, sp.at); return p ? <WetFloor key={sp.id} x={p.x} z={p.z} cleaning={sp.state === 'cleaning'} /> : null; })}</>;
}

const tmpQ = new THREE.Quaternion();
const UPV = new THREE.Vector3(0, 1, 0);

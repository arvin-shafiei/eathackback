// The ops layer: the store "running itself" from the ops day timeline (sim/ops.py; fixture until it exists).
// Staff walk to their logged tasks (restockers push cages from the stockroom, the cleaner mops spills behind a
// wet-floor sign, the manager taps orders into a tablet, the guard answers EAS alarms), cashiers scan at every
// staffed till. Staff are kinematic rapier bodies, so shoppers bonk off them too. Tasks, spills, orders and alarms
// come from the ops log; walking paths and animation are presentation only.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { Planogram, Product, StoreConfig } from '../types';
import { G, gondolaX, productWorld, storePlan } from '../layout';
import { minuteAt, resolveAt, spillPos, gateFor, OPS_RATE, type OpsDay, type OpsMinute, type OpsStaff } from '../ops';
import { inkHull } from './parts';
import { canvasTex } from './textures';
import { bus, sfx } from './fx';
import { INK, prodLabel } from '../theme';

interface Props {
  cfg: StoreConfig; ops: OpsDay | null; timeRef: MutableRefObject<number>; clockStart: number;
  planogram: Planogram; products: Record<string, Product>; live: boolean;
}

const ROLE: Record<string, { body: string; label: string; emoji: string }> = {
  restocker: { body: '#FE831B', label: 'restocker', emoji: '📦' },
  cleaner: { body: '#22b8b0', label: 'cleaner', emoji: '🧽' },
  manager: { body: '#6d28d9', label: 'manager', emoji: '📋' },
  guard: { body: '#24324a', label: 'security', emoji: '🛡️' },
  cashier: { body: '#16a34a', label: 'cashier', emoji: '🧾' },
};
const INK_MAT = inkHull(0.026);
const BODY_GEO = new THREE.CapsuleGeometry(0.28, 0.58, 8, 18).translate(0, 0.57, 0);
const EYE_GEO = new THREE.SphereGeometry(0.095, 14, 10);
const PUPIL_GEO = new THREE.SphereGeometry(0.048, 10, 8);
const ARM_GEO = new THREE.CapsuleGeometry(0.05, 0.24, 4, 8).translate(0, -0.17, 0);
const WHITE = new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.25 });
const INKM = new THREE.MeshBasicMaterial({ color: INK });

interface Walker { pos: THREE.Vector3; yaw: number; path: { x: number; z: number }[]; goal: string; body: RigidBody | null; moving: boolean; task: string }

/** gondola-aware waypoints: leave an aisle by the nearest cross-aisle, go round the tills by the right-hand corridor,
 *  and use the stockroom door. presentation only */
function routeStaff(cfg: StoreConfig, a: { x: number; z: number }, b: { x: number; z: number }) {
  const P = storePlan(cfg);
  const pts: { x: number; z: number }[] = [];
  const inStock = (p: { x: number; z: number }) => p.x > P.bounds.xMax + 0.1;
  const inAisle = (p: { x: number; z: number }) => p.z > P.z0 - 0.3 && p.z < P.z1 + 0.3 && Math.abs(p.x) < Math.abs(gondolaX(cfg, cfg.aisles)) + G.spacing;
  const walkway = (x: number) => { let w = 0; for (let k = 1; k <= cfg.aisles; k++) if (x > gondolaX(cfg, k)) w = k; return w; };
  const behindTills = (p: { x: number; z: number }) => p.z > P.checkoutZ - 2.2;
  const door = P.stockroom.door;
  let cur = a;
  const push = (p: { x: number; z: number }) => { pts.push(p); cur = p; };
  if (inStock(cur)) { push({ x: door.x + 0.9, z: door.z }); push({ x: door.x - 1, z: door.z }); }
  const target = inStock(b) ? { x: door.x - 1, z: door.z } : b;
  if (inAisle(cur) && !(inAisle(target) && walkway(cur.x) === walkway(target.x))) {
    const zc = Math.abs(cur.z - P.crossFront) + Math.abs(target.z - P.crossFront) < Math.abs(cur.z - P.crossBack) + Math.abs(target.z - P.crossBack) ? P.crossFront : P.crossBack;
    push({ x: cur.x, z: zc });
  }
  if (behindTills(target) !== behindTills(cur)) {
    const side = P.bounds.xMax - 1.1;
    push({ x: side, z: cur.z > P.checkoutZ - 2.2 ? cur.z : Math.min(cur.z, P.crossBack) });
    push({ x: side, z: target.z });
  } else if (inAisle(target) && !(inAisle(cur) && walkway(cur.x) === walkway(target.x))) {
    const zc = Math.abs(cur.z - P.crossFront) + Math.abs(target.z - P.crossFront) < Math.abs(cur.z - P.crossBack) + Math.abs(target.z - P.crossBack) ? P.crossFront : P.crossBack;
    push({ x: target.x, z: zc });
  }
  push(target);
  if (inStock(b)) { push({ x: door.x + 0.9, z: door.z }); push(b); }
  return pts;
}

function Person({ role, wref, cashierLane }: { role: string; wref: MutableRefObject<Walker | null>; cashierLane?: string }) {
  const g = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null), armL = useRef<THREE.Group>(null), prop = useRef<THREE.Group>(null);
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
    if (role === 'restocker') { thR = thL = -1.3; if (w.task === 'restock' && !w.moving) { thR = -1.4 - Math.abs(Math.sin(now * 3)) * 1.2; thL = -1.4 - Math.abs(Math.cos(now * 3)) * 1.2; } }
    if (role === 'cleaner') { thR = -0.9; thL = -0.7; if (w.task === 'clean' && !w.moving && prop.current) prop.current.rotation.y = Math.sin(now * 6) * 0.6; }
    if (role === 'manager') { thL = -1.25; if (w.task === 'order' && !w.moving) thR = -1.1 - Math.abs(Math.sin(now * 8)) * 0.25; }
    if (role === 'guard' && w.task === 'respond' && !w.moving) { thR = -2.6; } // "stop right there"
    if (role === 'cashier' && cashierLane) { const since = now - (bus.flash[cashierLane] ?? -9); const k = since < 0.5 ? Math.sin(Math.PI * since / 0.5) : 0; thR = -1.2 - k * 0.6; thL = -1.0; }
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
      {/* role kit */}
      {role === 'restocker' && (
        <group position={[0, 0, 0.85]}>
          <mesh position={[0, 0.75, 0]}><boxGeometry args={[0.7, 1.4, 0.6]} /><meshStandardMaterial color="#9aa3b5" wireframe /></mesh>
          {[0.25, 0.6, 0.95].map((y, i) => <mesh key={y} position={[0, y, 0]} castShadow><boxGeometry args={[0.6, 0.3, 0.5]} /><meshStandardMaterial color={i % 2 ? '#d9a05b' : '#c48a4a'} /></mesh>)}
          {[[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]].map(([x, z]) => <mesh key={`${x}${z}`} position={[x, 0.05, z]}><sphereGeometry args={[0.05, 8, 6]} /><meshStandardMaterial color={INK} /></mesh>)}
        </group>
      )}
      {role === 'restocker' && <mesh position={[0, 1.18, 0.02]}><cylinderGeometry args={[0.27, 0.29, 0.1, 18]} /><meshStandardMaterial color="#FF4079" /></mesh>}
      {role === 'cleaner' && (
        <group ref={prop} position={[0.32, 0, 0.32]}>
          <mesh position={[0, 0.6, 0]} rotation={[0.2, 0, 0]}><cylinderGeometry args={[0.018, 0.018, 1.2]} /><meshStandardMaterial color="#c9cfdc" metalness={0.5} /></mesh>
          <mesh position={[0, 0.05, 0.1]}><boxGeometry args={[0.36, 0.08, 0.14]} /><meshStandardMaterial color="#e8f1f7" /></mesh>
        </group>
      )}
      {role === 'manager' && (
        <>
          <mesh position={[0, 0.6, 0.28]} rotation={[-0.14, 0, 0]}><boxGeometry args={[0.08, 0.28, 0.03]} /><meshStandardMaterial color="#e63946" /></mesh>
          <mesh position={[-0.3, 0.55, 0.32]} rotation={[-0.9, 0, 0]}><boxGeometry args={[0.26, 0.34, 0.025]} /><meshStandardMaterial color={INK} emissive="#7CC8FF" emissiveIntensity={0.4} /></mesh>
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
    </group>
  );
}

function WetFloor({ x, z, cleaning }: { x: number; z: number; cleaning: boolean }) {
  const tex = useMemo(() => canvasTex(128, 160, (ctx) => {
    ctx.fillStyle = '#FFE14D'; ctx.fillRect(0, 0, 128, 160); ctx.strokeStyle = INK; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 120, 152);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(64, 18); ctx.lineTo(108, 92); ctx.lineTo(20, 92); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#FFE14D'; ctx.font = '800 54px "Baloo 2", system-ui'; ctx.textAlign = 'center'; ctx.fillText('!', 64, 86);
    ctx.fillStyle = INK; ctx.font = '800 22px "Baloo 2", system-ui'; ctx.fillText('wet floor', 64, 128);
  }), []);
  const puddle = useRef<THREE.Mesh>(null);
  useFrame((st) => { if (puddle.current) puddle.current.scale.setScalar(cleaning ? 0.8 + Math.sin(st.clock.elapsedTime * 3) * 0.05 : 1 + Math.sin(st.clock.elapsedTime * 1.5) * 0.03); });
  return (
    <group position={[x, 0, z]}>
      <mesh ref={puddle} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <circleGeometry args={[0.75, 28]} />
        <meshStandardMaterial color="#7fd4ff" transparent opacity={0.65} roughness={0.02} metalness={0.2} />
      </mesh>
      <group position={[-0.9, 0, -0.4]} rotation={[0, 0.6, 0]}>
        {[-1, 1].map((k) => (
          <mesh key={k} position={[0, 0.36, k * 0.12]} rotation={[k * 0.3, k < 0 ? Math.PI : 0, 0]}>
            <planeGeometry args={[0.36, 0.72]} />
            <meshBasicMaterial map={tex} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

interface Pop { id: number; text: string; sub?: string; x: number; z: number; until: number; kind: 'order' | 'alarm' }
interface Lifter { id: number; gate: { x: number; z: number }; t0: number; value?: number; kind?: string }

export function Ops({ cfg, ops, timeRef, clockStart, planogram, products, live }: Props) {
  const { world, rapier } = useRapier();
  const P = storePlan(cfg);
  const roster = useMemo<OpsStaff[]>(() => {
    const base = (ops?.staff ?? []).filter((s) => s.role !== 'cashier');
    // every staffed till gets a cashier (the replay sends shoppers to all of them)
    const cashiers = P.lanes.filter((l) => l.kind === 'staffed').map((l) => ({ id: `K-${l.id}`, role: 'cashier', lane: l.id }));
    return [...(base.length ? base : [{ id: 'G1', role: 'guard' }]), ...cashiers];
  }, [ops, P]);
  const walkers = useMemo(() => roster.map(() => ({ current: null as Walker | null })), [roster]);

  // kinematic bodies
  useEffect(() => {
    const made: RigidBody[] = [];
    roster.forEach((s, i) => {
      const start = s.role === 'cashier' ? P.lanes.find((l) => l.id === s.lane)?.cashier ?? { x: 0, z: 0 } : resolveAt(cfg, s.role === 'guard' ? 'G1a' : 'stockroom', [], s.role) ?? { x: 0, z: 0 };
      const body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, 0.6, start.z));
      world.createCollider(rapier.ColliderDesc.capsule(0.3, 0.3).setRestitution(0.4), body);
      if (s.role === 'restocker') world.createCollider(rapier.ColliderDesc.cuboid(0.36, 0.5, 0.32).setTranslation(0, 0.1, 0.85), body);
      made.push(body);
      walkers[i].current = { pos: new THREE.Vector3(start.x, 0, start.z), yaw: s.role === 'cashier' ? -Math.PI / 2 : 0, path: [], goal: '', body, moving: false, task: s.role === 'cashier' ? 'serve' : 'idle' };
    });
    return () => { for (const b of made) { try { world.removeRigidBody(b); } catch { /* gone */ } } };
  }, [roster, walkers, world, rapier, cfg, P]);

  useBeforePhysicsStep(() => {
    for (const w of walkers) {
      const c = w.current; if (!c?.body) continue;
      tmpQ.setFromAxisAngle(UPV, c.yaw);
      c.body.setNextKinematicTranslation({ x: c.pos.x, y: 0.6, z: c.pos.z });
      c.body.setNextKinematicRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w });
    }
  });

  const [rec, setRec] = useState<OpsMinute | null>(null);
  const [pops, setPops] = useState<Pop[]>([]);
  const [lifters, setLifters] = useState<Lifter[]>([]);
  const last = useRef({ minute: -1, t: 0, n: 0 });
  const lifterRefs = useRef(new Map<number, THREE.Group>());

  useFrame((st) => {
    const t = timeRef.current, now = st.clock.elapsedTime;
    const opsMin = clockStart + t * OPS_RATE;
    bus.opsMin = opsMin;
    const L = last.current;
    const dtR = t - L.t; L.t = t;
    const jump = Math.abs(dtR) > 2;
    const r = live ? minuteAt(ops, opsMin) : null;
    const mi = r ? r.t : -1;
    if (mi !== L.minute) {
      // fire the one-shot events (alarms, orders) of every minute we just crossed, unless the clock jumped
      if (ops && r && !jump && L.minute >= 0 && mi > L.minute && mi - L.minute <= 4) {
        const crossed = ops.minutes.filter((m) => m.t > L.minute && m.t <= mi);
        const add: Pop[] = [], addL: Lifter[] = [];
        for (const m of crossed) {
          for (const a of m.alarms ?? []) {
            const g = a.at && typeof a.at === 'object' ? { x: a.at.x, z: a.at.z, id: a.gate ?? 'G1a' } : gateFor(cfg, a.gate);
            if (!g) continue;
            bus.alarm[(g as { id: string }).id] = now + 4.5; sfx.alarm(); bus.shake = Math.min(1, bus.shake + 0.5);
            addL.push({ id: L.n++, gate: g, t0: t, value: a.value_gbp, kind: a.kind });
            add.push({ id: L.n++, kind: 'alarm', text: 'beep beep beep!', sub: a.kind === 'skip_scan' ? `skip-scan at self-checkout${a.value_gbp ? ` · £${a.value_gbp.toFixed(2)}` : ''}` : `unscanned items${a.value_gbp ? ` · £${a.value_gbp.toFixed(2)}` : ''}`, x: g.x, z: g.z, until: t + 6 });
          }
          for (const o of m.orders ?? []) {
            const mgr = roster.findIndex((s) => s.role === 'manager');
            const w = mgr >= 0 ? walkers[mgr].current : null;
            const p = products[o.code];
            add.push({ id: L.n++, kind: 'order', text: `ordered ${o.qty ?? ''}× ${p ? prodLabel(p).slice(0, 28) : o.code}`, sub: o.why, x: w?.pos.x ?? 0, z: w?.pos.z ?? 0, until: t + 5 });
            sfx.ding();
          }
        }
        if (add.length) setPops((cur) => [...cur.filter((x) => x.until > t), ...add].slice(-6));
        if (addL.length) setLifters((cur) => [...cur.filter((x) => t - x.t0 < 8), ...addL].slice(-3));
      }
      L.minute = mi;
      setRec(r);
      bus.stock = r?.stock ?? null;
    }
    if (jump) { setPops((c) => (c.length ? [] : c)); setLifters((c) => (c.length ? [] : c)); }

    // staff steering
    const spills = r?.spills;
    roster.forEach((s, i) => {
      const w = walkers[i].current; if (!w) return;
      if (s.role === 'cashier') { const lane = P.lanes.find((l) => l.id === s.lane); if (lane?.cashier) { w.pos.set(lane.cashier.x, 0, lane.cashier.z); w.yaw = -Math.PI / 2; } return; }
      const row = r?.staff?.find((x) => x.id === s.id);
      const goalKey = row ? `${row.task}@${typeof row.at === 'object' ? `${row.at.x},${row.at.z}` : row.at}` : 'idle';
      w.task = row?.task ?? 'idle';
      if (goalKey !== w.goal) {
        w.goal = goalKey;
        const tgt = resolveAt(cfg, row?.at, spills, s.role) ?? resolveAt(cfg, 'stockroom', spills, s.role)!;
        if (jump || !w.path) w.pos.set(tgt.x, 0, tgt.z);
        w.path = jump ? [] : routeStaff(cfg, w.pos, tgt);
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
      if (!w.moving && dtR > 0 && row?.at && typeof row.at === 'string') {
        // face the work: the shelf (restock/order), the spill, the gate
        const look = row.at.startsWith('spill:') ? resolveAt(cfg, row.at, spills) : null;
        if (look) w.yaw = Math.atan2(look.x - 0.7 - w.pos.x, look.z - w.pos.z);
      }
    });
    // shoplifters walk to the gate then freeze, hands up
    for (const l of lifters) {
      const gr = lifterRefs.current.get(l.id); if (!gr) continue;
      const k = Math.min(1, (t - l.t0) / 1.4);
      gr.position.set(l.gate.x + 0.5, (k < 1 ? Math.abs(Math.sin(now * 14)) * 0.08 : 0), l.gate.z - 3 + k * 2.6);
      gr.rotation.set(0, k < 1 ? 0 : Math.sin(now * 20) * 0.15, 0);
      gr.visible = t >= l.t0 && t - l.t0 < 8;
    }
  });

  const stockouts = useMemo(() => {
    if (!rec?.stock) return [];
    return Object.entries(rec.stock).filter(([, v]) => v < 0.05).map(([slot]) => ({ slot, p: productWorld(cfg, planogram, slot, null) })).filter((x) => x.p).slice(0, 8);
  }, [rec, cfg, planogram]);

  return (
    <group>
      {roster.map((s, i) => <Person key={s.id} role={s.role} wref={walkers[i]} cashierLane={s.lane} />)}
      {(rec?.spills ?? []).map((sp) => { const p = spillPos(cfg, sp.at); return p ? <WetFloor key={sp.id} x={p.x} z={p.z} cleaning={sp.state === 'cleaning'} /> : null; })}
      {stockouts.map(({ slot, p }) => (
        <Html key={slot} position={[p!.x, p!.y + 0.1, p!.z]} center zIndexRange={[12, 0]}>
          <div className="sticker sticker-out" title={`ops stock for ${slot} < 5% (ops day log)`}>sold out!</div>
        </Html>
      ))}
      {lifters.map((l) => (
        <group key={l.id} ref={(g) => { if (g) lifterRefs.current.set(l.id, g); else lifterRefs.current.delete(l.id); }}>
          <mesh geometry={BODY_GEO}><meshStandardMaterial color="#6b6f7a" roughness={0.6} /></mesh>
          <mesh geometry={BODY_GEO} material={INK_MAT} />
          <mesh position={[0, 1.02, 0]}><sphereGeometry args={[0.31, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshStandardMaterial color="#4a4e58" /></mesh>
          {[-1, 1].map((k) => <mesh key={k} position={[k * 0.33, 1.05, 0]} rotation={[0, 0, k * 0.3]}><capsuleGeometry args={[0.05, 0.3, 4, 8]} /><meshStandardMaterial color="#6b6f7a" /></mesh>)}
          {[-1, 1].map((k) => <mesh key={`e${k}`} position={[k * 0.1, 0.9, 0.24]} geometry={EYE_GEO} material={WHITE} />)}
        </group>
      ))}
      {pops.map((p) => (
        <Html key={p.id} position={[p.x, p.kind === 'alarm' ? 2.6 : 2.3, p.z]} center zIndexRange={[40, 30]}>
          <div className={`ops-pop ops-${p.kind}`}>
            <b>{p.kind === 'alarm' ? '🚨 ' : '📦 '}{p.text}</b>
            {p.sub && <span>{p.sub}</span>}
          </div>
        </Html>
      ))}
    </group>
  );
}
const tmpQ = new THREE.Quaternion();
const UPV = new THREE.Vector3(0, 1, 0);

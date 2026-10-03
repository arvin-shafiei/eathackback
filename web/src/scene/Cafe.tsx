// Café life, driven by the ops day log: minutes[].cafe.occupied of .seats becomes people sitting at the café tables
// (scaled to this layout's chairs). New diners walk from the counter to a free chair with their order; they sip,
// nibble and chill (idle animation), then get up and walk out. A barista works the counter, and a grab-and-go rack
// holds real catalog packs (pack images from Open Food Facts when the catalog has them).
// Replay shoppers who sit down (layout scheduleCheckouts) take the low-numbered chairs; ops diners fill from the
// other end so they rarely share a chair. assumption: walk/sit timings are visual only; occupancy is the log's.
import { useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Product, StoreConfig } from '../types';
import { storePlan } from '../layout';
import { productMaterials } from './textures';
import { ARM_GEO, BODY_GEO, EYE_GEO, INK_MAT, INKM, Person, PUPIL_GEO, WHITE, type OpsLive, type Walker } from './Staff';
import { INK } from '../theme';

type XZ = { x: number; z: number };
interface SeatState { on: boolean; tIn: number; tOut: number; color: string; order: number }
const ARRIVE = 2.4, LEAVE = 2.8;
const COLORS = ['#f6a6b2', '#ffc98a', '#a7d8f0', '#b8e0a8', '#d7c2f2', '#f2d38a', '#9fd6cf', '#f0b6d8'];
const CAFE_CATS = ['snack_bars', 'biscuits_chocolate', 'soft_drinks', 'ready_meals_soup', 'bakery_bread', 'yoghurt', 'hot_drinks', 'confectionery_sweets'];
const PACK = new THREE.BoxGeometry(0.16, 0.2, 0.1);

interface Props { cfg: StoreConfig; live: MutableRefObject<OpsLive>; products: Record<string, Product> }

export function Cafe({ cfg, live, products }: Props) {
  const P = storePlan(cfg);
  const c = P.cafe;
  // ops diners fill chairs from the far end (replay shoppers start at chair 0)
  const order = useMemo(() => c.seats.map((_, i) => c.seats.length - 1 - i), [c.seats]);
  const states = useMemo<SeatState[]>(() => c.seats.map((_, i) => ({ on: false, tIn: -99, tOut: -99, color: COLORS[(i * 5) % COLORS.length], order: (i * 7) % 4 })), [c.seats]);
  const lastT = useRef(0);
  const fullRef = useRef<HTMLDivElement>(null);

  const rack = useMemo(() => {
    const ps = Object.values(products);
    const pool = ps.filter((p) => p.image && CAFE_CATS.includes(p.category));
    const use = (pool.length >= 6 ? pool : ps.filter((p) => p.image).length ? ps.filter((p) => p.image) : ps).slice(0, 12);
    return use.map((p) => ({ code: p.code, mats: productMaterials(p) }));
  }, [products]);

  const door = P.entrances[0] ?? { x: 0, z: P.frontZ };
  const counterSpot: XZ = { x: c.counter.x, z: c.counter.z + 0.85 };
  const exitSpot: XZ = { x: door.x - 1, z: P.frontZ - 2.5 };

  useFrame(() => {
    const L = live.current, t = L.t;
    const rec = L.rec;
    const seatsOps = rec?.cafe?.seats ?? 0;
    const want = seatsOps ? Math.min(c.seats.length, Math.round(((rec?.cafe?.occupied ?? 0) / seatsOps) * c.seats.length)) : 0;
    const jump = L.jump || t < lastT.current - 0.01;
    lastT.current = t;
    let have = states.filter((s) => s.on).length;
    if (jump) {
      // snap: no walking after a scrub
      states.forEach((s) => { s.on = false; s.tOut = -99; });
      for (let k = 0; k < want; k++) { const s = states[order[k]]; s.on = true; s.tIn = t - ARRIVE - 5 - k; }
      have = want;
    }
    // arrivals: the next free chair in fill order; departures: whoever has sat longest
    while (have < want) {
      const k = order.find((i) => !states[i].on && t - states[i].tOut > LEAVE);
      if (k === undefined) break;
      const s = states[k]; s.on = true; s.tIn = t + (have % 3) * 0.6; have++;
    }
    while (have > want) {
      let best = -1;
      states.forEach((s, i) => { if (s.on && t - s.tIn > ARRIVE && (best < 0 || s.tIn < states[best].tIn)) best = i; });
      if (best < 0) break;
      states[best].on = false; states[best].tOut = t; have--;
    }
    if (fullRef.current) fullRef.current.style.display = (rec?.cafe?.turned_away ?? 0) > 0 && want >= c.seats.length ? '' : 'none';
  });

  // barista: a static post behind the counter
  const barista = useRef<Walker | null>({ pos: new THREE.Vector3(c.counter.x + 0.3, 0, c.counter.z - 0.75), yaw: 0, path: [], goal: '', body: null, moving: false, task: 'serve', work: 0 });

  const rackX = c.counter.x + Math.min(2.2, c.w / 2 - 0.6), rackZ = c.counter.z + 0.05;
  return (
    <group>
      <Person role="barista" wref={barista} />
      {/* grab & go rack: three tiers of real packs */}
      <group position={[rackX, 0, rackZ]}>
        <mesh position={[0, 0.7, -0.05]} castShadow raycast={noRay}><boxGeometry args={[0.9, 1.4, 0.06]} /><meshStandardMaterial color="#fffaf5" /></mesh>
        <mesh position={[0, 1.48, 0]} raycast={noRay}><boxGeometry args={[0.94, 0.16, 0.5]} /><meshStandardMaterial color="#FF4079" /></mesh>
        {[0.35, 0.75, 1.15].map((y, r) => (
          <group key={y}>
            <mesh position={[0, y - 0.02, 0.18]} raycast={noRay}><boxGeometry args={[0.9, 0.03, 0.42]} /><meshStandardMaterial color="#e9dfd8" /></mesh>
            {rack.slice(r * 4, r * 4 + 4).map((p, i) => (
              <mesh key={p.code + i} position={[-0.31 + i * 0.205, y + 0.1, 0.25]} geometry={PACK} material={p.mats} castShadow raycast={noRay} />
            ))}
          </group>
        ))}
        {[-0.46, 0.46].map((x) => <mesh key={x} position={[x, 0.75, 0.18]} material={INKM} raycast={noRay}><boxGeometry args={[0.03, 1.5, 0.44]} /></mesh>)}
      </group>
      {/* takeaway cups + napkins on the counter */}
      {[-1.45, -1.32, -1.19].map((x, i) => (
        <mesh key={x} position={[c.counter.x + x, 1.07, c.counter.z + 0.2]} raycast={noRay}>
          <cylinderGeometry args={[0.045, 0.035, 0.13 + i * 0.01, 12]} /><meshStandardMaterial color={i === 1 ? '#FE831B' : '#ffffff'} />
        </mesh>
      ))}
      {states.map((s, i) => (
        <Diner key={i} st={s} seat={c.seats[i]} table={c.tables[c.seats[i].table] ?? c.seats[i]} live={live} from={counterSpot} exit={exitSpot} pack={rack[(i * 3) % Math.max(1, rack.length)]?.mats} />
      ))}
      <Html position={[c.counter.x, 2.9, c.counter.z]} center zIndexRange={[20, 10]}>
        <div ref={fullRef} style={{ display: 'none', ...STICKER, background: '#FFE14D' }}>café full · people turned away</div>
      </Html>
    </group>
  );
}

const STICKER: React.CSSProperties = {
  font: '800 13px "Baloo 2", system-ui', color: INK, background: '#fff', border: `2px solid ${INK}`, borderRadius: 999,
  padding: '2px 10px', boxShadow: `0 3px 0 ${INK}`, whiteSpace: 'nowrap', pointerEvents: 'none',
};

const CUP = new THREE.CylinderGeometry(0.05, 0.04, 0.11, 12);
const CUP_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
const SLEEVE = new THREE.MeshStandardMaterial({ color: '#FE831B', roughness: 0.5 });
const PLATE = new THREE.CylinderGeometry(0.13, 0.11, 0.015, 18);
const PASTRY = new THREE.SphereGeometry(0.07, 12, 8).scale(1.4, 0.6, 1);
const PASTRY_MAT = new THREE.MeshStandardMaterial({ color: '#e8a85c', roughness: 0.55 });
const STEAM = new THREE.SphereGeometry(0.03, 8, 6);
const STEAM_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false });

function Diner({ st, seat, table, live, from, exit, pack }: { st: SeatState; seat: XZ & { yaw: number }; table: XZ; live: MutableRefObject<OpsLive>; from: XZ; exit: XZ; pack?: THREE.Material[] }) {
  const g = useRef<THREE.Group>(null), arm = useRef<THREE.Group>(null), armL = useRef<THREE.Group>(null), food = useRef<THREE.Group>(null);
  const steam = useRef<(THREE.Mesh | null)[]>([]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: st.color, roughness: 0.45 }), [st.color]);
  const step = useRef(0);
  // the cup/plate sits on the table in front of the chair
  const toTable = { x: (table.x - seat.x) * 0.55, z: (table.z - seat.z) * 0.55 };
  useFrame((s3, dt) => {
    const G = g.current; if (!G) return;
    const t = live.current.t, now = s3.clock.elapsedTime;
    const tau = t - st.tIn, out = t - st.tOut;
    let x = seat.x, z = seat.z, yaw = seat.yaw, sit = true, walking = false, vis = true;
    if (st.on && tau < 0) vis = false;
    else if (st.on && tau < ARRIVE) {
      const k = tau / ARRIVE; x = from.x + (seat.x - from.x) * k; z = from.z + (seat.z - from.z) * k;
      yaw = Math.atan2(seat.x - from.x, seat.z - from.z); sit = k > 0.92; walking = !sit;
    } else if (!st.on && out >= 0 && out < LEAVE) {
      const k = out / LEAVE; x = seat.x + (exit.x - seat.x) * k; z = seat.z + (exit.z - seat.z) * k;
      yaw = Math.atan2(exit.x - seat.x, exit.z - seat.z); sit = k < 0.06; walking = !sit;
    } else if (!st.on) vis = false;
    G.visible = vis;
    if (!vis) return;
    step.current += dt * (walking ? 9 : 1);
    // seated: sink onto the chair, lean in now and then, little laugh bounces
    const chill = Math.sin(now * 0.6 + st.order * 1.7);
    const y = sit ? 0.16 + Math.max(0, Math.sin(now * 7 + st.order)) * (chill > 0.85 ? 0.03 : 0) : Math.abs(Math.sin(step.current)) * 0.05;
    G.position.set(x, y, z);
    G.rotation.set(sit ? 0.05 + Math.max(0, chill) * 0.08 : 0, yaw + (sit ? Math.sin(now * 0.4 + st.order) * 0.12 : 0), walking ? Math.sin(step.current) * 0.1 : 0);
    G.scale.set(1, sit ? 0.88 : 1, 1);
    // sip / nibble every few seconds (a drinker raises the cup; an eater the pastry)
    const cyc = (now + st.order * 1.3) % 4.2;
    const lift = sit && cyc < 1.1 ? Math.sin((cyc / 1.1) * Math.PI) : 0;
    if (arm.current) arm.current.rotation.x = walking ? Math.sin(step.current) * 0.6 : -0.9 - lift * 1.5;
    if (armL.current) armL.current.rotation.x = walking ? -Math.sin(step.current) * 0.6 : -0.7;
    // the food goes down on the table once seated, travels in hand while walking
    if (food.current) {
      food.current.visible = st.on || out < 0.4;
      if (sit) { const cy = Math.cos(yaw), sy = Math.sin(yaw); food.current.position.set(toTable.x * cy - toTable.z * sy, (0.775 - y) / 0.88, toTable.x * sy + toTable.z * cy); }
      else food.current.position.set(0.3, 0.55, 0.3);
    }
    steam.current.forEach((m, i) => {
      if (!m) return;
      const k = ((now * 0.5 + i * 0.33 + st.order * 0.2) % 1);
      m.position.set(Math.sin(now * 2 + i) * 0.02, 0.1 + k * 0.3, 0);
      m.scale.setScalar(0.6 + k);
      (m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.5;
      m.visible = sit;
    });
  });
  return (
    <group ref={g} visible={false}>
      <mesh geometry={BODY_GEO} material={mat} castShadow raycast={noRay} />
      <mesh geometry={BODY_GEO} material={INK_MAT} raycast={noRay} />
      {[-1, 1].map((k) => (
        <group key={k} position={[k * 0.11, 0.93, 0.22]}>
          <mesh geometry={EYE_GEO} material={WHITE} raycast={noRay} />
          <mesh geometry={PUPIL_GEO} material={INKM} position={[0, -0.01, 0.07]} raycast={noRay} />
        </group>
      ))}
      <group ref={arm} position={[0.31, 0.74, 0.02]}>
        <mesh geometry={ARM_GEO} material={mat} raycast={noRay} />
        {/* what's in hand: a coffee */}
        <group position={[0, -0.36, 0.04]}>
          <mesh geometry={CUP} material={CUP_MAT} raycast={noRay} />
          <mesh geometry={CUP} material={SLEEVE} scale={[1.04, 0.4, 1.04]} raycast={noRay} />
        </group>
      </group>
      <group ref={armL} position={[-0.31, 0.74, 0.02]}><mesh geometry={ARM_GEO} material={mat} raycast={noRay} /></group>
      <group ref={food}>
        <mesh geometry={PLATE} material={WHITE} raycast={noRay} />
        {st.order % 2 === 0 || !pack ? <mesh geometry={PASTRY} material={PASTRY_MAT} position={[0, 0.04, 0]} raycast={noRay} /> : <mesh geometry={PACK} material={pack} position={[0, 0.1, 0]} rotation={[0, 0.5, 0]} raycast={noRay} />}
        <group position={[0.16, 0.06, 0]}>
          <mesh geometry={CUP} material={CUP_MAT} raycast={noRay} />
          {[0, 1, 2].map((i) => <mesh key={i} ref={(m) => { steam.current[i] = m; }} geometry={STEAM} material={STEAM_MAT.clone()} raycast={noRay} />)}
        </group>
      </group>
    </group>
  );
}
const noRay = () => null;

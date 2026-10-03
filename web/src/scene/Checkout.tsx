// Checkout queues, first come first served, replayed from the ops engine's own per-shopper checkout log
// (sim/ops.py shoppers[]: lane, t_join, q_ahead, t_start, theatre.scans/bag/pay/done, abandoned; the fixture day gets
// a synthesised stream that tracks minutes[].queues). Every shopper:
//   walks up from the shop floor → joins the BACK of their lane's line → shuffles forward each time the till frees up →
//   at the till: unloads onto the conveyor → belt carries packs to the scanner → cashier scans (beep + red flash) →
//   bagging well → card machine (tap, ✓) → walks out through the gates.
//   self-checkout: one snake queue per kiosk pod; the head walks to the kiosk the engine assigned, scans pack by pack.
//   gave up (engine outcome=abandoned): leaves the line after their patience ran out, with a sticker.
// Lane signs show how many are waiting. Replay-run shoppers (crowdBus queue events) at a lane push the ops line back.
// assumption: visual pacing only (walk speeds, spacing, items drawn per basket ≤ 12). Join/serve/leave times and lane
// choice come from the engine; the HUD numbers come from the log via useOpsKpis, never from this animation.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { Product, StoreConfig } from '../types';
import { storePlan, type Lane } from '../layout';
import { laneMapper, type OpsDay, type OpsVisit } from '../ops';
import { productMaterials } from './textures';
import { bus, sfx } from './fx';
import { onCrowd } from './crowdBus';
import { type OpsLive } from './Staff';
import { minionGeo, MINION_MAT } from './minion';
import { INK } from '../theme';

type XZ = { x: number; z: number };
interface V extends OpsVisit { L: Lane; pod: number; color: number; mats: number[]; vis: number[] }
interface Body { x: number; z: number; yaw: number; seen: number }

// all in ops SECONDS (1 replay second = 15 ops seconds at OPS_RATE 0.25)
const APPROACH = 22, TO_TILL = 14, BELT = 14, LEAVE = 55, GIVEUP = 40;
const SPACING = 0.82, SNAKE_LEN = 6;
const WALK_V = 2.4; // m per replay second while shuffling up the line
const MAX_DRAWN = 12;
const ITEM = new THREE.BoxGeometry(0.13, 0.17, 0.09);
const PALETTE = ['#f6a6b2', '#ffc98a', '#a7d8f0', '#b8e0a8', '#d7c2f2', '#f2d38a', '#9fd6cf', '#f0b6d8', '#c9cfdc', '#ffb199'].map((c) => new THREE.Color(c));
const MAX_PEOPLE = 260, MAX_ITEMS = 220;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };

let lastBeep = 0;
function beep(now: number) { if (now - lastBeep > 0.06) { lastBeep = now; sfx.beep(); } }

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
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

interface Props {
  cfg: StoreConfig; live: MutableRefObject<OpsLive>; products: Record<string, Product>;
  /** the ops day being replayed (its visits drive the queues) */
  day?: OpsDay | null;
}
interface Sticker { id: string; x: number; z: number; text: string; until: number }

export function Checkout({ cfg, live, products, day }: Props) {
  const P = storePlan(cfg);
  const staffed = useMemo(() => P.lanes.filter((l) => l.kind === 'staffed'), [P]);
  // kiosk pods: self lanes clustered by x (a gap > 3 m starts a new pod); each pod has one snake queue at its mouth
  const pods = useMemo(() => {
    const se = P.lanes.filter((l) => l.kind === 'self').slice().sort((a, b) => a.x - b.x);
    const out: { lanes: Lane[]; head: XZ }[] = [];
    for (const l of se) { const last = out[out.length - 1]; if (last && l.x - Math.max(...last.lanes.map((x) => x.x)) < 3) last.lanes.push(l); else out.push({ lanes: [l], head: { x: 0, z: 0 } }); }
    for (const p of out) p.head = { x: Math.min(...p.lanes.map((l) => l.x)) - 1.0, z: P.checkoutZ };
    return out;
  }, [P]);
  const podOf = useMemo(() => { const m: Record<string, number> = {}; pods.forEach((p, i) => p.lanes.forEach((l) => { m[l.id] = i; })); return m; }, [pods]);

  // real products (with pack images) ride the belts
  const itemMats = useMemo(() => {
    const ps = Object.values(products);
    const withImg = ps.filter((p) => p.image);
    const pick = (withImg.length >= 4 ? withImg : ps).slice().sort((a, b) => hash(a.code) - hash(b.code)).slice(0, 10);
    return pick.map((p) => productMaterials(p));
  }, [products]);

  // the engine's visits, mapped onto this layout's lanes
  const visits = useMemo<{ list: V[]; span: number }>(() => {
    if (!day?.visits?.length) return { list: [], span: 0 };
    const map = laneMapper(cfg, day.laneOrder);
    const byId = Object.fromEntries(P.lanes.map((l) => [l.id, l]));
    const list: V[] = [];
    let span = 0;
    for (const v of day.visits) {
      const id = map(v.lane); const L = id ? byId[id] : null;
      if (!L) continue;
      const n = Math.max(1, Math.min(MAX_DRAWN, v.scans.length || v.items));
      const vis = v.scans.length ? Array.from({ length: n }, (_, j) => v.scans[Math.floor((j * v.scans.length) / n)]) : [];
      list.push({ ...v, L, pod: podOf[L.id] ?? -1, color: Math.floor(hash(v.id) * PALETTE.length), mats: Array.from({ length: n }, (_, i) => Math.floor(hash(`${v.id}${i}`) * Math.max(1, itemMats.length))), vis });
      span = Math.max(span, v.tLeave - v.tJoin);
    }
    return { list, span: Math.min(3600, span) + APPROACH + LEAVE + GIVEUP };
  }, [day, cfg, P, podOf, itemMats.length]);

  const itemMeshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const bodies = useRef<THREE.InstancedMesh>(null), hulls = useRef<THREE.InstancedMesh>(null);
  const overalls = useRef<THREE.InstancedMesh>(null);
  const cards = useRef<Record<string, THREE.MeshBasicMaterial | null>>({});
  const bodiesById = useRef(new Map<string, Body>());
  const beeped = useRef(new Map<string, number>());
  const approved = useRef(new Set<string>());
  const gaveUp = useRef(new Set<string>());
  const lastT = useRef(-1);
  const [signs, setSigns] = useState<Record<string, number>>({});
  const signKey = useRef('');
  const [stickers, setStickers] = useState<Sticker[]>([]);

  // replay-run shoppers at a lane → the ops line starts that many places further back
  const replayAt = useRef<Record<string, Map<string, number>>>({});
  useEffect(() => onCrowd((e) => {
    if (!('lane' in e) || !('agentId' in e)) return;
    const m = (replayAt.current[e.lane] ??= new Map());
    m.set(e.agentId, performance.now() / 1000 + (e.type === 'pay' ? 2 : 5));
  }), []);

  const selfMaxX = useMemo(() => { const s = P.lanes.filter((l) => l.kind === 'self'); return s.length ? Math.max(...s.map((l) => l.x)) : 0; }, [P]);
  const exitPath = (from: XZ, k: string, self: boolean): XZ[] => {
    const j = (hash(k + 'j') - 0.5) * 0.7;
    // self-checkout: out along the corridor between the two kiosk rows, then round the end of the pod
    const lead: XZ[] = self ? [from, { x: from.x, z: P.checkoutZ }, { x: selfMaxX + 1.0, z: P.checkoutZ }] : [from];
    const last = lead[lead.length - 1];
    const ex = P.exits.reduce((b, e) => (Math.abs(e.x - last.x) < Math.abs(b.x - last.x) ? e : b), P.exits[0] ?? { x: 0, z: P.bounds.zMax });
    const outZ = Math.max(P.checkoutZ + 2.6, (P.bank?.z1 ?? P.checkoutZ + 1.75) + 0.9) + j * 0.5;
    return [...lead, { x: last.x, z: outZ }, { x: ex.x + j, z: ex.z - 1.6 }, { x: ex.x + j, z: ex.z + 2.5 }];
  };
  /** place in line `r` (0 = next to be served) for a lane / pod, `off` extra places for replay shoppers */
  const slot = (L: Lane, r: number): { p: XZ; yaw: number } => {
    if (L.kind === 'staffed') {
      const d = SPACING * (r + 1);
      return { p: { x: L.stand.x + L.queueDir.x * d, z: L.stand.z + L.queueDir.z * d }, yaw: Math.atan2(-L.queueDir.x, -L.queueDir.z) };
    }
    const pod = pods[podOf[L.id]];
    const head = pod?.head ?? L.stand;
    // serpentine: down toward the shop floor, back up, … columns step away from the pod
    const col = Math.floor(r / SNAKE_LEN), row = r % SNAKE_LEN, down = col % 2 === 0;
    const z = head.z - 0.9 - (down ? row : SNAKE_LEN - 1 - row) * SPACING;
    return { p: { x: head.x - col * 0.8, z }, yaw: down ? Math.PI : 0 };
  };
  const bagSpot = (L: Lane): XZ => (L.kind === 'self' ? L.stand : { x: L.stand.x, z: L.bag.z - 0.35 });

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler();

  useFrame((st) => {
    const Lv = live.current, now = st.clock.elapsedTime, wall = performance.now() / 1000;
    const T = bus.opsMin * 60;
    const fwd = Lv.dtR > 0 && !Lv.jump;
    const snap = Lv.jump || lastT.current < 0 || Math.abs(T - lastT.current) > 120;
    lastT.current = T;
    if (snap) { bodiesById.current.clear(); beeped.current.clear(); approved.current.clear(); }
    const moveMax = Math.max(0, Lv.dtR) * WALK_V;

    // replay shoppers per lane (stale entries drop out)
    const replayN: Record<string, number> = {};
    for (const [lane, m] of Object.entries(replayAt.current)) { for (const [k, until] of m) if (until < wall) m.delete(k); replayN[lane] = m.size; }

    // ---- who's at the checkouts right now: binary search on tJoin, walk back over the longest trip
    const list = visits.list;
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].tJoin <= T + APPROACH) lo = mid + 1; else hi = mid; }
    const active: V[] = [];
    for (let i = lo - 1; i >= 0 && list[i].tJoin >= T - visits.span; i--) {
      const v = list[i];
      const end = v.abandoned ? v.tLeave + GIVEUP : v.done + LEAVE;
      if (T < end) active.push(v);
    }
    active.reverse(); // by tJoin
    // lines: per staffed lane, per pod (FIFO by tJoin). approaching shoppers count as already behind the last one.
    const lines: Record<string, V[]> = {};
    for (const v of active) {
      const queued = v.abandoned ? T < v.tLeave : T < (v.tStart ?? Infinity);
      if (!queued) continue;
      const key = v.L.kind === 'staffed' ? v.L.id : `pod${v.pod}`;
      (lines[key] ??= []).push(v);
    }
    const rankOf = new Map<string, number>();
    for (const [key, vs] of Object.entries(lines)) {
      const off = key.startsWith('pod') ? 0 : replayN[key] ?? 0;
      vs.forEach((v, i) => rankOf.set(v.id, i + off));
    }

    let np = 0, ni = 0;
    const counts = itemMats.map(() => 0);
    const person = (p: XZ, yaw: number, ci: number) => {
      if (np >= MAX_PEOPLE || !bodies.current) return;
      tmpQ.setFromAxisAngle(UP, yaw);
      tmpS.set(0.92, 0.92, 0.92);
      tmpM.compose(tmpP.set(p.x, 0, p.z), tmpQ, tmpS);
      // minion: yellow body + goggles + eyes in one mesh; the shopper's colour goes on the overalls
      bodies.current.setMatrixAt(np, tmpM); hulls.current?.setMatrixAt(np, tmpM); overalls.current?.setMatrixAt(np, tmpM);
      overalls.current?.setColorAt(np, PALETTE[ci % PALETTE.length]);
      np++;
    };
    const item = (mi: number, x: number, y: number, z: number, yaw = 0, tilt = 0) => {
      const m = itemMeshes.current[mi]; if (!m || counts[mi] >= MAX_ITEMS || ni > MAX_ITEMS * 4) return;
      tmpQ.setFromEuler(tmpE.set(tilt, yaw, 0));
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(1, 1, 1));
      m.setMatrixAt(counts[mi]++, tmpM); ni++;
    };
    /** queue shuffling: ease toward the target place at walking pace (snap after a scrub) */
    const ease = (id: string, tgt: XZ, yawT: number, ci: number) => {
      let b = bodiesById.current.get(id);
      if (!b || snap) { b = { x: tgt.x, z: tgt.z, yaw: yawT, seen: now }; bodiesById.current.set(id, b); }
      const dx = tgt.x - b.x, dz = tgt.z - b.z, d = Math.hypot(dx, dz);
      let yaw = yawT;
      if (d > 0.02) {
        const k = d > 8 ? 1 : Math.min(1, moveMax / d);
        b.x += dx * k; b.z += dz * k;
        if (d > 0.15) yaw = Math.atan2(dx, dz);
      }
      b.yaw += Math.atan2(Math.sin(yaw - b.yaw), Math.cos(yaw - b.yaw)) * 0.25;
      b.seen = now;
      person(b, b.yaw + (d < 0.05 ? Math.sin(now * 0.8 + ci) * 0.08 : 0), ci);
      return b;
    };
    const screens: Record<string, 'idle' | 'tap' | 'ok'> = {};

    for (const v of active) {
      const L = v.L, self = L.kind === 'self';
      const r = rankOf.get(v.id);
      // ----- 1. walking up / waiting in line / giving up
      if (r !== undefined) {
        const s = slot(L, r);
        if (T < v.tJoin) {
          // approach from the shop floor behind the line
          const from = { x: s.p.x + (hash(v.id + 'a') - 0.5) * 3, z: s.p.z - 4.5 };
          const k = (T - (v.tJoin - APPROACH)) / APPROACH;
          const a = along([from, s.p], k);
          bodiesById.current.set(v.id, { x: a.p.x, z: a.p.z, yaw: a.yaw, seen: now });
          person(a.p, a.yaw, v.color);
        } else ease(v.id, s.p, s.yaw, v.color);
        continue;
      }
      if (v.abandoned) {
        // patience ran out: turn round and walk back into the store
        if (!gaveUp.current.has(v.id) && fwd) {
          gaveUp.current.add(v.id);
          const b = bodiesById.current.get(v.id);
          if (b) setStickers((c) => [...c.filter((x) => x.until > T), { id: v.id, x: b.x, z: b.z, text: `gave up after ${mmss(v.waitS)}`, until: T + 90 }].slice(-4));
        }
        const b = bodiesById.current.get(v.id) ?? { x: slot(L, 0).p.x, z: slot(L, 0).p.z, yaw: 0, seen: now };
        const k = (T - v.tLeave) / GIVEUP;
        const a = along([{ x: b.x, z: b.z }, { x: b.x - 1.2, z: b.z - 1 }, { x: b.x - 1.8, z: b.z - 7 }], k);
        if (k < 0.97) person(a.p, a.yaw, v.color);
        continue;
      }
      const t0 = v.tStart!;
      const tau = T - t0;
      const head = slot(L, 0).p;
      const tillYaw = self ? (L.stand.z > L.z ? Math.PI : 0) : Math.PI / 2;
      // ----- 2. at the till
      let pos: XZ, yaw: number;
      const firstScan = v.scans[0] ?? v.bag;
      if (tau < TO_TILL) {
        const path = self ? [head, { x: L.stand.x, z: P.checkoutZ }, L.stand] : [head, L.stand];
        const a = along(path, tau / TO_TILL); pos = a.p; yaw = a.yaw;
      } else if (T < v.done) {
        // staffed: unload at the belt end, then step down to the bagging well once the belt is loaded
        const toBag = !self && T > Math.min(firstScan + 4, v.bag);
        const k = toBag ? Math.min(1, (T - Math.min(firstScan + 4, v.bag)) / 10) : 0;
        pos = self ? L.stand : lerp(L.stand, bagSpot(L), k); yaw = tillYaw;
      } else {
        const a = along(exitPath(bagSpot(L), v.id, self), (T - v.done) / LEAVE); pos = a.p; yaw = a.yaw;
      }
      bodiesById.current.set(v.id, { x: pos.x, z: pos.z, yaw, seen: now });
      if (T < v.done + LEAVE * 0.96) person(pos, yaw + (T >= t0 + TO_TILL && T < v.done ? Math.sin(now * 3 + v.color) * 0.06 : 0), v.color);
      if (T >= v.done) continue; // bagged up and carried out

      // ----- 3. the packs (≤ 12 drawn; every real scan beeps)
      const n = v.vis.length;
      for (let i = 0; i < n; i++) {
        const mi = v.mats[i], tS = v.vis[i];
        const bagX = L.bag.x + ((i % 3) - 1) * 0.12, bagZ = L.bag.z + (Math.floor(i / 3) % 2) * 0.12 - 0.06, bagY = L.bag.y + 0.1 + Math.floor(i / 6) * 0.17;
        if (self) {
          const basket = { x: pos.x + (L.x - pos.x) * 0.25 + 0.3, z: pos.z + (L.z - pos.z) * 0.25 };
          const lift = 6; // ops-s from basket to scanner
          if (T < tS - lift) { if (tau >= TO_TILL) item(mi, basket.x + (i % 3) * 0.06, 0.62 + (i % 2) * 0.05, basket.z, i); }
          else if (T < tS) { const k = (T - (tS - lift)) / lift; item(mi, basket.x + (L.scanner.x - basket.x) * k, 0.62 + (L.scanner.y + 0.12 - 0.62) * k + Math.sin(k * Math.PI) * 0.15, basket.z + (L.scanner.z - basket.z) * k, 0, -0.3 * k); }
          else if (T < tS + 5) { const k = (T - tS) / 5; item(mi, L.scanner.x + (bagX - L.scanner.x) * k, L.scanner.y + 0.12 + (bagY - L.scanner.y - 0.12) * k + Math.sin(k * Math.PI) * 0.12, L.scanner.z + (bagZ - L.scanner.z) * k); }
          else item(mi, bagX, bagY, bagZ, i * 0.4);
        } else {
          const bs = L.beltStart!, be = L.beltEnd!;
          // unloaded one by one as soon as they reach the till, then the belt carries them down
          const u = Math.max(t0 + TO_TILL + i * 1.6, tS - BELT - 30);
          if (T < u) continue;
          if (T < tS - 3) {
            const scannedAhead = v.vis.filter((x) => x - 3 <= T).length;
            const zMax = be.z - Math.max(0, i - scannedAhead) * 0.17;
            const z = Math.min(bs.z + ((T - u) / BELT) * Math.max(0.3, be.z - bs.z), zMax);
            item(mi, bs.x, 0.965 + 0.085, z, 0.1 * (i % 3));
          } else if (T < tS + 5) {
            const k = (T - (tS - 3)) / 8;
            const x = be.x + (L.scanner.x - be.x) * Math.min(1, k * 2) + (bagX - L.scanner.x) * Math.max(0, k * 2 - 1);
            const z = be.z + (L.scanner.z - be.z) * Math.min(1, k * 2) + (bagZ - L.scanner.z) * Math.max(0, k * 2 - 1);
            item(mi, x, 1.05 + Math.sin(k * Math.PI) * 0.12, z, 0, -0.4 * Math.sin(k * Math.PI));
          } else item(mi, bagX, bagY, bagZ, i * 0.4);
        }
      }
      // beep + flash for every real scan crossed this frame (forward play only)
      const done = v.scans.length ? upper(v.scans, T) : 0;
      const prev = beeped.current.get(v.id);
      if (prev === undefined || !fwd) beeped.current.set(v.id, done);
      else if (done > prev) { beeped.current.set(v.id, done); bus.flash[L.id] = now; beep(now); }
      // card machine
      if (T >= v.pay && T < v.pay + 6) screens[L.id] = 'tap';
      else if (T >= v.pay + 6 && T < v.done + 8) {
        screens[L.id] = 'ok';
        if (!approved.current.has(v.id) && fwd) { approved.current.add(v.id); sfx.blip(1320, 1980, 0.12, 'sine', 0.04); }
      }
    }
    // forget bodies nobody drew for a while
    if (bodiesById.current.size > 400) for (const [k, b] of bodiesById.current) if (now - b.seen > 2) bodiesById.current.delete(k);

    for (const L of P.lanes) {
      const cm = cards.current[L.id];
      const sc = screens[L.id] ?? 'idle';
      if (cm) cm.color.set(sc === 'ok' ? '#22c55e' : sc === 'tap' ? (Math.sin(now * 14) > 0 ? '#7CC8FF' : '#ffffff') : '#24324a');
    }
    for (const m of [bodies.current, hulls.current, overalls.current]) if (m) { m.count = np; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    itemMeshes.current.forEach((m, i) => { if (m) { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; } });

    // lane signs: people waiting (not yet at the till), refreshed when it changes
    const waiting: Record<string, number> = {};
    for (const [key, vs] of Object.entries(lines)) waiting[key] = vs.filter((v) => T >= v.tJoin).length;
    const k = JSON.stringify(waiting);
    if (k !== signKey.current) { signKey.current = k; setSigns(waiting); }
    if (stickers.length && stickers.some((s) => s.until < T || s.until > T + 200)) setStickers((c) => c.filter((s) => s.until > T && s.until < T + 200));
  });

  const mg = minionGeo();
  const ink = useMemo(() => new THREE.MeshBasicMaterial({ color: INK }), []);

  return (
    <group>
      <instancedMesh ref={bodies} args={[mg.head, MINION_MAT.head, MAX_PEOPLE]} frustumCulled={false} castShadow raycast={noRay} />
      <instancedMesh ref={hulls} args={[mg.hull, MINION_MAT.hull, MAX_PEOPLE]} frustumCulled={false} raycast={noRay} />
      <instancedMesh ref={overalls} args={[mg.overalls, MINION_MAT.tint, MAX_PEOPLE]} frustumCulled={false} raycast={noRay} />
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
      {/* queue signs: how many are waiting per till / kiosk pod (from the engine's join/serve times) */}
      {staffed.map((L) => {
        const n = signs[L.id] ?? 0;
        if (n < 1) return null;
        return (
          <Html key={L.id} position={[L.stand.x, 2.25, L.stand.z - 0.2]} center zIndexRange={[11, 0]}>
            <div style={{ ...SIGN, ...(n >= 4 ? HOT : null) }} title={`${n} waiting at ${L.id} (ops engine checkout log)`}>{L.id} · {n} in line</div>
          </Html>
        );
      })}
      {pods.map((p, i) => {
        const n = signs[`pod${i}`] ?? 0;
        if (n < 1) return null;
        return (
          <Html key={`pod${i}`} position={[p.head.x, 2.25, p.head.z - 0.9]} center zIndexRange={[11, 0]}>
            <div style={{ ...SIGN, ...(n >= 6 ? HOT : null) }} title={`${n} waiting for a self-checkout (ops engine checkout log)`}>self-checkout · {n} in line</div>
          </Html>
        );
      })}
      {stickers.map((s) => (
        <Html key={s.id} position={[s.x, 2.1, s.z]} center zIndexRange={[12, 0]}>
          <div style={{ ...SIGN, background: '#FFE14D', transform: 'rotate(-3deg)' }} title="engine outcome: abandoned (patience ran out in the queue)">😤 {s.text}</div>
        </Html>
      ))}
    </group>
  );
}
/** number of sorted values ≤ t */
function upper(xs: number[], t: number) { let lo = 0, hi = xs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] <= t) lo = m + 1; else hi = m; } return lo; }
const SIGN: React.CSSProperties = {
  font: '800 12px "Baloo 2", system-ui', color: INK, background: '#fff', border: `2px solid ${INK}`, borderRadius: 999,
  padding: '1px 9px', boxShadow: `0 3px 0 ${INK}`, whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none',
};
const HOT: React.CSSProperties = { background: '#FF5A7A', color: '#fff' };
const UP = new THREE.Vector3(0, 1, 0);
const noRay = () => null;

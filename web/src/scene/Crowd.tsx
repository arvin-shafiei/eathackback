// The crowd: replayed shoppers as physics bodies (rapier) drawn with instanced cartoon parts.
// Decisions, products and order come ONLY from the run log (timelines/beats). Physics adds a visual offset:
// shoppers are dynamic capsules steered toward their replay position with separation (they never overlap, they
// spread across the walkway, they wait their turn at the door), they queue in real lines at the tills, and they
// shove, bonk and recover. Picks are physical: walk up to the facing, rubber-arm reach, the pack leaves the shelf
// (shelfBus.takeFromShelf), gets thrown and settles in the basket / trolley as a rigid body welded into the
// carrier's compound collider. Rejects get inspected and put back (shelfBus.restockShelf).
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useAfterPhysicsStep, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { Agent, Persona, Product, StoreConfig } from '../types';
import { isAI } from '../types';
import { BEAT, G, TILL, categoryHeight, sampleTimeline, storePlan, type CheckoutPlan, type Lane, type StorePlan, type Timeline } from '../layout';
import { archColor, archLabel, carrierFor, DECISION, BRAND_A, type Carrier } from '../theme';
import { archetypeOf } from '../stats';
import { productMaterials } from './textures';
import { accessoriesFor, aiKindOf, robotPartsFor, AI_KIND, type AiKind, PARTS, GEO, BODY, BASKET, TROLLEY, inkHull, trolleyGeometry, basketGeometry, bagGeometry, cupGeometry, type PartUse } from './parts';
import type { Beat, Beats } from './beats';
import { bus, sfx } from './fx';
import { CarrierLoad, GROUP, createCarrier, followCarrier, insideCarrier, setSolid, stackLocal, throwPack } from './Basket';
import { restockShelf, takeFromShelf } from './shelfBus';
import { crowdStats, emitCrowd } from './crowdBus';

export type ThoughtMode = 'off' | 'selected' | 'all';

interface Props {
  cfg: StoreConfig;
  agents: Agent[];
  timelines: Record<string, Timeline>;
  beats: Beats;
  timeRef: MutableRefObject<number>;
  personas: Record<string, Persona>;
  products: Record<string, Product>;
  selectedAgent: string | null;
  onAgent: (id: string) => void;
  onEvent: (agentId: string, step: number) => void;
  thoughts: ThoughtMode;
  speed: number;
}

interface XY { x: number; z: number }
/** a shopper's place in a checkout line: `group` is a staffed lane id or 'self' (one shared snake for the kiosks) */
interface QInfo { group: string; qStart: number; qStep: number }
interface QGroup { head: XY; dir: XY; side: XY; startOff: number; len: number; perCol: number; list: Shopper[] }

interface Shopper {
  si: number; agent: Agent; ai: boolean; aiKind: AiKind | null; arch: string; color: THREE.Color; carrier: Carrier; tl: Timeline; beats: Beat[];
  body: RigidBody | null; cbody: RigidBody | null; active: boolean; held: number; cbOn: boolean;
  knock: THREE.Vector2; sq: number; sqv: number; cool: number; step: number;
  /** smoothed arm rotations (shoulder frame) + rubber-arm stretch */
  qR: THREE.Quaternion; qL: THREE.Quaternion; strR: number; strL: number; look: THREE.Vector3;
  handR: THREE.Matrix4; handL: THREE.Matrix4;
  parts: PartUse[];
  pos: THREE.Vector3; yaw: number; px: number; pz: number;
  /** sideways offset (m) from the replay line while walking, so a crowd fills the walkway instead of one file */
  laneOff: number;
  q: QInfo | null; qT: XY | null; qFace: number;
  co: CheckoutPlan | null; park: THREE.Matrix4 | null; cafeT: [number, number] | null;
}

const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpM3 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** within a pick/reject dwell (fractions of the dwell): step up to the shelf, start reaching, step back */
const REACH = { approach: 0.14, reach0: 0.1, leave: 0.88 } as const;
/** how far from the pack's shelf point the shopper stands while reaching (m). assumption: visual only */
const REACH_D = { basket: 0.72, trolley: 0.8, none: 0.72 } as const;
const SPAWN_CLEAR = 1.05; // m: a door only lets the next shopper in once the last one has stepped clear
const SPAWN_MAX_HOLD = 6; // replay s: never hold anyone at the door longer than this

/** arm rotation that points the arm (rest = straight down) at `dir` in the body frame */
function aimQ(out: THREE.Quaternion, dir: THREE.Vector3) { return out.setFromUnitVectors(DOWN, dir.normalize()); }
/** classic pose: pitch θ about x, then roll φ about z (φ>0 = outward) */
function poseQ(out: THREE.Quaternion, side: 1 | -1, th: number, ph: number) { return out.setFromEuler(tmpE.set(th, 0, side * ph, 'ZXY')); }
function armMatrix(out: THREE.Matrix4, side: 1 | -1, q: THREE.Quaternion, stretch: number) {
  return out.compose(tmpV.set(side * BODY.shoulderX, BODY.shoulderY, 0.02), q, tmpS.set(1, stretch, 1));
}
const SHOULDER = (side: 1 | -1) => new THREE.Vector3(side * BODY.shoulderX, BODY.shoulderY, 0.02);

function carriedSize(code: string, products: Record<string, Product>) {
  const cat = products[code]?.category ?? '';
  return { w: 0.17, h: Math.max(0.1, categoryHeight(cat) * 0.5), d: 0.12 };
}

/** where the carrier is parked while its owner checks out: trolley behind them in the lane, basket on the counter / floor */
function parkMatrix(co: CheckoutPlan | null, c: Carrier): THREE.Matrix4 | null {
  if (!co || c === 'none') return null;
  const L = co.lane;
  if (c === 'trolley') return new THREE.Matrix4().compose(new THREE.Vector3(L.stand.x + L.queueDir.x * 1.05, 0, L.stand.z + L.queueDir.z * 1.05), new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-L.queueDir.x, -L.queueDir.z)), new THREE.Vector3(1, 1, 1));
  if (L.kind === 'staffed' && L.beltStart) return new THREE.Matrix4().compose(new THREE.Vector3(L.beltStart.x - 0.02, 0.96, L.beltStart.z - 0.12), new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2), new THREE.Vector3(1, 1, 1));
  return new THREE.Matrix4().compose(new THREE.Vector3(L.stand.x - 0.5, 0, L.stand.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
}

/** queue window from the scheduled timeline: from joining the line until the step-up to the till */
function queueInfo(tl: Timeline): QInfo | null {
  const co = tl.checkout; if (!co) return null;
  const qs = tl.segs.filter((x) => x.phase === 'queue');
  const moves = qs.filter((x) => x.kind === 'move');
  if (!moves.length) return null;
  const step = moves[moves.length - 1];
  // join the line once the walk over is (nearly) done: the last ~2.5 s of the approach, or the wait itself.
  // before that they follow the routed walk, so nobody cuts through the shelving toward their slot
  const hold = qs.find((x) => x.kind === 'phase');
  const approach = moves.length > 1 ? moves[moves.length - 2] : null;
  const qStart = hold ? Math.max(approach ? approach.t1 - 2.5 : hold.t0, hold.t0 - 2.5) : step.t0;
  if (step.t0 - qStart < 0.3) return null;
  return { group: co.lane.kind === 'self' ? 'self' : co.lane.id, qStart, qStep: step.t0 };
}

/** checkout lines: one straight line per staffed till, one shared snake for the self-checkout bank */
function queueGroups(sp: StorePlan): Map<string, QGroup> {
  const out = new Map<string, QGroup>();
  const mid = (sp.z0 + sp.z1) / 2;
  for (const L of sp.lanes) {
    if (L.kind !== 'staffed') continue;
    const n = Math.hypot(L.queueDir.x, L.queueDir.z) || 1;
    const dir = { x: L.queueDir.x / n, z: L.queueDir.z / n };
    out.set(L.id, { head: L.stand, dir, side: { x: -dir.z, z: dir.x }, startOff: 2.15, len: 0.92, perCol: 99, list: [] });
  }
  const self = sp.lanes.filter((l: Lane) => l.kind === 'self');
  if (self.length) {
    const minX = Math.min(...self.map((l) => l.x)), zs = self.map((l) => l.stand.z);
    const head = { x: minX - 0.95, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
    const dz = Math.sign(mid - head.z) || -1;
    out.set('self', { head, dir: { x: 0, z: dz }, side: { x: -1, z: 0 }, startOff: 0.6, len: 0.85, perCol: 7, list: [] });
  }
  return out;
}

/** string → [0,1) (seeded per shopper, stable across reloads) */
function hash01(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }

/**
 * De-trunk the walk. layout's router sends everyone heading the same way down the same walkway when they only pass
 * THROUGH a gondola block. For each plain transit leg (no phase, mostly along z) that crosses a whole block, pick a
 * per-shopper seeded parallel walkway within ±2 of the routed one and go round that way instead. Endpoints, dwells,
 * picks and timing are untouched (the leg keeps its t0..t1; we only skip detours that would need >1.5x the length).
 * assumption: visual only. Decisions and order still come from the run log.
 */
function spreadTimeline(tl: Timeline, sp: StorePlan, seed: string): Timeline {
  const blocks = new Map<number, { z0: number; z1: number; xs: number[] }>();
  for (const w of sp.walkways) { const b = blocks.get(w.block) ?? { z0: w.z0, z1: w.z1, xs: [] }; b.z0 = Math.min(b.z0, w.z0); b.z1 = Math.max(b.z1, w.z1); b.xs.push(w.x); blocks.set(w.block, b); }
  const bl = [...blocks.values()].map((b) => ({ ...b, xs: [...new Set(b.xs.map((x) => +x.toFixed(2)))].sort((a, c) => a - c) }));
  const out: typeof tl.segs = [];
  let changed = false;
  tl.segs.forEach((g, gi) => {
    const dz = g.b.z - g.a.z, dx = g.b.x - g.a.x, L = Math.hypot(dx, dz);
    if (g.kind !== 'move' || g.phase || L < 8 || Math.abs(dx) > 2.5 || g.t1 <= g.t0) { out.push(g); return; }
    const lo = Math.min(g.a.z, g.b.z), hi = Math.max(g.a.z, g.b.z);
    const B = bl.find((b) => lo <= b.z0 + 0.2 && hi >= b.z1 - 0.2 && b.xs.length > 1);
    if (!B) { out.push(g); return; }
    const x0 = (g.a.x + g.b.x) / 2;
    const near = B.xs.filter((x) => Math.abs(x - x0) < 2.6 * G.spacing);
    if (near.length < 2) { out.push(g); return; }
    const xp = near[Math.floor(hash01(`${seed}:${gi}`) * near.length)];
    if (Math.abs(xp - x0) < 0.5) { out.push(g); return; }
    const down = dz < 0;
    const zIn = down ? B.z1 + 1.1 : B.z0 - 1.1, zOut = down ? B.z0 - 1.1 : B.z1 + 1.1;
    const pts = [g.a, { x: g.a.x, z: zIn }, { x: xp, z: zIn }, { x: xp, z: zOut }, { x: g.b.x, z: zOut }, g.b]
      .filter((p, i, arr) => i === 0 || Math.hypot(p.x - arr[i - 1].x, p.z - arr[i - 1].z) > 0.05);
    let L2 = 0; for (let i = 1; i < pts.length; i++) L2 += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    if (L2 > L * 1.5) { out.push(g); return; }
    let t = g.t0, acc = 0;
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const t1 = i === pts.length - 1 ? g.t1 : g.t0 + (g.t1 - g.t0) * (acc / L2);
      out.push({ ...g, t0: t, t1, a: { x: pts[i - 1].x, z: pts[i - 1].z, walkway: null }, b: { x: pts[i].x, z: pts[i].z, walkway: null } });
      t = t1;
    }
    changed = true;
  });
  return changed ? { ...tl, segs: out } : tl;
}

/** café visit window handed to Cafe.tsx: from reaching the café entrance until back out of it.
 *  layout's café leg is: door → inside → counter → (hold cafe) → seat → (hold cafe) → 2 moves → door */
function cafeWindow(tl: Timeline): [number, number] | null {
  const i0 = tl.segs.findIndex((x) => x.phase === 'cafe');
  if (i0 < 0) return null;
  let i1 = i0; for (let i = i0; i < tl.segs.length; i++) if (tl.segs[i].phase === 'cafe') i1 = i;
  const start = i0 >= 3 ? tl.segs[i0 - 3].t1 : tl.segs[i0].t0;
  const end = tl.segs[Math.min(tl.segs.length - 1, i1 + 3)].t1;
  return end > start ? [start, end] : null;
}
const lerp3 = (a: THREE.Vector3, b: THREE.Vector3, k: number, lift = 0) => { const p = a.clone().lerp(b, k); p.y += Math.sin(Math.PI * k) * lift; return p; };

interface Flight { body: RigidBody; born: number }
interface Sticker { key: string; si: number; beat: Beat; x: number; z: number; near: boolean }
interface Bonk { id: number; x: number; y: number; z: number; word: string }
/** robots are a bit smaller than people so a 240-agent ai arm doesn't bury the humans */
const AI_SCALE = 0.8;
const BONK_WORDS = ['bonk!', 'oof!', 'boing!', 'sorry!', 'bump!', 'whoops!', 'mind out!', 'ope!'];
const CELL = 1.25;
/** headless bisect flags: ?crowddbg=nothrow,noload,nocarrier */
const DBG = (() => { try { return new URLSearchParams(location.search).get('crowddbg') ?? ''; } catch { return ''; } })();
const FAR = 4000; // where off-floor bodies wait (no collisions, far from everything)
const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + 2048) * 4096 + (Math.floor(z / CELL) + 2048);

export function Crowd({ cfg, agents, timelines, beats, timeRef, personas, products, selectedAgent, onAgent, onEvent, thoughts, speed }: Props) {
  const { world, rapier } = useRapier();
  const speedRef = useRef(speed); speedRef.current = speed;

  // ---------- shoppers (data) ----------
  const shoppers = useMemo<Shopper[]>(() => { const SP0 = storePlan(cfg); return agents.filter((a) => timelines[a.agent_id]).map((a, si) => {
    const ai = isAI(a);
    // ai shoppers are archetypes (persona_id / archetype), the model is only a detail
    const arch = ai ? (a.archetype ?? personas[a.persona_id]?.archetype ?? a.persona_id) : archetypeOf(a, personas);
    const aiKind: AiKind | null = ai ? aiKindOf(`${arch} ${a.persona_id}`) : null;
    const mission = a.mission ?? personas[a.persona_id]?.mission;
    const parts = aiKind ? robotPartsFor(aiKind) : accessoriesFor(arch);
    const carrier = carrierFor(arch, mission, ai);
    const tl = spreadTimeline(timelines[a.agent_id], SP0, a.agent_id);
    return {
      si, agent: a, ai, aiKind, arch, color: new THREE.Color(aiKind ? AI_KIND[aiKind].body : archColor(arch)), carrier, tl, beats: beats.byAgent[a.agent_id] ?? [],
      body: null, cbody: null, active: false, held: 0, cbOn: false, knock: new THREE.Vector2(), sq: 0, sqv: 0, cool: 0, step: Math.random() * 6,
      qR: poseQ(new THREE.Quaternion(), 1, 0, 0.12), qL: poseQ(new THREE.Quaternion(), -1, 0, 0.12), strR: 1, strL: 1,
      look: new THREE.Vector3(0, 0, 1), handR: new THREE.Matrix4(), handL: new THREE.Matrix4(),
      parts, pos: new THREE.Vector3(0, -50, 0), yaw: 0, px: 0, pz: -999,
      // golden-ratio spread so neighbours in the run get different walking lines (± ~0.5 m)
      // keep left (UK) by direction of travel + a per-shopper golden-ratio spread so a crowd fills the walkway
      // width (0.25..1.15 m left of the routed line; trolleys a bit tighter). negative = left of travel
      laneOff: -(0.25 + ((si * 0.6180339) % 1) * 0.9) * (carrier === 'trolley' ? 0.8 : ai ? 0.6 : 1),
      q: queueInfo(tl), qT: null, qFace: 0,
      co: tl.checkout ?? null, park: parkMatrix(tl.checkout ?? null, carrier), cafeT: cafeWindow(tl),
    };
  }); }, [cfg, agents, timelines, personas, beats]);

  useEffect(() => {
    // headless debug: where everyone is, what they're doing (no stat reads this)
    const w = window as unknown as { __crowd?: Record<string, unknown> };
    if (!w.__crowd) return;
    w.__crowd.tl = (id: string) => shoppers.find((s) => s.agent.agent_id === id)?.tl.segs.map((g) => [+g.t0.toFixed(1), g.kind, g.phase ?? '', +g.a.x.toFixed(1), +g.a.z.toFixed(1), +g.b.x.toFixed(1), +g.b.z.toFixed(1), g.a.walkway ?? '', g.b.walkway ?? '']);
    w.__crowd.plan = () => { const sp = storePlan(cfg); return { entrances: sp.entrances, exits: sp.exits, walkways: sp.walkways.map((x) => [x.id, x.aisleNo, x.x, x.z0, x.z1, x.dept]) }; };
    w.__crowd.dump = () => {
      const sp = storePlan(cfg);
      return { bounds: sp.bounds, lanes: sp.lanes.map((l) => ({ id: l.id, kind: l.kind, x: +l.x.toFixed(1), z: +l.z.toFixed(1) })), people: shoppers.filter((s) => s.active).map((s) => ({ id: s.agent.agent_id, x: +s.px.toFixed(2), z: +s.pz.toFixed(2), q: s.q?.group ?? null, inQ: !!s.qT, c: s.carrier, ph: sampleTimeline(s.tl, timeRef.current).seg?.phase ?? sampleTimeline(s.tl, timeRef.current).seg?.kind })) };
    };
  }, [cfg, shoppers, timeRef]);

  const groups = useMemo(() => {
    const g = queueGroups(storePlan(cfg));
    for (const s of shoppers) if (s.q) g.get(s.q.group)?.list.push(s);
    for (const x of g.values()) x.list.sort((a, b) => a.q!.qStep - b.q!.qStep);
    return g;
  }, [cfg, shoppers]);

  // ---------- physics bodies ----------
  const colliderOwner = useRef(new Map<number, number>());
  const load = useRef<CarrierLoad | null>(null);
  useEffect(() => {
    const R = rapier;
    const owner = colliderOwner.current; owner.clear();
    const made: RigidBody[] = [];
    load.current = new CarrierLoad(world, R);
    for (const s of shoppers) {
      const bd = R.RigidBodyDesc.dynamic().setTranslation(FAR + s.si * 6, BODY.center, FAR).setGravityScale(0).setLinearDamping(0.5).setAngularDamping(4).setCanSleep(false);
      const body = world.createRigidBody(bd);
      body.setEnabledTranslations(true, false, true, false);
      body.setEnabledRotations(false, true, false, false);
      const col = world.createCollider(
        (s.ai ? R.ColliderDesc.cuboid(0.31 * AI_SCALE, 0.46 * AI_SCALE, 0.25 * AI_SCALE) : R.ColliderDesc.capsule(0.3, BODY.r)).setDensity(220).setFriction(0.1).setRestitution(0.4).setCollisionGroups(0),
        body,
      );
      owner.set(col.handle, s.si);
      s.body = body; made.push(body);
      s.cbody = DBG.includes('nocarrier') ? null : createCarrier(world, R, body, s.carrier, BODY.center, (c) => owner.set(c.handle, s.si));
      if (s.cbody) made.push(s.cbody);
      placeAt(s, FAR + s.si * 6, FAR, 0); // carrier starts welded in place, not yanked across the map
    }
    return () => {
      load.current?.clear(); load.current = null;
      for (const b of made) { try { world.removeRigidBody(b); } catch { /* world already gone */ } }
      for (const s of shoppers) { s.body = null; s.cbody = null; s.active = false; s.cbOn = false; }
      owner.clear();
    };
  }, [shoppers, world, rapier]);

  // ---------- flights (picked packs in the air), baked carrier contents, packs off the shelf ----------
  const flights = useRef(new Map<number, Flight>());
  const baked = useRef(new Map<number, THREE.Matrix4>());
  /** beats whose pack is currently off the shelf (taken via shelfBus): beat id → where it was taken from */
  const taken = useRef(new Map<number, { beat: Beat; at: THREE.Vector3 | null }>());
  const lastT = useRef(0);
  const scrubbed = useRef(false);
  useEffect(() => () => {
    for (const f of flights.current.values()) { try { world.removeRigidBody(f.body); } catch { /* gone */ } }
    flights.current.clear(); baked.current.clear();
    for (const { beat } of taken.current.values()) if (beat.kind === 'reject') restockShelf(beat.shelfSlot, beat.code, 1);
    taken.current.clear();
  }, [shoppers, world]);
  const bake = (s: Shopper, b: Beat, local: THREE.Matrix4, size: { w: number; h: number; d: number }) => {
    baked.current.set(b.id, local);
    if (s.cbody && s.cbOn && !DBG.includes('noload')) load.current?.add(s.cbody, b.id, local, size);
  };
  const unbake = (id: number) => { baked.current.delete(id); load.current?.remove(id); };

  const placeAt = (s: Shopper, x: number, z: number, yaw: number) => {
    if (!s.body) return;
    s.body.setTranslation({ x, y: BODY.center, z }, false);
    tmpQ.setFromAxisAngle(UP, yaw);
    s.body.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, false);
    s.body.setLinvel({ x: 0, y: 0, z: 0 }, false); s.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    if (s.cbody) {
      const a = s.carrier === 'trolley' ? TROLLEY.anchor : BASKET.anchor;
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      s.cbody.setTranslation({ x: x + a[0] * c + a[2] * sn, y: BODY.center + a[1], z: z - a[0] * sn + a[2] * c }, false);
      s.cbody.setRotation({ x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w }, false);
      s.cbody.setLinvel({ x: 0, y: 0, z: 0 }, false); s.cbody.setAngvel({ x: 0, y: 0, z: 0 }, false);
    }
    s.px = x; s.pz = z;
    s.knock.set(0, 0);
  };

  /** carrier collisions on/off (parked at a till = ghost: drawn from the park matrix, collides with nothing) */
  const setCarrierSolid = (s: Shopper, on: boolean) => { s.cbOn = on && !!s.cbody; setSolid(s.cbody, on ? GROUP.carrier : null); if (on) load.current?.reghost(s.cbody); };
  /** off the floor: no collisions, parked far away (no rapier setEnabled toggling) */
  const ghost = (s: Shopper) => {
    setSolid(s.body, null); setCarrierSolid(s, false);
    placeAt(s, FAR + s.si * 6, FAR, 0);
  };
  const beatOfShopper = (s: Shopper, t: number): Beat | null => {
    for (const b of s.beats) { if (t >= b.t0 && t < b.t1) return b; if (b.t0 > t) break; }
    return null;
  };

  // ---------- steering: before every physics step ----------
  const grid = useRef(new Map<number, number[]>());
  const lastStepT = useRef(0);
  const near = (x: number, z: number, r: number, skip: number, fn: (o: Shopper, dx: number, dz: number, d: number) => void) => {
    const g = grid.current;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const list = g.get((ix + 2048) * 4096 + (iz + 2048)); if (!list) continue;
      for (const oi of list) {
        if (oi === skip) continue;
        const o = shoppers[oi];
        const dx = x - o.px, dz = z - o.pz, d = Math.hypot(dx, dz);
        if (d < r) fn(o, dx, dz, d);
      }
    }
  };
  const assignQueues = (t: number) => {
    for (const [, g] of groups) {
      let off = g.startOff, idx = 0;
      for (const s of g.list) {
        const q = s.q!;
        if (!s.active || t < q.qStart || t >= q.qStep) { s.qT = null; continue; }
        const own = s.carrier === 'trolley' ? 1.15 : 0; // your trolley goes in front of you
        // snake: perCol people per column, then fold back one column over
        const col = Math.floor(idx / g.perCol), k = idx % g.perCol;
        const along = g.perCol < 99 ? g.startOff + (col % 2 ? g.perCol - 1 - k : k) * g.len + own : off + own;
        s.qT = { x: g.head.x + g.dir.x * along + g.side.x * col * 0.95, z: g.head.z + g.dir.z * along + g.side.z * col * 0.95 };
        s.qFace = Math.atan2(-g.dir.x, -g.dir.z);
        off += g.len + own; idx++;
      }
    }
  };

  useBeforePhysicsStep((w: World) => {
    const t = timeRef.current, sp = speedRef.current;
    const dt = w.timestep;
    const scrub = scrubbed.current;
    // neighbour grid from where everyone is right now
    const g = grid.current; g.clear();
    for (const s of shoppers) {
      if (!s.active || !s.body) continue;
      const p = s.body.translation(); s.px = p.x; s.pz = p.z;
      const k = cellKey(p.x, p.z); const l = g.get(k); if (l) l.push(s.si); else g.set(k, [s.si]);
    }
    assignQueues(t);
    for (const s of shoppers) {
      if (!s.body) continue;
      const smp = sampleTimeline(s.tl, t);
      const inCafe = !!s.cafeT && t >= s.cafeT[0] && t < s.cafeT[1];
      if (s.cafeT && !scrub) {
        const c = s.cafeT, prevT = lastStepT.current;
        if (prevT < c[0] && t >= c[0]) emitCrowd({ type: 'cafe_enter', shopperId: s.agent.agent_id, agentId: s.agent.agent_id, t, tEnd: c[1], seat: s.tl.cafeSeat ?? null, x: smp.x, z: smp.z, color: '#' + s.color.getHexString(), arch: s.arch });
        if (prevT < c[1] && t >= c[1]) emitCrowd({ type: 'cafe_leave', shopperId: s.agent.agent_id, agentId: s.agent.agent_id, t, x: smp.x, z: smp.z });
      }
      if (!smp.visible || inCafe) {
        if (s.active) { s.active = false; ghost(s); s.pos.set(0, -50, 0); s.px = 0; s.pz = -999; }
        s.held = 0;
        continue;
      }
      const parked = !!(s.co && s.park && t >= s.co.tArrive);
      if (!s.active) {
        // door spacing: wait outside until whoever came in last has stepped clear, then walk in and catch up
        const sp0 = s.tl.segs[0]?.a;
        const early = !!sp0 && !scrub && t - s.tl.start < SPAWN_MAX_HOLD + 2;
        let blocked = false;
        if (early) near(sp0!.x, sp0!.z, SPAWN_CLEAR, s.si, () => { blocked = true; });
        if (blocked && t - s.tl.start < SPAWN_MAX_HOLD) { s.held = t; continue; }
        s.active = true; setSolid(s.body, GROUP.shopper); setCarrierSolid(s, !parked);
        if (early) placeAt(s, sp0!.x + (blocked ? s.laneOff * 1.6 : 0), sp0!.z, smp.heading);
        else placeAt(s, smp.x, smp.z, smp.heading);
        const k = cellKey(s.px, s.pz); const l = g.get(k); if (l) l.push(s.si); else g.set(k, [s.si]);
        if (early) emitCrowd({ type: 'enter', agentId: s.agent.agent_id, door: s.si % Math.max(1, storePlan(cfg).entrances.length), t });
        continue;
      }
      if (s.cbody) {
        if (parked && s.cbOn) setCarrierSolid(s, false);
        else if (!parked && !s.cbOn) { setCarrierSolid(s, true); placeAt(s, smp.x, smp.z, smp.heading); continue; }
      }
      const p = s.body.translation();
      const seg = smp.seg;
      const walk = (s.ai ? G.aiWalkSpeed : G.walkSpeed) * sp;
      let tx = smp.x, tz = smp.z, want = smp.heading, fx = 0, fz = 0;
      let busy = seg?.kind !== 'move';
      if (s.qT && Math.hypot(s.qT.x - smp.x, s.qT.z - smp.z) < 8) {
        // in a checkout line: hold your place, face the till
        tx = s.qT.x; tz = s.qT.z; want = s.qFace; busy = true;
      } else {
        if (seg?.kind === 'move' && seg.t1 > seg.t0) {
          const k = sp / (seg.t1 - seg.t0); fx = (seg.b.x - seg.a.x) * k; fz = (seg.b.z - seg.a.z) * k;
          // walk your own line: sideways offset, tapered to zero at both ends of the segment
          if (s.laneOff && (!seg.phase || seg.phase === 'exit') && !inCafe) {
            const sx = seg.b.x - seg.a.x, sz = seg.b.z - seg.a.z, L = Math.hypot(sx, sz);
            if (L > 0.5) {
              const da = Math.hypot(tx - seg.a.x, tz - seg.a.z), db = Math.hypot(seg.b.x - tx, seg.b.z - tz);
              const taper = Math.min(1, da / 1.6, db / 1.6);
              tx += (-sz / L) * s.laneOff * taper; tz += (sx / L) * s.laneOff * taper;
            }
          }
        }
        // step up to the exact facing for a pick / reject, then step back
        const b = !s.ai ? beatOfShopper(s, t) : null;
        if (b && b.shelf && (b.kind === 'pick' || b.kind === 'reject')) {
          const u = (t - b.t0) / Math.max(1e-3, b.t1 - b.t0);
          const k = ease(u / REACH.approach) * ease((1 - u) / (1 - REACH.leave));
          const nx = b.shelf.x - smp.x, nz = b.shelf.z - smp.z, nd = Math.hypot(nx, nz);
          const go = Math.max(0, nd - REACH_D[s.carrier]) * k;
          if (nd > 1e-3) { tx += (nx / nd) * go; tz += (nz / nd) * go; }
        }
        // trolley pushers park the trolley along the aisle at a shelf and reach sideways
        if (seg?.kind === 'dwell' && s.carrier === 'trolley' && !parked) want = smp.heading + angDiff(smp.heading, 0) * (b && (b.kind === 'pick' || b.kind === 'reject') ? 1 : 0.6);
      }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      if (scrub || d > 14) { placeAt(s, tx, tz, want); continue; }
      // separation from neighbours (+ a polite sidestep when someone is in front of you)
      const R0 = s.ai ? 0.62 : s.carrier === 'trolley' ? 1.0 : 0.82;
      let sx = 0, sz = 0;
      const fm = Math.hypot(fx, fz) || 1;
      near(p.x, p.z, R0, s.si, (_o, ddx, ddz, dd) => {
        if (dd < 1e-4) { ddx = Math.sin(s.si); ddz = Math.cos(s.si); dd = 1; }
        // soft personal space + a hard push once bodies would touch (setLinvel would otherwise win over contacts)
        const wgt = (R0 - dd) / R0 + Math.max(0, 0.66 - dd) * 6;
        sx += (ddx / dd) * wgt; sz += (ddz / dd) * wgt;
        if (!busy && (-(ddx * fx + ddz * fz) / (dd * fm)) > 0.5) { sx += (-fz / fm) * wgt * 0.8; sz += (fx / fm) * wgt * 0.8; }
      });
      // kinematic trolleys don't shove anyone, so keep clear of other people's trolleys (and my trolley of theirs)
      near(p.x, p.z, 2.2, s.si, (o) => {
        if (o.carrier !== 'trolley' || !o.cbOn || !o.cbody) return;
        const c = o.cbody.translation();
        const ex = p.x - c.x, ez = p.z - c.z, ed = Math.hypot(ex, ez) || 1e-3;
        if (ed < 0.95) { const wgt = (0.95 - ed) * 4; sx += (ex / ed) * wgt; sz += (ez / ed) * wgt; }
      });
      const sepGain = busy ? 0.9 : 2.2;
      const gain = 3.2;
      let vx = fx + dx * gain + s.knock.x + sx * sepGain, vz = fz + dz * gain + s.knock.y + sz * sepGain;
      const vmax = walk * 1.7 + 1.4, vm = Math.hypot(vx, vz);
      if (vm > vmax) { vx *= vmax / vm; vz *= vmax / vm; }
      if (!Number.isFinite(vx) || !Number.isFinite(vz)) { vx = 0; vz = 0; }
      s.body.setLinvel({ x: vx, y: 0, z: vz }, true);
      if (s.cbody && s.cbOn) followCarrier(s.cbody, s.body, s.carrier === 'trolley' ? TROLLEY.anchor : BASKET.anchor, BODY.center);
      s.knock.multiplyScalar(Math.exp(-dt / 0.28));
      const r = s.body.rotation();
      const yaw = 2 * Math.atan2(r.y, r.w);
      const err = angDiff(yaw, want);
      s.body.setAngvel({ x: 0, y: Math.max(-9, Math.min(9, err * 7)), z: 0 }, true);
    }
    scrubbed.current = false;
    lastStepT.current = t;
  });

  // ---------- bonks: after each step, look at contacts between different shoppers ----------
  const [bonks, setBonks] = useState<Bonk[]>([]);
  const bonkId = useRef(0);
  useAfterPhysicsStep((w: World) => {
    const owner = colliderOwner.current;
    const now = performance.now() / 1000;
    let fresh: Bonk[] | null = null;
    // collect candidate pairs first: rapier forbids calling back into the world from inside contactPairsWith
    const cand: [Collider, Collider, number, number][] = [];
    for (const s of shoppers) {
      if (!s.active || !s.body || s.cool > now) continue;
      const nc = s.body.numColliders();
      for (let ci = 0; ci < nc; ci++) {
        const col: Collider = s.body.collider(ci);
        w.contactPairsWith(col, (other) => {
          const oi = owner.get(other.handle);
          if (oi === undefined || oi <= s.si) return; // each pair once
          cand.push([col, other, s.si, oi]);
        });
      }
    }
    for (const [col, other, si, oi] of cand) {
      const s = shoppers[si], o = shoppers[oi];
      if (s.cool > now || !o?.active || !o.body || !s.body || o.cool > now) continue;
      let touching = false;
      w.contactPair(col, other, (m) => { if (m.numContacts() > 0) touching = true; });
      if (!touching) continue;
      const a = s.body.translation(), b = o.body.translation();
      let nx = a.x - b.x, nz = a.z - b.z; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const va = s.body.linvel(), vb = o.body.linvel();
      const closing = -((va.x - vb.x) * nx + (va.z - vb.z) * nz);
      if (closing < 0.6) continue; // only real collisions bonk, not the polite shuffle of a crowd
      const kick = Math.min(3.4, 1.5 + closing * 0.7);
      s.knock.x += nx * kick; s.knock.y += nz * kick; o.knock.x -= nx * kick; o.knock.y -= nz * kick;
      s.sqv -= 3.4; o.sqv -= 3.4;
      s.cool = o.cool = now + 1.1;
      bus.bonks++; bus.shake = Math.min(1, bus.shake + 0.35);
      sfx.bonk();
      emitCrowd({ type: 'bonk', a: s.agent.agent_id, b: o.agent.agent_id, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
      (fresh ??= []).push({ id: bonkId.current++, x: (a.x + b.x) / 2, y: 1.7, z: (a.z + b.z) / 2, word: BONK_WORDS[(s.si + o.si + bonkId.current) % BONK_WORDS.length] });
    }
    if (fresh) { const add = fresh; setBonks((cur) => [...cur.slice(-5), ...add]); }
  });
  useEffect(() => {
    if (!bonks.length) return;
    const id = setTimeout(() => setBonks((cur) => cur.slice(1)), 900);
    return () => clearTimeout(id);
  }, [bonks]);

  // ---------- instanced meshes ----------
  const meshes = useMemo(() => {
    const humans = shoppers.filter((s) => !s.ai), robots = shoppers.filter((s) => s.ai);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], n: number, shadow = false) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      m.count = n; m.frustumCulled = false; m.castShadow = shadow;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) m.setMatrixAt(i, ZERO);
      return m;
    };
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.02 });
    const robotMat = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.2 });
    const beanGeo = GEO.bean(), robotGeo = GEO.robot(), eyeGeo = GEO.eyeWhite(), armGeo = GEO.arm();
    const bean = mk(beanGeo, bodyMat, humans.length, true);
    const beanInk = mk(beanGeo, inkHull(0.028), humans.length);
    const robot = mk(robotGeo, robotMat, robots.length, true);
    const robotInk = mk(robotGeo, inkHull(0.028), robots.length);
    const eye = mk(eyeGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2 }), humans.length * 2);
    const eyeInk = mk(eyeGeo, inkHull(0.016), humans.length * 2);
    const pupil = mk(GEO.pupil(), new THREE.MeshBasicMaterial({ color: '#141014' }), humans.length * 2);
    const arm = mk(armGeo, new THREE.MeshStandardMaterial({ roughness: 0.4 }), shoppers.length * 2);
    const armInk = mk(armGeo, inkHull(0.018), shoppers.length * 2);
    const foot = mk(GEO.foot(), new THREE.MeshStandardMaterial({ color: '#141014', roughness: 0.5 }), humans.length * 2);
    const blob = mk(GEO.blob(), new THREE.MeshBasicMaterial({ color: '#7a3550', transparent: true, opacity: 0.18, depthWrite: false }), shoppers.length);
    const trolleys = shoppers.filter((s) => s.carrier === 'trolley'), baskets = shoppers.filter((s) => s.carrier === 'basket');
    const trolley = mk(trolleyGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25 }), trolleys.length, true);
    const basket = mk(basketGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), baskets.length, true);
    // per-shopper slot indices
    const beanIdx = new Map<number, number>(), robotIdx = new Map<number, number>(), trolleyIdx = new Map<number, number>(), basketIdx = new Map<number, number>();
    humans.forEach((s, i) => { beanIdx.set(s.si, i); bean.setColorAt(i, s.color); arm.setColorAt(s.si * 2, s.color.clone().multiplyScalar(0.82)); arm.setColorAt(s.si * 2 + 1, s.color.clone().multiplyScalar(0.82)); });
    robots.forEach((s, i) => { robotIdx.set(s.si, i); const k = AI_KIND[s.aiKind ?? 'general']; robot.setColorAt(i, s.color); arm.setColorAt(s.si * 2, new THREE.Color(k.arm)); arm.setColorAt(s.si * 2 + 1, new THREE.Color(k.arm)); });
    if (!shoppers.length) { arm.setColorAt(0, new THREE.Color('#fff')); }
    if (!humans.length) bean.setColorAt(0, new THREE.Color('#fff'));
    if (!robots.length) robot.setColorAt(0, new THREE.Color('#fff'));
    trolleys.forEach((s, i) => trolleyIdx.set(s.si, i));
    baskets.forEach((s, i) => basketIdx.set(s.si, i));
    // accessories
    const partCount: Record<string, number> = {};
    const partIdx = new Map<number, number[]>();
    for (const s of shoppers) partIdx.set(s.si, s.parts.map((p) => (partCount[p.key] = (partCount[p.key] ?? 0) + 1) - 1));
    const parts: Record<string, THREE.InstancedMesh> = {};
    for (const [k, n] of Object.entries(partCount)) parts[k] = mk(PARTS[k].geom(), PARTS[k].mat(), n);
    // carried packs: one instanced mesh per product code, one instance per pick/reject beat
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const byCode: Record<string, Beat[]> = {};
    for (const s of shoppers) for (const b of s.beats) if ((b.kind === 'pick' || b.kind === 'reject') && b.code && products[b.code]) (byCode[b.code] ??= []).push(b);
    const carried: Record<string, { mesh: THREE.InstancedMesh; beats: Beat[]; size: { w: number; h: number; d: number } }> = {};
    for (const [code, list] of Object.entries(byCode)) carried[code] = { mesh: mk(unit, productMaterials(products[code]), list.length, true), beats: list, size: carriedSize(code, products) };
    const bag = mk(bagGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), shoppers.length, true);
    const cup = mk(cupGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), shoppers.length);
    const beamCore = mk(new THREE.CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#7CFFCB', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), robots.length);
    const beamGlow = mk(new THREE.ConeGeometry(0.16, 1, 12, 1, true).rotateX(Math.PI).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#7CFFCB', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), robots.length);
    for (const m of [bean, robot, arm]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const group = new THREE.Group();
    group.add(beanInk, robotInk, eye, eyeInk, pupil, arm, armInk, foot, blob, trolley, basket, bag, cup, beamCore, beamGlow, ...Object.values(parts), ...Object.values(carried).map((c) => c.mesh));
    return { group, bean, beanInk, robot, robotInk, eye, eyeInk, pupil, arm, armInk, foot, blob, trolley, basket, bag, cup, beamCore, beamGlow, parts, partIdx, beanIdx, robotIdx, trolleyIdx, basketIdx, carried, beanList: humans, robotList: robots };
  }, [shoppers, products]);
  useEffect(() => () => {
    meshes.group.traverse((o) => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh) { m.geometry.dispose(); if (!Array.isArray(m.material) && !(m.material as THREE.MeshStandardMaterial).map) m.material.dispose(); } });
  }, [meshes]);

  // ---------- per frame: read physics, animate, write instance matrices ----------
  const rootM = useRef(Array.from({ length: 0 }, () => new THREE.Matrix4()));
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const lastSticker = useRef({ t: 0, key: '' });
  const selRing = useRef<THREE.Mesh>(null);
  const byAgent = useMemo(() => new Map(shoppers.map((s) => [s.agent.agent_id, s])), [shoppers]);
  /** which arm grabs: baskets hang on the left so the right hand grabs; trolley pushers reach with the shelf-side arm */
  const grabSide = (s: Shopper, b: Beat): 1 | -1 => {
    if (s.carrier !== 'trolley' || !b.shelf) return 1;
    const lx = Math.cos(s.yaw) * (b.shelf.x - s.pos.x) - Math.sin(s.yaw) * (b.shelf.z - s.pos.z);
    return lx >= 0 ? 1 : -1;
  };

  useFrame((state, rdt) => {
    const t = timeRef.current;
    const now = state.clock.elapsedTime;
    const dt = Math.min(rdt, 0.05);
    const prev = lastT.current;
    const jump = Math.abs(t - prev) > Math.max(1.2, speedRef.current * 0.25);
    if (jump) scrubbed.current = true;
    lastT.current = t;
    const crossed = (x: number) => !jump && prev < x && t >= x;
    // a scrub puts back anything that, at the new time, hasn't been taken yet (or was already put back)
    if (jump) for (const [id, { beat }] of taken.current) {
      if (t < beat.tGrab || (beat.kind === 'reject' && t >= beat.tBack)) { restockShelf(beat.shelfSlot, beat.code, 1); taken.current.delete(id); }
    }
    const M = meshes;
    if (rootM.current.length !== shoppers.length) rootM.current = shoppers.map(() => new THREE.Matrix4());
    const SP = storePlan(cfg);
    const doorPts = [...SP.entrances, ...SP.exits];
    const doors = doorPts.map(() => 0);

    for (const s of shoppers) {
      const R = rootM.current[s.si];
      const bi = s.ai ? M.robotIdx.get(s.si)! : M.beanIdx.get(s.si)!;
      const hide = () => {
        (s.ai ? M.robot : M.bean).setMatrixAt(bi, ZERO); (s.ai ? M.robotInk : M.beanInk).setMatrixAt(bi, ZERO);
        for (let k = 0; k < 2; k++) { M.arm.setMatrixAt(s.si * 2 + k, ZERO); M.armInk.setMatrixAt(s.si * 2 + k, ZERO); if (!s.ai) { M.eye.setMatrixAt(bi * 2 + k, ZERO); M.eyeInk.setMatrixAt(bi * 2 + k, ZERO); M.pupil.setMatrixAt(bi * 2 + k, ZERO); M.foot.setMatrixAt(bi * 2 + k, ZERO); } }
        M.blob.setMatrixAt(s.si, ZERO); M.bag.setMatrixAt(s.si, ZERO); M.cup.setMatrixAt(s.si, ZERO);
        const pi = M.partIdx.get(s.si)!; s.parts.forEach((p, k) => M.parts[p.key].setMatrixAt(pi[k], ZERO));
        if (s.carrier === 'trolley') M.trolley.setMatrixAt(M.trolleyIdx.get(s.si)!, ZERO);
        if (s.carrier === 'basket') M.basket.setMatrixAt(M.basketIdx.get(s.si)!, ZERO);
        if (s.ai) { M.beamCore.setMatrixAt(M.robotIdx.get(s.si)!, ZERO); M.beamGlow.setMatrixAt(M.robotIdx.get(s.si)!, ZERO); }
      };
      if (!s.active || !s.body) { hide(); continue; }
      const p = s.body.translation(), r = s.body.rotation(), v = s.body.linvel();
      const yaw = 2 * Math.atan2(r.y, r.w);
      s.pos.set(p.x, 0, p.z); s.yaw = yaw;
      for (let di = 0; di < doorPts.length; di++) if (Math.abs(p.x - doorPts[di].x) < 2.4 && Math.abs(p.z - doorPts[di].z) < 3.2) doors[di]++;
      const spd = Math.hypot(v.x, v.z);
      const moving = spd > 0.25;
      s.step += dt * (4 + spd * 5.5) * (moving ? 1 : 0.25);
      // squash spring
      s.sqv += (-140 * s.sq - 10 * s.sqv) * dt; s.sq += s.sqv * dt;
      const b = beatOfShopper(s, t);
      const D = b ? b.t1 - b.t0 : 1, u = b ? (t - b.t0) / D : 0;
      let hop = 0, wiggle = 0, roll = 0, lean = 0;
      let thR = moving ? Math.sin(s.step) * 0.55 : Math.sin(now * 1.6 + s.si) * 0.05, phR = 0.14;
      let thL = moving ? -Math.sin(s.step) * 0.55 : -Math.sin(now * 1.6 + s.si) * 0.05, phL = 0.14;
      if (s.carrier === 'trolley') { thR = thL = -1.3; phR = phL = -0.12; }
      if (s.carrier === 'basket') { thL = 0.02; phL = 0.32; }
      if (s.arch === 'novelty_seeker_tiktok') { thR = -2.15; phR = 0.42; }
      // waddle: side-to-side roll + bounce (a bigger waddle with a heavy trolley)
      if (moving) { roll = Math.sin(s.step) * (s.carrier === 'trolley' ? 0.14 : 0.11); hop = Math.abs(Math.sin(s.step)) * 0.05; } else hop = (Math.sin(now * 2.2 + s.si) * 0.5 + 0.5) * 0.02;
      if (s.ai) { hop = 0.06 + Math.sin(now * 3 + s.si) * 0.04; roll *= 0.3; }
      // rubber-arm reach: weight + world target for the grabbing arm
      let ik = 0; let ikAt: { x: number; y: number; z: number } | null = null;
      const gs = b ? grabSide(s, b) : 1;
      // look target
      let lookW: THREE.Vector3 | null = null;
      if (b?.shelf && b.kind !== 'ignore') lookW = tmpV2.set(b.shelf.x, b.shelf.y, b.shelf.z);
      if (b && !s.ai) {
        const reach = clamp01((u - REACH.reach0) / (BEAT.grab - REACH.reach0));
        if (b.kind === 'pick') {
          const g0 = BEAT.grab, l0 = BEAT.launch;
          if (u < g0) { ik = ease(reach); ikAt = b.shelf; lean = 0.18 * ik; }
          else if (u < l0) { const k = ease((u - g0) / (l0 - g0)); ik = 1 - k; ikAt = b.shelf; thR = -1.3; phR = 0.05; lean = 0.18 * (1 - k); if (gs < 0) { thL = -1.3; phL = 0.05; } lookW = null; }
          else if (u < 0.92) { const k = (u - l0 - 0.04) / (0.9 - l0 - 0.04); hop = Math.max(hop, Math.sin(Math.PI * clamp01(k)) * 0.42); thR = -2.8; phR = 0.5; if (s.carrier !== 'basket') { thL = -2.8; phL = 0.5; } }
        } else if (b.kind === 'reject') {
          const back = taken.current.get(b.id)?.at ?? b.shelf;
          if (u < BEAT.grab) { ik = ease(reach); ikAt = b.shelf; lean = 0.18 * ik; }
          else if (u < BEAT.putBack) {
            const k = clamp01((u - BEAT.grab) / 0.08); ik = 1 - ease(k); ikAt = b.shelf;
            thR = -1.95; phR = -0.38; if (gs < 0) { thL = -1.95; phL = -0.38; }
            wiggle = Math.sin(now * 17) * 0.38 * Math.sin(Math.PI * clamp01((u - BEAT.grab) / (BEAT.putBack - BEAT.grab))); if (b.shelf) lookW = null;
          } else if (u < BEAT.backOnShelf) { ik = ease(clamp01((u - BEAT.putBack) / ((BEAT.backOnShelf - BEAT.putBack) * 0.8))); ikAt = back; lean = 0.15 * ik; }
          else { const k = Math.sin(Math.PI * clamp01((u - BEAT.backOnShelf) / (1 - BEAT.backOnShelf))); thR = -0.4 - k * 0.3; phR = 0.4 + k * 0.9; if (s.carrier !== 'basket') { thL = -0.4 - k * 0.3; phL = 0.4 + k * 0.9; } hop = Math.max(hop, k * 0.06); }
        } else if (b.kind === 'glance') {
          lean = Math.sin(Math.PI * clamp01(u)) * 0.12;
        }
      }
      // checkout + café choreography (phases come from the scheduled timeline, not the run log)
      const seatLift = 0, sipping = false; // café visits are drawn by Cafe.tsx (shopper hidden meanwhile)
      const co = s.co;
      if (co && !s.ai) {
        if (crossed(co.tBag)) emitCrowd({ type: 'bag', agentId: s.agent.agent_id, lane: co.lane.id, t });
        if (crossed(co.tPay)) { emitCrowd({ type: 'pay', agentId: s.agent.agent_id, lane: co.lane.id, t }); sfx.ding(); }
        if (t >= co.tArrive && t < co.tBag) {
          // reach toward the belt / scanner on every item
          const ph = co.lane.kind === 'staffed' ? ((t - co.tUnload0) / TILL.unloadPer) : ((t - co.tArrive) / TILL.selfScanPer);
          const unloading = co.lane.kind === 'staffed' ? t < co.tUnload0 + co.items * TILL.unloadPer + 0.3 : true;
          if (unloading) { const k = Math.abs(Math.sin(ph * Math.PI)); thR = -0.9 - k * 0.7; phR = 0.05; if (s.carrier !== 'basket' || co.lane.kind === 'staffed') { thL = -0.9 - (1 - k) * 0.7; phL = 0.05; } }
          else { thR = Math.sin(now * 2) * 0.1; thL = -thR; phR = phL = 0.2; } // tapping a foot while the cashier scans
        } else if (t >= co.tBag && t < co.tPay) { const k = Math.abs(Math.sin((t - co.tBag) * 6)); thR = -1.1 - k * 0.4; thL = -1.1 - (1 - k) * 0.4; phR = phL = 0; }
        else if (t >= co.tPay && t < co.tDone) { thR = -1.5; phR = -0.25; if (t > co.tDone - 0.5) hop = Math.max(hop, Math.sin(Math.PI * (co.tDone - t) / 0.5) * 0.18); }
        else if (t >= co.tDone) { thR = moving ? Math.sin(s.step) * 0.3 : 0.05; phR = 0.12; }
      }
      if (s.qT) { thR = Math.sin(now * 1.3 + s.si) * 0.06; phR = 0.18; if (s.carrier === 'none') { thL = -thR; phL = 0.18; } } // waiting in line
      // squash & stretch + hop stretch
      const st = s.sq + hop * 0.35;
      tmpE.set(lean, yaw + wiggle * 0.6, roll, 'YXZ'); tmpQ.setFromEuler(tmpE);
      const sc = s.ai ? AI_SCALE : 1;
      R.compose(tmpV.set(p.x, hop + seatLift, p.z), tmpQ, tmpS.set((1 - st * 0.55) * sc, (1 + st) * sc, (1 - st * 0.55) * sc));
      // arms: blend the pose toward the IK aim for the grabbing arm, rubber-stretch to reach the facing
      const ka = 1 - Math.exp(-dt * 14);
      let wantR = 1, wantL = 1;
      const qTR = poseQ(new THREE.Quaternion(), 1, thR, phR), qTL = poseQ(new THREE.Quaternion(), -1, thL, phL);
      if (ik > 0.001 && ikAt) {
        // target in the body frame (R without squash: close enough for an arm)
        const inv = tmpM3.copy(R).invert();
        const lt = tmpV.set(ikAt.x, ikAt.y, ikAt.z).applyMatrix4(inv);
        const sh = SHOULDER(gs);
        const dir = lt.sub(sh);
        const need = Math.min(3.4, Math.max(1, dir.length() / (BODY.armLen + 0.05)));
        aimQ(tmpQ2, dir);
        if (gs > 0) { qTR.slerp(tmpQ2, ik); wantR = 1 + (need - 1) * ik; } else { qTL.slerp(tmpQ2, ik); wantL = 1 + (need - 1) * ik; }
      }
      s.qR.slerp(qTR, ka); s.qL.slerp(qTL, ka);
      const ks = 1 - Math.exp(-dt * 18);
      s.strR += (wantR - s.strR) * ks; s.strL += (wantL - s.strL) * ks;

      (s.ai ? M.robot : M.bean).setMatrixAt(bi, R); (s.ai ? M.robotInk : M.beanInk).setMatrixAt(bi, R);
      const armR = tmpM2.multiplyMatrices(R, armMatrix(tmpM, 1, s.qR, s.strR));
      M.arm.setMatrixAt(s.si * 2, armR); M.armInk.setMatrixAt(s.si * 2, armR);
      const handR = s.handR.multiplyMatrices(R, tmpM.compose(SHOULDER(1), s.qR, tmpS.set(1, 1, 1))).multiply(tmpM3.makeTranslation(0, -BODY.armLen * s.strR, 0));
      const armL = tmpM2.multiplyMatrices(R, armMatrix(tmpM, -1, s.qL, s.strL));
      M.arm.setMatrixAt(s.si * 2 + 1, armL); M.armInk.setMatrixAt(s.si * 2 + 1, armL);
      const handL = s.handL.multiplyMatrices(R, tmpM.compose(SHOULDER(-1), s.qL, tmpS.set(1, 1, 1))).multiply(tmpM3.makeTranslation(0, -BODY.armLen * s.strL, 0));
      M.blob.setMatrixAt(s.si, tmpM.compose(tmpV.set(p.x, 0.012, p.z), tmpQ.identity(), tmpS.setScalar(1 - hop * 0.8)));

      if (!s.ai) {
        // googly eyes: pupils slide toward what they're looking at (+ a little jiggle when walking)
        const inv = tmpM3.copy(R).invert();
        let lx = 0, ly = -0.1, lz = 1;
        if (lookW) { const lw = lookW.applyMatrix4(inv); lx = lw.x; ly = lw.y - BODY.eyeY; lz = lw.z; }
        else if (b?.kind === 'ignore') { lx = 0.3; ly = 0.8; lz = 0.6; } // whistling, eyes on the ceiling
        else if ((b?.kind === 'reject' && u > BEAT.grab && u < BEAT.putBack) || (b?.kind === 'pick' && u > BEAT.grab && u < BEAT.launch)) { lx = 0.15 * gs; ly = -0.4; lz = 1; } // squinting at the pack
        const lv = tmpV.set(lx, ly, Math.max(0.25, lz)).normalize();
        s.look.lerp(lv, 1 - Math.exp(-dt * 12));
        const jig = moving ? Math.sin(s.step * 2) * 0.012 : 0;
        for (let k = 0; k < 2; k++) {
          const ex = (k ? -1 : 1) * BODY.eyeX;
          const e = tmpM.compose(tmpV.set(ex, BODY.eyeY, BODY.eyeZ), tmpQ.identity(), tmpS.setScalar(1)).premultiply(R);
          M.eye.setMatrixAt(bi * 2 + k, e); M.eyeInk.setMatrixAt(bi * 2 + k, e);
          const pp = tmpM.compose(tmpV.set(ex + s.look.x * 0.065, BODY.eyeY + s.look.y * 0.065 + jig, BODY.eyeZ + 0.062 + s.look.z * 0.012), tmpQ.identity(), tmpS.setScalar(1)).premultiply(R);
          M.pupil.setMatrixAt(bi * 2 + k, pp);
          // feet
          const ph = s.step + (k ? Math.PI : 0);
          const f = tmpM.compose(tmpV.set(ex * 1.05, seatLift + 0.045 + (moving ? Math.max(0, Math.sin(ph)) * 0.07 : 0) + (seatLift ? Math.sin(now * 3 + k * 2) * 0.03 : 0), 0.06 + (moving ? Math.cos(ph) * 0.1 : 0) + (seatLift ? 0.18 : 0)), tmpQ.identity(), tmpS.setScalar(1));
          tmpM2.compose(tmpV.set(p.x, 0, p.z), tmpQ.setFromAxisAngle(UP, yaw), tmpS.setScalar(1));
          M.foot.setMatrixAt(bi * 2 + k, tmpM2.multiply(f));
        }
      } else {
        // laser scanner over the shelf it is reading (ai agents carry nothing: they read the feed)
        const ri = M.robotIdx.get(s.si)!;
        if (b?.shelf) {
          const eye = tmpV.set(0, 0.9, 0.3).applyMatrix4(R).clone();
          const sweep = Math.sin(now * 9 + s.si) * 0.16;
          const tgt = new THREE.Vector3(b.shelf.x, b.shelf.y + sweep, b.shelf.z);
          const dir = tgt.clone().sub(eye); const len = dir.length();
          tmpQ.setFromUnitVectors(UP, dir.normalize());
          M.beamCore.setMatrixAt(ri, tmpM.compose(eye, tmpQ, tmpS.set(1, len, 1)));
          M.beamGlow.setMatrixAt(ri, tmpM.compose(eye, tmpQ, tmpS.set(1, len, 1)));
        } else { M.beamCore.setMatrixAt(ri, ZERO); M.beamGlow.setMatrixAt(ri, ZERO); }
      }
      // accessories
      const pi = M.partIdx.get(s.si)!;
      s.parts.forEach((pt, k) => {
        const base = pt.attach === 'handR' ? handR : pt.attach === 'handL' ? handL : R;
        M.parts[pt.key].setMatrixAt(pi[k], tmpM.multiplyMatrices(base, pt.m));
      });
      // paper bag after paying, café cup while sitting
      M.bag.setMatrixAt(s.si, co && t >= co.tPay + 0.5 && !sipping ? tmpM.multiplyMatrices(s.carrier === 'basket' || !co ? handR : handL, tmpM3.makeTranslation(0, -0.02, 0.02)) : ZERO);
      M.cup.setMatrixAt(s.si, sipping ? tmpM.multiplyMatrices(handR, tmpM3.makeTranslation(0, -0.08, 0.06)) : ZERO);
      // carriers: parked during checkout, returned after paying, otherwise the physics body transform
      const parkedNow = !!(co && s.park && t >= co.tArrive);
      if (parkedNow) {
        const pm = t < co!.tDone ? s.park! : ZERO;
        if (s.carrier === 'trolley') M.trolley.setMatrixAt(M.trolleyIdx.get(s.si)!, pm); else if (s.carrier === 'basket') M.basket.setMatrixAt(M.basketIdx.get(s.si)!, pm);
      } else if (s.cbody) {
        const ct = s.cbody.translation(), cr = s.cbody.rotation();
        const cm = tmpM.compose(tmpV.set(ct.x, ct.y, ct.z), tmpQ.set(cr.x, cr.y, cr.z, cr.w), tmpS.setScalar(1));
        if (s.carrier === 'trolley') M.trolley.setMatrixAt(M.trolleyIdx.get(s.si)!, cm); else M.basket.setMatrixAt(M.basketIdx.get(s.si)!, cm);
      }
    }
    bus.doors = doors;

    // ---------- carried packs ----------
    const world_ = world;
    const ld = load.current;
    for (const c of Object.values(M.carried)) {
      c.beats.forEach((b, i) => {
        const s = byAgent.get(b.agentId);
        const sz = c.size;
        let m: THREE.Matrix4 | null = null;
        const fl = flights.current.get(b.id);
        const dropFlight = () => { if (fl) { try { world_.removeRigidBody(fl.body); } catch { /* */ } flights.current.delete(b.id); } };
        // the pack physically leaves the shelf when the hand closes on it, and a rejected one goes back
        if (s && !s.ai && b.code) {
          if (crossed(b.tGrab) && !taken.current.has(b.id)) {
            const at = takeFromShelf(b.shelfSlot, b.code);
            taken.current.set(b.id, { beat: b, at });
            emitCrowd({ type: 'take', agentId: b.agentId, slot: b.shelfSlot, code: b.code, t });
          }
          if (b.kind === 'reject' && crossed(b.tBack) && taken.current.has(b.id)) {
            restockShelf(b.shelfSlot, b.code, 1); taken.current.delete(b.id);
            emitCrowd({ type: 'putback', agentId: b.agentId, slot: b.shelfSlot, code: b.code, t }); sfx.nope();
          }
        }
        if (!s || !s.active || t < b.tGrab) { dropFlight(); if (t < b.tLaunch) unbake(b.id); c.mesh.setMatrixAt(i, ZERO); return; }
        const hand = b.kind !== 'ignore' && grabSide(s, b) < 0 ? s.handL : s.handR;
        const inHand = (k = 1.25) => new THREE.Matrix4().multiplyMatrices(hand, new THREE.Matrix4().makeTranslation(0, -0.1, 0.06)).multiply(new THREE.Matrix4().makeScale(sz.w * k, sz.h * k, sz.d * k));
        const shelfM = b.shelf ? new THREE.Matrix4().compose(tmpV.set(b.shelf.x, b.shelf.y, b.shelf.z), tmpQ.identity(), tmpS.setScalar(1)) : null;
        if (b.kind === 'reject') {
          // inspect it, then reach back and put it on the shelf (shelfBus.restockShelf brings the facing back)
          m = t < b.tBack ? inHand() : null;
        } else if (s.ai) {
          // hologram: the pack zips from the shelf into the robot's screen and shrinks away
          if (t < b.tLaunch + 0.6 * (b.t1 - b.t0) * 0.5 && shelfM) {
            const k = ease((t - b.tGrab) / Math.max(0.01, (b.t1 - b.tGrab) * 0.7));
            const a = new THREE.Vector3(b.shelf!.x, b.shelf!.y, b.shelf!.z), z = new THREE.Vector3(0, 0.9, 0.3).applyMatrix4(rootM.current[s.si]);
            const pos = a.lerp(z, k); pos.y += Math.sin(Math.PI * k) * 0.3;
            const sc = 1.4 * (1 - k * 0.9);
            m = new THREE.Matrix4().compose(pos, tmpQ.setFromEuler(tmpE.set(0, now * 4, 0)), tmpS.set(sz.w * sc, sz.h * sc, sz.d * sc));
          }
        } else {
          // human pick: in hand → physics throw into the carrier → welded into the carrier → belt/scanner → bag
          const co = s.co;
          if (co && b.pickIdx >= 0 && b.pickIdx < co.tScan.length && t >= co.tArrive) {
            dropFlight();
            ld?.remove(b.id); // the carrier is parked (no physics) while it's being emptied
            const k = b.pickIdx, L = co.lane, tS = co.tScan[k];
            let carrierM: THREE.Matrix4 | null = s.park;
            if (!carrierM && s.cbody) { const ct = s.cbody.translation(), cr = s.cbody.rotation(); carrierM = new THREE.Matrix4().compose(new THREE.Vector3(ct.x, ct.y, ct.z), new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w), new THREE.Vector3(1, 1, 1)); }
            let local = baked.current.get(b.id);
            if (!local) { local = stackLocal(s.carrier, b.pickIdx, sz.h, new THREE.Matrix4()); baked.current.set(b.id, local); }
            const inCarrier = carrierM ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(carrierM, local)) : new THREE.Vector3(L.stand.x, 0.9, L.stand.z);
            const scanP = new THREE.Vector3(L.scanner.x, L.scanner.y + sz.h / 2 + 0.08, L.scanner.z);
            const bagP = new THREE.Vector3(L.bag.x + ((k % 3) - 1) * 0.12, L.bag.y + sz.h / 2 + Math.floor(k / 3) * (sz.h * 0.6), L.bag.z + ((k >> 1) % 2) * 0.1);
            if (crossed(tS)) { bus.flash[L.id] = now; sfx.beep(); emitCrowd({ type: 'scan', agentId: b.agentId, lane: L.id, kind: L.kind, code: b.code, t }); }
            let pos: THREE.Vector3 | null = null, spin = 0;
            if (L.kind === 'staffed' && L.beltStart && L.beltEnd) {
              const tU = co.tUnload0 + k * TILL.unloadPer, tLand = tU + 0.3;
              if (crossed(tU)) emitCrowd({ type: 'unload', agentId: b.agentId, lane: L.id, code: b.code, t });
              const y = 0.975 + sz.h / 2;
              const bs = new THREE.Vector3(L.beltStart.x, y, L.beltStart.z), be = new THREE.Vector3(L.beltEnd.x, y, L.beltEnd.z);
              if (t < tU) pos = inCarrier;
              else if (t < tLand) { pos = lerp3(inCarrier, bs, ease((t - tU) / 0.3), 0.35); spin = (t - tU) * 9; }
              else if (t < tS - 0.15) pos = bs.lerp(be, clamp01((t - tLand) / Math.max(0.05, tS - 0.15 - tLand)));
              else if (t < tS + 0.35) { const kk = clamp01((t - tS + 0.15) / 0.5); pos = kk < 0.4 ? lerp3(be, scanP, kk / 0.4, 0.08) : lerp3(scanP, bagP, (kk - 0.4) / 0.6, 0.25); }
              else if (t < co.tPay) pos = bagP;
            } else {
              const tP = tS - 0.55;
              if (crossed(tP)) emitCrowd({ type: 'unload', agentId: b.agentId, lane: L.id, code: b.code, t });
              if (t < tP) pos = inCarrier;
              else if (t < tS) { pos = lerp3(inCarrier, scanP, ease((t - tP) / 0.55), 0.2); spin = (t - tP) * 4; }
              else if (t < tS + 0.3) pos = lerp3(scanP, bagP, ease((t - tS) / 0.3), 0.15);
              else if (t < co.tPay + 0.3) pos = bagP;
            }
            if (pos) {
              tmpQ.setFromEuler(tmpE.set(spin, spin * 0.5 + (k * 1.3) % 0.5, 0));
              if (!spin && carrierM && t < co.tUnload0 + k * TILL.unloadPer) tmpQ.setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(carrierM, local));
              m = new THREE.Matrix4().compose(pos, tmpQ, tmpS.set(sz.w, sz.h, sz.d));
            }
            c.mesh.setMatrixAt(i, m ?? ZERO);
            return;
          }
          if (t < b.tLaunch) { dropFlight(); unbake(b.id); m = inHand(); }
          else if (s.cbody) {
            const ct = s.cbody.translation(), cr = s.cbody.rotation();
            const cm = new THREE.Matrix4().compose(new THREE.Vector3(ct.x, ct.y, ct.z), new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w), new THREE.Vector3(1, 1, 1));
            if (crossed(b.tLaunch) && !fl && !baked.current.has(b.id) && !DBG.includes('nothrow')) {
              const src = new THREE.Vector3().setFromMatrixPosition(hand).add(new THREE.Vector3(0, 0.05, 0));
              // aim at the open spot over the pile, so the pack drops onto what's already in there
              const aimL = stackLocal(s.carrier, b.pickIdx, sz.h, new THREE.Matrix4());
              const dst = new THREE.Vector3().setFromMatrixPosition(aimL).add(new THREE.Vector3(0, 0.22, 0)).applyMatrix4(cm);
              const T = Math.max(0.32, 0.62 / Math.sqrt(Math.max(1, speedRef.current)));
              const body = throwPack(world_, rapier, src, dst, T, sz, b.pickIdx % 2 ? 1 : -1);
              flights.current.set(b.id, { body, born: now });
              sfx.pick();
            }
            const f2 = flights.current.get(b.id);
            if (f2) {
              const bt = f2.body.translation(), br = f2.body.rotation();
              const wm = new THREE.Matrix4().compose(new THREE.Vector3(bt.x, bt.y, bt.z), new THREE.Quaternion(br.x, br.y, br.z, br.w), new THREE.Vector3(1, 1, 1));
              const lv = f2.body.linvel();
              const age = now - f2.born;
              const settled = f2.body.isSleeping() || (age > 0.5 && Math.hypot(lv.x, lv.y, lv.z) < 0.08) || age > 2.2 || t > b.t1;
              if (settled) {
                const local = new THREE.Matrix4().copy(cm).invert().multiply(wm);
                const lp = new THREE.Vector3().setFromMatrixPosition(local);
                const ok = insideCarrier(s.carrier, lp);
                bake(s, b, ok ? local : stackLocal(s.carrier, b.pickIdx, sz.h, new THREE.Matrix4()), sz);
                dropFlight();
                emitCrowd({ type: 'drop', agentId: b.agentId, code: b.code, t });
              }
              m = wm;
            }
            if (!m) {
              let local = baked.current.get(b.id);
              if (!local) { local = stackLocal(s.carrier, b.pickIdx, sz.h, new THREE.Matrix4()); bake(s, b, local, sz); }
              else if (ld && !ld.has(b.id) && s.cbOn && !DBG.includes('noload')) ld.add(s.cbody, b.id, local, sz);
              m = new THREE.Matrix4().multiplyMatrices(cm, local);
            }
            m.multiply(new THREE.Matrix4().makeScale(sz.w, sz.h, sz.d));
          }
        }
        c.mesh.setMatrixAt(i, m ?? ZERO);
      });
      c.mesh.instanceMatrix.needsUpdate = true;
    }

    for (const m of [M.bean, M.beanInk, M.robot, M.robotInk, M.eye, M.eyeInk, M.pupil, M.arm, M.armInk, M.foot, M.blob, M.trolley, M.basket, M.bag, M.cup, M.beamCore, M.beamGlow, ...Object.values(M.parts)]) m.instanceMatrix.needsUpdate = true;

    // selection ring + follow cam feed
    const sel = selectedAgent ? shoppers.find((x) => x.agent.agent_id === selectedAgent) : null;
    if (selRing.current) {
      selRing.current.visible = !!sel?.active;
      if (sel?.active) { selRing.current.position.set(sel.pos.x, 0.02, sel.pos.z); selRing.current.rotation.z = now * 1.5; }
    }
    bus.follow = sel?.active ? { x: sel.pos.x, z: sel.pos.z, heading: sel.yaw } : null;

    // stickers (10 Hz)
    if (now - lastSticker.current.t > 0.1) {
      lastSticker.current.t = now;
      // crowd health: bodies closer than two body radii would be interpenetrating
      let act = 0, ov = 0, qd = 0;
      for (const s of shoppers) {
        if (!s.active) continue;
        act++; if (s.qT) qd++;
        if (!s.ai) near(s.px, s.pz, BODY.r * 2 - 0.08, s.si, (o) => { if (!o.ai && o.si > s.si && o.active) ov++; });
      }
      crowdStats.active = act; crowdStats.overlaps = ov; crowdStats.queued = qd; crowdStats.flights = flights.current.size; crowdStats.inCarriers = baked.current.size;
      const out: Sticker[] = [];
      for (const s of shoppers) {
        if (!s.active) continue;
        for (const b of s.beats) {
          if (b.t0 > t) break;
          if (t > b.t1 + 0.5 || b.kind === 'ignore') continue;
          if (s.ai && b.kind !== 'pick') continue;
          if (b.kind === 'pick' && t < b.tLaunch) continue;
          if (b.kind === 'reject' && t < b.tGrab + 0.25 * (b.t1 - b.t0)) continue;
          const near = state.camera.position.distanceTo(tmpV.set(s.pos.x, 1.8, s.pos.z)) < 15 || b.agentId === selectedAgent;
          out.push({ key: `${s.si}-${b.id}-${near ? 'n' : 'f'}`, si: s.si, beat: b, x: s.pos.x, z: s.pos.z, near });
        }
      }
      const key = out.map((o) => o.key).join('|');
      if (key !== lastSticker.current.key) { lastSticker.current.key = key; setStickers(out); }
    }
  });

  const click = (list: Shopper[]) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const s = e.instanceId !== undefined ? list[e.instanceId] : undefined;
    if (s) onAgent(s.agent.agent_id);
  };
  const [hovered, setHovered] = useState<number | null>(null);
  const hover = (list: Shopper[]) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => { const s = e.instanceId !== undefined ? list[e.instanceId] : undefined; document.body.style.cursor = 'pointer'; if (s && s.si !== hovered) setHovered(s.si); },
    onPointerOut: () => { document.body.style.cursor = ''; setHovered(null); },
  });
  const hs = hovered !== null ? shoppers[hovered] : null;

  return (
    <group>
      <primitive object={meshes.group} />
      {/* click targets: the visible body meshes themselves */}
      <primitive object={meshes.bean} onClick={click(meshes.beanList)} {...hover(meshes.beanList)} />
      <primitive object={meshes.robot} onClick={click(meshes.robotList)} {...hover(meshes.robotList)} />
      {hs?.active && (
        <Html position={[hs.pos.x, hs.ai ? 1.75 : 1.6, hs.pos.z]} center zIndexRange={[40, 30]} style={{ pointerEvents: 'none' }}>
          <div className="sticker sticker-small" style={{ whiteSpace: 'nowrap', ['--stk' as string]: '#' + hs.color.getHexString() }}>
            {hs.aiKind ? `🤖 ${AI_KIND[hs.aiKind].label}` : archLabel(hs.arch)}
            {hs.ai && hs.agent.model && <span style={{ opacity: 0.6, fontSize: '0.8em' }}> · {hs.agent.model.split('/').pop()}</span>}
          </div>
        </Html>
      )}
      <mesh ref={selRing} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.52, 0.66, 40, 1, 0, Math.PI * 1.6]} />
        <meshBasicMaterial color={BRAND_A} />
      </mesh>
      {stickers.map((o) => {
        const b = o.beat;
        const d = DECISION[b.kind === 'pick' ? 'pick' : b.kind === 'reject' ? 'reject' : 'walk_past'];
        const s = shoppers[o.si];
        const showWords = o.near && b.reason && (thoughts === 'all' || (thoughts === 'selected' && b.agentId === selectedAgent));
        const prod = products[b.code];
        const label = s.ai && b.kind === 'pick' ? 'added to cart' : b.kind === 'pick' ? 'picked!' : b.kind === 'reject' ? 'nope' : 'walked past';
        return (
          <Html key={o.key} position={[o.x, b.kind === 'pick' ? 2.0 : 1.85, o.z]} center zIndexRange={[20, 0]} style={{ transform: 'translateY(-50%)' }}>
            <div className={`float-stack kind-${b.kind} ${o.near ? 'is-near' : 'is-far'}`} onClick={() => onEvent(b.agentId, b.step)}>
              {showWords && b.kind === 'reject' && (
                <div className={`speech ${b.agentId === selectedAgent ? 'is-sel' : ''}`}>
                  <span className="thought-prod">{prod ? prod.brand : b.code}</span>
                  {b.reason.length > 96 ? `${b.reason.slice(0, 94)}…` : b.reason}
                </div>
              )}
              {showWords && b.kind === 'pick' && thoughts === 'all' && !s.ai && (
                <div className={`thought ${b.agentId === selectedAgent ? 'is-sel' : ''}`}>
                  <span className="thought-prod">{prod ? prod.brand : b.code}</span>
                  {b.reason.length > 70 ? `${b.reason.slice(0, 68)}…` : b.reason}
                </div>
              )}
              <div className={`sticker pop ${b.kind === 'pick' ? 'sticker-good' : b.kind === 'reject' ? 'sticker-bad' : 'sticker-small'}`} style={{ ['--stk' as string]: d.color }}>
                <span aria-hidden>{b.kind === 'glance' ? '👀' : d.emoji}</span>{o.near && <> {label}</>}
              </div>
            </div>
          </Html>
        );
      })}
      {bonks.map((k) => (
        <Html key={k.id} position={[k.x, k.y, k.z]} center zIndexRange={[30, 20]}>
          <div className="bonk" aria-hidden>💥 {k.word}</div>
        </Html>
      ))}
    </group>
  );
}

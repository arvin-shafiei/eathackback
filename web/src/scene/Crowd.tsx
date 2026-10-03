// The crowd: replayed shoppers as physics bodies (rapier) drawn with instanced cartoon parts.
// Decisions, products and order come ONLY from the run log (timelines/beats). Physics adds a visual offset:
// shoppers are dynamic capsules steered toward their replay position, so they shove, bonk and recover,
// trolleys/baskets are jointed dynamic bodies, and picked packs are thrown into carriers as real bodies.
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useAfterPhysicsStep, useBeforePhysicsStep, useRapier } from '@react-three/rapier';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { Agent, Persona, Product, StoreConfig } from '../types';
import { isAI } from '../types';
import { BEAT, G, categoryHeight, sampleTimeline, type Timeline } from '../layout';
import { archColor, carrierFor, DECISION, BRAND_A, type Carrier } from '../theme';
import { archetypeOf } from '../stats';
import { productMaterials } from './textures';
import { accessoriesFor, ROBOT_PARTS, PARTS, GEO, BODY, BASKET, TROLLEY, inkHull, trolleyGeometry, basketGeometry, type PartUse } from './parts';
import type { Beat, Beats } from './beats';
import { bus, sfx } from './fx';

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

interface Shopper {
  si: number; agent: Agent; ai: boolean; arch: string; color: THREE.Color; carrier: Carrier; tl: Timeline; beats: Beat[];
  body: RigidBody | null; cbody: RigidBody | null; active: boolean;
  knock: THREE.Vector2; sq: number; sqv: number; cool: number; step: number; yawWiggle: number;
  armR: [number, number]; armL: [number, number]; look: THREE.Vector3;
  parts: PartUse[];
  pos: THREE.Vector3; yaw: number;
}

const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpM3 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** arm matrix: shoulder → rotation (pitch θ about x, then roll φ about z; φ>0 = outward) */
function armMatrix(out: THREE.Matrix4, side: 1 | -1, th: number, ph: number) {
  tmpE.set(th, 0, side * ph, 'ZXY');
  tmpQ.setFromEuler(tmpE);
  return out.compose(tmpV.set(side * BODY.shoulderX, BODY.shoulderY, 0.02), tmpQ, tmpS.set(1, 1, 1));
}
const HAND_OFF = new THREE.Matrix4().makeTranslation(0, -BODY.armLen, 0);

function carrierDims(c: Carrier) {
  return c === 'trolley' ? { hx: TROLLEY.hx - 0.03, hz: TROLLEY.hz - 0.03, floor: TROLLEY.floorY + 0.02, cols: 3, rows: 3 } : { hx: BASKET.hx - 0.03, hz: BASKET.hz - 0.03, floor: 0.03, cols: 2, rows: 2 };
}
function carriedSize(code: string, products: Record<string, Product>) {
  const cat = products[code]?.category ?? '';
  return { w: 0.17, h: Math.max(0.1, categoryHeight(cat) * 0.5), d: 0.12 };
}
/** stack position for the nth pick in a carrier (used after a scrub or if a throw misses) */
function stackLocal(c: Carrier, n: number, h: number, out: THREE.Matrix4) {
  const d = carrierDims(c);
  const per = d.cols * d.rows, layer = Math.floor(n / per), k = n % per;
  const x = ((k % d.cols) / Math.max(1, d.cols - 1) - 0.5) * d.hx * 1.3;
  const z = ((Math.floor(k / d.cols) % d.rows) / Math.max(1, d.rows - 1) - 0.5) * d.hz * 1.3;
  tmpQ.setFromEuler(tmpE.set(0, (n * 1.7) % 0.6 - 0.3, 0));
  return out.compose(tmpV.set(x, d.floor + h / 2 + layer * (h + 0.01), z), tmpQ, tmpS.set(1, 1, 1));
}

interface Flight { body: RigidBody; born: number }
interface Sticker { key: string; si: number; beat: Beat; x: number; z: number; near: boolean }
interface Bonk { id: number; x: number; y: number; z: number; word: string }
/** robots are a bit smaller than people so a 240-agent ai arm doesn't bury the humans */
const AI_SCALE = 0.8;
const BONK_WORDS = ['bonk!', 'oof!', 'boing!', 'sorry!', 'bump!', 'whoops!'];

export function Crowd({ cfg, agents, timelines, beats, timeRef, personas, products, selectedAgent, onAgent, onEvent, thoughts, speed }: Props) {
  const { world, rapier } = useRapier();
  const speedRef = useRef(speed); speedRef.current = speed;

  // ---------- shoppers (data) ----------
  const shoppers = useMemo<Shopper[]>(() => agents.filter((a) => timelines[a.agent_id]).map((a, si) => {
    const ai = isAI(a);
    const arch = ai ? 'ai_agent' : archetypeOf(a, personas);
    const mission = a.mission ?? personas[a.persona_id]?.mission;
    const parts = ai ? ROBOT_PARTS : accessoriesFor(arch);
    return {
      si, agent: a, ai, arch, color: new THREE.Color(archColor(ai ? 'ai' : arch)), carrier: carrierFor(arch, mission, ai), tl: timelines[a.agent_id], beats: beats.byAgent[a.agent_id] ?? [],
      body: null, cbody: null, active: false, knock: new THREE.Vector2(), sq: 0, sqv: 0, cool: 0, step: Math.random() * 6, yawWiggle: 0,
      armR: [0, 0.12], armL: [0, 0.12], look: new THREE.Vector3(0, 0, 1), parts, pos: new THREE.Vector3(0, -50, 0), yaw: 0,
    };
  }), [agents, timelines, personas, beats]);

  // ---------- physics bodies ----------
  const colliderOwner = useRef(new Map<number, number>());
  useEffect(() => {
    const R = rapier;
    const owner = colliderOwner.current; owner.clear();
    const made: RigidBody[] = [];
    for (const s of shoppers) {
      const bd = R.RigidBodyDesc.dynamic().setTranslation(0, -20 - s.si, 0).setGravityScale(0).setLinearDamping(0.5).setAngularDamping(4).setCanSleep(false).setEnabled(false);
      const body = world.createRigidBody(bd);
      body.setEnabledTranslations(true, false, true, false);
      body.setEnabledRotations(false, true, false, false);
      const col = world.createCollider(
        (s.ai ? R.ColliderDesc.cuboid(0.31 * AI_SCALE, 0.46 * AI_SCALE, 0.25 * AI_SCALE) : R.ColliderDesc.capsule(0.3, BODY.r)).setDensity(220).setFriction(0.1).setRestitution(0.4),
        body,
      );
      owner.set(col.handle, s.si);
      s.body = body; made.push(body);
      if (s.carrier !== 'none') {
        const tr = s.carrier === 'trolley';
        const cb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, -20 - s.si, 1).setGravityScale(0).setLinearDamping(0.6).setAngularDamping(3).setCanSleep(false).setEnabled(false));
        cb.setEnabledTranslations(true, false, true, false);
        cb.setEnabledRotations(false, true, false, false);
        const add = (hx: number, hy: number, hz: number, x: number, y: number, z: number) => {
          const c = world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setDensity(tr ? 30 : 15).setFriction(0.6).setRestitution(0.4), cb);
          owner.set(c.handle, s.si);
        };
        if (tr) {
          const { hx, hz, floorY, wallH } = TROLLEY;
          add(0.26, 0.13, hz - 0.02, 0, 0.21, 0); // chassis: what other shoppers bump into
          add(hx, 0.02, hz, 0, floorY, 0); // basket floor (products land here)
          add(0.015, wallH / 2, hz, hx, floorY + wallH / 2, 0); add(0.015, wallH / 2, hz, -hx, floorY + wallH / 2, 0);
          add(hx, wallH / 2, 0.015, 0, floorY + wallH / 2, hz); add(hx, wallH / 2, 0.015, 0, floorY + wallH / 2, -hz);
        } else {
          const { hx, hz, wallH } = BASKET;
          add(hx, 0.012, hz, 0, 0.012, 0);
          add(0.012, wallH / 2, hz, hx, wallH / 2, 0); add(0.012, wallH / 2, hz, -hx, wallH / 2, 0);
          add(hx, wallH / 2, 0.012, 0, wallH / 2, hz); add(hx, wallH / 2, 0.012, 0, wallH / 2, -hz);
        }
        const anchor = tr ? TROLLEY.anchor : BASKET.anchor;
        const j = world.createImpulseJoint(R.JointData.fixed({ x: anchor[0], y: anchor[1], z: anchor[2] }, { w: 1, x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 }), body, cb, true);
        j.setContactsEnabled(false);
        s.cbody = cb; made.push(cb);
      }
    }
    return () => {
      for (const b of made) { try { world.removeRigidBody(b); } catch { /* world already gone */ } }
      for (const s of shoppers) { s.body = null; s.cbody = null; s.active = false; }
      owner.clear();
    };
  }, [shoppers, world, rapier]);

  // ---------- flights (picked packs in the air) & baked carrier contents ----------
  const flights = useRef(new Map<number, Flight>());
  const baked = useRef(new Map<number, THREE.Matrix4>());
  const lastT = useRef(0);
  const scrubbed = useRef(false);
  useEffect(() => () => { for (const f of flights.current.values()) { try { world.removeRigidBody(f.body); } catch { /* gone */ } } flights.current.clear(); baked.current.clear(); }, [shoppers, world]);

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
    s.knock.set(0, 0);
  };

  // ---------- steering: before every physics step ----------
  useBeforePhysicsStep((w: World) => {
    const t = timeRef.current, sp = speedRef.current;
    const dt = w.timestep;
    const scrub = scrubbed.current;
    for (const s of shoppers) {
      if (!s.body) continue;
      const smp = sampleTimeline(s.tl, t);
      if (!smp.visible) {
        if (s.active) { s.active = false; s.body.setEnabled(false); s.cbody?.setEnabled(false); s.pos.set(0, -50, 0); }
        continue;
      }
      if (!s.active) {
        s.active = true; s.body.setEnabled(true); s.cbody?.setEnabled(true);
        placeAt(s, smp.x, smp.z, smp.heading);
        continue;
      }
      const p = s.body.translation();
      const dx = smp.x - p.x, dz = smp.z - p.z, d = Math.hypot(dx, dz);
      const walk = (s.ai ? G.aiWalkSpeed : G.walkSpeed) * sp;
      if (scrub || d > 3 + walk * 0.8) { placeAt(s, smp.x, smp.z, smp.heading); continue; }
      // feed-forward along the replay segment + spring back onto the path + decaying bonk knock-back
      let fx = 0, fz = 0;
      if (smp.seg?.kind === 'move' && smp.seg.t1 > smp.seg.t0) { const k = sp / (smp.seg.t1 - smp.seg.t0); fx = (smp.seg.b.x - smp.seg.a.x) * k; fz = (smp.seg.b.z - smp.seg.a.z) * k; }
      const gain = 3.2;
      let vx = fx + dx * gain + s.knock.x, vz = fz + dz * gain + s.knock.y;
      const vmax = walk * 1.7 + 1.2, vm = Math.hypot(vx, vz);
      if (vm > vmax) { vx *= vmax / vm; vz *= vmax / vm; }
      s.body.setLinvel({ x: vx, y: 0, z: vz }, true);
      s.knock.multiplyScalar(Math.exp(-dt / 0.28));
      // face: walking direction, or the shelf at a dwell (trolley pushers angle the trolley along the aisle)
      let want = smp.heading;
      if (smp.seg?.kind === 'dwell' && s.carrier === 'trolley') want = smp.heading + angDiff(smp.heading, 0) * 0.6;
      const r = s.body.rotation();
      const yaw = 2 * Math.atan2(r.y, r.w);
      const err = angDiff(yaw, want);
      s.body.setAngvel({ x: 0, y: Math.max(-9, Math.min(9, err * 7)), z: 0 }, true);
    }
    scrubbed.current = false;
  });

  // ---------- bonks: after each step, look at contacts between different shoppers ----------
  const [bonks, setBonks] = useState<Bonk[]>([]);
  const bonkId = useRef(0);
  useAfterPhysicsStep((w: World) => {
    const owner = colliderOwner.current;
    const now = performance.now() / 1000;
    let fresh: Bonk[] | null = null;
    for (const s of shoppers) {
      if (!s.active || !s.body || s.cool > now) continue;
      const nc = s.body.numColliders();
      for (let ci = 0; ci < nc && s.cool <= now; ci++) {
        const col: Collider = s.body.collider(ci);
        w.contactPairsWith(col, (other) => {
          if (s.cool > now) return;
          const oi = owner.get(other.handle);
          if (oi === undefined || oi === s.si) return;
          const o = shoppers[oi];
          if (!o?.active || !o.body || o.cool > now) return;
          let touching = false;
          w.contactPair(col, other, (m) => { if (m.numContacts() > 0) touching = true; });
          if (!touching) return;
          const a = s.body!.translation(), b = o.body.translation();
          let nx = a.x - b.x, nz = a.z - b.z; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          const va = s.body!.linvel(), vb = o.body.linvel();
          const closing = -((va.x - vb.x) * nx + (va.z - vb.z) * nz);
          if (closing < 0.25) return;
          const kick = Math.min(3.4, 1.5 + closing * 0.7);
          s.knock.x += nx * kick; s.knock.y += nz * kick; o.knock.x -= nx * kick; o.knock.y -= nz * kick;
          s.sqv -= 3.4; o.sqv -= 3.4;
          s.cool = o.cool = now + 1.1;
          bus.bonks++; bus.shake = Math.min(1, bus.shake + 0.35);
          sfx.bonk();
          (fresh ??= []).push({ id: bonkId.current++, x: (a.x + b.x) / 2, y: 1.7, z: (a.z + b.z) / 2, word: BONK_WORDS[(s.si + o.si + bonkId.current) % BONK_WORDS.length] });
        });
      }
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
    robots.forEach((s, i) => { robotIdx.set(s.si, i); robot.setColorAt(i, new THREE.Color('#b9a6ff')); arm.setColorAt(s.si * 2, new THREE.Color('#9f97b8')); arm.setColorAt(s.si * 2 + 1, new THREE.Color('#9f97b8')); });
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
    const beamCore = mk(new THREE.CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#7CFFCB', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), robots.length);
    const beamGlow = mk(new THREE.ConeGeometry(0.16, 1, 12, 1, true).rotateX(Math.PI).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#7CFFCB', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), robots.length);
    for (const m of [bean, robot, arm]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const group = new THREE.Group();
    group.add(beanInk, robotInk, eye, eyeInk, pupil, arm, armInk, foot, blob, trolley, basket, beamCore, beamGlow, ...Object.values(parts), ...Object.values(carried).map((c) => c.mesh));
    return { group, bean, beanInk, robot, robotInk, eye, eyeInk, pupil, arm, armInk, foot, blob, trolley, basket, beamCore, beamGlow, parts, partIdx, beanIdx, robotIdx, trolleyIdx, basketIdx, carried, beanList: humans, robotList: robots };
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
  const beatOfShopper = (s: Shopper, t: number): Beat | null => {
    for (const b of s.beats) { if (t >= b.t0 && t < b.t1) return b; if (b.t0 > t) break; }
    return null;
  };

  useFrame((state, rdt) => {
    const t = timeRef.current;
    const now = state.clock.elapsedTime;
    const dt = Math.min(rdt, 0.05);
    const prev = lastT.current;
    const jump = Math.abs(t - prev) > Math.max(1.2, speedRef.current * 0.25);
    if (jump) scrubbed.current = true;
    lastT.current = t;
    const M = meshes;
    if (rootM.current.length !== shoppers.length) rootM.current = shoppers.map(() => new THREE.Matrix4());
    let door = 0;
    const doorZ = cfg.entrance.z - 1.4;

    for (const s of shoppers) {
      const R = rootM.current[s.si];
      const bi = s.ai ? M.robotIdx.get(s.si)! : M.beanIdx.get(s.si)!;
      const hide = () => {
        (s.ai ? M.robot : M.bean).setMatrixAt(bi, ZERO); (s.ai ? M.robotInk : M.beanInk).setMatrixAt(bi, ZERO);
        for (let k = 0; k < 2; k++) { M.arm.setMatrixAt(s.si * 2 + k, ZERO); M.armInk.setMatrixAt(s.si * 2 + k, ZERO); if (!s.ai) { M.eye.setMatrixAt(bi * 2 + k, ZERO); M.eyeInk.setMatrixAt(bi * 2 + k, ZERO); M.pupil.setMatrixAt(bi * 2 + k, ZERO); M.foot.setMatrixAt(bi * 2 + k, ZERO); } }
        M.blob.setMatrixAt(s.si, ZERO);
        const pi = M.partIdx.get(s.si)!; s.parts.forEach((p, k) => M.parts[p.key].setMatrixAt(pi[k], ZERO));
        if (s.carrier === 'trolley') M.trolley.setMatrixAt(M.trolleyIdx.get(s.si)!, ZERO);
        if (s.carrier === 'basket') M.basket.setMatrixAt(M.basketIdx.get(s.si)!, ZERO);
        if (s.ai) { M.beamCore.setMatrixAt(M.robotIdx.get(s.si)!, ZERO); M.beamGlow.setMatrixAt(M.robotIdx.get(s.si)!, ZERO); }
      };
      if (!s.active || !s.body) { hide(); continue; }
      const p = s.body.translation(), r = s.body.rotation(), v = s.body.linvel();
      const yaw = 2 * Math.atan2(r.y, r.w);
      s.pos.set(p.x, 0, p.z); s.yaw = yaw;
      if (Math.hypot(p.x - cfg.entrance.x, p.z - doorZ) < 3.4) door++;
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
      if (moving) { roll = Math.sin(s.step) * 0.11; hop = Math.abs(Math.sin(s.step)) * 0.05; } else hop = (Math.sin(now * 2.2 + s.si) * 0.5 + 0.5) * 0.02;
      if (s.ai) { hop = 0.06 + Math.sin(now * 3 + s.si) * 0.04; roll *= 0.3; }
      // look target
      let lookW: THREE.Vector3 | null = null;
      if (b?.shelf && b.kind !== 'ignore') lookW = tmpV.set(b.shelf.x, b.shelf.y, b.shelf.z).clone();
      if (b && !s.ai) {
        if (b.kind === 'pick') {
          const g0 = BEAT.grab, l0 = BEAT.launch;
          if (u < g0) { const k = ease(u / g0); thR = thR + (-1.45 - thR) * k; phR = 0.05; }
          else if (u < l0) { thR = -1.45 - ((u - g0) / (l0 - g0)) * 0.9; phR = -0.1; }
          else if (u < 0.92) { const k = (u - l0 - 0.04) / (0.9 - l0 - 0.04); hop = Math.max(hop, Math.sin(Math.PI * clamp01(k)) * 0.42); thR = -2.8; phR = 0.5; if (s.carrier !== 'basket') { thL = -2.8; phL = 0.5; } }
        } else if (b.kind === 'reject') {
          if (u < BEAT.grab) { const k = ease(u / BEAT.grab); thR = thR + (-1.45 - thR) * k; phR = 0.05; }
          else if (u < BEAT.putBack) { thR = -1.95; phR = -0.38; wiggle = Math.sin(now * 17) * 0.38 * Math.sin(Math.PI * clamp01((u - BEAT.grab) / (BEAT.putBack - BEAT.grab))); if (b.shelf) lookW = null; }
          else if (u < BEAT.backOnShelf) { thR = -1.25; phR = 0.05; }
          else { const k = Math.sin(Math.PI * clamp01((u - BEAT.backOnShelf) / (1 - BEAT.backOnShelf))); thR = -0.4 - k * 0.3; phR = 0.4 + k * 0.9; if (s.carrier !== 'basket') { thL = -0.4 - k * 0.3; phL = 0.4 + k * 0.9; } hop = Math.max(hop, k * 0.06); }
        } else if (b.kind === 'glance') {
          lean = Math.sin(Math.PI * clamp01(u)) * 0.12;
        }
      }
      // squash & stretch + hop stretch
      const st = s.sq + hop * 0.35;
      tmpE.set(lean, yaw + wiggle * 0.6, roll, 'YXZ'); tmpQ.setFromEuler(tmpE);
      const sc = s.ai ? AI_SCALE : 1;
      R.compose(tmpV.set(p.x, hop, p.z), tmpQ, tmpS.set((1 - st * 0.55) * sc, (1 + st) * sc, (1 - st * 0.55) * sc));
      // smooth arms
      const ka = 1 - Math.exp(-dt * 14);
      s.armR[0] += (thR - s.armR[0]) * ka; s.armR[1] += (phR - s.armR[1]) * ka;
      s.armL[0] += (thL - s.armL[0]) * ka; s.armL[1] += (phL - s.armL[1]) * ka;

      (s.ai ? M.robot : M.bean).setMatrixAt(bi, R); (s.ai ? M.robotInk : M.beanInk).setMatrixAt(bi, R);
      const armR = tmpM2.multiplyMatrices(R, armMatrix(tmpM, 1, s.armR[0], s.armR[1]));
      M.arm.setMatrixAt(s.si * 2, armR); M.armInk.setMatrixAt(s.si * 2, armR);
      const handR = new THREE.Matrix4().multiplyMatrices(armR, HAND_OFF);
      const armL = tmpM2.multiplyMatrices(R, armMatrix(tmpM, -1, s.armL[0], s.armL[1]));
      M.arm.setMatrixAt(s.si * 2 + 1, armL); M.armInk.setMatrixAt(s.si * 2 + 1, armL);
      const handL = new THREE.Matrix4().multiplyMatrices(armL, HAND_OFF);
      M.blob.setMatrixAt(s.si, tmpM.compose(tmpV.set(p.x, 0.012, p.z), tmpQ.identity(), tmpS.setScalar(1 - hop * 0.8)));

      if (!s.ai) {
        // googly eyes: pupils slide toward what they're looking at (+ a little jiggle when walking)
        const inv = tmpM3.copy(R).invert();
        let lx = 0, ly = -0.1, lz = 1;
        if (lookW) { const lw = lookW.applyMatrix4(inv); lx = lw.x; ly = lw.y - BODY.eyeY; lz = lw.z; }
        else if (b?.kind === 'ignore') { lx = 0.3; ly = 0.8; lz = 0.6; } // whistling, eyes on the ceiling
        else if (b?.kind === 'reject' && u > BEAT.grab && u < BEAT.putBack) { lx = 0.15; ly = -0.4; lz = 1; } // squinting at the pack
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
          const f = tmpM.compose(tmpV.set(ex * 1.05, 0.045 + (moving ? Math.max(0, Math.sin(ph)) * 0.07 : 0), 0.06 + (moving ? Math.cos(ph) * 0.1 : 0)), tmpQ.identity(), tmpS.setScalar(1));
          tmpM2.compose(tmpV.set(p.x, 0, p.z), tmpQ.setFromAxisAngle(UP, yaw), tmpS.setScalar(1));
          M.foot.setMatrixAt(bi * 2 + k, tmpM2.multiply(f));
        }
      } else {
        // laser scanner over the shelf it is reading
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
      // carriers (physics body transform)
      if (s.cbody) {
        const ct = s.cbody.translation(), cr = s.cbody.rotation();
        const cm = tmpM.compose(tmpV.set(ct.x, ct.y, ct.z), tmpQ.set(cr.x, cr.y, cr.z, cr.w), tmpS.setScalar(1));
        if (s.carrier === 'trolley') M.trolley.setMatrixAt(M.trolleyIdx.get(s.si)!, cm); else M.basket.setMatrixAt(M.basketIdx.get(s.si)!, cm);
      }
      (s as Shopper & { handR?: THREE.Matrix4 }).handR = handR;
    }
    bus.door = door;

    // ---------- carried packs ----------
    const world_ = world;
    for (const c of Object.values(M.carried)) {
      c.beats.forEach((b, i) => {
        const s = byAgent.get(b.agentId);
        const sz = c.size;
        let m: THREE.Matrix4 | null = null;
        const fl = flights.current.get(b.id);
        const dropFlight = () => { if (fl) { try { world_.removeRigidBody(fl.body); } catch { /* */ } flights.current.delete(b.id); } };
        if (!s || !s.active || t < b.tGrab) { dropFlight(); if (t < b.tLaunch) baked.current.delete(b.id); c.mesh.setMatrixAt(i, ZERO); return; }
        const hand = (s as Shopper & { handR?: THREE.Matrix4 }).handR;
        const shelfM = b.shelf ? new THREE.Matrix4().compose(tmpV.set(b.shelf.x, b.shelf.y, b.shelf.z), tmpQ.identity(), tmpS.setScalar(1)) : null;
        const inHand = () => hand ? new THREE.Matrix4().multiplyMatrices(hand, new THREE.Matrix4().makeTranslation(0, -0.1, 0.06)) : null;
        if (b.kind === 'reject') {
          if (t < b.tPutBack) m = inHand();
          else if (t < b.tBack && shelfM && hand) {
            // toss it back: arc + spin from hand to its shelf spot
            const k = ease((t - b.tPutBack) / (b.tBack - b.tPutBack));
            const a = new THREE.Vector3().setFromMatrixPosition(hand), z = new THREE.Vector3(b.shelf!.x, b.shelf!.y, b.shelf!.z);
            const pos = a.lerp(z, k); pos.y += Math.sin(Math.PI * k) * 0.45;
            m = new THREE.Matrix4().compose(pos, tmpQ.setFromEuler(tmpE.set(k * 6.3, k * 3, 0)), tmpS.setScalar(1));
          } else m = null;
          if (m) m.multiply(new THREE.Matrix4().makeScale(sz.w * 1.6, sz.h * 1.6, sz.d * 1.6));
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
          // human pick: in hand → physics throw into the carrier → baked into the carrier
          if (t < b.tLaunch) { dropFlight(); baked.current.delete(b.id); m = inHand(); if (m) m.multiply(new THREE.Matrix4().makeScale(sz.w * 1.6, sz.h * 1.6, sz.d * 1.6)); }
          else if (s.cbody) {
            const ct = s.cbody.translation(), cr = s.cbody.rotation();
            const cm = new THREE.Matrix4().compose(new THREE.Vector3(ct.x, ct.y, ct.z), new THREE.Quaternion(cr.x, cr.y, cr.z, cr.w), new THREE.Vector3(1, 1, 1));
            const crossed = prev < b.tLaunch && t >= b.tLaunch && !jump;
            if (crossed && !fl && !baked.current.has(b.id) && hand) {
              const src = new THREE.Vector3().setFromMatrixPosition(hand).add(new THREE.Vector3(0, 0.05, 0));
              const dst = new THREE.Vector3(0, carrierDims(s.carrier).floor + 0.25, 0).applyMatrix4(cm);
              const T = Math.max(0.32, 0.62 / Math.sqrt(Math.max(1, speedRef.current)));
              const vel = dst.clone().sub(src).divideScalar(T); vel.y += 0.5 * 9.81 * T;
              const body = world_.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(src.x, src.y, src.z).setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: 6, y: 3, z: 2 }).setCcdEnabled(true));
              world_.createCollider(rapier.ColliderDesc.cuboid(sz.w / 2, sz.h / 2, sz.d / 2).setDensity(60).setRestitution(0.35).setFriction(0.8), body);
              flights.current.set(b.id, { body, born: now });
              sfx.pick();
            }
            const f2 = flights.current.get(b.id);
            if (f2) {
              const bt = f2.body.translation(), br = f2.body.rotation();
              const wm = new THREE.Matrix4().compose(new THREE.Vector3(bt.x, bt.y, bt.z), new THREE.Quaternion(br.x, br.y, br.z, br.w), new THREE.Vector3(1, 1, 1));
              const settled = f2.body.isSleeping() || now - f2.born > 1.5 || t > b.t1;
              if (settled) {
                const local = new THREE.Matrix4().copy(cm).invert().multiply(wm);
                const lp = new THREE.Vector3().setFromMatrixPosition(local), d = carrierDims(s.carrier);
                const inside = Math.abs(lp.x) < d.hx + 0.05 && Math.abs(lp.z) < d.hz + 0.05 && lp.y > d.floor - 0.05 && lp.y < d.floor + 1.2;
                baked.current.set(b.id, inside ? local : stackLocal(s.carrier, b.pickIdx, sz.h, new THREE.Matrix4()));
                dropFlight();
              }
              m = wm;
            }
            if (!m) {
              let local = baked.current.get(b.id);
              if (!local) { local = stackLocal(s.carrier, b.pickIdx, sz.h, new THREE.Matrix4()); baked.current.set(b.id, local); }
              m = new THREE.Matrix4().multiplyMatrices(cm, local);
            }
            m.multiply(new THREE.Matrix4().makeScale(sz.w, sz.h, sz.d));
          }
        }
        c.mesh.setMatrixAt(i, m ?? ZERO);
      });
      c.mesh.instanceMatrix.needsUpdate = true;
    }

    for (const m of [M.bean, M.beanInk, M.robot, M.robotInk, M.eye, M.eyeInk, M.pupil, M.arm, M.armInk, M.foot, M.blob, M.trolley, M.basket, M.beamCore, M.beamGlow, ...Object.values(M.parts)]) m.instanceMatrix.needsUpdate = true;

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
  const hover = (on: boolean) => () => { document.body.style.cursor = on ? 'pointer' : ''; };

  return (
    <group>
      <primitive object={meshes.group} />
      {/* click targets: the visible body meshes themselves */}
      <primitive object={meshes.bean} onClick={click(meshes.beanList)} onPointerOver={hover(true)} onPointerOut={hover(false)} />
      <primitive object={meshes.robot} onClick={click(meshes.robotList)} onPointerOver={hover(true)} onPointerOut={hover(false)} />
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

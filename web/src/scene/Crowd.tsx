// The crowd: replayed shoppers drawn as a handful of InstancedMeshes (one shared goggle-wearing capsule character for
// everyone, people and AI agents alike: body, ink hull, dungarees, goggles, eyes, mouth, hair, gloved arms, shoes,
// trolleys, carried packs), all written from ONE useFrame. No rapier bodies and no React state per frame:
// steering is a cheap 2D model in JS (feed-forward along the routed timeline + spring to the replay position +
// grid-hashed separation), so 300+ shoppers stay smooth. Decisions, products and order come ONLY from the run log
// (timelines/beats); the steering is a visual offset. Queues follow layout's scheduled slots (Timeline.queue /
// phase 'queue' segs, queueSlotPos) exactly, so lines never overlap and shuffle forward. Picks: reach, the pack leaves
// the shelf (shelfBus.takeFromShelf), arcs into the basket / trolley and stays there; rejects are inspected and put
// back (restockShelf). Stickers / thought bubbles / bonks are a small pool of sprites (max 12 nearest the camera).
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { Agent, Persona, Product, StoreConfig } from '../types';
import { isAI } from '../types';
import { BEAT, G, TILL, categoryHeight, sampleTimeline, storePlan, type CheckoutPlan, type Timeline } from '../layout';
import { SHOPPER_SKIN } from './parts';
import { archColor, archLabel, DECISION, BRAND_A, type Carrier } from '../theme';
import { archetypeOf } from '../stats';
import { aiKindOf, AI_KIND, type AiKind, GEO, BODY, TROLLEY, inkHull, trolleyGeometry, bagGeometry } from './parts';
import type { Beat, Beats } from './beats';
import { bus, sfx } from './fx';
import { stackLocal } from './Basket';
import { restockShelf, takeFromShelf } from './shelfBus';
import { crowdStats, emitCrowd } from './crowdBus';
import { emitCafe } from './cafe/cafeState';

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
  si: number; agent: Agent; ai: boolean; aiKind: AiKind | null; arch: string; label: string; color: THREE.Color; carrier: Carrier; tl: Timeline; beats: Beat[];
  /** pick / reject beats only (the ones that move a pack) */
  hands: Beat[];
  active: boolean; held: number; cool: number; step: number; sq: number; sqv: number;
  px: number; pz: number; vx: number; vz: number; yaw: number; kx: number; kz: number;
  qR: THREE.Quaternion; qL: THREE.Quaternion; strR: number; strL: number; look: THREE.Vector3;
  R: THREE.Matrix4; handR: THREE.Matrix4; handL: THREE.Matrix4; carrierM: THREE.Matrix4;
  /** look: one big goggle or two; tuft of hair; blink period / phase */
  oneEye: boolean; hair: boolean; blinkP: number; blinkO: number;
  /** clock time until which this shopper waves (after a bonk) */
  wave: number;
  laneOff: number;
  co: CheckoutPlan | null; park: THREE.Matrix4 | null; cafeT: [number, number] | null;
  queued: boolean;
}

const tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpM3 = new THREE.Matrix4(), tmpM4 = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpQ3 = new THREE.Quaternion(), tmpQ4 = new THREE.Quaternion();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** within a pick/reject dwell (fractions of the dwell): step up to the shelf, start reaching, step back */
const REACH = { approach: 0.14, reach0: 0.1, leave: 0.88 } as const;
/** how far from the pack's shelf point the shopper stands while reaching (m). assumption: visual only */
const REACH_D = { basket: 0.72, trolley: 0.8, none: 0.72 } as const;
const SPAWN_CLEAR = 1.05; // m: a door only lets the next shopper in once the last one has stepped clear
const SPAWN_MAX_HOLD = 6; // replay s: never hold anyone at the door longer than this
const BONK_WORDS = ['bonk!', 'oof!', 'boing!', 'sorry!', 'bump!', 'whoops!', 'mind out!', 'ope!'];
const CELL = 1.25;
const MAX_STICKERS = 12, MAX_BONKS = 6;
/** shoppers further than this from the camera skip the small parts (eyes, pupils, feet, accessories) */
const DETAIL_R = 38;
const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + 2048) * 4096 + (Math.floor(z / CELL) + 2048);
const SHOULDER_R = new THREE.Vector3(BODY.shoulderX, BODY.shoulderY, 0.02), SHOULDER_L = new THREE.Vector3(-BODY.shoulderX, BODY.shoulderY, 0.02);
/** trolley push pose (body frame): each gloved hand on the handle bar, rubber arms stretched to reach it */
const HANDLE_Y = TROLLEY.floorY + TROLLEY.wallH + TROLLEY.handleUp + TROLLEY.anchor[1] + BODY.center, HANDLE_Z = TROLLEY.anchor[2] - TROLLEY.hz - 0.1;
const PUSH = ([1, -1] as const).map((sd) => {
  const d = new THREE.Vector3(sd * 0.22, HANDLE_Y, HANDLE_Z).sub(sd > 0 ? SHOULDER_R : SHOULDER_L);
  return { q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.clone().normalize()), str: d.length() / BODY.armLen };
});

/** classic pose: pitch θ about x, then roll φ about z (φ>0 = outward) */
function poseQ(out: THREE.Quaternion, side: 1 | -1, th: number, ph: number) { return out.setFromEuler(tmpE.set(th, 0, side * ph, 'ZXY')); }

function carriedSize(code: string, products: Record<string, Product>) {
  const cat = products[code]?.category ?? '';
  return { w: 0.17, h: Math.max(0.1, categoryHeight(cat) * 0.5), d: 0.12 };
}
/** string → [0,1) (seeded, stable across reloads) */
function hash01(str: string) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }

/** where the carrier is parked while its owner checks out: trolley behind them in the lane, basket on the counter / floor */
function parkMatrix(co: CheckoutPlan | null, c: Carrier): THREE.Matrix4 | null {
  if (!co || c === 'none') return null;
  const L = co.lane;
  if (c === 'trolley') return new THREE.Matrix4().compose(new THREE.Vector3(L.stand.x + L.queueDir.x * 1.05, 0, L.stand.z + L.queueDir.z * 1.05), new THREE.Quaternion().setFromAxisAngle(UP, Math.atan2(-L.queueDir.x, -L.queueDir.z)), new THREE.Vector3(1, 1, 1));
  if (L.kind === 'staffed' && L.beltStart) return new THREE.Matrix4().compose(new THREE.Vector3(L.beltStart.x - 0.02, 0.96, L.beltStart.z - 0.12), new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2), new THREE.Vector3(1, 1, 1));
  return new THREE.Matrix4().compose(new THREE.Vector3(L.stand.x - 0.5, 0, L.stand.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
}

/** café visit window: from reaching the café entrance until back out of it (Cafe.tsx draws them meanwhile).
 *  layout's café leg is: door → inside → counter → (hold cafe) → seat → (hold cafe) → 2 moves → door */
function cafeWindow(tl: Timeline): [number, number] | null {
  const i0 = tl.segs.findIndex((x) => x.phase === 'cafe');
  if (i0 < 0) return null;
  let i1 = i0; for (let i = i0; i < tl.segs.length; i++) if (tl.segs[i].phase === 'cafe') i1 = i;
  const start = i0 >= 3 ? tl.segs[i0 - 3].t1 : tl.segs[i0].t0;
  const end = tl.segs[Math.min(tl.segs.length - 1, i1 + 3)].t1;
  return end > start ? [start, end] : null;
}

/** visual carrier: everyone (people and AI agents) pushes the same trolley. Checkout lane choice still uses the
 *  data carrier (theme.carrierFor in App), so queues / lanes are unchanged */
const CARRIER: Carrier = 'trolley';

// ---------- sprite labels (canvas textures, cached) ----------
const texCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) {
    const nx = cur ? `${cur} ${w}` : w;
    if (g.measureText(nx).width > maxW && cur) { lines.push(cur); cur = w; if (lines.length === maxLines) break; } else cur = nx;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  return lines;
}
/** pill sticker (emoji + optional word) or speech/thought bubble with a product line */
/** decoration only: a word of minion-speak for a bubble heading, chosen by the beat id. never part of a logged reason */
const MINIONESE: Record<string, string[]> = {
  pick: ['baboi!', 'banana!', 'tank yu!', 'bello!'],
  reject: ['bee-do bee-do', 'no no no', 'poka?'],
  glance: ['poopaye', 'la la la', 'hmm'],
};
const minionese = (kind: string, id: number) => { const w = MINIONESE[kind] ?? MINIONESE.glance; return w[Math.abs(id) % w.length]; };

function labelTex(key: string, draw: () => { lines: string[]; head?: string; color: string; bubble: boolean }) {
  const hit = texCache.get(key); if (hit) return hit;
  const { lines, head, color, bubble } = draw();
  const S = 2, font = bubble ? 26 : 30, pad = bubble ? 18 : 14, lh = font * 1.25;
  const c = document.createElement('canvas'); const g = c.getContext('2d')!;
  g.font = `600 ${font}px system-ui, sans-serif`;
  const hf = `800 ${font * 0.85}px system-ui, sans-serif`;
  let w = 0; for (const l of lines) w = Math.max(w, g.measureText(l).width);
  if (head) { g.font = hf; w = Math.max(w, g.measureText(head).width); }
  const W = Math.ceil(w + pad * 2), H = Math.ceil(lines.length * lh + (head ? lh * 0.9 : 0) + pad * 2 + (bubble ? 14 : 0));
  c.width = W * S; c.height = H * S; g.scale(S, S);
  const bh = bubble ? H - 14 : H;
  g.fillStyle = '#fffdf8'; g.strokeStyle = '#2a1a22'; g.lineWidth = 4;
  roundRect(g, 2, 2, W - 4, bh - 4, bubble ? 18 : (bh - 4) / 2); g.fill(); g.stroke();
  if (bubble) { g.beginPath(); g.moveTo(W / 2 - 10, bh - 3); g.lineTo(W / 2, H - 2); g.lineTo(W / 2 + 10, bh - 3); g.fill(); g.stroke(); }
  g.fillStyle = color; g.fillRect(bubble ? 12 : bh / 2, bh - 9, W - (bubble ? 24 : bh), 4);
  let y = pad + font * 0.9;
  if (head) { g.font = hf; g.fillStyle = color; g.fillText(head, pad, y); y += lh * 0.9; }
  g.font = `600 ${font}px system-ui, sans-serif`; g.fillStyle = '#2a1a22';
  for (const l of lines) { g.fillText(l, pad, y); y += lh; }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 2;
  const out = { tex, aspect: W / H };
  if (texCache.size > 96) { const [k0, v0] = texCache.entries().next().value as [string, { tex: THREE.CanvasTexture }]; v0.tex.dispose(); texCache.delete(k0); }
  texCache.set(key, out);
  return out;
}

interface Slot { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; key: string; si: number; beat: Beat | null; h: number; y: number; aspect: number }
interface Bonk { x: number; z: number; until: number; slot: number }

const HIT_M = new THREE.Matrix4();

export function Crowd({ cfg, agents, timelines, beats, timeRef, personas, products, selectedAgent, onAgent, onEvent, thoughts, speed }: Props) {
  const speedRef = useRef(speed); speedRef.current = speed;
  const thoughtsRef = useRef(thoughts); thoughtsRef.current = thoughts;
  const selRef = useRef(selectedAgent); selRef.current = selectedAgent;
  const SP = useMemo(() => storePlan(cfg), [cfg]);
  const camera = useThree((st) => st.camera), controls = useThree((st) => st.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;

  // ---------- shoppers (data) ----------
  const shoppers = useMemo<Shopper[]>(() => agents.filter((a) => timelines[a.agent_id]).map((a, si) => {
    const ai = isAI(a) || a.persona_id?.startsWith('ai_') || (a as { kind?: string }).kind === 'ai_agent';
    // ai shoppers are labelled by archetype (persona_id / archetype), never by model
    const arch = ai ? (a.archetype ?? personas[a.persona_id]?.archetype ?? a.persona_id) : archetypeOf(a, personas);
    const aiKind: AiKind | null = ai ? aiKindOf(`${arch} ${a.persona_id}`) : null;
    const tl = timelines[a.agent_id];
    const carrier = CARRIER;
    const h = hash01(a.agent_id);
    const bs = beats.byAgent[a.agent_id] ?? [];
    return {
      si, agent: a, ai, aiKind, arch, label: aiKind ? `🤖 ${archLabel(arch) || AI_KIND[aiKind].label}` : archLabel(arch),
      color: new THREE.Color(aiKind ? AI_KIND[aiKind].body : archColor(arch)), carrier, tl, beats: bs,
      hands: bs.filter((b) => (b.kind === 'pick' || b.kind === 'reject') && !!b.code && !!products[b.code]),
      active: false, held: 0, cool: 0, step: hash01(a.agent_id) * 6, sq: 0, sqv: 0,
      px: 0, pz: -999, vx: 0, vz: 0, yaw: 0, kx: 0, kz: 0,
      qR: poseQ(new THREE.Quaternion(), 1, 0, 0.12), qL: poseQ(new THREE.Quaternion(), -1, 0, 0.12), strR: 1, strL: 1,
      look: new THREE.Vector3(0, 0, 1), R: new THREE.Matrix4(), handR: new THREE.Matrix4(), handL: new THREE.Matrix4(), carrierM: new THREE.Matrix4(),
      oneEye: h < 0.38, hair: ((h * 7.3) % 1) > 0.22, blinkP: 2.6 + ((h * 13.7) % 1) * 3.2, blinkO: ((h * 31.1) % 1) * 6, wave: 0,
      // keep left (UK) by direction of travel + a per-shopper golden-ratio spread so a crowd fills the walkway width
      laneOff: -(0.25 + ((si * 0.6180339) % 1) * 0.9) * 0.8,
      co: tl.checkout ?? null, park: parkMatrix(tl.checkout ?? null, carrier), cafeT: cafeWindow(tl), queued: false,
    };
  }), [agents, timelines, personas, beats, products]);
  const byAgent = useMemo(() => new Map(shoppers.map((s) => [s.agent.agent_id, s])), [shoppers]);

  useEffect(() => {
    const w = window as unknown as { __crowd?: Record<string, unknown> };
    if (!w.__crowd) return;
    w.__crowd.dump = () => ({ people: shoppers.filter((s) => s.active).map((s) => ({ id: s.agent.agent_id, x: +s.px.toFixed(2), z: +s.pz.toFixed(2), q: s.queued, c: s.carrier, ai: s.ai })) });
    w.__crowd.queues = () => {
      const out: Record<string, { id: string; x: number; z: number }[]> = {};
      for (const s of shoppers) if (s.active && s.queued && s.tl.queue) (out[s.tl.queue.group] ??= []).push({ id: s.agent.agent_id, x: +s.px.toFixed(2), z: +s.pz.toFixed(2) });
      return out;
    };
    w.__crowd.focus = (x: number, z: number, h = 9, back = 7) => { camera.position.set(x, h, z + back); controls?.target.set(x, 0.6, z); controls?.update(); };
    w.__crowd.stickers = () => pools.stickers.filter((x) => x.sprite.visible).map((x) => ({ key: x.key, at: x.sprite.position.toArray().map((v) => +v.toFixed(1)) }));
    w.__crowd.lanes = () => SP.lanes.map((l) => [l.id, l.kind, +l.x.toFixed(1), +l.z.toFixed(1)]);
  }, [shoppers, camera, controls, SP]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- instanced meshes ----------
  const meshes = useMemo(() => {
    const N = shoppers.length;
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], n: number) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      m.count = n; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < Math.max(1, n); i++) m.setMatrixAt(i, ZERO);
      return m;
    };
    const ink = '#1d1b22';
    const bodyGeo = GEO.body();
    const body = mk(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.02 }), N);
    const bodyInk = mk(bodyGeo, inkHull(0.026), N);
    const overalls = mk(GEO.overalls(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), N);
    const strap = mk(GEO.strap(), new THREE.MeshStandardMaterial({ color: '#232127', roughness: 0.6 }), N);
    const rim = mk(GEO.rim(), new THREE.MeshStandardMaterial({ color: '#e4e8ef', roughness: 0.22, metalness: 0.35, emissive: '#8a909c', emissiveIntensity: 0.35 }), N * 2);
    const eye = mk(GEO.eye(), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.12 }), N * 2);
    const iris = mk(GEO.iris(), new THREE.MeshBasicMaterial({ vertexColors: true }), N * 2);
    const mouth = mk(GEO.mouth(), new THREE.MeshBasicMaterial({ color: ink, side: THREE.DoubleSide }), N);
    const hair = mk(GEO.hair(), new THREE.MeshBasicMaterial({ color: ink }), N);
    const arm = mk(GEO.arm(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42 }), N * 2);
    const foot = mk(GEO.foot(), new THREE.MeshStandardMaterial({ color: '#17151a', roughness: 0.45 }), N * 2);
    const blob = mk(GEO.blob(), new THREE.MeshBasicMaterial({ color: '#7a3550', transparent: true, opacity: 0.18, depthWrite: false }), N);
    const trolley = mk(trolleyGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25 }), N);
    const c = new THREE.Color();
    // every shopper is the same yellow character; the shopper-type colour is on the overalls (legend still reads)
    const skin = new THREE.Color(SHOPPER_SKIN), skinArm = skin.clone().multiplyScalar(0.94);
    shoppers.forEach((s) => { body.setColorAt(s.si, skin); overalls.setColorAt(s.si, s.color); arm.setColorAt(s.si * 2, skinArm); arm.setColorAt(s.si * 2 + 1, skinArm); });
    if (!N) overalls.setColorAt(0, c.set('#fff'));
    if (!N) { body.setColorAt(0, c.set('#fff')); arm.setColorAt(0, c); }
    // carried packs: ONE instanced box for every pick / reject beat, tinted per product (no per-SKU draw calls)
    const packIdx = new Map<number, number>(); const packSize: { w: number; h: number; d: number }[] = [];
    let np = 0; for (const s of shoppers) for (const b of s.hands) { packIdx.set(b.id, np); packSize[np] = carriedSize(b.code, products); np++; }
    const pack = mk(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), np);
    const pc = new THREE.Color();
    for (const s of shoppers) for (const b of s.hands) pc.setHSL(hash01(products[b.code]?.brand ?? b.code), 0.62, 0.55), pack.setColorAt(packIdx.get(b.id)!, pc);
    if (!np) pack.setColorAt(0, pc.set('#fff'));
    const bag = mk(bagGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), N);
    // invisible, generous click target per shopper (a shopper is a few pixels from the overview camera)
    const hit = mk(new THREE.CylinderGeometry(0.85, 0.85, 2.1, 10).translate(0, 1.05, 0), new THREE.MeshBasicMaterial({ visible: false }), N);
    for (const m of [body, arm, pack]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    const group = new THREE.Group();
    const all = [body, bodyInk, overalls, strap, rim, eye, iris, mouth, hair, arm, foot, blob, trolley, bag, pack, hit];
    group.add(...all.filter((m) => m !== body && m !== hit));
    return { group, all, hit, body, bodyInk, overalls, strap, rim, eye, iris, mouth, hair, arm, foot, blob, trolley, bag, pack, packIdx, packSize };
  }, [shoppers, products]);
  useEffect(() => () => {
    for (const m of meshes.all) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); }
  }, [meshes]);

  // ---------- sprite pools (stickers + thought bubbles, bonks, hover label) ----------
  const pools = useMemo(() => {
    const group = new THREE.Group(); group.renderOrder = 10;
    const mkSlot = (): Slot => {
      const mat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: true });
      const sprite = new THREE.Sprite(mat); sprite.visible = false; sprite.renderOrder = 10; sprite.center.set(0.5, 0);
      group.add(sprite);
      return { sprite, mat, key: '', si: -1, beat: null, h: 0.3, y: 1.9, aspect: 1 };
    };
    const stickers = Array.from({ length: MAX_STICKERS }, mkSlot);
    const bonks = Array.from({ length: MAX_BONKS }, mkSlot);
    const hover = mkSlot();
    return { group, stickers, bonks, hover };
  }, []);
  useEffect(() => () => { for (const s of [...pools.stickers, ...pools.bonks, pools.hover]) s.mat.dispose(); }, [pools]);
  const setSlot = (sl: Slot, key: string, mk: () => { tex: THREE.CanvasTexture; aspect: number }, h: number) => {
    if (sl.key !== key) { const { tex, aspect } = mk(); sl.mat.map = tex; sl.mat.needsUpdate = true; sl.key = key; sl.aspect = aspect; }
    sl.sprite.scale.set(h * sl.aspect, h, 1); sl.h = h; sl.sprite.visible = true;
  };

  // ---------- packs off the shelf ----------
  /** beats whose pack is currently off the shelf (taken via shelfBus) */
  const taken = useRef(new Map<number, Beat>());
  /** hand position at the moment of the throw (for the arc into the carrier) */
  const launchAt = useRef(new Map<number, THREE.Vector3>());
  useEffect(() => () => {
    for (const b of taken.current.values()) if (b.kind === 'reject') restockShelf(b.shelfSlot, b.code, 1);
    taken.current.clear(); launchAt.current.clear();
  }, [shoppers]);

  // ---------- per frame ----------
  const grid = useRef(new Map<number, number[]>());
  const lastT = useRef(0);
  const bonkList = useRef<Bonk[]>([]);
  const lastSticker = useRef(0);
  const selRing = useRef<THREE.Mesh>(null);
  const hovered = useRef<number | null>(null);
  const camP = new THREE.Vector3();

  const near = (x: number, z: number, r: number, skip: number, fn: (o: Shopper, dx: number, dz: number, d: number) => void) => {
    const g = grid.current;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const list = g.get((ix + 2048) * 4096 + (iz + 2048)); if (!list) continue;
      for (let j = 0; j < list.length; j++) {
        const oi = list[j]; if (oi === skip) continue;
        const o = shoppers[oi];
        const dx = x - o.px, dz = z - o.pz, d = Math.hypot(dx, dz);
        if (d < r) fn(o, dx, dz, d);
      }
    }
  };
  const beatOf = (s: Shopper, t: number): Beat | null => {
    const bs = s.beats; let lo = 0, hi = bs.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (bs[m].t1 <= t) lo = m + 1; else if (bs[m].t0 > t) hi = m - 1; else return bs[m]; }
    return null;
  };
  /** which arm grabs: baskets hang on the left so the right hand grabs; trolley pushers reach with the shelf-side arm */
  const grabSide = (s: Shopper, b: Beat): 1 | -1 => {
    if (s.carrier !== 'trolley' || !b.shelf) return 1;
    const lx = Math.cos(s.yaw) * (b.shelf.x - s.px) - Math.sin(s.yaw) * (b.shelf.z - s.pz);
    return lx >= 0 ? 1 : -1;
  };

  useFrame((state, rdt) => {
    const t = timeRef.current;
    const now = state.clock.elapsedTime;
    const dt = Math.min(rdt, 0.05);
    const sp = speedRef.current;
    const prev = lastT.current;
    const jump = Math.abs(t - prev) > Math.max(1.2, sp * 0.25);
    lastT.current = t;
    const crossed = (x: number) => !jump && prev < x && t >= x;
    const M = meshes;
    camP.copy(state.camera.position);
    if (jump) for (const [id, b] of taken.current) {
      if (t < b.tGrab || (b.kind === 'reject' && t >= b.tBack)) { restockShelf(b.shelfSlot, b.code, 1); taken.current.delete(id); }
    }

    // neighbour grid from last frame's positions
    const g = grid.current; g.clear();
    for (const s of shoppers) {
      if (!s.active) continue;
      const k = cellKey(s.px, s.pz); const l = g.get(k); if (l) l.push(s.si); else g.set(k, [s.si]);
    }
    const doorPts = [...SP.entrances, ...SP.exits];
    const doors = doorPts.map(() => 0);

    for (const s of shoppers) {
      const smp = sampleTimeline(s.tl, t);
      const inCafe = !!s.cafeT && t >= s.cafeT[0] && t < s.cafeT[1];
      if (s.cafeT && !jump) {
        const c = s.cafeT;
        if (prev < c[0] && t >= c[0]) {
          emitCafe({ type: 'cafe_enter', shopperId: s.agent.agent_id, t });
          emitCrowd({ type: 'cafe_enter', shopperId: s.agent.agent_id, agentId: s.agent.agent_id, t, tEnd: c[1], seat: s.tl.cafeSeat ?? null, x: smp.x, z: smp.z, color: '#' + s.color.getHexString(), arch: s.arch });
        }
        if (prev < c[1] && t >= c[1]) emitCrowd({ type: 'cafe_leave', shopperId: s.agent.agent_id, agentId: s.agent.agent_id, t, x: smp.x, z: smp.z });
      }
      if (!smp.visible || inCafe) {
        if (s.active) { s.active = false; hideShopper(s); }
        s.held = 0;
        continue;
      }
      const seg = smp.seg;
      s.queued = seg?.phase === 'queue' || (!!s.tl.queue && t >= s.tl.queue.tJoin && t < s.tl.queue.tServe);
      if (!s.active) {
        // door spacing: wait outside until whoever came in last has stepped clear, then walk in and catch up
        const sp0 = s.tl.segs[0]?.a;
        const early = !!sp0 && !jump && t - s.tl.start < SPAWN_MAX_HOLD + 2;
        let blocked = false;
        if (early) near(sp0!.x, sp0!.z, SPAWN_CLEAR, s.si, () => { blocked = true; });
        if (blocked && t - s.tl.start < SPAWN_MAX_HOLD) { s.held = t; hideShopper(s); continue; }
        s.active = true;
        s.px = early ? sp0!.x : smp.x; s.pz = early ? sp0!.z : smp.z; s.vx = s.vz = 0; s.kx = s.kz = 0; s.yaw = smp.heading;
        if (early) emitCrowd({ type: 'enter', agentId: s.agent.agent_id, door: s.si % Math.max(1, SP.entrances.length), t });
      }
      const parked = !!(s.co && s.park && t >= s.co.tArrive);
      // ---- steering target ----
      let tx = smp.x, tz = smp.z, want = smp.heading, fx = 0, fz = 0;
      const busy = seg?.kind !== 'move' || s.queued;
      const b = beatOf(s, t);
      if (seg?.kind === 'move' && seg.t1 > seg.t0) {
        const k = sp / (seg.t1 - seg.t0); fx = (seg.b.x - seg.a.x) * k; fz = (seg.b.z - seg.a.z) * k;
        // walk your own line: sideways offset, tapered to zero at both ends of the segment (not in queues / exits)
        if (s.laneOff && !seg.phase) {
          const sx = seg.b.x - seg.a.x, sz = seg.b.z - seg.a.z, L = Math.hypot(sx, sz);
          if (L > 0.5) {
            const da = Math.hypot(tx - seg.a.x, tz - seg.a.z), db = Math.hypot(seg.b.x - tx, seg.b.z - tz);
            const taper = Math.min(1, da / 1.6, db / 1.6);
            tx += (-sz / L) * s.laneOff * taper; tz += (sx / L) * s.laneOff * taper;
          }
        }
      }
      if (b && b.shelf && (b.kind === 'pick' || b.kind === 'reject')) {
        // step up to the exact facing, then step back
        const u = (t - b.t0) / Math.max(1e-3, b.t1 - b.t0);
        const k = ease(u / REACH.approach) * ease((1 - u) / (1 - REACH.leave));
        const nx = b.shelf.x - smp.x, nz = b.shelf.z - smp.z, nd = Math.hypot(nx, nz);
        const go = Math.max(0, nd - REACH_D[s.carrier]) * k;
        if (nd > 1e-3) { tx += (nx / nd) * go; tz += (nz / nd) * go; }
        if (s.carrier === 'trolley') want = smp.heading + angDiff(smp.heading, 0);
      }
      // ---- integrate (cheap 2D: feed-forward + spring + separation) ----
      let dx = tx - s.px, dz = tz - s.pz;
      if (jump || dx * dx + dz * dz > 14 * 14) { s.px = tx; s.pz = tz; s.vx = s.vz = 0; s.yaw = want; dx = dz = 0; }
      else {
        let sx = 0, sz = 0;
        if (!s.queued) {
          const R0 = 1.0;
          const fm = Math.hypot(fx, fz) || 1;
          near(s.px, s.pz, R0, s.si, (o, ddx, ddz, dd) => {
            if (dd < 1e-4) { ddx = Math.sin(s.si); ddz = Math.cos(s.si); dd = 1; }
            const wgt = (R0 - dd) / R0 + Math.max(0, 0.6 - dd) * 6;
            sx += (ddx / dd) * wgt; sz += (ddz / dd) * wgt;
            if (!busy && (-(ddx * fx + ddz * fz) / (dd * fm)) > 0.5) { sx += (-fz / fm) * wgt * 0.8; sz += (fx / fm) * wgt * 0.8; }
            // bonk: two walkers closing fast and touching
            if (dd < 0.58 && o.si > s.si && s.cool < now && o.cool < now && !o.queued) {
              const closing = -((s.vx - o.vx) * ddx + (s.vz - o.vz) * ddz) / dd;
              if (closing > 1.0 && sp <= 4) {
                const kick = Math.min(3, 1.4 + closing * 0.6);
                s.kx += (ddx / dd) * kick; s.kz += (ddz / dd) * kick; o.kx -= (ddx / dd) * kick; o.kz -= (ddz / dd) * kick;
                s.sqv -= 3.4; o.sqv -= 3.4; s.cool = o.cool = now + 1.4; s.wave = o.wave = now + 1.2;
                bus.bonks++; bus.shake = Math.min(1, bus.shake + 0.25); sfx.bonk();
                emitCrowd({ type: 'bonk', a: s.agent.agent_id, b: o.agent.agent_id, x: (s.px + o.px) / 2, z: (s.pz + o.pz) / 2 });
                const bl = bonkList.current; if (bl.length < MAX_BONKS) bl.push({ x: (s.px + o.px) / 2, z: (s.pz + o.pz) / 2, until: now + 0.9, slot: -1 });
              }
            }
          });
        }
        const sepGain = busy ? 0.9 : 2.2, gain = s.queued ? 4.5 : 3.2;
        let vx = fx + dx * gain + s.kx + sx * sepGain, vz = fz + dz * gain + s.kz + sz * sepGain;
        const walk = (s.ai ? G.aiWalkSpeed : G.walkSpeed) * sp;
        const vmax = walk * 1.7 + 1.4, vm = Math.hypot(vx, vz);
        if (vm > vmax) { vx *= vmax / vm; vz *= vmax / vm; }
        if (!Number.isFinite(vx) || !Number.isFinite(vz)) { vx = 0; vz = 0; }
        const a = 1 - Math.exp(-dt * 10);
        s.vx += (vx - s.vx) * a; s.vz += (vz - s.vz) * a;
        s.px += s.vx * dt; s.pz += s.vz * dt;
        // hard constraint: bodies never interpenetrate (queued shoppers hold their slot; others give way)
        if (!s.queued) near(s.px, s.pz, 0.62, s.si, (o, ddx, ddz, dd) => {
          if (dd < 1e-4) return;
          const push = (0.62 - dd) * (o.queued ? 1 : 0.5);
          s.px += (ddx / dd) * push; s.pz += (ddz / dd) * push;
        });
        const kd = Math.exp(-dt / 0.28); s.kx *= kd; s.kz *= kd;
        const spd0 = Math.hypot(s.vx, s.vz);
        // face where you walk while moving, else the timeline's facing
        const face = !busy && spd0 > 0.4 ? Math.atan2(s.vx, s.vz) : want;
        s.yaw += angDiff(s.yaw, face) * (1 - Math.exp(-dt * 7));
      }
      for (let di = 0; di < doorPts.length; di++) if (Math.abs(s.px - doorPts[di].x) < 2.4 && Math.abs(s.pz - doorPts[di].z) < 3.2) doors[di]++;
      drawShopper(s, b, t, now, dt, parked, crossed);
    }
    bus.doors = doors;

    // ---- carried packs ----
    for (const s of shoppers) for (const b of s.hands) drawPack(s, b, t, now, crossed);
    for (const m of M.all) m.instanceMatrix.needsUpdate = true;
    // InstancedMesh caches its bounding sphere on the first raycast; shoppers move, so drop it and let the
    // next click recompute it (otherwise clicks on shoppers who walked out of the first sphere are ignored)
    M.hit.boundingSphere = null; M.body.boundingSphere = null;

    // selection ring + follow cam feed
    const sel = selRef.current ? byAgent.get(selRef.current) : undefined;
    if (selRing.current) {
      selRing.current.visible = !!sel?.active;
      if (sel?.active) { selRing.current.position.set(sel.px, 0.02, sel.pz); selRing.current.rotation.z = now * 1.5; }
    }
    bus.follow = sel?.active ? { x: sel.px, z: sel.pz, heading: sel.yaw } : null;

    // hover label
    const hs = hovered.current !== null ? shoppers[hovered.current] : null;
    const hv = pools.hover;
    if (hs?.active) { setSlot(hv, 'h:' + hs.label, () => labelTex('h:' + hs.label, () => ({ lines: [hs.label], color: '#' + hs.color.getHexString(), bubble: false })), 0.28); hv.sprite.position.set(hs.px, 1.55, hs.pz); }
    else hv.sprite.visible = false;

    // bonk pops
    const bl = bonkList.current;
    for (let i = bl.length - 1; i >= 0; i--) if (bl[i].until < now) bl.splice(i, 1);
    pools.bonks.forEach((sl, i) => {
      const k = bl[i]; if (!k) { sl.sprite.visible = false; return; }
      const word = BONK_WORDS[i % BONK_WORDS.length];
      setSlot(sl, 'b:' + word, () => labelTex('b:' + word, () => ({ lines: ['💥 ' + word], color: '#ff5a3c', bubble: false })), 0.32);
      sl.sprite.position.set(k.x, 1.75 + (0.9 - (k.until - now)) * 0.5, k.z);
    });

    // stickers + thought bubbles: re-pick the 12 nearest at 8 Hz; positions follow their shopper every frame
    if (now - lastSticker.current > 0.12 || jump) {
      lastSticker.current = now;
      let act = 0, qd = 0, ov = 0;
      const cand: { s: Shopper; b: Beat; d: number; rd: number }[] = [];
      for (const s of shoppers) {
        if (!s.active) continue;
        act++; if (s.queued) qd++;
        if (!s.ai && !s.queued) near(s.px, s.pz, BODY.r * 2 - 0.08, s.si, (o) => { if (!o.ai && o.si > s.si && !o.queued) ov++; });
        const b = beatOf(s, t) ?? beatOf(s, t - 0.5);
        if (!b || b.kind === 'ignore' || (s.ai && b.kind !== 'pick')) continue;
        if (b.kind === 'pick' && t < b.tLaunch) continue;
        if (b.kind === 'reject' && t < b.tGrab + 0.25 * (b.t1 - b.t0)) continue;
        const rd = Math.hypot(camP.x - s.px, camP.y - 1.8, camP.z - s.pz);
        cand.push({ s, b, d: rd - (b.agentId === selRef.current ? 1000 : 0), rd });
      }
      crowdStats.active = act; crowdStats.overlaps = ov; crowdStats.queued = qd; crowdStats.flights = launchAt.current.size; crowdStats.inCarriers = taken.current.size;
      cand.sort((a, b) => a.d - b.d);
      const th = thoughtsRef.current;
      pools.stickers.forEach((sl, i) => {
        const c = cand[i];
        if (!c) { sl.sprite.visible = false; sl.si = -1; sl.beat = null; return; }
        const { s, b } = c;
        const isNear = c.rd < 16;
        const grow = Math.min(2.6, Math.max(1, c.rd / 14));
        const isSel = b.agentId === selRef.current;
        const words = isNear && !!b.reason && (th === 'all' || (th === 'selected' && isSel)) && (b.kind === 'reject' || (b.kind === 'pick' && th === 'all' && !s.ai));
        const dk = DECISION[b.kind === 'pick' ? 'pick' : b.kind === 'reject' ? 'reject' : 'walk_past'];
        const word = s.ai && b.kind === 'pick' ? 'added to cart' : b.kind === 'pick' ? 'picked!' : b.kind === 'reject' ? 'nope' : 'walked past';
        const emoji = b.kind === 'glance' ? '👀' : dk.emoji;
        if (words) {
          const prod = products[b.code];
          const key = `t:${b.id}`;
          setSlot(sl, key, () => labelTex(key, () => {
            const cv = document.createElement('canvas').getContext('2d')!; cv.font = '600 26px system-ui, sans-serif';
            // the reason is the shopper's logged words and stays untouched; only the bubble's heading gets a chirp
            const chirp = s.ai ? '' : ` · ${minionese(b.kind, b.id)}`;
            return { head: `${emoji} ${prod ? prod.brand : b.code}${chirp}`, lines: wrap(cv, b.reason, 380, b.kind === 'reject' ? 3 : 2), color: dk.color, bubble: true };
          }), (b.kind === 'reject' ? 0.62 : 0.5) * grow);
        } else {
          const key = `s:${b.kind}:${s.ai ? 1 : 0}:${isNear ? 1 : 0}`;
          setSlot(sl, key, () => labelTex(key, () => ({ lines: [isNear ? `${emoji} ${word}` : emoji], color: dk.color, bubble: false })), (isNear ? 0.24 : 0.3) * grow);
        }
        sl.si = s.si; sl.beat = b; sl.y = 1.85;
      });
    }
    for (const sl of pools.stickers) {
      if (sl.si < 0) continue;
      const s = shoppers[sl.si];
      if (!s.active) { sl.sprite.visible = false; continue; }
      sl.sprite.position.set(s.px, sl.y, s.pz);
    }
  });

  // ---------- drawing helpers (called from the one useFrame) ----------
  function hideShopper(s: Shopper) {
    const M = meshes, i = s.si;
    M.hit.setMatrixAt(i, ZERO); M.body.setMatrixAt(i, ZERO); M.bodyInk.setMatrixAt(i, ZERO); M.overalls.setMatrixAt(i, ZERO); M.strap.setMatrixAt(i, ZERO);
    M.mouth.setMatrixAt(i, ZERO); M.hair.setMatrixAt(i, ZERO); M.blob.setMatrixAt(i, ZERO); M.bag.setMatrixAt(i, ZERO); M.trolley.setMatrixAt(i, ZERO);
    for (let k = 0; k < 2; k++) { const j = i * 2 + k; M.arm.setMatrixAt(j, ZERO); M.eye.setMatrixAt(j, ZERO); M.rim.setMatrixAt(j, ZERO); M.iris.setMatrixAt(j, ZERO); M.foot.setMatrixAt(j, ZERO); }
    for (const b of s.hands) M.pack.setMatrixAt(M.packIdx.get(b.id)!, ZERO);
  }

  function drawShopper(s: Shopper, b: Beat | null, t: number, now: number, dt: number, parked: boolean, crossed: (x: number) => boolean) {
    const M = meshes;
    const R = s.R, i = s.si;
    const spd = Math.hypot(s.vx, s.vz);
    const moving = spd > 0.25;
    const detail = (camP.x - s.px) ** 2 + (camP.z - s.pz) ** 2 + camP.y * camP.y < DETAIL_R * DETAIL_R || s.agent.agent_id === selRef.current;
    s.step += dt * (4 + spd * 5.5) * (moving ? 1 : 0.25);
    s.sqv += (-140 * s.sq - 10 * s.sqv) * dt; s.sq += s.sqv * dt;
    const D = b ? b.t1 - b.t0 : 1, u = b ? (t - b.t0) / D : 0;
    const pushing = !parked;
    let hop = 0, wiggle = 0, roll = 0, lean = 0, spin = 0, mood = 1, hairK = 0;
    // free-arm swing (used whenever a hand is off the handle)
    let thR = moving ? Math.sin(s.step) * 0.55 : Math.sin(now * 1.6 + i) * 0.06, phR = 0.2;
    let thL = moving ? -Math.sin(s.step) * 0.55 : -Math.sin(now * 1.6 + i) * 0.06, phL = 0.2;
    let onR = pushing, onL = pushing; // hands on the trolley handle
    // waddle: side-to-side roll + bob, feet alternate (below)
    if (moving) { roll = Math.sin(s.step) * 0.16; hop = Math.abs(Math.sin(s.step)) * 0.06; lean = 0.07; hairK = Math.sin(s.step * 2) * 0.35; }
    else { hop = (Math.sin(now * 2.2 + i) * 0.5 + 0.5) * 0.02; roll = Math.sin(now * 1.1 + i) * 0.03; hairK = Math.sin(now * 1.7 + i) * 0.12; }
    let ik = 0; let ikAt: { x: number; y: number; z: number } | null = null;
    const gs = b ? grabSide(s, b) : 1;
    let lookW: THREE.Vector3 | null = null;
    if (b?.shelf && b.kind !== 'ignore') lookW = tmpV2.set(b.shelf.x, b.shelf.y, b.shelf.z);
    const grabArm = (th: number, ph: number) => { if (gs > 0) { onR = false; thR = th; phR = ph; } else { onL = false; thL = th; phL = ph; } };
    if (b) {
      const reach = clamp01((u - REACH.reach0) / (BEAT.grab - REACH.reach0));
      if (b.kind === 'pick') {
        const g0 = BEAT.grab, l0 = BEAT.launch;
        if (u < g0) { ik = ease(reach); ikAt = b.shelf; lean = 0.18 * ik; if (ik > 0.01) grabArm(thR, phR); }
        else if (u < l0) { const k = ease((u - g0) / (l0 - g0)); ik = 1 - k; ikAt = b.shelf; grabArm(-1.3, 0.05); lean = 0.18 * (1 - k); lookW = null; }
        else if (u < 0.92) {
          // happy hop + little spin, both arms up
          const k = clamp01((u - l0 - 0.04) / (0.9 - l0 - 0.04));
          hop = Math.max(hop, Math.sin(Math.PI * k) * 0.34); spin = ease(k) * Math.PI * 2;
          onR = onL = false; thR = thL = -2.7; phR = phL = 0.45 + Math.sin(k * Math.PI * 4) * 0.15; mood = 1.25;
        }
      } else if (b.kind === 'reject') {
        mood = -1;
        if (u < BEAT.grab) { ik = ease(reach); ikAt = b.shelf; lean = 0.18 * ik; mood = 1; if (ik > 0.01) grabArm(thR, phR); }
        else if (u < BEAT.putBack) {
          const k = clamp01((u - BEAT.grab) / 0.08); ik = 1 - ease(k); ikAt = b.shelf;
          grabArm(-1.95, -0.38);
          // inspect + head-shake
          wiggle = Math.sin(now * 17) * 0.38 * Math.sin(Math.PI * clamp01((u - BEAT.grab) / (BEAT.putBack - BEAT.grab))); lookW = null;
        } else if (u < BEAT.backOnShelf) { ik = ease(clamp01((u - BEAT.putBack) / ((BEAT.backOnShelf - BEAT.putBack) * 0.8))); ikAt = b.shelf; lean = 0.15 * ik; grabArm(thR, phR); }
        else {
          // shrug: both palms out, shoulders up, head shake
          const k = Math.sin(Math.PI * clamp01((u - BEAT.backOnShelf) / (1 - BEAT.backOnShelf)));
          onR = onL = false; thR = thL = -0.35 - k * 0.35; phR = phL = 0.35 + k * 1.0; hop = Math.max(hop, k * 0.05);
          wiggle = Math.sin(now * 15) * 0.25 * k; s.sq = Math.max(s.sq, k * 0.05);
        }
      } else if (b.kind === 'glance') lean = Math.sin(Math.PI * clamp01(u)) * 0.12;
    }
    // checkout choreography (phases come from the scheduled timeline, not the run log)
    const co = s.co;
    if (co) {
      if (crossed(co.tBag)) emitCrowd({ type: 'bag', agentId: s.agent.agent_id, lane: co.lane.id, t });
      if (crossed(co.tPay)) { emitCrowd({ type: 'pay', agentId: s.agent.agent_id, lane: co.lane.id, t }); sfx.ding(); }
      if (t >= co.tArrive && t < co.tBag) {
        const ph = co.lane.kind === 'staffed' ? ((t - co.tUnload0) / TILL.unloadPer) : ((t - co.tArrive) / TILL.selfScanPer);
        const unloading = co.lane.kind === 'staffed' ? t < co.tUnload0 + co.items * TILL.unloadPer + 0.3 : true;
        if (unloading) { const k = Math.abs(Math.sin(ph * Math.PI)); thR = -0.9 - k * 0.7; phR = 0.05; thL = -0.9 - (1 - k) * 0.7; phL = 0.05; }
        else { thR = Math.sin(now * 2) * 0.1; thL = -thR; phR = phL = 0.2; }
      } else if (t >= co.tBag && t < co.tPay) { const k = Math.abs(Math.sin((t - co.tBag) * 6)); thR = -1.1 - k * 0.4; thL = -1.1 - (1 - k) * 0.4; phR = phL = 0; }
      else if (t >= co.tPay && t < co.tDone) {
        // card tap, then a celebratory jump with both arms up
        const tj = Math.max(co.tPay + 0.25, co.tDone - 0.9);
        if (t < tj) { thR = -1.5; phR = -0.25; }
        else { const k = clamp01((t - tj) / Math.max(0.2, co.tDone - tj)); hop = Math.max(hop, Math.sin(Math.PI * k) * 0.42); thR = thL = -2.8; phR = phL = 0.5 + Math.sin(k * 20) * 0.12; mood = 1.3; }
      }
    }
    // queuing: idle sway, hands stay on the handle
    if (s.queued && !moving) { roll = Math.sin(now * 1.5 + i) * 0.09; hop = Math.max(hop, Math.abs(Math.sin(now * 3 + i)) * 0.025); }
    // bonk: a tiny surprised wave
    if (now < s.wave && !ik) { onR = false; thR = -2.65; phR = 0.25 + Math.sin(now * 16) * 0.38; mood = 0; }
    const st = s.sq + hop * 0.35;
    tmpQ.setFromEuler(tmpE.set(lean, s.yaw + wiggle * 0.6 + spin, roll, 'YXZ'));
    R.compose(tmpV.set(s.px, hop, s.pz), tmpQ, tmpS.set(1 - st * 0.55, 1 + st, 1 - st * 0.55));
    M.body.setMatrixAt(i, R); M.bodyInk.setMatrixAt(i, R); M.overalls.setMatrixAt(i, R);
    M.hit.setMatrixAt(i, HIT_M.makeTranslation(s.px, 0, s.pz));
    M.blob.setMatrixAt(i, tmpM.compose(tmpV.set(s.px, 0.012, s.pz), tmpQ2.identity(), tmpS.setScalar(1 - hop * 0.8)));

    // arms: push pose / free pose, blended toward the IK aim for the grabbing arm, rubber-stretch to reach
    const ka = 1 - Math.exp(-dt * 14);
    let wantR = 1, wantL = 1;
    if (onR) { tmpQ3.copy(PUSH[0].q); wantR = PUSH[0].str; } else poseQ(tmpQ3, 1, thR, phR);
    if (onL) { tmpQ4.copy(PUSH[1].q); wantL = PUSH[1].str; } else poseQ(tmpQ4, -1, thL, phL);
    if (ik > 0.001 && ikAt) {
      const inv = tmpM3.copy(R).invert();
      const dir = tmpV.set(ikAt.x, ikAt.y, ikAt.z).applyMatrix4(inv).sub(gs > 0 ? SHOULDER_R : SHOULDER_L);
      const need = Math.min(3.6, Math.max(1, dir.length() / (BODY.armLen + 0.05)));
      tmpQ2.setFromUnitVectors(DOWN, dir.normalize());
      if (gs > 0) { tmpQ3.slerp(tmpQ2, ik); wantR = wantR + (need - wantR) * ik; } else { tmpQ4.slerp(tmpQ2, ik); wantL = wantL + (need - wantL) * ik; }
    }
    s.qR.slerp(tmpQ3, ka); s.qL.slerp(tmpQ4, ka);
    const ks = 1 - Math.exp(-dt * 18);
    s.strR += (wantR - s.strR) * ks; s.strL += (wantL - s.strL) * ks;
    M.arm.setMatrixAt(i * 2, tmpM2.multiplyMatrices(R, tmpM.compose(SHOULDER_R, s.qR, tmpS.set(1, s.strR, 1))));
    M.arm.setMatrixAt(i * 2 + 1, tmpM2.multiplyMatrices(R, tmpM.compose(SHOULDER_L, s.qL, tmpS.set(1, s.strL, 1))));
    s.handR.multiplyMatrices(R, tmpM.compose(SHOULDER_R, s.qR, ONE)).multiply(tmpM3.makeTranslation(0, -BODY.armLen * s.strR, 0));
    s.handL.multiplyMatrices(R, tmpM.compose(SHOULDER_L, s.qL, ONE)).multiply(tmpM3.makeTranslation(0, -BODY.armLen * s.strL, 0));

    if (detail) {
      // goggles: strap, chrome rims, eyes (blink = squash eye Y), irises slide toward what they look at
      M.strap.setMatrixAt(i, R);
      const inv = tmpM3.copy(R).invert();
      let lx = 0, ly = -0.1, lz = 1;
      if (lookW) { const lw = lookW.applyMatrix4(inv); lx = lw.x; ly = lw.y - BODY.eyeY; lz = lw.z; }
      else if (b?.kind === 'ignore') { lx = 0.3; ly = 0.8; lz = 0.6; }
      else if ((b?.kind === 'reject' && u > BEAT.grab && u < BEAT.putBack) || (b?.kind === 'pick' && u > BEAT.grab && u < BEAT.launch)) { lx = 0.15 * gs; ly = -0.4; lz = 1; }
      s.look.lerp(tmpV.set(lx, ly, Math.max(0.25, lz)).normalize(), 1 - Math.exp(-dt * 12));
      const bph = (now + s.blinkO) % s.blinkP;
      const blink = bph < 0.13 ? Math.max(0.08, Math.abs(bph / 0.065 - 1)) : 1;
      const wide = mood === 0 ? 1.18 : 1;
      const es = (s.oneEye ? 1.4 : 1) * wide;
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        if (s.oneEye && k) { M.eye.setMatrixAt(j, ZERO); M.rim.setMatrixAt(j, ZERO); M.iris.setMatrixAt(j, ZERO); continue; }
        const ex = s.oneEye ? 0 : (k ? -1 : 1) * BODY.eyeX;
        const ez = s.oneEye ? BODY.eyeZ + 0.03 : BODY.eyeZ;
        tmpQ2.setFromAxisAngle(UP, ex * 1.6);
        M.rim.setMatrixAt(j, tmpM.compose(tmpV.set(ex, BODY.eyeY, ez), tmpQ2, tmpS.setScalar(es)).premultiply(R));
        M.eye.setMatrixAt(j, tmpM.compose(tmpV.set(ex, BODY.eyeY, ez), tmpQ2, tmpS.set(es, es * blink, es)).premultiply(R));
        const r = BODY.eyeR * es * 0.55;
        M.iris.setMatrixAt(j, tmpM.compose(tmpV.set(ex + s.look.x * r + ex * 0.1, BODY.eyeY + s.look.y * r * blink, ez + BODY.eyeR * 0.72 * es + 0.002), tmpQ2.identity(), tmpS.set(es, es * blink, 1)).premultiply(R));
      }
      // mouth: smile / frown (flipped) / little "o" when surprised
      const my = mood === 0 ? 0.55 : mood;
      M.mouth.setMatrixAt(i, tmpM.compose(tmpV.set(0, BODY.mouthY, BODY.mouthZ), tmpQ2.setFromAxisAngle(tmpV2.set(1, 0, 0), -0.25), tmpS.set(mood === 0 ? 0.55 : 1, my, 1)).premultiply(R));
      M.hair.setMatrixAt(i, s.hair ? tmpM.compose(tmpV.set(0, BODY.top - 0.02, 0), tmpQ2.setFromEuler(tmpE.set(hairK * 0.4 - lean, 0, hairK - roll * 1.5)), ONE).premultiply(R) : ZERO);
      tmpM4.compose(tmpV3.set(s.px, 0, s.pz), tmpQ2.setFromAxisAngle(UP, s.yaw + spin), ONE);
      for (let k = 0; k < 2; k++) {
        const ph = s.step + (k ? Math.PI : 0);
        const fy = hop > 0.12 ? hop * 0.85 : 0;
        M.foot.setMatrixAt(i * 2 + k, tmpM.makeTranslation((k ? -1 : 1) * 0.13, 0.01 + fy + (moving ? Math.max(0, Math.sin(ph)) * 0.08 : 0), 0.05 + (moving ? Math.cos(ph) * 0.1 : 0)).premultiply(tmpM4));
      }
    } else {
      M.strap.setMatrixAt(i, ZERO); M.mouth.setMatrixAt(i, ZERO); M.hair.setMatrixAt(i, ZERO);
      for (let k = 0; k < 2; k++) { const j = i * 2 + k; M.eye.setMatrixAt(j, ZERO); M.rim.setMatrixAt(j, ZERO); M.iris.setMatrixAt(j, ZERO); M.foot.setMatrixAt(j, ZERO); }
    }
    M.bag.setMatrixAt(i, co && t >= co.tPay + 0.5 ? tmpM.multiplyMatrices(s.handL, tmpM3.makeTranslation(0, -0.02, 0.02)) : ZERO);
    // trolley: rides in front of its owner; parked at the till while they check out
    s.carrierM.compose(tmpV.set(s.px, 0, s.pz), tmpQ2.setFromAxisAngle(UP, s.yaw), ONE).multiply(tmpM3.makeTranslation(TROLLEY.anchor[0], BODY.center + TROLLEY.anchor[1], TROLLEY.anchor[2]));
    let cm: THREE.Matrix4 = s.carrierM;
    if (parked && co) { cm = t < co.tDone ? s.park! : ZERO; if (t < co.tDone) s.carrierM.copy(s.park!); }
    M.trolley.setMatrixAt(i, cm);
  }

  function drawPack(s: Shopper, b: Beat, t: number, now: number, crossed: (x: number) => boolean) {
    const M = meshes;
    const i = M.packIdx.get(b.id)!; const sz = M.packSize[i];
    // the pack physically leaves the shelf when the hand closes on it, and a rejected one goes back
    if (!s.ai) {
      if (crossed(b.tGrab) && !taken.current.has(b.id)) {
        takeFromShelf(b.shelfSlot, b.code); taken.current.set(b.id, b);
        emitCrowd({ type: 'take', agentId: b.agentId, slot: b.shelfSlot, code: b.code, t });
      }
      if (b.kind === 'reject' && crossed(b.tBack) && taken.current.has(b.id)) {
        restockShelf(b.shelfSlot, b.code, 1); taken.current.delete(b.id);
        emitCrowd({ type: 'putback', agentId: b.agentId, slot: b.shelfSlot, code: b.code, t }); sfx.nope();
      }
    }
    if (!s.active || t < b.tGrab) { M.pack.setMatrixAt(i, ZERO); return; }
    const hand = grabSide(s, b) < 0 ? s.handL : s.handR;
    const inHand = () => M.pack.setMatrixAt(i, tmpM.multiplyMatrices(hand, tmpM2.makeTranslation(0, -0.1, 0.06)).multiply(tmpM3.makeScale(sz.w * 1.25, sz.h * 1.25, sz.d * 1.25)));
    if (b.kind === 'reject') { if (t < b.tBack) inHand(); else M.pack.setMatrixAt(i, ZERO); return; }
    const co = s.co;
    if (co && b.pickIdx >= 0 && b.pickIdx < co.tScan.length && t >= co.tArrive) {
      // checkout: carrier → belt / scanner → bag
      const k = b.pickIdx, L = co.lane, tS = co.tScan[k];
      const inCarrier = tmpV3.setFromMatrixPosition(tmpM.multiplyMatrices(s.park ?? s.carrierM, stackLocal(s.carrier, k, sz.h, tmpM2)));
      const scanP = new THREE.Vector3(L.scanner.x, L.scanner.y + sz.h / 2 + 0.08, L.scanner.z);
      const bagP = new THREE.Vector3(L.bag.x + ((k % 3) - 1) * 0.12, L.bag.y + sz.h / 2 + Math.floor(k / 3) * (sz.h * 0.6), L.bag.z + ((k >> 1) % 2) * 0.1);
      if (crossed(tS)) { bus.flash[L.id] = now; sfx.beep(); emitCrowd({ type: 'scan', agentId: b.agentId, lane: L.id, kind: L.kind, code: b.code, t }); }
      const arc = (a: THREE.Vector3, c: THREE.Vector3, kk: number, lift: number) => { const p = a.clone().lerp(c, kk); p.y += Math.sin(Math.PI * kk) * lift; return p; };
      let pos: THREE.Vector3 | null = null, spin = 0;
      if (L.kind === 'staffed' && L.beltStart && L.beltEnd) {
        const tU = co.tUnload0 + k * TILL.unloadPer, tLand = tU + 0.3;
        if (crossed(tU)) emitCrowd({ type: 'unload', agentId: b.agentId, lane: L.id, code: b.code, t });
        const y = 0.975 + sz.h / 2;
        const bs = new THREE.Vector3(L.beltStart.x, y, L.beltStart.z), be = new THREE.Vector3(L.beltEnd.x, y, L.beltEnd.z);
        if (t < tU) pos = inCarrier.clone();
        else if (t < tLand) { pos = arc(inCarrier, bs, ease((t - tU) / 0.3), 0.35); spin = (t - tU) * 9; }
        else if (t < tS - 0.15) pos = bs.lerp(be, clamp01((t - tLand) / Math.max(0.05, tS - 0.15 - tLand)));
        else if (t < tS + 0.35) { const kk = clamp01((t - tS + 0.15) / 0.5); pos = kk < 0.4 ? arc(be, scanP, kk / 0.4, 0.08) : arc(scanP, bagP, (kk - 0.4) / 0.6, 0.25); }
        else if (t < co.tPay) pos = bagP;
      } else {
        const tP = tS - 0.55;
        if (crossed(tP)) emitCrowd({ type: 'unload', agentId: b.agentId, lane: L.id, code: b.code, t });
        if (t < tP) pos = inCarrier.clone();
        else if (t < tS) { pos = arc(inCarrier, scanP, ease((t - tP) / 0.55), 0.2); spin = (t - tP) * 4; }
        else if (t < tS + 0.3) pos = arc(scanP, bagP, ease((t - tS) / 0.3), 0.15);
        else if (t < co.tPay + 0.3) pos = bagP;
      }
      M.pack.setMatrixAt(i, pos ? tmpM.compose(pos, tmpQ.setFromEuler(tmpE.set(spin, spin * 0.5 + (k * 1.3) % 0.5, 0)), tmpS.set(sz.w, sz.h, sz.d)) : ZERO);
      return;
    }
    if (t < b.tLaunch) { launchAt.current.delete(b.id); inHand(); return; }
    // thrown: arc from the hand into its spot on the pile, then stays in the carrier
    if (crossed(b.tLaunch)) { launchAt.current.set(b.id, new THREE.Vector3().setFromMatrixPosition(hand)); sfx.pick(); }
    const dst = tmpM.multiplyMatrices(s.carrierM, stackLocal(s.carrier, b.pickIdx, sz.h, tmpM2));
    const flight = Math.min(0.7, Math.max(0.25, (b.t1 - b.tLaunch) * 0.5));
    const k = (t - b.tLaunch) / flight;
    const src = launchAt.current.get(b.id);
    if (k < 1 && src) {
      const kk = ease(k);
      const p = tmpV.setFromMatrixPosition(dst);
      const x = src.x + (p.x - src.x) * kk, y = src.y + (p.y - src.y) * kk + Math.sin(Math.PI * kk) * 0.55, z = src.z + (p.z - src.z) * kk;
      M.pack.setMatrixAt(i, tmpM3.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(k * 7, k * 4, 0)), tmpS.set(sz.w, sz.h, sz.d)));
      return;
    }
    if (src) { launchAt.current.delete(b.id); emitCrowd({ type: 'drop', agentId: b.agentId, code: b.code, t }); }
    M.pack.setMatrixAt(i, dst.multiply(tmpM3.makeScale(sz.w, sz.h, sz.d)));
  }

  const click = (list: Shopper[]) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const s = e.instanceId !== undefined ? list[e.instanceId] : undefined;
    if (s) onAgent(s.agent.agent_id);
  };
  const [, force] = useState(0); void force;
  const hover = (list: Shopper[]) => ({
    onPointerMove: (e: ThreeEvent<PointerEvent>) => { const s = e.instanceId !== undefined ? list[e.instanceId] : undefined; document.body.style.cursor = 'pointer'; hovered.current = s ? s.si : null; },
    onPointerOut: () => { document.body.style.cursor = ''; hovered.current = null; },
  });
  const clickSticker = (e: ThreeEvent<MouseEvent>) => {
    const sl = pools.stickers.find((x) => x.sprite === e.object);
    if (sl?.beat) { e.stopPropagation(); onEvent(sl.beat.agentId, sl.beat.step); }
  };

  return (
    <group>
      <primitive object={meshes.group} />
      <primitive object={meshes.body} />
      <primitive object={meshes.hit} onClick={click(shoppers)} {...hover(shoppers)} />
      <primitive object={pools.group} onClick={clickSticker} />
      <mesh ref={selRing} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.52, 0.66, 40, 1, 0, Math.PI * 1.6]} />
        <meshBasicMaterial color={BRAND_A} />
      </mesh>
    </group>
  );
}

// Easter egg: a cartoon "tidal wave" (SimCity-style disaster, nobody hurt). Rarely on its own (seeded, like the UFO),
// ?tsunami=now triggers it at once, window.__tsunami() from the console. ~2 min (superstore).
// Sequence: a "TIDAL WAVE WARNING!" siren sign pops up; shoppers + staff hurry out of the doors to the lawn beside the
// store and watch. A big stylised blue wave with a white foam crest rises beyond the far side of the road and rolls in:
// three minions surf the crest (two on trolleys, one on a surfboard), rubber ducks + crates bob behind it. It breaks on
// the shop front, the car park floods (parked cars bob and drift) and an ankle-deep sheet of water seeps into the store.
// The stock floats off the shelves and drifts out as the water recedes, leaving puddles that fade. The store shell
// cartoon-crumbles (walls wobble, tilt and squash into dust). A cement-mixer truck brings a hi-vis builder crew:
// scaffolding goes up, walls rise back piece by piece with hammer sparks, scaffolding comes down, restockers refill the
// shelves bay by bay, the crew drives off and everyone walks back in. Everything ends exactly as it was.
// The store reads only EGG_FX (eggs.ts): stock share (ShelfFill), shell group (Store), people group (Scene).
// Perf: render nothing when idle (root hidden, the frame loop returns at once). Active: ~17 draw calls (wave + flood
// shaders, sign sprite, instanced foam / ducks / crates / packs / puddles / minions / hats / trolleys / particles /
// scaffold, board, truck + drum); no lights, one useFrame; everything disposed on unmount.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Geo, cylGeo, mat, rng } from './geo';
import { CAR_FX, EGG_FX, overrideCar, urlFlag, ease, clamp01 } from './eggs';
import { minionGeo, MINION_MAT } from '../minion';
import { trolleyGeometry, TROLLEY } from '../parts';
import type { WorldPlan } from './World';

const noRay = () => null;

// assumption: visual - every timing / speed / size constant in this file is look-and-feel only
const FIRST_MIN = 240, FIRST_RAND = 240;          // assumption: visual (first one after 4-8 min)
const REPEAT_MIN = 480, REPEAT_RAND = 420;        // assumption: visual (then every 8-15 min)
const AMP = 6.5, DEPTH = 18, CURL = 0.4;          // assumption: visual (wave height m, wave body depth m, lip overhang)
const LEVEL = 0.16, LEVEL_PEAK = 0.24;            // assumption: visual (ankle-deep flood, m)
const MSCALE = 1.4;                               // assumption: visual (minions a touch bigger so they read at range)
const T = {                                       // assumption: visual (s since trigger)
  signOff: 10, evac0: 0.6,
  rise0: 2.5, rise1: 5, hop: 16.5, roll1: 19, crash1: 23, seep1: 29,
  wash0: 30, wash1: 38, recede0: 38, recede1: 52, pud1: 62,
  wobble0: 42, fall0: 44, fall1: 50, surfOut: 55,
  truck0: 54, truck1: 62, crewOut: 62, scaf0: 64, scaf1: 70, build0: 70, build1: 100, scafOff0: 101, scafOff1: 105,
  crewIn: 104, stock0: 100, stock1: 118, truckOut0: 107, truckOut1: 115, back0: 116, back1: 124, done: 126,
};
const N_SURF = 3, N_EVAC = 24, N_CREW = 5, N_RESTOCK = 3;
const I_EVAC = N_SURF, I_CREW = I_EVAC + N_EVAC, I_REST = I_CREW + N_CREW, N_MIN = I_REST + N_RESTOCK;
const N_FOAM = 44, N_DUCK = 10, N_CRATE = 6, N_PACK = 70, N_PUD = 10, N_P = 180, N_SCAF = 900, N_CARS = 20;
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// ---------------------------------------------------------------- the wave profile (shared by the shader + JS)
const ss = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** height share across the wave body, v = 0 at the front (store side) .. 1 at the back */
const shape = (v: number) => ss(0, 0.24, v) * (0.12 + 0.88 * (1 - ss(0.26, 1, v)));
const curlK = (v: number) => Math.exp(-(((v - 0.23) / 0.07) ** 2));
const wob = (x: number, t: number) => 1 + 0.12 * Math.sin(x * 0.21 + t * 1.7) + 0.06 * Math.sin(x * 0.57 - t * 2.3);
const taperK = (u: number) => ss(0, 0.1, u) * (1 - ss(0.9, 1, u));

const WAVE_VS = /* glsl */ `
uniform float uX0, uW, uZ, uD, uA, uT, uCurl;
varying float vV, vH, vX, vTp;
void main() {
  float u = position.x + 0.5, v = position.z + 0.5;
  float tp = smoothstep(0.0, 0.1, u) * (1.0 - smoothstep(0.9, 1.0, u));
  float x = uX0 + u * uW;
  float wb = 1.0 + 0.12 * sin(x * 0.21 + uT * 1.7) + 0.06 * sin(x * 0.57 - uT * 2.3);
  float s = smoothstep(0.0, 0.24, v) * (0.12 + 0.88 * (1.0 - smoothstep(0.26, 1.0, v)));
  float c = exp(-pow((v - 0.23) / 0.07, 2.0));
  float h = uA * s * wb * tp;
  float z = uZ + v * uD - uCurl * uA * c * tp * wb;
  vV = v; vH = s * wb; vX = x; vTp = tp;
  gl_Position = projectionMatrix * viewMatrix * vec4(x, h, z, 1.0);
}`;
const WAVE_FS = /* glsl */ `
uniform float uO, uT;
varying float vV, vH, vX, vTp;
void main() {
  vec3 deep = vec3(0.12, 0.40, 0.85), hi = vec3(0.52, 0.85, 1.0), mid = vec3(0.24, 0.6, 0.96);
  float h = clamp(vH, 0.0, 1.2);
  vec3 col = mix(deep, hi, floor(h * 4.0) / 4.0);
  col = mix(col, mid, 0.45 * step(0.32, vV));
  float sc = 0.87 + 0.05 * sin(vX * 1.3 + uT * 4.0) + 0.03 * sin(vX * 3.1 - uT * 3.0);
  float crest = step(sc, h) * step(vV, 0.4);
  float streak = step(0.93, sin(vV * 70.0 + sin(vX * 0.4) * 2.0 - uT * 2.0)) * step(0.35, vV);
  float foot = step(vV, 0.035 + 0.02 * sin(vX * 0.9 + uT * 5.0));
  col = mix(col, vec3(1.0), max(max(crest, foot), streak * 0.7));
  float a = uO * (1.0 - smoothstep(0.8, 1.0, vV)) * smoothstep(0.0, 0.25, vTp);
  gl_FragColor = vec4(col, a * 0.95);
}`;
const FLOOD_VS = /* glsl */ `
varying vec2 vW; varying vec2 vUv;
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xz; vUv = uv; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const FLOOD_FS = /* glsl */ `
uniform float uO, uT, uLen;
varying vec2 vW; varying vec2 vUv;
void main() {
  float r = sin(vW.x * 0.55 + uT * 1.2 + sin(vW.y * 0.3)) * sin(vW.y * 0.7 - uT * 1.6);
  vec3 col = mix(vec3(0.36, 0.72, 0.98), vec3(0.78, 0.94, 1.0), step(0.55, r));
  float dNear = (1.0 - vUv.y) * uLen;
  float foam = step(dNear, 0.5 + 0.25 * sin(vW.x * 1.1 + uT * 3.0));
  col = mix(col, vec3(1.0), foam);
  float edge = smoothstep(0.0, 0.03, vUv.x) * (1.0 - smoothstep(0.97, 1.0, vUv.x));
  gl_FragColor = vec4(col, uO * (0.6 + 0.3 * foam) * edge);
}`;

function signTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d')!;
  const rr = (X: number, Y: number, w: number, h: number, r: number) => { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); };
  rr(8, 8, 496, 240, 28); x.fillStyle = '#1d1b22'; x.fill();
  rr(18, 18, 476, 220, 22); x.fillStyle = '#ffd23f'; x.fill();
  x.save(); rr(18, 18, 476, 220, 22); x.clip();
  for (let i = -4; i < 30; i++) { x.fillStyle = '#1d1b22'; x.beginPath(); x.moveTo(i * 36, 18); x.lineTo(i * 36 + 18, 18); x.lineTo(i * 36 + 2, 46); x.lineTo(i * 36 - 16, 46); x.fill(); x.beginPath(); x.moveTo(i * 36, 210); x.lineTo(i * 36 + 18, 210); x.lineTo(i * 36 + 2, 238); x.lineTo(i * 36 - 16, 238); x.fill(); }
  x.restore();
  for (const cx of [64, 448]) { // siren domes
    x.fillStyle = '#1d1b22'; x.fillRect(cx - 30, 150, 60, 16);
    x.fillStyle = '#ff2d3d'; x.beginPath(); x.arc(cx, 150, 28, Math.PI, 0); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.8)'; x.beginPath(); x.arc(cx - 9, 136, 7, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#ff2d3d'; x.lineWidth = 5; for (const a of [-2.4, -1.57, -0.7]) { x.beginPath(); x.moveTo(cx + Math.cos(a) * 36, 150 + Math.sin(a) * 36); x.lineTo(cx + Math.cos(a) * 48, 150 + Math.sin(a) * 48); x.stroke(); }
  }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#1d1b22'; x.font = '900 54px system-ui, sans-serif'; x.fillText('TIDAL WAVE', 256, 98);
  x.fillStyle = '#e8102a'; x.font = '900 62px system-ui, sans-serif'; x.fillText('WARNING!', 256, 160);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function duckGeometry() {
  const g = new Geo();
  g.add(new THREE.SphereGeometry(1, 12, 8), '#ffd21f', mat(0, 0.22, 0, 0, 0.34, 0.24, 0.44));
  g.add(new THREE.SphereGeometry(0.17, 10, 8), '#ffd21f', mat(0, 0.5, 0.22));
  g.add(new THREE.ConeGeometry(0.07, 0.16, 8), '#ff8a1f', mat(0, 0.48, 0.42, 0, 1, 1, 1, Math.PI / 2));
  for (const s of [-1, 1]) g.add(new THREE.SphereGeometry(0.03, 6, 4), '#1d1b22', mat(s * 0.09, 0.56, 0.34));
  g.add(new THREE.ConeGeometry(0.1, 0.18, 6), '#ffd21f', mat(0, 0.34, -0.42, 0, 1, 1, 1, -Math.PI / 2.6));
  return g.build();
}
function crateGeometry() {
  const g = new Geo();
  g.box(0, 0.3, 0, 0.9, 0.6, 0.7, '#c98a4b');
  for (const y of [0.12, 0.48]) { g.box(0, y, 0.36, 0.92, 0.1, 0.03, '#9a6232'); g.box(0, y, -0.36, 0.92, 0.1, 0.03, '#9a6232'); }
  return g.build();
}
function boardGeometry() {
  const g = new Geo();
  g.add(cylGeo(16), '#fff7ec', mat(0, 0.05, 0, 0, 0.32, 0.08, 1.25));
  g.add(cylGeo(16), '#FF4079', mat(0, 0.052, 0, 0, 0.08, 0.085, 1.2));
  return g.build();
}
function hatGeometry() {
  const g = new Geo();
  g.add(new THREE.SphereGeometry(0.33, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#ffd21f', mat(0, 1.12, 0));
  g.add(cylGeo(14), '#ffc400', mat(0, 1.13, 0.04, 0, 0.4, 0.03, 0.42));
  return g.build();
}
function truckGeometry() {
  const g = new Geo();
  g.box(0, 0.75, 0, 2.2, 0.4, 7.4, '#3a3a44');
  g.box(0, 1.65, 2.75, 2.3, 1.8, 1.8, '#ffb21f');
  g.box(0, 2.05, 3.66, 2.0, 0.7, 0.06, '#2a2f3a');
  g.box(1.16, 2.05, 2.75, 0.04, 0.6, 1.2, '#2a2f3a'); g.box(-1.16, 2.05, 2.75, 0.04, 0.6, 1.2, '#2a2f3a');
  g.box(0, 2.62, 2.6, 0.9, 0.16, 0.3, '#ff7a1f');
  g.box(0, 1.5, -3.4, 0.5, 1.2, 0.5, '#6b6f7d');
  for (const z of [2.6, -1.4, -2.7]) for (const s of [-1, 1]) g.add(cylGeo(12), '#1c1a1f', mat(s * 1.05, 0.5, z, 0, 0.5, 0.36, 0.5, 0, Math.PI / 2));
  return g.build();
}
function drumGeometry() {
  // axis along local y; striped like a sweet
  const g = new Geo();
  g.add(new THREE.CylinderGeometry(0.85, 1.25, 3.6, 16), '#f4f2ee');
  for (const y of [-1.1, 0, 1.1]) g.add(new THREE.CylinderGeometry(1.08 - y * 0.11 + 0.03, 1.1 - y * 0.11 + 0.03, 0.35, 16), '#FF4079', mat(0, y, 0));
  return g.build();
}

/** polyline helper: point + heading at distance s */
function poly(pts: THREE.Vector2[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const len = cum[cum.length - 1];
  return {
    len,
    at(s: number, o: { x: number; z: number; yaw: number }) {
      s = Math.max(0, Math.min(len, s));
      let i = 1; while (i < pts.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1], b = pts[i], seg = cum[i] - cum[i - 1] || 1, u = (s - cum[i - 1]) / seg;
      o.x = a.x + (b.x - a.x) * u; o.z = a.y + (b.y - a.y) * u;
      if (b.distanceTo(a) > 1e-3) o.yaw = Math.atan2(b.x - a.x, b.y - a.y);
      return o;
    },
  };
}
type Poly = ReturnType<typeof poly>;
const V2 = (x: number, z: number) => new THREE.Vector2(x, z);

interface Piece {
  obj: THREE.Object3D; m0: THREE.Matrix4; px: number; pz: number; alongX: boolean; len: number; sgn: number;
  cx: number; cz: number; top: number;
}

export function Tsunami({ W }: { W: WorldPlan }) {
  const mg = minionGeo();
  const geo = useMemo(() => ({
    wave: new THREE.PlaneGeometry(1, 1, 120, 48).rotateX(-Math.PI / 2),
    flood: new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2),
    puff: new THREE.IcosahedronGeometry(1, 0),
    duck: duckGeometry(), crate: crateGeometry(), board: boardGeometry(), hat: hatGeometry(),
    pack: new THREE.BoxGeometry(0.32, 0.42, 0.16),
    puddle: new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2),
    trolley: trolleyGeometry(), truck: truckGeometry(), drum: drumGeometry(),
    bar: new THREE.BoxGeometry(1, 1, 1),
  }), []);
  const sign = useMemo(signTexture, []);
  const mats = useMemo(() => ({
    wave: new THREE.ShaderMaterial({
      vertexShader: WAVE_VS, fragmentShader: WAVE_FS, transparent: true, side: THREE.DoubleSide,
      uniforms: { uX0: { value: 0 }, uW: { value: 1 }, uZ: { value: 0 }, uD: { value: DEPTH }, uA: { value: 0 }, uT: { value: 0 }, uCurl: { value: CURL }, uO: { value: 1 } },
    }),
    flood: new THREE.ShaderMaterial({
      vertexShader: FLOOD_VS, fragmentShader: FLOOD_FS, transparent: true, depthWrite: false,
      uniforms: { uO: { value: 0 }, uT: { value: 0 }, uLen: { value: 1 } },
    }),
    sign: new THREE.SpriteMaterial({ map: sign, transparent: true, depthWrite: false }),
    foam: new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#9fd8ff', emissiveIntensity: 0.25, flatShading: true }),
    puff: new THREE.MeshLambertMaterial({ flatShading: true }),
    vc: new THREE.MeshLambertMaterial({ vertexColors: true }),
    pack: new THREE.MeshLambertMaterial(),
    puddle: new THREE.MeshBasicMaterial({ color: '#5aa7e6', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    trolley: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.25 }),
    scaf: new THREE.MeshLambertMaterial(),
  }), [sign]);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); Object.values(mats).forEach((m) => m.dispose()); sign.dispose(); }, [geo, mats, sign]);

  const root = useRef<THREE.Group>(null), wave = useRef<THREE.Mesh>(null), flood = useRef<THREE.Mesh>(null), signR = useRef<THREE.Sprite>(null);
  const foam = useRef<THREE.InstancedMesh>(null), ducks = useRef<THREE.InstancedMesh>(null), crates = useRef<THREE.InstancedMesh>(null);
  const packs = useRef<THREE.InstancedMesh>(null), puds = useRef<THREE.InstancedMesh>(null), parts = useRef<THREE.InstancedMesh>(null);
  const heads = useRef<THREE.InstancedMesh>(null), bodies = useRef<THREE.InstancedMesh>(null), hats = useRef<THREE.InstancedMesh>(null);
  const trolleys = useRef<THREE.InstancedMesh>(null), board = useRef<THREE.Mesh>(null), scaf = useRef<THREE.InstancedMesh>(null);
  const truck = useRef<THREE.Group>(null), drum = useRef<THREE.Mesh>(null);

  // ---- world-fixed geometry of the event (from the same WorldPlan World.tsx builds)
  const K = useMemo(() => {
    const B = W.B;
    const zStart = W.zRoad + W.roadW / 2 + 7;        // beyond the far pavement
    const zEnd = W.zF + 2;
    const seep = Math.min(B.d * 0.55, 32);
    const x0 = W.xL - 10, width = W.xR - W.xL + 20;
    const doors = W.doorXs.length ? W.doorXs : [W.cx];
    return { B, zStart, zEnd, seep, x0, width, floodFar: zStart + DEPTH * 0.6, fx0: W.xL - 4, fx1: W.xR + 4, doors, signX: doors[0] };
  }, [W]);

  const S = useRef({
    r: rng(7777), clock: 0, next: 0, t: -1, fire: false, ring: 0, peopleHidden: false, stockSet: false,
    level: 0, near: 0, zw: 0, amp: 0,
    cars: [] as { i: number; a: number; ph: number; dx: number; dz: number; m: THREE.Matrix4 }[],
    pieces: [] as Piece[], order: [] as number[], dusted: new Set<string>(),
    evac: [] as { out: Poly; back: Poly; d0: number; sp: number; col: THREE.Color; ph: number; tx: number; tz: number }[],
    crew: [] as { x: number; z: number; yaw: number }[],
    surf: [] as { x: number; z: number; hopZ: number; hopX: number }[],
    floaters: [] as { kind: 0 | 1; x: number; home: number; k: number; ph: number }[],
    packs: [] as { x: number; z: number; y0: number; ts: number; k: number; ph: number; col: THREE.Color }[],
    puddles: [] as { x: number; z: number; r: number }[],
    scaf: [] as { piece: number; x: number; y: number; z: number; sx: number; sy: number; sz: number; plank: boolean }[],
    tIn: null as Poly | null, tOut: null as Poly | null, truckX: 0, truckZ: 0,
  });
  const P = useMemo(() => ({ pos: new Float32Array(N_P * 3), vel: new Float32Array(N_P * 3), age: new Float32Array(N_P), life: new Float32Array(N_P), size: new Float32Array(N_P) }), []);
  const tmp = useMemo(() => ({
    m: new THREE.Matrix4(), m2: new THREE.Matrix4(), m3: new THREE.Matrix4(), v: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler(), s: new THREE.Vector3(),
    c: new THREE.Color(), o: { x: 0, z: 0, yaw: 0 }, box: new THREE.Box3(),
  }), []);

  const put = (im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, sc: number, rx = 0, rz = 0) => {
    if (sc <= 0.001) { im.setMatrixAt(i, ZERO); return; }
    tmp.q.setFromEuler(tmp.e.set(rx, yaw, rz));
    im.setMatrixAt(i, tmp.m.compose(tmp.v.set(x, y, z), tmp.q, tmp.s.setScalar(sc)));
  };
  const spawn = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, col: string) => {
    const s = S.current, i = s.ring; s.ring = (s.ring + 1) % N_P;
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
    P.age[i] = 0; P.life[i] = life; P.size[i] = size;
    const im = parts.current!; im.setColorAt(i, tmp.c.set(col)); if (im.instanceColor) im.instanceColor.needsUpdate = true;
  };
  const puffAt = (x: number, y: number, z: number, n: number, col = '#e9dccb', size = 0.7) => {
    const r = S.current.r;
    for (let k = 0; k < n; k++) spawn(x + (r() - 0.5) * 1.2, y + r() * 0.4, z + (r() - 0.5) * 1.2, (r() - 0.5) * 2, 0.6 + r() * 1.4, (r() - 0.5) * 2, 1.2 + r() * 0.8, size * (0.6 + r() * 0.7), col);
  };

  /** shell matrices: tilt about the base line + squash, around each piece's own pivot */
  const posePiece = (p: Piece, ang: number, sy: number) => {
    const o = p.obj;
    if (ang === 0 && sy === 1) { o.matrix.copy(p.m0); o.matrixWorldNeedsUpdate = true; return; }
    tmp.q.setFromEuler(p.alongX ? tmp.e.set(ang * p.sgn, 0, 0) : tmp.e.set(0, 0, -ang * p.sgn));
    tmp.m.compose(tmp.v.set(p.px, 0, p.pz), tmp.q, tmp.s.set(1, Math.max(0.03, sy), 1));
    tmp.m2.makeTranslation(-p.px, 0, -p.pz);
    o.matrix.multiplyMatrices(tmp.m, tmp.m2).multiply(p.m0);
    o.matrixWorldNeedsUpdate = true;
  };
  const restoreAll = () => {
    const s = S.current;
    for (const p of s.pieces) { p.obj.matrix.copy(p.m0); p.obj.matrixAutoUpdate = true; p.obj.matrixWorldNeedsUpdate = true; }
    s.pieces = [];
    for (const c of s.cars) { overrideCar(c.i, null); CAR_FX.claimed.delete(c.i); }
    s.cars = [];
    EGG_FX.stock = 1;
    if (EGG_FX.people) EGG_FX.people.visible = true;
    s.peopleHidden = false;
    if (CAR_FX.focus?.who === 'tsunami') CAR_FX.focus = null;
  };

  useEffect(() => {
    const s = S.current;
    s.next = urlFlag('tsunami') === 'now' ? 1.5 : FIRST_MIN + s.r() * FIRST_RAND;
    const w = window as unknown as Record<string, unknown>;
    w.__tsunami = () => { s.fire = true; return 'surf\'s up (cartoon, nobody gets hurt)'; };
    w.__tsunamiState = s;
    return () => { delete w.__tsunami; delete w.__tsunamiState; restoreAll(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** everything chosen once per run */
  const setup = () => {
    const s = S.current, r = s.r, { B } = K;
    s.t = 0; s.ring = 0; s.dusted.clear(); P.life.fill(0);
    CAR_FX.focus = { x: W.cx, z: (W.zF + W.zRoad) / 2, who: 'tsunami', tx: W.cx, tz: W.zF };
    // parked cars nearest the road float a little
    s.cars = CAR_FX.parked.map((p, i) => ({ i, z: p.z })).filter((c) => !CAR_FX.claimed.has(c.i) && !CAR_FX.over.has(c.i))
      .sort((a, b) => b.z - a.z).slice(0, N_CARS)
      .map((c) => { CAR_FX.claimed.add(c.i); const a = r() * Math.PI * 2; return { i: c.i, a: 0, ph: r() * 10, dx: Math.cos(a) * (0.3 + r() * 0.5), dz: Math.sin(a) * (0.3 + r() * 0.5), m: new THREE.Matrix4() }; });
    // the store shell
    s.pieces = [];
    const shell = EGG_FX.shell;
    if (shell) {
      shell.updateMatrixWorld(true);
      for (const o of shell.children) {
        o.updateMatrix();
        tmp.box.setFromObject(o);
        if (tmp.box.isEmpty()) continue;
        const sx = tmp.box.max.x - tmp.box.min.x, sz = tmp.box.max.z - tmp.box.min.z;
        const cx = (tmp.box.min.x + tmp.box.max.x) / 2, cz = (tmp.box.min.z + tmp.box.max.z) / 2;
        const alongX = sx >= sz;
        const sgn = alongX ? Math.sign(cz - B.cz) || 1 : Math.sign(cx - B.cx) || 1;
        s.pieces.push({ obj: o, m0: o.matrix.clone(), px: cx, pz: cz, alongX, len: alongX ? sx : sz, sgn, cx, cz, top: tmp.box.max.y });
        o.matrixAutoUpdate = false;
      }
    }
    s.order = s.pieces.map((_, i) => i).sort(() => r() - 0.5);
    // scaffolding: two poles every 2.2 m on the outside of each piece + two plank decks
    s.scaf = [];
    s.pieces.forEach((p, pi) => {
      const n = Math.max(1, Math.round(p.len / 2.2));
      for (let k = 0; k <= n && s.scaf.length < N_SCAF - 4; k++) {
        const a = -p.len / 2 + (k / n) * p.len;
        for (const off of [0.45, 1.35]) {
          const x = p.alongX ? p.cx + a : p.cx + p.sgn * off, z = p.alongX ? p.cz + p.sgn * off : p.cz + a;
          s.scaf.push({ piece: pi, x, y: 0, z, sx: 0.15, sy: 3.9, sz: 0.15, plank: false });
        }
      }
      for (const y of [1.3, 2.6]) if (s.scaf.length < N_SCAF) s.scaf.push({ piece: pi, x: p.alongX ? p.cx : p.cx + p.sgn * 0.9, y, z: p.alongX ? p.cz + p.sgn * 0.9 : p.cz, sx: p.alongX ? p.len : 1.0, sy: 0.12, sz: p.alongX ? 1.0 : p.len, plank: true });
    });
    const sc = scaf.current!;
    s.scaf.forEach((b, i) => sc.setColorAt(i, tmp.c.set(b.plank ? '#e39a3b' : '#9aa4b6')));
    if (sc.instanceColor) sc.instanceColor.needsUpdate = true;
    // evacuees: out of the doors, along the shop front, to the lawn left of the car park
    const pal = ['#2d6cdf', '#3aa76d', '#e8434b', '#9b5de5', '#ff7a3d', '#00a6a6', '#FF4079', '#f4f2ee'];
    s.evac = Array.from({ length: N_EVAC }, (_, i) => {
      const dx = K.doors[i % K.doors.length] + (r() - 0.5) * 2;
      const tx = W.xL - 8 - r() * 9, tz = W.zF - 13 + r() * 15;
      const pts = [V2(dx, W.zF - 1), V2(dx, W.zF + 2.5 + r()), V2(W.xL - 3 - r() * 2, W.zF + 2.5 + r()), V2(tx, tz)];
      return { out: poly(pts), back: poly([...pts].reverse()), d0: i * 0.18, sp: 4.5 + r() * 1.5, col: new THREE.Color(pal[i % pal.length]), ph: r() * 10, tx, tz };
    });
    const bo = bodies.current!;
    s.evac.forEach((e, i) => bo.setColorAt(I_EVAC + i, e.col));
    for (let i = 0; i < N_SURF; i++) bo.setColorAt(i, tmp.c.set(['#ff7a3d', '#00a6a6', '#9b5de5'][i]));
    for (let i = 0; i < N_CREW; i++) bo.setColorAt(I_CREW + i, tmp.c.set(i % 2 ? '#ff9a1f' : '#c6ff1a'));
    for (let i = 0; i < N_RESTOCK; i++) bo.setColorAt(I_REST + i, tmp.c.set('#FF4079'));
    if (bo.instanceColor) bo.instanceColor.needsUpdate = true;
    // surfers along the crest
    s.surf = [-0.22, 0.04, 0.27].map((f) => ({ x: W.cx + f * (W.xR - W.xL), z: 0, hopZ: 0, hopX: 0 }));
    // ducks + crates: homes in the car park
    s.floaters = Array.from({ length: N_DUCK + N_CRATE }, (_, i) => ({ kind: (i < N_DUCK ? 0 : 1) as 0 | 1, x: W.xL + 4 + r() * (W.xR - W.xL - 8), home: W.zA + 4 + r() * (W.zC - W.zA - 6), k: r(), ph: r() * 10 }));
    // packs washed off the shelves (from the real units), timed with the stock sweep
    const units = Object.values(W.P.units);
    const pk = packs.current!;
    s.packs = Array.from({ length: N_PACK }, (_, i) => {
      const u = units.length ? units[(r() * units.length) | 0] : null;
      const a = u ? (r() - 0.5) * u.len : 0;
      const x = u ? u.x + Math.cos(u.rotY) * a : B.xMin + r() * B.w, z = u ? u.z - Math.sin(u.rotY) * a : B.zMin + r() * B.d;
      const ux = clamp01((x - B.xMin) / Math.max(1, B.w));
      const stockAt = (1 + 0.5 * ux) / 1.5 - r() * 0.33;
      const col = new THREE.Color().setHSL(r(), 0.75, 0.55);
      pk.setColorAt(i, col);
      return { x, z, y0: 0.5 + r() * 1.2, ts: T.wash0 + (1 - clamp01(stockAt)) * (T.wash1 - T.wash0), k: r(), ph: r() * 10, col };
    });
    if (pk.instanceColor) pk.instanceColor.needsUpdate = true;
    s.puddles = Array.from({ length: N_PUD }, () => ({ x: W.xL + 3 + r() * (W.xR - W.xL - 6), z: W.zA + 2 + r() * (W.zC - W.zA - 4), r: 0.8 + r() * 1.8 }));
    // the truck: in off the road, up the right-hand lane, along the front drive lane
    const tx = W.cx + (r() - 0.5) * 8;
    const tin = [V2(W.xR + 70, W.zNear), V2(W.xR - 4, W.zNear), V2(W.xR - 4, W.lanes[0]), V2(tx, W.lanes[0])];
    s.tIn = poly(tin); s.tOut = poly([...tin].reverse()); s.truckX = tx; s.truckZ = W.lanes[0];
    s.crew = Array.from({ length: N_CREW }, () => ({ x: tx, z: W.lanes[0], yaw: 0 }));
    EGG_FX.x0 = B.xMin; EGG_FX.x1 = B.xMax;
    for (const ref of [foam, ducks, crates, packs, puds, parts, heads, bodies, hats, trolleys, scaf]) {
      const im = ref.current; if (!im) continue;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, ZERO);
      im.instanceMatrix.needsUpdate = true;
    }
  };

  useFrame((_, dtRaw) => {
    const s = S.current, dt = Math.min(dtRaw, 0.1);
    s.clock += dt;
    const g = root.current; if (!g) return;
    if (s.t < 0) {
      if (s.fire || s.clock > s.next) { s.fire = false; setup(); s.t = Math.max(0, Number(urlFlag('tsunamit')) || 0); } // dev: ?tsunamit=60 starts mid-way
      else { if (g.visible) g.visible = false; return; }
    }
    s.t += dt;
    g.visible = true;
    const t = s.t, ck = s.clock, r = s.r, { B } = K;

    // ------------------------------------------------ sign
    const sg = signR.current!;
    const sk = t < 0.5 ? ease(t / 0.5) * 1.15 : t < 0.8 ? 1.15 - 0.15 * ((t - 0.5) / 0.3) : t < T.signOff ? 1 : 1 - ease((t - T.signOff) / 0.6);
    sg.visible = sk > 0.01;
    if (sg.visible) {
      const pulse = 1 + Math.sin(ck * 9) * 0.03;
      sg.scale.set(11 * sk * pulse, 5.5 * sk * pulse, 1);
      sg.position.set(K.signX, 11 + Math.sin(ck * 2) * 0.3, W.zF + 9);
      mats.sign.rotation = Math.sin(ck * 3.1) * 0.05;
      mats.sign.color.set(Math.sin(ck * 12) > 0 ? '#ffffff' : '#ffd6d6');
    }

    // ------------------------------------------------ wave front + amplitude
    let zw = K.zStart, amp = 0;
    if (t >= T.rise0 && t < T.rise1) amp = AMP * ease((t - T.rise0) / (T.rise1 - T.rise0));
    else if (t >= T.rise1 && t < T.roll1) { const u = (t - T.rise1) / (T.roll1 - T.rise1); zw = K.zStart + (K.zEnd - K.zStart) * u; amp = AMP * (1 - 0.5 * u); }
    else if (t >= T.roll1 && t < T.crash1) { const u = (t - T.roll1) / (T.crash1 - T.roll1); zw = K.zEnd - 2.5 * ease(u); amp = AMP * 0.5 * (1 - ease(u)); }
    s.zw = zw; s.amp = amp;
    const wv = wave.current!;
    wv.visible = amp > 0.02;
    const U = mats.wave.uniforms;
    U.uX0.value = K.x0; U.uW.value = K.width; U.uZ.value = zw; U.uA.value = amp; U.uT.value = ck;
    U.uO.value = t < T.roll1 ? 1 : 1 - clamp01((t - T.roll1) / (T.crash1 - T.roll1)) * 0.6;
    const hAt = (v: number, x: number) => amp * shape(v) * wob(x, ck) * taperK((x - K.x0) / K.width);
    const zAt = (v: number, x: number) => zw + v * DEPTH - CURL * amp * curlK(v) * taperK((x - K.x0) / K.width) * wob(x, ck);

    // ------------------------------------------------ flood sheet
    let level = 0, near = K.floodFar;
    if (t >= T.rise1 && t < T.roll1) { level = LEVEL_PEAK * clamp01((t - T.rise1) / 3); near = zw + DEPTH * 0.35; }
    else if (t >= T.roll1 && t < T.crash1) { const u = ease((t - T.roll1) / (T.crash1 - T.roll1)); level = LEVEL_PEAK; near = (K.zEnd + DEPTH * 0.35) + (W.zF - (K.zEnd + DEPTH * 0.35)) * u; }
    else if (t >= T.crash1 && t < T.recede0) { const u = ease(clamp01((t - T.crash1) / (T.seep1 - T.crash1))); level = LEVEL_PEAK + (LEVEL - LEVEL_PEAK) * u; near = W.zF - K.seep * u; }
    else if (t >= T.recede0 && t < T.recede1) { const u = (t - T.recede0) / (T.recede1 - T.recede0); level = LEVEL * (1 - ease(u)); near = (W.zF - K.seep) + (K.floodFar - (W.zF - K.seep)) * ease(u); }
    s.level = level; s.near = near;
    const fl = flood.current!;
    fl.visible = level > 0.004 && near < K.floodFar - 0.2;
    if (fl.visible) {
      const len = K.floodFar - near;
      fl.position.set((K.fx0 + K.fx1) / 2, 0.04 + level, (near + K.floodFar) / 2);
      fl.scale.set(K.fx1 - K.fx0, 1, len);
      mats.flood.uniforms.uT.value = ck; mats.flood.uniforms.uLen.value = len;
      mats.flood.uniforms.uO.value = clamp01(level / 0.06);
    }
    const wy = 0.04 + level;
    const wet = (z: number) => level > 0.01 && z >= near - 0.2;

    // ------------------------------------------------ foam along the crest + splash on the shop front
    const fo = foam.current!;
    for (let i = 0; i < N_FOAM; i++) {
      if (amp < 0.15) { fo.setMatrixAt(i, ZERO); continue; }
      const x = K.x0 + ((i + 0.5) / N_FOAM) * K.width;
      const tp = taperK((x - K.x0) / K.width);
      const sc = (0.55 + 0.3 * Math.sin(ck * 5 + i * 1.7)) * (amp / AMP) * 1.25 * tp;
      put(fo, i, x + Math.sin(ck * 2 + i) * 0.4, hAt(0.23, x) + 0.15, zAt(0.23, x) - 0.2, ck * 0.7 + i, sc);
    }
    fo.instanceMatrix.needsUpdate = true;
    if (t >= T.roll1 - 0.5 && t < T.crash1 - 1) for (let k = 0; k < 4; k++) {
      const x = W.xL + r() * (W.xR - W.xL);
      spawn(x, 0.3, W.zF + 1 + r() * 2, (r() - 0.5) * 2, 3 + r() * 4, -1 - r() * 2, 1 + r() * 0.6, 0.35 + r() * 0.4, '#f4fbff');
    }

    // ------------------------------------------------ parked cars bob + drift
    for (const c of s.cars) {
      const p = CAR_FX.parked[c.i]; if (!p) continue;
      const want = wet(p.z) && t < T.recede1 ? 1 : 0;
      c.a += (want - c.a) * Math.min(1, dt * 1.4);
      if (c.a < 0.002 && want === 0) { if (CAR_FX.over.has(c.i)) overrideCar(c.i, null); c.a = 0; continue; }
      const a = c.a;
      tmp.q.setFromEuler(tmp.e.set(a * 0.04 * Math.sin(ck * 1.3 + c.ph), p.yaw + a * 0.12 * Math.sin(ck * 0.6 + c.ph), a * 0.05 * Math.cos(ck * 1.1 + c.ph)));
      c.m.compose(tmp.v.set(p.x + a * c.dx, a * (0.16 + 0.06 * Math.sin(ck * 1.7 + c.ph)), p.z + a * c.dz), tmp.q, tmp.s.set(1, 1, 1));
      overrideCar(c.i, c.m, 1 - a * 0.6);
    }

    // ------------------------------------------------ ducks + crates
    const du = ducks.current!, cr = crates.current!;
    s.floaters.forEach((f, i) => {
      const im = f.kind ? cr : du, j = f.kind ? i - N_DUCK : i;
      let z: number;
      if (t < T.rise1 || level < 0.005) { im.setMatrixAt(j, ZERO); return; }
      if (t < T.roll1) z = Math.max(f.home, zw + DEPTH * 0.45 + f.k * 5);
      else z = Math.max(f.home, near + 1 + f.k * 5);
      if (z > K.floodFar - 0.5) { im.setMatrixAt(j, ZERO); return; }
      const sc = clamp01(level / 0.06) * (f.kind ? 1.3 : 1.7);
      put(im, j, f.x + Math.sin(ck * 0.4 + f.ph) * 0.8, wy - 0.05 + Math.sin(ck * 2.2 + f.ph) * 0.05, z, ck * 0.3 + f.ph, sc, Math.sin(ck * 1.9 + f.ph) * 0.12, Math.cos(ck * 1.6 + f.ph) * 0.12);
    });
    du.instanceMatrix.needsUpdate = true; cr.instanceMatrix.needsUpdate = true;

    // ------------------------------------------------ shelf stock + floating packs
    const stock = t < T.wash0 ? 1 : t < T.wash1 ? 1 - (t - T.wash0) / (T.wash1 - T.wash0) : t < T.stock0 ? 0 : t < T.stock1 ? (t - T.stock0) / (T.stock1 - T.stock0) : 1;
    EGG_FX.stock = stock;
    const pk = packs.current!;
    s.packs.forEach((p, i) => {
      const a = t - p.ts;
      if (a < 0 || t > T.recede1 + 1) { pk.setMatrixAt(i, ZERO); return; }
      let x = p.x, y: number, z = p.z;
      if (a < 0.7) { const u = a / 0.7; y = p.y0 + (wy - p.y0) * u * u + Math.sin(u * Math.PI) * 0.5; z += u * 0.6; }
      else {
        y = wy + 0.02 + Math.sin(ck * 2.4 + p.ph) * 0.04;
        x += Math.sin(ck * 0.5 + p.ph) * 0.4 + (p.k - 0.5) * (a - 0.7) * 0.2;
        z = Math.max(z + 0.6 + (a - 0.7) * 0.15, near + 0.4 + p.k * 4);
      }
      if (z > K.floodFar - 0.5) { pk.setMatrixAt(i, ZERO); return; }
      const sc = a < 0.7 ? 1 : clamp01(level / 0.04);
      put(pk, i, x, y, z, ck * 0.4 + p.ph, sc, a < 0.7 ? a * 3 : Math.PI / 2 - 0.1, Math.sin(ck + p.ph) * 0.2);
    });
    pk.instanceMatrix.needsUpdate = true;

    // ------------------------------------------------ puddles
    const pu = puds.current!;
    pu.visible = t > T.recede1 - 4 && t < T.pud1;
    if (pu.visible) {
      const k = 1 - clamp01((t - T.recede1) / (T.pud1 - T.recede1));
      mats.puddle.opacity = 0.55 * Math.min(1, (t - (T.recede1 - 4)) / 3) * k;
      s.puddles.forEach((p, i) => pu.setMatrixAt(i, mat(p.x, 0.045, p.z, 0, p.r * (0.4 + 0.6 * k), 1, p.r * 0.7 * (0.4 + 0.6 * k))));
      pu.instanceMatrix.needsUpdate = true;
    }

    // ------------------------------------------------ store shell: wobble, tilt + squash, rebuild piece by piece
    const nP = s.pieces.length, bw = (T.build1 - T.build0) / Math.max(1, nP);
    s.order.forEach((pi, rank) => {
      const p = s.pieces[pi];
      const f0 = T.fall0 + rank * Math.min(0.4, 4 / Math.max(1, nP)), f1 = f0 + 2.2;
      const b0 = T.build0 + rank * bw, b1 = b0 + Math.max(1.4, bw * 1.3);
      let ang = 0, sy = 1;
      if (t >= T.wobble0 && t < f0) ang = Math.sin((t - T.wobble0) * 14 + rank) * 0.03 * clamp01((t - T.wobble0) / 1);
      else if (t >= f0 && t < b0) { const u = clamp01((t - f0) / (f1 - f0)); ang = 0.35 * ease(Math.min(1, u * 1.6)); sy = 1 - 0.96 * ease(clamp01((u - 0.25) / 0.75)); }
      else if (t >= b0 && t < b1) { const u = clamp01((t - b0) / (b1 - b0)); const back = 1 + 2.7 * (u - 1) ** 3 + 1.7 * (u - 1) ** 2; sy = 0.04 + 0.96 * back; ang = 0.35 * (1 - ease(Math.min(1, u * 2))); }
      if (t >= T.wobble0 && t < T.build1 + 3) posePiece(p, ang, sy);
      else if (t >= T.build1 + 3 && !p.obj.matrix.equals(p.m0)) posePiece(p, 0, 1);
      // dust when it goes down
      const key = `f${pi}`;
      if (t >= f0 + 0.6 && !s.dusted.has(key)) {
        s.dusted.add(key);
        const n = Math.min(10, 2 + Math.round(p.len / 6));
        for (let k = 0; k < n; k++) { const a = (k / Math.max(1, n - 1) - 0.5) * p.len; puffAt(p.alongX ? p.cx + a : p.cx, 0.6, p.alongX ? p.cz : p.cz + a, 2, '#e9dccb', 1.1); }
      }
      // hammer sparks while it rises
      if (t >= b0 && t < b1 && r() < dt * 14) {
        const a = (r() - 0.5) * p.len, y = (0.04 + 0.96 * clamp01((t - b0) / (b1 - b0))) * Math.max(1, p.top);
        const x = p.alongX ? p.cx + a : p.cx + p.sgn * 0.3, z = p.alongX ? p.cz + p.sgn * 0.3 : p.cz + a;
        for (let k = 0; k < 3; k++) spawn(x, y, z, (r() - 0.5) * 3, 1.5 + r() * 2, (r() - 0.5) * 3, 0.4 + r() * 0.3, 0.12 + r() * 0.08, k ? '#ffd23f' : '#ffffff');
      }
    });
    const curPiece = nP ? s.pieces[s.order[Math.min(nP - 1, Math.max(0, Math.floor((t - T.build0) / bw)))]] : null;

    // ------------------------------------------------ scaffolding
    const sf = scaf.current!;
    sf.visible = t >= T.scaf0 && t < T.scafOff1;
    if (sf.visible) {
      const up = t < T.scafOff0 ? clamp01((t - T.scaf0) / (T.scaf1 - T.scaf0)) : 1 - clamp01((t - T.scafOff0) / (T.scafOff1 - T.scafOff0));
      s.scaf.forEach((b, i) => {
        const k = clamp01(up * 1.6 - (b.piece / Math.max(1, nP)) * 0.6);
        if (k <= 0.01 || (b.plank && k < (b.y < 2 ? 0.45 : 0.85))) { sf.setMatrixAt(i, ZERO); return; }
        const sy = b.plank ? b.sy : b.sy * k;
        sf.setMatrixAt(i, tmp.m.compose(tmp.v.set(b.x, b.plank ? b.y : sy / 2, b.z), tmp.q.identity(), tmp.s.set(b.sx, sy, b.sz)));
      });
      sf.instanceMatrix.needsUpdate = true;
    }

    // ------------------------------------------------ truck
    const tr = truck.current!;
    const inT = t >= T.truck0 && t < T.truckOut1;
    tr.visible = inT;
    if (inT && s.tIn && s.tOut) {
      if (t < T.truck1) { const u = (t - T.truck0) / (T.truck1 - T.truck0); s.tIn.at(s.tIn.len * (1 - (1 - u) * (1 - u)), tmp.o); }
      else if (t < T.truckOut0) { s.tIn.at(s.tIn.len, tmp.o); }
      else { const u = (t - T.truckOut0) / (T.truckOut1 - T.truckOut0); s.tOut.at(s.tOut.len * u * u, tmp.o); }
      tr.position.set(tmp.o.x, 0, tmp.o.z); tr.rotation.y = tmp.o.yaw;
      drum.current!.rotation.y += dt * 2.2;
    }

    // ------------------------------------------------ people swap (the store's own crowd hides while evacuees are out)
    if (t >= T.evac0 && t < T.back1 && !s.peopleHidden) { if (EGG_FX.people) EGG_FX.people.visible = false; s.peopleHidden = true; }
    if (t >= T.back1 && s.peopleHidden) { if (EGG_FX.people) EGG_FX.people.visible = true; s.peopleHidden = false; }

    // ------------------------------------------------ minions
    const hh = heads.current!, hb = bodies.current!, ht = hats.current!, tl = trolleys.current!, bd = board.current!;
    const setMin = (i: number, x: number, y: number, z: number, yaw: number, sc: number, rx = 0, rz = 0) => { put(hh, i, x, y, z, yaw, sc, rx, rz); put(hb, i, x, y, z, yaw, sc, rx, rz); };
    // surfers
    let boardOn = false;
    s.surf.forEach((sf2, i) => {
      let x = sf2.x, y = 0, z = 0, yaw = Math.PI, rx = 0, rz = 0, sc = MSCALE, hop = 0;
      if (t < T.rise0 + 0.8 || t > T.surfOut + 0.5) { setMin(i, 0, 0, 0, 0, 0); if (i < 2) tl.setMatrixAt(i, ZERO); return; }
      if (t < T.hop) {
        x = sf2.x + Math.sin(ck * 0.8 + i * 2) * 2.5;
        z = zAt(0.12, x); y = hAt(0.12, x);
        rx = -0.25 + Math.sin(ck * 3 + i) * 0.06; rz = Math.sin(ck * 1.3 + i) * 0.15;
        sf2.hopX = x; sf2.hopZ = z;
        sc = MSCALE * clamp01((t - T.rise0 - 0.8) / 0.6);
      } else {
        const u = clamp01((t - T.hop) / 1.2);
        x = sf2.hopX; z = sf2.hopZ - 3 * ease(u);
        const h0 = hAt(0.12, x) || 0;
        const base = level > 0.01 && wet(z) ? wy - 0.12 : 0;
        y = u < 1 ? h0 * (1 - u) + base * u + Math.sin(u * Math.PI) * 1.2 : base + Math.sin(ck * 2 + i) * 0.04;
        if (t > T.crash1 && t < T.crash1 + 3) hop = Math.abs(Math.sin((t - T.crash1) * 7 + i)) * 0.4;
        const gone = clamp01((t - T.surfOut) / 0.4);
        if (gone > 0 && !s.dusted.has(`s${i}`)) { s.dusted.add(`s${i}`); puffAt(x, 0.5, z, 5, '#ffffff', 0.6); }
        sc = MSCALE * (1 - ease(gone));
      }
      const ride = i < 2 ? TROLLEY.floorY * MSCALE : 0.1 * MSCALE;
      setMin(i, x, y + ride + hop, z, yaw, sc, rx, rz);
      if (i < 2) put(tl, i, x, y + hop, z, yaw, sc, rx, rz);
      else { boardOn = sc > 0.001; if (boardOn) { bd.position.set(x, y + hop, z); bd.rotation.set(rx, yaw, rz); bd.scale.setScalar(sc); } }
    });
    bd.visible = boardOn;
    tl.instanceMatrix.needsUpdate = true;
    // evacuees
    s.evac.forEach((e, i) => {
      const k = I_EVAC + i;
      if (t < T.evac0 + e.d0 || t > T.back1 + 1) { setMin(k, 0, 0, 0, 0, 0); return; }
      let sc = MSCALE, hop = 0, yaw: number;
      if (t < T.back0) {
        const d = (t - T.evac0 - e.d0) * e.sp;
        e.out.at(d, tmp.o); yaw = tmp.o.yaw;
        const moving = d < e.out.len;
        if (moving) hop = Math.abs(Math.sin(ck * 11 + e.ph)) * 0.12;
        else {
          yaw = Math.atan2(W.cx - tmp.o.x, W.zA + 8 - tmp.o.z);
          const cheer = (t > T.crash1 - 3 && t < T.crash1 + 4) || (t > T.build1 && t < T.build1 + 4);
          if (cheer) hop = Math.abs(Math.sin(ck * 7 + e.ph)) * 0.45;
        }
        sc = MSCALE * clamp01((t - T.evac0 - e.d0) / 0.3);
      } else {
        const d = (t - T.back0 - e.d0 * 0.5) * e.sp;
        e.back.at(Math.max(0, d), tmp.o); yaw = tmp.o.yaw;
        if (d > 0 && d < e.back.len) hop = Math.abs(Math.sin(ck * 11 + e.ph)) * 0.12;
        sc = MSCALE * (1 - clamp01((d - e.back.len) / 3));
      }
      setMin(k, tmp.o.x, hop, tmp.o.z, yaw, sc);
    });
    // builders
    s.crew.forEach((c, i) => {
      const k = I_CREW + i;
      if (t < T.crewOut || t > T.crewIn + 3 || !curPiece) { setMin(k, 0, 0, 0, 0, 0); ht.setMatrixAt(i, ZERO); return; }
      let tx = s.truckX + (i - 2) * 1.2, tz = s.truckZ - 2.5;
      const p = t < T.build0 ? s.pieces[s.order[0]] : curPiece;
      if (t < T.crewIn) {
        const off = (i - 2) * Math.min(p.len / 6, 2.4);
        tx = p.alongX ? p.cx + off : p.cx + p.sgn * 2.2; tz = p.alongX ? p.cz + p.sgn * 2.2 : p.cz + off;
      }
      const dx = tx - c.x, dz = tz - c.z, dd = Math.hypot(dx, dz), step = Math.min(dd, dt * 6.5);
      let hop = 0, rx = 0;
      if (dd > 0.05) { c.x += (dx / dd) * step; c.z += (dz / dd) * step; c.yaw = Math.atan2(dx, dz); hop = Math.abs(Math.sin(ck * 11 + i)) * 0.12; }
      else if (t < T.crewIn) { c.yaw = Math.atan2(p.cx - c.x, p.cz - c.z); if (t >= T.build0 && t < T.build1) { rx = Math.max(0, Math.sin(ck * 10 + i * 1.3)) * 0.25; } }
      const appear = clamp01((t - T.crewOut) / 0.3), gone = t > T.crewIn ? clamp01((t - T.crewIn - (dd < 0.3 ? 0 : 2)) / 0.4) : 0;
      if (t > T.crewIn && dd < 0.3 && gone > 0.95 && !s.dusted.has(`c${i}`)) s.dusted.add(`c${i}`);
      const sc = MSCALE * appear * (1 - gone);
      setMin(k, c.x, hop, c.z, c.yaw, sc, rx);
      put(ht, i, c.x, hop, c.z, c.yaw, sc, rx);
    });
    // restockers: walk the refill sweep inside the store
    for (let i = 0; i < N_RESTOCK; i++) {
      const k = I_REST + i;
      if (t < T.stock0 || t > T.stock1 + 0.5) { setMin(k, 0, 0, 0, 0, 0); continue; }
      const uF = clamp01(3 * stock - 1 + 0.05);
      const x = B.xMin + 1.5 + uF * (B.w - 3), z = B.zMin + B.d * (0.25 + 0.25 * i);
      if (t > T.stock0 && !s.dusted.has(`r${i}`)) { s.dusted.add(`r${i}`); puffAt(x, 0.5, z, 4, '#ffffff', 0.5); }
      const sc = MSCALE * clamp01((t - T.stock0) / 0.3) * (1 - clamp01((t - T.stock1) / 0.4));
      setMin(k, x + Math.sin(ck * 1.5 + i) * 0.6, Math.abs(Math.sin(ck * 9 + i)) * 0.1, z + Math.sin(ck * 0.9 + i * 2) * 2, Math.PI / 2, sc);
    }
    hh.instanceMatrix.needsUpdate = true; hb.instanceMatrix.needsUpdate = true; ht.instanceMatrix.needsUpdate = true;

    // ------------------------------------------------ particles (splash, dust, sparks, poofs)
    const pp = parts.current!;
    for (let i = 0; i < N_P; i++) {
      if (P.life[i] <= 0) { pp.setMatrixAt(i, ZERO); continue; }
      P.age[i] += dt;
      const a = P.age[i] / P.life[i];
      if (a >= 1) { P.life[i] = 0; pp.setMatrixAt(i, ZERO); continue; }
      P.vel[i * 3 + 1] -= dt * 5;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] = Math.max(0.05, P.pos[i * 3 + 1] + P.vel[i * 3 + 1] * dt); P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      const sc = P.size[i] * (0.6 + a * 0.8) * (1 - a * a);
      put(pp, i, P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2], i, sc);
    }
    pp.instanceMatrix.needsUpdate = true;

    // ------------------------------------------------ done: everything back exactly as it was
    if (t >= T.done) {
      restoreAll();
      s.t = -1; s.next = s.clock + REPEAT_MIN + s.r() * REPEAT_RAND;
      g.visible = false;
    }
  });

  return (
    <group ref={root} visible={false}>
      <sprite ref={signR} material={mats.sign} renderOrder={20} raycast={noRay} />
      <mesh ref={wave} geometry={geo.wave} material={mats.wave} raycast={noRay} frustumCulled={false} renderOrder={8} />
      <mesh ref={flood} geometry={geo.flood} material={mats.flood} raycast={noRay} frustumCulled={false} renderOrder={7} />
      <instancedMesh ref={foam} args={[geo.puff, mats.foam, N_FOAM]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={ducks} args={[geo.duck, mats.vc, N_DUCK]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={crates} args={[geo.crate, mats.vc, N_CRATE]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={packs} args={[geo.pack, mats.pack, N_PACK]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={puds} args={[geo.puddle, mats.puddle, N_PUD]} raycast={noRay} frustumCulled={false} renderOrder={6} />
      <instancedMesh ref={parts} args={[geo.puff, mats.puff, N_P]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={heads} args={[mg.head, MINION_MAT.head, N_MIN]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={bodies} args={[mg.overalls, MINION_MAT.tint, N_MIN]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={hats} args={[geo.hat, mats.vc, N_CREW]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={trolleys} args={[geo.trolley, mats.trolley, 2]} raycast={noRay} frustumCulled={false} />
      <mesh ref={board} geometry={geo.board} material={mats.vc} raycast={noRay} visible={false} />
      <instancedMesh ref={scaf} args={[geo.bar, mats.scaf, N_SCAF]} raycast={noRay} frustumCulled={false} visible={false} />
      <group ref={truck} visible={false}>
        <mesh geometry={geo.truck} material={mats.vc} raycast={noRay} />
        <group position={[0, 2.35, -1.1]} rotation={[-(Math.PI / 2 - 0.25), 0, 0]}>
          <mesh ref={drum} geometry={geo.drum} material={mats.vc} raycast={noRay} />
        </group>
      </group>
    </group>
  );
}

// Easter egg: a (completely original, fictional) big-name video creator drops in for a store challenge video. A tall
// minion in a bright blue hoodie with a white star badge, mic in hand, walks in through the main entrance with a
// three-minion camera crew walking backwards in front of him (shoulder camera with a blinking REC light, boom mic,
// ring light), ~36 fans streaming in behind. He stops at two aisle mouths on the front cross aisle, does a hype jump,
// throws confetti and a floating challenge sign pops up; then the whole group walks back out and fades.
// ?celeb=now triggers it at once; window.__celeb() from the console; otherwise it happens rarely on its own.
// Perf: hidden when idle; while active ~13 draw calls (celeb 4, crew+fans 3 instanced, props 4, confetti 1 instanced,
// sign sprite 1); no lights; one useFrame; all geometries / materials / the canvas texture disposed on unmount.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { StoreConfig } from '../../types';
import { G, routeBetween, storePlan } from '../../layout';
import { BODY } from '../parts';
import { minionGeo, MINION_MAT, MINION_SHOULDER } from '../minion';
import { Geo, mat, rng } from './geo';
import { CAR_FX, urlFlag, ease, clamp01 } from './eggs';

const noRay = () => null;
const N_CREW = 3, N_FANS = 36, N_MEM = N_CREW + N_FANS, N_CONF = 160;
const SCALE = 1.6;            // assumption: visual. the creator is a head taller than everyone else
const SPEED = 1.35;           // m/s, assumption: visual (a little brisker than a shopper)
const STOP = 11;              // s per stop, assumption: visual
const FIRST = [150, 150];     // first visit after 150-300 s, assumption: visual (rarer than the UFO)
const AGAIN = [240, 240];     // then every 240-480 s, assumption: visual
const FADE = 2.5;             // s, assumption: visual
const HOODIE = '#1e7bff', HOODIE_DK = '#1560d6';
const SIGNS = [
  { top: 'CHALLENGE!', big: '£10,000', sub: 'to whoever buys the last yoghurt!' },
  { top: 'NEW VIDEO', big: 'LAST ONE IN', sub: 'the aisle wins a year of snacks!' },
];

type XY = { x: number; z: number };

// ---------- geometry ----------
function rod(g: Geo, a: THREE.Vector3, b: THREE.Vector3, r: number, color: string, seg = 8) {
  const d = b.clone().sub(a), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, len, r));
  return g.add(new THREE.CylinderGeometry(1, 1, 1, seg), color, m);
}
function starShape(R: number, r: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r : R;
    if (i) s.lineTo(Math.cos(a) * k, Math.sin(a) * k); else s.moveTo(Math.cos(a) * k, Math.sin(a) * k);
  }
  return s;
}
/** hoodie + shorts + hood + pocket + drawstrings + star badge, body frame (unscaled minion), one mesh */
function hoodieGeometry() {
  const g = new Geo();
  const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
  g.add(new THREE.LatheGeometry([V2(0.18, 0.05), V2(0.218, 0.08), V2(0.272, 0.14), V2(0.302, 0.22)], 26), '#2a2d3a');
  g.add(new THREE.LatheGeometry([V2(0.296, 0.19), V2(0.32, 0.25), V2(0.324, 0.5), V2(0.323, 0.64), V2(0.31, 0.69)], 28), HOODIE);
  g.add(new THREE.TorusGeometry(0.3, 0.045, 8, 28), HOODIE_DK, mat(0, 0.68, 0, 0, 1, 1, 1, Math.PI / 2));
  // hood hanging at the back of the head
  g.add(new THREE.SphereGeometry(0.318, 18, 8, Math.PI, Math.PI, Math.PI * 0.3, Math.PI * 0.55), HOODIE_DK, mat(0, 0.9, -0.01));
  g.box(0, 0.33, 0.318, 0.3, 0.13, 0.03, HOODIE_DK);                                   // kangaroo pocket
  for (const s of [-1, 1]) {
    rod(g, new THREE.Vector3(s * 0.07, 0.68, 0.33), new THREE.Vector3(s * 0.075, 0.56, 0.336), 0.009, '#ffffff', 5);
    g.add(new THREE.SphereGeometry(0.016, 6, 4), '#ffffff', mat(s * 0.075, 0.555, 0.337));
  }
  // badge: dark-blue disc with a white five-point star (original mark)
  g.add(new THREE.CircleGeometry(0.085, 20), '#0b3f9c', mat(0.0, 0.5, 0.33));
  g.add(new THREE.ShapeGeometry(starShape(0.068, 0.028)), '#ffffff', mat(0.0, 0.5, 0.334));
  return g.build();
}
/** minion arm recoloured blue (sleeve) + dark glove; optional handheld mic. pivot = shoulder, hangs along -y */
function sleeveGeometry(mic: boolean) {
  const arm = minionGeo().arm.clone();
  const c = arm.attributes.color as THREE.BufferAttribute, blue = new THREE.Color(HOODIE);
  for (let i = 0; i < c.count; i++) if (c.getX(i) > 0.9) c.setXYZ(i, blue.r, blue.g, blue.b);
  for (const k of Object.keys(arm.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') arm.deleteAttribute(k);
  const g = new Geo();
  g.parts.push(arm);
  if (mic) {
    rod(g, new THREE.Vector3(0, -BODY.armLen + 0.02, 0.03), new THREE.Vector3(0, -BODY.armLen - 0.16, 0.03), 0.024, '#1b1b20', 8);
    g.add(new THREE.SphereGeometry(0.05, 10, 8), '#9aa1ad', mat(0, -BODY.armLen - 0.2, 0.03));
    g.box(0, -BODY.armLen - 0.1, 0.06, 0.055, 0.05, 0.012, '#ff3b5c');                 // mic flag (no logo)
  }
  return g.build();
}
/** crew props, crew body frame (facing +z, i.e. towards the creator they film) */
function cameraGeometry() {
  const g = new Geo();
  g.box(-0.25, 1.06, 0.06, 0.2, 0.22, 0.46, '#1a1a1f');
  g.add(new THREE.CylinderGeometry(0.075, 0.085, 0.16, 12), '#2b2b33', mat(-0.25, 1.05, 0.36, 0, 1, 1, 1, Math.PI / 2));
  g.add(new THREE.CircleGeometry(0.066, 12), '#5f8fd8', mat(-0.25, 1.05, 0.441));
  g.box(-0.25, 1.21, 0.06, 0.05, 0.06, 0.3, '#2b2b33');                                  // top handle
  g.box(-0.13, 1.08, -0.08, 0.05, 0.12, 0.14, '#3a3a44');                              // viewfinder
  return g.build();
}
function boomGeometry() {
  const g = new Geo();
  const a = new THREE.Vector3(0, 0.7, -0.1), b = new THREE.Vector3(0, 2.45, 1.75);
  rod(g, a, b, 0.022, '#3a3a44', 6);
  const d = b.clone().sub(a).normalize();
  const m = new THREE.Matrix4().compose(b.clone().add(d.clone().multiplyScalar(0.12)), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d), new THREE.Vector3(1, 1, 1));
  g.add(new THREE.CapsuleGeometry(0.085, 0.26, 4, 10), '#8c8c92', m);                 // fluffy windshield
  return g.build();
}
function ringGeometry() {
  const g = new Geo();
  rod(g, new THREE.Vector3(0, 0.62, 0.2), new THREE.Vector3(0, 1.3, 0.24), 0.02, '#3a3a44', 6);
  g.add(new THREE.TorusGeometry(0.3, 0.045, 8, 26), '#ffffff', mat(0, 1.58, 0.25));
  g.add(new THREE.CircleGeometry(0.25, 20), '#fff6dc', mat(0, 1.58, 0.24, 0, 1, 1, 1, 0));
  return g.build();
}

function signCanvas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 320;
  return c;
}
function drawSign(c: HTMLCanvasElement, i: number) {
  const x = c.getContext('2d')!, s = SIGNS[i % SIGNS.length];
  x.clearRect(0, 0, c.width, c.height);
  const r = 46, w = c.width - 24, h = c.height - 24;
  x.beginPath(); x.roundRect(12, 12, w, h, r);
  x.fillStyle = '#ffe14a'; x.fill(); x.lineWidth = 14; x.strokeStyle = '#141317'; x.stroke();
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#1e7bff'; x.font = '900 46px Inter, system-ui, sans-serif'; x.fillText(s.top, 512, 66);
  x.fillStyle = '#e8213f'; x.font = '900 112px Inter, system-ui, sans-serif'; x.fillText(s.big, 512, 154);
  x.fillStyle = '#141317'; x.font = '800 48px Inter, system-ui, sans-serif'; x.fillText(s.sub, 512, 250);
}

// ---------- path ----------
interface Path { pts: XY[]; cum: number[]; L: number }
function mkPath(raw: XY[]): Path {
  const pts: XY[] = [];
  for (const p of raw) { const l = pts[pts.length - 1]; if (!l || Math.hypot(p.x - l.x, p.z - l.z) > 0.05) pts.push({ x: p.x, z: p.z }); }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, L: cum[cum.length - 1] };
}
const _pa = { x: 0, z: 0, dx: 0, dz: 1 };
/** point + unit direction at arc length s (extrapolated past both ends along the end segments) */
function pathAt(P: Path, s: number) {
  const n = P.pts.length;
  let i = 1;
  if (s > 0) while (i < n - 1 && P.cum[i] < s) i++;
  const a = P.pts[i - 1], b = P.pts[i], seg = Math.max(1e-6, P.cum[i] - P.cum[i - 1]);
  _pa.dx = (b.x - a.x) / seg; _pa.dz = (b.z - a.z) / seg;
  const u = s - P.cum[i - 1];
  _pa.x = a.x + _pa.dx * u; _pa.z = a.z + _pa.dz * u;
  return _pa;
}

interface Member { gx: number[]; gz: number[]; x: number; z: number; vx: number; vz: number; yaw: number; lag: number; lat: number; ang: number; rad: number; ph: number; delay: number; col: THREE.Color }

export function CelebVisit({ cfg }: { cfg: StoreConfig }) {
  // ---------- route: outside → door → aisle mouth A → aisle mouth B → door → outside ----------
  const route = useMemo(() => {
    const P = storePlan(cfg), ent = P.entrances[0];
    const clear = (x: number, z: number, pad = 0.35) => !P.obstacles.some((r) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad);
    const front = P.walkways.length ? Math.max(...P.walkways.map((w) => w.z1)) : P.crossBack - G.crossGap;
    const bankZ = Math.min(P.bank.z0, P.bank.z1);
    const zLim = bankZ > front + 2 ? bankZ : front + 8;
    const ws = P.walkways.filter((w) => Math.abs(w.z1 - front) < 0.5).sort((a, b) => Math.abs(a.x - ent.x) - Math.abs(b.x - ent.x));
    /** stand in the middle of the widest free z-run of the front cross aisle at this x (checks a 1.6 m wide strip) */
    const free = (x: number) => {
      let best = [front + 2, front + 2], run0 = NaN;
      for (let z = front; z <= zLim + 1e-6; z += 0.1) {
        const ok = z < zLim && clear(x - 0.8, z, 0.3) && clear(x, z, 0.3) && clear(x + 0.8, z, 0.3);
        if (ok && Number.isNaN(run0)) run0 = z;
        if (!ok && !Number.isNaN(run0)) { if (z - run0 > best[1] - best[0]) best = [run0, z]; run0 = NaN; }
      }
      return { x, z: (best[0] + best[1]) / 2, room: (best[1] - best[0]) / 2 };
    };
    const A = free(ws[0]?.x ?? ent.x - 6);
    const wB = ws.find((w) => Math.abs(w.x - A.x) >= 9 && Math.abs(w.x - ent.x) > Math.abs(A.x - ent.x)) ?? ws[1];
    const B = free(wB?.x ?? A.x - 10);
    const out = { x: ent.x, z: ent.z + 7 }, door = { x: ent.x, z: ent.z - 1.2 };
    const raw: XY[] = [out, door, ...routeBetween(cfg, door, A, 0.5)];
    const p1 = mkPath(raw);
    const raw2 = [...raw, ...routeBetween(cfg, A, B, 0.5)];
    const p2 = mkPath(raw2);
    const all = mkPath([...raw2, ...routeBetween(cfg, B, door, 0.5), out]);
    return { path: all, sA: p1.L, sB: p2.L, stops: [A, B], clear };
  }, [cfg]);

  const mg = minionGeo();
  const geo = useMemo(() => ({
    hoodie: hoodieGeometry(), armL: sleeveGeometry(false), armR: sleeveGeometry(true),
    cam: cameraGeometry(), boom: boomGeometry(), ring: ringGeometry(),
    rec: new THREE.SphereGeometry(0.035, 8, 6), conf: new THREE.PlaneGeometry(0.07, 0.11),
  }), []);
  const canvas = useMemo(() => signCanvas(), []);
  const mats = useMemo(() => {
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return {
      head: MINION_MAT.head.clone(),
      tint: MINION_MAT.tint.clone(),
      kit: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      prop: new THREE.MeshLambertMaterial({ vertexColors: true }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
      rec: new THREE.MeshBasicMaterial({ color: '#ff1a2e' }),
      conf: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      sign: new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }),
    };
  }, [canvas]);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); mats.sign.map?.dispose(); Object.values(mats).forEach((m) => m.dispose()); }, [geo, mats]);

  const root = useRef<THREE.Group>(null), celeb = useRef<THREE.Group>(null), armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  const mHead = useRef<THREE.InstancedMesh>(null), mBody = useRef<THREE.InstancedMesh>(null), mArm = useRef<THREE.InstancedMesh>(null);
  const crew = [useRef<THREE.Group>(null), useRef<THREE.Group>(null), useRef<THREE.Group>(null)];
  const rec = useRef<THREE.Mesh>(null), conf = useRef<THREE.InstancedMesh>(null), sign = useRef<THREE.Sprite>(null);
  const invalidate = useThree((s) => s.invalidate), camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitImpl | null;
  const ctl = useRef({ camera, controls, invalidate }); ctl.current = { camera, controls, invalidate };

  const S = useRef({
    r: rng(9091), clock: 0, next: 0, t: -1, fire: false, fade: 1, transp: false, signI: -1,
    tl: { a0: 0, a1: 0, b0: 0, b1: 0, end: 0 }, lx: 0, lz: 0, lyaw: 0, lastS: 0,
    mem: [] as Member[],
    conf: { p: new Float32Array(N_CONF * 3), v: new Float32Array(N_CONF * 3), rot: new Float32Array(N_CONF * 3), life: new Float32Array(N_CONF) },
    burst: [false, false, false, false],
  });

  useEffect(() => {
    const s = S.current;
    s.next = urlFlag('celeb') === 'now' ? 1.5 : FIRST[0] + s.r() * FIRST[1];
    const w = window as unknown as Record<string, unknown>;
    w.__celeb = () => { s.fire = true; ctl.current.invalidate(); return 'and we are LIVE'; };
    w.__celebState = () => ({ t: s.t, x: s.lx, z: s.lz, tl: s.tl });
    /** debug / screenshot framing: point the camera at the creator */
    w.__celebLook = (d = 9) => {
      const { camera: c, controls: o } = ctl.current; if (!o) return;
      o.target.set(s.lx, 1, s.lz); c.position.set(s.lx + d * 0.3, d * 0.9, s.lz + d * 0.6); o.update(); ctl.current.invalidate();
    };
    // members: crew 0..2, fans after
    const fanCols = ['#ff5a7a', '#ffb02e', '#38c172', '#9b6bff', '#ff7a3d', '#21b8c9', '#f25fd0', '#5a8cff'];
    if (!s.mem.length) for (let i = 0; i < N_MEM; i++) {
      const crewM = i < N_CREW, k = i - N_CREW;
      const ang = crewM ? [-0.65, 1.15, 0.6][i] : 0.95 + ((k + s.r() * 0.6) / N_FANS) * (Math.PI * 2 - 1.9);
      s.mem.push({
        gx: [0, 0], gz: [0, 0], x: 0, z: 0, vx: 0, vz: 0, yaw: 0, ph: s.r() * 6.28, delay: s.r() * 0.35,
        lag: crewM ? -[2.3, 2.0, 2.0][i] : 2.4 + k * 0.33 + s.r() * 0.6,
        lat: crewM ? [0, -1.1, 1.1][i] : (s.r() - 0.5) * 2.4,
        ang, rad: crewM ? [2.0, 2.2, 1.9][i] : 1.7 + s.r() * 2.2,
        col: new THREE.Color(crewM ? '#2a2a30' : fanCols[(s.r() * fanCols.length) | 0]),
      });
    }
    const b = mBody.current;
    if (b) { s.mem.forEach((m, i) => b.setColorAt(i, m.col)); if (b.instanceColor) b.instanceColor.needsUpdate = true; }
    const a = mArm.current, skin = new THREE.Color('#f6d23a');
    if (a) { for (let i = 0; i < N_MEM * 2; i++) a.setColorAt(i, i < N_CREW * 2 ? new THREE.Color('#2a2a30') : skin); if (a.instanceColor) a.instanceColor.needsUpdate = true; }
    const cf = conf.current;
    if (cf) {
      const cc = ['#ff3b5c', '#ffd23a', '#1e7bff', '#38e08a', '#ffffff', '#b46bff', '#ff8a2a'];
      for (let i = 0; i < N_CONF; i++) { cf.setColorAt(i, new THREE.Color(cc[i % cc.length])); cf.setMatrixAt(i, ZERO); }
      cf.instanceMatrix.needsUpdate = true; if (cf.instanceColor) cf.instanceColor.needsUpdate = true;
    }
    return () => { delete w.__celeb; delete w.__celebLook; delete w.__celebState; };
  }, []);

  /** leader arc length at time t, plus which stop (0/1) and the time into it (-1 when walking) */
  const leaderAt = (t: number) => {
    const T = S.current.tl, { sA, sB } = route;
    if (t < T.a0) return { s: t * SPEED, stop: -1, u: 0 };
    if (t < T.a1) return { s: sA, stop: 0, u: t - T.a0 };
    if (t < T.b0) return { s: sA + (t - T.a1) * SPEED, stop: -1, u: 0 };
    if (t < T.b1) return { s: sB, stop: 1, u: t - T.b0 };
    return { s: sB + (t - T.b1) * SPEED, stop: -1, u: 0 };
  };

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), m2: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), v: new THREE.Vector3(), sc: new THREE.Vector3() }), []);

  useFrame((_, dtRaw) => {
    const s = S.current, dt = Math.min(dtRaw, 0.1);
    s.clock += dt;
    const g = root.current; if (!g || s.mem.length < N_MEM) return;
    if (s.t < 0) {
      if (s.fire || s.clock > s.next) {
        s.fire = false; s.t = 0; s.signI = -1; s.burst.fill(false);
        const { sA, sB, path } = route;
        const a0 = sA / SPEED, a1 = a0 + STOP, b0 = a1 + (sB - sA) / SPEED, b1 = b0 + STOP;
        const maxLag = Math.max(...s.mem.map((m) => m.lag));
        s.tl = { a0, a1, b0, b1, end: b1 + (path.L - sB + maxLag + 3) / SPEED + FADE };
        // gather spots round each stop: an ellipse squashed to the aisle's free depth, pulled in towards the creator
        // until the spot (and the walk to it) is clear of fixtures
        route.stops.forEach((st, k) => s.mem.forEach((m, i) => {
          const isCrew = i < N_CREW, rz = Math.min(isCrew ? 1 : 0.72, Math.max(0.35, (st.room - 0.3) / Math.max(1, m.rad)));
          let ox = Math.sin(m.ang) * m.rad * (isCrew ? 0.9 : 1.35), oz = Math.cos(m.ang) * m.rad * rz;
          for (let n = 0; n < 10; n++) {
            let ok = true;
            for (let q = 1; q <= 4 && ok; q++) ok = route.clear(st.x + (ox * q) / 4, st.z + (oz * q) / 4);
            if (ok) break;
            ox *= 0.85; oz *= 0.85;
          }
          m.gx[k] = ox; m.gz[k] = oz;
        }));
        for (const m of s.mem) { const p = pathAt(path, -m.lag); m.x = p.x - p.dz * m.lat; m.z = p.z + p.dx * m.lat; m.vx = m.vz = 0; m.yaw = Math.PI; }
        s.conf.life.fill(0);
        const p0 = pathAt(path, 0); s.lx = p0.x; s.lz = p0.z; s.lyaw = Math.PI;
        CAR_FX.focus = { x: s.lx, z: s.lz, who: 'celeb' };
      } else { if (g.visible) g.visible = false; return; }
    }
    s.t += dt;
    ctl.current.invalidate(); // keep frames coming while active, even when the replay is paused (demand frameloop)
    const t = s.t, T = s.tl, P = route.path;
    g.visible = true;

    // ---------- leader ----------
    const L = leaderAt(t);
    const lp = pathAt(P, L.s);
    const px = s.lx, pz = s.lz;
    s.lx = lp.x; s.lz = lp.z;
    const walking = L.stop < 0;
    const wantYaw = walking ? Math.atan2(lp.dx, lp.dz) : 0; // at a stop he faces the street side (the overview camera)
    s.lyaw += Math.atan2(Math.sin(wantYaw - s.lyaw), Math.cos(wantYaw - s.lyaw)) * (1 - Math.exp(-dt * 6));
    // hype jumps at 1.6 s and 6.5 s into each stop
    let jump = 0;
    if (!walking) for (const j0 of [1.6, 6.5]) { const k = (L.u - j0) / 0.7; if (k > 0 && k < 1) jump = Math.sin(k * Math.PI); }
    const bob = walking ? Math.abs(Math.sin(t * 7.5)) * 0.05 : 0;
    const cg = celeb.current!;
    cg.position.set(s.lx, (jump * 0.75 + bob) * 1, s.lz);
    cg.rotation.set(0, s.lyaw, walking ? Math.sin(t * 7.5) * 0.04 : 0);
    const sq = jump > 0 ? 1 + jump * 0.06 : 1;
    cg.scale.set(SCALE / Math.sqrt(sq), SCALE * sq, SCALE / Math.sqrt(sq));
    // arms: mic up when talking at a stop, waving / punching the air on jumps
    const talk = !walking ? ease(Math.min(1, L.u / 0.8)) * (L.u < STOP - 0.8 ? 1 : ease((STOP - L.u) / 0.8)) : 0.35;
    armR.current!.rotation.set(-2.2 * talk - (walking ? Math.sin(t * 7.5) * 0.3 : 0), 0, 0.35 * talk);
    armL.current!.rotation.set(walking ? Math.sin(t * 7.5) * 0.4 : -0.3, 0, jump > 0 ? 2.7 * jump : !walking ? 1.6 + Math.sin(t * 9) * 0.5 : 0.15);
    // ---------- confetti + sign at each stop ----------
    if (!walking) {
      for (const [bi, at] of [[L.stop * 2, 1.9], [L.stop * 2 + 1, 6.8]] as const) if (!s.burst[bi] && L.u > at) { s.burst[bi] = true; burst(s, s.lx, s.lz); }
      if (s.signI !== L.stop) { s.signI = L.stop; drawSign(canvas, L.stop); mats.sign.map!.needsUpdate = true; }
    }
    const sg = sign.current!;
    const signU = !walking ? clamp01((L.u - 1.9) / 0.4) * clamp01((STOP + 0.5 - L.u) / 0.6) : 0;
    sg.visible = signU > 0.01;
    if (sg.visible) {
      const k = ease(signU) * (1 + Math.sin(Math.min(1, (L.u - 1.9) / 0.5) * Math.PI) * 0.15);
      sg.position.set(s.lx, 3.6 + Math.sin(t * 2.2) * 0.08, s.lz);
      sg.scale.set(3.6 * k, 1.125 * k, 1);
    }
    stepConfetti(s, dt, conf.current!, tmp);

    // ---------- crew + fans ----------
    const gatherT = (stop: number, delay: number) => {
      const st = stop === 0 ? T.a0 : T.b0, en = stop === 0 ? T.a1 : T.b1;
      return clamp01((t - st - delay) / 1.2) * clamp01((en - t + 0.4) / 1.0);
    };
    const hd = mHead.current!, bd = mBody.current!, am = mArm.current!;
    const lead = Math.max(Math.hypot(s.lx - px, s.lz - pz) / Math.max(dt, 1e-3), 0);
    for (let i = 0; i < N_MEM; i++) {
      const m = s.mem[i], isCrew = i < N_CREW;
      // trail target along the path (crew ahead, walking backwards; fans behind)
      const tp = pathAt(P, L.s - m.lag);
      let tx = tp.x - tp.dz * m.lat, tz = tp.z + tp.dx * m.lat;
      const gA = Math.max(gatherT(0, m.delay), gatherT(1, m.delay));
      if (!route.clear(tx, tz)) { tx = tp.x; tz = tp.z; }
      if (gA > 0) {
        const k = gatherT(0, m.delay) >= gatherT(1, m.delay) ? 0 : 1, st = route.stops[k];
        tx += (st.x + m.gx[k] - tx) * ease(gA);
        tz += (st.z + m.gz[k] - tz) * ease(gA);
      }
      // walk towards the target (speed-capped spring)
      let dx = tx - m.x, dz = tz - m.z;
      const d = Math.hypot(dx, dz), vmax = Math.max(3.2, lead * 1.3);
      const want = Math.min(vmax, d * 2.4);
      if (d > 1e-4) { dx /= d; dz /= d; }
      const kv = 1 - Math.exp(-dt * 6);
      m.vx += (dx * want - m.vx) * kv; m.vz += (dz * want - m.vz) * kv;
      m.x += m.vx * dt; m.z += m.vz * dt;
      const sp = Math.hypot(m.vx, m.vz);
      // facing: crew always film the creator; fans face where they walk, or the creator when standing
      const faceL = Math.atan2(s.lx - m.x, s.lz - m.z);
      const wy = isCrew || sp < 0.35 ? faceL : Math.atan2(m.vx, m.vz);
      m.yaw += Math.atan2(Math.sin(wy - m.yaw), Math.cos(wy - m.yaw)) * (1 - Math.exp(-dt * 7));
      // hop: walking bob, fans jump with him (slightly late), arms up while gathered
      let y = sp > 0.3 ? Math.abs(Math.sin(t * 8 + m.ph)) * 0.05 : 0;
      if (!isCrew && !walking) for (const j0 of [1.6, 6.5]) { const k = (L.u - j0 - m.delay) / 0.55; if (k > 0 && k < 1) y = Math.sin(k * Math.PI) * 0.45; }
      tmp.m.compose(tmp.v.set(m.x, y, m.z), tmp.q.setFromEuler(tmp.e.set(0, m.yaw, 0)), tmp.sc.set(1, 1, 1));
      hd.setMatrixAt(i, tmp.m); bd.setMatrixAt(i, tmp.m);
      if (isCrew) { const cr = crew[i].current!; cr.position.set(m.x, y, m.z); cr.rotation.set(0, m.yaw, 0); }
      const cheer = isCrew ? 0 : gA * (0.75 + 0.25 * Math.sin(t * 6 + m.ph));
      for (const side of [0, 1]) {
        const sx = side ? -1 : 1;
        let rx = 0, rz = sx * (0.12 + cheer * 2.5);
        if (isCrew) { rx = i === 1 ? -2.3 : -1.25; rz = sx * 0.25; }
        else if (sp > 0.3 && gA < 0.5) rx = Math.sin(t * 8 + m.ph + side * Math.PI) * 0.45;
        tmp.m2.compose(tmp.v.set(sx * MINION_SHOULDER.x, MINION_SHOULDER.y + y, MINION_SHOULDER.z), tmp.q.setFromEuler(tmp.e.set(rx, 0, rz)), tmp.sc.set(1, 1, 1));
        tmp.m.compose(tmp.v.set(m.x, 0, m.z), tmp.q.setFromEuler(tmp.e.set(0, m.yaw, 0)), tmp.sc.set(1, 1, 1)).multiply(tmp.m2);
        am.setMatrixAt(i * 2 + side, tmp.m);
      }
    }
    hd.instanceMatrix.needsUpdate = bd.instanceMatrix.needsUpdate = am.instanceMatrix.needsUpdate = true;
    rec.current!.visible = Math.sin(s.clock * 6) > -0.2;

    // ---------- fade out once the tail of the crowd is back outside ----------
    const fade = 1 - clamp01((t - (T.end - FADE)) / FADE);
    if (fade !== s.fade) {
      const tr = fade < 0.999;
      for (const mm of [mats.head, mats.tint, mats.kit, mats.prop, mats.glow, mats.rec]) {
        mm.opacity = fade;
        if (mm.transparent !== tr) { mm.transparent = tr; mm.needsUpdate = true; }
      }
      s.fade = fade;
    }
    CAR_FX.focus = { x: s.lx, z: s.lz, who: 'celeb' };
    if (t >= T.end) {
      s.t = -1; s.next = s.clock + AGAIN[0] + s.r() * AGAIN[1]; g.visible = false;
      for (const mm of [mats.head, mats.tint, mats.kit, mats.prop, mats.glow, mats.rec]) { mm.opacity = 1; mm.transparent = false; mm.needsUpdate = true; }
      s.fade = 1;
    }
  });

  const sh = MINION_SHOULDER;
  return (
    <group ref={root} visible={false}>
      <group ref={celeb}>
        <mesh geometry={mg.head} material={mats.head} raycast={noRay} />
        <mesh geometry={geo.hoodie} material={mats.kit} raycast={noRay} />
        <group ref={armL} position={[sh.x, sh.y, sh.z]}><mesh geometry={geo.armL} material={mats.kit} raycast={noRay} /></group>
        <group ref={armR} position={[-sh.x, sh.y, sh.z]}><mesh geometry={geo.armR} material={mats.kit} raycast={noRay} /></group>
      </group>
      <instancedMesh ref={mHead} args={[mg.head, mats.head, N_MEM]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={mBody} args={[mg.overalls, mats.tint, N_MEM]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={mArm} args={[mg.arm, mats.tint, N_MEM * 2]} raycast={noRay} frustumCulled={false} />
      <group ref={crew[0]}>
        <mesh geometry={geo.cam} material={mats.prop} raycast={noRay} />
        <mesh ref={rec} geometry={geo.rec} material={mats.rec} position={[-0.2, 1.17, 0.27]} raycast={noRay} />
      </group>
      <group ref={crew[1]}><mesh geometry={geo.boom} material={mats.prop} raycast={noRay} /></group>
      <group ref={crew[2]}><mesh geometry={geo.ring} material={mats.glow} raycast={noRay} /></group>
      <instancedMesh ref={conf} args={[geo.conf, mats.conf, N_CONF]} raycast={noRay} frustumCulled={false} />
      <sprite ref={sign} material={mats.sign} visible={false} raycast={noRay} renderOrder={6} />
    </group>
  );
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
type St = { r: () => number; conf: { p: Float32Array; v: Float32Array; rot: Float32Array; life: Float32Array } };
/** throw ~80 confetti pieces up from the creator's hands */
function burst(s: St, x: number, z: number) {
  const C = s.conf;
  let n = 0;
  for (let i = 0; i < N_CONF && n < 80; i++) {
    if (C.life[i] > 0) continue;
    n++;
    const a = s.r() * Math.PI * 2, out = 1.2 + s.r() * 2.2;
    C.p.set([x + Math.sin(a) * 0.2, 2.3, z + Math.cos(a) * 0.2], i * 3);
    C.v.set([Math.sin(a) * out, 3.2 + s.r() * 3.2, Math.cos(a) * out], i * 3);
    C.rot.set([s.r() * 6, s.r() * 6, s.r() * 6], i * 3);
    C.life[i] = 3.2 + s.r() * 1.6;
  }
}
function stepConfetti(s: St, dt: number, im: THREE.InstancedMesh, tmp: { m: THREE.Matrix4; q: THREE.Quaternion; e: THREE.Euler; v: THREE.Vector3; sc: THREE.Vector3 }) {
  const C = s.conf;
  let any = false;
  for (let i = 0; i < N_CONF; i++) {
    if (C.life[i] <= 0) continue;
    any = true;
    C.life[i] -= dt;
    const k = i * 3;
    if (C.life[i] <= 0 || C.p[k + 1] < 0.02) { C.life[i] = 0; im.setMatrixAt(i, ZERO); continue; }
    // drag + gravity, then flutter down slowly
    const drag = Math.exp(-dt * 1.8);
    C.v[k] *= drag; C.v[k + 2] *= drag; C.v[k + 1] = Math.max(-0.9, C.v[k + 1] * drag - 6 * dt);
    C.p[k] += (C.v[k] + Math.sin(C.rot[k] * 3 + C.life[i] * 4) * 0.3) * dt; C.p[k + 1] += C.v[k + 1] * dt; C.p[k + 2] += C.v[k + 2] * dt;
    C.rot[k] += dt * 5; C.rot[k + 1] += dt * 3.3; C.rot[k + 2] += dt * 4.1;
    const sc = Math.min(1, C.life[i] * 2);
    tmp.m.compose(tmp.v.set(C.p[k], C.p[k + 1], C.p[k + 2]), tmp.q.setFromEuler(tmp.e.set(C.rot[k], C.rot[k + 1], C.rot[k + 2])), tmp.sc.set(sc, sc, sc));
    im.setMatrixAt(i, tmp.m);
  }
  if (any) im.instanceMatrix.needsUpdate = true;
}

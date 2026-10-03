// Transit beside the store: an Underground-STYLE station (original design, no real network branding: brick
// booking hall, blue "UNDERGROUND" fascia, entrance canopy, glowing ticket barriers, stairs down) and a small bus
// interchange (three shelters on a lay-by + a timetable board) served by two double-deckers on a loop along the road.
//
// The little people walking from the station / off the buses to the store doors are DECORATIVE ONLY: they are not
// simulated shoppers, carry no data, and simply shrink away into the doors. Pooled in one InstancedMesh.
// Perf: static parts = 2 merged meshes (lit + unlit glow); buses = 1 InstancedMesh; walkers = 1 InstancedMesh;
// all motion in ONE useFrame, no React state.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldPlan } from './World';
import { Geo, cylGeo, mat, rng } from './geo';
import { snowable } from './wxState';

const noRay = () => null;

/** where the station + interchange sit (World.tsx keeps trees/blocks out of these rects) */
export function transitSpots(W: WorldPlan) {
  const sx = W.xL - 20, sz = W.zF + 1; // station centre (front door faces +x, towards the store)
  const bx = W.cx + W.B.w * 0.25; // interchange starts at the old bus stop
  return { sx, sz, bx, keepOut: [W.xL - 34, W.zF - 9, W.xL, W.zC] as [number, number, number, number] };
}

function signTex(lines: [string, number][], w = 1024, h = 256, bg = '#22409a') {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = bg; x.beginPath(); x.roundRect(6, 6, w - 12, h - 12, 26); x.fill();
  x.strokeStyle = '#ffffff'; x.lineWidth = 10; x.beginPath(); x.roundRect(22, 22, w - 44, h - 44, 18); x.stroke();
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const tot = lines.reduce((s, [, sz]) => s + sz * 1.08, 0);
  let y = h / 2 - tot / 2;
  for (const [t, sz] of lines) {
    x.font = `800 ${sz}px "Baloo 2", Inter, system-ui`;
    const k = Math.min(1, (w - 110) / x.measureText(t).width); // always fit inside the white border
    x.save(); x.translate(w / 2, y + sz * 0.56); x.scale(k, 1); x.fillText(t, 0, 0); x.restore();
    y += sz * 1.08;
  }
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
  return tx;
}

function timetableTex() {
  const w = 512, h = 640, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = '#141014'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#FE831B'; x.fillRect(0, 0, w, 96);
  x.fillStyle = '#fff'; x.font = '800 54px "Baloo 2", system-ui'; x.textBaseline = 'middle'; x.fillText('buses', 28, 50);
  const rows = [['12', 'Town centre', '2 min'], ['7A', 'Station loop', '5 min'], ['N4', 'Riverside', '9 min'], ['21', 'Hospital', '12 min'], ['3', 'Old Market', '15 min'], ['12', 'Town centre', '18 min']];
  rows.forEach(([n, d, t], i) => {
    const y = 140 + i * 82;
    x.fillStyle = '#ffd23f'; x.font = '800 40px Inter, system-ui'; x.fillText(n, 28, y);
    x.fillStyle = '#f4efe9'; x.font = '600 34px Inter, system-ui'; x.fillText(d, 110, y);
    x.fillStyle = '#7dffb0'; x.textAlign = 'right'; x.fillText(t, w - 24, y); x.textAlign = 'left';
  });
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
  return tx;
}

function buildTransit(W: WorldPlan) {
  const { zF, zA, zC, xL } = W;
  const { sx, sz, bx } = transitSpots(W);
  const g = new Geo(), glow = new Geo();
  // ---- station forecourt paving + path to the shopfront apron
  g.quad(xL - 33, zF - 8, xL, zA + 9, 0.022, '#e7ddd3');
  for (let x = xL - 32; x < xL; x += 2) g.quad(x, zF - 8, x + 0.05, zA + 9, 0.026, '#d4c8bd');
  // ---- booking hall: brick body, dark plinth, cream bands, parapet
  const bw = 12, bd = 10, bh = 6.2;
  g.box(sx, 0.3, sz, bw + 0.3, 0.6, bd + 0.3, '#5a3a35');
  g.box(sx, bh / 2, sz, bw, bh, bd, '#b0523f');
  for (const y of [bh - 0.25, 3.7]) g.box(sx, y, sz, bw + 0.2, 0.32, bd + 0.2, '#f3e6d2');
  g.box(sx, bh + 0.35, sz, bw + 0.3, 0.7, bd + 0.3, '#9a4535');
  g.box(sx, bh + 0.72, sz, bw + 0.4, 0.1, bd + 0.4, '#f3e6d2');
  // tall arched-ish windows (dark glass + cream frame) on the +z (camera) face and the -x face
  for (let i = -1; i <= 1; i++) {
    g.box(sx + i * 3.6, 2.0, sz + bd / 2 + 0.02, 1.6, 2.6, 0.06, '#f3e6d2');
    g.box(sx + i * 3.6, 2.0, sz + bd / 2 + 0.06, 1.3, 2.3, 0.04, '#33405c');
    g.box(sx + i * 3.6, 4.85, sz + bd / 2 + 0.03, 1.6, 1.3, 0.06, '#f3e6d2');
    glow.box(sx + i * 3.6, 4.85, sz + bd / 2 + 0.07, 1.3, 1.0, 0.04, '#ffe9b0');
  }
  // ---- front entrance on the +x face: dark opening, lit ticket hall, glowing barriers
  const fx = sx + bw / 2;
  g.box(fx + 0.02, 1.6, sz, 0.06, 3.2, 5.2, '#f3e6d2');
  g.box(fx + 0.05, 1.5, sz, 0.06, 3.0, 4.6, '#241e26');
  glow.box(fx + 0.06, 2.6, sz, 0.04, 0.5, 4.4, '#fff1c8');
  for (let i = 0; i < 5; i++) {
    const z = sz - 1.9 + i * 0.95;
    g.box(fx + 0.4, 0.55, z, 0.9, 1.1, 0.22, '#c9ccd4');
    glow.box(fx + 0.86, 0.95, z, 0.04, 0.16, 0.18, i % 2 ? '#7dffb0' : '#ffd23f');
    glow.box(fx + 0.4, 1.12, z, 0.7, 0.04, 0.16, '#9be7ff');
  }
  // entrance canopy: slim blue roof on two posts
  g.box(fx + 1.6, 3.35, sz, 3.4, 0.16, 6.2, '#2a3f8f');
  g.box(fx + 1.6, 3.46, sz, 3.5, 0.06, 6.3, '#f3e6d2');
  for (const s of [-1, 1]) g.cyl(fx + 3.1, 1.67, sz + s * 2.8, 0.07, 3.34, '#2a2328', 8);
  // ---- stairs down in front of the hall (+z): railed well, steps darkening towards the bottom
  const stx = sx + 1, stz0 = sz + bd / 2 + 2.2, stL = 6, stW = 3.4;
  g.quad(stx - stW / 2 - 0.3, stz0 - 0.3, stx + stW / 2 + 0.3, stz0 + stL + 0.3, 0.03, '#cfc5bd');
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const c = new THREE.Color('#bdb3aa').lerp(new THREE.Color('#2a2328'), Math.pow(t, 0.8));
    g.quad(stx - stW / 2, stz0 + t * (stL - 0.5), stx + stW / 2, stz0 + t * (stL - 0.5) + stL / steps, 0.035, '#' + c.getHexString());
  }
  for (const s of [-1, 1]) {
    g.box(stx + s * (stW / 2 + 0.12), 0.45, stz0 + stL / 2, 0.24, 0.9, stL, '#f3e6d2');
    g.box(stx + s * (stW / 2 + 0.12), 1.0, stz0 + stL / 2, 0.06, 0.06, stL, '#2a2328');
    for (let k = 0; k <= 3; k++) g.box(stx + s * (stW / 2 + 0.12), 0.95, stz0 + k * stL / 3, 0.05, 0.12, 0.05, '#2a2328');
  }
  g.box(stx, 0.45, stz0 + stL + 0.12, stW + 0.48, 0.9, 0.24, '#f3e6d2');
  // stair sign post (sign face is a textured plane in the component)
  g.cyl(stx - stW / 2 - 0.8, 1.6, stz0 + 0.3, 0.07, 3.2, '#2a2328', 8);
  // a couple of benches + a flower bed on the forecourt
  for (const z of [zF - 5, zA + 5]) { g.box(xL - 4, 0.45, z, 2.2, 0.1, 0.6, '#c58b5c'); for (const s of [-1, 1]) g.box(xL - 4 + s * 0.9, 0.22, z, 0.1, 0.44, 0.5, '#2a2328'); }
  g.box(sx, 0.3, zF - 7, 8, 0.6, 1.2, '#cfc5bd'); g.box(sx, 0.7, zF - 7, 7.6, 0.4, 0.9, '#e8799a');

  // ---- bus interchange: lay-by along the store-side pavement, three shelters, timetable board
  const zLay0 = zC + 4.5, zLay1 = zC + 6.02, lx0 = bx - 8, lx1 = bx + 26;
  g.quad(lx0, zLay0, lx1, zLay1, 0.034, '#3d3a42');
  g.box((lx0 + lx1) / 2, 0.07, zLay0, lx1 - lx0, 0.14, 0.16, '#bdb3ab');
  // "BUS STOP" box markings (yellow) in the bay
  for (const [a, b] of [[bx - 6, bx + 8], [bx + 10, bx + 24]]) {
    g.quad(a, zLay0 + 0.2, b, zLay0 + 0.32, 0.04, '#ffd23f');
    g.quad(a, zLay1 - 0.32, b, zLay1 - 0.2, 0.04, '#ffd23f');
    g.quad(a, zLay0 + 0.2, a + 0.12, zLay1 - 0.2, 0.04, '#ffd23f');
    g.quad(b - 0.12, zLay0 + 0.2, b, zLay1 - 0.2, 0.04, '#ffd23f');
  }
  const shelterZ = zC + 3.55;
  [bx - 1, bx + 8, bx + 17].forEach((x, i) => {
    g.box(x, 2.5, shelterZ, 4.4, 0.12, 1.7, '#2a2328');
    g.box(x, 2.6, shelterZ, 4.5, 0.06, 1.8, i === 1 ? '#FE831B' : '#FF4079');
    for (const s of [-2.1, 2.1]) g.box(x + s, 1.25, shelterZ - 0.75, 0.08, 2.5, 0.08, '#2a2328');
    g.box(x, 1.35, shelterZ - 0.77, 4.2, 1.9, 0.04, '#cfe8f2');
    g.box(x + 2.14, 1.35, shelterZ - 0.25, 0.06, 1.9, 1.0, '#cfe8f2');
    g.box(x - 2.14, 1.35, shelterZ - 0.25, 0.06, 1.9, 1.0, '#FF4079');
    g.box(x, 0.5, shelterZ - 0.5, 2.8, 0.08, 0.4, '#FE831B');
    glow.box(x, 2.38, shelterZ - 0.1, 3.6, 0.05, 0.2, '#fff4c8');
    // stop flag
    g.cyl(x + 2.6, 1.6, shelterZ + 0.8, 0.05, 3.2, '#2a2328', 6);
    g.add(cylGeo(16), '#e53935', mat(x + 2.6, 3.05, shelterZ + 0.8, 0, 0.36, 0.05, 0.36, Math.PI / 2));
    g.add(cylGeo(16), '#ffffff', mat(x + 2.6, 3.05, shelterZ + 0.8, 0, 0.26, 0.06, 0.26, Math.PI / 2));
  });
  // timetable totem
  const tx = bx + 22.5;
  g.box(tx, 1.3, shelterZ, 0.2, 2.6, 0.2, '#2a2328');
  g.box(tx, 2.2, shelterZ, 1.34, 1.66, 0.12, '#2a2328');
  return { geo: g.build(), glow: glow.build(), stairSign: [stx - stW / 2 - 0.8, 2.9, stz0 + 0.3] as const, timetable: [tx, 2.2, shelterZ + 0.07] as const, fx };
}

function busGeo() {
  // double-decker, 10 m long along +x (front at +x), 2.5 wide, 4.3 tall
  const g = new Geo();
  g.box(0, 2.25, 0, 10, 3.9, 2.5, '#d9302f');
  g.box(0, 4.25, 0, 9.8, 0.12, 2.4, '#b8292a');
  g.box(0.2, 1.65, 0, 9.4, 0.9, 2.54, '#2b3443');
  g.box(0.2, 3.35, 0, 9.4, 0.9, 2.54, '#2b3443');
  g.box(4.98, 1.9, 0, 0.06, 1.8, 2.3, '#2b3443');
  g.box(0, 2.55, 0, 10.02, 0.16, 2.52, '#f4efe9');
  g.box(5.0, 4.0, 0, 0.06, 0.32, 1.4, '#141014');
  g.box(5.03, 4.0, 0, 0.02, 0.22, 1.2, '#ffd23f');
  for (const x of [-3.2, 3.4]) for (const s of [-1, 1]) g.add(cylGeo(10), '#1c1a1f', mat(x, 0.5, s * 1.18, 0, 0.5, 0.3, 0.5, Math.PI / 2));
  return g.build();
}

function walkerGeo() {
  const g = new Geo();
  g.add(new THREE.CapsuleGeometry(0.22, 0.75, 3, 8), '#ffffff', mat(0, 0.6, 0));
  g.add(new THREE.SphereGeometry(0.17, 8, 6), '#ffe0cc', mat(0, 1.33, 0));
  return g.build();
}

type Path = { pts: THREE.Vector2[]; cum: number[]; len: number };
function mkPath(pts: [number, number][]): Path {
  const v = pts.map(([x, z]) => new THREE.Vector2(x, z));
  const cum = [0];
  for (let i = 1; i < v.length; i++) cum.push(cum[i - 1] + v[i].distanceTo(v[i - 1]));
  return { pts: v, cum, len: cum[cum.length - 1] };
}
function at(p: Path, s: number, out: THREE.Vector2) {
  let i = 1; while (i < p.cum.length - 1 && p.cum[i] < s) i++;
  const a = p.pts[i - 1], b = p.pts[i], u = Math.min(1, Math.max(0, (s - p.cum[i - 1]) / Math.max(1e-6, p.cum[i] - p.cum[i - 1])));
  out.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
  return Math.atan2(b.x - a.x, b.y - a.y);
}

const NW = 56;
const WALKER_COLS = ['#ff8fb1', '#8fd3ff', '#ffd27a', '#b9a4ff', '#9be2b0', '#ffb08a', '#f4efe9', '#7aa2ff', '#ff6f91'];

export function Transit({ W }: { W: WorldPlan }) {
  const built = useMemo(() => buildTransit(W), [W]);
  const lambert = useMemo(() => snowable(new THREE.MeshLambertMaterial({ vertexColors: true })), []);
  const basic = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true }), []);
  const geos = useMemo(() => ({ bus: busGeo(), walker: walkerGeo() }), []);
  const ugTex = useMemo(() => signTex([['UNDERGROUND', 150], ['Simsbury Park', 62]]), []);
  const ttTex = useMemo(timetableTex, []);
  const { sx, sz, bx } = transitSpots(W);
  const bd = 10;

  // decorative walker paths (all end inside a store door)
  const paths = useMemo(() => {
    const doors = W.P.entrances.map((e) => e.x);
    const door = doors.length ? doors : [W.cx];
    const yA = W.zF + 2.6;
    const tube: Path[] = [], bus: Path[][] = [[], []];
    for (const d of door) {
      tube.push(mkPath([[built.fx + 0.6, sz - 0.6], [built.fx + 3.5, sz], [W.xL + 1, yA], [d, yA], [d, W.zF + 0.1]]));
      tube.push(mkPath([[sx + 1, sz + bd / 2 + 4.2], [sx + 1, sz + bd / 2 + 1.4], [built.fx + 3.5, sz + 2.5], [W.xL + 1, yA + 0.8], [d - 0.6, yA + 0.8], [d - 0.6, W.zF + 0.1]]));
    }
    // off the buses: along the pavement to the right-hand access road, up the car park edge, along the apron
    const stops = [bx + 1, bx + 17];
    stops.forEach((xs, k) => {
      for (const d of door) bus[k].push(mkPath([[xs + 3, W.zC + 4.3], [xs + 2, W.zC + 4.0], [W.xR + 1.2, W.zC + 4.0], [W.xR + 1.2, W.zA + 1.0], [d + 0.6, W.zA + 1.0], [d + 0.6, W.zF + 0.1]]));
    });
    return { tube, bus, stops };
  }, [W, built, sx, sz, bx]);

  // bus timeline (two buses, same loop, offset by half a period)
  const bus = useMemo(() => {
    const X0 = W.cx - 280, X1 = W.cx + 280, v = 11, Dd = 27.5, T2 = (2 * Dd) / v, dwell = 9;
    const segs = paths.stops.map((xs) => {
      const sStop = xs + 5 - X0; // bus centre so the front door lines up with the stop
      const T1 = (sStop - Dd) / v, T5 = (X1 - X0 - sStop - Dd) / v;
      return { sStop, T1, T5, period: T1 + T2 + dwell + T2 + T5 + 4 };
    });
    return { X0, X1, v, Dd, T2, dwell, segs, zLane: W.zNear, zBay: W.zC + 5.75 };
  }, [W, paths]);

  const busRef = useRef<THREE.InstancedMesh>(null), wRef = useRef<THREE.InstancedMesh>(null);
  const st = useRef({
    t: 0, nextTube: 1, prevDwell: [false, false],
    w: Array.from({ length: NW }, () => ({ on: false, path: null as Path | null, s: 0, delay: 0, v: 1.3, ph: 0 })),
    r: rng(31),
  });
  // start the clock so the first bus pulls into the bay ~15 s after load (nice for demos / screenshots)
  useEffect(() => { const sg = bus.segs[0]; st.current.t = Math.max(0, sg.T1 + bus.T2 - 15); }, [bus]);
  useEffect(() => {
    const im = wRef.current; if (!im) return;
    const c = new THREE.Color(), z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < NW; i++) { im.setColorAt(i, c.set(WALKER_COLS[i % WALKER_COLS.length])); im.setMatrixAt(i, z); }
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, []);

  const v2 = useMemo(() => new THREE.Vector2(), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1), S = st.current, r = S.r;
    S.t += dt;
    const spawn = (p: Path, delay: number) => {
      const w = S.w.find((x) => !x.on); if (!w) return;
      w.on = true; w.path = p; w.s = 0; w.delay = delay; w.v = 1.15 + r() * 0.5; w.ph = r() * 6;
    };
    // tube: a little group every 3-7 s
    if (S.t > S.nextTube) {
      const n = 1 + ((r() * 3) | 0);
      for (let k = 0; k < n; k++) spawn(paths.tube[(r() * paths.tube.length) | 0], k * (0.5 + r() * 0.6));
      S.nextTube = S.t + 3 + r() * 4;
    }
    // buses
    const bm = busRef.current;
    bus.segs.forEach((sg, k) => {
      const tt = (S.t + k * sg.period * 0.5) % sg.period;
      let s: number, dwell = false;
      const { v, T2, Dd } = bus;
      if (tt < sg.T1) s = v * tt;
      else if (tt < sg.T1 + T2) { const u = tt - sg.T1; s = sg.sStop - Dd + v * u - (v / (2 * T2)) * u * u; }
      else if (tt < sg.T1 + T2 + bus.dwell) { s = sg.sStop; dwell = true; }
      else if (tt < sg.T1 + 2 * T2 + bus.dwell) { const u = tt - sg.T1 - T2 - bus.dwell; s = sg.sStop + (v / (2 * T2)) * u * u; }
      else s = sg.sStop + Dd + v * (tt - sg.T1 - 2 * T2 - bus.dwell);
      const ds = s - sg.sStop;
      const pull = 1 - THREE.MathUtils.smoothstep(Math.abs(ds), 4, 24);
      const z = bus.zLane + (bus.zBay - bus.zLane) * pull;
      const yaw = -Math.sign(ds) * pull * (1 - pull) * 0.35 * (Math.abs(ds) > 4 ? 1 : 0);
      if (bm) bm.setMatrixAt(k, mat(bus.X0 + s, 0, z, yaw));
      if (dwell && !S.prevDwell[k]) {
        const n = 2 + ((r() * 3) | 0);
        for (let j = 0; j < n; j++) spawn(paths.bus[k][(r() * paths.bus[k].length) | 0], 0.6 + j * 0.9);
      }
      S.prevDwell[k] = dwell;
    });
    if (bm) bm.instanceMatrix.needsUpdate = true;
    // walkers
    const im = wRef.current; if (!im) return;
    S.w.forEach((w, i) => {
      if (!w.on || !w.path) return;
      if (w.delay > 0) { w.delay -= dt; im.setMatrixAt(i, mat(0, -50, 0, 0, 0, 0, 0)); return; }
      w.s += w.v * dt;
      const L = w.path.len;
      if (w.s >= L) { w.on = false; im.setMatrixAt(i, mat(0, -50, 0, 0, 0, 0, 0)); return; }
      const yaw = at(w.path, w.s, v2);
      const sc = Math.min(1, w.s / 0.8, (L - w.s) / 1.4);
      const bob = Math.abs(Math.sin(w.s * 4.2 + w.ph)) * 0.07;
      im.setMatrixAt(i, mat(v2.x, bob, v2.y, yaw + Math.sin(w.s * 4.2 + w.ph) * 0.08, sc, sc, sc));
    });
    im.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <mesh geometry={built.geo} material={lambert} raycast={noRay} />
      <mesh geometry={built.glow} material={basic} raycast={noRay} />
      <instancedMesh ref={busRef} args={[geos.bus, lambert, 2]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={wRef} args={[geos.walker, lambert, NW]} raycast={noRay} frustumCulled={false} />
      {/* fascia signs: over the canopy (+x face) and the long +z face */}
      <mesh position={[built.fx + 0.08, 5.0, sz]} rotation={[0, Math.PI / 2, 0]} raycast={noRay}>
        <planeGeometry args={[6.4, 1.6]} /><meshBasicMaterial map={ugTex} />
      </mesh>
      <mesh position={[sx, 5.95, sz + bd / 2 + 0.25]} raycast={noRay}>
        <planeGeometry args={[7.2, 1.8]} /><meshBasicMaterial map={ugTex} />
      </mesh>
      {[0, Math.PI].map((ry) => (
        <mesh key={ry} position={[built.stairSign[0], built.stairSign[1], built.stairSign[2] + (ry ? -0.03 : 0.03)]} rotation={[0, ry, 0]} raycast={noRay}>
          <planeGeometry args={[2.0, 0.5]} /><meshBasicMaterial map={ugTex} />
        </mesh>
      ))}
      <mesh position={built.timetable as unknown as [number, number, number]} raycast={noRay}>
        <planeGeometry args={[1.2, 1.5]} /><meshBasicMaterial map={ttTex} />
      </mesh>
    </group>
  );
}

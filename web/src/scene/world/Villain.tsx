// Easter egg: an (original) supervillain loiters by a black "staff only" van at the end of the shopfront. Every
// ~60-120 s (seeded; ?villain=now or window.__villain() for the demo) he raises a chunky retro ray gun, a wobbly green
// beam zaps a parked car which shrinks to toy size, sits tiny for ~10 s, then pops back. His three yellow henchfolk
// hop and cheer. Perf: van + villain body are merged vertex-coloured meshes, gun arm one mesh, henchfolk 2 instanced
// meshes, beam 2 meshes; one useFrame; no lights.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Geo, cylGeo, mat, rng } from './geo';
import { snowable } from './wxState';
import { CAR_FX, overrideCar, pickCar, urlFlag, ease } from './eggs';
import { minionGeo, MINION_MAT } from '../minion';
import type { WorldPlan } from './World';

const noRay = () => null;
const COAT = '#34353a', COAT_DK = '#25262a', SKIN = '#e6d3c0';
// timeline (s since trigger)
const T = { aim: 1.0, fire: 1.2, shrunk: 2.3, beamOff: 2.6, lower: 3.6, pop: 12.6, done: 13.3 };

function vanGeometry() {
  const g = new Geo();
  // long axis along x; cab at +x
  g.box(0, 1.25, 0, 5.2, 1.9, 2.1, '#141317');
  g.box(2.15, 1.7, 0, 0.9, 0.9, 1.96, '#2a2f3a');   // windscreen block
  g.box(0, 2.22, 0, 5.0, 0.06, 2.0, '#202024');     // roof line
  g.box(-0.8, 1.35, 1.06, 2.2, 1.3, 0.02, '#1b1a1f'); // sliding door
  g.box(2.63, 0.75, 0, 0.1, 0.35, 2.0, '#2a2a2e');  // bumper
  for (const z of [-0.7, 0.7]) g.box(2.64, 1.0, z, 0.04, 0.16, 0.36, '#fff3c0');
  for (const sx of [-1.6, 1.6]) for (const sz of [-1, 1]) g.add(cylGeo(10), '#0b0a0d', mat(sx, 0.38, sz * 0.98, 0, 0.38, 0.28, 0.38, Math.PI / 2, 0));
  g.add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 5), '#3a3a40', mat(-1.8, 2.65, 0)); // antenna
  g.add(new THREE.SphereGeometry(0.07, 6, 4), '#ff2b3b', mat(-1.8, 3.1, 0));
  return g.build();
}

function villainGeometry() {
  // ~2.5 m tall, thin; origin at the feet, facing +z
  const g = new Geo();
  for (const s of [-1, 1]) {
    g.box(s * 0.11, 0.45, 0, 0.12, 0.9, 0.14, '#1d1d21');                 // legs
    g.box(s * 0.11, 0.05, 0.1, 0.13, 0.1, 0.42, '#0d0c0f');               // long pointed shoes
  }
  g.add(new THREE.CylinderGeometry(0.21, 0.36, 1.25, 10, 1, true), COAT, mat(0, 0.98, 0));   // coat skirt
  g.add(new THREE.CylinderGeometry(0.2, 0.21, 0.55, 10), COAT, mat(0, 1.88, 0));            // torso
  g.add(new THREE.CylinderGeometry(0.27, 0.2, 0.32, 10, 1, true), COAT_DK, mat(0, 2.28, -0.02)); // high collar
  g.box(0, 1.55, 0.2, 0.03, 0.85, 0.02, '#141317');                                          // button line
  for (const y of [1.3, 1.55, 1.8]) g.add(new THREE.SphereGeometry(0.03, 6, 4), '#b8a46a', mat(0, y, 0.215));
  g.box(0, 1.45, 0, 0.44, 0.06, 0.44, '#1a191d');                                            // belt
  g.box(-0.24, 2.0, 0, 0.11, 0.62, 0.13, COAT, 0);                                         // left arm (static)
  g.add(new THREE.SphereGeometry(0.06, 6, 4), SKIN, mat(-0.24, 1.66, 0));
  g.add(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 8), SKIN, mat(0, 2.2, 0));              // neck
  g.add(new THREE.SphereGeometry(0.2, 14, 10), SKIN, mat(0, 2.48, 0, 0, 0.95, 1.25, 1.0));   // bald, egg-shaped head
  g.add(new THREE.ConeGeometry(0.045, 0.2, 6), '#d9bfa8', mat(0, 2.44, 0.24, 0, 1, 1, 1, Math.PI / 2)); // long nose
  for (const s of [-1, 1]) {
    g.add(new THREE.SphereGeometry(0.035, 6, 4), '#141014', mat(s * 0.075, 2.54, 0.17));    // beady eyes
    g.box(s * 0.08, 2.61, 0.17, 0.1, 0.022, 0.02, '#2a2328', s * 0.25);                    // scowl brows
  }
  g.box(0, 2.36, 0.18, 0.1, 0.015, 0.02, '#7a3b3b');                                         // thin smirk
  return g.build();
}

/** right arm + chunky retro ray gun; pivot at the shoulder, hangs along -y (rotation.x = -PI/2 points it forward) */
function gunArmGeometry() {
  const g = new Geo();
  g.box(0, -0.32, 0, 0.11, 0.64, 0.13, COAT);
  g.add(new THREE.SphereGeometry(0.065, 6, 4), SKIN, mat(0, -0.68, 0));
  g.box(0, -0.78, 0.0, 0.16, 0.26, 0.2, '#c4462f');                                  // gun body
  g.add(cylGeo(10), '#d9dde3', mat(0, -0.98, 0, 0, 0.08, 0.26, 0.08));              // barrel
  for (const y of [-0.9, -0.98, -1.06]) g.add(new THREE.TorusGeometry(0.1, 0.022, 5, 12), '#f2b632', mat(0, y, 0, 0, 1, 1, 1, Math.PI / 2));
  g.add(new THREE.SphereGeometry(0.075, 8, 6), '#7dff6a', mat(0, -1.14, 0));         // emitter bulb
  for (const s of [-1, 1]) g.box(s * 0.12, -0.74, 0, 0.08, 0.18, 0.03, '#f2b632');   // fins
  g.box(0, -0.68, -0.13, 0.05, 0.16, 0.08, '#2a2328');                               // grip
  return g.build();
}

function signTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f4f0e6'; x.fillRect(0, 0, 512, 128);
  x.strokeStyle = '#141317'; x.lineWidth = 6; x.strokeRect(6, 6, 500, 116);
  x.fillStyle = '#141317'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '700 22px Inter, system-ui, sans-serif'; x.fillText('STAFF ONLY', 256, 34);
  x.font = 'italic 700 40px Inter, system-ui, sans-serif'; x.fillText('definitely not a lair', 256, 82);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function Villain({ W }: { W: WorldPlan }) {
  const B = W.B;
  // van parked on the front apron past the right end of the shopfront, the villain + henchfolk on the car park side
  const spot = useMemo(() => {
    const vx = B.xMax + 4.2, vz = W.zF + 2.0;
    return { vx, vz, gx: vx - 0.4, gz: W.zA - 0.9, hench: [[vx + 1.6, W.zA - 1.1], [vx + 2.5, W.zA - 1.8], [vx - 1.9, W.zA - 1.5]] as [number, number][] };
  }, [B, W]);
  const geo = useMemo(() => ({
    van: vanGeometry(), body: villainGeometry(), arm: gunArmGeometry(),
    beam: new THREE.CylinderGeometry(1, 1, 1, 8, 6, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
    flash: new THREE.IcosahedronGeometry(1, 1),
  }), []);
  const mats = useMemo(() => ({
    lambert: snowable(new THREE.MeshLambertMaterial({ vertexColors: true })),
    sign: new THREE.MeshBasicMaterial({ map: signTexture() }),
    beam: new THREE.MeshBasicMaterial({ color: '#6bff4f', transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }),
    flash: new THREE.MeshBasicMaterial({ color: '#c8ff9a', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
  }), []);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); mats.sign.map?.dispose(); Object.values(mats).forEach((m) => m.dispose()); }, [geo, mats]);
  // wobble: keep the base positions and displace the (8x7) beam vertices on the CPU
  const beamBase = useMemo(() => Float32Array.from(geo.beam.attributes.position.array as Float32Array), [geo]);
  const mg = minionGeo();

  const man = useRef<THREE.Group>(null), arm = useRef<THREE.Group>(null), beam = useRef<THREE.Mesh>(null), flash = useRef<THREE.Mesh>(null);
  const hHead = useRef<THREE.InstancedMesh>(null), hBody = useRef<THREE.InstancedMesh>(null);
  const S = useRef({ r: rng(777), clock: 0, next: 0, t: -1, car: -1, fire: false, hop: -99 });
  const tip = useMemo(() => new THREE.Vector3(), []), dst = useMemo(() => new THREE.Vector3(), []);

  const placeHench = (hop: number, face: number) => {
    const a = hHead.current, b = hBody.current; if (!a || !b) return;
    spot.hench.forEach(([x, z], i) => {
      const k = hop - i * 0.15, y = k > 0 && k < 3.2 ? Math.abs(Math.sin(k * Math.PI * 2.2)) * 0.55 : 0;
      const m = mat(x, y, z, face + (i - 1) * 0.3, 1, y > 0.05 ? 1.04 : 1, 1);
      a.setMatrixAt(i, m); b.setMatrixAt(i, m);
    });
    a.instanceMatrix.needsUpdate = true; b.instanceMatrix.needsUpdate = true;
  };

  useEffect(() => {
    const s = S.current;
    s.next = urlFlag('villain') === 'now' ? 1.5 : 60 + s.r() * 60;
    const w = window as unknown as Record<string, unknown>;
    w.__villain = () => { s.fire = true; return 'mwahaha'; };
    const b = hBody.current;
    if (b) { ['#3c6fd6', '#3c6fd6', '#3c6fd6'].forEach((c, i) => b.setColorAt(i, new THREE.Color(c))); if (b.instanceColor) b.instanceColor.needsUpdate = true; }
    placeHench(-99, 0.6);
    return () => { delete w.__villain; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, dtRaw) => {
    const s = S.current, dt = Math.min(dtRaw, 0.1);
    s.clock += dt;
    const g = man.current, a = arm.current, bm = beam.current, fl = flash.current; if (!g || !a || !bm || !fl) return;
    // idle: slow menacing sway
    if (s.t < 0) {
      g.rotation.z = Math.sin(s.clock * 0.7) * 0.02;
      if (s.fire || s.clock > s.next) {
        s.fire = false;
        const c = pickCar(spot.gx, spot.gz + 10, s.r, 30);
        if (c < 0) { s.next = s.clock + 15; return; }
        s.car = c; CAR_FX.claimed.add(c); s.t = 0; CAR_FX.focus = { x: spot.gx, z: spot.gz, who: 'villain', tx: CAR_FX.parked[c].x, tz: CAR_FX.parked[c].z };
      } else return;
    }
    s.t += dt;
    const t = s.t, p = CAR_FX.parked[s.car];
    // turn to face the car, raise the gun
    const yaw = Math.atan2(p.x - spot.gx, p.z - spot.gz);
    g.rotation.y = THREE.MathUtils.lerp(0.5, yaw, ease(Math.min(1, t / T.aim)) * (t < T.lower ? 1 : 1 - ease(t - T.lower)));
    const raise = t < T.aim ? ease(t / T.aim) : t < T.beamOff + 0.4 ? 1 : 1 - ease((t - T.beamOff - 0.4) / 0.8);
    const dist = Math.hypot(p.x - spot.gx, p.z - spot.gz);
    const pitch = Math.atan2(1.9, dist);           // aim down at the car from shoulder height
    a.rotation.x = -raise * (Math.PI / 2 - pitch) + (t > T.fire && t < T.beamOff ? Math.sin(t * 60) * 0.03 : 0);
    // beam: gun tip -> car, wobbly
    const on = t > T.fire && t < T.beamOff;
    bm.visible = fl.visible = on;
    if (on) {
      a.updateWorldMatrix(true, false);
      a.localToWorld(tip.set(0, -1.16, 0));
      dst.set(p.x, 0.6, p.z);
      const len = tip.distanceTo(dst);
      bm.position.copy(tip); bm.lookAt(dst); bm.scale.set(1, 1, len);
      const pos = geo.beam.attributes.position as THREE.BufferAttribute, arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const z = beamBase[i + 2], w = 0.09 + 0.07 * Math.sin(z * 18 - s.clock * 40) + 0.03 * Math.sin(s.clock * 70 + z * 5);
        const off = Math.sin(z * 9 + s.clock * 25) * 0.25 * Math.sin(z * Math.PI);
        arr[i] = beamBase[i] * w + off; arr[i + 1] = beamBase[i + 1] * w + Math.cos(z * 7 + s.clock * 31) * 0.2 * Math.sin(z * Math.PI);
      }
      pos.needsUpdate = true;
      mats.beam.opacity = 0.6 + Math.sin(s.clock * 50) * 0.25;
      fl.position.copy(dst); fl.scale.setScalar(1.3 + Math.sin(s.clock * 45) * 0.4);
    }
    // the car: shrink (with wobble), sit tiny, pop back with an overshoot
    let sc = 1;
    if (t > T.fire + 0.3 && t < T.shrunk) { const u = (t - T.fire - 0.3) / (T.shrunk - T.fire - 0.3); sc = 1 - 0.78 * ease(u) + Math.sin(u * 30) * 0.06 * (1 - u); }
    else if (t >= T.shrunk && t < T.pop) sc = 0.22;
    else if (t >= T.pop && t < T.done) { const u = (t - T.pop) / (T.done - T.pop); sc = 0.22 + 0.78 * ease(u) + Math.sin(u * Math.PI) * 0.25; }
    if (t < T.done && t > T.fire + 0.3) overrideCar(s.car, mat(p.x, 0, p.z, p.yaw + (sc < 0.3 ? Math.sin(s.clock * 3) * 0.05 : 0), sc, sc, sc), sc);
    // henchfolk cheer
    if (t > T.fire + 0.6 && s.hop < 0) s.hop = 0;
    if (s.hop >= 0) { s.hop += dt; placeHench(s.hop, yaw); if (s.hop > 3.6) { s.hop = -99; placeHench(-99, yaw); } }
    if (t >= T.done) {
      overrideCar(s.car, null); CAR_FX.claimed.delete(s.car);
      s.t = -1; s.car = -1; s.next = s.clock + 60 + s.r() * 60;
      g.rotation.y = 0.5; a.rotation.x = 0;
    }
  });

  return (
    <group>
      <mesh geometry={geo.van} material={mats.lambert} position={[spot.vx, 0, spot.vz]} raycast={noRay} />
      <mesh position={[spot.vx - 0.8, 1.45, spot.vz + 1.075]} material={mats.sign} raycast={noRay}>
        <planeGeometry args={[2.0, 0.5]} />
      </mesh>
      <group ref={man} position={[spot.gx, 0, spot.gz]} rotation={[0, 0.5, 0]}>
        <mesh geometry={geo.body} material={mats.lambert} raycast={noRay} />
        <group ref={arm} position={[0.24, 2.3, 0]}>
          <mesh geometry={geo.arm} material={mats.lambert} raycast={noRay} />
        </group>
      </group>
      <mesh ref={beam} geometry={geo.beam} material={mats.beam} visible={false} raycast={noRay} frustumCulled={false} renderOrder={5} />
      <mesh ref={flash} geometry={geo.flash} material={mats.flash} visible={false} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={hHead} args={[mg.head, MINION_MAT.head, 3]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={hBody} args={[mg.overalls, MINION_MAT.tint, 3]} raycast={noRay} frustumCulled={false} />
    </group>
  );
}

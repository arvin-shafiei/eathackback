// Easter egg: every ~45-90 s (seeded) a low-poly flying saucer swoops in, hovers over a parked car, shines a
// translucent tractor beam with sparkles, lifts the car up (spinning, shrinking at the end), then zooms off. The car
// drifts back down ~20 s later. ?ufo=now triggers it at once; window.__ufo() triggers it from the console.
// Perf: hidden when idle; ~6 draw calls while active (saucer, dome, rim lights instanced, beam, sparkles, car); no
// lights (all emissive/basic), one useFrame.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Geo, mat, rng } from './geo';
import { carGeometry } from './CarPark';
import { CAR_FX, HIDDEN, overrideCar, pickCar, urlFlag, ease, clamp01 } from './eggs';
import type { WorldPlan } from './World';

const noRay = () => null;
const N_RIM = 14, N_SPARK = 70;
const HOVER = 13;
// timeline (s since trigger)
const T = { arrive: 4, beamOn: 4.8, liftEnd: 11, beamOff: 11.8, gone: 15, back: 33, landed: 36 };

function saucerGeometry() {
  const g = new Geo();
  // lathe profile: flat-bottomed disc with a raised rim
  const prof = [[0, -0.55], [1.4, -0.6], [3.0, -0.25], [3.4, 0], [3.0, 0.22], [1.6, 0.45], [0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(new THREE.LatheGeometry(prof, 20), '#c9ced6');
  g.add(new THREE.CylinderGeometry(3.42, 3.42, 0.12, 20, 1, true), '#6b6f7d');
  g.add(new THREE.CylinderGeometry(0.9, 1.1, 0.2, 14), '#3a3d48', mat(0, -0.62, 0));
  g.add(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 14), '#bff8ff', mat(0, -0.74, 0));
  return g.build();
}

export function Ufo({ W }: { W: WorldPlan }) {
  const geo = useMemo(() => ({
    saucer: saucerGeometry(),
    dome: new THREE.SphereGeometry(1.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    bulb: new THREE.SphereGeometry(0.17, 8, 6),
    beam: new THREE.CylinderGeometry(0.7, 3.4, 1, 20, 1, true).translate(0, -0.5, 0),
    car: carGeometry(),
  }), []);
  const mats = useMemo(() => ({
    saucer: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#2a3040' }),
    dome: new THREE.MeshBasicMaterial({ color: '#8ff7d8', transparent: true, opacity: 0.85 }),
    bulb: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    beam: new THREE.MeshBasicMaterial({ color: '#b6ffcf', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    spark: new THREE.PointsMaterial({ color: '#f4fff0', size: 0.35, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    car: new THREE.MeshLambertMaterial({ vertexColors: true }),
  }), []);
  const sparkGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_SPARK * 3), 3)); return g; }, []);
  useEffect(() => () => { Object.values(geo).forEach((g) => g.dispose()); Object.values(mats).forEach((m) => m.dispose()); sparkGeo.dispose(); }, [geo, mats, sparkGeo]);

  const root = useRef<THREE.Group>(null), ship = useRef<THREE.Group>(null), rim = useRef<THREE.InstancedMesh>(null);
  const beam = useRef<THREE.Mesh>(null), car = useRef<THREE.Mesh>(null), spark = useRef<THREE.Points>(null);
  const S = useRef({ r: rng(4242), next: 0, t: -1, car: -1, from: new THREE.Vector3(), to: new THREE.Vector3(), exit: new THREE.Vector3(), clock: 0, fire: false });

  useEffect(() => {
    const s = S.current;
    s.next = urlFlag('ufo') === 'now' ? 1.2 : 45 + s.r() * 45;
    const w = window as unknown as Record<string, unknown>;
    w.__ufo = () => { s.fire = true; return 'incoming'; };
    // rim bulbs (positions fixed; colours cycle in the frame loop)
    const im = rim.current;
    if (im) {
      for (let i = 0; i < N_RIM; i++) { const a = (i / N_RIM) * Math.PI * 2; im.setMatrixAt(i, mat(Math.cos(a) * 3.3, 0, Math.sin(a) * 3.3)); im.setColorAt(i, new THREE.Color('#fff')); }
      im.instanceMatrix.needsUpdate = true;
    }
    return () => { delete w.__ufo; };
  }, []);

  const col = useMemo(() => new THREE.Color(), []);
  useFrame((_, dtRaw) => {
    const s = S.current, dt = Math.min(dtRaw, 0.1);
    s.clock += dt;
    const g = root.current; if (!g) return;
    if (s.t < 0) {
      if (s.fire || s.clock > s.next) {
        s.fire = false;
        const target = pickCar(W.P.entrances[0]?.x ?? W.cx, W.rows[1].z, s.r, 45);
        if (target < 0) { s.next = s.clock + 20; return; }
        s.car = target; CAR_FX.claimed.add(target);
        const p = CAR_FX.parked[target];
        s.to.set(p.x, HOVER, p.z); CAR_FX.focus = { x: p.x, z: p.z, who: 'ufo' };
        const side = s.r() < 0.5 ? -1 : 1;
        s.from.set(p.x + side * 140, 70, p.z - 90);
        s.exit.set(p.x - side * 160, 110, p.z + 60);
        s.t = 0;
        mats.car.color.copy(p.color);
      } else { if (g.visible) g.visible = false; return; }
    }
    s.t += dt;
    const t = s.t, p = CAR_FX.parked[s.car];
    g.visible = true;
    const sh = ship.current!, bm = beam.current!, cm = car.current!, sp = spark.current!;
    // ship path
    if (t < T.arrive) sh.position.lerpVectors(s.from, s.to, ease(t / T.arrive));
    else if (t < T.beamOff) sh.position.copy(s.to);
    else { const u = clamp01((t - T.beamOff) / (T.gone - T.beamOff)); sh.position.lerpVectors(s.to, s.exit, u * u * u); }
    sh.visible = t < T.gone;
    const bob = Math.sin(s.clock * 2.2) * 0.25;
    sh.position.y += t < T.gone ? bob : 0;
    sh.rotation.y += dt * 1.6;
    sh.rotation.z = t < T.arrive ? (1 - t / T.arrive) * 0.35 : t > T.beamOff ? -0.25 : Math.sin(s.clock * 1.3) * 0.05;
    // rim lights chase round
    const im = rim.current!;
    for (let i = 0; i < N_RIM; i++) { col.setHSL(((i / N_RIM) + s.clock * 0.5) % 1, 1, 0.6 + 0.3 * Math.max(0, Math.sin(s.clock * 8 - i))); im.setColorAt(i, col); }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    // beam
    const beamA = t < T.beamOn ? clamp01((t - T.arrive) / (T.beamOn - T.arrive)) : t < T.liftEnd ? 1 : clamp01(1 - (t - T.liftEnd) / (T.beamOff - T.liftEnd));
    bm.visible = sp.visible = beamA > 0.01;
    mats.beam.opacity = beamA * (0.26 + Math.sin(s.clock * 14) * 0.04);
    mats.spark.opacity = beamA;
    bm.position.set(s.to.x, s.to.y + bob - 0.6, s.to.z); bm.scale.set(1, s.to.y + bob - 0.6, 1);
    if (sp.visible) {
      const a = sparkGeo.attributes.position as THREE.BufferAttribute;
      const H = s.to.y - 0.6;
      for (let i = 0; i < N_SPARK; i++) {
        const u = ((i * 0.618 + s.clock * 0.18) % 1), ang = i * 2.4 + s.clock * (1.5 + (i % 3) * 0.4);
        const rr = (3.2 - u * 2.4) * (0.25 + ((i * 0.37) % 0.75));
        a.setXYZ(i, s.to.x + Math.cos(ang) * rr, u * H, s.to.z + Math.sin(ang) * rr);
      }
      a.needsUpdate = true;
    }
    // the car: hidden in the instanced lot from the moment it starts lifting until it lands back
    if (t >= T.beamOn && t < T.liftEnd) {
      const u = (t - T.beamOn) / (T.liftEnd - T.beamOn);
      const y = ease(u) * (HOVER - 1.4);
      const sc = u < 0.75 ? 1 : 1 - ((u - 0.75) / 0.25) * 0.9;
      cm.visible = true;
      cm.position.set(p.x, y + Math.sin(t * 3) * 0.08 * u, p.z);
      cm.rotation.set(Math.sin(t * 1.7) * 0.15 * u, p.yaw + u * u * 3.5, Math.cos(t * 1.3) * 0.12 * u);
      cm.scale.setScalar(sc);
      overrideCar(s.car, HIDDEN, Math.max(0, 1 - u * 1.5));
    } else if (t >= T.back && t < T.landed) {
      // dropped back from the sky, gently, with a little wobble
      const u = (t - T.back) / (T.landed - T.back);
      cm.visible = true;
      cm.position.set(p.x, (1 - ease(u)) * 9, p.z);
      cm.rotation.set(Math.sin(u * 12) * 0.08 * (1 - u), p.yaw + (1 - ease(u)) * 2, 0);
      cm.scale.setScalar(0.4 + 0.6 * ease(Math.min(1, u * 1.6)));
      overrideCar(s.car, HIDDEN, u);
    } else cm.visible = false;
    if (t >= T.landed) {
      overrideCar(s.car, null); CAR_FX.claimed.delete(s.car);
      s.t = -1; s.car = -1; s.next = s.clock + 45 + s.r() * 45;
      g.visible = false;
    }
  });

  return (
    <group ref={root} visible={false}>
      <group ref={ship}>
        <mesh geometry={geo.saucer} material={mats.saucer} raycast={noRay} />
        <mesh geometry={geo.dome} material={mats.dome} position={[0, 0.4, 0]} raycast={noRay} />
        <instancedMesh ref={rim} args={[geo.bulb, mats.bulb, N_RIM]} raycast={noRay} frustumCulled={false} />
      </group>
      <mesh ref={beam} geometry={geo.beam} material={mats.beam} raycast={noRay} frustumCulled={false} renderOrder={5} />
      <points ref={spark} geometry={sparkGeo} material={mats.spark} raycast={noRay} frustumCulled={false} />
      <mesh ref={car} geometry={geo.car} material={mats.car} raycast={noRay} visible={false} />
    </group>
  );
}

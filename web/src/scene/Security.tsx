// EAS security at the exits, driven by the ops day log's alarms (minutes[].alarms: gate, kind eas|skip_scan, £).
// When an alarm fires: the gate pedestals strobe red, a red light floods the floor, it goes beep beep beep (WebAudio,
// respects the sound toggle), the person who set it off freezes in the gate with their hands up, and the guard runs
// over (StaffCrew reads OpsLive.guard). Shrink £ and incident counts are the log's (see useOpsKpis); the shoplifter
// figure is presentation only.
import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { StoreConfig } from '../types';
import { storePlan } from '../layout';
import { bus } from './fx';
import { BODY_GEO, EYE_GEO, INK_MAT, PUPIL_GEO, WHITE, INKM, type OpsLive } from './Staff';
import type { MutableRefObject } from 'react';

export interface Lifter { id: number; gate: { x: number; z: number; id?: string }; t0: number; value?: number; kind?: string }

const RED = new THREE.Color('#ff2244'), OFF = new THREE.Color('#e8f1f7');

function GateAlarm({ id, x, z }: { id: string; x: number; z: number }) {
  const ring = useRef<THREE.Mesh>(null), col = useRef<THREE.Mesh>(null), lamp = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((st) => {
    const now = st.clock.elapsedTime;
    const on = (bus.alarm[id] ?? 0) > now;
    const blink = on && Math.sin(now * 22) > 0;
    if (lamp.current) lamp.current.color.copy(blink ? RED : on ? RED.clone().lerp(OFF, 0.6) : OFF);
    if (ring.current) {
      ring.current.visible = on;
      const k = (now * 1.6) % 1;
      ring.current.scale.setScalar(0.6 + k * 1.8);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = on ? (1 - k) * 0.7 : 0;
    }
    if (col.current) { col.current.visible = blink; }
  });
  return (
    <group position={[x, 0, z]}>
      {/* beacon on a post over the gate */}
      <mesh position={[0, 1.95, 0]} raycast={noRay}><cylinderGeometry args={[0.025, 0.025, 0.5, 8]} /><meshStandardMaterial color="#c9cfdc" metalness={0.5} /></mesh>
      <mesh position={[0, 2.25, 0]} raycast={noRay}><sphereGeometry args={[0.12, 14, 10]} /><meshBasicMaterial ref={lamp} color="#e8f1f7" /></mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} visible={false} raycast={noRay}>
        <ringGeometry args={[0.55, 0.75, 40]} />
        <meshBasicMaterial color="#ff2244" transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={col} position={[0, 1.0, 0]} visible={false} raycast={noRay}>
        <cylinderGeometry args={[0.6, 0.9, 2.0, 24, 1, true]} />
        <meshBasicMaterial color="#ff2244" transparent opacity={0.22} depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

function Shoplifter({ l, live }: { l: Lifter; live: MutableRefObject<OpsLive> }) {
  const g = useRef<THREE.Group>(null);
  useFrame((st) => {
    const gr = g.current; if (!gr) return;
    const t = live.current.t, now = st.clock.elapsedTime;
    const k = Math.min(1, (t - l.t0) / 1.4);
    gr.position.set(l.gate.x + 0.5, k < 1 ? Math.abs(Math.sin(now * 14)) * 0.08 : 0, l.gate.z - 3 + k * 2.6);
    gr.rotation.set(0, k < 1 ? 0 : Math.sin(now * 20) * 0.15, 0);
    gr.visible = t >= l.t0 && t - l.t0 < 8;
  });
  return (
    <group ref={g} visible={false}>
      <mesh geometry={BODY_GEO} raycast={noRay}><meshStandardMaterial color="#6b6f7a" roughness={0.6} /></mesh>
      <mesh geometry={BODY_GEO} material={INK_MAT} raycast={noRay} />
      {/* hoodie up */}
      <mesh position={[0, 1.02, 0]} raycast={noRay}><sphereGeometry args={[0.31, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshStandardMaterial color="#4a4e58" /></mesh>
      {/* hands up */}
      {[-1, 1].map((k) => <mesh key={k} position={[k * 0.33, 1.05, 0]} rotation={[0, 0, k * 0.3]} raycast={noRay}><capsuleGeometry args={[0.05, 0.3, 4, 8]} /><meshStandardMaterial color="#6b6f7a" /></mesh>)}
      {[-1, 1].map((k) => (
        <group key={`e${k}`} position={[k * 0.1, 0.9, 0.24]}>
          <mesh geometry={EYE_GEO} material={WHITE} raycast={noRay} />
          <mesh geometry={PUPIL_GEO} material={INKM} position={[0, 0.02, 0.07]} raycast={noRay} />
        </group>
      ))}
      {/* the unscanned goods, peeking out of a bag */}
      <mesh position={[-0.38, 0.45, 0.1]} raycast={noRay}><boxGeometry args={[0.26, 0.3, 0.16]} /><meshStandardMaterial color="#e9dfd8" /></mesh>
    </group>
  );
}

/** red flood light that jumps to whichever gate is alarming (one light total, intensity 0 when quiet) */
function AlarmLight({ gates }: { gates: { id: string; x: number; z: number }[] }) {
  const L = useRef<THREE.PointLight>(null);
  useFrame((st) => {
    const now = st.clock.elapsedTime;
    const g = gates.find((x) => (bus.alarm[x.id] ?? 0) > now);
    if (!L.current) return;
    if (!g) { L.current.intensity = 0; return; }
    L.current.position.set(g.x, 2.4, g.z);
    L.current.intensity = Math.sin(now * 22) > 0 ? 9 : 2;
  });
  return <pointLight ref={L} color="#ff2244" intensity={0} distance={9} decay={1.6} />;
}

export function Security({ cfg, lifters, live }: { cfg: StoreConfig; lifters: Lifter[]; live: MutableRefObject<OpsLive> }) {
  const P = storePlan(cfg);
  return (
    <group>
      {P.gates.map((g) => <GateAlarm key={g.id} id={g.id} x={g.x} z={g.z} />)}
      <AlarmLight gates={P.gates} />
      {lifters.map((l) => <Shoplifter key={l.id} l={l} live={live} />)}
    </group>
  );
}
const noRay = () => null;

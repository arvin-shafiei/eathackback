import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { Agent, Persona, Planogram, Product, StoreConfig } from '../types';
import { G, gondolaX, sampleTimeline, type Timeline } from '../layout';
import { Store } from './Store';
import { Shoppers, type ThoughtMode } from './Shoppers';

export type CamMode = 'overview' | 'walk' | 'follow';

function Clock({ timeRef, playing, speed, duration }: { timeRef: MutableRefObject<number>; playing: boolean; speed: number; duration: number }) {
  useFrame((_, dt) => {
    if (!playing) return;
    timeRef.current = Math.min(duration, timeRef.current + Math.min(dt, 0.1) * speed);
  });
  return null;
}

function CameraRig({ mode, nonce, cfg, follow, timeRef }: { mode: CamMode; nonce: number; cfg: StoreConfig; follow: Timeline | null; timeRef: MutableRefObject<number> }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as OrbitImpl | null;
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; until: number } | null>(null);
  const keys = useRef(new Set<string>());

  useEffect(() => {
    const zMid = G.zCentre;
    if (mode === 'overview') goal.current = { pos: new THREE.Vector3(13.5, 13, -5), target: new THREE.Vector3(0, 0.4, zMid + 0.5), until: performance.now() + 1200 };
    if (mode === 'walk') {
      const x = gondolaX(cfg, 0.5 + Math.floor(cfg.aisles / 2));
      goal.current = { pos: new THREE.Vector3(x, 1.6, cfg.entrance.z + 3), target: new THREE.Vector3(x, 1.25, cfg.entrance.z + 9), until: performance.now() + 1200 };
    }
  }, [mode, nonce, cfg]);

  useEffect(() => {
    if (mode !== 'walk') return;
    const down = (e: KeyboardEvent) => { if ((e.target as HTMLElement)?.tagName === 'INPUT') return; keys.current.add(e.key.toLowerCase()); };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); keys.current.clear(); };
  }, [mode]);

  useFrame((_, dt) => {
    if (!controls) return;
    if (mode === 'follow' && follow) {
      const s = sampleTimeline(follow, timeRef.current);
      if (s.visible) {
        const tgt = new THREE.Vector3(s.x, 1.2, s.z);
        const back = new THREE.Vector3(-Math.sin(s.heading), 0, -Math.cos(s.heading)).multiplyScalar(3.2);
        const pos = tgt.clone().add(back).add(new THREE.Vector3(0, 1.6, 0));
        camera.position.lerp(pos, 0.06); controls.target.lerp(tgt, 0.12); controls.update();
      }
      return;
    }
    if (mode === 'walk' && keys.current.size) {
      const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
      const mv = new THREE.Vector3();
      const k = keys.current;
      if (k.has('w') || k.has('arrowup')) mv.add(fwd);
      if (k.has('s') || k.has('arrowdown')) mv.sub(fwd);
      if (k.has('d') || k.has('arrowright')) mv.add(right);
      if (k.has('a') || k.has('arrowleft')) mv.sub(right);
      if (mv.lengthSq()) { mv.normalize().multiplyScalar(dt * 3.2); camera.position.add(mv); controls.target.add(mv); controls.update(); }
    }
    const g = goal.current;
    if (g) {
      camera.position.lerp(g.pos, 0.08); controls.target.lerp(g.target, 0.1); controls.update();
      if (performance.now() > g.until) goal.current = null;
    }
  });
  return null;
}

export interface SceneProps {
  cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>; personas: Record<string, Persona>;
  agents: Agent[]; timelines: Record<string, Timeline>; timeRef: MutableRefObject<number>;
  playing: boolean; speed: number; duration: number;
  selectedProduct: string | null; onProduct: (code: string) => void;
  selectedAgent: string | null; onAgent: (id: string) => void; onEvent: (agentId: string, step: number) => void;
  editMode: boolean; editSel: string | null; onSlot: (slot: string) => void; changed: Set<string>;
  heat: Record<string, string> | null; thoughts: ThoughtMode;
  cam: CamMode; camNonce: number; onBackground: () => void;
}

export function Scene(p: SceneProps) {
  return (
    <Canvas flat shadows dpr={[1, 2]} camera={{ position: [13.5, 13, -5], fov: 42, near: 0.1, far: 200 }} onPointerMissed={p.onBackground} gl={{ antialias: true, alpha: true }}>
      <hemisphereLight args={['#fff4ec', '#f3c9d6', 1.1]} />
      <directionalLight position={[8, 18, -6]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-20} shadow-camera-right={20} shadow-camera-top={20} shadow-camera-bottom={-20} />
      <ambientLight intensity={0.5} />
      <Clock timeRef={p.timeRef} playing={p.playing} speed={p.speed} duration={p.duration} />
      <Store cfg={p.cfg} planogram={p.planogram} products={p.products} selectedProduct={p.selectedProduct} onProduct={p.onProduct} editMode={p.editMode} editSel={p.editSel} onSlot={p.onSlot} changed={p.changed} heat={p.heat} />
      {!p.editMode && (
        <Shoppers agents={p.agents} timelines={p.timelines} timeRef={p.timeRef} personas={p.personas} products={p.products} selectedAgent={p.selectedAgent} onAgent={p.onAgent} onEvent={p.onEvent} thoughts={p.thoughts} />
      )}
      <Html position={[p.cfg.entrance.x, 0.4, p.cfg.entrance.z]} center distanceFactor={14} zIndexRange={[5, 0]}><div className="sticker sticker-brand">in</div></Html>
      <Html position={[p.cfg.checkout.x, 1.4, p.cfg.checkout.z + 1.2]} center distanceFactor={14} zIndexRange={[5, 0]}><div className="sticker">checkout</div></Html>
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.04} minDistance={1.5} maxDistance={60} target={[0, 0, G.zCentre]} />
      <CameraRig mode={p.cam} nonce={p.camNonce} cfg={p.cfg} follow={p.selectedAgent ? p.timelines[p.selectedAgent] ?? null : null} timeRef={p.timeRef} />
    </Canvas>
  );
}

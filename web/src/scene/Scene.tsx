import { Suspense, memo, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import type { OrbitControls as OrbitImpl } from 'three-stdlib';
import type { Agent, Persona, Planogram, Product, StoreConfig } from '../types';
import { gondolaX, storeBounds, storePlan, zRange, type Timeline } from '../layout';
import { Store } from './Store';
import { TrafficHeat } from './TrafficHeat';
import { World } from './world/World';
import { Shelves } from './Shelves';
import { Crowd, type ThoughtMode } from './Crowd';
import { buildBeats } from './beats';
import { Ops } from './Ops';
import type { OpsDay } from '../ops';
import { bus } from './fx';

export type CamMode = 'intro' | 'overview' | 'walk' | 'follow';
export const INTRO_SECONDS = 10;

function Clock({ timeRef, playing, speed, duration }: { timeRef: MutableRefObject<number>; playing: boolean; speed: number; duration: number }) {
  useFrame((_, dt) => {
    if (!playing) return;
    timeRef.current = Math.min(duration, timeRef.current + Math.min(dt, 0.1) * speed);
  });
  return null;
}

/** overview: the whole store from the FRONT (street side, above the checkouts) at a 3/4 angle, so the back chillers
 *  read at the far end instead of being hidden behind the back wall. Distance is fitted to the store footprint
 *  (fov 42, ~16:9) so it works for express through superstore. */
function overviewPose(cfg: StoreConfig) {
  const B = storeBounds(cfg);
  const dist = Math.max(B.w * 0.78, B.d * 1.15) + 8;
  const elev = 0.66, yaw = 0.1; // ~38 deg down, slightly off-axis
  const target = new THREE.Vector3(B.cx, 0, B.cz + B.d * 0.06);
  const pos = target.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev)).multiplyScalar(dist));
  return { pos, target, dist };
}

function CameraRig({ mode, nonce, cfg, onIntroDone }: { mode: CamMode; nonce: number; cfg: StoreConfig; onIntroDone: () => void }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as unknown as OrbitImpl | null;
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; until: number } | null>(null);
  const keys = useRef(new Set<string>());
  const intro = useRef<{ t0: number; el: number; pos: THREE.CatmullRomCurve3; tgt: THREE.CatmullRomCurve3 } | null>(null);
  const shakeOff = useRef(new THREE.Vector3());

  useEffect(() => {
    const ov = overviewPose(cfg);
    if (mode === 'overview') goal.current = { ...ov, until: performance.now() + 1400 };
    if (mode === 'walk') {
      const x = gondolaX(cfg, 0.5 + Math.floor(cfg.aisles / 2));
      goal.current = { pos: new THREE.Vector3(x, 1.6, zRange(cfg)[0] - 1.8), target: new THREE.Vector3(x, 1.25, zRange(cfg)[0] + 4), until: performance.now() + 1400 };
    }
    if (mode === 'intro') {
      const B = storeBounds(cfg);
      const P = storePlan(cfg);
      const front = P.frontZ;
      const ax = gondolaX(cfg, 0.5 + Math.floor(cfg.aisles / 2));
      const [z0, z1] = zRange(cfg);
      intro.current = {
        t0: performance.now(), el: 0,
        pos: new THREE.CatmullRomCurve3([
          new THREE.Vector3(B.cx + 3, 30, B.zMax + 26),
          new THREE.Vector3(P.entrances[0].x + 1.2, 3.4, front - 8),
          new THREE.Vector3(P.entrances[0].x + 0.2, 1.9, front + 2.4),
          new THREE.Vector3(ax, 2.4, z0 - 1.2),
          new THREE.Vector3(ax + 0.6, 2.8, z1 - 1),
          new THREE.Vector3(P.lanes[0]?.x ?? 0, 5.5, P.checkoutZ - 4),
          ov.pos,
        ], false, 'centripetal'),
        tgt: new THREE.CatmullRomCurve3([
          new THREE.Vector3(B.cx, 0, B.cz),
          new THREE.Vector3(P.entrances[0].x, 2.4, front),
          new THREE.Vector3(P.entrances[0].x, 1.4, z0),
          new THREE.Vector3(ax, 1.2, z1),
          new THREE.Vector3(ax, 1.0, P.checkoutZ),
          new THREE.Vector3(B.cx, 0.6, P.checkoutZ + 1),
          ov.target,
        ], false, 'centripetal'),
      };
    } else intro.current = null;
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
    camera.position.sub(shakeOff.current); shakeOff.current.set(0, 0, 0);
    controls.enabled = mode !== 'intro';
    if (mode === 'intro' && intro.current) {
      intro.current.el += Math.min(dt, 1 / 30); // frame-accumulated, so a slow first frame can't skip the fly-through
      const k = Math.min(1, intro.current.el / INTRO_SECONDS);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      camera.position.copy(intro.current.pos.getPoint(e));
      controls.target.copy(intro.current.tgt.getPoint(e));
      controls.update();
      if (k >= 1) { intro.current = null; onIntroDone(); }
    } else if (mode === 'follow' && bus.follow) {
      const f = bus.follow;
      const tgt = new THREE.Vector3(f.x, 0.9, f.z);
      const back = new THREE.Vector3(-Math.sin(f.heading), 0, -Math.cos(f.heading)).multiplyScalar(3.4);
      const pos = tgt.clone().add(back).add(new THREE.Vector3(0, 4.6, 0));
      camera.position.lerp(pos, 1 - Math.exp(-dt * 3.5)); controls.target.lerp(tgt, 1 - Math.exp(-dt * 7)); controls.update();
    } else {
      if (mode === 'walk' && keys.current.size) {
        const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
        const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
        const mv = new THREE.Vector3();
        const k = keys.current;
        if (k.has('w') || k.has('arrowup')) mv.add(fwd);
        if (k.has('s') || k.has('arrowdown')) mv.sub(fwd);
        if (k.has('d') || k.has('arrowright')) mv.add(right);
        if (k.has('a') || k.has('arrowleft')) mv.sub(right);
        if (mv.lengthSq()) { mv.normalize().multiplyScalar(dt * 3.4); camera.position.add(mv); controls.target.add(mv); controls.update(); }
      }
      const g = goal.current;
      if (g) {
        camera.position.lerp(g.pos, 1 - Math.exp(-dt * 5)); controls.target.lerp(g.target, 1 - Math.exp(-dt * 6)); controls.update();
        if (performance.now() > g.until) goal.current = null;
      }
    }
    // cartoon screen shake on bonks (opt-in)
    bus.shake *= Math.exp(-dt * 6);
    if (bus.shakeOn && bus.shake > 0.02) {
      const a = bus.shake * 0.12;
      shakeOff.current.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
      camera.position.add(shakeOff.current);
    }
  });
  return null;
}

/** perf: real-time shadows double every draw call (each caster is drawn again into the shadow map) and the crowd
 *  already has blob shadows, so they are off unless ?shadows=1. */
const SHADOWS = (() => { try { return new URLSearchParams(location.search).get('shadows') === '1'; } catch { return false; } })();

/** perf: while paused the canvas renders on demand (orbit/camera moves invalidate) plus a slow 4 fps tick so
 *  streamed-in pack images and late state still show up. Playing = continuous loop. */
function PausedTicker({ on }: { on: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => invalidate(), 250);
    return () => clearInterval(id);
  }, [on, invalidate]);
  return null;
}

/** perf: PerformanceMonitor drives the pixel ratio between 0.75 and 1.5 (slow frames → fewer pixels) */
function AutoDpr() {
  const setDpr = useThree((s) => s.setDpr);
  return <PerformanceMonitor bounds={() => [40, 58]} flipflops={6} onChange={({ factor }) => setDpr(Math.round((0.75 + 0.75 * factor) * 4) / 4)} />;
}

function Sun({ cx, cz, zMin, r }: { cx: number; cz: number; zMin: number; r: number }) {
  const ref = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const l = ref.current; if (!l) return;
    l.target.position.set(cx, 0, cz); scene.add(l.target);
    return () => { scene.remove(l.target); };
  }, [cx, cz, scene]);
  return (
    <directionalLight
      ref={ref} position={[cx + 12, 26, zMin - 2]} intensity={1.55} castShadow={SHADOWS}
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-r} shadow-camera-right={r} shadow-camera-top={r} shadow-camera-bottom={-r} shadow-camera-far={120} shadow-bias={-0.0004}
    />
  );
}

/** perf/debug hook: window.__gl (renderer) and window.__scene for headless probes (renderer.info etc.) */
function PerfHook() {
  const gl = useThree((s) => s.gl), scene = useThree((s) => s.scene);
  useEffect(() => { const w = window as unknown as Record<string, unknown>; w.__gl = gl; w.__scene = scene; }, [gl, scene]);
  return null;
}

export interface SceneProps {
  cfg: StoreConfig; planogram: Planogram; replayPlan: Planogram; products: Record<string, Product>; personas: Record<string, Persona>;
  agents: Agent[]; timelines: Record<string, Timeline>; timeRef: MutableRefObject<number>;
  playing: boolean; speed: number; duration: number;
  selectedProduct: string | null; onProduct: (code: string) => void;
  selectedAgent: string | null; onAgent: (id: string) => void; onEvent: (agentId: string, step: number) => void;
  editMode: boolean; editSel: string | null; onSlot: (slot: string) => void; changed: Set<string>;
  ownerHeat?: boolean; ownerHeatMin?: number | null;
  heat: Record<string, string> | null; thoughts: ThoughtMode;
  cam: CamMode; camNonce: number; onBackground: () => void; onIntroDone: () => void; onUserCamera: () => void;
  /** both optional, like Ops' own props: undefined lets the ops layer load its day and clock itself */
  ops?: OpsDay | null; clockStart?: number;
}

/** perf: App re-renders ~8x/s (clock readout, bonk counter) with fresh inline callbacks. The 3D tree must not
 *  reconcile on each of those, so callbacks go through a ref (always the latest) and the canvas is memoised. */
export function Scene(p: SceneProps) {
  const ref = useRef(p); ref.current = p;
  const cb = useMemo(() => ({
    onProduct: (code: string) => ref.current.onProduct(code),
    onAgent: (id: string) => ref.current.onAgent(id),
    onEvent: (agentId: string, step: number) => ref.current.onEvent(agentId, step),
    onSlot: (slot: string) => ref.current.onSlot(slot),
    onBackground: () => ref.current.onBackground(),
    onIntroDone: () => ref.current.onIntroDone(),
    onUserCamera: () => ref.current.onUserCamera(),
  }), []);
  return <SceneCanvas {...p} {...cb} />;
}

const SceneCanvas = memo(function SceneCanvas(p: SceneProps) {
  const B = storeBounds(p.cfg);
  const ov = overviewPose(p.cfg);
  const beats = useMemo(() => buildBeats(p.cfg, p.replayPlan, p.agents, p.timelines), [p.cfg, p.replayPlan, p.agents, p.timelines]);
  const shadowR = Math.max(B.w, B.d) * 0.62;
  // demand-render while paused, except during the intro fly-through (it animates on its own clock)
  const demand = !p.playing && p.cam !== 'intro';
  return (
    <Canvas
      flat shadows={SHADOWS} dpr={[1, 1.5]} frameloop={demand ? 'demand' : 'always'}
      camera={{ position: ov.pos.toArray(), fov: 42, near: 0.1, far: Math.max(1000, ov.dist * 8) }}
      onPointerMissed={p.onBackground} onPointerDown={p.onUserCamera} onWheel={p.onUserCamera}
      gl={{ antialias: true, alpha: true, stencil: false, powerPreference: 'high-performance' }}
    >
      <AutoDpr />
      <PausedTicker on={demand} />
      <fog attach="fog" args={['#ffe3d6', Math.max(80, ov.dist * 1.0), Math.max(260, ov.dist * 3.2)]} />
      <hemisphereLight args={['#fff4ec', '#f3c9d6', 1.15]} />
      <Sun cx={B.cx} cz={B.cz} zMin={B.zMin} r={shadowR} />
      <ambientLight intensity={0.45} />
      <PerfHook />
      <World cfg={p.cfg} />
      <Clock timeRef={p.timeRef} playing={p.playing} speed={p.speed} duration={p.duration} />
      <Suspense fallback={null}>
        <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60} paused={!p.playing}>
          <Store cfg={p.cfg} planogram={p.planogram} products={p.products} onProduct={p.onProduct} editMode={p.editMode} editSel={p.editSel} onSlot={p.onSlot} changed={p.changed} heat={p.heat} />
          <TrafficHeat cfg={p.cfg} timelines={p.timelines} on={!!p.ownerHeat} lastMinutes={p.ownerHeatMin ?? null} timeRef={p.timeRef} />
          <Shelves cfg={p.cfg} planogram={p.planogram} products={p.products} gaps={beats.gaps} timeRef={p.timeRef} live={!p.editMode} selectedProduct={p.selectedProduct} onProduct={p.onProduct} editMode={p.editMode} onSlot={p.onSlot} />
          <Ops cfg={p.cfg} ops={p.ops} timeRef={p.timeRef} clockStart={p.clockStart} planogram={p.replayPlan} products={p.products} live={!p.editMode} />
          {!p.editMode && (
            <Crowd cfg={p.cfg} agents={p.agents} timelines={p.timelines} beats={beats} timeRef={p.timeRef} personas={p.personas} products={p.products}
              selectedAgent={p.selectedAgent} onAgent={p.onAgent} onEvent={p.onEvent} thoughts={p.thoughts} speed={p.speed} />
          )}
        </Physics>
      </Suspense>
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.04} minDistance={1.5} maxDistance={Math.max(90, ov.dist * 1.35)} target={ov.target.toArray()} />
      <CameraRig mode={p.cam} nonce={p.camNonce} cfg={p.cfg} onIntroDone={p.onIntroDone} />
    </Canvas>
  );
});

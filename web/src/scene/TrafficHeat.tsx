// Floor traffic heatmap for the store-owner view. ONE DataTexture on ONE plane just above the floor (1 draw call) plus
// 3 sprite labels on the top hotspots (3 draw calls). No drei <Html>.
// Numbers: owner.ts occupancy() / hotspots() over the replay timelines (people-seconds per m² per minute).
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { StoreConfig } from '../types';
import type { Timeline } from '../layout';
import { hotspots, occupancy, type Hotspot, type OccGrid } from '../owner';

export interface TrafficHeatProps {
  cfg: StoreConfig;
  timelines: Record<string, Timeline>;
  /** draw it at all (the panel's toggle) */
  on: boolean;
  /** null = whole run; N = the last N minutes of replay up to timeRef.current */
  lastMinutes?: number | null;
  /** replay clock (App's timeRef); only needed when lastMinutes is set */
  timeRef?: MutableRefObject<number>;
}

/** cool → hot ramp (blue, teal, yellow, orange, red). k in 0..1 */
const RAMP: [number, number, number][] = [[40, 90, 220], [20, 180, 190], [250, 220, 60], [250, 130, 30], [225, 30, 40]];
function ramp(k: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, k)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x)), f = x - i;
  const a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** paint the grid into an RGBA buffer. colour scale: sqrt(density / max) so quiet-but-used cells still show; empty cells are transparent */
function paint(g: OccGrid, data: Uint8Array) {
  const max = g.max || 1;
  for (let iz = 0; iz < g.nz; iz++) for (let ix = 0; ix < g.nx; ix++) {
    const d = g.density[iz * g.nx + ix];
    // texture row 0 = world +z edge (plane is rotated -90° about x, so v=0 lands at max z)
    const o = ((g.nz - 1 - iz) * g.nx + ix) * 4;
    if (d <= 0) { data[o + 3] = 0; continue; }
    const k = Math.sqrt(d / max), c = ramp(k);
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = Math.round(90 + 140 * k);
  }
}

function labelTexture(text: string) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(20,16,20,0.88)'; x.beginPath(); x.roundRect(4, 4, 504, 88, 26); x.fill();
  x.fillStyle = '#fff'; x.font = '700 30px Inter, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 256, 48, 480);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function HotLabel({ h }: { h: Hotspot }) {
  const text = `busy: ${h.name}, ${h.density.toFixed(1)} people·s/m²/min`;
  const tex = useMemo(() => labelTexture(text), [text]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={[h.x, 3.4, h.z]} scale={[5.2, 0.975, 1]} renderOrder={12} raycast={() => null}>
      <spriteMaterial map={tex} depthTest={false} transparent toneMapped={false} />
    </sprite>
  );
}

export function TrafficHeat({ cfg, timelines, on, lastMinutes = null, timeRef }: TrafficHeatProps) {
  // whole-run grid: computed once per timelines
  const whole = useMemo(() => (on ? occupancy(cfg, timelines) : null), [cfg, timelines, on]);
  // windowed grid: recomputed at most every 2 s of wall time while the replay clock moves
  const [win, setWin] = useState<OccGrid | null>(null);
  const last = useRef({ wall: 0, t: -1 });
  useEffect(() => { setWin(null); last.current = { wall: 0, t: -1 }; }, [lastMinutes, timelines, on]);
  useFrame(() => {
    if (!on || lastMinutes == null || !timeRef) return;
    const now = performance.now(), t = timeRef.current;
    if (now - last.current.wall < 2000 || Math.abs(t - last.current.t) < 0.5) return;
    last.current = { wall: now, t };
    setWin(occupancy(cfg, timelines, { t0: Math.max(0, t - lastMinutes * 60), t1: t }));
  });
  const grid = lastMinutes == null ? whole : win;

  const tex = useMemo(() => {
    if (!grid) return null;
    const t = new THREE.DataTexture(new Uint8Array(grid.nx * grid.nz * 4), grid.nx, grid.nz, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [grid?.nx, grid?.nz]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tex && grid) { paint(grid, tex.image.data as Uint8Array); tex.needsUpdate = true; } }, [tex, grid]);
  useEffect(() => () => tex?.dispose(), [tex]);
  const top = useMemo(() => (grid ? hotspots(cfg, grid, 3) : []), [cfg, grid]);

  if (!on || !grid || !tex) return null;
  const w = grid.nx * grid.cell, d = grid.nz * grid.cell;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[grid.x0 + w / 2, 0.03, grid.z0 + d / 2]} renderOrder={2} raycast={() => null}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
      {top.map((h) => <HotLabel key={h.cell} h={h} />)}
    </group>
  );
}

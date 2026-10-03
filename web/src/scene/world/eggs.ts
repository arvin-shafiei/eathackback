// Shared state for the outdoor easter eggs (Ufo.tsx, Villain.tsx). CarPark owns the parked-car InstancedMesh; the
// eggs write per-instance matrix overrides here and CarPark applies them inside its own useFrame (no extra frame
// loop, no React state). An override with null matrix restores the car's parked pose.
import * as THREE from 'three';

export interface ParkedCar { x: number; z: number; yaw: number; color: THREE.Color }

export const CAR_FX = {
  parked: [] as ParkedCar[],
  /** instance index -> override matrix for the car + shadow scale (0 hides the blob) */
  over: new Map<number, { m: THREE.Matrix4; sh: number }>(),
  dirty: new Set<number>(),
  /** cars currently in use by an egg (so UFO + villain never grab the same one) */
  claimed: new Set<number>(),
  /** last egg target (debug / screenshot framing) */
  focus: null as null | { x: number; z: number; who: string; tx?: number; tz?: number },
};
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__eggs = CAR_FX;

/** set (or with m = null, restore) a parked car's pose */
export function overrideCar(i: number, m: THREE.Matrix4 | null, sh = 1) {
  if (m) CAR_FX.over.set(i, { m, sh }); else CAR_FX.over.delete(i);
  CAR_FX.dirty.add(i);
}

/** a matrix that hides an instance */
export const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export function urlFlag(name: string) {
  try { return new URLSearchParams(location.search).get(name); } catch { return null; }
}

/** pick a parked car near (x, z) that isn't claimed; deterministic order from a seeded rng */
export function pickCar(x: number, z: number, r: () => number, maxD = 40) {
  const list = CAR_FX.parked
    .map((p, i) => ({ i, d: Math.hypot(p.x - x, p.z - z) }))
    .filter((c) => !CAR_FX.claimed.has(c.i) && !CAR_FX.over.has(c.i) && c.d < maxD)
    .sort((a, b) => a.d - b.d);
  if (!list.length) return -1;
  return list[Math.min(list.length - 1, (r() * Math.min(6, list.length)) | 0)].i;
}

export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Store-wide egg state the store itself reads (Tsunami.tsx writes it). Defaults leave everything unchanged:
 *  ShelfFill hides `1 - stock` of every slot (swept across x0..x1 so bays empty / refill one after another),
 *  Store.tsx registers its outer walls + shopfront as `shell` (an egg may drive those children's matrices and must
 *  restore them), Scene.tsx registers the shoppers + staff layers as `people` (an egg may hide it while its own
 *  evacuees are on screen). */
export const EGG_FX = {
  stock: 1, x0: 0, x1: 1,
  shell: null as THREE.Group | null,
  people: null as THREE.Group | null,
};

// Shared weather state for the outdoor world. Mode comes from ?weather=sun|overcast|rain|snow|fog|auto and can be
// switched live from the console / a demo script with window.__weather('rain'). Weather.tsx eases the blend values
// (no React state: everything reads WX inside useFrame).
import type * as THREE from 'three';

export type WeatherName = 'sun' | 'overcast' | 'rain' | 'snow' | 'fog';
export interface Blend { rain: number; snow: number; fog: number; over: number; wet: number }
export const MODES: Record<WeatherName, Blend> = {
  sun: { rain: 0, snow: 0, fog: 0, over: 0, wet: 0 },
  overcast: { rain: 0, snow: 0, fog: 0.25, over: 1, wet: 0 },
  rain: { rain: 1, snow: 0, fog: 0.35, over: 1, wet: 1 },
  snow: { rain: 0, snow: 1, fog: 0.3, over: 0.7, wet: 0 },
  fog: { rain: 0, snow: 0, fog: 1, over: 0.6, wet: 0.3 },
};
export const AUTO_CYCLE: WeatherName[] = ['sun', 'overcast', 'rain', 'sun', 'fog', 'snow'];

function initial(): string {
  try { return new URLSearchParams(location.search).get('weather') ?? 'sun'; } catch { return 'sun'; }
}
const first = initial();
const isMode = (s: string): s is WeatherName => s in MODES;

export const WX = {
  auto: first === 'auto',
  target: (isMode(first) ? first : 'sun') as WeatherName,
  /** current eased blend: snapped to the start mode so a ?weather=rain screenshot is rainy at once */
  cur: { ...MODES[isMode(first) ? first : 'sun'] } as Blend,
  /** materials that get a white emissive dusting when it snows */
  snowMats: new Set<THREE.MeshLambertMaterial>(),
  invalidate: null as null | (() => void),
};

export function setWeather(name: string) {
  if (name === 'auto') { WX.auto = true; }
  else if (isMode(name)) { WX.auto = false; WX.target = name; }
  WX.invalidate?.();
  return WX.auto ? 'auto' : WX.target;
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__weather = setWeather;

/** register a world material for the snow dusting (emissive white, scaled by snow amount) */
export function snowable<T extends THREE.MeshLambertMaterial>(m: T): T { WX.snowMats.add(m); return m; }

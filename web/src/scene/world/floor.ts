// Shop floor: large cream terrazzo / vinyl tiles (procedural canvas, speckle + grout), mipmapped + anisotropic,
// plus a tiny gradient environment map so the polished floor picks up a soft sheen. All built once and cached.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** 1024 px = 4 x 4 tiles of 60 cm (2.4 m per repeat) */
export const FLOOR_REPEAT_M = 2.4;

let floorCache: THREE.CanvasTexture | null = null;
export function terrazzoTexture() {
  if (floorCache) return floorCache;
  const S = 1024, T = S / 4;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    // each tile a hair different (real vinyl batches never match)
    const l = 87 + rnd() * 2.5;
    ctx.fillStyle = `hsl(22, 38%, ${l}%)`;
    ctx.fillRect(i * T, j * T, T, T);
  }
  // terrazzo speckle: tiny warm-grey / pink / charcoal chips
  const chips = ['rgba(120,105,100,0.30)', 'rgba(170,150,140,0.35)', 'rgba(255,120,150,0.18)', 'rgba(60,50,55,0.22)', 'rgba(255,255,255,0.55)'];
  for (let k = 0; k < 9000; k++) {
    ctx.fillStyle = chips[(rnd() * chips.length) | 0];
    const r = 0.6 + rnd() * 1.6;
    ctx.beginPath(); ctx.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2); ctx.fill();
  }
  // grout lines (drawn on both edges so the repeat seams match)
  ctx.strokeStyle = 'rgba(110,80,80,0.42)'; ctx.lineWidth = 4;
  for (let k = 0; k <= S; k += T) {
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(S, k); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
  for (let k = 3; k <= S; k += T) {
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(S, k); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  floorCache = t;
  return t;
}

let envCache: THREE.Texture | null = null;
/** cheap prefiltered env (RoomEnvironment through PMREM once) used only by the floor material */
export function floorEnv(gl: THREE.WebGLRenderer) {
  if (envCache) return envCache;
  const pm = new THREE.PMREMGenerator(gl);
  envCache = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  pm.dispose();
  return envCache;
}

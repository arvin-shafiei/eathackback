import * as THREE from 'three';
import type { Product } from '../types';
import { catColor, INK } from '../theme';

const cache = new Map<string, THREE.Texture>();
const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(/\s+/); const lines: string[] = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}

/** fallback pack: coloured box face with brand + name, sticker-style */
export function fallbackTexture(p: Pick<Product, 'brand' | 'name' | 'category' | 'role'> & { color?: string }) {
  const W = 256, H = 320;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const base = p.color || catColor(p.category);
  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
  // diagonal sheen band
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // label panel
  ctx.fillStyle = '#fffaf5'; ctx.strokeStyle = INK; ctx.lineWidth = 6;
  const r = 18, x = 18, y = 70, w = W - 36, h = 170;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
  ctx.fillStyle = INK; ctx.textAlign = 'center';
  ctx.font = '800 38px "Baloo 2", system-ui, sans-serif';
  const bl = wrap(ctx, (p.brand || '?').toLowerCase(), w - 20).slice(0, 2);
  bl.forEach((l, i) => ctx.fillText(l, W / 2, y + 48 + i * 36));
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  const nl = wrap(ctx, (p.name || '').toLowerCase(), w - 24).slice(0, 3);
  nl.forEach((l, i) => ctx.fillText(l, W / 2, y + 60 + bl.length * 36 + i * 26));
  // role chip
  if (p.role) {
    ctx.font = '800 20px Inter, system-ui, sans-serif';
    const t = p.role === 'own_label' ? 'own label' : p.role;
    const tw = ctx.measureText(t).width + 24;
    ctx.fillStyle = p.role === 'challenger' ? '#FFE14D' : p.role === 'own_label' ? '#ffffff' : '#141014';
    ctx.beginPath(); ctx.roundRect(W / 2 - tw / 2, 262, tw, 34, 17); ctx.fill(); ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = p.role === 'incumbent' ? '#ffffff' : INK; ctx.fillText(t, W / 2, 286);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

export function productTexture(p: Product, onUpgrade?: () => void): THREE.Texture {
  const key = p.code;
  const hit = cache.get(key);
  if (hit) return hit;
  const fb = fallbackTexture(p);
  cache.set(key, fb);
  if (p.image && /^https?:|^\//.test(p.image)) {
    loader.load(
      p.image,
      (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; cache.set(key, t); onUpgrade?.(); },
      undefined,
      () => { /* keep fallback (CORS / 404) */ },
    );
  }
  return fb;
}

export function clearTextureCache() { cache.forEach((t) => t.dispose()); cache.clear(); }

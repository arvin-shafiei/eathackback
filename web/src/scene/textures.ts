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

// ---------- shared per-product materials (shelf boxes + carried boxes use the same set) ----------
const matCache = new Map<string, THREE.MeshStandardMaterial[]>();
export function productMaterials(p: Product): THREE.MeshStandardMaterial[] {
  const hit = matCache.get(p.code);
  if (hit) return hit;
  const side = new THREE.Color(p.color || catColor(p.category)).multiplyScalar(0.85);
  const sideMat = new THREE.MeshStandardMaterial({ color: side, roughness: 0.55 });
  const front = new THREE.MeshStandardMaterial({ roughness: 0.4, map: null });
  const mats = [sideMat, sideMat, sideMat, sideMat, front, sideMat];
  matCache.set(p.code, mats);
  front.map = productTexture(p, () => { front.map = cache.get(p.code) ?? front.map; front.needsUpdate = true; });
  return mats;
}

export function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

/** sticker-style sign: white card, thick ink outline, ledge, optional brand-gradient chip */
export function stickerSign(lines: { text: string; size: number; color?: string; font?: string }[], opts: { w?: number; h?: number; brand?: boolean; chip?: string; chipColor?: string } = {}) {
  const W = opts.w ?? 1024, H = opts.h ?? 256;
  return canvasTex(W, H, (ctx) => {
    const r = Math.min(80, H / 2 - 14);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(10, 22, W - 20, H - 32, r); ctx.fill(); // ledge
    if (opts.brand) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#FF4079'); g.addColorStop(1, '#FE831B'); ctx.fillStyle = g; } else ctx.fillStyle = '#fffaf5';
    ctx.strokeStyle = INK; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.roundRect(10, 8, W - 20, H - 32, r); ctx.fill(); ctx.stroke();
    let x = 50;
    if (opts.chip) {
      const cr = (H - 32) * 0.34;
      ctx.fillStyle = opts.chipColor ?? '#FF4079'; ctx.beginPath(); ctx.arc(x + cr, (H - 24) / 2, cr, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 9; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `800 ${cr * 1.1}px "Baloo 2", system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(opts.chip, x + cr, (H - 24) / 2 + 4);
      x += cr * 2 + 30;
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const total = lines.reduce((s, l) => s + l.size * 1.02, 0);
    let y = (H - 24) / 2 - total / 2;
    for (const l of lines) {
      ctx.font = l.font ?? `800 ${l.size}px "Baloo 2", system-ui`;
      ctx.fillStyle = l.color ?? (opts.brand ? '#fff' : INK);
      if (opts.brand && !l.color) { ctx.lineWidth = l.size * 0.16; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.strokeText(l.text, x, y + l.size / 2 + 4); }
      ctx.fillText(l.text, x, y + l.size / 2 + 4);
      y += l.size * 1.02;
    }
  });
}

export function badgeTexture(text: string, bg: string, fg = INK) {
  return canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = fg; ctx.font = '800 58px "Baloo 2", system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 64, 70);
  });
}

export function floorTexture() {
  return canvasTex(256, 256, (ctx) => {
    const a = '#fff7f1', b = '#fbe3da';
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? b : a; ctx.fillRect(i * 128, j * 128, 128, 128); }
    ctx.strokeStyle = 'rgba(20,16,20,0.07)'; ctx.lineWidth = 3;
    for (let k = 0; k <= 256; k += 128) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, 256); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(256, k); ctx.stroke(); }
  }, [1, 1]);
}

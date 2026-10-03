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
  if (p.image && /^https?:|^\/|^data:image\//.test(p.image)) {
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

// ---------- pack atlas: every product's front + its shelf-edge tag on a few big canvases ----------
// One InstancedMesh per (unit, atlas page) can then draw thousands of packs in a single call.
// Each product gets a cell: pack front on top, price tag underneath. Fallback art first (colour + brand),
// the Open Food Facts photo is painted over it when (and if) it loads with CORS.

export interface AtlasCell { idx: number; page: number; front: [number, number, number, number]; tag: [number, number, number, number] }
export type PriceTagInfo = { price?: number | null; assumption?: boolean; role?: string; unit?: string | null };

const PAGE = 2048;
const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** product colour with some brand-driven variety so a run of one category doesn't look like one block */
export function packColor(p: Pick<Product, 'brand' | 'category' | 'code'> & { color?: string }) {
  if (p.color) return p.color;
  const c = new THREE.Color(catColor(p.category));
  const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
  const h = hashStr(p.brand || p.code);
  c.setHSL((hsl.h + ((h % 1000) / 1000 - 0.5) * 0.22 + 1) % 1, Math.min(0.9, hsl.s * (0.75 + ((h >> 10) % 100) / 200)), Math.min(0.72, Math.max(0.28, hsl.l + (((h >> 17) % 100) / 100 - 0.5) * 0.3)));
  return `#${c.getHexString()}`;
}

export class PackAtlas {
  readonly cellW: number; readonly frontH: number; readonly tagH: number; readonly cols: number; readonly rows: number;
  readonly canvases: HTMLCanvasElement[] = [];
  readonly textures: THREE.CanvasTexture[] = [];
  private cells = new Map<string, AtlasCell>();
  private prods = new Map<string, Product>();
  private photo = new Set<string>();
  private dirty = new Set<number>();
  private lastFlush = 0;
  private queue: string[] = [];
  private inflight = 0;
  private dead = false;
  /** per-product average front colour (photo average ignoring the white backdrop, else the pack colour) for the far LOD */
  private avgs = new Map<string, THREE.Color>();
  avgVersion = 0;
  avg(code: string) { return this.avgs.get(code); }

  constructor(n: number) {
    // keep GPU memory sane as the catalogue grows (2,400 SKUs fit in ~5 pages at the smallest size)
    [this.cellW, this.frontH, this.tagH] = n <= 600 ? [112, 140, 46] : n <= 1400 ? [84, 106, 36] : [64, 80, 30];
    this.cols = Math.floor(PAGE / this.cellW); this.rows = Math.floor(PAGE / (this.frontH + this.tagH));
  }

  get size() { return this.cells.size; }
  cell(code: string) { return this.cells.get(code); }

  add(p: Product, tag: PriceTagInfo): AtlasCell {
    const hit = this.cells.get(p.code); if (hit) return hit;
    const idx = this.cells.size, per = this.cols * this.rows;
    const page = Math.floor(idx / per), k = idx % per;
    while (this.canvases.length <= page) {
      const c = document.createElement('canvas'); c.width = PAGE; c.height = PAGE;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
      this.canvases.push(c); this.textures.push(t);
    }
    const x = (k % this.cols) * this.cellW, y = Math.floor(k / this.cols) * (this.frontH + this.tagH);
    const uv = (px: number, py: number, w: number, h: number): [number, number, number, number] =>
      [(px + 1.5) / PAGE, 1 - (py + h - 1.5) / PAGE, (w - 3) / PAGE, (h - 3) / PAGE];
    const cell: AtlasCell = { idx, page, front: uv(x, y, this.cellW, this.frontH), tag: uv(x, y + this.frontH, this.cellW, this.tagH) };
    this.cells.set(p.code, cell); this.prods.set(p.code, p);
    this.avgs.set(p.code, new THREE.Color(packColor(p)));
    const ctx = this.canvases[page].getContext('2d')!;
    this.drawFallback(ctx, p, x, y);
    this.drawTag(ctx, tag, x, y + this.frontH);
    this.dirty.add(page);
    if (p.image && /^https?:|^\//.test(p.image)) this.queue.push(p.code);
    return cell;
  }

  private origin(c: AtlasCell) {
    const per = this.cols * this.rows, k = c.idx % per;
    return { x: (k % this.cols) * this.cellW, y: Math.floor(k / this.cols) * (this.frontH + this.tagH) };
  }

  private drawFallback(ctx: CanvasRenderingContext2D, p: Product, x: number, y: number) {
    const W = this.cellW, H = this.frontH, base = packColor(p);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, W, H); ctx.clip();
    ctx.fillStyle = base; ctx.fillRect(x, y, W, H);
    const g = ctx.createLinearGradient(x, y, x + W, y + H); g.addColorStop(0, 'rgba(255,255,255,0.32)'); g.addColorStop(0.55, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g; ctx.fillRect(x, y, W, H);
    // label window
    const lx = x + W * 0.1, ly = y + H * 0.3, lw = W * 0.8, lh = H * 0.42;
    ctx.fillStyle = '#fffaf5'; ctx.beginPath(); ctx.roundRect(lx, ly, lw, lh, W * 0.08); ctx.fill();
    ctx.lineWidth = Math.max(2, W * 0.03); ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const bs = W * 0.2; ctx.font = `800 ${bs}px "Baloo 2", system-ui, sans-serif`;
    const bl = wrap(ctx, (p.brand || '?').toLowerCase(), lw - 6).slice(0, 2);
    bl.forEach((l, i) => ctx.fillText(l, x + W / 2, ly + lh * 0.3 + i * bs * 0.95, lw - 6));
    ctx.font = `600 ${W * 0.11}px Inter, system-ui, sans-serif`;
    const nl = wrap(ctx, (p.name || '').toLowerCase(), lw - 8).slice(0, 2);
    nl.forEach((l, i) => ctx.fillText(l, x + W / 2, ly + lh * 0.3 + bl.length * bs * 0.95 + i * W * 0.12, lw - 8));
    // cap band (top) in a darker shade, like a lid / crimp
    ctx.fillStyle = 'rgba(20,16,20,0.28)'; ctx.fillRect(x, y, W, H * 0.07);
    ctx.restore();
  }

  private drawTag(ctx: CanvasRenderingContext2D, t: PriceTagInfo, x: number, y: number) {
    const W = this.cellW, H = this.tagH;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, W, H); ctx.clip();
    const promo = t.role === 'challenger';
    ctx.fillStyle = promo ? '#FFE14D' : t.role === 'own_label' ? '#ffe4ec' : '#ffffff'; ctx.fillRect(x, y, W, H);
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, H * 0.08); ctx.strokeRect(x + 1, y + 1, W - 2, H - 2);
    ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const txt = t.price ? `£${Number(t.price).toFixed(2)}` : '£?';
    ctx.font = `800 ${H * 0.62}px "Baloo 2", system-ui, sans-serif`;
    ctx.fillText(txt, x + W * 0.07, y + H * (t.unit ? 0.4 : 0.55), W * 0.8);
    if (t.unit) { ctx.font = `600 ${H * 0.24}px Inter, system-ui, sans-serif`; ctx.fillStyle = '#5b4b56'; ctx.fillText(t.unit, x + W * 0.07, y + H * 0.8, W * 0.62); }
    if (t.assumption) {
      // assumption marker: orange corner chip with "est" (price is a labelled estimate, not a scraped shelf price)
      const r = H * 0.62;
      ctx.fillStyle = '#FE831B'; ctx.beginPath(); ctx.moveTo(x + W, y); ctx.lineTo(x + W, y + r); ctx.lineTo(x + W - r, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = INK; ctx.font = `800 ${H * 0.24}px Inter, system-ui, sans-serif`; ctx.textAlign = 'right';
      ctx.fillText('est', x + W - 3, y + H * 0.82);
    }
    ctx.restore();
  }

  /** repaint fallbacks once webfonts are in (skips cells that already show a photo) */
  redrawFallbacks() {
    for (const [code, c] of this.cells) {
      if (this.photo.has(code)) continue;
      const o = this.origin(c);
      this.drawFallback(this.canvases[c.page].getContext('2d')!, this.prods.get(code)!, o.x, o.y);
      this.dirty.add(c.page);
    }
  }

  /** pump image loads (bounded concurrency) and re-upload dirty pages, throttled. call every frame. */
  tick(now: number) {
    while (!this.dead && this.inflight < 6 && this.queue.length) {
      const code = this.queue.shift()!; const p = this.prods.get(code)!; const c = this.cells.get(code)!;
      const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
      this.inflight++;
      img.onload = () => {
        this.inflight--;
        if (this.dead || !img.naturalWidth) return;
        const o = this.origin(c), ctx = this.canvases[c.page].getContext('2d')!;
        const W = this.cellW, H = this.frontH;
        // cover-fit the photo, trimming a little white border that OFF shots usually have
        const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * 1.08;
        const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
        try {
          ctx.save(); ctx.beginPath(); ctx.rect(o.x, o.y, W, H); ctx.clip();
          ctx.fillStyle = '#fff'; ctx.fillRect(o.x, o.y, W, H);
          ctx.drawImage(img, o.x + (W - dw) / 2, o.y + (H - dh) / 2, dw, dh);
          ctx.restore();
          this.photo.add(code); this.dirty.add(c.page);
          const a = photoAverage(img); if (a) { this.avgs.get(code)?.copy(a); this.avgVersion++; }
        } catch { ctx.restore(); }
      };
      img.onerror = () => { this.inflight--; };
      img.src = p.image as string;
    }
    if (this.dirty.size && now - this.lastFlush > 0.45) {
      for (const pg of this.dirty) this.textures[pg].needsUpdate = true;
      this.dirty.clear(); this.lastFlush = now;
    }
  }

  dispose() { this.dead = true; this.queue.length = 0; this.textures.forEach((t) => t.dispose()); }
}

/** average colour of a pack photo on a tiny canvas, skipping the near-white studio backdrop; saturation nudged up so
 *  a whole shelf of averages still reads as colourful packaging from the overview (not grey) */
let _avgCanvas: HTMLCanvasElement | null = null;
function photoAverage(img: HTMLImageElement): THREE.Color | null {
  try {
    const N = 16; _avgCanvas ??= document.createElement('canvas'); _avgCanvas.width = N; _avgCanvas.height = N;
    const ctx = _avgCanvas.getContext('2d', { willReadFrequently: true })!; ctx.clearRect(0, 0, N, N); ctx.drawImage(img, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data;
    let r = 0, g = 0, b = 0, n = 0, wsat = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      if (mn > 225) continue; // white backdrop
      const w = 0.35 + (mx - mn) / 255; // colourful pixels dominate the average
      r += R * w; g += G * w; b += B * w; n += w; wsat++;
    }
    if (wsat < 8) return null;
    const c = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
    const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
    return c.setHSL(hsl.h, Math.min(0.95, hsl.s * 1.35 + 0.08), Math.min(0.68, Math.max(0.3, hsl.l)));
  } catch { return null; }
}

/** shared uniforms for every pack material: selected product's atlas index + clock */
export const packUniforms = { uSel: { value: -1 }, uTime: { value: 0 } };

/**
 * Standard lit material that reads the pack front from the atlas. Per-instance attributes:
 *  aCell  (vec4) atlas rect for the +z face: u0, v0, su, sv
 *  aTint  (vec4) side colour rgb, w = cold glow (fridge)
 *  aTile  (vec4) x/y: how many packs tile across/up the front (far LOD = whole run in one box),
 *                z: units deep (seam lines on the sides), w: atlas index (selection glow)
 * Geometry attribute aFace = 1 on the face that shows the atlas.
 */
export function packMaterial(map: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uAtlas = { value: map };
    s.uniforms.uSel = packUniforms.uSel; s.uniforms.uTime = packUniforms.uTime;
    const vary = 'varying vec2 vBoxUv; varying vec4 vCell; varying vec4 vTint; varying vec4 vTile; varying float vFace; varying vec3 vLocal; varying float vTop;';
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aCell; attribute vec4 aTint; attribute vec4 aTile; attribute float aFace;\n${vary}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBoxUv = uv; vCell = aCell; vTint = aTint; vTile = aTile; vFace = aFace; vLocal = position; vTop = step(0.5, normal.y);');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uAtlas; uniform float uSel; uniform float uTime;\n${vary}`)
      .replace('#include <map_fragment>', `
        if (vFace > 0.5 && vCell.z < 0.0) {
          // far LOD: no atlas lookup (mipmapping a tiled atlas averages to grey); the product's average colour,
          // with a light label band and pack seams so the run still reads as rows of packs
          vec2 t = fract(vBoxUv * max(vTile.xy, vec2(1.0)));
          vec3 c = vTint.rgb;
          float band = smoothstep(0.3, 0.36, t.y) * (1.0 - smoothstep(0.66, 0.72, t.y));
          c = mix(c, mix(c, vec3(1.0), 0.45), band);
          vec2 e = min(t, 1.0 - t);
          c *= mix(0.72, 1.0, smoothstep(0.0, 0.06, min(e.x, e.y)));
          diffuseColor.rgb *= c;
        } else if (vFace > 0.5) {
          vec2 t = fract(vBoxUv * max(vTile.xy, vec2(1.0)));
          vec4 tx = texture2D(uAtlas, vCell.xy + t * vCell.zw);
          diffuseColor.rgb *= tx.rgb;
          vec2 e = min(t, 1.0 - t);
          if (vTile.x > 1.5 || vTile.y > 1.5) diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 0.035, min(e.x, e.y)));
        } else {
          float top = vTop;
          diffuseColor.rgb *= mix(vTint.rgb, mix(vTint.rgb, vec3(1.0), 0.25), top);
          if (vTile.z > 1.5) { float sz = fract((vLocal.z + 0.5) * vTile.z); diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.07, min(sz, 1.0 - sz))); }
          if (vTile.x > 1.5) { float sx = fract((vLocal.x + 0.5) * vTile.x); diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.05, min(sx, 1.0 - sx)) * (1.0 - top) + top); }
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vTint.w * vec3(0.55, 0.85, 1.0) * 0.16;
        if (uSel >= 0.0 && abs(vTile.w - uSel) < 0.5) totalEmissiveRadiance += vec3(1.0, 0.25, 0.47) * (0.32 + 0.16 * sin(uTime * 5.0));`);
  };
  m.customProgramCacheKey = () => 'pack-atlas-v2';
  return m;
}

/** unit box with aFace = 1 on +z (the shelf-facing front) */
export function packBoxGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const n = g.attributes.position.count, f = new Float32Array(n);
  for (let i = 16; i < 20; i++) f[i] = 1; // BoxGeometry face order px, nx, py, ny, pz, nz (4 verts each)
  g.setAttribute('aFace', new THREE.BufferAttribute(f, 1));
  return g;
}
/** plane (faces +z) with aFace = 1 everywhere, for shelf-edge tags */
export function tagPlaneGeometry() {
  const g = new THREE.PlaneGeometry(1, 1);
  g.setAttribute('aFace', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  return g;
}

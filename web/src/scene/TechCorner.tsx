// Tech & entertainment corner + seasonal decor for the big stores, drawn from storePlan(cfg).tech (techFloor.ts):
// a wall of TVs with animated "channels" (nature, a football match, colour bars, a simsbury promo), glass display cases
// with phones / tablets / headphones / watches / consoles, laptop tables with glowing screens, big promo standees,
// a seasonal row (pumpkins, flowers, a toy bay end), lobby displays, balloons and bunting over the cross aisles.
// Perf: every static part is merged (storeKit, ~5 draw calls), all screens (TVs, laptops, phones…) are ONE mesh that
// samples ONE small canvas atlas redrawn at 8 fps without mipmaps, labels share two atlases (stickers, standee boards), bunting is one mesh,
// balloons one InstancedMesh, one useFrame. Decor only: nothing here feeds a stat. No real brands.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { StoreConfig } from '../types';
import { storePlan } from '../layout';
import type { TechFloor } from '../techFloor';
import { INK } from '../theme';
import { Kit, LabelAtlas, QuadBatch, disposeGroup } from './storeKit';
import { drawSticker } from './Departments';

const noRay = () => null;
type UV = [number, number, number, number];
const M = (x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0) => Kit.m(x, y, z, rotY, 1, 1, 1, rotX, rotZ);
const L = (base: THREE.Matrix4, x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0) => base.clone().multiply(M(x, y, z, rotY, rotX, rotZ));

// ---------------------------------------------------------------- the screen atlas: 4 channels, 2 x 2 cells
const CW = 512, CH = 288, AW = CW * 2, AH = CH * 2;
const CH_NATURE = 0, CH_FOOTBALL = 1, CH_BARS = 2, CH_PROMO = 3;
/** uv rect of a channel cell, optionally a sub-rect (fractions of the cell, top-down) */
function cellUV(ch: number, fx0 = 0, fy0 = 0, fx1 = 1, fy1 = 1): UV {
  const cx = (ch % 2) * CW, cy = Math.floor(ch / 2) * CH;
  return [(cx + fx0 * CW) / AW, 1 - (cy + fy1 * CH) / AH, (cx + fx1 * CW) / AW, 1 - (cy + fy0 * CH) / AH];
}
/** a slice of a channel with a given aspect (w/h), at a pseudo-random horizontal offset */
function sliceUV(ch: number, aspect: number, seed: number): UV {
  const fw = Math.min(1, (aspect * CH) / CW);
  const f0 = (((seed * 0.6180339) % 1) + 1) % 1 * (1 - fw);
  return cellUV(ch, f0, 0, f0 + fw, 1);
}

const PROMO_LINES = ['tech week', 'up to 30% off TVs', 'new phones in store', 'game on', 'spooky season'];
function drawChannels(ctx: CanvasRenderingContext2D, t: number) {
  // -- nature: sky, sun, mountains, hills, lake shimmer, drifting clouds + birds
  ctx.save(); ctx.translate(0, 0); ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();
  let g = ctx.createLinearGradient(0, 0, 0, CH); g.addColorStop(0, '#4fa8ff'); g.addColorStop(0.55, '#bfe6ff'); g.addColorStop(1, '#e8f7ff');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#fff3a8'; ctx.beginPath(); ctx.arc(400, 70 + Math.sin(t * 0.2) * 4, 32, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7d8fb8'; ctx.beginPath(); ctx.moveTo(0, 190); ctx.lineTo(90, 90); ctx.lineTo(170, 170); ctx.lineTo(260, 70); ctx.lineTo(370, 180); ctx.lineTo(450, 120); ctx.lineTo(512, 170); ctx.lineTo(512, 288); ctx.lineTo(0, 288); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(240, 92); ctx.lineTo(260, 70); ctx.lineTo(282, 95); ctx.lineTo(268, 90); ctx.lineTo(258, 98); ctx.fill();
  ctx.fillStyle = '#5cbf5a'; ctx.beginPath(); ctx.ellipse(130, 250, 260, 70, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3fa548'; ctx.beginPath(); ctx.ellipse(430, 260, 220, 60, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5aa9e6'; ctx.fillRect(0, 250, CW, 38);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
  for (let i = 0; i < 9; i++) { const x = ((i * 67 + t * 30) % (CW + 60)) - 30; ctx.beginPath(); ctx.moveTo(x, 258 + (i % 3) * 9); ctx.lineTo(x + 26, 258 + (i % 3) * 9); ctx.stroke(); }
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) { const x = ((i * 150 + t * 14) % (CW + 160)) - 80, y = 36 + (i % 2) * 34; ctx.beginPath(); ctx.ellipse(x, y, 42, 14, 0, 0, Math.PI * 2); ctx.ellipse(x + 26, y - 8, 26, 14, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 2.5;
  for (let i = 0; i < 3; i++) { const x = ((t * 40 + i * 30) % (CW + 80)) - 40, y = 110 + i * 10 + Math.sin(t * 3 + i) * 4, w = Math.sin(t * 8 + i) * 4; ctx.beginPath(); ctx.moveTo(x - 7, y - w); ctx.lineTo(x, y); ctx.lineTo(x + 7, y - w); ctx.stroke(); }
  ctx.restore();

  // -- football: mown stripes, lines, two teams chasing the ball, score bug
  ctx.save(); ctx.translate(CW, 0); ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();
  for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#2f9a3e' : '#38ad47'; ctx.fillRect(i * CW / 10, 0, CW / 10 + 1, CH); }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, CW - 28, CH - 28); ctx.beginPath(); ctx.moveTo(CW / 2, 14); ctx.lineTo(CW / 2, CH - 14); ctx.stroke();
  ctx.beginPath(); ctx.arc(CW / 2, CH / 2, 40, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(14, CH / 2 - 60, 60, 120); ctx.strokeRect(CW - 74, CH / 2 - 60, 60, 120);
  const bx = CW / 2 + Math.sin(t * 0.7) * 190, by = CH / 2 + Math.sin(t * 1.3) * 90;
  for (let i = 0; i < 12; i++) {
    const team = i % 2, hx = (team ? 0.62 : 0.38) * CW + ((i >> 1) % 3 - 1) * 70, hy = (((i >> 1) % 4) + 0.5) * CH / 4;
    const k = 0.35 + ((i * 37) % 10) / 40;
    const x = hx + (bx - hx) * k + Math.sin(t * 1.7 + i) * 8, y = hy + (by - hy) * k + Math.cos(t * 1.5 + i) * 8;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, y + 2, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = team ? '#2b6cff' : '#ff3b4f'; ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(20,16,20,0.85)'; ctx.beginPath(); ctx.roundRect(20, 20, 190, 34, 8); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '800 20px Inter, system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  const mins = 23 + Math.floor(t / 4) % 60;
  ctx.fillText(`SIM 2 - 1 BRY  ${mins}'`, 30, 38);
  ctx.restore();

  // -- colour bars with a scrolling ticker
  ctx.save(); ctx.translate(0, CH); ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();
  const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  BARS.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * CW / 7, 0, CW / 7 + 1, CH * 0.66); });
  const LOW = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
  LOW.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * CW / 7, CH * 0.66, CW / 7 + 1, CH * 0.09); });
  ctx.fillStyle = '#101018'; ctx.fillRect(0, CH * 0.75, CW, CH * 0.25);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, ((t * 60) % (CH * 0.7)), CW, 10);
  ctx.fillStyle = '#ffd60a'; ctx.font = '800 26px Inter, system-ui'; ctx.textBaseline = 'middle';
  const tick = 'simsbury tv  ·  prices you can see  ·  now showing in aisle T  ·  ';
  const tw = ctx.measureText(tick).width, off = (t * 70) % tw;
  ctx.fillText(tick + tick, -off, CH * 0.875);
  ctx.restore();

  // -- simsbury promo: brand gradient, turning sunburst, the wordmark, cycling offers, confetti
  ctx.save(); ctx.translate(CW, CH); ctx.beginPath(); ctx.rect(0, 0, CW, CH); ctx.clip();
  g = ctx.createLinearGradient(0, 0, CW, CH); g.addColorStop(0, '#FF4079'); g.addColorStop(1, '#FE831B');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  ctx.save(); ctx.translate(CW / 2, CH / 2); ctx.rotate(t * 0.25); ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(400, -50); ctx.lineTo(400, 50); ctx.fill(); }
  ctx.restore();
  const pulse = 1 + Math.sin(t * 3) * 0.04;
  ctx.save(); ctx.translate(CW / 2, CH * 0.42); ctx.scale(pulse, pulse);
  ctx.font = '800 92px "Baloo 2", system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.lineWidth = 14; ctx.strokeStyle = INK; ctx.strokeText('simsbury', 0, 0); ctx.fillStyle = '#fff'; ctx.fillText('simsbury', 0, 0);
  ctx.restore();
  const line = PROMO_LINES[Math.floor(t / 2.5) % PROMO_LINES.length];
  ctx.font = '800 34px Inter, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lw = ctx.measureText(line).width + 40;
  ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(CW / 2 - lw / 2, CH * 0.7, lw, 52, 26); ctx.fill();
  ctx.fillStyle = '#ffd60a'; ctx.fillText(line, CW / 2, CH * 0.7 + 27);
  const CONF = ['#ffd60a', '#ffffff', '#2ba8ff', '#34c759'];
  for (let i = 0; i < 18; i++) { ctx.fillStyle = CONF[i % 4]; const x = (i * 97) % CW, y = ((i * 53 + t * 50) % (CH + 20)) - 10; ctx.fillRect(x, y, 7, 12); }
  ctx.restore();
}

// ---------------------------------------------------------------- label atlas: standees, sign, case headers
const STANDEES: { title: string; sub: string; bg: [string, string]; icon: 'pad' | 'tv' | 'pumpkin' | 'phone' }[] = [
  { title: 'TECH WEEK', sub: 'up to 30% off TVs', bg: ['#FF4079', '#FE831B'], icon: 'tv' },
  { title: 'GAME ON', sub: 'new consoles in store', bg: ['#6d28d9', '#2b6cff'], icon: 'pad' },
  { title: 'SPOOKY SEASON', sub: 'costumes · sweets · décor', bg: ['#2a1a3a', '#ff7a1a'], icon: 'pumpkin' },
  { title: 'NEW PHONES', sub: 'trade in & save', bg: ['#00a3a3', '#34c759'], icon: 'phone' },
];
function drawStandee(ctx: CanvasRenderingContext2D, W: number, H: number, s: (typeof STANDEES)[number]) {
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, s.bg[0]); g.addColorStop(1, s.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = INK; ctx.lineWidth = 12; ctx.strokeRect(6, 6, W - 12, H - 12);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const words = s.title.split(' ');
  words.forEach((w, i) => {
    let fs = 64; ctx.font = `800 ${fs}px "Baloo 2", system-ui`;
    while (ctx.measureText(w).width > W - 40 && fs > 20) { fs -= 2; ctx.font = `800 ${fs}px "Baloo 2", system-ui`; }
    ctx.lineWidth = 10; ctx.strokeStyle = INK; ctx.strokeText(w, W / 2, 70 + i * 62); ctx.fillStyle = '#fff'; ctx.fillText(w, W / 2, 70 + i * 62);
  });
  // icon
  const cx = W / 2, cy = H * 0.55;
  ctx.lineWidth = 8; ctx.strokeStyle = INK;
  if (s.icon === 'tv') { ctx.fillStyle = '#1d1a2b'; ctx.beginPath(); ctx.roundRect(cx - 80, cy - 50, 160, 96, 10); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#5ac8fa'; ctx.fillRect(cx - 68, cy - 38, 136, 72); ctx.fillStyle = INK; ctx.fillRect(cx - 30, cy + 50, 60, 10); }
  if (s.icon === 'pad') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(cx - 85, cy - 35, 170, 75, 36); ctx.fill(); ctx.stroke(); ctx.fillStyle = INK; ctx.fillRect(cx - 58, cy - 6, 36, 10); ctx.fillRect(cx - 45, cy - 19, 10, 36); ctx.fillStyle = '#ff3b4f'; ctx.beginPath(); ctx.arc(cx + 40, cy - 8, 9, 0, 7); ctx.fill(); ctx.fillStyle = '#34c759'; ctx.beginPath(); ctx.arc(cx + 58, cy + 10, 9, 0, 7); ctx.fill(); }
  if (s.icon === 'pumpkin') { ctx.fillStyle = '#ff8a1f'; ctx.beginPath(); ctx.ellipse(cx, cy, 80, 60, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#3a7d2a'; ctx.fillRect(cx - 7, cy - 78, 14, 22); ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(cx - 40, cy - 15); ctx.lineTo(cx - 20, cy - 15); ctx.lineTo(cx - 30, cy - 32); ctx.fill(); ctx.beginPath(); ctx.moveTo(cx + 40, cy - 15); ctx.lineTo(cx + 20, cy - 15); ctx.lineTo(cx + 30, cy - 32); ctx.fill(); ctx.beginPath(); ctx.arc(cx, cy + 12, 34, 0, Math.PI); ctx.fill(); }
  if (s.icon === 'phone') { ctx.fillStyle = '#1d1a2b'; ctx.beginPath(); ctx.roundRect(cx - 45, cy - 80, 90, 160, 16); ctx.fill(); ctx.stroke(); const g2 = ctx.createLinearGradient(0, cy - 70, 0, cy + 70); g2.addColorStop(0, '#ff4f9a'); g2.addColorStop(1, '#ffd23f'); ctx.fillStyle = g2; ctx.fillRect(cx - 36, cy - 68, 72, 136); }
  // sub line in an ink pill
  ctx.font = '800 26px Inter, system-ui';
  let fs = 26; while (ctx.measureText(s.sub).width > W - 50 && fs > 12) { fs -= 1; ctx.font = `800 ${fs}px Inter, system-ui`; }
  ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(18, H - 130, W - 36, 56, 28); ctx.fill();
  ctx.fillStyle = '#ffd60a'; ctx.fillText(s.sub, W / 2, H - 101);
  ctx.fillStyle = '#fff'; ctx.font = '800 30px "Baloo 2", system-ui'; ctx.fillText('simsbury', W / 2, H - 40);
}

const DEV_LABEL: Record<string, string> = { phones: 'phones', tablets: 'tablets', headphones: 'headphones', watches: 'smartwatches', consoles: 'gaming' };
const DEC_LABEL: Record<string, string> = { seasonal: 'spooky season', flowers: 'flowers', toys: 'toys & games' };

// ---------------------------------------------------------------- static build
const BODY = ['#1d1a2b', '#f2f2f6', '#ff6fa8', '#5ac8fa', '#34c759', '#b8a7ff'];
const PUMPKIN = ['#ff8a1f', '#ff7a12', '#ffa040', '#f56f00'];
const PETALS = ['#ff4f9a', '#ffd23f', '#ff7a45', '#c86bfa', '#ffffff', '#ff2d55'];
const TOYS = ['#ff3b30', '#ffcc00', '#34c759', '#2ba8ff', '#ff6fa8', '#9b59b6', '#ff9500'];
export const BALLOON = ['#ff4079', '#ffd60a', '#2ba8ff', '#34c759', '#ff9500', '#9b5de5', '#ffffff'];

interface Built { group: THREE.Group; screens: THREE.BufferGeometry; labels: THREE.BufferGeometry; labelTex: THREE.CanvasTexture; boards: THREE.BufferGeometry; boardTex: THREE.CanvasTexture; bunting: THREE.BufferGeometry | null; balloons: { x: number; y: number; z: number; c: string }[] }

function build(T: TechFloor): Built {
  const k = new Kit();
  const scr = new QuadBatch();
  const lab = new QuadBatch();
  const labT = new QuadBatch(); // standee faces (tall atlas)
  const atlas = new LabelAtlas(512, 128, 24, 2048);
  const tall = new LabelAtlas(256, 512, 8, 2048);
  const balloons: Built['balloons'] = [];
  const cluster = (x: number, y: number, z: number, n: number, seed: number, spread = 0.32) => {
    for (let i = 0; i < n; i++) {
      const a = seed * 2.1 + (i / n) * Math.PI * 2, r = i === 0 ? 0 : spread;
      const bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r * 0.7, by = y + 0.55 + (i % 2) * 0.22 + (i === 0 ? 0.3 : 0);
      balloons.push({ x: bx, y: by, z: bz, c: BALLOON[(seed * 3 + i) % BALLOON.length] });
      k.line(x, y, z, bx, by - 0.2, bz);
    }
  };
  // labels drawn once; uv rects reused for both faces
  const stickerUV = new Map<string, UV>();
  const sticker = (text: string, brand = false) => {
    const key = `${brand}|${text}`;
    let r = stickerUV.get(key);
    if (!r) { r = atlas.add((c, w, h) => drawSticker(c, w, h, text, null, { brand })); stickerUV.set(key, r); }
    return r;
  };
  const standeeUV = STANDEES.map((s) => tall.add((c, w, h) => drawStandee(c, w, h, s)));
  /** card on both faces of a thin board (local +z and -z) */
  const twoFaced = (m: THREE.Matrix4, w: number, h: number, half: number, r: UV, batch = lab) => {
    batch.add(L(m, 0, 0, half), w, h, r);
    batch.add(L(m, 0, 0, -half, Math.PI), w, h, r);
  };

  // ---- floor tint + border
  if (T.zone) {
    const z = T.zone;
    // thin matte slabs (not Kit.floor: its plane scale keeps z depth at 1 m)
    const slab = (x0: number, z0: number, x1: number, z1: number, y: number, c: string) => k.boxAt((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, 0.004, z1 - z0, c, { bucket: 'matte' });
    slab(z.x0, z.z0, z.x1, z.z1, 0.01, '#d9dcf6');
    const e = 0.1;
    slab(z.x0, z.z1 - e, z.x1, z.z1, 0.016, '#6d6fe0'); slab(z.x1 - e, z.z0, z.x1, z.z1, 0.016, '#6d6fe0');
    slab(z.x0, z.z0, z.x0 + e, z.z1, 0.016, '#6d6fe0');
  }

  // ---- wall of TVs + media console
  if (T.tvWall) {
    const W = T.tvWall, pitch = W.tvW + W.gap, x0 = W.x - (W.cols * pitch) / 2 + pitch / 2;
    const vc = W.cols / 2 - 1; // centre 2 x 2 block = one big promo picture
    for (let r = 0; r < W.rows; r++) for (let c = 0; c < W.cols; c++) {
      const x = x0 + c * pitch, y = W.y0 + r * (W.tvH + W.gap * 1.2);
      k.boxAt(x, y, W.z + 0.035, W.tvW + 0.06, W.tvH + 0.06, 0.05, '#15131c', { ink: true });
      let uv: UV;
      if (W.rows >= 2 && r < 2 && (c === vc || c === vc + 1)) uv = cellUV(CH_PROMO, (c - vc) * 0.5, (1 - r) * 0.5, (c - vc) * 0.5 + 0.5, (1 - r) * 0.5 + 0.5);
      else uv = cellUV([CH_NATURE, CH_FOOTBALL, CH_BARS, CH_NATURE, CH_FOOTBALL][(c + r * 2) % 5]);
      scr.add(M(x, y, W.z + 0.062), W.tvW, W.tvH, uv);
    }
    const cw = W.cols * pitch + 0.2;
    k.boxAt(W.x, 0.3, W.z + 0.3, cw, 0.6, 0.6, '#fbf7fb', { ink: true });
    k.boxAt(W.x, 0.61, W.z + 0.3, cw + 0.04, 0.03, 0.64, '#1d1a2b');
    k.boxAt(W.x, 0.04, W.z + 0.3, cw, 0.08, 0.62, '#6d6fe0');
    for (let i = 0; i < W.cols; i++) {
      const x = x0 + i * pitch;
      if (i % 2 === 0) k.boxAt(x, 0.665, W.z + 0.35, 0.9, 0.08, 0.12, '#24212f'); // soundbar
      else { k.boxAt(x - 0.25, 0.79, W.z + 0.35, 0.2, 0.33, 0.2, '#24212f'); k.cyl(0.06, 0.012, M(x - 0.25, 0.82, W.z + 0.456, 0, Math.PI / 2), '#555a6a', 'metal'); k.boxAt(x + 0.25, 0.79, W.z + 0.35, 0.2, 0.33, 0.2, '#24212f'); }
    }
    // price stickers along the console front
    for (let i = 0; i < W.cols; i += 2) lab.add(M(x0 + i * pitch + pitch / 2, 0.32, W.z + 0.605), 0.7, 0.175, sticker(['TVs from £199', '4K · big screens', 'soundbars', 'smart TVs'][(i / 2) % 4], i % 4 === 0));
  }

  // ---- glass display cases
  T.cases.forEach((cs, ci) => {
    const { x, z, w, d } = cs;
    k.boxAt(x, 0.43, z, w, 0.86, d, '#fbf7fb', { ink: true });
    k.boxAt(x, 0.05, z, w + 0.02, 0.1, d + 0.02, '#6d6fe0');
    k.boxAt(x, 0.87, z, w - 0.04, 0.02, d - 0.04, '#2a2440');
    k.boxAt(x, 1.08, z, w, 0.4, d, '#dff4ff', { bucket: 'glass', ink: true });
    for (const s of [-1, 1]) k.boxAt(x, 1.285, z + s * (d / 2 - 0.01), w, 0.02, 0.02, '#c9cfdc', { bucket: 'metal' });
    // header cards on both long sides
    twoFaced(M(x, 0.62, z), 1.2, 0.3, d / 2 + 0.006, sticker(DEV_LABEL[cs.kind], ci % 2 === 0));
    const y = 0.88;
    for (const side of [1, -1]) {
      const rz = z + side * d * 0.2, face = side > 0 ? 0 : Math.PI;
      if (cs.kind === 'phones' || cs.kind === 'watches') {
        const n = cs.kind === 'phones' ? 6 : 7;
        for (let i = 0; i < n; i++) {
          const px = x - w / 2 + 0.2 + (i + 0.5) * ((w - 0.4) / n);
          const base = L(M(px, y, rz, face), 0, 0, 0);
          if (cs.kind === 'phones') {
            k.box(0.06, 0.02, 0.06, L(base, 0, 0.01, -0.02), '#c9cfdc', { bucket: 'metal' });
            const pm = L(base, 0, 0.1, 0, 0, -0.32);
            k.box(0.08, 0.165, 0.012, pm, BODY[(i + ci) % BODY.length], { ink: true });
            scr.add(L(pm, 0, 0, 0.0065), 0.07, 0.148, sliceUV([CH_PROMO, CH_NATURE, CH_FOOTBALL][(i + ci) % 3], 0.07 / 0.148, i + ci * 7));
          } else {
            k.cyl(0.035, 0.07, L(base, 0, 0.035, 0), '#f6f2f8');
            k.cyl(0.037, 0.024, L(base, 0, 0.045, 0, 0, 0, Math.PI / 2), BODY[(i + 2 + ci) % BODY.length]);
            const wm = L(base, 0, 0.085, 0.012, 0, -0.5);
            k.box(0.046, 0.054, 0.014, wm, '#1d1a2b', { ink: true });
            scr.add(L(wm, 0, 0, 0.0075), 0.04, 0.046, sliceUV([CH_PROMO, CH_NATURE][i % 2], 0.87, i * 3 + ci));
          }
        }
      } else if (cs.kind === 'tablets') {
        for (let i = 0; i < 4; i++) {
          const px = x - w / 2 + 0.2 + (i + 0.5) * ((w - 0.4) / 4);
          const base = M(px, y, rz, face);
          k.box(0.12, 0.02, 0.08, L(base, 0, 0.01, -0.03), '#c9cfdc', { bucket: 'metal' });
          const tm = L(base, 0, 0.1, 0, 0, -0.38);
          k.box(0.3, 0.2, 0.012, tm, i % 2 ? '#d9dbe3' : '#2a2733', { ink: true });
          scr.add(L(tm, 0, 0, 0.0065), 0.27, 0.18, sliceUV([CH_NATURE, CH_PROMO, CH_FOOTBALL, CH_BARS][(i + ci) % 4], 1.5, i + ci));
        }
      } else if (cs.kind === 'headphones') {
        for (let i = 0; i < 4; i++) {
          const px = x - w / 2 + 0.2 + (i + 0.5) * ((w - 0.4) / 4);
          const base = M(px, y, rz, face), col = ['#1d1a2b', '#f2f2f6', '#ff3b4f', '#00a3a3'][(i + ci) % 4];
          k.box(0.08, 0.015, 0.08, L(base, 0, 0.008, 0), '#c9cfdc', { bucket: 'metal' });
          k.cyl(0.008, 0.2, L(base, 0, 0.11, 0), '#c9cfdc', 'metal');
          // headband: 5 segments on an arc over the stand top
          for (let s = 0; s < 5; s++) {
            const a = (-0.5 + s / 4) * 2.2, R = 0.085;
            k.box(0.045, 0.016, 0.035, L(base, Math.sin(a) * R, 0.2 + Math.cos(a) * R, 0, 0, 0, -a), col);
          }
          for (const sx of [-1, 1]) k.cyl(0.048, 0.04, L(base, sx * 0.1, 0.17, 0, 0, 0, Math.PI / 2), col);
        }
      } else {
        // consoles: a console + controller pair, plus game boxes
        for (let i = 0; i < 2; i++) {
          const px = x - w / 2 + 0.45 + i * 0.85;
          const base = M(px, y, rz, face), col = i ? '#f2f2f6' : '#1d1a2b';
          k.box(0.34, 0.07, 0.24, L(base, 0, 0.035, -0.02), col, { ink: true });
          k.box(0.3, 0.008, 0.005, L(base, 0, 0.05, 0.1), i ? '#2ba8ff' : '#ff3b4f', { bucket: 'glow' });
          const cm = L(base, 0.26, 0.02, 0.05, 0.4);
          k.box(0.12, 0.03, 0.06, cm, col, { ink: true });
          for (const sx of [-1, 1]) k.sphere(0.03, L(cm, sx * 0.06, -0.005, 0.02), col);
        }
        for (let i = 0; i < 4; i++) k.box(0.13, 0.17, 0.015, L(M(x + w / 2 - 0.55 + i * 0.12, y, rz, face), 0, 0.085, 0, 0, -0.12), TOYS[(i + ci) % TOYS.length], { ink: true });
      }
    }
  });

  // ---- laptop tables
  T.laptops.forEach((lt, li) => {
    const { x, z, w, d } = lt;
    k.boxAt(x, 0.86, z, w, 0.05, d, '#e9dccb', { ink: true });
    k.boxAt(x, 0.83, z, w - 0.1, 0.02, d - 0.1, '#6d6fe0');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.boxAt(x + sx * (w / 2 - 0.08), 0.42, z + sz * (d / 2 - 0.08), 0.06, 0.84, 0.06, '#c9cfdc', { bucket: 'metal' });
    k.boxAt(x, 0.25, z, w - 0.2, 0.03, d - 0.2, '#c9cfdc', { bucket: 'metal' });
    twoFaced(M(x, 0.62, z), 1.1, 0.27, d / 2 - 0.07, sticker(li % 2 ? 'laptops · try me' : 'laptops', li % 2 === 1));
    for (const side of [1, -1]) for (let i = 0; i < 3; i++) {
      const px = x + (i - 1) * 0.75, base = M(px, 0.885, z + side * d * 0.22, side > 0 ? 0 : Math.PI);
      const col = ['#c9cfdc', '#2a2733', '#e8c9d6'][(i + li + (side > 0 ? 0 : 1)) % 3];
      k.box(0.36, 0.018, 0.25, L(base, 0, 0.009, 0), col, { bucket: 'metal', ink: true });
      k.box(0.3, 0.002, 0.1, L(base, 0, 0.019, -0.03), '#24212f');
      const lid = L(base, 0, 0.018 + 0.118, -0.125 - 0.03, 0, -0.26);
      k.box(0.36, 0.235, 0.012, lid, col, { bucket: 'metal', ink: true });
      scr.add(L(lid, 0, 0.004, 0.0065), 0.32, 0.2, sliceUV([CH_NATURE, CH_PROMO, CH_FOOTBALL, CH_BARS][(i * 2 + li + (side > 0 ? 0 : 1)) % 4], 1.6, i + li * 3 + (side > 0 ? 0 : 11)));
    }
  });

  // ---- promo standees (+ balloons on top)
  T.standees.forEach((s, i) => {
    const m = M(s.x, 0, s.z, s.rot);
    k.box(1.15, 0.06, 0.5, L(m, 0, 0.03, 0), '#1d1a2b', { ink: true });
    k.box(0.08, 0.3, 0.3, L(m, 0, 0.2, -0.12), '#1d1a2b');
    k.box(1.04, 2.08, 0.04, L(m, 0, 1.12, 0), '#ffffff', { ink: true });
    twoFaced(L(m, 0, 1.12, 0), 1.0, 2.0, 0.022, standeeUV[s.face % standeeUV.length], labT);
    cluster(s.x - 0.45, 2.16, s.z, 3, i + 1, 0.18);
    cluster(s.x + 0.45, 2.16, s.z, 3, i + 4, 0.18);
  });

  // ---- seasonal row + lobby displays
  T.decor.forEach((dc, di) => {
    const { x, z, w, d } = dc;
    if (dc.kind === 'seasonal') {
      for (let t = 0; t < 3; t++) {
        const tw = w - t * 0.55, td = d - t * 0.45, ty = 0.15 + t * 0.3;
        k.boxAt(x, ty, z, tw, 0.3, td, t % 2 ? '#2a1a3a' : '#b9804a', { ink: true });
        const n = Math.max(2, Math.floor(tw / 0.34)), rowsZ = t === 2 ? [0] : [-td / 2 + 0.18, td / 2 - 0.18];
        for (const oz of rowsZ) for (let i = 0; i < n; i++) {
          const px = x - tw / 2 + (i + 0.5) * (tw / n), r = 0.12 + ((i * 7 + t + di) % 3) * 0.02;
          k.sphere(r, Kit.m(px, ty + 0.15 + r * 0.8, z + oz, 0, 1, 0.8, 1), PUMPKIN[(i + t + di) % PUMPKIN.length]);
          k.cyl(0.015, 0.06, M(px, ty + 0.15 + r * 1.6 + 0.02, z + oz), '#3a7d2a');
        }
      }
      // sign on a pole + a big balloon bunch
      k.cyl(0.02, 1.2, M(x, 1.25, z), '#c9cfdc', 'metal');
      twoFaced(M(x, 1.95, z), 1.3, 0.33, 0.012, sticker(DEC_LABEL.seasonal, true));
      k.boxAt(x, 1.95, z, 1.32, 0.34, 0.02, '#1d1a2b');
      cluster(x - w / 2 + 0.2, 0.9, z, 4, di * 3 + 2, 0.25);
      cluster(x + w / 2 - 0.2, 0.9, z, 4, di * 3 + 5, 0.25);
    } else if (dc.kind === 'flowers') {
      for (let t = 0; t < 3; t++) {
        const tz = z - d / 2 + 0.27 + t * 0.53, ty = 0.2 + t * 0.22;
        k.boxAt(x, ty / 2, tz, w, ty, 0.5, '#2f6b3a', { ink: true });
        for (let i = 0; i < 4; i++) {
          const bx = x - w / 2 + 0.22 + i * ((w - 0.44) / 3);
          k.cyl(0.13, 0.32, M(bx, ty + 0.16, tz), '#5ac8fa', 'metal');
          for (let f = 0; f < 5; f++) {
            const a = f * 1.26 + i, fr = f === 0 ? 0 : 0.08;
            k.sphere(0.065, M(bx + Math.cos(a) * fr, ty + 0.5 + (f % 2) * 0.05, tz + Math.sin(a) * fr), PETALS[(i + t * 2 + f) % PETALS.length]);
          }
          k.sphere(0.12, M(bx, ty + 0.38, tz), '#4caf50');
        }
      }
      k.cyl(0.02, 1.0, M(x + w / 2 - 0.1, 1.2, z - d / 2 + 0.1), '#c9cfdc', 'metal');
      twoFaced(M(x + w / 2 - 0.1, 1.8, z - d / 2 + 0.1), 1.1, 0.28, 0.012, sticker(DEC_LABEL.flowers));
      k.boxAt(x + w / 2 - 0.1, 1.8, z - d / 2 + 0.1, 1.12, 0.29, 0.02, '#1d1a2b');
    } else {
      // toy bay end: back-to-back shelves stacked with boxes, balls and a teddy on top
      k.boxAt(x, 0.85, z, w, 1.7, 0.08, '#fbf7fb', { ink: true });
      k.boxAt(x, 0.05, z, w, 0.1, d, '#ff4079', { ink: true });
      for (const side of [1, -1]) for (let s = 0; s < 4; s++) {
        const sy = 0.12 + s * 0.4, sz = z + side * (d / 4 + 0.02);
        k.boxAt(x, sy, sz, w - 0.04, 0.03, d / 2 - 0.06, '#e6e0ea');
        for (let i = 0; i < 6; i++) {
          const px = x - w / 2 + 0.17 + i * ((w - 0.34) / 5), col = TOYS[(i + s * 2 + (side > 0 ? 0 : 3)) % TOYS.length];
          if ((i + s) % 3 === 0) k.sphere(0.1, M(px, sy + 0.115, sz), col);
          else k.boxAt(px, sy + 0.015 + 0.13, sz, 0.22, 0.26, 0.28, col, { ink: true });
        }
      }
      k.boxAt(x, 1.75, z, w + 0.04, 0.1, 0.12, '#ffd60a', { ink: true });
      twoFaced(M(x, 2.0, z), 1.4, 0.35, 0.03, sticker(DEC_LABEL.toys, true));
      k.boxAt(x, 2.0, z, 1.42, 0.36, 0.05, '#1d1a2b');
      // teddy
      const tx = x + w / 2 - 0.3;
      k.sphere(0.13, M(tx, 1.93, z), '#b07a4a'); k.sphere(0.09, M(tx, 2.11, z), '#b07a4a');
      for (const s of [-1, 1]) k.sphere(0.035, M(tx + s * 0.065, 2.19, z), '#8a5a33');
      cluster(x - w / 2 + 0.15, 1.8, z, 3, di + 9, 0.15);
    }
  });

  // ---- hanging sign over the tech corner
  if (T.sign) {
    const { x, z } = T.sign;
    const r = sticker('tech & entertainment', true);
    k.boxAt(x, 3.6, z, 4.06, 0.86, 0.04, '#1d1a2b');
    twoFaced(M(x, 3.6, z), 4.0, 1.0, 0.024, r);
    for (const sx of [-1, 1]) k.line(x + sx * 1.8, 4.03, z, x + sx * 1.8, 5.2, z);
  }

  // ---- bunting: pennants on a sagging string, one mesh
  let bunting: THREE.BufferGeometry | null = null;
  if (T.bunting.length) {
    const pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    const SPAN = 9, Y = 3.55, SAG = 0.3;
    let pen = 0;
    for (const bl of T.bunting) {
      const n = Math.max(1, Math.round((bl.bx - bl.ax) / SPAN)), span = (bl.bx - bl.ax) / n;
      const yAt = (x: number) => { const f = ((x - bl.ax) / span) % 1; return Y - SAG * Math.sin(Math.PI * f); };
      for (let s = 0; s < n; s++) {
        const xa = bl.ax + s * span;
        for (let i = 0; i < 12; i++) { const p = xa + (i / 12) * span, q = xa + ((i + 1) / 12) * span; k.line(p, yAt(p), bl.z, q, yAt(Math.min(q, xa + span - 1e-3)), bl.z); }
        for (let p = xa + 0.3; p < xa + span - 0.3; p += 0.55) {
          const y0 = yAt(p - 0.14), y1 = yAt(p + 0.14);
          pos.push(p - 0.14, y0, bl.z, p + 0.14, y1, bl.z, p, (y0 + y1) / 2 - 0.34, bl.z);
          c.set(BALLOON[pen++ % (BALLOON.length - 1)]); // no white pennants
          for (let v = 0; v < 3; v++) col.push(c.r, c.g, c.b);
        }
      }
    }
    bunting = new THREE.BufferGeometry();
    bunting.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bunting.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    bunting.computeBoundingSphere();
  }

  const tex = (a: LabelAtlas) => { const t = a.texture(); t.anisotropy = 4; return t; };
  return { group: k.build(), screens: scr.geometry(), labels: lab.geometry(), labelTex: tex(atlas), boards: labT.geometry(), boardTex: tex(tall), bunting, balloons };
}

// ---------------------------------------------------------------- component
export function TechCorner({ cfg }: { cfg: StoreConfig }) {
  const T = storePlan(cfg).tech;
  return T ? <TechCornerInner T={T} /> : null;
}

function TechCornerInner({ T }: { T: TechFloor }) {
  const built = useMemo(() => build(T), [T]);
  const screen = useMemo(() => {
    const can = document.createElement('canvas'); can.width = AW; can.height = AH;
    const ctx = can.getContext('2d')!;
    drawChannels(ctx, 0);
    const tex = new THREE.CanvasTexture(can);
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; // cheap re-uploads
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    return { ctx, tex, mat };
  }, []);
  const labelMat = useMemo(() => new THREE.MeshBasicMaterial({ map: built.labelTex, alphaTest: 0.4 }), [built]);
  const boardMat = useMemo(() => new THREE.MeshBasicMaterial({ map: built.boardTex }), [built]);
  const buntMat = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), []);
  const balloonGeo = useMemo(() => new THREE.SphereGeometry(1, 14, 10), []);
  const balloonMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05 }), []);
  const balloonRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => () => {
    disposeGroup(built.group); built.screens.dispose(); built.labels.dispose(); built.labelTex.dispose(); built.boards.dispose(); built.boardTex.dispose(); built.bunting?.dispose();
  }, [built]);
  useEffect(() => () => { screen.tex.dispose(); screen.mat.dispose(); }, [screen]);
  useEffect(() => () => { labelMat.dispose(); boardMat.dispose(); }, [labelMat, boardMat]);
  useEffect(() => () => { buntMat.dispose(); balloonGeo.dispose(); balloonMat.dispose(); }, [buntMat, balloonGeo, balloonMat]);

  // balloon colours once
  useEffect(() => {
    const im = balloonRef.current; if (!im) return;
    const c = new THREE.Color();
    built.balloons.forEach((b, i) => { im.setColorAt(i, c.set(b.c)); });
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [built]);

  const acc = useRef({ tv: 1, t: 0 });
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((state, dt) => {
    const a = acc.current;
    a.t = state.clock.elapsedTime;
    a.tv += dt;
    if (a.tv >= 1 / 8) { a.tv = 0; drawChannels(screen.ctx, a.t); screen.tex.needsUpdate = true; } // channels at 8 fps
    const im = balloonRef.current;
    if (im) {
      built.balloons.forEach((b, i) => {
        dummy.position.set(b.x + Math.sin(a.t * 0.9 + i) * 0.02, b.y + Math.sin(a.t * 1.3 + i * 1.7) * 0.04, b.z);
        dummy.rotation.set(0, 0, Math.sin(a.t * 0.8 + i) * 0.08);
        dummy.scale.set(0.16, 0.2, 0.16); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group name="tech-corner">
      <primitive object={built.group} />
      <mesh geometry={built.screens} material={screen.mat} raycast={noRay} />
      <mesh geometry={built.labels} material={labelMat} raycast={noRay} />
      <mesh geometry={built.boards} material={boardMat} raycast={noRay} />
      {built.bunting && <mesh geometry={built.bunting} material={buntMat} raycast={noRay} />}
      {built.balloons.length > 0 && <instancedMesh ref={balloonRef} args={[balloonGeo, balloonMat, built.balloons.length]} raycast={noRay} frustumCulled={false} />}
    </group>
  );
}

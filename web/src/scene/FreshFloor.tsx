// Fresh floor for the big stores, drawn from storePlan(cfg).fresh (freshFloor.ts): wooden produce crate tables,
// angled display tables, a misting veg stand, pumpkin + melon bins, potato sacks, bread tables and loaf baskets with
// chalkboard price signs; a small pharmacy (counter, medicine shelves, green cross, queue rope, consultation door,
// a pharmacist); and a cutaway bakehouse annex behind the bakery wall (deck ovens, proving racks, a floury work
// table, a dough mixer, flour sacks, four bakers on simple loops).
// Perf: every static part is merged (storeKit, ~5 draw calls), every fruit / loaf / medicine box is an instance of
// one of six shared shapes (6 InstancedMeshes, instanceColor), all labels are two atlases (2 quads meshes), the
// pharmacist + bakers are 6 InstancedMeshes moved by ONE useFrame. Decor only: nothing here feeds a stat. No brands.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { StoreConfig } from '../types';
import { storePlan } from '../layout';
import type { FreshFloor as Fresh, FreshKind } from '../freshFloor';
import { Kit, LabelAtlas, QuadBatch, disposeGroup } from './storeKit';
import { drawSticker } from './Departments';
import { minionGeo, MINION_MAT, MINION_SKIN_ARM, MINION_SHOULDER } from './minion';

const noRay = () => null;
type M4 = THREE.Matrix4;
const M = (x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => Kit.m(x, y, z, ry, sx, sy, sz, rx, rz);
const L = (b: M4, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) => b.clone().multiply(M(x, y, z, ry, 1, 1, 1, rx, rz));
function rng(seed: number) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------------------------------------------------------------- instanced shapes
type Shape = 'sph' | 'cone' | 'broc' | 'arc' | 'cyl' | 'box';
const SHAPES: Record<Shape, () => THREE.BufferGeometry> = {
  sph: () => new THREE.SphereGeometry(1, 9, 6),
  cone: () => new THREE.ConeGeometry(1, 1, 6),
  broc: () => new THREE.DodecahedronGeometry(1, 0),
  arc: () => new THREE.TorusGeometry(1, 0.3, 5, 9, Math.PI * 0.75),
  cyl: () => new THREE.CylinderGeometry(1, 1, 1, 8),
  box: () => new THREE.BoxGeometry(1, 1, 1),
};
class Pile {
  items: Record<Shape, { m: M4; c: string }[]> = { sph: [], cone: [], broc: [], arc: [], cyl: [], box: [] };
  add(s: Shape, m: M4, c: string) { this.items[s].push({ m, c }); }
}
interface Produce { name: string; shape: Shape; r: number; s: [number, number, number]; c: string[]; rx?: number; rz?: number; h?: number }
const FRUIT: Record<string, Produce> = {
  apples: { name: 'apples', shape: 'sph', r: 0.045, s: [1, 0.92, 1], c: ['#c8282c', '#d63a2a', '#b51f2b'] },
  green: { name: 'green apples', shape: 'sph', r: 0.045, s: [1, 0.92, 1], c: ['#8cc63f', '#9ccf4a'] },
  oranges: { name: 'oranges', shape: 'sph', r: 0.047, s: [1, 1, 1], c: ['#f39a1e', '#f5a52a'] },
  lemons: { name: 'lemons', shape: 'sph', r: 0.04, s: [1.25, 0.9, 0.9], c: ['#f5d634', '#f2cf2a'] },
  limes: { name: 'limes', shape: 'sph', r: 0.035, s: [1.15, 0.95, 0.95], c: ['#6bb33a'] },
  bananas: { name: 'bananas', shape: 'arc', r: 0.08, s: [1, 1, 1], c: ['#f2d43a', '#ecd04a', '#e5d65a'], rx: Math.PI / 2 },
  melons: { name: 'melons', shape: 'sph', r: 0.1, s: [1.1, 0.95, 1], c: ['#d6c96a', '#c9d46a', '#e1c977'] },
  watermelons: { name: 'watermelons', shape: 'sph', r: 0.15, s: [1.25, 0.95, 1], c: ['#2f7d32', '#357f2f'] },
  pumpkins: { name: 'pumpkins', shape: 'sph', r: 0.17, s: [1, 0.72, 1], c: ['#e8761c', '#ee8a24', '#d9691a'] },
  broccoli: { name: 'broccoli', shape: 'broc', r: 0.065, s: [1, 0.85, 1], c: ['#2f7a35', '#3a8a3a'] },
  cauli: { name: 'cauliflower', shape: 'broc', r: 0.08, s: [1, 0.8, 1], c: ['#f1ead2'] },
  carrots: { name: 'carrots', shape: 'cone', r: 0.03, s: [0.7, 5, 0.7], c: ['#f07a1a', '#f5862a'], rz: Math.PI / 2 },
  lettuce: { name: 'lettuces', shape: 'sph', r: 0.08, s: [1, 0.75, 1], c: ['#8ccf5a', '#9ad86a', '#7cc34c'] },
  peppers: { name: 'peppers', shape: 'sph', r: 0.045, s: [1, 1.15, 1], c: ['#d8322a', '#f2c230', '#3f9a3a', '#ee7a1a'] },
  tomatoes: { name: 'tomatoes', shape: 'sph', r: 0.038, s: [1, 0.85, 1], c: ['#d8322a', '#e2402e'] },
  potatoes: { name: 'potatoes', shape: 'sph', r: 0.035, s: [1.3, 0.9, 1], c: ['#c4996a', '#b98b55'] },
  onions: { name: 'onions', shape: 'sph', r: 0.038, s: [1, 0.95, 1], c: ['#c98a4a', '#b9763a', '#8a3b5a'] },
  plums: { name: 'plums', shape: 'sph', r: 0.03, s: [1, 1, 1], c: ['#6a2550', '#7a2e5e'] },
  loaf: { name: 'loaves', shape: 'sph', r: 0.075, s: [1.9, 0.9, 1.05], c: ['#c88a45', '#b0703a', '#d29a55'] },
  rolls: { name: 'rolls', shape: 'sph', r: 0.045, s: [1, 0.75, 1], c: ['#d39a5a', '#c8894a', '#e0b070'] },
  croissants: { name: 'croissants', shape: 'arc', r: 0.06, s: [1, 1, 1.3], c: ['#d6973e', '#cf8a35'], rx: Math.PI / 2 },
  dough: { name: 'dough', shape: 'sph', r: 0.07, s: [1, 0.6, 1], c: ['#f1dfb6', '#ecd6a6'] },
};
const PRICES: Record<string, string> = {
  apples: '4 for £1', 'green apples': '4 for £1', oranges: '5 for £1.50', lemons: '3 for £1', limes: '4 for £1', bananas: '18p each',
  melons: '£1.50 each', watermelons: '£3 each', pumpkins: '£1.50 each', broccoli: '65p each', cauliflower: '£1 each', carrots: '55p / kg',
  lettuces: '70p each', peppers: '3 for £1.20', tomatoes: '£1 a box', potatoes: '£1.50 / 2.5kg', onions: '80p / kg', plums: '£1.80 / kg',
  loaves: 'baked today £1.20', rolls: '6 for £1', croissants: '4 for £1.60',
};
const jit = (hex: string, r: () => number) => '#' + new THREE.Color(hex).offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.08).getHexString();

/** heap produce on a w × d surface (local frame, y = surface) */
function heap(P: Pile, base: M4, w: number, d: number, f: Produce, r: () => number, layers = 2) {
  const sp = f.r * 2.05 * Math.max(1, f.s[0] * 0.8), nx = Math.max(1, Math.floor(w / sp)), nz = Math.max(1, Math.floor(d / (f.r * 2.05)));
  const spz = d / nz, spx = w / nx;
  for (let l = 0; l < layers; l++) {
    const ix = l ? nx - 1 : nx, iz = l ? nz - 1 : nz;
    for (let i = 0; i < ix; i++) for (let j = 0; j < iz; j++) {
      if (l && r() < 0.25) continue;
      const x = -w / 2 + spx / 2 + i * spx + (l ? spx / 2 : 0), z = -d / 2 + spz / 2 + j * spz + (l ? spz / 2 : 0);
      const y = f.r * f.s[1] * (f.shape === 'cone' ? 0.15 : 1) + l * f.r * 1.3;
      const m = base.clone().multiply(M(x + (r() - 0.5) * f.r * 0.3, y, z + (r() - 0.5) * f.r * 0.3, r() * 6.28, f.r * f.s[0], f.r * f.s[1], f.r * f.s[2], f.rx ?? 0, (f.rz ?? 0) + (r() - 0.5) * 0.3));
      P.add(f.shape, m, jit(f.c[Math.floor(r() * f.c.length)], r));
    }
  }
}

// ---------------------------------------------------------------- labels
function chalk(ctx: CanvasRenderingContext2D, W: number, H: number, title: string, sub: string, dot: string) {
  ctx.fillStyle = '#8a5a34'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#26332d'; ctx.fillRect(14, 14, W - 28, H - 28);
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 30; i++) ctx.fillRect((i * 97) % W, (i * 53) % H, 40, 3);
  ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(W - 70, 70, 26, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f7f3ea'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '700 64px "Baloo 2", "Comic Sans MS", system-ui'; ctx.fillText(title, W / 2, H * 0.38, W - 150);
  ctx.fillStyle = '#ffe08a'; ctx.font = '800 58px "Baloo 2", "Comic Sans MS", system-ui'; ctx.fillText(sub, W / 2, H * 0.7, W - 60);
}
function cross(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = '#1f9d55'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff'; const s = Math.min(W, H) * 0.24; ctx.fillRect(W / 2 - s / 2, H / 2 - s * 1.5, s, s * 3); ctx.fillRect(W / 2 - s * 1.5, H / 2 - s / 2, s * 3, s);
}

// ---------------------------------------------------------------- build
const WOOD = '#b07a46', WOOD_D = '#7e5232', WOOD_L = '#d1a26a', BURLAP = '#b8966a';
interface Fig { kind: 'pharm' | 'knead' | 'carry' | 'oven'; base: M4; a: THREE.Vector3; b: THREE.Vector3; ph: number }

function build(F: Fresh) {
  const k = new Kit(), P = new Pile();
  const board = new LabelAtlas(512, 320, 40), banner = new LabelAtlas(1024, 256, 12);
  const boards = new QuadBatch(), banners = new QuadBatch();
  const figs: Fig[] = [];
  const sign = (base: M4, x: number, z: number, title: string, sub: string, dot: string) => {
    k.cyl(0.025, 1.2, L(base, x, 0.6, z), WOOD_D);
    k.box(0.66, 0.44, 0.04, L(base, x, 1.32, z), WOOD_D);
    const uv = board.add((c, w, h) => chalk(c, w, h, title, sub, dot));
    boards.add(L(base, x, 1.32, z + 0.025), 0.6, 0.38, uv);
    boards.add(L(base, x, 1.32, z - 0.025, Math.PI), 0.6, 0.38, uv);
  };
  const table = (b: M4, h: number, top = WOOD) => {
    k.box(2.5, 0.07, 1.5, L(b, 0, h, 0), top, { ink: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.08, h, 0.08, L(b, sx * 1.15, h / 2, sz * 0.65), WOOD_D);
    k.box(2.3, 0.05, 1.3, L(b, 0, 0.18, 0), WOOD_D);
  };

  // -------- produce + bread displays
  for (const f of F.fixtures) {
    const r = rng(f.seed * 17 + 3);
    const b = M(f.x, 0, f.z);
    const pick = (list: string[]) => FRUIT[list[Math.floor(r() * list.length)]];
    const kind: FreshKind = f.kind;
    let label: Produce | null = null;
    if (kind === 'crates') {
      table(b, 0.62);
      const sets = [['apples', 'oranges', 'lemons', 'green', 'bananas', 'plums'], ['tomatoes', 'peppers', 'oranges', 'apples', 'limes', 'bananas']][f.seed % 2];
      let i = 0;
      for (const row of [-1, 1]) for (const cx of [-0.82, 0, 0.82]) {
        const fr = FRUIT[sets[i++ % sets.length]]; label ??= fr;
        const cm = L(b, cx, 0.79, row * 0.37, 0, row * 0.2);
        k.box(0.78, 0.22, 0.68, cm, WOOD_L, { ink: true });
        heap(P, L(cm, 0, 0.11, 0), 0.72, 0.62, fr, r);
      }
    } else if (kind === 'angled') {
      k.box(2.5, 0.55, 1.4, L(b, 0, 0.275, 0), WOOD_D, { ink: true });
      const list = ['carrots', 'broccoli', 'peppers', 'tomatoes', 'onions', 'lettuce', 'cauli', 'apples'];
      for (const row of [-1, 1]) {
        const pm = L(b, 0, 0.8, row * 0.36, 0, row * 0.38);
        k.box(2.5, 0.05, 0.8, pm, WOOD, { ink: true });
        for (const cx of [-0.83, 0, 0.83]) {
          const fr = pick(list); label ??= fr;
          k.box(0.04, 0.12, 0.8, L(pm, cx + 0.41, 0.06, 0), WOOD_D);
          heap(P, L(pm, cx, 0.025, 0), 0.78, 0.74, fr, r);
        }
      }
      k.box(2.5, 0.1, 0.12, L(b, 0, 1.0, 0), WOOD_D);
    } else if (kind === 'mist') {
      k.box(2.5, 0.3, 1.5, L(b, 0, 0.15, 0), '#3f6b4a', { ink: true });
      k.box(2.5, 1.6, 0.1, L(b, 0, 1.1, 0), '#2f5a3d', { ink: true });
      const greens = ['lettuce', 'broccoli', 'carrots', 'peppers', 'cauli', 'lettuce'];
      let i = 0;
      for (const row of [-1, 1]) for (const [y, dz] of [[0.55, 0.5], [1.0, 0.28]] as [number, number][]) {
        const sm = L(b, 0, y, row * dz, 0, row * 0.3);
        k.box(2.5, 0.04, 0.42, sm, '#d9d2c4');
        for (const cx of [-0.83, 0, 0.83]) { const fr = FRUIT[greens[i++ % greens.length]]; label ??= fr; heap(P, L(sm, cx, 0.02, 0), 0.8, 0.38, fr, r, 1); }
      }
      k.box(2.7, 0.08, 1.1, L(b, 0, 1.95, 0), '#2f5a3d', { ink: true });
      for (let x = -1.1; x <= 1.11; x += 0.37) for (const row of [-1, 1]) {
        k.cyl(0.015, 0.06, L(b, x, 1.88, row * 0.45), '#c9ced6', 'metal');
        for (let j = 0; j < 3; j++) k.sphere(0.07 + j * 0.03, L(b, x + (r() - 0.5) * 0.1, 1.78 - j * 0.16, row * (0.47 + j * 0.03)), '#ffffff', 'glass');
      }
    } else if (kind === 'bins') {
      for (const [cx, name] of [[-0.66, 'pumpkins'], [0.66, f.seed % 2 ? 'watermelons' : 'melons']] as [number, string][]) {
        k.box(1.15, 0.6, 1.4, L(b, cx, 0.3, 0), cx < 0 ? '#c99a5e' : WOOD, { ink: true });
        const fr = FRUIT[name]; label ??= fr;
        heap(P, L(b, cx, 0.6, 0), 1.05, 1.3, fr, r, 2);
      }
    } else if (kind === 'sacks') {
      k.box(2.5, 0.12, 1.5, L(b, 0, 0.06, 0), '#c49a64', { ink: true });
      for (let i = 0; i < 4; i++) for (const row of [-1, 1]) {
        const x = -0.95 + i * 0.63, z = row * 0.38;
        if (i === 1 && row > 0) continue;
        P.add('sph', L(b, x, 0.36, z).multiply(new THREE.Matrix4().makeScale(0.26, 0.26, 0.2)), jit(BURLAP, r));
        P.add('cyl', L(b, x, 0.64, z).multiply(new THREE.Matrix4().makeScale(0.08, 0.1, 0.08)), jit('#a8875a', r));
        heap(P, L(b, x, 0.52, z), 0.22, 0.16, FRUIT[i % 2 ? 'onions' : 'potatoes'], r, 1);
      }
      k.box(0.6, 0.25, 0.5, L(b, -0.32, 0.245, 0.38), WOOD_L, { ink: true });
      heap(P, L(b, -0.32, 0.37, 0.38), 0.54, 0.44, FRUIT.potatoes, r, 2);
      label = FRUIT.potatoes;
    } else if (kind === 'bread') {
      table(b, 0.72, WOOD_D);
      for (const row of [-1, 1]) for (const cx of [-0.8, 0, 0.8]) {
        const bm = L(b, cx, 0.8, row * 0.36);
        P.add('cyl', bm.clone().multiply(new THREE.Matrix4().makeScale(0.32, 0.1, 0.28)), jit('#c79a5b', r));
        const fr = FRUIT[cx === 0 ? 'rolls' : 'loaf']; label ??= FRUIT.loaf;
        heap(P, L(bm, 0, 0.05, 0), 0.55, 0.42, fr, r, 2);
      }
      for (const sx of [-1, 1]) { // baguette barrels
        k.cyl(0.2, 0.55, L(b, sx * 1.55, 0.275, 0), WOOD, 'solid');
        for (let j = 0; j < 7; j++) { const a = (j / 7) * Math.PI * 2; P.add('cyl', L(b, sx * 1.55 + Math.cos(a) * 0.09, 0.75, Math.sin(a) * 0.09, 0, Math.sin(a) * 0.25, -Math.cos(a) * 0.25).multiply(new THREE.Matrix4().makeScale(0.03, 0.6, 0.03)), jit('#d9a259', r)); }
      }
    } else { // baskets: a 3-step stand of rolls, croissants, loaves
      for (let s = 0; s < 3; s++) {
        const y = 0.35 + s * 0.3, dz = 0.45 - s * 0.3;
        for (const row of [-1, 1]) {
          if (s === 2 && row > 0) continue;
          const sm = L(b, 0, y, s === 2 ? 0 : row * dz);
          k.box(2.5, 0.06, s === 2 ? 0.5 : 0.45, sm, WOOD, { ink: true });
          for (const [ci, cx] of [-0.83, 0, 0.83].entries()) {
            const fr = FRUIT[['croissants', 'rolls', 'loaf'][(s + ci) % 3]];
            P.add('cyl', L(sm, cx, 0.07, 0).multiply(new THREE.Matrix4().makeScale(0.36, 0.08, 0.2)), jit('#c79a5b', r));
            heap(P, L(sm, cx, 0.1, 0), 0.62, 0.34, fr, r, 1);
          }
        }
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.06, 1.0, 0.06, L(b, sx * 1.2, 0.5, sz * 0.68), WOOD_D);
      label = FRUIT.croissants;
    }
    const lb = label ?? FRUIT.apples;
    sign(b, f.w / 2 - 0.05, 0, lb.name, PRICES[lb.name] ?? '£1', lb.c[0]);
  }

  // -------- pharmacy (local: x along the wall, +z into the store)
  if (F.pharmacy) {
    const ph = F.pharmacy, Lp = ph.z1 - ph.z0, base = M(ph.wallX, 0, (ph.z0 + ph.z1) / 2, ph.s > 0 ? Math.PI / 2 : -Math.PI / 2);
    const r = rng(77);
    k.floor(-Lp / 2, 0.12, Lp / 2, 3.25, 0.012, '#d7efe2');
    // medicine shelves on the wall
    const sx0 = -Lp / 2 + 0.25, sx1 = Lp / 2 - 1.7, sw = sx1 - sx0, scx = (sx0 + sx1) / 2;
    k.box(sw, 2.1, 0.04, L(base, scx, 1.05, 0.15), '#f4f1ec', { ink: true });
    k.box(sw, 0.06, 0.44, L(base, scx, 2.1, 0.35), '#2f8f5b');
    for (const sx of [-1, 1]) k.box(0.04, 2.1, 0.44, L(base, scx + sx * sw / 2, 1.05, 0.35), '#f4f1ec', { ink: true });
    const shelfY = [0.35, 0.72, 1.09, 1.46, 1.83];
    const pastel = ['#ffffff', '#cfe6ff', '#d9f2dc', '#ffd9e2', '#fff1c2', '#e6dcff', '#ffffff'];
    for (const y of shelfY) {
      k.box(sw - 0.04, 0.025, 0.4, L(base, scx, y, 0.35), '#e2ddd5');
      for (let x = sx0 + 0.08; x < sx1 - 0.08;) {
        const w = 0.07 + r() * 0.07, h = 0.1 + r() * 0.12;
        P.add('box', L(base, x + w / 2, y + 0.013 + h / 2, 0.42).multiply(new THREE.Matrix4().makeScale(w, h, 0.12 + r() * 0.06)), pastel[Math.floor(r() * pastel.length)]);
        x += w + 0.01;
      }
    }
    // consultation room door at the far end of the wall
    const dx = Lp / 2 - 0.85;
    k.box(1.0, 2.15, 0.08, L(base, dx, 1.075, 0.16), '#5c8f7d', { ink: true });
    k.box(0.9, 2.05, 0.05, L(base, dx, 1.03, 0.2), '#8cc7b0');
    k.box(0.3, 0.4, 0.02, L(base, dx, 1.55, 0.23), '#d5ecf2', { bucket: 'glass' });
    k.sphere(0.035, L(base, dx + 0.32, 1.0, 0.25), '#c9ced6', 'metal');
    banners.add(L(base, dx, 2.35, 0.2), 1.1, 0.27, banner.add((c, w, h) => drawSticker(c, w, h, 'consultation room', null, { face: '#ffffff' })));
    // counter with a glass screen, staff gap at the door end
    const cx0 = -Lp / 2 + 0.3, cx1 = Lp / 2 - 1.9, cw = cx1 - cx0, ccx = (cx0 + cx1) / 2;
    k.box(cw, 1.02, 0.7, L(base, ccx, 0.51, 2.0), '#f7f7f4', { ink: true });
    k.box(cw + 0.04, 0.06, 0.76, L(base, ccx, 1.05, 2.0), '#2f8f5b');
    k.box(cw, 0.18, 0.02, L(base, ccx, 0.75, 2.36), '#1f9d55');
    k.box(cw, 0.5, 0.02, L(base, ccx, 1.33, 1.9), '#e8f6ff', { bucket: 'glass' });
    banners.add(L(base, ccx - cw / 4, 0.62, 2.37), 1.3, 0.32, banner.add((c, w, h) => drawSticker(c, w, h, 'prescriptions', 'collect here', { chip: 'Rx', chipColor: '#1f9d55' })));
    // hanging sign + green crosses
    const hy = 2.75;
    for (const sx of [-0.7, 0.7]) k.cyl(0.01, 3.2 - hy - 0.2, L(base, ccx + sx, hy + 0.2 + (3.2 - hy - 0.2) / 2, 2.0), '#2a2328');
    const sUV = banner.add((c, w, h) => drawSticker(c, w, h, 'pharmacy', 'advice & prescriptions', { chip: '+', chipColor: '#1f9d55' }));
    banners.add(L(base, ccx, hy, 2.02), 1.9, 0.48, sUV);
    banners.add(L(base, ccx, hy, 1.98, Math.PI), 1.9, 0.48, sUV);
    const crossUV = board.add(cross);
    const crossAt = L(base, scx, 2.55, 0.16);
    k.box(0.62, 0.62, 0.1, crossAt, '#2f8f5b');
    boards.add(L(base, scx, 2.55, 0.215), 0.56, 0.35, crossUV);
    k.box(0.12, 0.42, 0.42, L(base, -Lp / 2 + 0.1, 2.5, 0.35), '#1f9d55', { bucket: 'glow' }); // projecting cross block
    // queue rope + posts in front of the counter
    const qz = 3.0, qx0 = cx0 + 0.3, qx1 = Math.min(cx1 - 0.6, qx0 + 3.2);
    for (let x = qx0; x <= qx1 + 1e-3; x += (qx1 - qx0) / 3) {
      k.cyl(0.18, 0.04, L(base, x, 0.02, qz), '#9aa0a8', 'metal');
      k.cyl(0.025, 0.95, L(base, x, 0.475, qz), '#c9ced6', 'metal');
      k.sphere(0.04, L(base, x, 0.97, qz), '#c9ced6', 'metal');
    }
    k.box(qx1 - qx0, 0.035, 0.035, L(base, (qx0 + qx1) / 2, 0.88, qz), '#c0283a');
    // pharmacist behind the counter
    figs.push({ kind: 'pharm', base, a: new THREE.Vector3(ccx - cw / 4, 0, 1.15), b: new THREE.Vector3(ccx + cw / 4, 0, 1.15), ph: 0 });
  }

  // -------- bakehouse annex (local: x along the wall, +z outward, z = 0 is the store wall)
  if (F.bakehouse) {
    const bh = F.bakehouse, La = bh.z1 - bh.z0, D = bh.depth;
    const base = M(bh.wallX, 0, (bh.z0 + bh.z1) / 2, bh.s > 0 ? Math.PI / 2 : -Math.PI / 2);
    const r = rng(91);
    const WALL = '#fff3ec', H = 3.2;
    k.box(La + 0.24, 0.05, D, L(base, 0, 0.025, D / 2), '#ece4d6');
    k.floor(-La / 2, 0.2, La / 2, D - 0.1, 0.052, '#f1e9dc');
    for (let x = -La / 2 + 1; x < La / 2; x += 1) k.box(0.02, 0.005, D - 0.3, L(base, x, 0.056, D / 2), '#ddd2c1');
    k.box(La + 0.24, H, 0.24, L(base, 0, H / 2, D), WALL, { ink: true });
    for (const sx of [-1, 1]) k.box(0.24, H, D, L(base, sx * (La / 2 + 0.0), H / 2, D / 2), WALL, { ink: true });
    k.box(La + 0.26, 0.22, 0.26, L(base, 0, H - 0.2, D), '#FE831B');
    for (const sx of [-1, 1]) k.box(0.26, 0.22, D, L(base, sx * La / 2, H - 0.2, D / 2), '#FE831B');
    // deck ovens along the outer wall
    const nOv = Math.max(1, Math.min(4, Math.floor((La - 4) / 2.4)));
    const ovX: number[] = [];
    for (let i = 0; i < nOv; i++) {
      const x = -La / 2 + 1.6 + i * 2.4; ovX.push(x);
      const om = L(base, x, 0, D - 0.75, Math.PI);
      k.box(2.0, 2.0, 1.1, L(om, 0, 1.0, 0), '#b9bec4', { bucket: 'metal', ink: true });
      for (let d = 0; d < 3; d++) {
        const y = 0.5 + d * 0.5;
        k.box(1.6, 0.3, 0.02, L(om, 0, y, 0.56), '#ffb347', { bucket: 'glow' });
        k.box(1.5, 0.03, 0.04, L(om, 0, y + 0.2, 0.6), '#6b6f76', { bucket: 'metal' });
        for (let j = 0; j < 4; j++) P.add('sph', L(om, -0.55 + j * 0.37, y - 0.07, 0.4).multiply(new THREE.Matrix4().makeScale(0.13, 0.06, 0.08)), jit('#b0703a', r));
      }
      k.box(2.0, 0.25, 1.1, L(om, 0, 2.12, 0), '#8e949b', { bucket: 'metal' });
      k.floor(x - 1.1, D - 2.2, x + 1.1, D - 1.3, 0.06, '#ffe2b8');
    }
    // stainless bench along the shop wall with cooling trays of loaves
    const bw = La - 3;
    k.box(bw, 0.06, 0.7, L(base, 0, 0.9, 0.5), '#c9ced6', { bucket: 'metal', ink: true });
    k.box(bw, 0.03, 0.6, L(base, 0, 0.3, 0.5), '#aeb4bb', { bucket: 'metal' });
    for (let x = -bw / 2 + 0.1; x <= bw / 2 - 0.1; x += bw / 6) k.box(0.05, 0.9, 0.6, L(base, x, 0.45, 0.5), '#aeb4bb', { bucket: 'metal' });
    for (let x = -bw / 2 + 0.5; x < bw / 2 - 0.4; x += 0.75) {
      k.box(0.62, 0.02, 0.48, L(base, x, 0.94, 0.5), '#9aa0a8', { bucket: 'metal' });
      heap(P, L(base, x, 0.95, 0.5), 0.58, 0.44, FRUIT[Math.floor(x * 7 + 100) % 3 === 0 ? 'croissants' : 'loaf'], r, 1);
    }
    // proving racks / trolleys of trays (front end + mid floor)
    const rackX = [La / 2 - 1.0, La / 2 - 1.9, 1.2, 0.3];
    for (const x of rackX) {
      const rm = L(base, x, 0, 2.6);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.03, 1.75, 0.03, L(rm, sx * 0.33, 0.95, sz * 0.28), '#c9ced6', { bucket: 'metal' });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.sphere(0.04, L(rm, sx * 0.33, 0.05, sz * 0.28), '#2a2328');
      for (let t = 0; t < 8; t++) {
        const y = 0.3 + t * 0.2;
        k.box(0.64, 0.015, 0.56, L(rm, 0, y, 0), '#9aa0a8', { bucket: 'metal' });
        const fr = FRUIT[t % 3 === 0 ? 'croissants' : t % 3 === 1 ? 'dough' : 'rolls'];
        heap(P, L(rm, 0, y + 0.008, 0), 0.6, 0.5, fr, r, 1);
      }
    }
    // big floury work table + dough
    const tx = -La / 2 + Math.min(La * 0.4, 6), tm = L(base, tx, 0, 3.4);
    k.box(3.0, 0.08, 1.2, L(tm, 0, 0.9, 0), '#f6f0e4', { ink: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(0.07, 0.9, 0.07, L(tm, sx * 1.4, 0.45, sz * 0.52), '#c9ced6', { bucket: 'metal' });
    k.box(2.8, 0.03, 1.0, L(tm, 0, 0.25, 0), '#c9ced6', { bucket: 'metal' });
    for (let i = 0; i < 8; i++) P.add('sph', L(tm, -1.2 + i * 0.34, 0.97, (i % 2 ? 0.2 : -0.2)).multiply(new THREE.Matrix4().makeScale(0.11, 0.06, 0.11)), jit('#f1dfb6', r));
    P.add('cyl', L(tm, 1.1, 0.97, 0.3, 0, 0, Math.PI / 2).multiply(new THREE.Matrix4().makeScale(0.04, 0.45, 0.04)), '#d1a26a'); // rolling pin
    k.box(1.0, 0.012, 0.6, L(tm, 0.2, 0.946, 0), '#ffffff', { bucket: 'matte' }); // flour dusting
    // dough mixer
    const mm = L(base, -La / 2 + 1.0, 0, 1.2);
    k.box(0.6, 1.0, 0.5, L(mm, 0, 0.5, -0.2), '#d8dde3', { bucket: 'metal', ink: true });
    k.box(0.6, 0.25, 0.8, L(mm, 0, 1.15, 0), '#d8dde3', { bucket: 'metal' });
    k.cyl(0.32, 0.4, L(mm, 0, 0.7, 0.2), '#aeb4bb', 'metal');
    k.sphere(0.25, L(mm, 0, 0.82, 0.2), '#f1dfb6');
    // flour sacks
    for (let i = 0; i < 6; i++) P.add('sph', L(base, La / 2 - 0.6 - (i % 3) * 0.55, 0.25 + Math.floor(i / 3) * 0.4, D - 2.6 - 0.2).multiply(new THREE.Matrix4().makeScale(0.28, 0.22, 0.2)), jit('#efe9dc', r));
    // banner over the doorway inside the shop + inside the annex
    if (bh.doorZ !== null) {
      const inX = bh.wallX + (bh.s < 0 ? 0.2 : -0.2);
      const sm = M(inX, 2.75, bh.doorZ, bh.s < 0 ? Math.PI / 2 : -Math.PI / 2);
      banners.add(sm, 1.6, 0.4, banner.add((c, w, h) => drawSticker(c, w, h, 'bakehouse', 'baked here daily', { chip: '🥖', chipColor: '#FE831B' })));
    }
    // bakers: kneading at the table, carrying trays rack → oven, working the oven
    const ov0 = ovX[0] ?? 0, ov1 = ovX[ovX.length - 1] ?? 0;
    figs.push({ kind: 'knead', base, a: new THREE.Vector3(tx - 0.6, 0, 2.5), b: new THREE.Vector3(), ph: 0 });
    figs.push({ kind: 'knead', base, a: new THREE.Vector3(tx + 0.7, 0, 2.5), b: new THREE.Vector3(), ph: 1.3 });
    figs.push({ kind: 'carry', base, a: new THREE.Vector3(rackX[2], 0, 3.35), b: new THREE.Vector3(ov1, 0, D - 1.7), ph: 0 });
    figs.push({ kind: 'oven', base, a: new THREE.Vector3(ov0, 0, D - 1.75), b: new THREE.Vector3(), ph: 0.6 });
  }

  return {
    group: k.build(), pile: P,
    boards: boards.geometry(), boardTex: board.texture(),
    banners: banners.geometry(), bannerTex: banner.texture(),
    figs,
  };
}

function instanced(P: Pile) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.62 });
  const c = new THREE.Color();
  const out: THREE.InstancedMesh[] = [];
  for (const s of Object.keys(P.items) as Shape[]) {
    const list = P.items[s]; if (!list.length) continue;
    const im = new THREE.InstancedMesh(SHAPES[s](), mat, list.length);
    list.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, c.set(it.c)); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); im.raycast = noRay; im.castShadow = false; im.receiveShadow = true;
    out.push(im);
  }
  return { meshes: out, mat };
}

// ---------------------------------------------------------------- staff figures (pharmacist + bakers), one useFrame
function figures(figs: Fig[]) {
  const n = figs.length, mg = minionGeo();
  const mk = (g: THREE.BufferGeometry, m: THREE.Material, count: number) => { const im = new THREE.InstancedMesh(g, m, Math.max(1, count)); im.count = count; im.frustumCulled = false; im.raycast = noRay; return im; };
  const hatGeo = new THREE.CylinderGeometry(0.2, 0.17, 0.26, 12), trayGeo = new THREE.BoxGeometry(0.6, 0.03, 0.42), loafGeo = new THREE.SphereGeometry(1, 8, 6);
  const plain = new THREE.MeshStandardMaterial({ roughness: 0.6 });
  const tint = MINION_MAT.tint.clone();
  const head = mk(mg.head, MINION_MAT.head, n), hull = mk(mg.hull, MINION_MAT.hull, n), suit = mk(mg.overalls, tint, n), arms = mk(mg.arm, tint, n * 2);
  const hats = mk(hatGeo, plain, n), trays = mk(trayGeo, plain, n), loaves = mk(loafGeo, plain, n * 3);
  const c = new THREE.Color();
  figs.forEach((f, i) => {
    suit.setColorAt(i, c.set(f.kind === 'pharm' ? '#e9f5ef' : '#ffffff'));
    arms.setColorAt(i * 2, c.set(MINION_SKIN_ARM)); arms.setColorAt(i * 2 + 1, c.set(MINION_SKIN_ARM));
    hats.setColorAt(i, c.set('#ffffff')); trays.setColorAt(i, c.set('#9aa0a8'));
    for (let j = 0; j < 3; j++) loaves.setColorAt(i * 3 + j, c.set(j % 2 ? '#c88a45' : '#b0703a'));
  });
  for (const im of [suit, arms, hats, trays, loaves]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
  const meshes = [head, hull, suit, arms, hats, trays, loaves];
  const tmp = new THREE.Matrix4(), body = new THREE.Matrix4(), v = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function update(t: number) {
    figs.forEach((f, i) => {
      let x = f.a.x, z = f.a.z, yaw = 0, bob = 0, armR = 0, armL = 0, carry = false;
      const tt = t + f.ph;
      if (f.kind === 'pharm') { const u = (Math.sin(tt * 0.35) + 1) / 2; x = f.a.x + (f.b.x - f.a.x) * u; yaw = Math.sin(tt * 0.9) * 0.25; armR = -0.6 + Math.sin(tt * 2) * 0.2; armL = -0.3; }
      else if (f.kind === 'knead') { yaw = 0; bob = Math.abs(Math.sin(tt * 4)) * 0.04; armR = -1.3 + Math.sin(tt * 8) * 0.35; armL = -1.3 + Math.sin(tt * 8 + Math.PI) * 0.35; }
      else if (f.kind === 'carry') {
        const T = 10, u = (tt % T) / T; // 0-0.4 to oven (with tray), 0.4-0.5 load, 0.5-0.9 back, 0.9-1 pick up
        const leg = u < 0.4 ? u / 0.4 : u < 0.5 ? 1 : u < 0.9 ? 1 - (u - 0.5) / 0.4 : 0;
        const s = leg * leg * (3 - 2 * leg);
        x = f.a.x + (f.b.x - f.a.x) * s; z = f.a.z + (f.b.z - f.a.z) * s;
        const going = u < 0.5;
        const dx = (f.b.x - f.a.x) * (going ? 1 : -1), dz = (f.b.z - f.a.z) * (going ? 1 : -1);
        const walking = (u < 0.4) || (u > 0.5 && u < 0.9);
        yaw = walking ? Math.atan2(dx, dz) : going ? Math.atan2(f.b.x - f.a.x, f.b.z - f.a.z) : Math.atan2(f.a.x - f.b.x, f.a.z - f.b.z) + Math.PI;
        bob = walking ? Math.abs(Math.sin(tt * 9)) * 0.05 : 0;
        carry = u < 0.45 || u > 0.92; armR = armL = carry ? -1.2 : Math.sin(tt * 9) * 0.5;
      } else { // oven: reach in with the peel, pull loaves out, turn to the rack and back
        const T = 6, u = (tt % T) / T;
        yaw = u < 0.6 ? Math.PI : Math.PI - Math.min(1, (u - 0.6) / 0.15) * 1.2 * (u < 0.85 ? 1 : Math.max(0, 1 - (u - 0.85) / 0.15));
        const reach = u < 0.6 ? Math.sin((u / 0.6) * Math.PI) : 0;
        armR = armL = -0.5 - reach * 1.0; z = f.a.z + reach * 0.15; carry = u > 0.3 && u < 0.9;
      }
      body.copy(f.base).multiply(M(x, bob, z, yaw));
      head.setMatrixAt(i, body); hull.setMatrixAt(i, body); suit.setMatrixAt(i, body);
      arms.setMatrixAt(i * 2, tmp.copy(body).multiply(M(MINION_SHOULDER.x, MINION_SHOULDER.y, MINION_SHOULDER.z, 0, 1, 1, 1, armR)));
      arms.setMatrixAt(i * 2 + 1, tmp.copy(body).multiply(M(-MINION_SHOULDER.x, MINION_SHOULDER.y, MINION_SHOULDER.z, 0, 1, 1, 1, armL)));
      hats.setMatrixAt(i, f.kind === 'pharm' ? zero : tmp.copy(body).multiply(M(0, 1.28, 0)));
      if (carry || f.kind === 'knead') {
        const tm = f.kind === 'knead' ? M(0, 0.84, 0.52) : M(0, 0.62, 0.42);
        trays.setMatrixAt(i, f.kind === 'knead' ? zero : tmp.copy(body).multiply(tm));
        for (let j = 0; j < 3; j++) {
          v.set(-0.18 + j * 0.18, 0.05, 0);
          loaves.setMatrixAt(i * 3 + j, f.kind === 'knead' ? (j === 1 ? tmp.copy(body).multiply(M(0, 0.95 - bob * 0.5, 0.5, 0, 0.13, 0.07 - bob * 0.4, 0.12)) : zero)
            : tmp.copy(body).multiply(tm).multiply(M(v.x, v.y, v.z, 0, 0.08, 0.045, 0.06)));
        }
      } else {
        trays.setMatrixAt(i, zero);
        for (let j = 0; j < 3; j++) loaves.setMatrixAt(i * 3 + j, zero);
      }
    });
    for (const im of meshes) im.instanceMatrix.needsUpdate = true;
  }
  update(0);
  const dispose = () => { hatGeo.dispose(); trayGeo.dispose(); loafGeo.dispose(); plain.dispose(); tint.dispose(); for (const im of meshes) im.dispose(); };
  return { meshes, update, dispose };
}

// ---------------------------------------------------------------- component
export function FreshFloor({ cfg }: { cfg: StoreConfig }) {
  const F = storePlan(cfg).fresh;
  return F ? <FreshInner F={F} /> : null;
}

function FreshInner({ F }: { F: Fresh }) {
  const built = useMemo(() => build(F), [F]);
  const inst = useMemo(() => instanced(built.pile), [built]);
  const staff = useMemo(() => figures(built.figs), [built]);
  const boardMat = useMemo(() => new THREE.MeshBasicMaterial({ map: built.boardTex, side: THREE.DoubleSide }), [built]);
  const bannerMat = useMemo(() => new THREE.MeshBasicMaterial({ map: built.bannerTex, alphaTest: 0.4, side: THREE.DoubleSide }), [built]);
  useEffect(() => () => { disposeGroup(built.group); built.boards.dispose(); built.banners.dispose(); built.boardTex.dispose(); built.bannerTex.dispose(); }, [built]);
  useEffect(() => () => { inst.meshes.forEach((m) => m.geometry.dispose()); inst.mat.dispose(); }, [inst]);
  useEffect(() => () => staff.dispose(), [staff]);
  useEffect(() => () => { boardMat.dispose(); bannerMat.dispose(); }, [boardMat, bannerMat]);
  useFrame((state) => { if (built.figs.length) staff.update(state.clock.elapsedTime); });
  return (
    <group name="fresh-floor">
      <primitive object={built.group} />
      {inst.meshes.map((m, i) => <primitive key={i} object={m} />)}
      {built.figs.length > 0 && staff.meshes.map((m, i) => <primitive key={`s${i}`} object={m} />)}
      <mesh geometry={built.boards} material={boardMat} raycast={noRay} />
      <mesh geometry={built.banners} material={bannerMat} raycast={noRay} />
    </group>
  );
}

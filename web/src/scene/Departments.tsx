// Department divisions for the UK superstore plan (layout.storePlan): tinted floor zones with borders, big sticker
// department signs, numbered hanging aisle signs listing what's in each aisle, low divider walls, produce tables
// heaped with fruit + veg, a flower stand at the entrance, goods-in doors, and unbranded filler stock on shelves
// that have no planogram (non-food, beer/wine/spirits in the fixture). Static parts are merged (storeKit), signs
// share one atlas texture, filler stock is one InstancedMesh. Decor only: nothing here feeds a stat.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Planogram, StoreConfig } from '../types';
import { G, rowGap, rowY, storePlan, type DeptZone, type StorePlan } from '../layout';
import { CAT_EMOJI, INK, catLabel } from '../theme';
import { Kit, LabelAtlas, QuadBatch, disposeGroup, shade } from './storeKit';
import { stickerSign } from './textures';

const noRay = () => null;

/** sticker card drawn into an atlas cell: ink ledge, cream (or tinted) face, optional number chip */
export function drawSticker(ctx: CanvasRenderingContext2D, W: number, H: number, title: string, sub: string | null, o: { chip?: string; chipColor?: string; face?: string; brand?: boolean } = {}) {
  const r = Math.min(46, H / 2 - 10);
  ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(6, 14, W - 12, H - 20, r); ctx.fill();
  if (o.brand) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#FF4079'); g.addColorStop(1, '#FE831B'); ctx.fillStyle = g; } else ctx.fillStyle = o.face ?? '#fffaf5';
  ctx.strokeStyle = INK; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.roundRect(6, 4, W - 12, H - 20, r); ctx.fill(); ctx.stroke();
  let x = 26;
  const midY = (H - 16) / 2;
  if (o.chip) {
    const cr = (H - 20) * 0.36;
    ctx.fillStyle = o.chipColor ?? '#FF4079'; ctx.beginPath(); ctx.arc(x + cr, midY, cr, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 7; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `800 ${cr * (o.chip.length > 2 ? 0.8 : 1.15)}px "Baloo 2", system-ui`;
    ctx.lineWidth = cr * 0.16; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.strokeText(o.chip, x + cr, midY + 3); ctx.fillText(o.chip, x + cr, midY + 3);
    x += cr * 2 + 18;
  }
  const maxW = W - x - 24;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let ts = sub ? H * 0.36 : H * 0.5;
  ctx.font = `800 ${ts}px "Baloo 2", system-ui`;
  while (ctx.measureText(title).width > maxW && ts > 14) { ts -= 2; ctx.font = `800 ${ts}px "Baloo 2", system-ui`; }
  const ty = sub ? midY - H * 0.13 : midY + 3;
  if (o.brand) { ctx.lineWidth = ts * 0.16; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.strokeText(title, x, ty); ctx.fillStyle = '#fff'; } else ctx.fillStyle = INK;
  ctx.fillText(title, x, ty);
  if (sub) {
    let ss = H * 0.19; ctx.font = `700 ${ss}px Inter, system-ui`;
    while (ctx.measureText(sub).width > maxW && ss > 10) { ss -= 1; ctx.font = `700 ${ss}px Inter, system-ui`; }
    ctx.fillStyle = o.brand ? '#fff' : '#5b4a56'; ctx.fillText(sub, x, midY + H * 0.2);
  }
}

/** floor-friendly tint of a department colour: keep the hue, make it light (generator colours can be saturated) */
function pastel(hex: string) {
  const c = new THREE.Color(hex); const hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, 0.7), Math.max(hsl.l, 0.86));
}

// ---------------------------------------------------------------- static: floor zones, borders, dividers, decor
function buildStatic(P: StorePlan) {
  const k = new Kit();
  const B = P.bounds;
  // floor: one walkway colour; a subtle department tint only under the fixtures (+ the shelf-front strip), and under
  // the service areas (checkouts). Café has its own wood floor.
  const byId = new Map(P.depts.map((d) => [d.id, d]));
  for (const p of Object.values(P.units)) {
    const d = byId.get(p.dept); if (!d) continue;
    const c = Math.cos(p.rotY), s = Math.sin(p.rotY), h = p.len / 2 + 0.05;
    // from 1.0 m behind the face (fixture body) to 0.9 m in front of it
    const ax = p.x - s * 1.0, az = p.z - c * 1.0, bx = p.x + s * 0.9, bz = p.z + c * 0.9;
    const alongZ = Math.abs(s) > 0.5;
    const x0 = alongZ ? Math.min(ax, bx) : p.x - h, x1 = alongZ ? Math.max(ax, bx) : p.x + h;
    const z0 = alongZ ? p.z - h : Math.min(az, bz), z1 = alongZ ? p.z + h : Math.max(az, bz);
    k.floor(Math.max(B.xMin, x0), Math.max(B.zMin, z0), Math.min(B.xMax, x1), Math.min(B.zMax, z1), 0.004, pastel(d.color));
  }
  for (const d of P.depts) {
    if (d.kind !== 'service' || d.id === 'cafe' || d.units.length) continue;
    const r = d.rect;
    const x0 = Math.max(B.xMin, r.x0), x1 = Math.min(B.xMax, r.x1), z0 = Math.max(B.zMin, r.z0), z1 = Math.min(B.zMax, r.z1);
    if (x1 - x0 < 0.2 || z1 - z0 < 0.2) continue;
    k.floor(x0, z0, x1, z1, 0.003, pastel(d.color));
  }
  // racetrack: a dashed guide line around the main aisle block (UK stores mark the main walkways with a floor finish)
  const g0 = Math.min(...P.gondolas.map((g) => g.x)) - G.depth / 2 - 1.8, g1 = Math.max(...P.gondolas.map((g) => g.x)) + G.depth / 2 + 1.8;
  const zA = P.crossFront - 0.2, zB = P.crossBack + 0.4;
  for (let x = g0; x < g1; x += 1.6) { k.floor(x, zA - 0.07, Math.min(g1, x + 0.8), zA + 0.07, 0.007, '#ffffff'); k.floor(x, zB - 0.07, Math.min(g1, x + 0.8), zB + 0.07, 0.007, '#ffffff'); }
  // low divider walls (1.1 m) with a coloured cap
  for (const r of P.dividers) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    k.boxAt((r.x0 + r.x1) / 2, 0.55, (r.z0 + r.z1) / 2, w, 1.1, d, '#fff6ef', { ink: true });
    k.boxAt((r.x0 + r.x1) / 2, 1.14, (r.z0 + r.z1) / 2, w + 0.04, 0.08, d + 0.04, '#FF4079');
  }
  // produce tables: angled wooden display tables heaped with fruit + veg (decor, no product claims)
  const FRUIT = ['#ff3b30', '#ffcc00', '#34c759', '#ff9500', '#8e44ad', '#2ecc71', '#e74c3c', '#f1c40f', '#a0522d', '#27ae60'];
  P.produce.tables.forEach((t, ti) => {
    k.boxAt(t.x, 0.38, t.z, t.w, 0.76, t.d, '#b9804a', { ink: true });
    // two sloped crate tiers
    for (let s = -1; s <= 1; s += 2) {
      const m = Kit.m(t.x + s * t.w * 0.24, 0.86, t.z, 0, 1, 1, 1, 0, -s * 0.22);
      k.box(t.w * 0.48, 0.14, t.d - 0.1, m, '#d8a56b', { ink: true });
      for (let i = 0; i < 3; i++) {
        const col = FRUIT[(ti * 3 + i + (s > 0 ? 5 : 0)) % FRUIT.length];
        const cz = t.z + (i - 1) * (t.d / 3);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) {
          k.sphere(0.11, Kit.m(t.x + s * (t.w * 0.1 + a * 0.17), 1.02 - a * 0.05, cz + (b - 0.5) * 0.3), col);
        }
      }
    }
  });
  // promo / seasonal floor: pallet displays stacked with cartons (decor)
  const PAL = ['#FF4079', '#FE831B', '#ffd60a', '#2ecc71', '#2ba8ff', '#9b59b6'];
  P.promo.pallets.forEach((pl, i) => {
    k.boxAt(pl.x, 0.07, pl.z, pl.w, 0.14, pl.d, '#c49a6c', { ink: true });
    const col = PAL[i % PAL.length];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2 + (i % 2); c++)
      k.boxAt(pl.x + (a - 0.5) * pl.w * 0.48, 0.14 + 0.2 + c * 0.4, pl.z + (b - 0.5) * pl.d * 0.48, pl.w * 0.46, 0.38, pl.d * 0.46, (a + b + c) % 2 ? col : '#ffffff', { ink: true });
  });
  // flower stand at the entrance
  if (P.produce.flowers) {
    const f = P.produce.flowers;
    k.boxAt(f.x, 0.3, f.z, 1.6, 0.6, 1.6, '#3d3346', { ink: true });
    const PET = ['#ff4f9a', '#ffd23f', '#ff7a45', '#c86bfa', '#ffffff', '#ff2d55'];
    for (let i = 0; i < 9; i++) {
      const bx = f.x + ((i % 3) - 1) * 0.48, bz = f.z + (Math.floor(i / 3) - 1) * 0.48;
      k.cyl(0.17, 0.42, Kit.m(bx, 0.81, bz), '#5ac8fa', 'metal');
      for (let j = 0; j < 4; j++) k.sphere(0.09, Kit.m(bx + Math.cos(j * 1.6 + i) * 0.1, 1.15 + (j % 2) * 0.1, bz + Math.sin(j * 1.6 + i) * 0.1), PET[(i + j) % PET.length]);
    }
  }
  // goods-in: double doors + yellow-black kerb on the back wall
  const gi = P.goodsIn;
  k.boxAt(gi.x, 1.25, gi.z + 0.14, 3.0, 2.5, 0.08, '#c9cfdc', { bucket: 'metal', ink: true });
  k.boxAt(gi.x, 1.25, gi.z + 0.19, 0.04, 2.5, 0.02, INK);
  for (let i = 0; i < 6; i++) k.floor(gi.x - 1.5 + i * 0.5, gi.z + 0.25, gi.x - 1.25 + i * 0.5, gi.z + 0.9, 0.008, '#ffd60a');
  return k.build({ shadows: false });
}

// ---------------------------------------------------------------- signs atlas: department signs + aisle signs
function buildSigns(P: StorePlan, cfg: StoreConfig) {
  const nAisle = P.walkways.length, nDept = P.depts.length;
  const atlas = new LabelAtlas(1024, 200, nAisle + nDept + 2, 4096);
  const q = new QuadBatch();
  const wires = new Kit();
  // department signs: big sticker boards hanging over each zone (walls: on the wall above the fixtures)
  const deptSign = (d: DeptZone) => {
    const sub = d.kind === 'aisles' && d.aisles.length ? `aisle${d.aisles.length > 1 ? 's' : ''} ${Math.min(...d.aisles)}${d.aisles.length > 1 ? `–${Math.max(...d.aisles)}` : ''}` : null;
    const uv = atlas.add((ctx, w, h) => drawSticker(ctx, w, h, d.sign, sub, { chip: d.emoji, chipColor: '#ffffff', brand: d.kind !== 'wall', face: shade(d.color, 0.55).getStyle() }));
    const s = d.signAt;
    const len = d.kind === 'wall' ? Math.min(7.5, Math.max(4.5, (s.rot === 0 ? d.rect.x1 - d.rect.x0 : d.rect.z1 - d.rect.z0) * 0.5)) : d.kind === 'service' ? 5 : Math.min(9, Math.max(5.5, (d.rect.x1 - d.rect.x0) * 0.6));
    const h = len * (200 / 1024);
    if (d.kind === 'wall') {
      // flat on the wall above the fixtures, facing into the store
      const back = d.units.length ? P.units[d.units[0]] : null;
      const wx = back?.wall === 'L' ? P.bounds.xMin + 0.13 : back?.wall === 'R' ? P.bounds.xMax - 0.13 : s.x;
      const wz = back?.wall === 'B' ? P.bounds.zMin + 0.13 : s.z;
      if (d.id === 'produce' && P.produce.rect) {
        // produce gets a hanging sign over the tables too
        const pr = P.produce.rect, cx = (pr.x0 + pr.x1) / 2 - 1.2, cz = (pr.z0 + pr.z1) / 2;
        for (const side of [0, Math.PI]) q.add(Kit.m(cx, 4.3, cz, Math.PI / 2 + side), len, h, uv);
        wires.line(cx, 4.3 + h / 2, cz - len / 3, cx, 6, cz - len / 3); wires.line(cx, 4.3 + h / 2, cz + len / 3, cx, 6, cz + len / 3);
      }
      const along = back?.wall === 'B' ? (d.rect.x0 + d.rect.x1) / 2 : (d.rect.z0 + d.rect.z1) / 2;
      const m = back?.wall === 'B' ? Kit.m(along, 2.95, wz, 0) : Kit.m(wx, 2.95, along, back?.wall === 'L' ? Math.PI / 2 : -Math.PI / 2);
      q.add(m, Math.min(len, 6.2), Math.min(len, 6.2) * (200 / 1024), uv);
      return;
    }
    const y = d.kind === 'service' ? 3.6 : 4.5;
    for (const side of [0, Math.PI]) q.add(Kit.m(s.x, y, s.z + (side ? -0.01 : 0.01), s.rot + side), len, h, uv);
    wires.line(s.x - len * 0.35, y + h / 2, s.z, s.x - len * 0.35, 6.2, s.z); wires.line(s.x + len * 0.35, y + h / 2, s.z, s.x + len * 0.35, 6.2, s.z);
  };
  P.depts.forEach(deptSign);
  // aisle signs: number chip + what's in the aisle, hung at both ends of every walkway
  const unitsById = Object.fromEntries(cfg.units.map((u) => [u.id, u]));
  for (const w of P.walkways) {
    const cats = [...new Set(w.units.map((id) => unitsById[id]?.category).filter(Boolean))] as string[];
    const sub = cats.slice(0, 4).map((c) => `${CAT_EMOJI[c] ?? ''}${catLabel(c)}`.trim()).join(' · ');
    const title = P.depts.find((d) => d.kind === 'aisles' && d.aisles.includes(w.aisleNo))?.sign ?? catLabel(cats[0] ?? 'aisle');
    const uv = atlas.add((ctx, W, H) => drawSticker(ctx, W, H, title, sub || null, { chip: String(w.aisleNo), chipColor: w.fixture === 'freezer' ? '#2ba8ff' : '#FF4079' }));
    const len = Math.min(G.spacing - G.depth - 0.3, 3.9), h = len * (200 / 1024);
    for (const z of [w.z0 + 0.9, w.z1 - 0.9]) {
      for (const side of [0, Math.PI]) q.add(Kit.m(w.x, 3.5, z + (side ? -0.01 : 0.01), side), len, h, uv);
      wires.line(w.x - len * 0.38, 3.5 + h / 2, z, w.x - len * 0.38, 6.2, z); wires.line(w.x + len * 0.38, 3.5 + h / 2, z, w.x + len * 0.38, 6.2, z);
    }
  }
  const tex = atlas.texture();
  const mesh = new THREE.Mesh(q.geometry(), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: THREE.FrontSide }));
  mesh.raycast = noRay;
  const g = new THREE.Group(); g.add(mesh); g.add(wires.build());
  return g;
}

// ---------------------------------------------------------------- filler stock (slots with no planogram)
const FILL: Record<string, { cols: string[]; h: [number, number]; w: [number, number] }> = {
  bws: { cols: ['#7a1f3d', '#2f5d3a', '#c9a227', '#6b3e26', '#1f3b73', '#e8d9b0', '#a83232'], h: [0.3, 0.42], w: [0.1, 0.16] },
  household: { cols: ['#2ba8ff', '#ffd60a', '#34c759', '#ff9500', '#ffffff', '#5856d6', '#ff2d55'], h: [0.22, 0.4], w: [0.16, 0.3] },
  health_beauty: { cols: ['#ff7ac8', '#ffffff', '#a29bfe', '#74b9ff', '#fdcb6e', '#e17055'], h: [0.14, 0.3], w: [0.08, 0.16] },
  baby: { cols: ['#a0e7ff', '#ffd1e8', '#fff3b0', '#b9fbc0', '#ffffff'], h: [0.25, 0.42], w: [0.25, 0.42] },
  pet: { cols: ['#c0392b', '#e67e22', '#16a085', '#8e44ad', '#f1c40f'], h: [0.3, 0.44], w: [0.22, 0.36] },
  home: { cols: ['#ff4079', '#fe831b', '#ffd60a', '#2ecc71', '#3498db', '#9b59b6', '#ffffff'], h: [0.18, 0.4], w: [0.2, 0.4] },
};
const FILL_DEFAULT = { cols: ['#f4b400', '#e8463c', '#7fb8e6', '#8fbf4a', '#a0643a', '#ff7ac8', '#ffffff'], h: [0.16, 0.34] as [number, number], w: [0.14, 0.26] as [number, number] };

function buildFiller(cfg: StoreConfig, P: StorePlan, planogram: Planogram) {
  const mats: THREE.Matrix4[] = [];
  const cols: THREE.Color[] = [];
  const gap = rowGap(cfg);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const u of cfg.units) {
    const p = P.units[u.id]; if (!p) continue;
    const spec = FILL[p.dept] ?? FILL_DEFAULT;
    const base = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotY), new THREE.Vector3(1, 1, 1));
    for (let r = 1; r <= p.rows; r++) {
      if (planogram[`${u.id}-r${r}`]) continue;
      const y = rowY(cfg, r);
      let x = -p.len / 2 + 0.2;
      // runs of the same "product" (2-5 facings) so it reads like a merchandised shelf
      while (x < p.len / 2 - 0.25) {
        const w = spec.w[0] + rnd() * (spec.w[1] - spec.w[0]);
        const h = Math.min(gap - 0.08, spec.h[0] + rnd() * (spec.h[1] - spec.h[0]));
        const c = new THREE.Color(spec.cols[Math.floor(rnd() * spec.cols.length)]);
        const n = 2 + Math.floor(rnd() * 4);
        for (let i = 0; i < n && x + w < p.len / 2 - 0.2; i++) {
          mats.push(base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x + w / 2, y + h / 2, -0.2), new THREE.Quaternion(), new THREE.Vector3(w * 0.92, h, 0.3))));
          cols.push(c);
          x += w;
        }
        x += 0.03;
      }
    }
  }
  if (!mats.length) return null;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), mats.length);
  mats.forEach((m, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, cols[i]); });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.raycast = noRay; mesh.castShadow = false; mesh.receiveShadow = true;
  return mesh;
}

export function Departments({ cfg, planogram }: { cfg: StoreConfig; planogram: Planogram }) {
  const P = storePlan(cfg);
  const stat = useMemo(() => buildStatic(P), [P]);
  const signs = useMemo(() => buildSigns(P, cfg), [P, cfg]);
  const filler = useMemo(() => buildFiller(cfg, P, planogram), [cfg, P, planogram]);
  useEffect(() => () => disposeGroup(stat), [stat]);
  useEffect(() => () => disposeGroup(signs), [signs]);
  useEffect(() => () => { if (filler) { filler.geometry.dispose(); (filler.material as THREE.Material).dispose(); } }, [filler]);
  return (
    <group>
      <primitive object={stat} />
      <primitive object={signs} />
      {filler && <primitive object={filler} />}
    </group>
  );
}

/** one-off sticker sign texture (cached by text) for components that want a plain mesh */
const signCache = new Map<string, THREE.Texture>();
export function cachedSign(key: string, make: () => THREE.Texture) { let t = signCache.get(key); if (!t) { t = make(); signCache.set(key, t); } return t; }
export const promoSign = (text: string, brand: boolean) => cachedSign(`promo:${text}:${brand}`, () => stickerSign([{ text, size: 92 }], { w: 768, h: 200, brand }));

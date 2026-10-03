// Fully stocked shelves. Every product in every slot is packed edge to edge across the bay as real packs:
// columns (facings) x layers (stacked boxes) x units deep, sized from pack dims (width_cm/height_cm/depth_cm when
// the catalogue has them, else a per-category pack scaled by pack size). All packs of a bay share one InstancedMesh
// per atlas page (pack fronts + price tags live on a canvas atlas), so ~2,400 SKUs stay at a few dozen draw calls.
//
// Stock is a module-level registry so the crowd can drive it from the replay:
//   takeFromShelf(slot, code)        → front-most unit vanishes (visible gap), returns where it was (world)
//   restockShelf(slot, code, n?)     → refills (all when n is omitted), with a little pop
//   facingWorld(slot, code)          → where the next unit to be taken sits (for the reach animation)
//   shelfStock / resetShelves / onShelfChange
// Without those calls the shelves fall back to the replay's pick gaps (beats.gaps) and the ops log stock share.
// Visual only: nothing here feeds a stat.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import type { Planogram, Product, StoreConfig, Unit } from '../types';
import { G, parseSlot, rowGap, rowY, shelfSlotFor, slotPlacements, storePlan, unitFrame, unitLength } from '../layout';
import { CHILLED, catColor } from '../theme';
import { bus } from './fx';
import { registerShelf } from './shelfBus';
import { PackAtlas, packBoxGeometry, packColor, packMaterial, packUniforms, tagPlaneGeometry } from './textures';

// ------------------------------------------------------------------ pack dims
export interface PackDims { w: number; h: number; d: number; stack: boolean }
/** w, h, d (metres) of the category's typical pack, and whether packs stack. assumption: visual only, eyeballed UK packs */
const PACK: Record<string, [number, number, number, boolean]> = {
  soft_drinks: [0.075, 0.24, 0.075, false], crisps_savoury: [0.17, 0.25, 0.07, false], snack_bars: [0.13, 0.085, 0.045, true],
  breakfast_cereal: [0.2, 0.29, 0.07, false], yoghurt: [0.12, 0.1, 0.12, true], biscuits_chocolate: [0.16, 0.075, 0.065, true],
  plant_milk_dairy_alt: [0.095, 0.245, 0.065, false], ready_meals_soup: [0.17, 0.08, 0.12, true], bakery_bread: [0.13, 0.14, 0.3, false],
  frozen_icecream: [0.15, 0.11, 0.15, true], hot_drinks: [0.1, 0.16, 0.1, false], confectionery_sweets: [0.13, 0.18, 0.04, false],
};
const KEYWORD: [RegExp, [number, number, number, boolean]][] = [
  [/water|juice|drink|soda|cola|squash|beer|wine|cider|spirit|oil|vinegar/, [0.08, 0.26, 0.08, false]],
  [/milk|cream|smoothie/, [0.095, 0.22, 0.065, false]],
  [/frozen|ice/, [0.17, 0.1, 0.15, true]],
  [/tin|can|soup|bean|tomato/, [0.075, 0.11, 0.075, true]],
  [/fruit|veg|produce|salad/, [0.16, 0.1, 0.12, true]],
  [/cheese|meat|fish|poultry|chilled|deli|ready/, [0.17, 0.06, 0.13, true]],
  [/pasta|rice|grain|flour|sugar|baking/, [0.15, 0.22, 0.06, false]],
  [/sauce|condiment|spread|jam|honey|pickle/, [0.075, 0.13, 0.075, true]],
  [/clean|laundry|household|toilet|paper|tissue/, [0.2, 0.28, 0.12, false]],
  [/health|beauty|toiletr|shampoo|dental|baby/, [0.07, 0.19, 0.05, false]],
  [/pet|dog|cat/, [0.15, 0.2, 0.08, false]],
  [/sweet|confection|chocolate/, [0.13, 0.17, 0.04, false]],
  [/snack|crisp|nut/, [0.16, 0.23, 0.07, false]],
  [/biscuit|cracker/, [0.16, 0.075, 0.065, true]],
  [/cereal|granola|oat/, [0.2, 0.28, 0.07, false]],
  [/bread|bakery|cake/, [0.13, 0.14, 0.28, false]],
  [/tea|coffee|hot/, [0.1, 0.16, 0.1, false]],
];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
/** grams (or ml) of one pack, from whatever field the catalogue has */
export function packAmount(p: Product | undefined): number | null {
  if (!p) return null;
  const g = num(p.pack_g) ?? num(p.pack_size_g) ?? num(p.pack_grams);
  if (g) return g;
  const l = num(p.volume_l); if (l) return l * 1000;
  const q = typeof p.quantity === 'string' ? /(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/i.exec(p.quantity) : null;
  if (!q) return null;
  const v = parseFloat(q[1].replace(',', '.')), u = q[2].toLowerCase();
  return u === 'kg' || u === 'l' ? v * 1000 : u === 'cl' ? v * 10 : v;
}
/** physical pack size used on the shelf. `median` = the category's median pack amount (for scaling) */
export function packDims(p: Product | undefined, cat: string, median?: number | null): PackDims {
  const base = PACK[cat] ?? KEYWORD.find(([re]) => re.test(cat))?.[1] ?? [0.13, 0.2, 0.07, false];
  let [w, h, d] = base;
  const amt = packAmount(p);
  if (amt && median) { const k = Math.min(1.3, Math.max(0.75, Math.cbrt(amt / median))); w *= k; h *= k; d *= k; }
  const cm = (k: string) => { const v = num(p?.[k]); return v ? v / 100 : null; };
  return { w: cm('width_cm') ?? w, h: cm('height_cm') ?? h, d: cm('depth_cm') ?? d, stack: base[3] };
}

// ------------------------------------------------------------------ registry (module-level stock state)
const FRONT = -0.012; // local z of the front of a fully faced stack (shelf lip is at ~+0.03)
const SHELF_D = 0.43; // usable shelf depth (m)
const POP = 0.4;
interface Stack { lx: number; y: number }
interface Group {
  key: string; unitId: string; page: number; centre: THREE.Vector3;
  near: THREE.InstancedMesh; far: THREE.InstancedMesh; nearRecs: Rec[]; farRecs: Rec[];
  nearTile: THREE.InstancedBufferAttribute; farTile: THREE.InstancedBufferAttribute; farTint: THREE.InstancedBufferAttribute; dirty: boolean;
}
interface Rec {
  key: string; slot: string; code: string; unit: Unit; base: THREE.Matrix4; rotY: number;
  w: number; h: number; d: number; D: number; cols: number; layers: number; runL: number; runW: number; y0: number; back: number;
  stacks: Stack[]; total: number; idx: number; group: Group; nearStart: number; farIdx: number;
  removed: number; manualApplied: number; popT: number;
  /** overstock filler on a slot the planogram left empty (visual only, never resolved by code alone) */
  fill?: boolean;
}
export interface ShelfUnitPos { x: number; y: number; z: number; w: number; h: number; d: number; rotY: number; slot: string; code: string; left: number; total: number }

const REG = {
  recs: new Map<string, Rec>(), byCode: new Map<string, Rec[]>(), plan: null as Planogram | null,
  manual: new Map<string, number>(), version: 0, driven: false, listeners: new Set<() => void>(),
};
const bump = () => { REG.version++; REG.listeners.forEach((f) => f()); };
function resolve(slot: string, code: string): Rec | undefined {
  let r = REG.recs.get(`${slot}|${code}`);
  if (!r && REG.plan) r = REG.recs.get(`${shelfSlotFor(REG.plan, slot, code)}|${code}`);
  return r ?? REG.byCode.get(code)?.[0];
}
const _v = new THREE.Vector3();
function unitAt(r: Rec, k: number): ShelfUnitPos | null {
  if (k >= r.total || k < 0) return null;
  const j = Math.floor(k / r.D), s = r.stacks[j];
  const n = r.D - (k - j * r.D);
  _v.set(s.lx, s.y + r.h / 2, r.back + (n - 0.5) * r.d).applyMatrix4(r.base);
  return { x: _v.x, y: _v.y, z: _v.z, w: r.w, h: r.h, d: r.d, rotY: r.rotY, slot: r.slot, code: r.code, left: r.total - k, total: r.total };
}
const pending = (r: Rec) => r.removed + ((REG.manual.get(r.key) ?? 0) - r.manualApplied);

/** a shopper takes `n` packs of `code` from `slot` (feed:… slots resolve to the product's shelf). Returns where the
 *  taken (front-most) unit was, in world space, or null when the product isn't on a shelf / is sold out.
 *  The first call switches the shelves to crowd-driven stock (the replay's own pick gaps are then ignored). */
export function takeFromShelf(slot: string, code: string, n = 1): ShelfUnitPos | null {
  const r = resolve(slot, code); if (!r) return null;
  const pos = unitAt(r, Math.min(r.total - 1, pending(r)));
  if (pending(r) >= r.total) return null;
  REG.manual.set(r.key, Math.min(r.total, (REG.manual.get(r.key) ?? 0) + n));
  REG.driven = true; bump();
  return pos;
}
/** refill `n` packs (all when omitted). a reject that goes back on the shelf is restockShelf(slot, code, 1) */
export function restockShelf(slot: string, code: string, n?: number) {
  const r = resolve(slot, code); if (!r) return;
  const m = REG.manual.get(r.key) ?? 0;
  REG.manual.set(r.key, Math.max(0, m - (n ?? Infinity)));
  bump();
}
/** where the next pack to be taken sits (front-most unit), world space */
export function facingWorld(slot: string, code: string): ShelfUnitPos | null {
  const r = resolve(slot, code); if (!r) return null;
  return unitAt(r, Math.min(r.total - 1, pending(r)));
}
export function shelfStock(slot: string, code: string): { left: number; total: number } | null {
  const r = resolve(slot, code); if (!r) return null;
  return { left: Math.max(0, r.total - pending(r)), total: r.total };
}
/** refill everything (call on seek-back / new run). `driven=false` hands stock back to the replay gaps */
export function resetShelves(driven = REG.driven) { REG.manual.clear(); REG.driven = driven; bump(); }
export function setShelfDriven(on: boolean) { REG.driven = on; bump(); }
export function onShelfChange(fn: () => void) { REG.listeners.add(fn); return () => { REG.listeners.delete(fn); }; }

// ------------------------------------------------------------------ build
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const median = (xs: number[]) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };

function stackMatrix(r: Rec, s: Stack, n: number, k = 1) {
  if (n <= 0) return ZERO;
  _p.set(s.lx, s.y + (r.h * k) / 2, r.back + (n * r.d) / 2);
  _s.set(r.w * 0.965 * (k > 1 ? 1 + (k - 1) * 0.5 : 1), r.h * 0.985 * k, n * r.d);
  return _m.compose(_p, _q.identity(), _s).premultiply(r.base);
}
function farMatrix(r: Rec, left: number) {
  if (left <= 0) return ZERO;
  const dd = r.D * r.d * Math.max(0.15, left / r.total);
  _p.set(r.runL + r.runW / 2, r.y0 + (r.layers * r.h) / 2, r.back + dd / 2);
  _s.set(r.runW * 0.995, r.layers * r.h * 0.985, dd);
  return _m.compose(_p, _q.identity(), _s).premultiply(r.base);
}
/** write a rec's stacks for `removed` taken packs; k = restock pop scale */
function applyRec(r: Rec, removed: number, k = 1) {
  const g = r.group;
  for (let j = 0; j < r.stacks.length; j++) {
    const taken = Math.min(r.D, Math.max(0, removed - j * r.D));
    const n = r.D - taken;
    g.near.setMatrixAt(r.nearStart + j, stackMatrix(r, r.stacks[j], n, k));
    g.nearTile.setZ(r.nearStart + j, n);
  }
  g.far.setMatrixAt(r.farIdx, farMatrix(r, r.total - removed));
  r.removed = removed; g.dirty = true;
}

interface Built {
  groups: Group[]; recs: Rec[]; dividers: THREE.InstancedMesh; strips: THREE.InstancedMesh; tags: THREE.InstancedMesh[];
  geoms: THREE.BufferGeometry[]; mats: THREE.Material[];
}

function build(cfg: StoreConfig, planogram: Planogram, products: Record<string, Product>, atlas: PackAtlas, pageMat: (page: number) => THREE.Material, box: THREE.BufferGeometry, plane: THREE.BufferGeometry): Built {
  const gap = rowGap(cfg);
  const units = new Map(cfg.units.map((u) => [u.id, u]));
  // category medians of pack amount (for size scaling)
  const amounts = new Map<string, number[]>();
  for (const set of Object.values(planogram)) for (const c of set?.products ?? []) {
    const p = products[c]; const a = packAmount(p); if (a && p) (amounts.get(p.category) ?? amounts.set(p.category, []).get(p.category)!).push(a);
  }
  const med = new Map([...amounts].map(([k, v]) => [k, median(v)]));

  // pass 1: recs (no meshes yet)
  type Proto = Omit<Rec, 'group' | 'nearStart' | 'farIdx'> & { page: number; tint: THREE.Color; glow: number; cell: NonNullable<ReturnType<PackAtlas['cell']>> };
  const protos: Proto[] = [];
  const divs: THREE.Matrix4[] = [];
  const strips: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const tags: { m: THREE.Matrix4; cell: Proto['cell']; idx: number }[] = [];
  const unitBase = new Map<string, { base: THREE.Matrix4; rotY: number }>();
  const slots = Object.keys(planogram).sort((a, b) => {
    const A = parseSlot(a), B = parseSlot(b);
    const ua = cfg.units.findIndex((u) => u.id === A.unit), ub = cfg.units.findIndex((u) => u.id === B.unit);
    return ua - ub || A.row - B.row;
  });
  const plan = storePlan(cfg);
  // every shelf the fixtures actually draw, so rows the planogram left empty still get stock (see filler below)
  const allSlots = new Set(slots);
  for (const u of cfg.units) { const up = plan.units[u.id]; if (!up) continue; for (let r = 1; r <= up.rows; r++) allSlots.add(`${u.id}-r${r}`); }
  const ordered = [...allSlots].sort((a, b) => {
    const A = parseSlot(a), B = parseSlot(b);
    return cfg.units.findIndex((u) => u.id === A.unit) - cfg.units.findIndex((u) => u.id === B.unit) || A.row - B.row;
  });
  /** an empty shelf takes overstock of the nearest stocked row of the same unit (assumption: visual only, UK
   *  gondolas keep cases / back-up stock on bare base decks; never a planogram fact, never counted in a stat) */
  const donor = (unit: string, row: number) => {
    let best: { set: NonNullable<Planogram[string]>; dr: number } | null = null;
    for (let r = 1; r <= cfg.rows_per_unit; r++) {
      const s2 = planogram[`${unit}-r${r}`];
      if (r === row || !s2?.products?.length) continue;
      const dr = Math.abs(r - row) + (r < row ? 0.1 : 0); // prefer the row below's twin above
      if (!best || dr < best.dr) best = { set: s2, dr };
    }
    return best?.set ?? null;
  };
  for (const slot of ordered) {
    const { unit, row } = parseSlot(slot);
    const u = units.get(unit); if (!u) continue;
    const up = plan.units[u.id];
    if (up && row > up.rows) continue;
    let set = planogram[slot];
    let fill = false;
    if (!set?.products?.length) { const d = donor(unit, row); if (!d) continue; set = d; fill = true; }
    let ub = unitBase.get(u.id);
    if (!ub) {
      const f = unitFrame(cfg, u);
      ub = { base: new THREE.Matrix4().compose(new THREE.Vector3(f.x, 0, f.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rotY), new THREE.Vector3(1, 1, 1)), rotY: f.rotY };
      unitBase.set(u.id, ub);
    }
    const ux = u as Unit & { fridge?: boolean; freezer?: boolean };
    const cold = ux.fridge || ux.freezer || CHILLED.has(set.category ?? u.category) ? 1 : 0;
    const y0 = rowY(cfg, row);
    const room = (row === 1 ? Math.max(gap, G.height - y0 - 0.06) : gap) - 0.07;
    const pl = slotPlacements(slot, set);
    const runTotal = pl.reduce((s, p) => s + p.width * p.facings, 0);
    if (!runTotal) continue;
    const L = up?.len ?? unitLength(u.id);
    const usable = L - (up?.fixture === 'gondola' ? 0.12 : 0.2); // inside the side panels
    const scale = usable / runTotal; // fill the bay edge to edge whatever slotPlacements leaves free
    // shelf-edge strip in the department colour
    strips.push({
      m: new THREE.Matrix4().compose(new THREE.Vector3(0, y0 - 0.028, 0.06), new THREE.Quaternion(), new THREE.Vector3(L, 0.07, 0.014)).premultiply(ub.base),
      c: new THREE.Color(catColor(set.category ?? u.category)).lerp(new THREE.Color('#ffffff'), 0.12),
    });
    let maxH = 0.1;
    const slotProtos: Proto[] = [];
    for (const p of pl) {
      const prod = products[p.code] ?? ({ code: p.code, name: p.code, brand: '', category: set.category ?? u.category, role: '', price_gbp: 0 } as Product);
      const cat = prod.category || set.category || u.category;
      const dm = packDims(prod, cat, med.get(cat));
      const h = Math.min(dm.h, room), d = Math.min(dm.d, SHELF_D);
      const runW = p.width * p.facings * scale, runL = (p.lx - (p.width * p.facings) / 2) * scale;
      const cols = Math.max(1, Math.round(runW / dm.w)), w = runW / cols;
      // boxes/tubs stack up to 3 high; jars, loaves, small bags 2 high when they fit with headroom; tall bottles/bags stand alone
      const layers = Math.max(1, dm.stack ? Math.min(3, Math.floor(room / h)) : Math.min(2, Math.floor((room * 0.95) / h)));
      const D = Math.max(1, Math.floor(SHELF_D / d));
      maxH = Math.max(maxH, layers * h);
      // take order: centre column first, outward; top layer first within a column
      const order = Array.from({ length: cols }, (_, c) => c).sort((a, b) => Math.abs(a - (cols - 1) / 2) - Math.abs(b - (cols - 1) / 2) || a - b);
      const stacks: Stack[] = [];
      for (const c of order) for (let l = layers - 1; l >= 0; l--) stacks.push({ lx: runL + (c + 0.5) * w, y: y0 + l * h });
      const tagInfo = {
        price: prod.price_gbp, role: prod.role,
        assumption: typeof prod.price_source === 'string' ? /^assum|estimat|model/i.test(prod.price_source) : !prod.price_gbp,
        unit: num(prod.price_per_100g) ? `£${Number(prod.price_per_100g).toFixed(2)}/100g` : num(prod.unit_price_gbp_per_kg) ? `£${Number(prod.unit_price_gbp_per_kg).toFixed(2)}/kg` : num(prod.unit_price_gbp_per_l) ? `£${Number(prod.unit_price_gbp_per_l).toFixed(2)}/l` : num(prod.price_per_kg_gbp) ? `£${Number(prod.price_per_kg_gbp).toFixed(2)}/kg` : num(prod.price_per_litre_gbp) ? `£${Number(prod.price_per_litre_gbp).toFixed(2)}/l` : null,
      };
      const cell = atlas.cell(prod.code) ?? atlas.add(prod, tagInfo);
      const proto: Proto = {
        key: `${slot}|${p.code}`, slot, code: p.code, fill, unit: u, base: ub.base, rotY: ub.rotY,
        w, h, d, D, cols, layers, runL, runW, y0, back: FRONT - D * d, stacks, total: stacks.length * D, idx: cell.idx,
        removed: 0, manualApplied: 0, popT: -1, page: cell.page, tint: new THREE.Color(packColor(prod)).multiplyScalar(0.82), glow: cold, cell,
      };
      slotProtos.push(proto); protos.push(proto);
      const tw = Math.min(runW - 0.02, 0.13), th = tw * (atlas.tagH / atlas.cellW);
      if (!fill) tags.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(runL + 0.012 + tw / 2, y0 - 0.028, 0.0675), new THREE.Quaternion(), new THREE.Vector3(tw, th, 1)).premultiply(ub.base), cell, idx: cell.idx });
    }
    // dividers: a clear fin at every run edge
    const fh = Math.min(room, maxH + 0.04);
    const edges = new Set<number>();
    for (const r of slotProtos) { edges.add(+r.runL.toFixed(3)); edges.add(+(r.runL + r.runW).toFixed(3)); }
    for (const lx of edges) divs.push(new THREE.Matrix4().compose(new THREE.Vector3(lx, y0 + fh / 2, FRONT - SHELF_D / 2 + 0.01), new THREE.Quaternion(), new THREE.Vector3(0.012, fh, SHELF_D + 0.02)).premultiply(ub.base));
  }

  // pass 2: one near + one far InstancedMesh per (unit, atlas page)
  const byGroup = new Map<string, Proto[]>();
  for (const p of protos) { const k = `${p.unit.id}|${p.page}`; (byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(p); }
  const groups: Group[] = []; const recs: Rec[] = [];
  const geoms: THREE.BufferGeometry[] = [];
  for (const [key, list] of byGroup) {
    const nN = list.reduce((s, p) => s + p.stacks.length, 0), nF = list.length;
    const mk = (n: number) => {
      const g = new THREE.BufferGeometry(); g.index = box.index;
      for (const a of ['position', 'normal', 'uv', 'aFace']) g.setAttribute(a, box.getAttribute(a));
      const cell = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), tile = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      g.setAttribute('aCell', cell); g.setAttribute('aTint', tint); g.setAttribute('aTile', tile);
      geoms.push(g);
      const m = new THREE.InstancedMesh(g, pageMat(list[0].page), n);
      return { m, cell, tint, tile };
    };
    const N = mk(nN), F = mk(nF);
    const grp: Group = { key, unitId: list[0].unit.id, page: list[0].page, centre: new THREE.Vector3(), near: N.m, far: F.m, nearRecs: [], farRecs: [], nearTile: N.tile, farTile: F.tile, farTint: F.tint, dirty: true };
    let i = 0;
    list.forEach((p, fi) => {
      const { page: _pg, tint, glow, cell, ...rest } = p; void _pg;
      const r: Rec = { ...rest, group: grp, nearStart: i, farIdx: fi };
      for (let j = 0; j < p.stacks.length; j++, i++) {
        N.cell.setXYZW(i, ...cell.front); N.tint.setXYZW(i, tint.r, tint.g, tint.b, glow); N.tile.setXYZW(i, 1, 1, r.D, r.idx);
        grp.nearRecs.push(r);
      }
      F.cell.setXYZW(fi, cell.front[0], cell.front[1], -1, cell.front[3]); const av = atlas.avg(p.code) ?? tint; F.tint.setXYZW(fi, av.r, av.g, av.b, glow); F.tile.setXYZW(fi, r.cols, r.layers, r.D, r.idx);
      grp.farRecs.push(r);
      applyRec(r, 0);
      recs.push(r);
    });
    for (const m of [N.m, F.m]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere(); m.castShadow = false; m.receiveShadow = false;
    }
    grp.centre.copy(F.m.boundingSphere!.center);
    F.m.visible = false;
    groups.push(grp);
  }

  // dividers, strips, tags
  const divMat = new THREE.MeshStandardMaterial({ color: '#efe7ec', roughness: 0.15, transparent: true, opacity: 0.55, depthWrite: false });
  const dividers = new THREE.InstancedMesh(box, divMat, Math.max(1, divs.length));
  divs.forEach((m, i) => dividers.setMatrixAt(i, m)); dividers.count = divs.length; dividers.computeBoundingSphere(); dividers.raycast = () => null;
  const stripMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45 });
  const stripMesh = new THREE.InstancedMesh(box, stripMat, Math.max(1, strips.length));
  strips.forEach((s, i) => { stripMesh.setMatrixAt(i, s.m); stripMesh.setColorAt(i, s.c); }); stripMesh.count = strips.length;
  stripMesh.computeBoundingSphere(); stripMesh.raycast = () => null;
  const tagByPage = new Map<number, typeof tags>();
  for (const t of tags) (tagByPage.get(t.cell.page) ?? tagByPage.set(t.cell.page, []).get(t.cell.page)!).push(t);
  const tagMeshes: THREE.InstancedMesh[] = [];
  for (const [page, list] of tagByPage) {
    const g = new THREE.BufferGeometry(); g.index = plane.index;
    for (const a of ['position', 'normal', 'uv', 'aFace']) g.setAttribute(a, plane.getAttribute(a));
    const cell = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4), tint = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4), tile = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
    list.forEach((t, i) => { cell.setXYZW(i, ...t.cell.tag); tint.setXYZW(i, 1, 1, 1, 0); tile.setXYZW(i, 1, 1, 0, t.idx); });
    g.setAttribute('aCell', cell); g.setAttribute('aTint', tint); g.setAttribute('aTile', tile); geoms.push(g);
    const m = new THREE.InstancedMesh(g, pageMat(page), list.length);
    list.forEach((t, i) => m.setMatrixAt(i, t.m)); m.computeBoundingSphere(); m.raycast = () => null;
    tagMeshes.push(m);
  }
  return { groups, recs, dividers, strips: stripMesh, tags: tagMeshes, geoms, mats: [divMat, stripMat] };
}

// ------------------------------------------------------------------ component
export interface ShelfFillProps {
  cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>;
  /** replay pick/reject gaps per product (beats.gaps); ignored once the crowd drives stock via takeFromShelf */
  gaps?: Record<string, [number, number][]>;
  timeRef: { current: number }; live: boolean;
  selectedProduct: string | null; onProduct: (code: string) => void; editMode: boolean; onSlot: (slot: string) => void;
  /** camera distance (m) beyond which a bay draws one box per product run instead of every pack */
  lodDistance?: number;
  /** shelf-edge strips, price tags and dividers (turn off if Store draws its own) */
  decor?: boolean;
}

export function ShelfFill({ cfg, planogram, products, gaps, timeRef, live, selectedProduct, onProduct, editMode, onSlot, lodDistance = 46, decor = true }: ShelfFillProps) {
  const camera = useThree((s) => s.camera);
  // the atlas survives planogram edits (same products, new places); rebuilt when the catalogue changes
  const atlasKit = useMemo(() => {
    const codes = new Set<string>(); for (const s of Object.values(planogram)) for (const c of s?.products ?? []) codes.add(c);
    const atlas = new PackAtlas(codes.size);
    const mats = new Map<number, THREE.Material>();
    const pageMat = (page: number) => { let m = mats.get(page); if (!m) { m = packMaterial(atlas.textures[page]); mats.set(page, m); } return m; };
    return { atlas, mats, pageMat, box: packBoxGeometry(), plane: tagPlaneGeometry() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, cfg]);
  useEffect(() => {
    const { atlas } = atlasKit;
    let off = false;
    document.fonts?.ready.then(() => { if (!off) atlas.redrawFallbacks(); }).catch(() => {});
    return () => { off = true; atlas.dispose(); atlasKit.mats.forEach((m) => m.dispose()); atlasKit.box.dispose(); atlasKit.plane.dispose(); };
  }, [atlasKit]);

  const built = useMemo(() => build(cfg, planogram, products, atlasKit.atlas, atlasKit.pageMat, atlasKit.box, atlasKit.plane), [cfg, planogram, products, atlasKit]);
  useEffect(() => {
    REG.recs = new Map(built.recs.map((r) => [r.key, r]));
    REG.byCode = new Map();
    for (const r of built.recs) if (!r.fill) (REG.byCode.get(r.code) ?? REG.byCode.set(r.code, []).get(r.code)!).push(r);
    REG.plan = planogram;
    // the crowd and staff talk to shelves through shelfBus (they never import this file)
    const unreg = registerShelf({
      take: (slot, code) => { const p = takeFromShelf(slot, code); return p ? new THREE.Vector3(p.x, p.y, p.z) : null; },
      restock: (slot, code, n) => restockShelf(slot, code, n),
    });
    return () => {
      unreg();
      built.geoms.forEach((g) => g.dispose()); built.mats.forEach((m) => m.dispose());
      const r0 = built.recs[0]; if (r0 && REG.recs.get(r0.key) === r0) { REG.recs = new Map(); REG.byCode = new Map(); }
    };
  }, [built, planogram]);

  const lastV = useRef(-1), lastSig = useRef(''), lastAvg = useRef(-1);
  // dev only: ?shelfcam=x,y,z,tx,ty,tz pins the camera for headless shelf screenshots
  const pin = useMemo(() => { try { const v = new URLSearchParams(location.search).get('shelfcam'); const n = v?.split(',').map(Number); return n && n.length === 6 && n.every(Number.isFinite) ? n : null; } catch { return null; } }, []);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (!pin) return;
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = (...a) => { camera.position.set(pin[0], pin[1], pin[2]); camera.lookAt(pin[3], pin[4], pin[5]); camera.updateMatrixWorld(); prev.apply(scene, a); };
    return () => { scene.onBeforeRender = prev; };
  }, [pin, scene, camera]);
  useFrame((state) => {
    const now = state.clock.elapsedTime, t = timeRef.current;
    packUniforms.uTime.value = now;
    packUniforms.uSel.value = selectedProduct ? atlasKit.atlas.cell(selectedProduct)?.idx ?? -1 : -1;
    atlasKit.atlas.tick(now);
    // far LOD colours follow the photo averages as product images stream in
    if (atlasKit.atlas.avgVersion !== lastAvg.current) {
      lastAvg.current = atlasKit.atlas.avgVersion;
      for (const g of built.groups) {
        g.farRecs.forEach((r, i) => { const c = atlasKit.atlas.avg(r.code); if (c) g.farTint.setXYZ(i, c.r, c.g, c.b); });
        g.farTint.needsUpdate = true;
      }
    }
    // LOD per bay
    for (const g of built.groups) {
      const near = camera.position.distanceTo(g.centre) < lodDistance;
      g.near.visible = near; g.far.visible = !near;
    }
    // stock: crowd takes (module registry) + replay gaps (when not crowd-driven) + ops stock share
    const useGaps = live && !REG.driven && gaps;
    const hidden = new Map<string, number>();
    let sig = `${REG.version}|${live}`;
    if (useGaps) for (const code in gaps) {
      let n = 0; for (const [a, b] of gaps[code]) if (t >= a && t < b) n++;
      if (n) { hidden.set(code, n); sig += `${code}${n}`; }
    }
    const stock = live ? bus.stock : null;
    if (stock) sig += `|s${bus.opsMin}`;
    const animating = built.recs.some((r) => r.popT >= 0);
    if (sig !== lastSig.current || lastV.current !== REG.version || animating) {
      lastSig.current = sig; lastV.current = REG.version;
      const firstOf = new Set<string>();
      for (const r of built.recs) {
        const manual = REG.manual.get(r.key) ?? 0;
        let want = manual;
        if (live) {
          if (!r.fill && !firstOf.has(r.code)) { firstOf.add(r.code); want += hidden.get(r.code) ?? 0; }
          const frac = stock?.[r.slot];
          if (frac !== undefined) want = Math.max(want, Math.round((1 - Math.max(0, Math.min(1, frac))) * r.total));
        }
        want = Math.max(0, Math.min(r.total, want));
        r.manualApplied = manual;
        if (want < r.removed) r.popT = now;
        if (r.popT >= 0) {
          const k = (now - r.popT) / POP;
          if (k >= 1) { r.popT = -1; applyRec(r, want); } else applyRec(r, want, 1 + Math.sin(k * Math.PI) * 0.18);
        } else if (want !== r.removed) applyRec(r, want);
      }
    }
    for (const g of built.groups) if (g.dirty) {
      g.dirty = false;
      g.near.instanceMatrix.needsUpdate = true; g.far.instanceMatrix.needsUpdate = true; g.nearTile.needsUpdate = true;
    }
  });

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const recs = (e.object.userData.recs as Rec[] | undefined);
    const r = e.instanceId !== undefined ? recs?.[e.instanceId] : undefined;
    if (!r) return;
    if (editMode) onSlot(r.slot); else onProduct(r.code);
  };
  const over = () => (document.body.style.cursor = 'pointer');
  const out = () => (document.body.style.cursor = '');
  useEffect(() => { for (const g of built.groups) { g.near.userData.recs = g.nearRecs; g.far.userData.recs = g.farRecs; } }, [built]);

  return (
    <group>
      {built.groups.map((g) => (
        <group key={g.key}>
          <primitive object={g.near} onClick={click} onPointerOver={over} onPointerOut={out} />
          <primitive object={g.far} onClick={click} onPointerOver={over} onPointerOut={out} />
        </group>
      ))}
      {decor && <primitive object={built.strips} />}
      {decor && built.tags.map((m, i) => <primitive key={i} object={m} />)}
      {decor && <primitive object={built.dividers} />}
    </group>
  );
}

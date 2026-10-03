// The supermarket, laid out like a UK superstore by layout.storePlan: shopfront with sliding doors + EAS gates,
// produce + flowers at the entrance, bakery and chilled multidecks round the walls (the "racetrack"), numbered
// gondola aisles with end caps, glass-door freezer aisles, beer/wine/spirits by the tills, a checkout bank of staffed
// tills + self-checkout pods, a café, goods-in and a stockroom. Department floors, signs and dividers are in
// Departments.tsx. Static fixtures are merged per material (storeKit) and shelf-edge price rails share one atlas
// texture, so a 150+ unit superstore is a few dozen draw calls. Everything solid is a fixed rapier collider.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { Planogram, Product, StoreConfig } from '../types';
import { G, rowGap, rowY, slotPlacements, storePlan, unitFrame, type Lane, type StorePlan, type UnitPlace } from '../layout';
import { BRAND_A, CAT_EMOJI, INK, catColor, catLabel } from '../theme';
import { canvasTex, floorTexture, productMaterials, stickerSign } from './textures';
import { bus } from './fx';
import { Kit, LabelAtlas, QuadBatch, disposeGroup, shade } from './storeKit';
import { Departments, promoSign } from './Departments';

export interface StoreProps {
  cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>;
  onProduct: (code: string) => void;
  editMode: boolean; editSel: string | null; onSlot: (slot: string) => void; changed: Set<string>;
  heat: Record<string, string> | null;
}

const noRay = () => null;
const WHITE = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 });
const INKMAT = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.5 });
const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const unitM = (p: UnitPlace) => Kit.m(p.x, 0, p.z, p.rotY);
const rowsOf = (cfg: StoreConfig, p?: UnitPlace) => Array.from({ length: p ? p.rows : cfg.rows_per_unit }, (_, i) => i + 1);

// ---------------------------------------------------------------- fixtures (merged)
function buildFixtures(cfg: StoreConfig, P: StorePlan) {
  const k = new Kit();
  const H = G.height;
  let L = G.unitLen, rows = rowsOf(cfg);
  const shelves = (at: (x: number, y: number, z: number) => THREE.Matrix4, board: string, lip = '#ffffff') => {
    for (const r of rows) {
      const y = rowY(cfg, r);
      k.box(L, 0.05, 0.5, at(0, y - 0.03, -0.22), board);
      k.box(L, 0.075, 0.02, at(0, y - 0.03, 0.04), lip);
    }
  };
  for (const u of cfg.units) {
    const p = P.units[u.id]; if (!p) continue;
    const M = unitM(p);
    const at = (x: number, y: number, z: number) => M.clone().multiply(T(x, y, z));
    const cat = catColor(u.category);
    L = p.len; rows = rowsOf(cfg, p);
    // units with fewer shelves than the store (e.g. produce tables): solid base under the lowest one
    if (p.rows < cfg.rows_per_unit) { const yb = rowY(cfg, p.rows) - 0.06; k.box(L - 0.04, yb, 0.56, at(0, yb / 2, -0.2), p.fixture === 'produce' ? '#a86b3c' : '#e9dfd8', { ink: true }); }
    if (p.fixture === 'gondola') {
      k.box(L, H, 0.03, at(0, H / 2 + 0.05, -0.45), shade(cat, 0.82));
      shelves(at, '#f3ece6');
      for (const s of [-1, 1]) k.box(0.05, H, 0.5, at(s * (L / 2 - 0.025), H / 2 + 0.05, -0.22), '#d9ccd4');
    } else if (p.fixture === 'freezer') {
      k.box(L, H, 0.03, at(0, H / 2 + 0.05, -0.45), '#e3f6ff');
      shelves(at, '#e9f6ff');
      const nd = 4, dw = L / nd;
      for (let i = 0; i < nd; i++) {
        const dx = -L / 2 + (i + 0.5) * dw;
        k.box(dw - 0.05, H - 0.08, 0.03, at(dx, H / 2 + 0.06, 0.13), '#d6f3ff', { bucket: 'glass', ink: true });
        k.box(0.04, 0.7, 0.05, at(dx + dw / 2 - 0.16, 1.15, 0.17), '#d6d9e2', { bucket: 'metal' });
      }
      k.box(L, 0.08, 0.06, at(0, H + 0.06, 0.1), '#8fdcff', { bucket: 'glow' });
      k.box(L, 0.12, 0.6, at(0, 0.06, -0.15), '#e9eef5');
    } else if (p.fixture === 'multideck') {
      k.box(L, H, 0.03, at(0, H / 2 + 0.05, -0.45), '#dcf1ff');
      shelves(at, '#e9f6ff', '#ffffff');
      for (const s of [-1, 1]) k.box(0.07, H + 0.32, 0.7, at(s * (L / 2 - 0.035), (H + 0.32) / 2, -0.12), '#ffffff', { ink: true });
      k.box(L, 0.32, 0.66, at(0, H + 0.16, -0.14), '#ffffff', { ink: true });
      k.box(L - 0.1, 0.05, 0.03, at(0, H - 0.03, 0.17), '#8fe3ff', { bucket: 'glow' });
      k.box(L, 0.14, 0.64, at(0, 0.07, -0.13), '#3d3346');
      k.box(L - 0.2, 0.04, 0.12, at(0, 0.16, 0.12), '#c9cfdc', { bucket: 'metal' }); // air-curtain grille
    } else if (p.fixture === 'produce') {
      k.box(L, H, 0.03, at(0, H / 2 + 0.05, -0.45), '#d7ecc6');
      for (const r of rows) {
        const y = rowY(cfg, r);
        k.box(L - 0.06, 0.1, 0.52, at(0, y - 0.05, -0.2), '#c98f55', { ink: true });
        k.box(L - 0.06, 0.16, 0.03, at(0, y + 0.02, 0.06), '#b5793f');
      }
      for (const s of [-1, 1]) k.box(0.08, H + 0.4, 0.6, at(s * (L / 2 - 0.04), (H + 0.4) / 2, -0.17), '#a86b3c', { ink: true });
      // striped awning
      const n = 10;
      for (let i = 0; i < n; i++) {
        const m = at(-L / 2 + (i + 0.5) * (L / n), H + 0.3, 0.0).multiply(new THREE.Matrix4().makeRotationX(0.38));
        k.box(L / n, 0.05, 0.75, m, i % 2 ? '#ffffff' : '#2fa84f');
      }
    } else { // bakery: warm wooden bread racks
      k.box(L, H, 0.03, at(0, H / 2 + 0.05, -0.45), '#c8915a');
      shelves(at, '#d9a86c', '#f6dcb4');
      for (const s of [-1, 1]) k.box(0.08, H + 0.35, 0.6, at(s * (L / 2 - 0.04), (H + 0.35) / 2, -0.17), '#9c6436', { ink: true });
      k.box(L, 0.3, 0.6, at(0, H + 0.2, -0.17), '#9c6436', { ink: true });
    }
  }
  // gondola runs: plinth, centre spine, end panels, blank backs on outer faces, brand trim
  for (const g of P.gondolas) {
    const len = g.z1 - g.z0, mid = (g.z0 + g.z1) / 2;
    k.boxAt(g.x, 0.06, mid, G.depth, 0.12, len + 0.1, '#e9dfd8', { ink: true });
    k.boxAt(g.x, H / 2, mid, 0.08, H, len, g.frozen ? '#eaf7ff' : '#fff6ef');
    for (const s of [-1, 1]) k.boxAt(g.x, (H + 0.1) / 2, mid + s * (len / 2 + 0.03), G.depth, H + 0.1, 0.06, '#ffffff', { ink: true });
    if (!g.faces.L) k.boxAt(g.x - G.depth / 2 + 0.03, H / 2 + 0.05, mid, 0.04, H, len, '#f6efe9', { ink: true });
    if (!g.faces.R) k.boxAt(g.x + G.depth / 2 - 0.03, H / 2 + 0.05, mid, 0.04, H, len, '#f6efe9', { ink: true });
    k.boxAt(g.x, H + 0.08, mid, G.depth + 0.04, 0.08, len + 0.12, g.frozen ? '#2ba8ff' : BRAND_A);
  }
  return k.build({ shadows: true });
}

// ---------------------------------------------------------------- end caps (merged) + promo headers
const PROMOS = ['half price', '£1 each', '3 for 2', 'new in', 'save 25%', 'member price'];
function buildEndcaps(P: StorePlan) {
  const k = new Kit();
  const signs: Record<string, QuadBatch> = {};
  let i = 0;
  for (const g of P.gondolas) for (const s of [-1, 1]) {
    const z = s < 0 ? g.z0 - G.endcapDepth / 2 - 0.06 : g.z1 + G.endcapDepth / 2 + 0.06;
    const rot = s < 0 ? Math.PI : 0;
    const M = Kit.m(g.x, 0, z, rot);
    const at = (x: number, y: number, zz: number) => M.clone().multiply(T(x, y, zz));
    const dept = P.depts.find((d) => d.kind === 'aisles' && g.x >= d.rect.x0 - 1 && g.x <= d.rect.x1 + 1 && z >= d.rect.z0 - 1.5 && z <= d.rect.z1 + 1.5);
    const col = dept?.color ?? '#ffd6e0';
    k.box(G.depth + 0.1, 0.5, G.endcapDepth, at(0, 0.25, 0), '#ffffff', { ink: true });
    k.box(G.depth + 0.1, 1.9, 0.06, at(0, 0.95 + 0.5, -G.endcapDepth / 2 + 0.03), shade(col, -0.1));
    for (const [ty, tz, n] of [[0.5, 0.12, 3], [0.9, -0.08, 3], [1.3, -0.22, 2]] as const) {
      for (let j = 0; j < n; j++) {
        const cx = (j - (n - 1) / 2) * 0.32;
        k.box(0.28, 0.28, 0.26, at(cx, ty + 0.14, tz), (i + j) % 3 === 0 ? '#ffffff' : shade(col, -0.35 + ((j + i) % 2) * 0.2), { ink: true });
      }
    }
    const text = PROMOS[i % PROMOS.length];
    (signs[text] ??= new QuadBatch()).add(at(0, 2.1, -G.endcapDepth / 2 + 0.08), 1.25, 1.25 * (200 / 768), [0, 0, 1, 1]);
    i++;
  }
  const grp = k.build({ shadows: true });
  Object.entries(signs).forEach(([text, q], j) => {
    const m = new THREE.Mesh(q.geometry(), new THREE.MeshBasicMaterial({ map: promoSign(text, j % 2 === 0), transparent: true, alphaTest: 0.05 }));
    m.raycast = noRay; grp.add(m);
  });
  return grp;
}

// ---------------------------------------------------------------- shelf-edge price rails + wall headers (atlases)
function drawRail(ctx: CanvasRenderingContext2D, W: number, H: number, slot: string, set: Planogram[string] | undefined, products: Record<string, Product>, changed: boolean, heat: Record<string, string> | null, len: number) {
  ctx.fillStyle = changed ? '#FFE14D' : '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H * 0.08); ctx.fillRect(0, H * 0.92, W, H * 0.08);
  const sx = W / len;
  for (const p of slotPlacements(slot, set)) {
    const cx = (p.lx + len / 2) * sx, pw = p.width * p.facings * sx;
    if (heat?.[p.code]) { ctx.fillStyle = heat[p.code]; ctx.fillRect(cx - pw / 2 + 2, H * 0.08, pw - 4, H * 0.2); }
    const price = products[p.code]?.price_gbp;
    const txt = price ? `£${Number(price).toFixed(2)}` : '£?';
    ctx.font = `800 ${Math.round(H * 0.52)}px "Baloo 2", system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tw = Math.min(pw - 3, ctx.measureText(txt).width + H * 0.34);
    const role = products[p.code]?.role;
    ctx.fillStyle = role === 'challenger' ? '#FFE14D' : role === 'own_label' ? '#ffe4ec' : '#fff8ef';
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(2, H * 0.06);
    ctx.beginPath(); ctx.roundRect(cx - tw / 2, H * 0.27, tw, H * 0.62, H * 0.16); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.fillText(txt, cx, H * 0.6, tw - 4);
  }
}
function buildRails(cfg: StoreConfig, P: StorePlan, planogram: Planogram, products: Record<string, Product>, changed: Set<string>, heat: Record<string, string> | null) {
  const slots: { slot: string; p: UnitPlace; row: number }[] = [];
  for (const u of cfg.units) { const p = P.units[u.id]; if (!p) continue; for (const r of rowsOf(cfg, p)) { const slot = `${u.id}-r${r}`; if (planogram[slot]) slots.push({ slot, p, row: r }); } }
  const cw = slots.length > 1024 ? 256 : 512;
  const atlas = new LabelAtlas(cw, cw / 16, slots.length, 4096);
  const q = new QuadBatch();
  for (const s of slots) {
    const uv = atlas.add((ctx, w, h) => drawRail(ctx, w, h, s.slot, planogram[s.slot], products, changed.has(s.slot), heat, s.p.len));
    q.add(unitM(s.p).multiply(T(0, rowY(cfg, s.row) - 0.03, 0.052)), s.p.len, 0.075, uv);
  }
  const mesh = new THREE.Mesh(q.geometry(), new THREE.MeshStandardMaterial({ map: atlas.texture(), roughness: 0.5 }));
  mesh.raycast = noRay;
  return mesh;
}
function buildHeaders(cfg: StoreConfig, P: StorePlan) {
  const wallUnits = cfg.units.filter((u) => P.units[u.id] && P.units[u.id].fixture !== 'gondola' && P.units[u.id].fixture !== 'freezer');
  if (!wallUnits.length) return null;
  const atlas = new LabelAtlas(512, 96, wallUnits.length, 4096);
  const q = new QuadBatch();
  const cache = new Map<string, [number, number, number, number]>();
  for (const u of wallUnits) {
    const p = P.units[u.id];
    const key = `${u.category}|${p.fixture}`;
    let uv = cache.get(key);
    if (!uv) {
      uv = atlas.add((ctx, W, H) => {
        ctx.fillStyle = p.fixture === 'bakery' ? '#9c6436' : p.fixture === 'produce' ? '#2fa84f' : '#ffffff'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = catColor(u.category); ctx.fillRect(0, 0, 18, H);
        ctx.font = `800 ${H * 0.56}px "Baloo 2", system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = p.fixture === 'multideck' ? INK : '#ffffff';
        ctx.fillText(`${CAT_EMOJI[u.category] ?? ''} ${catLabel(u.category)}`.trim(), W / 2 + 9, H * 0.55, W - 40);
      });
      cache.set(key, uv);
    }
    const y = p.fixture === 'produce' ? G.height + 0.05 : p.fixture === 'bakery' ? G.height + 0.2 : G.height + 0.16;
    const z = p.fixture === 'produce' ? 0.06 : p.fixture === 'bakery' ? 0.135 : 0.195;
    q.add(unitM(p).multiply(T(0, y, z)), Math.min(1.7, p.len - 0.3), Math.min(1.7, p.len - 0.3) * 0.176, uv);
  }
  const mesh = new THREE.Mesh(q.geometry(), new THREE.MeshBasicMaterial({ map: atlas.texture() }));
  mesh.raycast = noRay;
  return mesh;
}

/** shelf dividers: one thin fin between product sets on every row, all units in one draw call */
function Dividers({ cfg, planogram }: { cfg: StoreConfig; planogram: Planogram }) {
  const mesh = useMemo(() => {
    const mats: THREE.Matrix4[] = [];
    const gap = rowGap(cfg);
    for (const u of cfg.units) {
      const f = unitFrame(cfg, u);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rotY);
      const base = new THREE.Matrix4().compose(new THREE.Vector3(f.x, 0, f.z), q, new THREE.Vector3(1, 1, 1));
      for (let r = 1; r <= cfg.rows_per_unit; r++) {
        const slot = `${u.id}-r${r}`;
        const pl = slotPlacements(slot, planogram[slot]);
        const edges = new Set<number>();
        pl.forEach((p) => { edges.add(+(p.lx - (p.width * p.facings) / 2).toFixed(3)); edges.add(+(p.lx + (p.width * p.facings) / 2).toFixed(3)); });
        const h = Math.min(gap - 0.06, 0.34);
        for (const lx of edges) mats.push(base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(lx, rowY(cfg, r) + h / 2, -0.16), new THREE.Quaternion(), new THREE.Vector3(0.018, h, 0.42))));
      }
    }
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#d9ccd4', roughness: 0.3, transparent: true, opacity: 0.85 }), Math.max(1, mats.length));
    mats.forEach((x, i) => m.setMatrixAt(i, x)); m.count = mats.length; m.raycast = () => null;
    return m;
  }, [cfg, planogram]);
  useEffect(() => () => { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }, [mesh]);
  return <primitive object={mesh} />;
}

/** edit mode: one click target per shelf row */
function SlotTargets({ cfg, P, editSel, changed, onSlot }: { cfg: StoreConfig; P: StorePlan; editSel: string | null; changed: Set<string>; onSlot: (s: string) => void }) {
  const gap = rowGap(cfg);
  return (
    <group>
      {cfg.units.flatMap((u) => {
        const p = P.units[u.id]; if (!p) return [];
        return rowsOf(cfg, p).map((r) => {
          const slot = `${u.id}-r${r}`;
          const isSel = editSel === slot, isChanged = changed.has(slot);
          const m = unitM(p).multiply(T(0, rowY(cfg, r) + gap / 2 - 0.05, 0.08));
          const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(pos, q, s);
          return (
            <mesh key={slot} position={pos} quaternion={q} onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSlot(slot); }}>
              <planeGeometry args={[p.len - 0.1, gap - 0.12]} />
              <meshBasicMaterial color={isSel ? BRAND_A : isChanged ? '#FFE14D' : '#ffffff'} transparent opacity={isSel ? 0.38 : isChanged ? 0.24 : 0.06} depthWrite={false} />
            </mesh>
          );
        });
      })}
    </group>
  );
}

function Doors({ x, z, idx, label, sub }: { x: number; z: number; idx: number; label: string; sub: string }) {
  const l = useRef<THREE.Group>(null), r = useRef<THREE.Group>(null);
  const open = useRef(0);
  useFrame((_, dt) => {
    const want = (bus.doors[idx] ?? 0) > 0 ? 1 : 0;
    open.current += (want - open.current) * (1 - Math.exp(-dt * 6));
    const o = open.current * 1.45;
    if (l.current) l.current.position.x = -0.75 - o;
    if (r.current) r.current.position.x = 0.75 + o;
  });
  const sign = useMemo(() => stickerSign([{ text: label, size: 120 }, { text: sub, size: 40, font: '700 40px Inter, system-ui' }], { w: 1024, h: 300, brand: true, chip: '🛒', chipColor: '#ffffff' }), [label, sub]);
  return (
    <group position={[x, 0, z]}>
      {[l, r].map((ref, i) => (
        <group key={i} ref={ref}>
          <mesh position={[0, 1.15, 0]} raycast={noRay}>
            <boxGeometry args={[1.5, 2.3, 0.06]} />
            <meshStandardMaterial color="#d8f3ff" transparent opacity={0.28} roughness={0.05} depthWrite={false} />
            <Edges color={INK} />
          </mesh>
          <mesh position={[0, 1.0, -0.05]} raycast={noRay}>
            <boxGeometry args={[1.3, 0.12, 0.02]} />
            <meshBasicMaterial color={BRAND_A} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 2.45, 0]} raycast={noRay} material={INKMAT}>
        <boxGeometry args={[3.4, 0.3, 0.3]} />
      </mesh>
      {[-1, 1].map((k) => (
        <mesh key={k} position={[0, 3.35, k * 0.18]} rotation={[0, k < 0 ? Math.PI : 0, 0]} raycast={noRay}>
          <planeGeometry args={[4.6, 1.35]} />
          <meshBasicMaterial map={sign} transparent />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, -1.2]} raycast={noRay}>
        <planeGeometry args={[3.4, 1.8]} />
        <meshStandardMaterial color={BRAND_A} roughness={0.9} />
      </mesh>
    </group>
  );
}


function MealDeal({ planogram, products, onProduct, x, z }: { planogram: Planogram; products: Record<string, Product>; onProduct: (c: string) => void; x: number; z: number }) {
  // stocked from the planogram's own meal-deal-ish categories (real products, clickable)
  const picks = useMemo(() => {
    const want = ['soft_drinks', 'crisps_savoury', 'snack_bars', 'ready_meals_soup'];
    const out: Product[] = [];
    for (const c of want) {
      const codes = Object.values(planogram).filter((s) => s.category === c).flatMap((s) => s.products);
      for (const code of codes.slice(0, 3)) if (products[code]) out.push(products[code]);
    }
    return out.slice(0, 12);
  }, [planogram, products]);
  const sign = useMemo(() => stickerSign([{ text: 'meal deal', size: 110 }, { text: 'main · snack · drink', size: 40, font: '700 40px Inter, system-ui' }], { w: 1024, h: 280, brand: true, chip: '🥪', chipColor: '#ffffff' }), []);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.5, 0]} castShadow raycast={noRay} material={WHITE}>
        <boxGeometry args={[2.6, 1.0, 1.1]} />
        <Edges color={INK} />
      </mesh>
      <mesh position={[0, 1.02, 0]} raycast={noRay}>
        <boxGeometry args={[2.5, 0.04, 1.0]} />
        <meshBasicMaterial color="#8fe3ff" />
      </mesh>
      {picks.map((p, i) => {
        const col = i % 6, row = Math.floor(i / 6);
        const h = 0.26;
        return (
          <mesh key={p.code} position={[(col - 2.5) * 0.4, 1.04 + h / 2, (row - 0.5) * 0.42]} castShadow material={productMaterials(p)}
            onClick={(e) => { e.stopPropagation(); onProduct(p.code); }} onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}>
            <boxGeometry args={[0.3, h, 0.2]} />
          </mesh>
        );
      })}
      {[-1, 1].map((k) => (
        <mesh key={k} position={[0, 2.25, k * 0.01]} rotation={[0, k < 0 ? Math.PI : 0, 0]} raycast={noRay}>
          <planeGeometry args={[2.4, 0.66]} />
          <meshBasicMaterial map={sign} transparent />
        </mesh>
      ))}
      {[-1, 1].map((k) => (
        <mesh key={k} position={[k * 1.1, 1.6, 0]} raycast={noRay} material={INKMAT}>
          <cylinderGeometry args={[0.025, 0.025, 1.2]} />
        </mesh>
      ))}
    </group>
  );
}


const beltTex = () => canvasTex(64, 256, (ctx) => {
  ctx.fillStyle = '#2a2230'; ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#3d3346'; for (let y = 0; y < 256; y += 32) ctx.fillRect(0, y, 64, 12);
}, [1, 3]);

/** a staffed till: counter, moving conveyor belt, scanner glass that flashes on every beep, bagging well, lane number */
function Till({ lane, belt }: { lane: Lane; belt: THREE.Texture }) {
  const glass = useRef<THREE.MeshBasicMaterial>(null);
  const light = useRef<THREE.MeshBasicMaterial>(null);
  const num = useMemo(() => stickerSign([{ text: String(lane.idx + 1), size: 150 }], { w: 256, h: 256, brand: true }), [lane.idx]);
  useFrame((st) => {
    const since = st.clock.elapsedTime - (bus.flash[lane.id] ?? -9);
    const k = Math.max(0, 1 - since / 0.25);
    if (glass.current) glass.current.color.setRGB(0.5 + k * 0.5, 0.15 + k * 0.85 * 0.3, 0.2 + k * 0.1);
    if (light.current) light.current.color.set(since < 6 ? '#7CFF9B' : '#ffffff');
  });
  const len = 2.6;
  return (
    <group position={[lane.x, 0, lane.z]}>
      <mesh position={[0, 0.47, 0]} castShadow raycast={noRay} material={WHITE}>
        <boxGeometry args={[0.95, 0.94, len]} />
        <Edges color={INK} />
      </mesh>
      {/* conveyor belt (texture scrolls toward the scanner) */}
      <mesh position={[-0.12, 0.955, -0.45]} raycast={noRay}>
        <boxGeometry args={[0.5, 0.02, len / 2 + 0.2]} />
        <meshStandardMaterial map={belt} roughness={0.7} />
      </mesh>
      {/* scanner glass */}
      <mesh position={[-0.1, 0.97, 0.55]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRay}>
        <planeGeometry args={[0.36, 0.26]} />
        <meshBasicMaterial ref={glass} color="#802033" />
      </mesh>
      {/* bagging well */}
      <mesh position={[-0.12, 0.93, len / 2 - 0.3]} raycast={noRay}>
        <boxGeometry args={[0.6, 0.04, 0.5]} />
        <meshStandardMaterial color="#e9dfd8" />
      </mesh>
      {/* till screen facing the cashier */}
      <mesh position={[0.3, 1.25, 0.25]} rotation={[0, Math.PI / 2 + 0.4, 0]} raycast={noRay}>
        <boxGeometry args={[0.36, 0.26, 0.05]} />
        <meshStandardMaterial color={INK} emissive="#ff8fb3" emissiveIntensity={0.35} />
      </mesh>
      {/* lane light + number */}
      <mesh position={[0.45, 1.3, -len / 2 + 0.1]} raycast={noRay} material={INKMAT}>
        <cylinderGeometry args={[0.03, 0.03, 2.6]} />
      </mesh>
      <mesh position={[0.45, 2.66, -len / 2 + 0.1]} raycast={noRay}>
        <cylinderGeometry args={[0.11, 0.11, 0.14, 16]} />
        <meshBasicMaterial ref={light} color="#7CFF9B" />
      </mesh>
      <mesh position={[0.45, 2.3, -len / 2 + 0.06]} rotation={[0, Math.PI, 0]} raycast={noRay}>
        <planeGeometry args={[0.6, 0.6]} />
        <meshBasicMaterial map={num} transparent side={THREE.DoubleSide} />
      </mesh>
      {/* cashier stool */}
      <mesh position={[0.65, 0.35, 0.5]} raycast={noRay}>
        <cylinderGeometry args={[0.2, 0.16, 0.7, 14]} />
        <meshStandardMaterial color="#c9cfdc" metalness={0.4} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** self-checkout kiosk: pedestal, touchscreen, scanner plate (flashes per beep) and a bagging shelf */
function Kiosk({ lane }: { lane: Lane }) {
  const face = lane.stand.z > lane.z ? 0 : Math.PI;
  const plate = useRef<THREE.MeshBasicMaterial>(null);
  const screen = useRef<THREE.MeshStandardMaterial>(null);
  useFrame((st) => {
    const since = st.clock.elapsedTime - (bus.flash[lane.id] ?? -9);
    const k = Math.max(0, 1 - since / 0.25);
    if (plate.current) plate.current.color.setRGB(0.45 + k * 0.55, 0.12 + k * 0.4, 0.2);
    if (screen.current) screen.current.emissiveIntensity = 0.3 + k * 0.8;
  });
  return (
    <group position={[lane.x, 0, lane.z]} rotation={[0, face, 0]}>
      <mesh position={[0, 0.45, 0]} castShadow raycast={noRay} material={WHITE}>
        <boxGeometry args={[0.62, 0.9, 0.5]} />
        <Edges color={INK} />
      </mesh>
      <mesh position={[-0.08, 0.92, 0.12]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRay}>
        <planeGeometry args={[0.32, 0.24]} />
        <meshBasicMaterial ref={plate} color="#731d33" />
      </mesh>
      <mesh position={[-0.05, 1.32, -0.08]} rotation={[-0.35, 0, 0]} raycast={noRay}>
        <boxGeometry args={[0.44, 0.32, 0.05]} />
        <meshStandardMaterial ref={screen} color={INK} emissive="#7CC8FF" emissiveIntensity={0.3} />
      </mesh>
      <mesh position={[-0.05, 1.08, -0.12]} raycast={noRay} material={INKMAT}>
        <boxGeometry args={[0.06, 0.4, 0.06]} />
      </mesh>
      {/* bagging shelf */}
      <mesh position={[0.48, 0.78, 0.05]} raycast={noRay}>
        <boxGeometry args={[0.38, 0.04, 0.42]} />
        <meshStandardMaterial color="#e9dfd8" />
      </mesh>
      <mesh position={[0.48, 0.39, 0.05]} raycast={noRay}>
        <cylinderGeometry args={[0.025, 0.025, 0.78]} />
        <meshStandardMaterial color="#c9cfdc" metalness={0.5} />
      </mesh>
      {/* help light */}
      <mesh position={[-0.05, 1.62, -0.1]} raycast={noRay}>
        <cylinderGeometry args={[0.05, 0.05, 0.12, 12]} />
        <meshBasicMaterial color="#FE831B" />
      </mesh>
    </group>
  );
}

/** EAS security gate: two pedestals; lights + glow flash red when it alarms */
function Gate({ id, x, z }: { id: string; x: number; z: number }) {
  const lamp = useRef<THREE.MeshBasicMaterial>(null);
  const glow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((st) => {
    const on = (bus.alarm[id] ?? 0) > st.clock.elapsedTime;
    const blink = on && Math.sin(st.clock.elapsedTime * 22) > 0;
    if (lamp.current) lamp.current.color.set(blink ? '#ff2244' : on ? '#ffd0d8' : '#e8f1f7');
    if (glow.current) glow.current.opacity = blink ? 0.45 : 0;
  });
  return (
    <group position={[x, 0, z]}>
      {[-0.5, 0.5].map((dx) => (
        <group key={dx} position={[dx, 0, 0]}>
          <mesh position={[0, 0.8, 0]} castShadow raycast={noRay}>
            <boxGeometry args={[0.12, 1.6, 0.5]} />
            <meshStandardMaterial color="#dfe8f0" transparent opacity={0.7} roughness={0.1} />
            <Edges color={INK} />
          </mesh>
          <mesh position={[0, 1.66, 0]} raycast={noRay}>
            <boxGeometry args={[0.16, 0.1, 0.54]} />
            <meshBasicMaterial ref={dx < 0 ? lamp : undefined} color="#e8f1f7" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.9, 0]} raycast={noRay}>
        <boxGeometry args={[1.0, 1.8, 0.5]} />
        <meshBasicMaterial ref={glow} color="#ff2244" transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}


function Cafe({ cfg }: { cfg: StoreConfig }) {
  const c = storePlan(cfg).cafe;
  const lobbyZ = storePlan(cfg).lobbyZ;
  const sign = useMemo(() => stickerSign([{ text: 'café', size: 120 }, { text: 'sit · sip · chill', size: 40, font: '700 40px Inter, system-ui' }], { w: 1024, h: 280, brand: true, chip: '☕', chipColor: '#ffffff' }), []);
  const wood = useMemo(() => canvasTex(256, 256, (ctx) => {
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#e7c39a' : '#dcb488'; ctx.fillRect(0, i * 32, 256, 32); }
    ctx.strokeStyle = 'rgba(20,16,20,.12)'; ctx.lineWidth = 2; for (let i = 0; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(256, i * 32); ctx.stroke(); }
  }, [c.w / 2, c.d / 2]), [c.w, c.d]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[c.x, 0.006, c.z]} receiveShadow raycast={noRay}>
        <planeGeometry args={[c.w, c.d]} />
        <meshStandardMaterial map={wood} roughness={0.8} />
      </mesh>
      {/* counter with a pastry case + coffee machine (decor, no product claims) */}
      <group position={[c.counter.x, 0, c.counter.z]}>
        <mesh position={[0, 0.5, 0]} castShadow raycast={noRay}>
          <boxGeometry args={[3.2, 1.0, 0.8]} />
          <meshStandardMaterial color="#7a4b2a" roughness={0.6} />
          <Edges color={INK} />
        </mesh>
        <mesh position={[-0.7, 1.2, 0]} raycast={noRay}>
          <boxGeometry args={[1.2, 0.4, 0.6]} />
          <meshStandardMaterial color="#cfefff" transparent opacity={0.3} depthWrite={false} />
          <Edges color={INK} />
        </mesh>
        {[-1.1, -0.85, -0.6, -0.35].map((x, i) => (
          <mesh key={x} position={[x, 1.08, 0]} raycast={noRay}>
            <sphereGeometry args={[0.09, 12, 8]} />
            <meshStandardMaterial color={['#e8a85c', '#c46b3a', '#f2d18a', '#8a4b2a'][i]} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[0.8, 1.25, -0.1]} raycast={noRay}>
          <boxGeometry args={[0.5, 0.5, 0.4]} />
          <meshStandardMaterial color="#c9cfdc" metalness={0.6} roughness={0.25} />
          <Edges color={INK} />
        </mesh>
        <mesh position={[0, 2.55, -0.2]} raycast={noRay}>
          <planeGeometry args={[2.6, 0.72]} />
          <meshBasicMaterial map={sign} transparent />
        </mesh>
      </group>
      {c.tables.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]}>
          <mesh position={[0, 0.74, 0]} castShadow raycast={noRay} material={WHITE}>
            <cylinderGeometry args={[0.42, 0.42, 0.05, 24]} />
            <Edges color={INK} />
          </mesh>
          <mesh position={[0, 0.37, 0]} raycast={noRay} material={INKMAT}>
            <cylinderGeometry args={[0.04, 0.12, 0.74, 10]} />
          </mesh>
        </group>
      ))}
      {c.seats.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.yaw, 0]}>
          <mesh position={[0, 0.42, 0]} castShadow raycast={noRay}>
            <boxGeometry args={[0.42, 0.06, 0.42]} />
            <meshStandardMaterial color={i % 2 ? '#FF4079' : '#FE831B'} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.72, -0.2]} raycast={noRay}>
            <boxGeometry args={[0.42, 0.55, 0.05]} />
            <meshStandardMaterial color={i % 2 ? '#FF4079' : '#FE831B'} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.2, 0]} raycast={noRay} material={INKMAT}>
            <cylinderGeometry args={[0.03, 0.03, 0.4]} />
          </mesh>
        </group>
      ))}
      {/* planters as a low fence between café and shop floor */}
      {Array.from({ length: Math.max(2, Math.floor(c.d / 1.6)) }, (_, i) => c.z - c.d / 2 + 0.8 + i * 1.6).filter((pz) => Math.abs(pz - lobbyZ) > 1.5).map((pz, i) => (
        <group key={i} position={[c.x + c.w / 2 + 0.2, 0, pz]}>
          <mesh position={[0, 0.3, 0]} raycast={noRay}><boxGeometry args={[0.4, 0.6, 1.0]} /><meshStandardMaterial color="#fff" /><Edges color={INK} /></mesh>
          <mesh position={[0, 0.78, 0]} raycast={noRay}><sphereGeometry args={[0.42, 14, 10]} /><meshStandardMaterial color="#3fbf5f" roughness={0.7} /></mesh>
        </group>
      ))}
    </group>
  );
}


function Stockroom({ cfg }: { cfg: StoreConfig }) {
  const s = storePlan(cfg).stockroom;
  const sign = useMemo(() => stickerSign([{ text: 'staff only', size: 96 }, { text: 'stockroom', size: 44, font: '700 44px Inter, system-ui' }], { w: 1024, h: 260, chip: '📦', chipColor: '#FE831B' }), []);
  const rows = Math.max(2, Math.floor(s.d / 2.2));
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[s.x, 0.004, s.z]} receiveShadow raycast={noRay}>
        <planeGeometry args={[s.w, s.d]} />
        <meshStandardMaterial color="#d9d4dc" roughness={0.95} />
      </mesh>
      {Array.from({ length: rows }, (_, i) => (
        <group key={i} position={[s.x + s.w / 2 - 0.7, 0, s.z - s.d / 2 + 1 + i * 2.2]}>
          <mesh position={[0, 1, 0]} raycast={noRay}><boxGeometry args={[1, 2, 1.6]} /><meshStandardMaterial color="#c9cfdc" wireframe /></mesh>
          {[0.3, 1.0, 1.65].map((y) => <mesh key={y} position={[0, y, 0]} castShadow raycast={noRay}><boxGeometry args={[0.8, 0.5, 1.4]} /><meshStandardMaterial color={y > 1 ? '#d9a05b' : '#c48a4a'} roughness={0.8} /><Edges color={INK} /></mesh>)}
        </group>
      ))}
      {/* walls of the back room: outer + sides, the shop-side wall has the swing door gap */}
      <mesh position={[s.x + s.w / 2, 1.3, s.z]} raycast={noRay}><boxGeometry args={[0.2, 2.6, s.d]} /><meshStandardMaterial color="#efe6ea" /></mesh>
      {[-1, 1].map((k) => <mesh key={k} position={[s.x, 1.3, s.z + k * s.d / 2]} raycast={noRay}><boxGeometry args={[s.w, 2.6, 0.2]} /><meshStandardMaterial color="#efe6ea" /></mesh>)}
      <mesh position={[s.door.x - 0.15, 2.9, s.door.z]} rotation={[0, -Math.PI / 2, 0]} raycast={noRay}>
        <planeGeometry args={[2.2, 0.56]} />
        <meshBasicMaterial map={sign} transparent />
      </mesh>
    </group>
  );
}


export function Store(props: StoreProps) {
  const { cfg, planogram, products, changed, heat, editMode, editSel, onSlot } = props;
  const P = storePlan(cfg);
  const B = P.bounds;
  const floor = useMemo(() => { const t = floorTexture(); t.repeat.set(B.w / 1.2, B.d / 1.2); return t; }, [B.w, B.d]);
  const band = useMemo(() => canvasTex(512, 32, (ctx) => { const g = ctx.createLinearGradient(0, 0, 512, 0); g.addColorStop(0, '#FF4079'); g.addColorStop(1, '#FE831B'); ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 32); }), []);
  const belt = useMemo(beltTex, []);
  useFrame((_, dt) => { belt.offset.y -= dt * 0.6; });
  const fixtures = useMemo(() => buildFixtures(cfg, P), [cfg, P]);
  const endcaps = useMemo(() => buildEndcaps(P), [P]);
  const headers = useMemo(() => buildHeaders(cfg, P), [cfg, P]);
  const rails = useMemo(() => buildRails(cfg, P, planogram, products, changed, heat), [cfg, P, planogram, products, changed, heat]);
  useEffect(() => () => disposeGroup(fixtures), [fixtures]);
  useEffect(() => () => disposeGroup(endcaps), [endcaps]);
  useEffect(() => () => { if (headers) disposeGroup(headers); }, [headers]);
  useEffect(() => () => disposeGroup(rails), [rails]);

  const wallH = 3.2;
  const doorHalf = 1.7;
  const spans = (from: number, to: number, holes: number[], half: number) => {
    const hs = holes.slice().sort((a, b) => a - b);
    const out: [number, number][] = []; let s = from;
    for (const h of hs) { if (h - half > s) out.push([s, h - half]); s = Math.max(s, h + half); }
    if (to > s) out.push([s, to]);
    return out;
  };
  // street (+z) wall is a glazed shopfront with door gaps; the rest are solid
  const front = spans(B.xMin, B.xMax, [...P.entrances.map((e) => e.x), ...P.exits.map((e) => e.x)], doorHalf);
  const right = spans(B.zMin, B.zMax, [P.stockroom.door.z], 1.1);
  const wallBoxes: [number, number, number, number][] = [ // cx, cz, w, d
    [B.cx, B.zMin, B.w + 0.24, 0.24],
    [B.xMin, B.cz, 0.24, B.d],
    ...right.map(([a, b]) => [B.xMax, (a + b) / 2, 0.24, b - a] as [number, number, number, number]),
  ];
  const wallUnits = cfg.units.map((u) => P.units[u.id]).filter((p): p is UnitPlace => !!p && !!p.wall);
  return (
    <group>
      {/* floor + outdoor car park apron */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[B.cx, 0, B.cz]} receiveShadow raycast={noRay}>
        <planeGeometry args={[B.w, B.d]} />
        <meshStandardMaterial map={floor} roughness={0.75} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[B.cx, -0.01, B.cz + 6]} raycast={noRay}>
        <planeGeometry args={[B.w + 40, B.d + 40]} />
        <meshStandardMaterial color="#f6d9cf" roughness={1} />
      </mesh>
      {wallBoxes.map(([x, z, w, d], i) => (
        <group key={i}>
          <mesh position={[x, wallH / 2, z]} receiveShadow raycast={noRay}>
            <boxGeometry args={[w, wallH, d]} />
            <meshStandardMaterial color="#fff3ec" />
          </mesh>
          <mesh position={[x, wallH - 0.2, z]} raycast={noRay}>
            <boxGeometry args={[w + 0.02, 0.22, d + 0.02]} />
            <meshBasicMaterial map={band} />
          </mesh>
        </group>
      ))}
      {front.map(([a, b], i) => (
        <group key={`f${i}`} position={[(a + b) / 2, 0, B.zMax]}>
          <mesh position={[0, 0.3, 0]} raycast={noRay}><boxGeometry args={[b - a, 0.6, 0.24]} /><meshStandardMaterial color="#fff3ec" /><Edges color={INK} /></mesh>
          <mesh position={[0, 1.6, 0]} raycast={noRay}><boxGeometry args={[b - a, 2.0, 0.06]} /><meshStandardMaterial color="#d8f3ff" transparent opacity={0.22} depthWrite={false} /><Edges color={INK} /></mesh>
          <mesh position={[0, wallH - 0.1, 0]} raycast={noRay}><boxGeometry args={[b - a, 0.2, 0.26]} /><meshBasicMaterial map={band} /></mesh>
        </group>
      ))}
      {P.entrances.map((e, i) => <Doors key={`in${i}`} x={e.x} z={B.zMax} idx={i} label="same shelf" sub={P.entrances.length > 1 ? `entrance ${i + 1} · two shoppers, one shelf` : 'two shoppers · one shelf'} />)}
      {P.exits.map((e, i) => <Doors key={`out${i}`} x={e.x} z={B.zMax} idx={P.entrances.length + i} label="exit" sub="thanks for shopping!" />)}
      {P.gates.map((g) => <Gate key={g.id} id={g.id} x={g.x} z={g.z} />)}

      <primitive object={fixtures} />
      <primitive object={endcaps} />
      {headers && <primitive object={headers} />}
      <primitive object={rails} />
      <Dividers cfg={cfg} planogram={planogram} />
      {editMode && <SlotTargets cfg={cfg} P={P} editSel={editSel} changed={changed} onSlot={onSlot} />}
      <Departments cfg={cfg} planogram={planogram} />
      {P.lanes.map((l) => (l.kind === 'staffed' ? <Till key={l.id} lane={l} belt={belt} /> : <Kiosk key={l.id} lane={l} />))}
      <MealDeal planogram={planogram} products={products} onProduct={props.onProduct} x={P.mealDeal.x} z={P.mealDeal.z} />
      {P.cafe.w > 0 && <Cafe cfg={cfg} />}
      <Stockroom cfg={cfg} />

      {/* static colliders */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[B.w / 2 + 12, 0.1, B.d / 2 + 10]} position={[B.cx, -0.1, B.cz]} friction={0.9} restitution={0.2} />
        {wallBoxes.map(([x, z, w, d], i) => <CuboidCollider key={i} args={[w / 2, wallH / 2, d / 2 + 0.05]} position={[x, wallH / 2, z]} />)}
        {front.map(([a, b], i) => <CuboidCollider key={`f${i}`} args={[(b - a) / 2, 1.3, 0.14]} position={[(a + b) / 2, 1.3, B.zMax]} />)}
        {P.gondolas.map((g, i) => <CuboidCollider key={`g${i}`} args={[G.depth / 2 + 0.06, 1.1, (g.z1 - g.z0) / 2 + G.endcapDepth]} position={[g.x, 1.1, (g.z0 + g.z1) / 2]} restitution={0.5} />)}
        {wallUnits.map((p, i) => <CuboidCollider key={`w${i}`} args={[p.len / 2, 1.1, 0.42]} position={[p.x - Math.sin(p.rotY) * 0.2, 1.1, p.z - Math.cos(p.rotY) * 0.2]} rotation={[0, p.rotY, 0]} />)}
        {P.produce.tables.map((t, i) => <CuboidCollider key={`pt${i}`} args={[t.w / 2, 0.5, t.d / 2]} position={[t.x, 0.5, t.z]} />)}
        {P.produce.flowers && <CuboidCollider args={[0.8, 0.6, 0.8]} position={[P.produce.flowers.x, 0.6, P.produce.flowers.z]} />}
        {P.dividers.map((r, i) => <CuboidCollider key={`d${i}`} args={[(r.x1 - r.x0) / 2, 0.55, (r.z1 - r.z0) / 2]} position={[(r.x0 + r.x1) / 2, 0.55, (r.z0 + r.z1) / 2]} />)}
        {P.lanes.map((l) => (l.kind === 'staffed'
          ? <CuboidCollider key={l.id} args={[0.48, 0.5, 1.3]} position={[l.x, 0.5, l.z]} />
          : <CuboidCollider key={l.id} args={[0.32, 0.5, 0.26]} position={[l.x, 0.5, l.z]} />))}
        {P.gates.map((g) => [-0.5, 0.5].map((dx) => <CuboidCollider key={`${g.id}${dx}`} args={[0.07, 0.8, 0.25]} position={[g.x + dx, 0.8, g.z]} />))}
        <CuboidCollider args={[1.3, 0.6, 0.55]} position={[P.mealDeal.x, 0.6, P.mealDeal.z]} />
        {P.cafe.w > 0 && <CuboidCollider args={[1.6, 0.5, 0.4]} position={[P.cafe.counter.x, 0.5, P.cafe.counter.z]} />}
        {P.cafe.tables.map((t, i) => <CuboidCollider key={`t${i}`} args={[0.3, 0.4, 0.3]} position={[t.x, 0.4, t.z]} />)}
      </RigidBody>
    </group>
  );
}

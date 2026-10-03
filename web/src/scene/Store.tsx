// The supermarket shell, built only from store.config.json (via layout.storePlan): walls, sliding doors at every
// entrance + exit, gondolas of any length (bays), fridges with glass, shelf dividers + price rails, end caps,
// overhead aisle signs, staffed tills with conveyor belts, self-checkout banks, EAS security gates, a café, a
// stockroom and a meal-deal stand. Everything solid is also a fixed rapier collider, so nobody walks through it.
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { Planogram, Product, StoreConfig, Unit } from '../types';
import { G, gondolaX, rowGap, rowY, slotPlacements, storePlan, unitFrame, type Lane } from '../layout';
import { BRAND_A, CAT_EMOJI, CHILLED, INK, catColor, catLabel } from '../theme';
import { canvasTex, floorTexture, productMaterials, stickerSign } from './textures';
import { bus } from './fx';

export interface StoreProps {
  cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>;
  onProduct: (code: string) => void;
  editMode: boolean; editSel: string | null; onSlot: (slot: string) => void; changed: Set<string>;
  heat: Record<string, string> | null;
}

const noRay = () => null;
const walkwayUnits = (cfg: StoreConfig, w: number) => cfg.units.filter((u) => (u.side === 'L' ? u.aisle - 1 : u.aisle) === w);
const WHITE = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 });
const INKMAT = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.5 });

function railTexture(slot: string, set: Planogram[string] | undefined, products: Record<string, Product>, changed: boolean, heat: Record<string, string> | null) {
  return canvasTex(1024, 64, (ctx) => {
    ctx.fillStyle = changed ? '#FFE14D' : '#ffffff'; ctx.fillRect(0, 0, 1024, 64);
    ctx.fillStyle = INK; ctx.fillRect(0, 0, 1024, 5); ctx.fillRect(0, 59, 1024, 5);
    for (const p of slotPlacements(slot, set)) {
      const cx = ((p.lx + G.unitLen / 2) / G.unitLen) * 1024;
      const pw = (p.width * p.facings / G.unitLen) * 1024;
      if (heat?.[p.code]) { ctx.fillStyle = heat[p.code]; ctx.fillRect(cx - pw / 2 + 4, 5, pw - 8, 12); }
      const price = products[p.code]?.price_gbp;
      const txt = price ? `£${Number(price).toFixed(2)}` : '£?';
      ctx.font = '800 34px "Baloo 2", system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = Math.min(pw - 6, ctx.measureText(txt).width + 22);
      const role = products[p.code]?.role;
      ctx.fillStyle = role === 'challenger' ? '#FFE14D' : role === 'own_label' ? '#ffe4ec' : '#fff8ef';
      ctx.strokeStyle = INK; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(cx - tw / 2, 17, tw, 40, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.fillText(txt, cx, 39, tw - 8);
    }
  });
}

function ShelvingUnit({ cfg, u, planogram, products, editMode, editSel, onSlot, changed, heat }: StoreProps & { u: Unit }) {
  const f = unitFrame(cfg, u);
  const chilled = CHILLED.has(u.category);
  const sign = useMemo(() => stickerSign([{ text: catLabel(u.category), size: 92 }, { text: `${u.id} · aisle ${u.aisle}${u.side.toLowerCase()}`, size: 40, color: '#6b5a66', font: '700 40px Inter, system-ui' }], { w: 1024, h: 240, chip: CAT_EMOJI[u.category] ?? '·', chipColor: catColor(u.category) }), [u]);
  const gap = rowGap(cfg);
  const rows = Array.from({ length: cfg.rows_per_unit }, (_, i) => i + 1);
  const rails = useMemo(() => rows.map((r) => { const slot = `${u.id}-r${r}`; return railTexture(slot, planogram[slot], products, changed.has(slot), heat); }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [u.id, planogram, products, changed, heat, cfg.rows_per_unit]);
  const backCol = useMemo(() => new THREE.Color(catColor(u.category)).lerp(new THREE.Color('#ffffff'), chilled ? 0.75 : 0.82), [u.category, chilled]);
  return (
    <group position={[f.x, 0, f.z]} rotation={[0, f.rotY, 0]}>
      <mesh position={[0, G.height / 2 + 0.05, -0.46]} raycast={noRay}>
        <boxGeometry args={[G.unitLen, G.height, 0.03]} />
        <meshStandardMaterial color={backCol} emissive={chilled ? '#bfe9ff' : '#000'} emissiveIntensity={chilled ? 0.35 : 0} />
      </mesh>
      <mesh position={[0, G.height + 0.42, -0.2]} raycast={noRay}>
        <planeGeometry args={[2.9, 0.68]} />
        <meshBasicMaterial map={sign} transparent />
      </mesh>
      {rows.map((r, i) => {
        const slot = `${u.id}-r${r}`;
        const y = rowY(cfg, r);
        const isSel = editSel === slot, isChanged = changed.has(slot);
        return (
          <group key={slot} position={[0, y, 0]}>
            <mesh receiveShadow position={[0, -0.03, -0.22]} raycast={noRay}>
              <boxGeometry args={[G.unitLen, 0.05, 0.5]} />
              <meshStandardMaterial color={chilled ? '#e9f6ff' : '#f3ece6'} />
            </mesh>
            <mesh position={[0, -0.03, 0.04]} raycast={noRay}>
              <boxGeometry args={[G.unitLen, 0.075, 0.02]} />
              <meshStandardMaterial attach="material-0" color="#fff" />
              <meshStandardMaterial attach="material-1" color="#fff" />
              <meshStandardMaterial attach="material-2" color="#fff" />
              <meshStandardMaterial attach="material-3" color="#fff" />
              <meshStandardMaterial attach="material-4" map={rails[i]} />
              <meshStandardMaterial attach="material-5" color="#fff" />
            </mesh>
            {editMode && (
              <mesh position={[0, gap / 2 - 0.05, 0.08]} onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSlot(slot); }}>
                <planeGeometry args={[G.unitLen - 0.1, gap - 0.12]} />
                <meshBasicMaterial color={isSel ? BRAND_A : isChanged ? '#FFE14D' : '#ffffff'} transparent opacity={isSel ? 0.38 : isChanged ? 0.24 : 0.06} depthWrite={false} />
              </mesh>
            )}
          </group>
        );
      })}
      {chilled && (
        <group>
          {[-1, 0, 1].map((k) => (
            <group key={k} position={[k * (G.unitLen / 3), G.height / 2 + 0.02, 0.13]}>
              <mesh raycast={noRay}>
                <boxGeometry args={[G.unitLen / 3 - 0.06, G.height - 0.06, 0.03]} />
                <meshStandardMaterial color="#cfefff" transparent opacity={0.16} roughness={0.05} metalness={0.1} depthWrite={false} />
                <Edges color={INK} />
              </mesh>
              <mesh position={[G.unitLen / 6 - 0.16, 0, 0.04]} raycast={noRay}>
                <boxGeometry args={[0.04, 0.7, 0.04]} />
                <meshStandardMaterial color="#d6d9e2" metalness={0.6} roughness={0.25} />
              </mesh>
            </group>
          ))}
          <mesh position={[0, G.height + 0.03, 0.1]} raycast={noRay}>
            <boxGeometry args={[G.unitLen, 0.09, 0.12]} />
            <meshBasicMaterial color="#8fe3ff" />
          </mesh>
          <pointLight position={[0, 1.2, 0.8]} color="#9fe6ff" intensity={0.6} distance={3.2} decay={2} />
        </group>
      )}
    </group>
  );
}

/** shelf dividers: one thin ink fin between product sets on every row, all units in one draw call */
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
  return <primitive object={mesh} />;
}

function EndCap({ x, z, dir, category, idx }: { x: number; z: number; dir: number; category: string; idx: number }) {
  const sign = useMemo(() => stickerSign([{ text: `${CAT_EMOJI[category] ?? ''} ${catLabel(category)}`, size: 74 }], { w: 1024, h: 200, brand: idx % 2 === 0 }), [category, idx]);
  const col = catColor(category);
  const tiers = [0, 1, 2];
  return (
    <group position={[x, 0, z]} rotation={[0, dir > 0 ? 0 : Math.PI, 0]}>
      <mesh position={[0, 0.45, G.endcapDepth / 2]} castShadow raycast={noRay} material={WHITE}>
        <boxGeometry args={[G.depth + 0.1, 0.9, G.endcapDepth]} />
        <Edges color={INK} />
      </mesh>
      {/* carton pyramid in the category colour: promo display only, no product claims */}
      {tiers.map((t) => Array.from({ length: 3 - t }, (_, i) => (
        <mesh key={`${t}-${i}`} position={[(i - (2 - t) / 2) * 0.34, 0.9 + 0.15 + t * 0.3, G.endcapDepth / 2]} castShadow raycast={noRay}>
          <boxGeometry args={[0.3, 0.28, 0.3]} />
          <meshStandardMaterial color={t % 2 ? '#ffffff' : col} roughness={0.35} />
          <Edges color={INK} />
        </mesh>
      )))}
      <mesh position={[0, 2.15, G.endcapDepth / 2]} raycast={noRay}>
        <planeGeometry args={[1.5, 0.3]} />
        <meshBasicMaterial map={sign} transparent />
      </mesh>
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

function AisleSign({ cfg, w, z }: { cfg: StoreConfig; w: number; z: number }) {
  const units = walkwayUnits(cfg, w);
  const cats = [...new Set(units.map((u) => u.category))];
  const tex = useMemo(() => stickerSign([{ text: cats.map((c) => `${CAT_EMOJI[c] ?? ''} ${catLabel(c)}`).join('  ·  ') || 'aisle', size: cats.length > 3 ? 46 : 64 }], { w: 1400, h: 220, chip: String(w + 1), chipColor: '#FF4079' }), [cats.join()]);
  const x = gondolaX(cfg, w + 0.5);
  return (
    <group position={[x, 3.75, z]}>
      {[-1, 1].map((k) => (
        <mesh key={k} position={[0, 0, k * 0.012]} rotation={[0, k < 0 ? Math.PI : 0, 0]} raycast={noRay}>
          <planeGeometry args={[4.2, 0.66]} />
          <meshBasicMaterial map={tex} transparent />
        </mesh>
      ))}
      {[-1.6, 1.6].map((dx) => (
        <mesh key={dx} position={[dx, 0.9, 0]} raycast={noRay}>
          <cylinderGeometry args={[0.012, 0.012, 1.2]} />
          <meshBasicMaterial color={INK} />
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
      {Array.from({ length: Math.max(2, Math.floor(c.d / 1.6)) }, (_, i) => (
        <group key={i} position={[c.x + c.w / 2 + 0.2, 0, c.z - c.d / 2 + 0.8 + i * 1.6]}>
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
  const { cfg } = props;
  const P = storePlan(cfg);
  const B = P.bounds;
  const aisles = Array.from({ length: cfg.aisles }, (_, i) => i + 1);
  const floor = useMemo(() => { const t = floorTexture(); t.repeat.set(B.w / 1.2, B.d / 1.2); return t; }, [B.w, B.d]);
  const band = useMemo(() => canvasTex(512, 32, (ctx) => { const g = ctx.createLinearGradient(0, 0, 512, 0); g.addColorStop(0, '#FF4079'); g.addColorStop(1, '#FE831B'); ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 32); }), []);
  const belt = useMemo(beltTex, []);
  useFrame((_, dt) => { belt.offset.y -= dt * 0.6; });
  const { z0, z1 } = P;
  const gLen = z1 - z0, gMid = (z0 + z1) / 2;
  const wallH = 2.6;
  const doorHalf = 1.7;
  // walls with door gaps: front (entrances), back (exits), right (stockroom door)
  const spans = (from: number, to: number, holes: number[], half: number) => {
    const hs = holes.slice().sort((a, b) => a - b);
    const out: [number, number][] = []; let s = from;
    for (const h of hs) { if (h - half > s) out.push([s, h - half]); s = h + half; }
    if (to > s) out.push([s, to]);
    return out;
  };
  const front = spans(B.xMin, B.xMax, P.entrances.map((e) => e.x), doorHalf);
  const back = spans(B.xMin, B.xMax, P.exits.map((e) => e.x), doorHalf);
  const right = spans(B.zMin, B.zMax, [P.stockroom.door.z], 1.1);
  const wallBoxes: [number, number, number, number][] = [ // cx, cz, w, d
    ...back.map(([a, b]) => [(a + b) / 2, B.zMax, b - a, 0.24] as [number, number, number, number]),
    [B.xMin, B.cz, 0.24, B.d],
    ...right.map(([a, b]) => [B.xMax, (a + b) / 2, 0.24, b - a] as [number, number, number, number]),
  ];
  const endCats = (a: number) => { const us = cfg.units.filter((u) => u.aisle === a); return [us[0]?.category ?? '', us[us.length - 1]?.category ?? '']; };
  return (
    <group>
      {/* floor + outdoor pavement */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[B.cx, 0, B.cz]} receiveShadow raycast={noRay}>
        <planeGeometry args={[B.w, B.d]} />
        <meshStandardMaterial map={floor} roughness={0.75} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[B.cx, -0.01, B.cz]} raycast={noRay}>
        <planeGeometry args={[B.w + 30, B.d + 24]} />
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
        <group key={`f${i}`} position={[(a + b) / 2, 0, P.frontZ]}>
          <mesh position={[0, 0.3, 0]} raycast={noRay}><boxGeometry args={[b - a, 0.6, 0.24]} /><meshStandardMaterial color="#fff3ec" /><Edges color={INK} /></mesh>
          <mesh position={[0, 1.6, 0]} raycast={noRay}><boxGeometry args={[b - a, 2.0, 0.06]} /><meshStandardMaterial color="#d8f3ff" transparent opacity={0.22} depthWrite={false} /><Edges color={INK} /></mesh>
          <mesh position={[0, wallH - 0.1, 0]} raycast={noRay}><boxGeometry args={[b - a, 0.2, 0.26]} /><meshBasicMaterial map={band} /></mesh>
        </group>
      ))}
      {P.entrances.map((e, i) => <Doors key={`in${i}`} x={e.x} z={P.frontZ} idx={i} label="same shelf" sub={P.entrances.length > 1 ? `entrance ${i + 1} · two shoppers, one shelf` : 'two shoppers · one shelf'} />)}
      {P.exits.map((e, i) => <Doors key={`out${i}`} x={e.x} z={P.bounds.zMax} idx={P.entrances.length + i} label="exit" sub="thanks for shopping!" />)}
      {P.gates.map((g) => <Gate key={g.id} id={g.id} x={g.x} z={g.z} />)}

      {/* gondolas: plinth + centre divider + end panels, as long as the most bays on any side */}
      {aisles.map((a) => (
        <group key={a} position={[gondolaX(cfg, a), 0, gMid]}>
          <mesh position={[0, 0.06, 0]} castShadow raycast={noRay}>
            <boxGeometry args={[G.depth, 0.12, gLen + 0.1]} />
            <meshStandardMaterial color="#e9dfd8" />
            <Edges color={INK} />
          </mesh>
          <mesh position={[0, G.height / 2, 0]} castShadow raycast={noRay}>
            <boxGeometry args={[0.08, G.height, gLen]} />
            <meshStandardMaterial color="#fff6ef" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, G.height / 2, s * (gLen / 2 + 0.03)]} castShadow raycast={noRay} material={WHITE}>
              <boxGeometry args={[G.depth, G.height, 0.06]} />
              <Edges color={INK} />
            </mesh>
          ))}
        </group>
      ))}
      {cfg.units.map((u) => <ShelvingUnit key={u.id} u={u} {...props} />)}
      <Dividers cfg={cfg} planogram={props.planogram} />
      {aisles.flatMap((a) => {
        const [c0, c1] = endCats(a);
        return [-1, 1].map((s, k) => <EndCap key={`${a}${s}`} x={gondolaX(cfg, a)} z={s < 0 ? z0 - 0.03 : z1 + 0.03} dir={s} category={k ? c1 : c0} idx={a + k} />);
      })}
      {Array.from({ length: cfg.aisles + 1 }, (_, w) => <AisleSign key={w} cfg={cfg} w={w} z={z0 + 0.4} />)}
      {P.bays > 1 && Array.from({ length: cfg.aisles + 1 }, (_, w) => <AisleSign key={`b${w}`} cfg={cfg} w={w} z={z1 - 0.4} />)}
      {P.lanes.map((l) => (l.kind === 'staffed' ? <Till key={l.id} lane={l} belt={belt} /> : <Kiosk key={l.id} lane={l} />))}
      <MealDeal planogram={props.planogram} products={props.products} onProduct={props.onProduct} x={P.mealDeal.x} z={P.mealDeal.z} />
      <Cafe cfg={cfg} />
      <Stockroom cfg={cfg} />

      {/* static colliders */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[B.w / 2 + 12, 0.1, B.d / 2 + 10]} position={[B.cx, -0.1, B.cz]} friction={0.9} restitution={0.2} />
        {wallBoxes.map(([x, z, w, d], i) => <CuboidCollider key={i} args={[w / 2, wallH / 2, d / 2 + 0.05]} position={[x, wallH / 2, z]} />)}
        {front.map(([a, b], i) => <CuboidCollider key={`f${i}`} args={[(b - a) / 2, 1.3, 0.14]} position={[(a + b) / 2, 1.3, P.frontZ]} />)}
        {aisles.map((a) => <CuboidCollider key={a} args={[G.depth / 2 + 0.06, 1.1, gLen / 2 + G.endcapDepth]} position={[gondolaX(cfg, a), 1.1, gMid]} restitution={0.5} />)}
        {P.lanes.map((l) => (l.kind === 'staffed'
          ? <CuboidCollider key={l.id} args={[0.48, 0.5, 1.3]} position={[l.x, 0.5, l.z]} />
          : <CuboidCollider key={l.id} args={[0.32, 0.5, 0.26]} position={[l.x, 0.5, l.z]} />))}
        {P.gates.map((g) => [-0.5, 0.5].map((dx) => <CuboidCollider key={`${g.id}${dx}`} args={[0.07, 0.8, 0.25]} position={[g.x + dx, 0.8, g.z]} />))}
        <CuboidCollider args={[1.3, 0.6, 0.55]} position={[P.mealDeal.x, 0.6, P.mealDeal.z]} />
        <CuboidCollider args={[1.6, 0.5, 0.4]} position={[P.cafe.counter.x, 0.5, P.cafe.counter.z]} />
        {P.cafe.tables.map((t, i) => <CuboidCollider key={`t${i}`} args={[0.3, 0.4, 0.3]} position={[t.x, 0.4, t.z]} />)}
      </RigidBody>
    </group>
  );
}

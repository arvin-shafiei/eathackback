// The supermarket shell, built only from store.config.json: walls, sliding doors, gondolas, fridges with glass,
// end caps, overhead aisle signs, price rails, checkouts and a meal-deal stand. Everything solid is also a
// fixed rapier collider, so shoppers and trolleys can't walk through it.
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import type { Planogram, Product, StoreConfig, Unit } from '../types';
import { G, checkoutLayout, gondolaX, rowGap, rowY, slotPlacements, storeBounds, unitFrame, zRange } from '../layout';
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
      {/* coloured back panel so each category reads from afar */}
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
          {/* glass doors + cold glow */}
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
        </group>
      )}
    </group>
  );
}

function EndCap({ x, z, dir, category, idx }: { x: number; z: number; dir: number; category: string; idx: number }) {
  const sign = useMemo(() => stickerSign([{ text: `${CAT_EMOJI[category] ?? ''} ${catLabel(category)}`, size: 74 }], { w: 1024, h: 200, brand: idx % 2 === 0 }), [category, idx]);
  const col = catColor(category);
  const tiers = [0, 1, 2];
  return (
    <group position={[x, 0, z]} rotation={[0, dir > 0 ? 0 : Math.PI, 0]}>
      <mesh position={[0, 0.45, G.endcapDepth / 2]} castShadow raycast={noRay}>
        <boxGeometry args={[G.depth + 0.1, 0.9, G.endcapDepth]} />
        <meshStandardMaterial color="#ffffff" />
        <Edges color={INK} />
      </mesh>
      {/* carton pyramid in the category colour: display only, no product claims */}
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

function Doors({ cfg, wallZ }: { cfg: StoreConfig; wallZ: number }) {
  const l = useRef<THREE.Group>(null), r = useRef<THREE.Group>(null);
  const open = useRef(0);
  useFrame((_, dt) => {
    const want = bus.door > 0 ? 1 : 0;
    open.current += (want - open.current) * (1 - Math.exp(-dt * 6));
    const o = open.current * 1.45;
    if (l.current) l.current.position.x = -0.75 - o;
    if (r.current) r.current.position.x = 0.75 + o;
  });
  const sign = useMemo(() => stickerSign([{ text: 'same shelf', size: 120 }, { text: 'two shoppers · one shelf', size: 40, font: '700 40px Inter, system-ui' }], { w: 1024, h: 300, brand: true, chip: '🛒', chipColor: '#ffffff' }), []);
  const glass = <meshStandardMaterial color="#d8f3ff" transparent opacity={0.28} roughness={0.05} depthWrite={false} />;
  return (
    <group position={[cfg.entrance.x, 0, wallZ]}>
      {[l, r].map((ref, i) => (
        <group key={i} ref={ref}>
          <mesh position={[0, 1.15, 0]} raycast={noRay}>
            <boxGeometry args={[1.5, 2.3, 0.06]} />
            {glass}
            <Edges color={INK} />
          </mesh>
          <mesh position={[0, 1.0, -0.05]} raycast={noRay}>
            <boxGeometry args={[1.3, 0.12, 0.02]} />
            <meshBasicMaterial color={BRAND_A} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 2.45, 0]} raycast={noRay}>
        <boxGeometry args={[3.4, 0.3, 0.3]} />
        <meshStandardMaterial color={INK} />
      </mesh>
      {[-1, 1].map((k) => (
        <mesh key={k} position={[k * 0.0001, 3.35, k * 0.18]} rotation={[0, k < 0 ? Math.PI : 0, 0]} raycast={noRay}>
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

function MealDeal({ cfg, planogram, products, onProduct, x, z }: { cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>; onProduct: (c: string) => void; x: number; z: number }) {
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
  void cfg;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.5, 0]} castShadow raycast={noRay}>
        <boxGeometry args={[2.6, 1.0, 1.1]} />
        <meshStandardMaterial color="#ffffff" />
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
        <mesh key={k} position={[k * 1.1, 1.6, 0]} raycast={noRay}>
          <cylinderGeometry args={[0.025, 0.025, 1.2]} />
          <meshStandardMaterial color={INK} />
        </mesh>
      ))}
    </group>
  );
}

function AisleSign({ cfg, w }: { cfg: StoreConfig; w: number }) {
  const units = walkwayUnits(cfg, w);
  const tex = useMemo(() => stickerSign([{ text: units.map((u) => `${CAT_EMOJI[u.category] ?? ''} ${catLabel(u.category)}`).join('  ·  ') || 'aisle', size: 64 }], { w: 1400, h: 220, chip: String(w + 1), chipColor: '#FF4079' }), [units]);
  const x = gondolaX(cfg, w + 0.5);
  const y = 3.75;
  return (
    <group position={[x, y, G.zCentre - G.unitLen / 2 + 0.4]}>
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

function Checkouts({ cfg }: { cfg: StoreConfig }) {
  const co = checkoutLayout(cfg);
  const nums = useMemo(() => co.counters.map((_, i) => stickerSign([{ text: String(i + 1), size: 150 }], { w: 256, h: 256, brand: true })), [co.counters]);
  return (
    <group>
      {co.counters.map((x, i) => (
        <group key={i} position={[x, 0, co.z]}>
          <mesh position={[0, 0.47, 0]} castShadow raycast={noRay}>
            <boxGeometry args={[0.95, 0.94, co.len]} />
            <meshStandardMaterial color="#ffffff" />
            <Edges color={INK} />
          </mesh>
          <mesh position={[0, 0.95, -0.2]} raycast={noRay}>
            <boxGeometry args={[0.7, 0.03, co.len - 0.6]} />
            <meshStandardMaterial color="#2a2230" roughness={0.6} />
          </mesh>
          <mesh position={[0.25, 1.25, 0.75]} rotation={[0, -0.6, 0]} raycast={noRay}>
            <boxGeometry args={[0.36, 0.26, 0.05]} />
            <meshStandardMaterial color={INK} emissive="#ff8fb3" emissiveIntensity={0.3} />
          </mesh>
          <mesh position={[0.45, 1.3, -co.len / 2 + 0.1]} raycast={noRay}>
            <cylinderGeometry args={[0.03, 0.03, 2.6]} />
            <meshStandardMaterial color={INK} />
          </mesh>
          <mesh position={[0.45, 2.6, -co.len / 2 + 0.1]} rotation={[0, Math.PI, 0]} raycast={noRay}>
            <planeGeometry args={[0.6, 0.6]} />
            <meshBasicMaterial map={nums[i]} transparent side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Store(props: StoreProps) {
  const { cfg } = props;
  const B = storeBounds(cfg);
  const aisles = Array.from({ length: cfg.aisles }, (_, i) => i + 1);
  const floor = useMemo(() => { const t = floorTexture(); t.repeat.set(B.w / 1.2, B.d / 1.2); return t; }, [B.w, B.d]);
  const band = useMemo(() => canvasTex(512, 32, (ctx) => { const g = ctx.createLinearGradient(0, 0, 512, 0); g.addColorStop(0, '#FF4079'); g.addColorStop(1, '#FE831B'); ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 32); }), []);
  const [z0, z1] = zRange();
  const wallH = 2.6, frontZ = cfg.entrance.z - 1.4;
  const doorHalf = 1.7;
  const co = checkoutLayout(cfg);
  const mealX = cfg.entrance.x + Math.min(5.5, B.w / 2 - 2.5), mealZ = cfg.entrance.z + 2.4;
  // wall + colliders spec
  const walls: [number, number, number, number, number][] = [ // x, z, w, d, h
    [B.cx, B.zMax, B.w, 0.24, wallH],
    [B.xMin, B.cz, 0.24, B.d, wallH],
    [B.xMax, B.cz, 0.24, B.d, wallH],
  ];
  const frontL = (cfg.entrance.x - doorHalf) - B.xMin, frontR = B.xMax - (cfg.entrance.x + doorHalf);
  return (
    <group>
      {/* floor + outdoor pavement */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[B.cx, 0, B.cz]} receiveShadow raycast={noRay}>
        <planeGeometry args={[B.w, B.d]} />
        <meshStandardMaterial map={floor} roughness={0.75} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[B.cx, -0.01, B.zMin - 4]} raycast={noRay}>
        <planeGeometry args={[B.w + 8, 8]} />
        <meshStandardMaterial color="#f6d9cf" roughness={1} />
      </mesh>
      {/* walls (back + sides solid, front is a glass shopfront) */}
      {walls.map(([x, z, w, d, h], i) => (
        <group key={i}>
          <mesh position={[x, h / 2, z]} receiveShadow raycast={noRay}>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color="#fff3ec" />
          </mesh>
          <mesh position={[x, h - 0.2, z]} raycast={noRay}>
            <boxGeometry args={[w + 0.02, 0.22, d + 0.02]} />
            <meshBasicMaterial map={band} />
          </mesh>
        </group>
      ))}
      {[[B.xMin + frontL / 2, frontL], [B.xMax - frontR / 2, frontR]].map(([x, w], i) => (
        <group key={`f${i}`} position={[x, 0, frontZ]}>
          <mesh position={[0, 0.3, 0]} raycast={noRay}><boxGeometry args={[w, 0.6, 0.24]} /><meshStandardMaterial color="#fff3ec" /><Edges color={INK} /></mesh>
          <mesh position={[0, 1.6, 0]} raycast={noRay}><boxGeometry args={[w, 2.0, 0.06]} /><meshStandardMaterial color="#d8f3ff" transparent opacity={0.22} depthWrite={false} /><Edges color={INK} /></mesh>
          <mesh position={[0, wallH - 0.1, 0]} raycast={noRay}><boxGeometry args={[w, 0.2, 0.26]} /><meshBasicMaterial map={band} /></mesh>
        </group>
      ))}
      <Doors cfg={cfg} wallZ={frontZ} />

      {/* gondolas: plinth + centre divider + end panels */}
      {aisles.map((a) => (
        <group key={a} position={[gondolaX(cfg, a), 0, G.zCentre]}>
          <mesh position={[0, 0.06, 0]} castShadow raycast={noRay}>
            <boxGeometry args={[G.depth, 0.12, G.unitLen + 0.1]} />
            <meshStandardMaterial color="#e9dfd8" />
            <Edges color={INK} />
          </mesh>
          <mesh position={[0, G.height / 2, 0]} castShadow raycast={noRay}>
            <boxGeometry args={[0.08, G.height, G.unitLen]} />
            <meshStandardMaterial color="#fff6ef" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, G.height / 2, s * (G.unitLen / 2 + 0.03)]} castShadow raycast={noRay}>
              <boxGeometry args={[G.depth, G.height, 0.06]} />
              <meshStandardMaterial color="#ffffff" />
              <Edges color={INK} />
            </mesh>
          ))}
        </group>
      ))}
      {cfg.units.map((u) => <ShelvingUnit key={u.id} u={u} {...props} />)}
      {aisles.flatMap((a) => {
        const us = cfg.units.filter((u) => u.aisle === a);
        return [-1, 1].map((s, k) => <EndCap key={`${a}${s}`} x={gondolaX(cfg, a)} z={s < 0 ? z0 - 0.03 : z1 + 0.03} dir={s} category={(us[k] ?? us[0])?.category ?? ''} idx={a + k} />);
      })}
      {Array.from({ length: cfg.aisles + 1 }, (_, w) => <AisleSign key={w} cfg={cfg} w={w} />)}
      <Checkouts cfg={cfg} />
      <MealDeal cfg={cfg} planogram={props.planogram} products={props.products} onProduct={props.onProduct} x={mealX} z={mealZ} />

      {/* static colliders */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[B.w / 2 + 6, 0.1, B.d / 2 + 8]} position={[B.cx, -0.1, B.cz - 3]} friction={0.9} restitution={0.2} />
        {walls.map(([x, z, w, d, h], i) => <CuboidCollider key={i} args={[w / 2, h / 2, d / 2]} position={[x, h / 2, z]} />)}
        <CuboidCollider args={[frontL / 2, 1.3, 0.12]} position={[B.xMin + frontL / 2, 1.3, frontZ]} />
        <CuboidCollider args={[frontR / 2, 1.3, 0.12]} position={[B.xMax - frontR / 2, 1.3, frontZ]} />
        {aisles.map((a) => <CuboidCollider key={a} args={[G.depth / 2 + 0.06, 1.1, G.unitLen / 2 + G.endcapDepth]} position={[gondolaX(cfg, a), 1.1, G.zCentre]} restitution={0.5} />)}
        {co.counters.map((x, i) => <CuboidCollider key={i} args={[0.48, 0.5, co.len / 2]} position={[x, 0.5, co.z]} />)}
        <CuboidCollider args={[1.3, 0.6, 0.55]} position={[mealX, 0.6, mealZ]} />
      </RigidBody>
    </group>
  );
}

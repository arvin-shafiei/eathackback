import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Planogram, Product, StoreConfig, Unit } from '../types';
import { G, gondolaX, rowGap, rowY, slotPlacements, unitFrame, crossBack, crossFront } from '../layout';
import { catColor, catLabel, INK, BRAND_A } from '../theme';
import { productTexture } from './textures';

const CAT_H: Record<string, number> = { soft_drinks: 0.36, crisps_savoury: 0.34, snack_bars: 0.22, breakfast_cereal: 0.44, yoghurt: 0.2, biscuits_chocolate: 0.24, plant_milk_dairy_alt: 0.4, ready_meals_soup: 0.3 };

function signTexture(text: string, sub: string, color: string) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 192;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fffaf5'; ctx.strokeStyle = INK; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.roundRect(8, 8, 1008, 176, 40); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(96, 96, 46, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 8; ctx.stroke();
  ctx.fillStyle = INK; ctx.font = '800 84px "Baloo 2", system-ui'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 170, 88);
  ctx.font = '700 40px Inter, system-ui'; ctx.fillStyle = '#6b5a66'; ctx.textAlign = 'right'; ctx.fillText(sub, 980, 96);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function ProductBox({ p, w, h, selected, heat, onClick }: { p: Product; w: number; h: number; selected: boolean; heat?: string; onClick: (e: ThreeEvent<MouseEvent>) => void }) {
  const [, bump] = useState(0);
  const tex = productTexture(p, () => bump((n) => n + 1));
  const side = useMemo(() => new THREE.Color(p.color || catColor(p.category)).multiplyScalar(0.85), [p]);
  return (
    <group>
      <mesh castShadow onClick={onClick} position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, 0.28]} />
        <meshStandardMaterial attach="material-0" color={side} roughness={0.6} />
        <meshStandardMaterial attach="material-1" color={side} roughness={0.6} />
        <meshStandardMaterial attach="material-2" color={side} roughness={0.6} />
        <meshStandardMaterial attach="material-3" color={side} roughness={0.6} />
        <meshStandardMaterial attach="material-4" map={tex} roughness={0.45} emissive={selected ? BRAND_A : '#000'} emissiveIntensity={selected ? 0.25 : 0} />
        <meshStandardMaterial attach="material-5" color={side} roughness={0.6} />
        <Edges color={selected ? BRAND_A : INK} threshold={15} />
      </mesh>
      {heat && (
        <mesh position={[0, -0.012, 0.16]}>
          <boxGeometry args={[w * 0.96, 0.05, 0.03]} />
          <meshBasicMaterial color={heat} />
        </mesh>
      )}
    </group>
  );
}

interface UnitProps {
  cfg: StoreConfig; u: Unit; planogram: Planogram; products: Record<string, Product>;
  selectedProduct: string | null; onProduct: (code: string) => void;
  editMode: boolean; editSel: string | null; onSlot: (slot: string) => void; changed: Set<string>;
  heat: Record<string, string> | null;
}

function ShelvingUnit({ cfg, u, planogram, products, selectedProduct, onProduct, editMode, editSel, onSlot, changed, heat }: UnitProps) {
  const f = unitFrame(cfg, u);
  const sign = useMemo(() => signTexture(catLabel(u.category), `${u.id} · aisle ${u.aisle}${u.side.toLowerCase()}`, catColor(u.category)), [u]);
  const gap = rowGap(cfg);
  const rows = Array.from({ length: cfg.rows_per_unit }, (_, i) => i + 1);
  return (
    <group position={[f.x, 0, f.z]} rotation={[0, f.rotY, 0]}>
      {/* category header */}
      <mesh position={[0, G.height + 0.32, -0.25]}>
        <planeGeometry args={[2.6, 0.49]} />
        <meshBasicMaterial map={sign} transparent />
      </mesh>
      {rows.map((r) => {
        const slot = `${u.id}-r${r}`;
        const y = rowY(cfg, r);
        const set = planogram[slot];
        const pl = slotPlacements(slot, set);
        const isSel = editSel === slot;
        const isChanged = changed.has(slot);
        return (
          <group key={slot} position={[0, y, 0]}>
            {/* shelf board + price rail */}
            <mesh receiveShadow position={[0, -0.03, -0.22]}>
              <boxGeometry args={[G.unitLen, 0.05, 0.5]} />
              <meshStandardMaterial color="#f3ece6" />
            </mesh>
            <mesh position={[0, -0.03, 0.035]}>
              <boxGeometry args={[G.unitLen, 0.07, 0.02]} />
              <meshStandardMaterial color={isChanged ? '#FFE14D' : '#ffffff'} />
              <Edges color={INK} />
            </mesh>
            {pl.map((p) => {
              const prod = products[p.code] ?? ({ code: p.code, name: p.code, brand: 'unknown', category: set?.category ?? '', role: '', price_gbp: 0 } as Product);
              const h = Math.min(CAT_H[prod.category] ?? 0.3, gap - 0.1);
              return Array.from({ length: p.facings }, (_, i) => (
                <group key={`${p.code}-${i}`} position={[p.lx + (i - (p.facings - 1) / 2) * p.width, 0, -0.2]}>
                  <ProductBox
                    p={prod} w={p.width * 0.86} h={h}
                    selected={selectedProduct === p.code}
                    heat={heat?.[p.code]}
                    onClick={(e) => { e.stopPropagation(); if (editMode) onSlot(slot); else onProduct(p.code); }}
                  />
                </group>
              ));
            })}
            {editMode && (
              <mesh position={[0, gap / 2 - 0.05, 0.05]} onClick={(e) => { e.stopPropagation(); onSlot(slot); }}>
                <planeGeometry args={[G.unitLen - 0.1, gap - 0.12]} />
                <meshBasicMaterial color={isSel ? BRAND_A : isChanged ? '#FFE14D' : '#ffffff'} transparent opacity={isSel ? 0.35 : isChanged ? 0.22 : 0.06} depthWrite={false} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

export function Store(props: Omit<UnitProps, 'u'>) {
  const { cfg } = props;
  const aisles = Array.from({ length: cfg.aisles }, (_, i) => i + 1);
  const width = (cfg.aisles + 1) * G.spacing + 4;
  const zMin = Math.min(cfg.entrance.z, crossFront()) - 3, zMax = Math.max(cfg.checkout.z, crossBack()) + 3;
  return (
    <group>
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, (zMin + zMax) / 2]} receiveShadow>
        <planeGeometry args={[width, zMax - zMin]} />
        <meshStandardMaterial color="#fbf1ea" />
      </mesh>
      {/* walkway lanes */}
      {Array.from({ length: cfg.aisles + 1 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[gondolaX(cfg, i + 0.5), 0.003, G.zCentre]}>
          <planeGeometry args={[1.1, G.unitLen + 1.2]} />
          <meshBasicMaterial color="#f6e2d8" />
        </mesh>
      ))}
      {/* gondolas: base + centre divider */}
      {aisles.map((a) => (
        <group key={a} position={[gondolaX(cfg, a), 0, G.zCentre]}>
          <mesh position={[0, 0.05, 0]} castShadow>
            <boxGeometry args={[G.depth, 0.1, G.unitLen + 0.1]} />
            <meshStandardMaterial color="#e9dfd8" />
            <Edges color={INK} />
          </mesh>
          <mesh position={[0, G.height / 2, 0]} castShadow>
            <boxGeometry args={[0.06, G.height, G.unitLen]} />
            <meshStandardMaterial color="#fff6ef" />
            <Edges color={INK} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, G.height / 2, s * (G.unitLen / 2 + 0.03)]} castShadow>
              <boxGeometry args={[G.depth, G.height, 0.06]} />
              <meshStandardMaterial color="#ffffff" />
              <Edges color={INK} />
            </mesh>
          ))}
        </group>
      ))}
      {cfg.units.map((u) => <ShelvingUnit key={u.id} u={u} {...props} />)}
      {/* entrance mat + checkout */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cfg.entrance.x, 0.006, cfg.entrance.z]}>
        <planeGeometry args={[3.2, 1.6]} />
        <meshBasicMaterial color={BRAND_A} />
      </mesh>
      <group position={[cfg.checkout.x, 0, cfg.checkout.z + 1.2]}>
        {[-2.4, 0, 2.4].map((dx) => (
          <mesh key={dx} position={[dx, 0.45, 0]} castShadow>
            <boxGeometry args={[1.6, 0.9, 0.7]} />
            <meshStandardMaterial color="#ffffff" />
            <Edges color={INK} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// Product boxes on the shelves, instanced per product (one draw call per SKU) with the real OFF image on the front.
// Facings come from the planogram. When a shopper takes a pack the facing disappears (a real gap) until a
// visual restock; rejected packs come back when they're put back.
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import type { Planogram, Product, StoreConfig } from '../types';
import { categoryHeight, parseSlot, rowGap, rowY, slotPlacements, unitFrame, unitLocalToWorld } from '../layout';
import { productMaterials } from './textures';

interface Props {
  cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>;
  gaps: Record<string, [number, number][]>; timeRef: MutableRefObject<number>; live: boolean;
  selectedProduct: string | null; onProduct: (code: string) => void; editMode: boolean; onSlot: (slot: string) => void;
}
interface Facing { slot: string; m: THREE.Matrix4 }
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const POP = 0.35;

export function Shelves({ cfg, planogram, products, gaps, timeRef, live, selectedProduct, onProduct, editMode, onSlot }: Props) {
  const built = useMemo(() => {
    const byCode = new Map<string, Facing[]>();
    const gap = rowGap(cfg);
    for (const [slot, set] of Object.entries(planogram)) {
      const { unit, row } = parseSlot(slot);
      const u = cfg.units.find((x) => x.id === unit); if (!u) continue;
      const f = unitFrame(cfg, u);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.rotY);
      for (const p of slotPlacements(slot, set)) {
        const cat = products[p.code]?.category ?? set.category ?? u.category;
        const h = Math.min(categoryHeight(cat), gap - 0.1);
        for (let i = 0; i < p.facings; i++) {
          const lx = p.lx + (i - (p.facings - 1) / 2) * p.width;
          const w = unitLocalToWorld(cfg, u, lx, -0.2);
          const m = new THREE.Matrix4().compose(new THREE.Vector3(w.x, rowY(cfg, row) + h / 2, w.z), q, new THREE.Vector3(p.width * 0.86, h, 0.28));
          const list = byCode.get(p.code) ?? []; list.push({ slot, m }); byCode.set(p.code, list);
        }
      }
    }
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const meshes: { code: string; mesh: THREE.InstancedMesh; facings: Facing[]; inkStart: number }[] = [];
    let total = 0;
    for (const [code, facings] of byCode) {
      const prod = products[code] ?? ({ code, name: code, brand: 'unknown', category: planogram[facings[0].slot]?.category ?? '', role: '', price_gbp: 0 } as Product);
      const mesh = new THREE.InstancedMesh(unitBox, productMaterials(prod), facings.length);
      mesh.castShadow = true; mesh.frustumCulled = false;
      facings.forEach((f, i) => mesh.setMatrixAt(i, f.m));
      meshes.push({ code, mesh, facings, inkStart: total });
      total += facings.length;
    }
    const ink = new THREE.InstancedMesh(unitBox, new THREE.MeshBasicMaterial({ color: '#141014', side: THREE.BackSide }), Math.max(1, total));
    ink.frustumCulled = false; ink.count = total;
    const inkM = (m: THREE.Matrix4) => {
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(p, q, s);
      return new THREE.Matrix4().compose(p, q, s.addScalar(0.028));
    };
    const inkMats = meshes.flatMap((x) => x.facings.map((f) => inkM(f.m)));
    inkMats.forEach((m, i) => ink.setMatrixAt(i, m));
    return { meshes, ink, inkMats };
  }, [cfg, planogram, products]);
  useEffect(() => () => { built.ink.geometry.dispose(); }, [built]);

  const sig = useRef(new Map<string, string>());
  useEffect(() => { sig.current.clear(); }, [built]);
  useFrame((state) => {
    const t = timeRef.current, now = state.clock.elapsedTime;
    let inkDirty = false;
    for (const x of built.meshes) {
      const iv = live ? gaps[x.code] : undefined;
      let hidden = 0, pop = 1;
      if (iv) for (const [a, b] of iv) { if (t >= a && t < b) hidden++; else if (t >= b && t < b + POP) pop = Math.min(pop, (t - b) / POP); }
      hidden = Math.min(hidden, x.facings.length);
      const key = `${hidden}:${pop < 1 ? pop.toFixed(2) : 1}`;
      if (sig.current.get(x.code) === key) continue;
      sig.current.set(x.code, key);
      const n = x.facings.length;
      x.facings.forEach((f, i) => {
        const gone = i >= n - hidden; // take from the end of the run of facings
        let m = f.m;
        if (!gone && pop < 1 && i === n - hidden - 1) {
          const k = 1 + Math.sin(pop * Math.PI) * 0.25; // restock boing
          m = f.m.clone().multiply(new THREE.Matrix4().makeScale(k, pop * k, k));
        }
        x.mesh.setMatrixAt(i, gone ? ZERO : m);
        built.ink.setMatrixAt(x.inkStart + i, gone ? ZERO : built.inkMats[x.inkStart + i]);
      });
      x.mesh.instanceMatrix.needsUpdate = true; inkDirty = true;
    }
    if (inkDirty) built.ink.instanceMatrix.needsUpdate = true;
    // selected product glows (shared material, so the carried copies glow too)
    for (const x of built.meshes) {
      const front = (x.mesh.material as THREE.MeshStandardMaterial[])[4];
      const on = x.code === selectedProduct;
      front.emissive.set(on ? '#FF4079' : '#000000');
      front.emissiveIntensity = on ? 0.25 + Math.sin(now * 5) * 0.12 : 0;
    }
  });

  return (
    <group>
      <primitive object={built.ink} />
      {built.meshes.map((x) => (
        <primitive
          key={x.code} object={x.mesh}
          onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const f = e.instanceId !== undefined ? x.facings[e.instanceId] : undefined; if (editMode && f) onSlot(f.slot); else onProduct(x.code); }}
          onPointerOver={() => (document.body.style.cursor = 'pointer')} onPointerOut={() => (document.body.style.cursor = '')}
        />
      ))}
    </group>
  );
}

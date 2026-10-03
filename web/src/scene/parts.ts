// Cartoon shopper kit: every body part / accessory is one shared geometry + material, drawn instanced.
// Origin of a shopper = floor under the body centre, facing +z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { INK } from '../theme';
import { badgeTexture } from './textures';

export const BODY = { r: 0.3, center: 0.6, eyeY: 0.98, eyeX: 0.12, eyeZ: 0.235, shoulderX: 0.33, shoulderY: 0.78, armLen: 0.38 };

export type Attach = 'root' | 'handR' | 'handL';
export interface PartUse { key: string; attach: Attach; m: THREE.Matrix4 }

const M = (pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));

/** outline material: back faces pushed out along the normal (toon "ink" hull) */
export function inkHull(px = 0.022) {
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normal * ${px.toFixed(3)};`); };
  return m;
}

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.38, ...extra });

interface PartDef { geom: () => THREE.BufferGeometry; mat: () => THREE.Material | THREE.Material[]; shadow?: boolean }
export const PARTS: Record<string, PartDef> = {
  // headgear + props
  leaf: { geom: () => new THREE.SphereGeometry(0.16, 16, 10).scale(1.7, 0.32, 1.1), mat: () => std('#3fbf5f') },
  leafStem: { geom: () => new THREE.CylinderGeometry(0.018, 0.018, 0.14), mat: () => std('#2a7a3c') },
  magRing: { geom: () => new THREE.TorusGeometry(0.085, 0.022, 8, 22), mat: () => std(INK) },
  magLens: { geom: () => new THREE.CircleGeometry(0.08, 20), mat: () => new THREE.MeshStandardMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.55, roughness: 0.05, side: THREE.DoubleSide }) },
  magHandle: { geom: () => new THREE.CylinderGeometry(0.02, 0.024, 0.16), mat: () => std('#a0643a') },
  beanie: { geom: () => new THREE.SphereGeometry(0.315, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.78, 1), mat: () => std('#2a8fc0') },
  pompom: { geom: () => new THREE.SphereGeometry(0.075, 12, 8), mat: () => std('#ffffff') },
  calc: { geom: () => new THREE.BoxGeometry(0.17, 0.23, 0.045), mat: () => std('#f7b801') },
  calcScreen: { geom: () => new THREE.BoxGeometry(0.13, 0.06, 0.05), mat: () => std('#2f4a35', { emissive: '#7CFF9B', emissiveIntensity: 0.25 }) },
  headband: { geom: () => new THREE.TorusGeometry(0.29, 0.045, 8, 28), mat: () => std('#ff3b3b') },
  dbBar: { geom: () => new THREE.CylinderGeometry(0.022, 0.022, 0.36), mat: () => std('#8a8a95', { metalness: 0.6, roughness: 0.25 }) },
  dbWeight: { geom: () => new THREE.SphereGeometry(0.085, 14, 10), mat: () => std(INK, { roughness: 0.3 }) },
  brow: { geom: () => new THREE.BoxGeometry(0.15, 0.04, 0.035), mat: () => std(INK) },
  capTop: { geom: () => new THREE.CylinderGeometry(0.29, 0.31, 0.1, 22), mat: () => std('#6d5243', { roughness: 0.9 }) },
  capBrim: { geom: () => new THREE.BoxGeometry(0.36, 0.035, 0.2), mat: () => std('#5a4236', { roughness: 0.9 }) },
  tie: { geom: () => new THREE.BoxGeometry(0.09, 0.3, 0.03), mat: () => std('#e63946') },
  tieKnot: { geom: () => new THREE.BoxGeometry(0.1, 0.07, 0.045), mat: () => std('#b81f2d') },
  lanyard: { geom: () => new THREE.BoxGeometry(0.11, 0.14, 0.02), mat: () => std('#ffffff') },
  sproutStem: { geom: () => new THREE.CylinderGeometry(0.016, 0.016, 0.22), mat: () => std('#3a8a2a') },
  sproutLeaf: { geom: () => new THREE.SphereGeometry(0.075, 12, 8).scale(1.7, 0.4, 0.85), mat: () => std('#80b918') },
  gfBadge: {
    geom: () => new THREE.CylinderGeometry(0.105, 0.105, 0.03, 24),
    mat: () => { const t = badgeTexture('gf', '#f4a3c8'); return [std(INK), new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }), std(INK)]; },
  },
  phonesBand: { geom: () => new THREE.TorusGeometry(0.31, 0.032, 8, 24, Math.PI), mat: () => std(INK) },
  phonesCup: { geom: () => new THREE.CylinderGeometry(0.1, 0.1, 0.07, 18), mat: () => std('#9b5de5') },
  stick: { geom: () => new THREE.CylinderGeometry(0.016, 0.016, 1.0), mat: () => std('#c7c7d1', { metalness: 0.5, roughness: 0.25 }) },
  phone: { geom: () => new THREE.BoxGeometry(0.12, 0.22, 0.025), mat: () => std(INK, { emissive: '#ff4ecd', emissiveIntensity: 0.15 }) },
  ringLight: { geom: () => new THREE.TorusGeometry(0.15, 0.018, 8, 26), mat: () => new THREE.MeshBasicMaterial({ color: '#fff6c9' }) },
  // robot
  robotScreen: { geom: () => new RoundedBoxGeometry(0.46, 0.28, 0.04, 2, 0.04), mat: () => std('#120c22', { roughness: 0.15 }) },
  robotEye: { geom: () => new THREE.BoxGeometry(0.08, 0.07, 0.02), mat: () => new THREE.MeshBasicMaterial({ color: '#7CFFCB' }) },
  antenna: { geom: () => new THREE.CylinderGeometry(0.016, 0.016, 0.24), mat: () => std(INK) },
  bulb: { geom: () => new THREE.SphereGeometry(0.06, 12, 8), mat: () => new THREE.MeshBasicMaterial({ color: '#FFE14D' }) },
  hoverRing: { geom: () => new THREE.TorusGeometry(0.22, 0.03, 8, 24), mat: () => new THREE.MeshBasicMaterial({ color: '#7CFFCB', transparent: true, opacity: 0.6 }) },
};

const HEAD = 1.13;
/** accessory kit per archetype: the 3D twin of ARCH_GEAR in theme.ts */
export function accessoriesFor(arch: string): PartUse[] {
  const r = (key: string, m: THREE.Matrix4, attach: Attach = 'root'): PartUse => ({ key, attach, m });
  switch (arch) {
    case 'eco_low_chemical': return [r('leaf', M([0.04, HEAD + 0.1, 0], [0.1, 0.4, 0.32])), r('leafStem', M([0, HEAD + 0.06, 0]))];
    case 'upf_avoider_parent': return [r('magRing', M([0, -0.2, 0.06]), 'handR'), r('magLens', M([0, -0.2, 0.065])), r('magHandle', M([0, -0.08, 0.02]), 'handR')].map((p) => (p.key === 'magLens' ? { ...p, attach: 'handR' as Attach } : p));
    case 'glp1_small_appetite': return [r('beanie', M([0, 0.98, 0])), r('pompom', M([0, HEAD + 0.12, 0]))];
    case 'frugal_unit_price': return [r('calc', M([0, -0.1, 0.07], [-0.4, 0, 0]), 'handR'), r('calcScreen', M([0, -0.05, 0.08], [-0.4, 0, 0]), 'handR')];
    case 'protein_gym': return [r('headband', M([0, 1.02, 0], [Math.PI / 2, 0, 0])), r('dbBar', M([0, -0.06, 0.02], [0, 0, Math.PI / 2]), 'handR'), r('dbWeight', M([0.18, -0.06, 0.02]), 'handR'), r('dbWeight', M([-0.18, -0.06, 0.02]), 'handR')];
    case 'protein_sceptic_gimmick_reactant': return [r('brow', M([0.12, 1.13, 0.255], [0, 0, 0.32])), r('brow', M([-0.12, 1.1, 0.26], [0, 0, 0.08]))];
    case 'habit_loyalist_shrinkflation_angry': return [r('capTop', M([0, HEAD - 0.02, -0.01])), r('capBrim', M([0, HEAD - 0.05, 0.27], [0.15, 0, 0]))];
    case 'meal_deal_office': return [r('tie', M([0, 0.6, 0.285], [-0.14, 0, 0])), r('tieKnot', M([0, 0.77, 0.27], [-0.2, 0, 0])), r('lanyard', M([-0.14, 0.58, 0.28], [-0.15, 0, 0]))];
    case 'vegan_ethical': return [r('sproutStem', M([0, HEAD + 0.1, 0])), r('sproutLeaf', M([0.09, HEAD + 0.22, 0], [0, 0, 0.45])), r('sproutLeaf', M([-0.09, HEAD + 0.22, 0], [0, 0, -0.45]))];
    case 'allergen_coeliac': return [r('gfBadge', M([0.14, 0.62, 0.285], [Math.PI / 2, 0, 0]))];
    case 'ai_delegator': return [r('phonesBand', M([0, 0.93, 0])), r('phonesCup', M([0.31, 0.93, 0], [0, 0, Math.PI / 2])), r('phonesCup', M([-0.31, 0.93, 0], [0, 0, Math.PI / 2]))];
    case 'novelty_seeker_tiktok': {
      const a = new THREE.Vector3(0.42, 0.95, 0.25), b = new THREE.Vector3(0.62, 1.75, 0.75);
      const mid = a.clone().add(b).multiplyScalar(0.5), dir = b.clone().sub(a);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      const stick = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, dir.length(), 1));
      const face = new THREE.Matrix4().lookAt(b, new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0, 1, 0));
      const qp = new THREE.Quaternion().setFromRotationMatrix(face);
      const phone = new THREE.Matrix4().compose(b, qp, new THREE.Vector3(1, 1, 1));
      const ring = new THREE.Matrix4().compose(b, qp, new THREE.Vector3(1, 1, 1));
      return [r('stick', stick), r('phone', phone), r('ringLight', ring)];
    }
    default: return [];
  }
}
export const ROBOT_PARTS: PartUse[] = [
  { key: 'robotScreen', attach: 'root', m: M([0, 0.88, 0.235]) },
  { key: 'robotEye', attach: 'root', m: M([0.09, 0.9, 0.26]) },
  { key: 'robotEye', attach: 'root', m: M([-0.09, 0.9, 0.26]) },
  { key: 'antenna', attach: 'root', m: M([0, 1.24, 0]) },
  { key: 'bulb', attach: 'root', m: M([0, 1.38, 0]) },
  { key: 'hoverRing', attach: 'root', m: M([0, 0.06, 0], [Math.PI / 2, 0, 0]) },
];

// ---------- core body geometry ----------
export const GEO = {
  bean: () => new THREE.CapsuleGeometry(BODY.r, 0.6, 8, 22).translate(0, BODY.center, 0),
  robot: () => new RoundedBoxGeometry(0.62, 0.92, 0.5, 4, 0.14).translate(0, 0.7, 0),
  eyeWhite: () => new THREE.SphereGeometry(0.11, 18, 12),
  pupil: () => new THREE.SphereGeometry(0.055, 12, 8),
  arm: () => mergeGeometries([new THREE.CapsuleGeometry(0.055, 0.24, 4, 10).translate(0, -0.17, 0), new THREE.SphereGeometry(0.078, 12, 8).translate(0, -BODY.armLen, 0)]),
  foot: () => new THREE.SphereGeometry(0.1, 12, 8).scale(1, 0.5, 1.45),
  blob: () => new THREE.CircleGeometry(0.46, 24).rotateX(-Math.PI / 2),
};

// ---------- carriers ----------
function colored(g: THREE.BufferGeometry, color: string) {
  const g2 = g.index ? g : g;
  const c = new THREE.Color(color);
  const n = g2.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g2.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g2;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

/** trolley: local origin on the floor under its centre. interior: x ±0.28, z ±0.36, floor y 0.44 */
export const TROLLEY = { hx: 0.3, hz: 0.38, floorY: 0.44, wallH: 0.36, anchor: [0, -BODY.center, 0.88] as [number, number, number] };
export function trolleyGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const wire = '#c9cfdc', rim = '#FF4079', frame = '#8b92a3';
  const { hx, hz, floorY, wallH } = TROLLEY;
  parts.push(box(hx * 2, 0.03, hz * 2, 0, floorY, 0, wire));
  for (const y of [floorY + wallH * 0.33, floorY + wallH * 0.66]) {
    parts.push(box(0.02, 0.02, hz * 2, hx, y, 0, wire), box(0.02, 0.02, hz * 2, -hx, y, 0, wire));
    parts.push(box(hx * 2, 0.02, 0.02, 0, y, hz, wire), box(hx * 2, 0.02, 0.02, 0, y, -hz, wire));
  }
  // chunky brand rim
  parts.push(box(0.05, 0.05, hz * 2 + 0.05, hx, floorY + wallH, 0, rim), box(0.05, 0.05, hz * 2 + 0.05, -hx, floorY + wallH, 0, rim));
  parts.push(box(hx * 2 + 0.05, 0.05, 0.05, 0, floorY + wallH, hz, rim), box(hx * 2 + 0.05, 0.05, 0.05, 0, floorY + wallH, -hz, rim));
  for (const x of [-0.2, -0.07, 0.07, 0.2]) { parts.push(box(0.016, wallH, 0.016, x, floorY + wallH / 2, hz, wire), box(0.016, wallH, 0.016, x, floorY + wallH / 2, -hz, wire)); }
  for (const z of [-0.2, 0, 0.2]) { parts.push(box(0.016, wallH, 0.016, hx, floorY + wallH / 2, z, wire), box(0.016, wallH, 0.016, -hx, floorY + wallH / 2, z, wire)); }
  // handle + uprights
  parts.push(box(0.66, 0.06, 0.06, 0, floorY + wallH + 0.14, -hz - 0.1, INK));
  parts.push(box(0.03, 0.2, 0.03, 0.3, floorY + wallH + 0.05, -hz - 0.06, frame), box(0.03, 0.2, 0.03, -0.3, floorY + wallH + 0.05, -hz - 0.06, frame));
  // chassis + wheels
  parts.push(box(0.04, 0.04, hz * 2, 0.22, 0.12, 0, frame), box(0.04, 0.04, hz * 2, -0.22, 0.12, 0, frame));
  for (const [x, z] of [[0.22, 0.32], [-0.22, 0.32], [0.22, -0.32], [-0.22, -0.32]]) {
    parts.push(box(0.03, floorY - 0.12, 0.03, x, (floorY + 0.12) / 2, z, frame));
    parts.push(colored(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12).rotateZ(Math.PI / 2).translate(x, 0.06, z), INK));
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}
/** basket: local origin = basket floor centre. interior: x ±0.18, z ±0.12 */
export const BASKET = { hx: 0.2, hz: 0.14, wallH: 0.2, anchor: [-0.5, 0.2 - BODY.center, 0.08] as [number, number, number] };
export function basketGeometry() {
  const red = '#ff3b5c', dark = '#c2183f';
  const { hx, hz, wallH } = BASKET;
  const parts = [
    box(hx * 2, 0.025, hz * 2, 0, 0.012, 0, dark),
    box(0.025, wallH, hz * 2, hx, wallH / 2, 0, red), box(0.025, wallH, hz * 2, -hx, wallH / 2, 0, red),
    box(hx * 2, wallH, 0.025, 0, wallH / 2, hz, red), box(hx * 2, wallH, 0.025, 0, wallH / 2, -hz, red),
    colored(new THREE.TorusGeometry(0.15, 0.018, 6, 16, Math.PI).translate(0, wallH, 0), INK),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

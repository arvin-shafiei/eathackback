// Shopper kit: ONE goggle-wearing capsule character for every shopper (people and AI agents alike), each part one
// shared geometry drawn instanced (body colour = archetype colour via instanceColor). Original design: rounded
// capsule body, chrome-rimmed goggles on a dark strap, denim dungarees, little gloves + shoes, a tuft of hair.
// Origin of a shopper = floor under the body centre, facing +z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { INK } from '../theme';

export const BODY = {
  r: 0.3, center: 0.6, top: 1.2,
  eyeY: 0.94, eyeX: 0.148, eyeZ: 0.245, eyeR: 0.115,
  mouthY: 0.735, mouthZ: 0.29,
  shoulderX: 0.3, shoulderY: 0.66, armLen: 0.3,
};

/** outline material: back faces pushed out along the normal (toon "ink" hull) */
export function inkHull(px = 0.022) {
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normal * ${px.toFixed(3)};`); };
  return m;
}

/** ai shoppers are archetypes too (persona_id / archetype on the record), never keyed on the model string */
export type AiKind = 'general' | 'retailer' | 'price';
export function aiKindOf(key: string): AiKind {
  const k = key.toLowerCase();
  if (/retail|loyal|store|club/.test(k)) return 'retailer';
  if (/price|bot|deal|frugal|cheap/.test(k)) return 'price';
  return 'general';
}
/** AI archetypes wear the same character; they just get their own body colours */
export const AI_KIND: Record<AiKind, { body: string; label: string }> = {
  general: { body: '#b9a6ff', label: 'general AI assistant' },
  retailer: { body: '#5ec8f2', label: 'retailer AI assistant' },
  price: { body: '#ffd84a', label: 'price-comparison bot' },
};

/** a box from a to b (width w, thickness d), coloured */
function strip(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, color: string) {
  const dir = b.clone().sub(a), len = dir.length();
  const g = new THREE.BoxGeometry(w, len, d);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return colored(g, color);
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------- character geometry (all body-frame, origin on the floor) ----------
export const GEO = {
  body: () => new THREE.CapsuleGeometry(BODY.r, BODY.top - BODY.r * 2, 10, 26).translate(0, BODY.center, 0),
  /** denim dungarees: seat + legs band, front bib, pocket, straps, buttons (vertex coloured, one draw) */
  overalls: () => {
    const denim = '#ffffff', seam = '#c8c8c8', /* white so instanceColor = shopper-type colour shows on the overalls */ btn = '#1d1b22', R = BODY.r + 0.012;
    const parts = [
      colored(new THREE.SphereGeometry(R, 26, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).translate(0, BODY.r, 0), denim),
      colored(new THREE.CylinderGeometry(R, R, 0.16, 26, 1, true).translate(0, BODY.r + 0.08, 0), denim),
      colored(new THREE.CylinderGeometry(R + 0.002, R + 0.002, 0.018, 26, 1, true).translate(0, BODY.r + 0.16, 0), seam),
      colored(new THREE.CylinderGeometry(R, R, 0.17, 10, 1, true, -0.62, 1.24).translate(0, BODY.r + 0.16 + 0.085, 0), denim),
      colored(new THREE.BoxGeometry(0.13, 0.075, 0.02).translate(0, 0.53, R - 0.005), seam),
      strip(V(0.17, 0.62, 0.262), V(0.255, 0.86, 0.17), 0.05, 0.018, denim),
      strip(V(-0.17, 0.62, 0.262), V(-0.255, 0.86, 0.17), 0.05, 0.018, denim),
      strip(V(0.255, 0.86, -0.17), V(0.13, 0.46, -0.285), 0.05, 0.018, denim),
      strip(V(-0.255, 0.86, -0.17), V(-0.13, 0.46, -0.285), 0.05, 0.018, denim),
      colored(new THREE.SphereGeometry(0.024, 10, 6).translate(0.155, 0.615, 0.3), btn),
      colored(new THREE.SphereGeometry(0.024, 10, 6).translate(-0.155, 0.615, 0.3), btn),
    ];
    return mergeGeometries(parts.map((g) => g.toNonIndexed()));
  },
  /** goggle strap round the head */
  strap: () => new THREE.CylinderGeometry(BODY.r + 0.008, BODY.r + 0.008, 0.075, 28, 1, true).translate(0, BODY.eyeY, 0),
  /** chrome goggle rim (one per eye); origin = eye centre, ring faces +z */
  rim: () => new THREE.TorusGeometry(BODY.eyeR + 0.012, 0.034, 10, 26).translate(0, 0, 0.04),
  /** eye white; origin = eye centre */
  eye: () => new THREE.SphereGeometry(BODY.eyeR, 20, 14).scale(1, 1, 0.72),
  /** brown iris + black pupil + glint (vertex coloured); origin = eye front */
  iris: () => mergeGeometries([
    colored(new THREE.CircleGeometry(0.048, 18), '#6b3f1f'),
    colored(new THREE.CircleGeometry(0.026, 14).translate(0, 0, 0.002), '#0d0b0f'),
    colored(new THREE.CircleGeometry(0.011, 8).translate(0.016, 0.017, 0.004), '#ffffff'),
  ].map((g) => g.toNonIndexed())),
  /** smile arc; origin = mouth centre (flip y for a frown) */
  mouth: () => new THREE.TorusGeometry(0.055, 0.012, 6, 14, Math.PI).rotateZ(Math.PI).translate(0, 0.03, 0),
  /** tuft of hair; origin = crown */
  hair: () => mergeGeometries([-0.5, -0.25, 0, 0.25, 0.5].map((a, i) => new THREE.CylinderGeometry(0.006, 0.009, 0.15 + (i % 2) * 0.03, 5)
    .translate(0, 0.075, 0).rotateZ(a * 0.9).rotateX(((i * 37) % 5 - 2) * 0.08))),
  /** arm (white, tinted by instanceColor) ending in a dark glove (vertex colours multiply with instanceColor) */
  arm: () => mergeGeometries([
    colored(new THREE.CapsuleGeometry(0.045, BODY.armLen - 0.08, 4, 10).translate(0, -BODY.armLen / 2 + 0.02, 0), '#ffffff'),
    colored(new THREE.SphereGeometry(0.068, 12, 8).scale(1, 1.1, 0.9).translate(0, -BODY.armLen, 0), '#262428'),
    colored(new THREE.CapsuleGeometry(0.022, 0.04, 3, 6).rotateZ(0.9).translate(0.055, -BODY.armLen + 0.03, 0.02), '#262428'),
  ].map((g) => g.toNonIndexed())),
  foot: () => new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1.45),
  blob: () => new THREE.CircleGeometry(0.46, 24).rotateX(-Math.PI / 2),
  /** goggles: a dark strap round the head and a silver ring at each eye */
  goggles: () => mergeGeometries([
    colored(new THREE.TorusGeometry(BODY.r + 0.012, 0.034, 8, 30).rotateX(Math.PI / 2).translate(0, BODY.eyeY, 0), '#141014'),
    colored(new THREE.TorusGeometry(0.128, 0.036, 8, 22).translate(BODY.eyeX + 0.01, BODY.eyeY, BODY.eyeZ + 0.03), '#c9ced6'),
    colored(new THREE.TorusGeometry(0.128, 0.036, 8, 22).translate(-BODY.eyeX - 0.01, BODY.eyeY, BODY.eyeZ + 0.03), '#c9ced6'),
  ]),
};
/** where the dungarees stop (bean spans y 0..1.2) */
const OVERALLS_WAIST = 0.52;
/** every human shopper's skin; the shopper-type colour moves to the dungarees */
export const SHOPPER_SKIN = '#FFD83D';

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

/** trolley (sized for the little capsule shoppers): local origin on the floor under its centre. interior: x ±0.28, z ±0.36, floor y 0.3 */
export const TROLLEY = { hx: 0.3, hz: 0.38, floorY: 0.3, wallH: 0.3, handleUp: 0.05, anchor: [0, -BODY.center, 0.88] as [number, number, number] };
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
  parts.push(box(0.66, 0.06, 0.06, 0, floorY + wallH + TROLLEY.handleUp, -hz - 0.1, '#FF4079'));
  parts.push(box(0.03, 0.12, 0.03, 0.3, floorY + wallH + 0.02, -hz - 0.06, frame), box(0.03, 0.12, 0.03, -0.3, floorY + wallH + 0.02, -hz - 0.06, frame));
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

/** paper carrier bag (after paying): origin = handle top */
export function bagGeometry() {
  const kraft = '#d9a05b', dark = '#a8743a';
  return mergeGeometries([
    box(0.26, 0.3, 0.14, 0, -0.2, 0, kraft),
    box(0.27, 0.04, 0.15, 0, -0.06, 0, dark),
    colored(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI).translate(0, -0.05, 0), INK),
    box(0.1, 0.1, 0.005, 0, -0.2, 0.072, '#FF4079'),
  ].map((g) => g.toNonIndexed()));
}
/** café cup with a brand sleeve: origin = cup bottom */
export function cupGeometry() {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(0.05, 0.04, 0.13, 14).translate(0, 0.065, 0), '#ffffff'),
    colored(new THREE.CylinderGeometry(0.052, 0.047, 0.05, 14).translate(0, 0.07, 0), '#FE831B'),
    colored(new THREE.CylinderGeometry(0.053, 0.053, 0.015, 14).translate(0, 0.135, 0), INK),
  ].map((g) => g.toNonIndexed()));
}

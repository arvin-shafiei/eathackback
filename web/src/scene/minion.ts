// Shared minion kit for every non-shopper character (staff, café diners, checkout queues, shoplifter, street walkers).
// Built ONLY from the shopper parts in parts.ts (GEO / BODY / SHOPPER_SKIN), so everyone is the identical character:
//   MINION.head   – yellow body + goggle strap + chrome rims + eyes + irises + smile + shoes, one vertex-coloured mesh
//   MINION.overalls – GEO.overalls (white, tint per role via material colour or instanceColor)
//   MINION.arm    – GEO.arm (white sleeve + dark glove, tint skin via material colour or instanceColor)
// Origin = floor under the body centre, facing +z (same as Crowd).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BODY, GEO, SHOPPER_SKIN, inkHull } from './parts';

function paint(g: THREE.BufferGeometry, color: string) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
/** keep only position/normal/color so heterogeneous parts merge */
function clean(g: THREE.BufferGeometry) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') n.deleteAttribute(k);
  return n;
}

function headGeometry() {
  const parts: THREE.BufferGeometry[] = [paint(GEO.body(), SHOPPER_SKIN), paint(GEO.strap(), '#232127')];
  for (const k of [-1, 1]) {
    const ex = k * BODY.eyeX;
    parts.push(paint(GEO.rim().translate(ex, BODY.eyeY, BODY.eyeZ), '#d4d9e1'));
    parts.push(paint(GEO.eye().translate(ex, BODY.eyeY, BODY.eyeZ), '#ffffff'));
    parts.push(GEO.iris().translate(ex + ex * 0.1, BODY.eyeY, BODY.eyeZ + BODY.eyeR * 0.72 + 0.002)); // already vertex coloured
    parts.push(paint(GEO.foot().translate(k * 0.13, 0.01, 0.05), '#17151a'));
  }
  parts.push(paint(GEO.mouth().rotateX(-0.25).translate(0, BODY.mouthY, BODY.mouthZ), '#1d1b22'));
  return mergeGeometries(parts.map(clean))!;
}

let cache: { head: THREE.BufferGeometry; hull: THREE.BufferGeometry; overalls: THREE.BufferGeometry; arm: THREE.BufferGeometry } | null = null;
/** shared geometries (built once) */
export function minionGeo() {
  return (cache ??= { head: headGeometry(), hull: GEO.body(), overalls: GEO.overalls(), arm: GEO.arm() });
}

/** shared materials. `tint` ones are white × vertex colours, so instanceColor / a clone's .color picks the colour */
export const MINION_MAT = {
  head: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42 }),
  hull: inkHull(0.026),
  tint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
};
/** a per-colour (non-instanced) material for a single figure's overalls or arms */
const byColor = new Map<string, THREE.MeshStandardMaterial>();
export function minionTint(color: string) {
  let m = byColor.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, color }); byColor.set(color, m); }
  return m;
}
export const MINION_SKIN_ARM = new THREE.Color(SHOPPER_SKIN).multiplyScalar(0.94).getStyle();
export const MINION_SHOULDER = { x: BODY.shoulderX, y: BODY.shoulderY, z: 0.02 };

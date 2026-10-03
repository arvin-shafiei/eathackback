// Tiny static-geometry builder: every part gets a vertex colour, then the lot is merged into ONE BufferGeometry
// (one draw call per material). Used for the whole outdoor world: kerbs, markings, shelters, bins, sign posts...
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export function mat(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)).clone();
}

export class Geo {
  parts: THREE.BufferGeometry[] = [];
  add(src: THREE.BufferGeometry, color: string | THREE.Color, m?: THREE.Matrix4) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    if (m) g.applyMatrix4(m);
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    this.parts.push(g);
    return this;
  }
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: string, ry = 0) {
    return this.add(BOX, color, mat(x, y, z, ry, w, h, d));
  }
  /** flat rectangle on the ground (x0..x1, z0..z1) at height y */
  quad(x0: number, z0: number, x1: number, z1: number, y: number, color: string) {
    if (x1 - x0 < 1e-3 || z1 - z0 < 1e-3) return this;
    return this.add(PLANE, color, mat((x0 + x1) / 2, y, (z0 + z1) / 2, 0, x1 - x0, 1, z1 - z0));
  }
  cyl(x: number, y: number, z: number, r: number, h: number, color: string, seg = 8) {
    return this.add(cylGeo(seg), color, mat(x, y, z, 0, r, h, r));
  }
  build() {
    const g = this.parts.length ? mergeGeometries(this.parts)! : new THREE.BufferGeometry();
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}

export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const cyls = new Map<number, THREE.BufferGeometry>();
export function cylGeo(seg: number) {
  let g = cyls.get(seg);
  if (!g) { g = new THREE.CylinderGeometry(1, 1, 1, seg); cyls.set(seg, g); }
  return g;
}

/** deterministic rng */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

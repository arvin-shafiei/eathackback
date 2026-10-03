// Static-geometry batcher for the store shell: every box / plane / cylinder added here is baked into one merged
// mesh per material bucket (vertex colours), plus one LineSegments for all ink outlines. A superstore's ~10k
// static parts become a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { INK } from '../theme';

export type Bucket = 'solid' | 'matte' | 'glow' | 'glass' | 'metal';
const tmpC = new THREE.Color();

export class Kit {
  private parts: Record<Bucket, THREE.BufferGeometry[]> = { solid: [], matte: [], glow: [], glass: [], metal: [] };
  private edges: number[] = [];
  private static box = new THREE.BoxGeometry(1, 1, 1);
  private static cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  private static sph = new THREE.SphereGeometry(0.5, 10, 7);
  private static plane = new THREE.PlaneGeometry(1, 1);

  /** world matrix from position, yaw, and scale */
  static m(x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1, rotX = 0, rotZ = 0) {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  }

  private push(src: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.ColorRepresentation, bucket: Bucket) {
    const g = src.clone();
    g.applyMatrix4(m);
    const n = g.attributes.position.count;
    tmpC.set(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts[bucket].push(g);
  }

  /** box of size (w, h, d) centred at the matrix origin */
  box(w: number, h: number, d: number, m: THREE.Matrix4, color: THREE.ColorRepresentation, opts: { bucket?: Bucket; ink?: boolean } = {}) {
    const mm = m.clone().multiply(new THREE.Matrix4().makeScale(w, h, d));
    this.push(Kit.box, mm, color, opts.bucket ?? 'solid');
    if (opts.ink) this.inkBox(mm);
  }
  /** shorthand: axis-aligned box at (x, y, z) with yaw */
  boxAt(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, opts: { bucket?: Bucket; ink?: boolean; rotY?: number } = {}) {
    this.box(w, h, d, Kit.m(x, y, z, opts.rotY ?? 0), color, opts);
  }
  cyl(r: number, h: number, m: THREE.Matrix4, color: THREE.ColorRepresentation, bucket: Bucket = 'solid') {
    this.push(Kit.cyl, m.clone().multiply(new THREE.Matrix4().makeScale(r * 2, h, r * 2)), color, bucket);
  }
  sphere(r: number, m: THREE.Matrix4, color: THREE.ColorRepresentation, bucket: Bucket = 'solid') {
    this.push(Kit.sph, m.clone().multiply(new THREE.Matrix4().makeScale(r * 2, r * 2, r * 2)), color, bucket);
  }
  /** flat floor quad (y up) */
  floor(x0: number, z0: number, x1: number, z1: number, y: number, color: THREE.ColorRepresentation, bucket: Bucket = 'matte') {
    const m = Kit.m((x0 + x1) / 2, y, (z0 + z1) / 2, 0, x1 - x0, 1, z1 - z0, -Math.PI / 2);
    this.push(Kit.plane, m, color, bucket);
  }
  private inkBox(m: THREE.Matrix4) {
    const v = [-0.5, 0.5];
    const c: THREE.Vector3[] = [];
    for (const x of v) for (const y of v) for (const z of v) c.push(new THREE.Vector3(x, y, z).applyMatrix4(m));
    // corner index = xi*4 + yi*2 + zi
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, b] of E) this.edges.push(c[a].x, c[a].y, c[a].z, c[b].x, c[b].y, c[b].z);
  }
  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number) { this.edges.push(ax, ay, az, bx, by, bz); }

  build(opts: { shadows?: boolean } = {}): THREE.Group {
    const g = new THREE.Group();
    const mats: Record<Bucket, THREE.Material> = {
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
      matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      glass: new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false }),
      metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.55 }),
    };
    for (const k of Object.keys(this.parts) as Bucket[]) {
      const list = this.parts[k];
      if (!list.length) continue;
      // merge in chunks so no single buffer gets enormous
      for (let i = 0; i < list.length; i += 4000) {
        const merged = mergeGeometries(list.slice(i, i + 4000).map((x) => { x.deleteAttribute('uv'); return x; }), false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mats[k]);
        mesh.raycast = () => null;
        if (k === 'solid' || k === 'metal') { mesh.castShadow = !!opts.shadows; mesh.receiveShadow = true; }
        if (k === 'matte') mesh.receiveShadow = true;
        if (k === 'glass') mesh.renderOrder = 2;
        g.add(mesh);
      }
      list.forEach((x) => x.dispose());
    }
    if (this.edges.length) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(this.edges, 3));
      const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: INK }));
      ls.raycast = () => null;
      g.add(ls);
    }
    return g;
  }
}

/** dispose everything a built kit group owns */
export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  });
}

/** shade a hex colour toward white (k>0) or black (k<0) */
export function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  return k >= 0 ? c.lerp(new THREE.Color('#ffffff'), k) : c.lerp(new THREE.Color('#000000'), -k);
}

/** many short labels drawn into one canvas; each label gets a uv rect. One texture for hundreds of signs. */
export class LabelAtlas {
  readonly canvas: HTMLCanvasElement; readonly ctx: CanvasRenderingContext2D;
  private n = 0; readonly cols: number; readonly rows: number;
  constructor(readonly cw: number, readonly ch: number, capacity: number, maxW = 4096) {
    this.cols = Math.max(1, Math.floor(maxW / cw));
    this.rows = Math.max(1, Math.ceil(capacity / this.cols));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols * cw; this.canvas.height = this.rows * ch;
    this.ctx = this.canvas.getContext('2d')!;
  }
  /** draw into the next cell; returns [u0, v0, u1, v1] */
  add(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): [number, number, number, number] {
    const i = this.n++, cx = (i % this.cols) * this.cw, cy = Math.floor(i / this.cols) * this.ch;
    this.ctx.save(); this.ctx.translate(cx, cy); this.ctx.beginPath(); this.ctx.rect(0, 0, this.cw, this.ch); this.ctx.clip();
    draw(this.ctx, this.cw, this.ch); this.ctx.restore();
    const W = this.canvas.width, H = this.canvas.height;
    return [cx / W, 1 - (cy + this.ch) / H, (cx + this.cw) / W, 1 - cy / H];
  }
  texture() { const t = new THREE.CanvasTexture(this.canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
}

/** textured quads (each with its own uv rect) merged into one geometry */
export class QuadBatch {
  private pos: number[] = []; private uv: number[] = []; private nrm: number[] = []; private idx: number[] = [];
  /** plane of size (w, h) in the matrix's local XY plane, facing local +z */
  add(m: THREE.Matrix4, w: number, h: number, r: [number, number, number, number]) {
    const base = this.pos.length / 3;
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const pts: [number, number, number, number][] = [[-w / 2, -h / 2, r[0], r[1]], [w / 2, -h / 2, r[2], r[1]], [w / 2, h / 2, r[2], r[3]], [-w / 2, h / 2, r[0], r[3]]];
    for (const [x, y, u, v] of pts) { const p = new THREE.Vector3(x, y, 0).applyMatrix4(m); this.pos.push(p.x, p.y, p.z); this.uv.push(u, v); this.nrm.push(n.x, n.y, n.z); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  get empty() { return this.idx.length === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx); g.computeBoundingSphere();
    return g;
  }
}

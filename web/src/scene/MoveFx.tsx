// Shelf rearrangement fx: packs that change slot fly (ShelfFill animates the real instances), and as each lands a
// soft soap bubble grows over its new spot and pops into a few sparkles. Everything here is presentation only:
// nothing feeds a stat. Pooled InstancedMeshes, ticked from ShelfFill's single useFrame (no extra frame loop).
import * as THREE from 'three';
import { sfx } from './fx';

/** span = length of what must fit on screen (m); when set, the camera backs off far enough to frame it */
export interface FlyTarget { x: number; y: number; z: number; fx: number; fz: number; dist?: number; span?: number }
export interface MoveArrow { from: THREE.Vector3Like; to: THREE.Vector3Like; fx: number; fz: number; main: boolean }

/** the panel <-> scene channel (module level, like fx.bus): replay the last move, fly the camera to a unit */
export const moveFx = {
  /** bumped by replay(); ShelfFill re-plays the last transition */
  replayNonce: 0,
  /** bumped by flyTo(); ShelfFill flies the camera to look at `fly` (world point + the aisle-facing direction) */
  flyNonce: 0, fly: null as FlyTarget | null,
  /** 3d arrows old spot -> new spot (world). `main` = the selected move: big arrow + ring at the old spot + ghost at the new */
  arrows: [] as MoveArrow[], arrowsV: 0,
  /** set by ShelfFill after each transition: products in the air and the unit with the most of them */
  last: { moved: 0, busiest: null as string | null, at: 0 },
  listeners: new Set<() => void>(),
  replay() { this.replayNonce++; },
  flyTo(p: FlyTarget) { this.fly = p; this.flyNonce++; },
  setArrows(a: MoveArrow[]) { this.arrows = a; this.arrowsV++; },
  emit() { this.listeners.forEach((f) => f()); },
  on(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; },
};

const BUBBLES = 256, SPARKS_PER = 7, SPARKS = BUBBLES * SPARKS_PER;
const GROW = 0.42, POPT = 0.16, SPARK_T = 0.55;

const bubbleMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 } },
  vertexShader: /* glsl */`
    attribute float aLife; varying float vLife; varying vec3 vN; varying vec3 vV; varying vec3 vW;
    void main() {
      vLife = aLife;
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vW = position;
      vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; varying float vLife; varying vec3 vN; varying vec3 vV; varying vec3 vW;
    void main() {
      float f = 1.0 - abs(dot(normalize(vN), vV));
      float rim = pow(f, 2.2);
      // thin-film swirl: hue drifts with angle + height
      float h = f * 2.5 + vW.y * 2.0 + uTime * 0.6;
      vec3 film = 0.6 + 0.4 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + h));
      vec3 c = mix(vec3(0.82, 0.95, 1.0), film, 0.55);
      float a = (0.06 + rim * 0.75) * vLife;
      // a little highlight blob
      float spec = pow(max(0.0, dot(normalize(vN), normalize(vec3(-0.4, 0.7, 0.6)))), 40.0);
      gl_FragColor = vec4(c + spec, clamp(a + spec * vLife, 0.0, 1.0));
    }`,
});

const AX = new THREE.Vector3(0.3, 1, 0.2).normalize();

// ------------------------------------------------------------------ arrows (old spot -> new spot)
const arrowMat = () => new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false,
  uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color('#ff2e88') }, uB: { value: new THREE.Color('#ff9a1f') } },
  vertexShader: /* glsl */`
    varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main() {
      vec3 c = mix(uA, uB, clamp(vUv.x, 0.0, 1.0));
      float band = smoothstep(0.0, 0.08, fract(vUv.x * 5.0 - uTime * 1.2)) * (1.0 - smoothstep(0.12, 0.26, fract(vUv.x * 5.0 - uTime * 1.2)));
      float lit = 0.75 + 0.35 * abs(dot(normalize(vN), vV));
      gl_FragColor = vec4(c * lit + band * 0.45, 0.94);
    }`,
});
const coneMat = (c: string) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.96, depthTest: false, depthWrite: false, toneMapped: false });

interface Bubble { t0: number; x: number; y: number; z: number; r: number }
interface Spark { t0: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }

export class MoveFxLayer {
  bubbles: THREE.InstancedMesh; sparks: THREE.InstancedMesh;
  /** selected-move arrows, rings and ghosts; rebuilt when moveFx.arrows changes */
  arrows = new THREE.Group();
  private arrowsV = -1; private arrowMat = arrowMat(); private pulse: { o: THREE.Object3D; base: number; kind: 'cone' | 'ring' | 'ghost' }[] = [];
  private life: THREE.InstancedBufferAttribute;
  private bs: (Bubble | null)[] = new Array(BUBBLES).fill(null);
  private ss: (Spark | null)[] = new Array(SPARKS).fill(null);
  private bi = 0; private si = 0; private live = 0; private lastPop = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  constructor() {
    const g = new THREE.SphereGeometry(1, 20, 14);
    this.life = new THREE.InstancedBufferAttribute(new Float32Array(BUBBLES), 1);
    g.setAttribute('aLife', this.life);
    this.bubbles = new THREE.InstancedMesh(g, bubbleMat(), BUBBLES);
    const sg = new THREE.OctahedronGeometry(1, 0);
    this.sparks = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), SPARKS);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const pal = ['#fff6a8', '#ffd1e8', '#bfefff', '#ffffff', '#ffe08a'].map((c) => new THREE.Color(c));
    for (let i = 0; i < BUBBLES; i++) this.bubbles.setMatrixAt(i, zero);
    for (let i = 0; i < SPARKS; i++) { this.sparks.setMatrixAt(i, zero); this.sparks.setColorAt(i, pal[i % pal.length]); }
    for (const o of [this.bubbles, this.sparks]) { o.frustumCulled = false; o.raycast = () => null; o.renderOrder = 5; o.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
  }
  get busy() { return this.live > 0; }
  /** a bubble over a pack that just landed (world centre, radius in metres) */
  pop(x: number, y: number, z: number, r: number, now: number) {
    this.bs[this.bi] = { t0: now, x, y, z, r };
    this.bi = (this.bi + 1) % BUBBLES; this.live++;
    if (now - this.lastPop > 0.07) { this.lastPop = now; sfx.blip(900 + Math.random() * 500, 1700, 0.08, 'sine', 0.04); }
  }
  /** true while something on screen moves (arrows pulse, bubbles, sparks): ShelfFill keeps frames coming */
  get animating() { return this.live > 0 || this.pulse.length > 0; }
  private buildArrows() {
    this.arrowsV = moveFx.arrowsV;
    for (const c of [...this.arrows.children]) { this.arrows.remove(c); c.traverse((o) => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { o.geometry.dispose(); if (o.material !== this.arrowMat) (o.material as THREE.Material).dispose(); } }); }
    this.pulse = [];
    for (const a of moveFx.arrows) {
      const A = new THREE.Vector3(a.from.x, a.from.y, a.from.z), B = new THREE.Vector3(a.to.x, a.to.y, a.to.z);
      const front = new THREE.Vector3(a.fx, 0, a.fz).normalize();
      const d = A.distanceTo(B);
      const out = 0.28; // start/end in front of the shelf lip so the arrow reads from the aisle
      const A1 = A.clone().addScaledVector(front, out), B1 = B.clone().addScaledVector(front, out);
      const mid = A1.clone().add(B1).multiplyScalar(0.5).addScaledVector(front, 0.35 + d * 0.12); mid.y += 0.35 + Math.min(2.2, d * 0.28);
      const curve = new THREE.QuadraticBezierCurve3(A1, mid, B1);
      const r = a.main ? 0.045 : 0.022, head = a.main ? 0.2 : 0.11;
      // stop the tube short of the head
      const tEnd = Math.max(0.5, 1 - head / Math.max(0.3, curve.getLength()));
      const pts = curve.getPoints(40).filter((_, i) => i / 40 <= tEnd);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r, 10, false), this.arrowMat);
      const tip = curve.getPoint(1), tan = curve.getTangent(1).normalize();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r * 3.2, head, 18), coneMat('#ff8a1f'));
      cone.position.copy(tip).addScaledVector(tan, -head / 2); cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      for (const o of [tube, cone]) { o.renderOrder = 8; o.raycast = () => null; o.frustumCulled = false; }
      this.arrows.add(tube, cone);
      this.pulse.push({ o: cone, base: 1, kind: 'cone' });
      if (a.main) {
        // glow ring around where it is now (faces the aisle), dashed ghost box where it goes
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 10, 40), coneMat('#ff2e88'));
        ring.position.copy(A).addScaledVector(front, 0.24); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), front);
        const ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.3, 0.3, 0.3)), new THREE.LineBasicMaterial({ color: '#ff9a1f', transparent: true, depthTest: false, toneMapped: false }));
        ghost.position.copy(B).addScaledVector(front, 0.1); ghost.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), front);
        const ghostFill = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
        ghostFill.position.copy(ghost.position); ghostFill.quaternion.copy(ghost.quaternion);
        for (const o of [ring, ghost, ghostFill]) { o.renderOrder = 9; o.raycast = () => null; o.frustumCulled = false; }
        this.arrows.add(ring, ghost, ghostFill);
        this.pulse.push({ o: ring, base: 1, kind: 'ring' }, { o: ghost, base: 1, kind: 'ghost' }, { o: ghostFill, base: 1, kind: 'ghost' });
      }
    }
  }
  tick(now: number) {
    this.bubbles.material instanceof THREE.ShaderMaterial && (this.bubbles.material.uniforms.uTime.value = now);
    if (this.arrowsV !== moveFx.arrowsV) this.buildArrows();
    this.arrowMat.uniforms.uTime.value = now;
    for (const { o, kind } of this.pulse) {
      const k = kind === 'ring' ? 1 + Math.sin(now * 5) * 0.14 : kind === 'ghost' ? 1 + Math.sin(now * 4 + 1) * 0.08 : 1 + Math.sin(now * 6) * 0.12;
      o.scale.setScalar(k);
    }
    if (!this.live) return;
    let live = 0;
    const { m, q, p, s } = this;
    for (let i = 0; i < BUBBLES; i++) {
      const b = this.bs[i]; if (!b) continue;
      const k = now - b.t0;
      let r = 0, a = 0;
      if (k < GROW) { const e = k / GROW; r = b.r * (1 - Math.pow(1 - e, 3)) * (1 + Math.sin(e * Math.PI) * 0.08); a = Math.min(1, e * 2); }
      else if (k < GROW + POPT) {
        const e = (k - GROW) / POPT; r = b.r * (1 + e * 0.35); a = 1 - e;
        if (!(b as Bubble & { popped?: boolean }).popped) { (b as Bubble & { popped?: boolean }).popped = true; this.spray(b, now); }
      } else { this.bs[i] = null; this.bubbles.setMatrixAt(i, m.makeScale(0, 0, 0)); this.life.setX(i, 0); continue; }
      live++;
      const wob = 1 + Math.sin(k * 22 + i) * 0.03;
      this.bubbles.setMatrixAt(i, m.compose(p.set(b.x, b.y, b.z), q.identity(), s.set(r * wob, r / wob, r * wob)));
      this.life.setX(i, a);
    }
    for (let i = 0; i < SPARKS; i++) {
      const sp = this.ss[i]; if (!sp) continue;
      const k = now - sp.t0;
      if (k >= SPARK_T) { this.ss[i] = null; this.sparks.setMatrixAt(i, m.makeScale(0, 0, 0)); continue; }
      live++;
      const e = k / SPARK_T, sz = 0.035 * (1 - e) * (1 + Math.sin(k * 40) * 0.3);
      p.set(sp.x + sp.vx * k, sp.y + sp.vy * k - 1.6 * k * k, sp.z + sp.vz * k);
      q.setFromAxisAngle(AX, k * 9 + i);
      this.sparks.setMatrixAt(i, m.compose(p, q, s.set(sz, sz, sz)));
    }
    this.live = live;
    this.bubbles.instanceMatrix.needsUpdate = true; this.life.needsUpdate = true; this.sparks.instanceMatrix.needsUpdate = true;
  }
  private spray(b: Bubble, now: number) {
    for (let j = 0; j < SPARKS_PER; j++) {
      const a = (j / SPARKS_PER) * Math.PI * 2 + Math.random() * 0.5, up = 0.4 + Math.random() * 0.9, sp = 0.9 + Math.random() * 0.8;
      this.ss[this.si] = { t0: now, x: b.x, y: b.y, z: b.z, vx: Math.cos(a) * sp, vy: up * sp, vz: Math.sin(a) * sp };
      this.si = (this.si + 1) % SPARKS;
    }
    this.live += SPARKS_PER;
  }
  dispose() {
    moveFx.arrowsV++; this.arrowsV = -1; const keep = moveFx.arrows; moveFx.arrows = []; this.buildArrows(); moveFx.arrows = keep; this.arrowMat.dispose();
    this.bubbles.geometry.dispose(); (this.bubbles.material as THREE.Material).dispose();
    this.sparks.geometry.dispose(); (this.sparks.material as THREE.Material).dispose();
  }
}

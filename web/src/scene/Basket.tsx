// Carriers (trolley / basket) as physics: a dynamic body welded to its shopper, built as a compound collider
// (floor + four walls, trolleys also a chassis to bump into). Packs thrown in are real dynamic bodies; once one
// settles it is welded into the carrier as one more collider of the compound, so later packs land ON it and the
// pile grows physically. AI agents have no carrier (they read a feed).
import * as THREE from 'three';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { useRapier } from '@react-three/rapier';
import type { Carrier } from '../theme';
import { BASKET, TROLLEY } from './parts';

export type Rapier = ReturnType<typeof useRapier>['rapier'];

/** collision groups: (membership << 16) | filter. Packs never hit shopper capsules (so a throw can't bounce off
 *  the thrower), shoppers never hit packs; everything else collides. */
export const GROUP = {
  shopper: (0x0001 << 16) | (0xffff & ~0x0004),
  carrier: (0x0002 << 16) | 0xffff,
  pack: (0x0004 << 16) | (0xffff & ~0x0001),
};

export function carrierDims(c: Carrier) {
  return c === 'trolley'
    ? { hx: TROLLEY.hx - 0.03, hz: TROLLEY.hz - 0.03, floor: TROLLEY.floorY + 0.02, cols: 3, rows: 3 }
    : { hx: BASKET.hx - 0.03, hz: BASKET.hz - 0.03, floor: 0.03, cols: 2, rows: 2 };
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
/** tidy stack position for the nth pick (used after a scrub, or if a throw bounced out) */
export function stackLocal(c: Carrier, n: number, h: number, out: THREE.Matrix4) {
  const d = carrierDims(c);
  const per = d.cols * d.rows, layer = Math.floor(n / per), k = n % per;
  const x = ((k % d.cols) / Math.max(1, d.cols - 1) - 0.5) * d.hx * 1.3;
  const z = ((Math.floor(k / d.cols) % d.rows) / Math.max(1, d.rows - 1) - 0.5) * d.hz * 1.3;
  _q.setFromEuler(_e.set(0, (n * 1.7) % 0.6 - 0.3, 0));
  return out.compose(_v.set(x, d.floor + h / 2 + layer * (h + 0.01), z), _q, _s.set(1, 1, 1));
}

/** is a carrier-local position inside the carrier's box (with a little slack)? */
export function insideCarrier(c: Carrier, lp: THREE.Vector3) {
  const d = carrierDims(c);
  return Math.abs(lp.x) < d.hx + 0.05 && Math.abs(lp.z) < d.hz + 0.05 && lp.y > d.floor - 0.05 && lp.y < d.floor + 1.2;
}

/** build the carrier body, welded to the shopper with a fixed joint. `own` registers each collider (for bonks). */
export function createCarrier(world: World, R: Rapier, owner: RigidBody, carrier: Carrier, parkY: number, own: (c: Collider) => void): RigidBody | null {
  if (carrier === 'none') return null;
  const tr = carrier === 'trolley';
  const cb = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, parkY, 1).setGravityScale(0).setLinearDamping(0.6).setAngularDamping(3).setCanSleep(false));
  cb.setEnabledTranslations(true, false, true, false);
  cb.setEnabledRotations(false, true, false, false);
  const add = (hx: number, hy: number, hz: number, x: number, y: number, z: number) => {
    own(world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setDensity(tr ? 30 : 15).setFriction(0.7).setRestitution(0.25).setCollisionGroups(0), cb));
  };
  if (tr) {
    const { hx, hz, floorY, wallH } = TROLLEY;
    add(0.26, 0.13, hz - 0.02, 0, 0.21, 0); // chassis: what other shoppers bump into
    add(hx, 0.02, hz, 0, floorY, 0); // basket floor (packs land here)
    add(0.015, wallH / 2, hz, hx, floorY + wallH / 2, 0); add(0.015, wallH / 2, hz, -hx, floorY + wallH / 2, 0);
    add(hx, wallH / 2, 0.015, 0, floorY + wallH / 2, hz); add(hx, wallH / 2, 0.015, 0, floorY + wallH / 2, -hz);
  } else {
    const { hx, hz, wallH } = BASKET;
    add(hx, 0.012, hz, 0, 0.012, 0);
    add(0.012, wallH / 2, hz, hx, wallH / 2, 0); add(0.012, wallH / 2, hz, -hx, wallH / 2, 0);
    add(hx, wallH / 2, 0.012, 0, wallH / 2, hz); add(hx, wallH / 2, 0.012, 0, wallH / 2, -hz);
  }
  const anchor = tr ? TROLLEY.anchor : BASKET.anchor;
  const j = world.createImpulseJoint(R.JointData.fixed({ x: anchor[0], y: anchor[1], z: anchor[2] }, { w: 1, x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { w: 1, x: 0, y: 0, z: 0 }), owner, cb, true);
  j.setContactsEnabled(false);
  return cb;
}

/** collisions on/off for every collider of a body (instead of rapier's setEnabled, which panics the 0.14 solver when
 *  toggled on jointed bodies near kinematic ones). Off = collision groups 0: touches nothing. */
export function setSolid(rb: RigidBody | null, group: number | null) {
  if (!rb) return;
  const n = rb.numColliders();
  for (let i = 0; i < n; i++) rb.collider(i).setCollisionGroups(group ?? 0);
}

/** settled packs welded into carriers, keyed by beat id */
export class CarrierLoad {
  private items = new Map<number, { body: RigidBody; col: Collider }>();
  constructor(private world: World, private R: Rapier) {}
  has(id: number) { return this.items.has(id); }
  /** weld a pack into `cbody` at carrier-local pose `local` (box size w,h,d) */
  add(cbody: RigidBody | null, id: number, local: THREE.Matrix4, size: { w: number; h: number; d: number }) {
    if (!cbody || this.items.has(id)) return;
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    local.decompose(p, q, s);
    try {
      const col = this.world.createCollider(
        this.R.ColliderDesc.cuboid(size.w / 2, size.h / 2, size.d / 2).setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setDensity(2).setFriction(0.9).setRestitution(0.1).setCollisionGroups(GROUP.carrier),
        cbody,
      );
      this.items.set(id, { body: cbody, col });
    } catch { /* body already removed */ }
  }
  remove(id: number) {
    const it = this.items.get(id); if (!it) return;
    this.items.delete(id);
    try { this.world.removeCollider(it.col, true); } catch { /* gone with its body */ }
  }
  clear() { for (const id of [...this.items.keys()]) this.remove(id); }
}

/** spawn a pack as a dynamic body flying from `src` to land at `dst` after T seconds (ballistic, CCD on) */
export function throwPack(world: World, R: Rapier, src: THREE.Vector3, dst: THREE.Vector3, T: number, size: { w: number; h: number; d: number }, spin: number) {
  const vel = dst.clone().sub(src).divideScalar(T); vel.y += 0.5 * 9.81 * T;
  const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(src.x, src.y, src.z).setLinvel(vel.x, vel.y, vel.z)
    .setAngvel({ x: 6 * spin, y: 3, z: 2 * spin }).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.6));
  world.createCollider(R.ColliderDesc.cuboid(size.w / 2, size.h / 2, size.d / 2).setDensity(60).setRestitution(0.3).setFriction(0.85).setCollisionGroups(GROUP.pack), body);
  return body;
}

// Far sky traffic: two airliners crossing at altitude behind the store with fading contrails, and a small
// helicopter circling over the town. Planes + contrails ignore fog (they are far beyond it) but hide in thick fog.
// 4 draw calls (planes instanced, contrails instanced with a tiny shader, heli body + rotor), one useFrame.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldPlan } from './World';
import { Geo, cylGeo, mat } from './geo';
import { WX } from './wxState';

const noRay = () => null;

function planeGeo() {
  // ~36 m airliner along +x
  const g = new Geo();
  g.add(cylGeo(10), '#f7f5f2', mat(0, 0, 0, 0, 2.0, 34, 2.0, 0, Math.PI / 2));
  g.add(new THREE.ConeGeometry(2, 4, 10), '#f7f5f2', mat(19, 0, 0, 0, 1, 1, 1, 0, -Math.PI / 2));
  g.box(1, -0.4, 0, 7, 0.4, 34, '#e9e6e2');
  g.box(-15, 0.2, 0, 3.5, 0.3, 12, '#e9e6e2');
  g.box(-15.5, 3.5, 0, 4, 6, 0.4, '#FF4079');
  for (const s of [-1, 1]) g.add(cylGeo(8), '#c9c6c2', mat(2, -1.6, s * 6.5, 0, 0.9, 4, 0.9, 0, Math.PI / 2));
  return g.build();
}
function heliGeo() {
  const g = new Geo();
  g.add(new THREE.SphereGeometry(1, 10, 8), '#2d6cdf', mat(0, 0, 0, 0, 2.2, 1.3, 1.2));
  g.add(new THREE.SphereGeometry(1, 10, 8), '#bfe3f5', mat(1.2, 0.2, 0, 0, 1.1, 0.9, 1.0));
  g.box(-3.2, 0.3, 0, 4.2, 0.35, 0.35, '#2d6cdf');
  g.box(-5.2, 0.9, 0, 0.6, 1.4, 0.15, '#FE831B');
  for (const s of [-1, 1]) g.box(0, -1.45, s * 0.8, 3.2, 0.12, 0.12, '#2a2328');
  g.cyl(0, 1.3, 0, 0.12, 0.6, '#2a2328', 6);
  return g.build();
}

const contrailMat = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      float along = vUv.x; // 0 at the plane, 1 at the tail
      float a = pow(1.0 - along, 1.6) * smoothstep(0.0, 0.02, along);
      a *= 1.0 - smoothstep(0.25, 0.5, abs(vUv.y - 0.5));
      gl_FragColor = vec4(1.0, 0.98, 0.98, a * 0.75);
    }`,
});

export function Air({ W }: { W: WorldPlan }) {
  const geos = useMemo(() => {
    const ribbon = new THREE.PlaneGeometry(1, 1);
    ribbon.translate(-0.5, 0, 0); // x: 0 (plane) → -1 (tail)
    const uv = ribbon.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i)); // uv.x 0 at the plane, 1 at the tail
    return { plane: planeGeo(), heli: heliGeo(), ribbon, rotor: new THREE.BoxGeometry(9, 0.08, 0.35) };
  }, []);
  const lambert = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }), []);
  const heliMat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true }), []);
  const rotorMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#2a2328', transparent: true, opacity: 0.55 }), []);
  const cMat = useMemo(contrailMat, []);
  const routes = useMemo(() => [
    { z: W.B.zMin - 260, y: 150, v: 55, x0: W.cx - 900, x1: W.cx + 900, off: 0, dir: 1, tilt: 0.06 },
    { z: W.B.zMin - 380, y: 190, v: 60, x0: W.cx - 1000, x1: W.cx + 1000, off: 0.45, dir: -1, tilt: -0.05 },
  ], [W]);
  const pRef = useRef<THREE.InstancedMesh>(null), cRef = useRef<THREE.InstancedMesh>(null);
  const hRef = useRef<THREE.Group>(null), rRef = useRef<THREE.Mesh>(null);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.1);
    const T = t.current;
    const pm = pRef.current, cm = cRef.current;
    const hide = WX.cur.fog > 0.6;
    if (pm && cm) {
      pm.visible = cm.visible = !hide;
      routes.forEach((r, i) => {
        const span = r.x1 - r.x0, period = span / r.v + 20;
        const tt = (T + r.off * period) % period, d = Math.min(span, tt * r.v);
        const x = r.dir > 0 ? r.x0 + d : r.x1 - d;
        const z = r.z + Math.sin(i * 3 + 1) * 40 + d * r.tilt;
        const yaw = r.dir > 0 ? 0 : Math.PI;
        const fly = tt * r.v < span;
        pm.setMatrixAt(i, fly ? mat(x, r.y, z, yaw - Math.atan(r.tilt) * r.dir) : mat(0, -999, 0, 0, 0, 0, 0));
        const L = Math.min(d, 520);
        cm.setMatrixAt(i, fly && L > 1 ? mat(x - r.dir * 16, r.y - 0.5, z, yaw - Math.atan(r.tilt) * r.dir, L, 4.5, 1) : mat(0, -999, 0, 0, 0, 0, 0));
      });
      pm.instanceMatrix.needsUpdate = true; cm.instanceMatrix.needsUpdate = true;
    }
    const h = hRef.current;
    if (h) {
      const a = T * 0.12, R = 90;
      const cx = W.cx + 40, cz = W.B.cz - 30;
      h.position.set(cx + Math.cos(a) * R, 48 + Math.sin(T * 0.4) * 3, cz + Math.sin(a) * R * 0.7);
      h.rotation.set(0, Math.atan2(-Math.cos(a) * 0.7, -Math.sin(a)), 0.12);
    }
    if (rRef.current) rRef.current.rotation.y = T * 22;
  });
  return (
    <group>
      <instancedMesh ref={pRef} args={[geos.plane, lambert, routes.length]} raycast={noRay} frustumCulled={false} />
      <instancedMesh ref={cRef} args={[geos.ribbon, cMat, routes.length]} raycast={noRay} frustumCulled={false} />
      <group ref={hRef}>
        <mesh geometry={geos.heli} material={heliMat} raycast={noRay} />
        <mesh ref={rRef} geometry={geos.rotor} material={rotorMat} position={[0, 1.65, 0]} raycast={noRay} />
      </group>
    </group>
  );
}

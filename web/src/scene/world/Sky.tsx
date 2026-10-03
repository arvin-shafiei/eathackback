// Late-afternoon pastel sky dome: peach horizon (= fog colour) → brand pink → soft lavender zenith, with a warm sun
// glow low behind the store. One shader sphere, no fog, drawn first and never writes depth.
import { useMemo } from 'react';
import * as THREE from 'three';

export const HORIZON = '#ffe3d6';

export function Sky({ cx, cz, r = 700 }: { cx: number; cz: number; r?: number }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      cHor: { value: new THREE.Color(HORIZON) },
      cLow: { value: new THREE.Color('#ffc6ad') },
      cMid: { value: new THREE.Color('#ffa9c2') },
      cTop: { value: new THREE.Color('#cdb0f2') },
      cSun: { value: new THREE.Color('#fff2c8') },
      sunDir: { value: new THREE.Vector3(0.35, 0.16, -1).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 cHor, cLow, cMid, cTop, cSun, sunDir;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(cHor, cLow, smoothstep(0.0, 0.08, h));
        c = mix(c, cMid, smoothstep(0.06, 0.32, h));
        c = mix(c, cTop, smoothstep(0.30, 0.95, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += cSun * (pow(s, 6.0) * 0.35 + pow(s, 80.0) * 0.6);
        // soft banded clouds near the horizon
        float band = sin(vDir.x * 9.0 + vDir.z * 4.0) * sin(vDir.z * 7.0 - vDir.x * 3.0);
        c = mix(c, vec3(1.0, 0.96, 0.95), smoothstep(0.55, 0.95, band) * smoothstep(0.04, 0.12, h) * (1.0 - smoothstep(0.18, 0.3, h)) * 0.45);
        gl_FragColor = vec4(min(c, 1.0), 1.0);
      }`,
  }), []);
  return (
    <mesh position={[cx, 0, cz]} renderOrder={-10} frustumCulled={false} raycast={() => null} material={mat}>
      <sphereGeometry args={[r, 32, 16]} />
    </mesh>
  );
}

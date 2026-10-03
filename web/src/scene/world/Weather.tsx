// Weather: sun | overcast | rain | snow | fog | auto (see wxState.ts). Cheap by design:
//  - ONE Points cloud (GPU-animated: fall + wrap in the vertex shader) that follows the camera: rain streaks or snow
//  - sky / fog colour + fog distance + light intensities lerped in one useFrame (lights found once by traversal)
//  - wet look: a translucent sheen over road + car park and instanced puddles that grow with "wet" (dries slowly)
//  - snow: white emissive dusting on the registered world materials (roofs, ground, trees, cars...)
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldPlan } from './World';
import { WX, MODES, AUTO_CYCLE, type Blend } from './wxState';
import { skyU } from './Sky';
import { mat, rng } from './geo';

const noRay = () => null;
const N = 9000;
const BOX = new THREE.Vector3(110, 50, 110);

const C_FOG_SUN = new THREE.Color('#ffe3d6'), C_FOG_OVER = new THREE.Color('#ddd6dc'), C_FOG_RAIN = new THREE.Color('#aeb3c0');
const C_FOG_SNOW = new THREE.Color('#eceef4'), C_FOG_FOG = new THREE.Color('#e8e2e4');
const C_OV_TOP = new THREE.Color('#b9b4c8'), C_OV_RAIN = new THREE.Color('#8d91a3'), C_OV_SNOW = new THREE.Color('#d8dae6');
const C_HOR = new THREE.Color('#dcd6dc'), C_HOR_RAIN = new THREE.Color('#b4b8c4');

function particleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: BOX.clone() },
      uRain: { value: 0 }, uSnow: { value: 0 }, uScale: { value: 800 },
    },
    vertexShader: /* glsl */`
      attribute float aRnd;
      uniform float uTime, uRain, uSnow, uScale;
      uniform vec3 uCenter, uBox;
      varying float vA;
      void main() {
        vec3 p = position * uBox;
        float speed = mix(1.4 + aRnd * 0.8, 24.0 + aRnd * 8.0, step(uSnow, uRain));
        p.y -= uTime * speed;
        // snow drifts and swirls, rain leans a little in the wind
        p.x += uSnow * (sin(uTime * 0.6 + aRnd * 40.0) * 1.6 + uTime * 0.5) + uRain * uTime * 3.0;
        p.z += uSnow * cos(uTime * 0.5 + aRnd * 23.0) * 1.2;
        vec3 lo = uCenter - uBox * 0.5;
        p = mod(p - lo, uBox) + lo;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float sz = mix(0.13 + aRnd * 0.08, 1.1, step(uSnow, uRain));
        gl_PointSize = clamp(sz * uScale / -mv.z, 1.5, 48.0);
        // fade near the box edges so the wrap never pops
        vec3 d = abs(p - uCenter) / (uBox * 0.5);
        vA = (1.0 - smoothstep(0.75, 1.0, max(d.x, max(d.y, d.z)))) * max(uRain, uSnow);
      }`,
    fragmentShader: /* glsl */`
      uniform float uRain, uSnow;
      varying float vA;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float a;
        vec3 c;
        if (uRain > uSnow) { a = (1.0 - smoothstep(0.015, 0.05, abs(q.x))) * (1.0 - smoothstep(0.3, 0.5, abs(q.y))) * 0.55; c = vec3(0.86, 0.9, 1.0); }
        else { a = 1.0 - smoothstep(0.25, 0.5, length(q)); c = vec3(1.0); }
        if (a * vA < 0.01) discard;
        gl_FragColor = vec4(c, a * vA);
      }`,
  });
}

export function Weather({ W }: { W: WorldPlan }) {
  const { scene, camera, invalidate, size } = useThree();
  const pts = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(N * 3), a = new Float32Array(N);
    const r = rng(5);
    for (let i = 0; i < N; i++) { p[i * 3] = r(); p[i * 3 + 1] = r(); p[i * 3 + 2] = r(); a[i] = r(); }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aRnd', new THREE.BufferAttribute(a, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const pMat = useMemo(particleMaterial, []);
  const sheenMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#c9d8ef', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), []);
  const puddleMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#8f9db3', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), []);
  const sheen = useMemo(() => {
    const { xL, xR, zF, zC, zRoad, roadW } = W;
    const quads = [[xL, zF + 0.2, xR, zC], [xL - 300, zRoad - roadW / 2, xR + 300, zRoad + roadW / 2]];
    const gs = quads.map(([x0, z0, x1, z1]) => new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0.05, (z0 + z1) / 2));
    const g = new THREE.BufferGeometry();
    const merged = gs.reduce((acc, x) => { acc.push(x); return acc; }, [] as THREE.BufferGeometry[]);
    // tiny: just two quads
    const pos: number[] = [], idx: number[] = [];
    merged.forEach((m) => { const o = pos.length / 3; pos.push(...(m.attributes.position.array as Float32Array)); (m.index!.array as Uint16Array).forEach((v) => idx.push(v + o)); });
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
  }, [W]);
  const puddles = useMemo(() => {
    const r = rng(17), out: THREE.Matrix4[] = [];
    const { xL, xR, zA, zC, zRoad, roadW } = W;
    for (let i = 0; i < 46; i++) {
      const road = i < 12;
      const x = road ? W.cx + (r() - 0.5) * 220 : xL + 2 + r() * (xR - xL - 4);
      const z = road ? zRoad + (r() - 0.5) * (roadW - 2) : zA + 1 + r() * (zC - zA - 2);
      const s = 0.6 + r() * 1.2;
      out.push(mat(x, 0.055, z, r() * 3, s * (1.2 + r()), 1, s));
    }
    return out;
  }, [W]);
  const puddleRef = useRef<THREE.InstancedMesh>(null);
  const circle = useMemo(() => new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), []);
  useEffect(() => {
    const im = puddleRef.current; if (!im) return;
    puddles.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true;
  }, [puddles]);
  useEffect(() => { WX.invalidate = invalidate; return () => { WX.invalidate = null; }; }, [invalidate]);

  const st = useRef({
    t: 0, autoT: 0, autoI: 0, lights: null as null | { l: THREE.Light; base: number; kind: string }[],
    fogNear: 0, fogFar: 0,
  });
  const fwd = useMemo(() => new THREE.Vector3(), []);
  const pRef = useRef<THREE.Points>(null);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1), s = st.current;
    s.t += dt;
    if (!s.lights) {
      s.lights = [];
      scene.traverse((o) => { const l = o as THREE.Light; if (l.isLight) s.lights!.push({ l, base: l.intensity, kind: l.type }); });
      const f = scene.fog as THREE.Fog | null;
      if (f) { s.fogNear = f.near; s.fogFar = f.far; }
    }
    if (WX.auto) {
      s.autoT += dt;
      if (s.autoT > 24) { s.autoT = 0; s.autoI = (s.autoI + 1) % AUTO_CYCLE.length; }
      WX.target = AUTO_CYCLE[s.autoI];
    }
    const tgt = MODES[WX.target], cur = WX.cur;
    let moving = false;
    for (const k of Object.keys(cur) as (keyof Blend)[]) {
      const rate = k === 'wet' && tgt.wet < cur.wet ? 0.12 : 0.6;
      const d = tgt[k] - cur[k];
      if (Math.abs(d) > 1e-3) { cur[k] += d * Math.min(1, dt * rate); moving = true; } else cur[k] = tgt[k];
    }
    // sky
    skyU.uOver.value = cur.over;
    skyU.cOvTop.value.copy(C_OV_TOP).lerp(C_OV_RAIN, cur.rain).lerp(C_OV_SNOW, cur.snow);
    skyU.cOvHor.value.copy(C_HOR).lerp(C_HOR_RAIN, cur.rain).lerp(C_FOG_SNOW, cur.snow);
    // fog
    const f = scene.fog as THREE.Fog | null;
    if (f && s.fogFar) {
      f.color.copy(C_FOG_SUN).lerp(C_FOG_OVER, cur.over).lerp(C_FOG_RAIN, cur.rain).lerp(C_FOG_SNOW, cur.snow).lerp(C_FOG_FOG, cur.fog * (1 - cur.rain));
      f.near = s.fogNear * (1 - 0.9 * cur.fog);
      f.far = s.fogFar * (1 - 0.62 * cur.fog);
    }
    // lights: dimmer + flatter under cloud, a touch brighter on snow
    for (const L of s.lights) {
      const k = L.kind === 'DirectionalLight' ? 1 - 0.7 * cur.over : L.kind === 'AmbientLight' ? 1 + 0.25 * cur.over + 0.3 * cur.snow : 1 - 0.18 * cur.over - 0.12 * cur.rain + 0.1 * cur.snow;
      L.l.intensity = L.base * k;
    }
    // snow dusting
    const e = cur.snow * 0.3;
    WX.snowMats.forEach((m) => m.emissive.setRGB(e, e, e * 1.04));
    // wet sheen + puddles
    sheenMat.opacity = cur.wet * 0.16;
    puddleMat.opacity = cur.wet * 0.38;
    const im = puddleRef.current; if (im) im.visible = cur.wet > 0.02;
    // particles: centred ~40 m ahead of the camera
    const P = pRef.current;
    if (P) {
      P.visible = cur.rain > 0.02 || cur.snow > 0.02;
      camera.getWorldDirection(fwd);
      pMat.uniforms.uCenter.value.copy(camera.position).addScaledVector(fwd, 42);
      pMat.uniforms.uTime.value = s.t;
      pMat.uniforms.uRain.value = cur.rain; pMat.uniforms.uSnow.value = cur.snow;
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 42;
      pMat.uniforms.uScale.value = size.height / (2 * Math.tan((fov * Math.PI) / 360));
    }
    if (moving) invalidate();
  });

  return (
    <group>
      <points ref={pRef} geometry={pts} material={pMat} frustumCulled={false} raycast={noRay} renderOrder={5} />
      <mesh geometry={sheen} material={sheenMat} raycast={noRay} renderOrder={1} />
      <instancedMesh ref={puddleRef} args={[circle, puddleMat, puddles.length]} raycast={noRay} frustumCulled={false} renderOrder={2} />
    </group>
  );
}

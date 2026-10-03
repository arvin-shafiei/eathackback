// Cheap world-space sticker: one THREE.Sprite + one canvas texture, redrawn only when its text changes.
// Replaces drei <Html> (a DOM node per label) for the café bubble, occupancy sticker and "oops!" tags.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { INK } from '../../theme';

const W = 512, H = 112;

export interface StickerStyle { bg: string; fg?: string; tilt?: number }

function draw(ctx: CanvasRenderingContext2D, text: string, st: StickerStyle) {
  ctx.clearRect(0, 0, W, H);
  if (!text) return 0;
  ctx.font = '800 50px "Baloo 2", system-ui, sans-serif';
  const tw = Math.min(W - 40, ctx.measureText(text).width + 44);
  const x0 = (W - tw) / 2, y0 = 10, h = H - 26, r = h / 2;
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.roundRect(x0, y0 + 7, tw, h, r); ctx.fill(); // drop shadow
  ctx.fillStyle = st.bg; ctx.strokeStyle = INK; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect(x0, y0, tw, h, r); ctx.fill(); ctx.stroke();
  ctx.fillStyle = st.fg ?? INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, y0 + h / 2 + 2, tw - 30);
  return tw;
}

/** `text()` is polled every frame; return '' to hide. `height` is the sticker height in metres. */
export function TextSprite({ position, text, style, height = 0.42 }: {
  position: [number, number, number]; text: () => string; style: () => StickerStyle; height?: number;
}) {
  const { canvas, ctx, tex, mat } = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
    return { canvas, ctx, tex, mat };
  }, []);
  useEffect(() => () => { tex.dispose(); mat.dispose(); }, [tex, mat]);
  const spr = useRef<THREE.Sprite>(null);
  const last = useRef<string | null>(null);
  useFrame(() => {
    const s = spr.current; if (!s) return;
    const t = text(), st = style();
    const key = t + '|' + st.bg;
    if (key !== last.current) {
      last.current = key;
      draw(ctx, t, st);
      tex.needsUpdate = true;
    }
    s.visible = !!t;
    s.scale.set(height * (W / H), height, 1);
    mat.rotation = st.tilt ?? 0;
  });
  void canvas;
  return <sprite ref={spr} position={position} material={mat} renderOrder={20} raycast={() => null} />;
}

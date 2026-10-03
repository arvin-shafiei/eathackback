import type { ReactNode } from 'react';
import type { Ocean } from '../types';
import { INK } from '../theme';

export function Src({ s }: { s?: string }) {
  if (!s) return <span className="src src-missing">no source given</span>;
  const urls = s.match(/https?:\/\/[^\s)]+/g);
  if (urls && urls.length) {
    const label = s.replace(urls[0], '').trim();
    return (
      <span className="src">
        {label && <span>{label} </span>}
        <a href={urls[0]} target="_blank" rel="noreferrer">{shortUrl(urls[0])}</a>
      </span>
    );
  }
  return <span className={`src ${s.startsWith('assumption') ? 'src-assume' : ''}`}>{s}</span>;
}
export function shortUrl(u: string) {
  try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).slice(0, 48); } catch { return u.slice(0, 48); }
}

export function Bar({ value, max = 1, color, label, right, ci }: { value: number; max?: number; color?: string; label: ReactNode; right?: ReactNode; ci?: [number, number] }) {
  const w = max ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="bar">
      <div className="bar-label">{label}</div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${w * 100}%`, background: color }} />
        {ci && <div className="bar-ci" style={{ left: `${(ci[0] / max) * 100}%`, width: `${((ci[1] - ci[0]) / max) * 100}%` }} />}
      </div>
      <div className="bar-right">{right}</div>
    </div>
  );
}

const TRAITS: (keyof Ocean)[] = ['O', 'C', 'E', 'A', 'N'];
const TRAIT_NAME: Record<string, string> = { O: 'openness', C: 'conscientious', E: 'extraversion', A: 'agreeable', N: 'neuroticism' };
export function Radar({ ocean, color, size = 170, ghost }: { ocean: Ocean; color: string; size?: number; ghost?: Ocean }) {
  const c = size / 2, r = size / 2 - 26;
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v]; };
  const poly = (o: Ocean) => TRAITS.map((t, i) => pt(i, o[t] ?? 0).join(',')).join(' ');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`ocean: ${TRAITS.map((t) => `${TRAIT_NAME[t as string]} ${Math.round((ocean[t] ?? 0) * 100)}`).join(', ')}`}>
      {[0.25, 0.5, 0.75, 1].map((k) => <polygon key={k} points={TRAITS.map((_, i) => pt(i, k).join(',')).join(' ')} fill="none" stroke="#ead9e0" strokeWidth={1.5} />)}
      {TRAITS.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="#ead9e0" strokeWidth={1.5} />; })}
      {ghost && <polygon points={poly(ghost)} fill="none" stroke={INK} strokeDasharray="4 3" strokeWidth={1.5} opacity={0.5} />}
      <polygon points={poly(ocean)} fill={color} fillOpacity={0.35} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
      {TRAITS.map((t, i) => { const [x, y] = pt(i, ocean[t] ?? 0); return <circle key={t} cx={x} cy={y} r={4} fill={color} stroke={INK} strokeWidth={2} />; })}
      {TRAITS.map((t, i) => {
        const [x, y] = pt(i, 1.22);
        return <text key={t} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="radar-lbl">{t} {Math.round((ocean[t] ?? 0) * 100)}</text>;
      })}
    </svg>
  );
}

export function Sticker({ children, tone = 'white', title }: { children: ReactNode; tone?: 'white' | 'brand' | 'ink' | 'yellow' | 'good' | 'bad'; title?: string }) {
  return <span className={`chip chip-${tone}`} title={title}>{children}</span>;
}

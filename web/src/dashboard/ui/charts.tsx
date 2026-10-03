import { S, type Source } from '../lib/src';
import { num } from '../lib/stats';

export const TRAITS = ['O', 'C', 'E', 'A', 'N'] as const;
export const TRAIT_NAME: Record<string, string> = { O: 'openness', C: 'conscientiousness', E: 'extraversion', A: 'agreeableness', N: 'neuroticism' };

/** OCEAN radar, 0..1 per axis. Values are listed beside it with their sources (svg text can't host the source tip). */
export function Radar({ ocean, size = 132, compare }: { ocean: Record<string, number>; size?: number; compare?: Record<string, number> | null }) {
  const c = size / 2, r = size / 2 - 18;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v];
  };
  const poly = (o: Record<string, number>) => TRAITS.map((t, i) => pt(i, o[t] ?? 0.5).join(',')).join(' ');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="d-radar" role="img" aria-label={`OCEAN ${TRAITS.map((t) => `${t} ${num(ocean[t])}`).join(', ')}`}>
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={TRAITS.map((_, i) => pt(i, k).join(',')).join(' ')} className={k === 0.5 ? 'd-radar-mid' : 'd-radar-ring'} />
      ))}
      {TRAITS.map((t, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.2);
        return (
          <g key={t}>
            <line x1={c} y1={c} x2={x} y2={y} className="d-radar-ring" />
            <text x={lx} y={ly} className="d-radar-label" textAnchor="middle" dominantBaseline="central">{t}</text>
          </g>
        );
      })}
      {compare ? <polygon points={poly(compare)} className="d-radar-compare" /> : null}
      <polygon points={poly(ocean)} className="d-radar-shape" />
      {TRAITS.map((t, i) => {
        const [x, y] = pt(i, ocean[t] ?? 0.5);
        return <circle key={t} cx={x} cy={y} r={3} className="d-radar-dot" />;
      })}
    </svg>
  );
}

// evidence classes, in fixed order (validated with the dataviz palette validator: CVD + normal-vision pass)
export const EVIDENCE: { key: string; label: string; color: string; hatch?: boolean }[] = [
  { key: 'reddit', label: 'reddit', color: '#eb6834' },
  { key: 'reddit_inferred', label: 'reddit (inferred)', color: '#eb6834', hatch: true },
  { key: 'paper', label: 'paper', color: '#2a78d6' },
  { key: 'off_field', label: 'OFF', color: '#1baf7a' },
  { key: 'staged_persona', label: 'staged', color: '#4a3aa7' },
  { key: 'web_other', label: 'web', color: '#eda100' },
  { key: 'internal_research', label: 'internal', color: '#008300' },
  { key: 'sales_data', label: 'sales', color: '#e87ba4' },
  { key: 'assumption', label: 'assumption', color: '#141014', hatch: true },
];

/** honesty meter: stacked bar of evidence classes (% of fields). Assumption share is always printed. */
export function EvidenceMix({ mix, src, compact = false }: { mix: Record<string, number>; src: Source; compact?: boolean }) {
  const total = EVIDENCE.reduce((s, e) => s + (mix[e.key] || 0), 0) || 100;
  const asm = mix.assumption ?? 0;
  return (
    <div className={`d-mix ${compact ? 'is-compact' : ''}`}>
      <div className="d-mix-bar" role="img" aria-label={EVIDENCE.map((e) => `${e.label} ${(mix[e.key] || 0).toFixed(1)}%`).join(', ')}>
        {EVIDENCE.filter((e) => (mix[e.key] || 0) > 0).map((e) => {
          const v = mix[e.key] || 0;
          return (
            <div key={e.key} className="d-mix-cell" style={{ flex: `${v / total} 0 0` }}>
              <S as="div" className="d-mix-seg" src={{ ...src, field: `${src.field}.${e.key}`, kind: e.key === 'assumption' ? 'assumption' : src.kind, note: `${e.label}: ${v.toFixed(1)}% of this persona's fields. ${src.note || ''}` }}>
                <div className={`d-mix-fill ${e.hatch ? 'is-hatch' : ''}`} style={{ ['--c' as string]: e.color }} />
              </S>
            </div>
          );
        })}
      </div>
      <div className="d-mix-legend">
        <S src={{ ...src, field: `${src.field}.assumption`, kind: 'assumption', note: 'share of fields whose evidence is an assumption or has no citation (split equally across the source classes each field cites)' }}>
          <span className="d-mix-asm"><i className="d-swatch is-hatch" style={{ ['--c' as string]: '#141014' }} /> assumption <b>{asm.toFixed(0)}%</b></span>
        </S>
        {!compact
          ? EVIDENCE.filter((e) => e.key !== 'assumption' && (mix[e.key] || 0) >= 0.5).map((e) => (
              <span key={e.key} className="d-mix-key"><i className={`d-swatch ${e.hatch ? 'is-hatch' : ''}`} style={{ ['--c' as string]: e.color }} />{e.label} {(mix[e.key] || 0).toFixed(0)}%</span>
            ))
          : null}
      </div>
    </div>
  );
}

export function MixLegend() {
  return (
    <div className="d-mix-legend is-key">
      {EVIDENCE.map((e) => (
        <span key={e.key} className="d-mix-key"><i className={`d-swatch ${e.hatch ? 'is-hatch' : ''}`} style={{ ['--c' as string]: e.color }} />{e.label}</span>
      ))}
    </div>
  );
}

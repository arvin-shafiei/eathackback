import { useMemo, useState } from 'react';
import type { Product, Run } from '../types';
import { pickRates, pct } from '../stats';
import { AI_COLOR, catColor, prodLabel } from '../theme';
import { isAI } from '../types';

interface Props { run: Run; products: Record<string, Product>; onProduct: (code: string) => void; onClose: () => void }

export function ComparePanel({ run, products, onProduct, onClose }: Props) {
  const [sort, setSort] = useState<'gap' | 'human' | 'ai'>('gap');
  const rows = useMemo(() => {
    const h = pickRates(run, 'human'), a = pickRates(run, 'ai');
    const codes = new Set([...Object.keys(h), ...Object.keys(a)]);
    return [...codes].map((code) => {
      const hr = h[code], ar = a[code];
      return { code, h: hr?.rate ?? 0, a: ar?.rate ?? 0, hn: hr?.shown ?? 0, an: ar?.shown ?? 0, hci: hr?.ci ?? [0, 0], aci: ar?.ci ?? [0, 0], gap: (ar?.rate ?? 0) - (hr?.rate ?? 0) };
    }).filter((r) => r.hn > 0 && r.an > 0);
  }, [run]);
  const sorted = [...rows].sort((x, y) => (sort === 'gap' ? Math.abs(y.gap) - Math.abs(x.gap) : sort === 'human' ? y.h - x.h : y.a - x.a));
  const nH = run.agents.filter((a) => !isAI(a)).length, nA = run.agents.length - nH;
  // CIs don't overlap → flag as a real divergence (conservative)
  const sep = (r: (typeof rows)[number]) => r.aci[0] > r.hci[1] || r.hci[0] > r.aci[1];

  return (
    <section className="card compare" aria-label="human vs ai compare">
      <button className="x" onClick={onClose} aria-label="close compare">×</button>
      <h2 className="display">simsbury · same shelf, two shoppers</h2>
      <p className="muted">{nH} human shopper{nH === 1 ? "" : "s"} walk the store. {nA} ai agent{nA === 1 ? "" : "s"} read the same catalogue as a feed. pick rate = picked ÷ times shown. a ★ means the 95% cis don't overlap.</p>
      {!nA && <p className="notice">this run has no ai-agent arm yet (no ai-agent archetypes, e.g. p_ai_assistant_general).</p>}
      <div className="seg">
        {(['gap', 'human', 'ai'] as const).map((s) => <button key={s} className={`seg-btn ${sort === s ? 'on' : ''}`} onClick={() => setSort(s)}>sort by {s === 'gap' ? 'divergence' : s}</button>)}
      </div>
      <div className="cmp-head"><span>product</span><span>humans</span><span>ai agents</span><span>gap</span></div>
      <div className="cmp-list">
        {sorted.map((r) => {
          const p = products[r.code];
          return (
            <button key={r.code} className="cmp-row" onClick={() => onProduct(r.code)}>
              <span className="cmp-name"><span className="sw" style={{ background: p?.color || catColor(p?.category ?? '') }} />{prodLabel(p, r.code)}</span>
              <span className="cmp-bar"><i style={{ width: `${r.h * 100}%`, background: '#2bb673' }} /><em>{pct(r.h)}</em></span>
              <span className="cmp-bar"><i style={{ width: `${r.a * 100}%`, background: AI_COLOR }} /><em>{pct(r.a)}</em></span>
              <span className={`cmp-gap ${r.gap > 0 ? 'ai' : 'hu'}`}>{r.gap >= 0 ? '+' : ''}{Math.round(r.gap * 100)}{sep(r) ? ' ★' : ''}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// Top 10 / bottom 10 products in the run, by how often a shopper who was shown the product took it.
// Numbers: insights.ts funnels(run, 'human') — picked / shown per product, counted from the run's events in the browser.
import { useEffect, useMemo, useState } from 'react';
import { getData } from '../data';
import type { Product, Run } from '../types';
import { funnels } from '../insights';
import { catColor, prodLabel } from '../theme';

/** products shown to fewer shoppers than this are left out of the ranking (assumption: below this a single buy swings the rate) */
const MIN_SHOWN = 10;
const N = 10;

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

export function RankSection({ run, products, current, onPickProduct }: { run: Run; products: Record<string, Product>; current: string; onPickProduct: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  // a run can hold products from another store format: look their names up in every format's catalogue
  const [more, setMore] = useState<Record<string, Product>>({});
  useEffect(() => {
    let live = true;
    const files = ['catalog.json', ...['xl', 'express', 'metro', 'superstore'].map((v) => `${v}/catalog_extra.json`)];
    Promise.all(files.map((f) => getData<Product[] | { products: Product[] }>(f))).then((xs) => {
      if (!live) return;
      const out: Record<string, Product> = {};
      for (const x of xs) for (const p of (Array.isArray(x) ? x : x?.products ?? [])) out[p.code] ??= p;
      setMore(out);
    });
    return () => { live = false; };
  }, []);
  const rows = useMemo(() => {
    const f = funnels(run, 'human');
    return Object.entries(f).filter(([, x]) => x.shown >= MIN_SHOWN).map(([code, x]) => ({ code, ...x })).sort((a, b) => b.pick_rate - a.pick_rate || b.shown - a.shown);
  }, [run]);
  if (rows.length < 2) return null;
  const best = rows.slice(0, N);
  // bottom: lowest rate first; among ties, the one most shoppers ignored first
  const worst = [...rows].sort((a, b) => a.pick_rate - b.pick_rate || b.shown - a.shown).slice(0, N);
  const list = (xs: typeof rows, tone: 'up' | 'down') => (
    <ol className={`rk-list rk-${tone}`}>
      {xs.map((r) => {
        const p = products[r.code] ?? more[r.code];
        return (
          <li key={r.code} className={r.code === current ? 'on' : ''}>
            <button className="rk-row" onClick={() => onPickProduct(r.code)} title={`${r.picked} taken of ${r.shown} shown · ${r.noticed} noticed`}>
              <i className="dot" style={{ background: catColor(p?.category ?? '') }} aria-hidden />
              <span className="rk-name">{prodLabel(p, r.code)}</span>
              <span className="rk-n muted">{r.picked}/{r.shown}</span><b className="rk-rate">{pct(r.pick_rate)}</b>
            </button>
          </li>
        );
      })}
    </ol>
  );
  return (
    <section className="rk rk-top">
      <button className="rk-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h3>best and worst sellers</h3>
        <span className="muted small">share of shoppers who took it when it was in front of them · {rows.length} products with {MIN_SHOWN}+ shoppers {open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="rk-cols">
          <div><p className="rk-h rk-h-up">top {Math.min(N, best.length)}</p>{list(best, 'up')}</div>
          <div><p className="rk-h rk-h-down">bottom {Math.min(N, worst.length)}</p>{list(worst, 'down')}</div>
        </div>
      )}
    </section>
  );
}

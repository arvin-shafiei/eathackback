import { useEffect, useMemo, useState } from 'react';
import type { Planogram, Product, RearrangePlan, Run, StoreConfig } from '../types';
import { api } from '../api';
import { pct } from '../stats';
import { prodLabel } from '../theme';
import { applySteps, shelfSuggestions, MAX_SWAPS } from '../rearrange';

interface Props {
  sourceRun: Run; product: Product; slot?: string; planogram: Planogram; cfg: StoreConfig;
  products: Record<string, Product>; extraProducts: Product[]; onRearrange?: () => void;
}

/** Same short-loop selection as the rearrange screen, without a model call. */
export function ShelfOpportunity({ sourceRun, product, slot, planogram, cfg, products, extraProducts, onRearrange }: Props) {
  const unit = slot?.split('-r')[0];
  const [result, setResult] = useState<RearrangePlan | null>(null);
  const [simple, setSimple] = useState<RearrangePlan | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const scope = useMemo(() => JSON.stringify({ planogram, extraProducts }), [planogram, extraProducts]);
  useEffect(() => {
    let active = true;
    setResult(null); setSimple(null); setError(false);
    if (!unit) return;
    const ask = (max_swaps: number) => api.rearrangeSuggest({ planogram, products: extraProducts, run_ids: [sourceRun.run_id], objective: 'picks', max_swaps, units: [unit] });
    Promise.all([ask(1), ask(MAX_SWAPS)])
      .then(([one, two]) => { if (active) { setSimple(one); setResult(two); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [sourceRun.run_id, unit, scope, retry]);
  const suggestion = shelfSuggestions(simple, result).find((x) => x.u.unit === unit);
  const shelf = suggestion?.u ?? simple?.units.find((u) => u.unit === unit);
  const proposed = suggestion ? applySteps(planogram, suggestion.steps) : planogram;
  const move = shelf?.moves.find((m) => m.code === product.code);
  const max = Math.max(shelf?.before ?? 0, shelf?.after ?? 0, 1);
  return (
    <section className="tile t-5 ins-shelf-opportunity" aria-label="shelf rearrangement preview">
      <h3>could a better shelf help?</h3>
      {!unit ? <p className="muted">put this product on a shelf to compare layouts.</p> : error ? (
        <><p className="muted">shelf suggestions are unavailable. the product graphs still show the recorded run.</p><button className="link-btn" onClick={() => setRetry((n) => n + 1)}>retry shelf suggestion</button></>
      ) : !result ? <p className="muted" role="status">comparing shelf arrangements…</p> : !shelf ? <p className="muted">not enough shopper data for this shelf yet.</p> : (
        <>
          <p className="ins-shelf-lift"><b>{shelf.moves.length ? `+${(shelf.lift_pct * 100).toFixed(1)}%` : 'no change'}</b><span>{shelf.moves.length ? 'predicted takes across this shelf unit' : 'no better arrangement found in this search'}</span></p>
          <div className="ins-shelf-chart" role="img" aria-label={`predicted takes per 100 shelf visits: current ${shelf.before.toFixed(1)}, proposed ${shelf.after.toFixed(1)}`}>
            {[{ label: 'now', value: shelf.before }, { label: 'proposed', value: shelf.after }].map((r, i) => (
              <div key={r.label}><span>{r.label}</span><div><i style={{ width: `${r.value / max * 100}%`, background: i ? 'var(--hot)' : 'var(--ink)' }} /></div><b>{r.value.toFixed(1)}</b></div>
            ))}
          </div>
          <p className="ins-funnel-caption">takes per 100 shoppers passing this unit, across its {cfg.rows_per_unit} shelves</p>
          <div className="ins-shelf-pair">
            <ShelfSketch label="now" unit={unit} plan={planogram} cfg={cfg} products={products} focus={product.code} />
            <ShelfSketch label="proposed" unit={unit} plan={proposed} cfg={cfg} products={products} focus={product.code} />
          </div>
          <p className="ins-shelf-note">{move ? <><b>this product:</b> {move.from.row_name} shelf, spot {move.from.pos + 1} → {move.to.row_name} shelf, spot {move.to.pos + 1}. predicted notice rate {pct(move.notice_before)} → {pct(move.notice_after)}.</> : <><b>this product stays put.</b> {shelf.moves.length ? 'its neighbours move to improve the whole shelf.' : 'keep its current position.'}</>}</p>
          {onRearrange && <button className="btn btn-brand" onClick={onRearrange}>see shelf moves in 3d →</button>}
          <details className="ins-how"><summary>why this arrangement?</summary><p>the same search used by rearrange: notice chance × takes after noticing, allowing for competition between products on each shelf. products stay in this unit. a suggestion is one swap or a loop of up to three products; bigger changes fall back to one swap. thin samples lean on the unit average. predictions need a fresh shopper test before applying.</p><p>learned from <code>{sourceRun.run_id}</code> · {result.learned_from.shoppers} simulated shoppers. source: <code>sim/rearrange.py</code> and <code>sim/notice.py</code>.</p>{result.learned_from.other_store && <p>the source run used another store layout. only shared products carry shopper data.</p>}</details>
        </>
      )}
    </section>
  );
}

function ShelfSketch({ label, unit, plan, cfg, products, focus }: { label: string; unit: string; plan: Planogram; cfg: StoreConfig; products: Record<string, Product>; focus: string }) {
  return <figure className="ins-shelf-sketch"><figcaption>{label} · pink = this product</figcaption>
    {Array.from({ length: cfg.rows_per_unit }, (_, i) => i + 1).map((row) => <div className="ins-sketch-row" key={row}>
      <span>{cfg.row_names[String(row)] ?? `row ${row}`}</span>
      <div>{(plan[`${unit}-r${row}`]?.products ?? []).map((code) => <span className={`ins-sketch-pack ${code === focus ? 'is-focus' : ''}`} key={code} title={prodLabel(products[code], code)}>
        {products[code]?.image ? <img src={products[code].image} alt={prodLabel(products[code], code)} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <span>{(products[code]?.brand ?? '?').slice(0, 2)}</span>}
      </span>)}</div>
    </div>)}
  </figure>;
}

// Store-owner view for small independent supermarkets: where it gets busy, which shelf, and a link to rearrange.
// Every number names its source: the sim run's events, the notice model (run.notice_model, from sim/coefficients.json)
// or a labelled assumption (owner.ts constants). Maths lives in src/owner.ts.
import { useMemo, useState } from 'react';
import type { Planogram, Product, Run, StoreConfig } from '../types';
import type { Timeline } from '../layout';
import { CELL_M, QUIET_SHARE, SAMPLE_S, ownerReport } from '../owner';
import { catLabel, prodLabel } from '../theme';
import { Src } from './bits';
import './owner.css';

export interface OwnerPanelProps {
  cfg: StoreConfig;
  planogram: Planogram | null;
  products: Record<string, Product>;
  timelines: Record<string, Timeline>;
  run: Run | null;
  onToggleHeat: (on: boolean) => void;
  onOpenRearrange: () => void;
  /** optional: heatmap time window, null = whole run, N = last N minutes of replay (pass to <TrafficHeat lastMinutes>) */
  onHeatWindow?: (lastMinutes: number | null) => void;
  /** optional: hide quiet cells (0..1 of the colour scale) → <TrafficHeat minLevel> */
  onHeatMin?: (minLevel: number) => void;
  onClose?: () => void;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`);
const ROWS = ['top', 'eye', 'bottom'] as const;

export function OwnerPanel({ cfg, planogram, products, timelines, run, onToggleHeat, onOpenRearrange, onHeatWindow, onHeatMin, onClose }: OwnerPanelProps) {
  const [heatMin, setHeatMin] = useState(0);
  // on by default: opening 'your store' shows where people walk straight away
  const [heat, setHeat] = useState(true);
  const [winMin, setWinMin] = useState<number | null>(null);
  const r = useMemo(() => ownerReport(cfg, planogram, products, timelines, run), [cfg, planogram, products, timelines, run]);
  const name = (code: string) => prodLabel(products[code], code);
  const queued = r.queues.filter((q) => q.waitMax > 0);
  const worstQ = r.queues[0];

  return (
    <div className="card owner">
      <div className="ow-top">
        <h2>your store</h2>
        {onClose && <button className="ow-x" onClick={onClose} aria-label="close">×</button>}
        <p className="muted ow-sub">
          from {r.shoppers} simulated shoppers in run <code>{run?.run_id ?? 'none'}</code>. what they looked at and bought are the sim's events;
          how long they stood where is the replay's pacing (an assumption, see App.tsx).
        </p>
      </div>

      {/* (a) where it gets busy */}
      <section className="ow-sec">
        <h3>where it gets busy</h3>
        <div className="ow-row">
          <label className="ow-toggle"><input type="checkbox" checked={heat} onChange={(e) => { setHeat(e.target.checked); onToggleHeat(e.target.checked); }} /> show floor heatmap</label>
          {onHeatMin && (
            <label className="ow-toggle" title="hide quiet floor cells so only the busy (yellow → red) areas show. colours: blue = quiet, red = busiest">
              hide quiet areas
              <input type="range" min={0} max={0.8} step={0.05} value={heatMin} onChange={(e) => { const v = Number(e.target.value); setHeatMin(v); onHeatMin(v); }} />
              <span className="muted">{heatMin === 0 ? 'show all' : heatMin < 0.35 ? 'hide quietest' : heatMin < 0.6 ? 'busy only' : 'hotspots only'}</span>
            </label>
          )}
          {onHeatWindow && (
            <select className="ow-sel" value={winMin ?? ''} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setWinMin(v); onHeatWindow(v); }}>
              <option value="">whole run</option><option value="2">last 2 min</option><option value="5">last 5 min</option><option value="10">last 10 min</option>
            </select>
          )}
        </div>
        <ol className="ow-list">
          {r.hot.map((h) => (
            <li key={h.cell}><b>{h.name}</b>: {h.density.toFixed(1)} people·s per m² per min <span className="muted">(≈ {h.peoplePerM2.toFixed(2)} people on each m² on average)</span></li>
          ))}
        </ol>
        <p className="ow-how">
          how: each shopper's replay path is sampled every {SAMPLE_S} s; time spent on each {CELL_M} × {CELL_M} m floor square is summed,
          then divided by the square's area and the run length ({r.grid.minutes.toFixed(1)} min). grid size and sampling are assumptions.
        </p>

        <h4>quiet aisles</h4>
        {r.zones.dead.length ? (
          <p><b>nobody walked</b> aisle{r.zones.dead.length > 1 ? 's' : ''} {r.zones.dead.map((a) => a.aisleNo).join(', ')}.</p>
        ) : <p>every aisle had at least one shopper.</p>}
        {r.zones.quiet.length > 0 && <p>under {pct(QUIET_SHARE)} of shoppers (assumption: our cut-off for “quiet”): aisle {r.zones.quiet.map((a) => `${a.aisleNo} (${pct(a.share)})`).join(', ')}.</p>}
        <p className="ow-how">
          least walked: {[...r.aisles].sort((a, b) => a.shoppers - b.shoppers).slice(0, 3).map((a) => `aisle ${a.aisleNo} ${a.shoppers}/${r.shoppers}`).join(' · ')}.
          counted as distinct shoppers whose replay path entered the aisle.
        </p>

        <h4>checkout queues</h4>
        {worstQ ? (
          queued.length ? (
            <p>longest wait: till <b>{worstQ.group}</b>, 9 in 10 waited under <b>{secs(worstQ.waitP90)}</b> (longest {secs(worstQ.waitMax)}); line was {worstQ.lenP90} deep or less 90% of the time (max {worstQ.lenMax}).</p>
          ) : <p>nobody had to queue: {r.queues.reduce((s, q) => s + q.served, 0)} shoppers over {r.queues.length} tills, every wait 0 s.</p>
        ) : <p className="muted">no checkout data in this replay.</p>}
        <p className="ow-how">from the replay's checkout schedule (layout.ts scheduleCheckouts): wait = time served − time joined. arrival rate is an assumption (70% of till capacity, App.tsx).</p>

        {r.spread && (
          <div className="ow-tip">
            <span className="ow-tag">heuristic</span>
            <p><b>spread:</b> move {catLabel(r.spread.cat)} from aisle {r.spread.fromAisle} to quiet aisle {r.spread.toAisle}.</p>
            <p className="ow-how">{r.spread.why}; {catLabel(r.spread.cat)} drew the most shelf looks there ({r.spread.fromLooks}). rule: pair the busiest aisle's main category with the quietest aisle of the same fixture type. not simulated: try it in rearrange and re-run.</p>
          </div>
        )}
      </section>

      {/* (b) which shelf */}
      <section className="ow-sec">
        <h3>which shelf</h3>
        <p>chance a shopper notices one product (1 facing, centre of the shelf, shopping for that aisle):</p>
        <div className="ow-rows">
          {r.notice.rows.map((x) => (
            <div key={x.row} className={`ow-rowc ${x.row === 'eye' ? 'best' : ''}`}>
              <div className="ow-big">{pct(x.p)}</div>
              <div><b>{x.row}</b> shelf</div>
              <div className="muted ow-small">logit {x.logit >= 0 ? '+' : ''}{x.logit.toFixed(2)}</div>
            </div>
          ))}
        </div>
        <p className="ow-how">
          notice model: p = sigmoid({r.notice.alpha0.toFixed(2)} + row term). source: {r.notice.from}.
        </p>
        <ul className="ow-src">
          {r.notice.rows.filter((x) => x.row !== 'eye').map((x) => <li key={x.row}>{x.row}: <Src s={x.source} /></li>)}
          <li>eye baseline {pct(r.notice.pRef)}: <Src s={r.notice.refSource} /></li>
          <li>more facings help a little (+{r.notice.alphaF.toFixed(2)} logit per ln facing): <Src s={r.notice.alphaFSource} /></li>
        </ul>

        <h4>by category, in this run</h4>
        <table className="ow-tab">
          <thead><tr><th>category</th>{ROWS.map((x) => <th key={x}>{x}</th>)}<th>put best sellers</th></tr></thead>
          <tbody>
            {r.shelves.slice(0, 8).map((c) => {
              const best = ROWS.filter((x) => c.rows[x].shown >= 20).sort((a, b) => c.rows[b].rate - c.rows[a].rate)[0];
              return (
                <tr key={c.cat}>
                  <td>{catLabel(c.cat)}</td>
                  {ROWS.map((x) => <td key={x} title={`${c.rows[x].noticed} noticed of ${c.rows[x].shown} shown`}>{c.rows[x].shown ? pct(c.rows[x].rate) : '–'}<span className="muted ow-small"> /{c.rows[x].shown}</span></td>)}
                  <td>{best ? <b>{best}</b> : <span className="muted">too few</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="ow-how">noticed ÷ shown per shelf row, from the run's events (event.notice_factors.row, event.noticed). rows with under 20 looks are not ranked (assumption). the observed rate also carries facings, position and shopper mix, so it can differ from the model row above.</p>

        <h4>bought together</h4>
        {r.pairs.length ? (
          <ul className="ow-list">
            {r.pairs.map((p) => (
              <li key={`${p.a}|${p.b}`}>
                {p.apart ? 'put ' : ''}<b>{name(p.a)}</b> {p.apart ? 'next to' : '+'} <b>{name(p.b)}</b>: {p.count} shopper{p.count > 1 ? 's' : ''} bought both
                {!p.apart && <span className="muted"> (already in the same aisle)</span>}
              </li>
            ))}
          </ul>
        ) : <p className="muted">no shopper bought two things in this run.</p>}
        <p className="ow-how">count = shoppers in this run who picked both products. pairs that sit in different aisles are listed first. a tip, not a tested change.</p>
      </section>

      {/* (c) rearrange */}
      <section className="ow-sec ow-cta">
        <button className="btn" onClick={onOpenRearrange}>rearrange shelves</button>
        <p className="ow-how">opens the rearrange planner (sim/rearrange.py): it learns from this run and tests swaps on shoppers it hasn't seen.</p>
      </section>
    </div>
  );
}

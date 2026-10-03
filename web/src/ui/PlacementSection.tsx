import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  OptimiseResponse, OptimiseResult, Placement, PlacementCandidate, PlacementExperiment, PlacementResult, PlacementScan,
  Planogram, Product, StoreConfig,
} from '../types';
import { api } from '../api';
import type { PlacementSectionProps } from './featureProps';
import { Src, Sticker } from './bits';
import './placement.css';

// assumption: sample sizes picked for a hackathon demo, not from a power calculation
const SCAN_AGENTS = 400;
const TEST_AGENTS = 150;
const TEST_SEEDS = [1];
const MAX_TESTS = 3;
const FACINGS = [1, 2, 3];

interface Job<T> { busy: boolean; data: T | null; err: string | null }
const idle = { busy: false, data: null, err: null };

const keyOf = (p: Placement) => `${p.slot}|${p.pos}|${p.facings}`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} pts`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const facingsText = (n: number) => `${n} facing${n === 1 ? '' : 's'}`;
const rowName = (cfg: StoreConfig, slot: string) => {
  const r = slot.match(/-r(\d+)$/)?.[1] ?? '';
  return cfg.row_names[r] ?? `row ${r}`;
};
const where = (cfg: StoreConfig, p: Placement) => `${rowName(cfg, p.slot)} row, position ${p.pos + 1}, ${facingsText(p.facings)}`;

export function PlacementSection(props: PlacementSectionProps) {
  const scope = useMemo(() => JSON.stringify(props.planogram), [props.planogram]);
  if (!props.slot) {
    return (
      <section className="placement">
        <h3>where on the shelf</h3>
        <p className="muted pl-note">{props.product.brand || props.product.name} is not on this planogram, so there is no placement to scan or test.</p>
      </section>
    );
  }
  // remounting on a new product or planogram drops every result and makes late responses land nowhere
  return <PlacementBody key={`${props.product.code}:${scope}`} {...props} />;
}

function PlacementBody({ product, planogram, cfg, products, extraProducts, useLLM, busy, onApplyPlanogram }: PlacementSectionProps) {
  const alive = useRef(true);
  const [scan, setScan] = useState<Job<PlacementScan>>({ ...idle, busy: true });
  const [facings, setFacings] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [exp, setExp] = useState<Job<PlacementExperiment>>(idle);
  const [opt, setOpt] = useState<Job<OptimiseResponse>>(idle);
  const [price, setPrice] = useState('');

  useEffect(() => {
    alive.current = true;
    api.placementScan({ product: product.code, planogram, products: extraProducts, agents: SCAN_AGENTS })
      .then((data) => {
        if (!alive.current) return;
        setScan({ busy: false, data, err: null });
        const best = [...data.candidates].filter((c) => !c.is_current).sort((a, b) => b.notice_rate - a.notice_rate);
        // open on the facings of the best candidate, so the preselected cells are the ones on screen
        const tab = best[0]?.facings ?? data.current.facings;
        setFacings(FACINGS.includes(tab) ? tab : 1);
        setPicked(best.filter((c) => c.facings === tab).slice(0, MAX_TESTS).map(keyOf));
      })
      .catch((e) => { if (alive.current) setScan({ busy: false, data: null, err: errText(e) }); });
    return () => { alive.current = false; };
    // the key on this component already covers product and planogram; extraProducts is a fresh array every render
  }, []);

  const chosen = useMemo(
    () => (scan.data?.candidates ?? []).filter((c) => picked.includes(keyOf(c))),
    [scan.data, picked],
  );
  const toggle = (c: PlacementCandidate) => setPicked((cur) => {
    const k = keyOf(c);
    if (cur.includes(k)) return cur.filter((x) => x !== k);
    return cur.length >= MAX_TESTS ? cur : [...cur, k];
  });

  const runExperiment = () => {
    setExp({ busy: true, data: null, err: null });
    api.placementExperiment({
      product: product.code, planogram, products: extraProducts,
      placements: chosen.map(({ slot, pos, facings: f }) => ({ slot, pos, facings: f })),
      agents: TEST_AGENTS, seeds: TEST_SEEDS, mock: !useLLM,
    })
      .then((data) => { if (alive.current) setExp({ busy: false, data, err: null }); })
      .catch((e) => { if (alive.current) setExp({ busy: false, data: null, err: errText(e) }); });
  };

  const priceNum = Number(price);
  const hasPrice = price.trim() !== '' && Number.isFinite(priceNum) && priceNum > 0;
  const runOptimise = () => {
    setOpt({ busy: true, data: null, err: null });
    api.optimise({
      product: product.code, planogram, products: extraProducts, agents: TEST_AGENTS, seeds: TEST_SEEDS,
      edits: hasPrice ? ['claim', 'facings', 'price'] : ['claim', 'facings'],
      price: hasPrice ? priceNum : undefined, mock: !useLLM,
    })
      .then((data) => { if (alive.current) setOpt({ busy: false, data, err: null }); })
      .catch((e) => { if (alive.current) setOpt({ busy: false, data: null, err: errText(e) }); });
  };

  return (
    <section className="placement">
      <div className="pl-main">
      <h3>where on the shelf</h3>
      <p className="muted pl-note">
        how often each spot gets noticed. computed from the notice model, no model call.
      </p>
      {scan.busy && <p className="muted pl-note" role="status">scanning the shelf…</p>}
      {scan.err && <ErrorNote msg={scan.err} />}
      {scan.data && (
        <Heatmap scan={scan.data} cfg={cfg} planogram={planogram} products={products} facings={facings} onFacings={setFacings}
          picked={picked} onToggle={toggle} />
      )}

      </div>
      <div className="pl-side">
      <h3>test it with shoppers</h3>
      <p className="muted pl-note">
        noticing isn't buying. {TEST_AGENTS} shoppers walk each spot on the same seed, and we count who buys.
      </p>
      <Chosen cfg={cfg} chosen={chosen} onToggle={toggle} />
      <div className="pl-actions">
        <button className="btn btn-brand" onClick={runExperiment} disabled={!chosen.length || exp.busy}>
          {exp.busy ? 'shoppers are walking…' : chosen.length === 1 ? 'test 1 placement' : `test ${chosen.length} placements`}
        </button>
        {(exp.data ? exp.data.mock : !useLLM) && <MockNote />}
      </div>
      {exp.busy && <BusyNote useLLM={useLLM} />}
      {exp.err && <ErrorNote msg={exp.err} />}
      {exp.data && <ExperimentResults exp={exp.data} cfg={cfg} product={product} busy={busy} onApply={onApplyPlanogram} />}

      </div>
      <div className="pl-side">
      <h3>other fixes</h3>
      <p className="muted pl-note">
        a claim the product already earns, one more facing{hasPrice ? ', your new price' : ''}. same {TEST_AGENTS} shoppers.
      </p>
      <div className="pl-actions">
        <label className="pl-price">
          new price £
          <input type="number" min="0.01" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
            placeholder={Number(product.price_gbp).toFixed(2)} aria-label="what-if price in pounds, leave empty to skip the price test" />
        </label>
        <button className="btn btn-white" onClick={runOptimise} disabled={opt.busy}>{opt.busy ? 'trying fixes…' : 'try the fixes'}</button>
        {(opt.data ? opt.data.models.includes('mock') : !useLLM) && <MockNote />}
      </div>
      {opt.busy && <BusyNote useLLM={useLLM} />}
      {opt.err && <ErrorNote msg={opt.err} />}
      {opt.data && <Fixes opt={opt.data} />}
      </div>
    </section>
  );
}

function ErrorNote({ msg }: { msg: string }) {
  return (
    <p className="notice" role="status">
      {msg}. is the sim server running? start it with <code>python3 sim/server.py</code>
    </p>
  );
}

function BusyNote({ useLLM }: { useLLM: boolean }) {
  return (
    <p className="notice ok" role="status">
      {useLLM
        ? 'real model calls. this can take a few minutes; keep this open.'
        : 'mock shoppers are walking.'}
    </p>
  );
}

function MockNote() {
  return <Sticker tone="yellow" title="use llm is off: reasons and picks come from the deterministic mock heuristic in sim/run.py, not from a model">mock shoppers</Sticker>;
}

interface HeatmapProps {
  scan: PlacementScan; cfg: StoreConfig; planogram: Planogram; products: Record<string, Product>;
  facings: number; onFacings: (n: number) => void; picked: string[]; onToggle: (c: PlacementCandidate) => void;
}

function Heatmap({ scan, cfg, planogram, products, facings, onFacings, picked, onToggle }: HeatmapProps) {
  const rates = scan.candidates.map((c) => c.notice_rate);
  const lo = Math.min(...rates, scan.current.notice_rate);
  const hi = Math.max(...rates, scan.current.notice_rate);
  const byKey = new Map(scan.candidates.map((c) => [keyOf(c), c]));
  const rows = Array.from({ length: cfg.rows_per_unit }, (_, i) => i + 1);
  const passing = Math.round(scan.current.reach * scan.n_agents);
  const shown = scan.candidates.filter((c) => c.facings === facings);
  const best = shown.reduce<PlacementCandidate | null>((a, c) => (!a || c.notice_rate > a.notice_rate ? c : a), null);
  return (
    <>
      <div className="pl-bar">
        <div className="seg small" role="group" aria-label="facings to show">
          {FACINGS.map((f) => (
            <button key={f} className={`seg-btn ${facings === f ? 'on' : ''}`} aria-pressed={facings === f} onClick={() => onFacings(f)}>{facingsText(f)}</button>
          ))}
        </div>
        <span className="muted small">{picked.length} of {MAX_TESTS} picked</span>
      </div>
      <div className="pl-grid">
        {rows.map((r) => {
          const slot = `${scan.unit}-r${r}`;
          const n = planogram[slot]?.products.length ?? 0;
          return (
            <div key={slot} className={`pl-shelf is-${cfg.row_names[String(r)] ?? 'row'}`}>
              <div className="pl-rowname">{cfg.row_names[String(r)] ?? `row ${r}`}</div>
              {Array.from({ length: n }, (_, pos) => (
                <HeatCell key={pos} c={byKey.get(keyOf({ slot, pos, facings }))} lo={lo} hi={hi} products={products}
                  here={scan.current.slot === slot && scan.current.pos === pos} on={picked.includes(keyOf({ slot, pos, facings }))}
                  best={!!best && best.slot === slot && best.pos === pos} full={picked.length >= MAX_TESTS} onToggle={onToggle} />
              ))}
              {!n && <div className="pl-cell is-empty muted">empty shelf</div>}
            </div>
          );
        })}
      </div>
      <div className="pl-legend muted">
        <span>{pct1(lo)}</span><i aria-hidden /><span>{pct1(hi)}</span>
        <span>notice rate across {scan.candidates.length} spots</span>
      </div>
      <p className="pl-note">
        <b>{pct1(scan.current.reach)}</b> of shoppers pass this unit ({passing} of {scan.n_agents}). lift is against your current spot,{' '}
        {pct1(scan.current.notice_rate)}.
      </p>
      <details className="pl-method">
        <summary>how this is counted</summary>
        <p>{scan.method}</p>
        {!!scan.sources?.length && <ul className="refs">{scan.sources.map((s) => <li key={s}><Src s={s} /></li>)}</ul>}
      </details>
    </>
  );
}

interface HeatCellProps {
  c?: PlacementCandidate; lo: number; hi: number; products: Record<string, Product>;
  here: boolean; on: boolean; best: boolean; full: boolean; onToggle: (c: PlacementCandidate) => void;
}

function HeatCell({ c, lo, hi, products, here, on, best, full, onToggle }: HeatCellProps) {
  if (!c) return <div className="pl-cell is-empty muted">{here ? 'you are here' : 'not scanned'}</div>;
  const t = hi > lo ? (c.notice_rate - lo) / (hi - lo) : 0.5;
  const swap = c.displaces ? products[c.displaces]?.brand ?? c.displaces : null;
  const title = c.is_current ? 'your current placement' : full && !on ? `${MAX_TESTS} already picked, unpick one first` : on ? 'picked to test, click to unpick' : 'click to pick this spot for the shopper test';
  return (
    <button className={`pl-cell ${on ? 'is-on' : ''} ${here ? 'is-here' : ''}`} style={{ background: `color-mix(in srgb, var(--hot) ${Math.round(4 + Math.pow(t, 1.6) * 78)}%, #fff)` }}
      disabled={!!c.is_current} aria-pressed={c.is_current ? undefined : on} title={title} onClick={() => onToggle(c)}>
      {here && <span className="pl-here">you are here</span>}
      {best && !here && <span className="pl-here pl-best">best spot</span>}
      <span className="pl-rate">{pct1(c.notice_rate)}</span>
      <span className="pl-swap">{swap ? `↔ ${swap}` : 'your spot'}</span>
      <span className="pl-lift">{c.is_current ? 'now' : pts(c.lift_vs_current)}</span>
      {on && <span className="pl-tick">testing</span>}
    </button>
  );
}

function Chosen({ cfg, chosen, onToggle }: { cfg: StoreConfig; chosen: PlacementCandidate[]; onToggle: (c: PlacementCandidate) => void }) {
  if (!chosen.length) return <p className="muted pl-note">pick up to {MAX_TESTS} spots on the shelf.</p>;
  return (
    <ul className="pl-chosen">
      {chosen.map((c) => (
        <li key={keyOf(c)}>
          <span>{where(cfg, c)} <span className="muted">· noticed {pct1(c.notice_rate)}</span></span>
          <button className="link-btn" onClick={() => onToggle(c)} aria-label={`remove ${where(cfg, c)} from the test`}>remove</button>
        </li>
      ))}
    </ul>
  );
}

const spanOf = (rows: { delta: number; ci: [number, number] }[]) =>
  Math.max(0.01, ...rows.flatMap((r) => [Math.abs(r.delta), Math.abs(r.ci[0]), Math.abs(r.ci[1])])) * 1.1;

interface ExperimentProps {
  exp: PlacementExperiment; cfg: StoreConfig; product: Product; busy: boolean;
  onApply: PlacementSectionProps['onApplyPlanogram'];
}

function ExperimentResults({ exp, cfg, product, busy, onApply }: ExperimentProps) {
  const span = spanOf(exp.results.map((r) => ({ delta: r.delta_pick, ci: r.delta_ci95 })));
  const label = (r: PlacementResult) => `${product.brand || product.name}: ${where(cfg, r.placement)}`;
  return (
    <div className="pl-results">
      <p className="pl-note">
        now: <b>{pct1(exp.baseline.pick_rate)}</b> picked, {pct1(exp.baseline.notice_rate)} noticed, over {exp.baseline.n} shoppers at the shelf.
      </p>
      {exp.results.map((r) => (
        <DeltaRow key={keyOf(r.placement)} what={r.what_changed} base={r.pick_base} next={r.pick_new} delta={r.delta_pick} ci={r.delta_ci95}
          nBase={r.n_base} nNew={r.n_new} significant={r.significant} span={span} cost={r.cost_usd}
          extra={<>noticed {pct1(r.notice_base)} → {pct1(r.notice_new)}</>}
          action={<button className="btn btn-white pl-apply" disabled={busy} onClick={() => onApply(r.planogram, label(r))}>{busy ? 're-running…' : 'apply and re-run'}</button>} />
      ))}
      {!exp.results.length && <p className="muted pl-note">the server returned no results for these placements.</p>}
      <details className="pl-method">
        <summary>how this was tested</summary>
        <p>{exp.method}</p>
      </details>
    </div>
  );
}

function Fixes({ opt }: { opt: OptimiseResponse }) {
  const done = opt.results.filter((r) => !r.skipped);
  const span = spanOf(done.map((r) => ({ delta: r.delta_pick ?? 0, ci: r.delta_ci95 ?? [0, 0] })));
  return (
    <div className="pl-results">
      {opt.results.map((r: OptimiseResult) => r.skipped ? (
        <p key={r.edit} className="pl-skip"><b>{r.edit}</b> skipped: {r.why ?? 'no reason given'}</p>
      ) : (
        <DeltaRow key={r.edit} what={<><b>{r.edit}</b>: {r.what_changed}</>} base={r.pick_base ?? 0} next={r.pick_new ?? 0} delta={r.delta_pick ?? 0}
          ci={r.delta_ci95 ?? [0, 0]} nBase={r.n_base ?? 0} nNew={r.n_new ?? 0} significant={!!r.significant} span={span} cost={r.cost_usd} />
      ))}
      <h4 className="pl-sub">claims it could carry</h4>
      {opt.true_claims_available.map((c) => (
        <p key={c.claim} className="pl-claim"><Sticker tone="good">{c.claim}</Sticker> <span>{c.why}</span> <Src s={c.source} /></p>
      ))}
      {!opt.true_claims_available.length && <p className="muted pl-note">none. nothing in its fields clears a claim threshold.</p>}
      <details className="pl-method">
        <summary>how this was tested</summary>
        <p>{opt.method}</p>
        <p>{opt.agents} shoppers × {opt.seeds.length} seed{opt.seeds.length === 1 ? '' : 's'} ({opt.seeds.join(', ')}); {opt.models.join(', ')}.</p>
      </details>
    </div>
  );
}

interface DeltaRowProps {
  what: ReactNode; base: number; next: number; delta: number; ci: [number, number];
  nBase: number; nNew: number; significant: boolean;
  /** half-width of the interval axis, shared by every row in a list so bars compare */
  span: number; cost?: number; extra?: ReactNode; action?: ReactNode;
}

function DeltaRow({ what, base, next, delta, ci, nBase, nNew, significant, span, cost, extra, action }: DeltaRowProps) {
  const x = (v: number) => 50 + Math.max(-1, Math.min(1, v / span)) * 50;
  const tone = !significant ? 'flat' : delta > 0 ? 'up' : 'down';
  return (
    <div className={`pl-row is-${tone}`}>
      <div className="pl-what">{what}</div>
      <div className="pl-nums">
        <span>pick rate {pct1(base)} → <b>{pct1(next)}</b></span>
        <b className="pl-delta">{pts(delta)}</b>
        <span className="muted">95% ci {pts(ci[0])} to {pts(ci[1])}</span>
      </div>
      <div className="pl-ci" role="img" aria-label={`change ${pts(delta)}, 95% interval ${pts(ci[0])} to ${pts(ci[1])}`}>
        <i className="pl-range" style={{ left: `${x(ci[0])}%`, width: `${x(ci[1]) - x(ci[0])}%` }} />
        <i className="pl-zero" />
        <i className="pl-point" style={{ left: `${x(delta)}%` }} />
      </div>
      <div className="pl-axis muted"><span>{pts(-span)}</span><span>no change</span><span>{pts(span)}</span></div>
      <div className="pl-foot">
        <Sticker tone={tone === 'up' ? 'good' : tone === 'down' ? 'bad' : 'white'}>
          {tone === 'flat' ? 'no clear change' : tone === 'up' ? 'clear lift' : 'clear drop'}
        </Sticker>
        <span className="muted small">
          n = {nBase} before, {nNew} after{extra && <> · {extra}</>}{!!cost && <> · llm cost ${cost.toFixed(3)}</>}
        </span>
        {action}
      </div>
    </div>
  );
}

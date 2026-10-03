import { useEffect, useMemo, useRef, useState } from 'react';
import type { Planogram, Product, RearrangeCheck, RearrangeMove, RearrangePlan, RearrangeUnit, StoreConfig, Unit } from '../types';
import { productWorld, unitLocalToWorld } from '../layout';
import { moveFx, type MoveArrow } from '../scene/MoveFx';
import { api } from '../api';
import { catColor, catLabel, prodLabel } from '../theme';
import type { RearrangeProps } from './featureProps';
import { Src } from './bits';
import './rearrange.css';

// assumption: sample size picked for a hackathon demo, not from a power calculation
const TEST_AGENTS = 150;
/** shoppers the plan has not seen: two seeds away from the run it learned from */
const testSeeds = (learned: number | undefined) => [(learned ?? 1) + 100, (learned ?? 1) + 101];

type Objective = RearrangePlan['objective'];
const GOALS: { id: Objective; label: string }[] = [{ id: 'picks', label: 'more buys' }, { id: 'revenue', label: 'more revenue' }];

interface Fail { msg: string; down: boolean }
interface Job<T> { busy: boolean; data: T | null; err: Fail | null }
const idle = { busy: false, data: null, err: null };
const loading = { busy: true, data: null, err: null };
// fetch rejects with a TypeError when nothing answers; the server's own errors arrive as plain Errors
const fail = (e: unknown): Fail => ({ msg: e instanceof Error ? e.message : String(e), down: e instanceof TypeError });

const pct = (x: number) => { const v = x * 100; return `${Math.abs(v) < 10 ? v.toFixed(1) : Math.round(v)}%`; };
const sign = (x: number) => (x >= 0 ? '+' : '−');
const lift = (x: number) => `${sign(x)}${pct(Math.abs(x))}`;
// a store-wide change in buy rate is often under one point, so small values keep a second decimal
const pts = (x: number) => { const v = Math.abs(x * 100); return `${sign(x)}${v < 1 ? v.toFixed(2) : v.toFixed(1)} pts`; };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function RearrangePanel(props: RearrangeProps) {
  const { run, planogram, extraProducts, useLLM, busy, cfg } = props;
  const [objective, setObjective] = useState<Objective>('picks');
  const [plan, setPlan] = useState<Job<RearrangePlan>>(loading);
  const [check, setCheck] = useState<Job<RearrangeCheck>>(idle);
  const [sel, setSel] = useState<string | null>(null);
  const [after, setAfter] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const gen = useRef(0);
  // extraProducts and the callbacks are fresh on every render; the effects read the latest without re-running for them
  const live = useRef({ planogram, extraProducts, onPreview: props.onPreview });
  live.current = { planogram, extraProducts, onPreview: props.onPreview };
  const scope = useMemo(() => JSON.stringify(planogram), [planogram]);

  useEffect(() => {
    const id = ++gen.current;
    setPlan(loading);
    setCheck(idle);
    setSel(null); setAfter(false);
    api.rearrangeSuggest({ planogram: live.current.planogram, products: live.current.extraProducts, run_ids: [run.run_id], objective, max_swaps: MAX_SWAPS })
      .then((data) => { if (gen.current === id) setPlan({ busy: false, data, err: null }); })
      .catch((e) => { if (gen.current === id) setPlan({ busy: false, data: null, err: fail(e) }); });
    return () => { gen.current++; };
  }, [run.run_id, scope, objective]);

  const proposed = plan.data?.planogram ?? null;
  // categories with a swap worth making, best first; one swap each keeps every card to two products
  const units = useMemo(() => plan.data ? [...plan.data.units].filter((u) => u.moves.length >= 2).sort((a, b) => b.lift_pct - a.lift_pct).slice(0, TOP_UNITS) : [], [plan.data]);
  const cur = units.find((u) => u.unit === sel) ?? null;
  // the store with ONLY the chosen unit swapped
  const one = useMemo(() => (cur && proposed ? onlyUnit(planogram, proposed, cur.unit) : null), [cur, proposed, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // preview: the shelves animate (packs fly) whenever this flips
  useEffect(() => { live.current.onPreview(after && one ? one : null); }, [after, one]);
  useEffect(() => () => { live.current.onPreview(null); moveFx.setArrows([]); }, []);
  // arrows for the chosen swap, only while showing 'before'
  useEffect(() => {
    const list: MoveArrow[] = [];
    if (cur && proposed && !after) for (const m of cur.moves) { const a = arrowFor(cfg, planogram, proposed, m, true); if (a) list.push(a); }
    moveFx.setArrows(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, proposed, after, scope, cfg]);

  const choose = (u: RearrangeUnit) => {
    setAfter(false);
    if (sel === u.unit) { setSel(null); return; }
    setSel(u.unit);
    const pts = proposed ? u.moves.map((m) => arrowFor(cfg, planogram, proposed, m, true)).filter(Boolean) as MoveArrow[] : [];
    if (!pts.length) return;
    const xs = pts.flatMap((a) => [a.from, a.to]);
    const c = { x: avg(xs.map((p) => p.x)), y: avg(xs.map((p) => p.y)), z: avg(xs.map((p) => p.z)) };
    const span = Math.max(...xs.map((p) => Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z))) * 2;
    moveFx.flyTo({ ...c, fx: pts[0].fx, fz: pts[0].fz, span });
  };

  const runCheck = () => {
    if (!one) return;
    const id = gen.current;
    setCheck(loading);
    api.rearrangeValidate({ before: planogram, after: one, products: extraProducts, agents: TEST_AGENTS, seeds: testSeeds(run.seed), mock: !useLLM })
      .then((data) => { if (gen.current === id) setCheck({ busy: false, data, err: null }); })
      .catch((e) => { if (gen.current === id) setCheck({ busy: false, data: null, err: fail(e) }); });
  };
  const apply = () => { if (one && cur) props.onApplyPlanogram(one, `swap in ${catLabel(cur.category)}`); };

  if (collapsed) {
    return (
      <button className="card rearrange ra-tab" onClick={() => setCollapsed(false)} aria-label="open rearrange panel">
        <span>rearrange</span>
      </button>
    );
  }
  return (
    <aside className="card rearrange ra-narrow" aria-label="rearrange the shelves">
      <Head objective={objective} onObjective={setObjective} onClose={props.onClose} onCollapse={() => setCollapsed(true)} />
      <div className="ra-board">
        {plan.busy && <p className="ra-tile ra-wait muted" role="status">working out the best swaps…</p>}
        {plan.err && <ErrorNote err={plan.err} />}
        {plan.data && !units.length && <p className="ra-tile ra-none">nothing to swap. the shelves are already in their best order.</p>}
        {plan.data?.learned_from.other_store && <p className="notice">learned on a different layout: only shared products have data.</p>}
        {!!units.length && proposed && (
          <>
            <p className="ra-tm-h"><b>pick a category.</b> <span className="muted">one swap each, best first.</span></p>
            <ol className="ra-cats">
              {units.map((u) => {
                const unit = cfg.units.find((x) => x.id === u.unit);
                return (
                  <li key={u.unit}>
                    <button className={`ra-cat ${u.unit === sel ? 'on' : ''}`} aria-pressed={u.unit === sel} onClick={() => choose(u)}
                      title={`${u.before} → ${u.after} ${u.value_unit}`}>
                      <i className="dot" style={{ background: catColor(u.category) }} aria-hidden />
                      <span className="ra-cat-name">{catLabel(u.category)}<small className="muted"> aisle {unit?.aisle ?? '?'}{unit ? (unit.side === 'L' ? ', left' : ', right') : ''}</small></span>
                      <b className="ra-cat-lift">{lift(u.lift_pct)}</b>
                    </button>
                    {u.unit === sel && <SwapCard u={u} cfg={cfg} before={planogram} after={proposed} products={props.products}
                      showing={after} onWatch={() => setAfter(!after)} onApply={apply} busy={busy} onAnalytics={props.onPickProduct} />}
                  </li>
                );
              })}
            </ol>
            {cur && (
              <details className="ra-how">
                <summary>test this swap with new shoppers</summary>
                <Actions check={check} useLLM={useLLM} busy={busy} seeds={testSeeds(run.seed)} onCheck={runCheck} />
              </details>
            )}
          </>
        )}
        {plan.data && <Method plan={plan.data} />}
      </div>
    </aside>
  );
}

/** categories listed (assumption: a short list a store owner can act on today) */
const TOP_UNITS = 6;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
/** the current planogram with one unit's shelves replaced by the proposal */
function onlyUnit(before: Planogram, proposed: Planogram, unit: string): Planogram {
  const out: Planogram = { ...before };
  for (const k of Object.keys(proposed)) if (k.startsWith(`${unit}-r`)) out[k] = proposed[k];
  return out;
}

// assumption: one swap per shelf unit, so every suggestion is two products trading places
const MAX_SWAPS = 1;

/** the aisle-facing direction of a unit (local +z), world xz */
function frontOf(cfg: StoreConfig, u: Unit) {
  const a = unitLocalToWorld(cfg, u, 0, 0), b = unitLocalToWorld(cfg, u, 0, 1);
  return { x: b.x - a.x, z: b.z - a.z };
}
function arrowFor(cfg: StoreConfig, before: Planogram, after: Planogram, m: RearrangeMove, main: boolean): MoveArrow | null {
  const a = productWorld(cfg, before, m.from.slot, m.code), b = productWorld(cfg, after, m.to.slot, m.code);
  if (!a || !b) return null;
  const f = frontOf(cfg, b.unit);
  return { from: { x: a.x, y: a.y, z: a.z }, to: { x: b.x, y: b.y, z: b.z }, fx: f.x, fz: f.z, main };
}

interface SwapCardProps {
  u: RearrangeUnit; cfg: StoreConfig; before: Planogram; after: Planogram; products: Record<string, Product>;
  showing: boolean; busy: boolean; onWatch: () => void; onApply: () => void; onAnalytics: (code: string) => void;
}

/** one swap in kid words: two products, where each is now (shelf + height), and what the swap buys */
function SwapCard({ u, cfg, before, products, showing, busy, onWatch, onApply, onAnalytics }: SwapCardProps) {
  const [a, b] = u.moves;
  const side = (m: RearrangeMove) => {
    const w = productWorld(cfg, before, m.from.slot, m.code);
    return (
      <div className="ra-swap-side">
        <button className="link-btn ra-swap-name" onClick={() => onAnalytics(m.code)}>{prodLabel(products[m.code] ?? m, m.code)}</button>
        <span className="ra-swap-where"><b>{m.from.row_name} shelf</b>{w ? ` · ${(w.y - w.h / 2).toFixed(1)} m up` : ''} · spot {m.from.pos + 1}</span>
        <span className="muted small">seen by {pct(m.notice_before)} → <b>{pct(m.notice_after)}</b></span>
      </div>
    );
  };
  return (
    <div className="ra-swap">
      <div className="ra-swap-pair">{side(a)}<span className="ra-swap-x" aria-label="swaps with">⇄</span>{b && side(b)}</div>
      <p className="ra-swap-why muted">{a.why}.</p>
      <div className="ra-btns">
        <button className="btn btn-white" onClick={onWatch}>{showing ? '↺ put it back' : '▶ watch it'}</button>
        <button className="btn btn-brand" onClick={onApply} disabled={busy}>{busy ? 're-running…' : 'do this swap'}</button>
      </div>
    </div>
  );
}

interface HeadProps { objective: Objective; onObjective: (o: Objective) => void; onClose: () => void; onCollapse: () => void }

function Head({ objective, onObjective, onClose, onCollapse }: HeadProps) {
  return (
    <header className="ra-top">
      <button className="x" onClick={onClose} aria-label="close">×</button>
      <button className="x ra-collapse" onClick={onCollapse} aria-label="tuck the panel away" title="tuck away">›</button>
      <h2 className="display">rearrange the shelves</h2>
      <div className="seg" role="group" aria-label="goal">
        {GOALS.map((g) => (
          <button key={g.id} className={`seg-btn ${objective === g.id ? 'on' : ''}`} aria-pressed={objective === g.id} onClick={() => onObjective(g.id)}>{g.label}</button>
        ))}
      </div>
    </header>
  );
}

function ErrorNote({ err, what }: { err: Fail; what?: string }) {
  if (err.down) {
    return <p className="notice" role="status">can't reach the sim server. start it with <code>python3 sim/server.py</code></p>;
  }
  return (
    <p className="notice" role="status">
      {what && <b>{what} </b>}{err.msg}
      {err.msg.startsWith('no run to learn from') && <span className="ra-hint">run the store first, then come back.</span>}
    </p>
  );
}

function Summary({ plan }: { plan: RearrangePlan }) {
  const t = plan.total;
  if (!plan.moves) {
    return (
      <section className="ra-tile ra-sum">
        <p className="ra-none">nothing to move. the shelves are already in their best order for these shoppers.</p>
      </section>
    );
  }
  const units = plan.units.filter((u) => u.moves.length).length;
  return (
    <section className="ra-tile ra-sum">
      <p className="ra-headline">
        move <b>{plural(plan.moves, 'product')}</b> to sell about <span className="ra-lift">{pct(t.lift_pct)}</span> more.
      </p>
      <p className="ra-sum-l muted" title={`${t.before} → ${t.after} ${t.value_unit}`}>
        a prediction from {plural(plan.learned_from.shoppers, 'shopper')}, across {plural(units, 'shelf unit')}{plan.units_total ? ` of ${plan.units_total}` : ''}. test it before you apply it.
      </p>
      {plan.learned_from.other_store && (
        <p className="notice">this run was made on a different store layout, so only the products the two share have data. run this store once for a full plan.</p>
      )}
    </section>
  );
}

interface ActionsProps {
  check: Job<RearrangeCheck>; useLLM: boolean; busy: boolean; seeds: number[]; onCheck: () => void;
}

function Actions({ check, useLLM, busy, seeds, onCheck }: ActionsProps) {
  return (
    <section className="ra-tile ra-act">
      <div className="ra-btns">
        <button className="btn btn-white" onClick={onCheck} disabled={check.busy || busy}
          title={`${TEST_AGENTS} new shoppers walk the old and the new layout (seeds ${seeds.join(' and ')}, not the one it learned from)`}>{check.busy ? 'shoppers are walking…' : 'run the test'}</button>
      </div>
      {check.busy && (
        <p className="notice ok" role="status">
          {useLLM ? 'real model calls. this can take a few minutes; keep this open.' : 'shoppers are walking.'}
        </p>
      )}
      {check.err && <ErrorNote err={check.err} what="the test failed:" />}
      {check.data && <CheckResult check={check.data} />}
    </section>
  );
}

function CheckResult({ check }: { check: RearrangeCheck }) {
  const d = check.store;
  const [lo, hi] = d.delta_ci95;
  const span = Math.max(0.0005, Math.abs(d.delta_rate), Math.abs(lo), Math.abs(hi)) * 1.1;
  const x = (v: number) => 50 + Math.max(-1, Math.min(1, v / span)) * 50;
  const tone = !d.significant ? 'flat' : d.delta_rate > 0 ? 'up' : 'down';
  return (
    <div className={`ra-check is-${tone}`}>
      <p className="ra-verdict">
        {tone === 'flat' ? 'no clear change: ' : tone === 'up' ? 'it works: ' : 'it got worse: '}
        shoppers bought <b>{d.picks_before.toLocaleString()} → {d.picks_after.toLocaleString()}</b>
        {d.picks_before > 0 && <> ({lift((d.picks_after - d.picks_before) / d.picks_before)})</>}.
        {null}
      </p>
      <details className="ra-how">
      <summary>the numbers</summary>
      <div className="ra-check-nums">
        <span>rate {pct(d.rate_before)} → <b>{pct(d.rate_after)}</b></span>
        <b className="ra-delta">{pts(d.delta_rate)}</b>
        <span className="muted">95% ci {pts(lo)} to {pts(hi)}</span>
      </div>
      <div className="ra-ci" role="img" aria-label={`change ${pts(d.delta_rate)}, 95% interval ${pts(lo)} to ${pts(hi)}`}>
        <i className="ra-range" style={{ left: `${x(lo)}%`, width: `${x(hi) - x(lo)}%` }} />
        <i className="ra-zero" />
        <i className="ra-point" style={{ left: `${x(d.delta_rate)}%` }} />
      </div>
      <div className="ra-axis muted"><span>{pts(-span)}</span><span>no change</span><span>{pts(span)}</span></div>
      <div className="ra-foot">
        <span className="muted small">
          n = {d.shown_before.toLocaleString()} products passed before, {d.shown_after.toLocaleString()} after
          {' · '}{plural(check.agents, 'shopper')} × {plural(check.seeds.length, 'seed')}
          {check.cost_usd > 0 && <> · llm cost ${check.cost_usd.toFixed(3)}</>}
        </span>
      </div>
      <p>{check.method}</p>
      </details>
    </div>
  );
}

function Method({ plan }: { plan: RearrangePlan }) {
  return (
    <details className="ra-how ra-method">
      <summary>how this is decided</summary>
      <p>{plan.method}</p>
      {!!plan.assumptions.length && <ul className="refs">{plan.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}
      {!!plan.sources?.length && <ul className="refs">{plan.sources.map((s) => <li key={s}><Src s={s} /></li>)}</ul>}
    </details>
  );
}

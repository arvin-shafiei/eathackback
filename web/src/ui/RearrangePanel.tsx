import { useEffect, useMemo, useRef, useState } from 'react';
import type { Planogram, RearrangeCheck, RearrangeMove, RearrangePlan, SpotRef, StoreConfig, Unit } from '../types';
import { productWorld, unitLocalToWorld } from '../layout';
import { moveFx, type MoveArrow } from '../scene/MoveFx';
import { api } from '../api';
import { prodLabel } from '../theme';
import type { RearrangeProps } from './featureProps';
import { Src } from './bits';
import './rearrange.css';

// assumption: sample size picked for a hackathon demo, not from a power calculation
const TEST_AGENTS = 150;
/** shoppers the plan has not seen: two seeds away from the run it learned from */
const testSeeds = (learned: number | undefined) => [(learned ?? 1) + 100, (learned ?? 1) + 101];
const MOVES_SHOWN = 5;

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
  const [shownN, setShownN] = useState(MOVES_SHOWN);
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
    setSel(null); setShownN(MOVES_SHOWN);
    api.rearrangeSuggest({ planogram: live.current.planogram, products: live.current.extraProducts, run_ids: [run.run_id], objective, max_swaps: MAX_SWAPS })
      .then((data) => { if (gen.current === id) setPlan({ busy: false, data, err: null }); })
      .catch((e) => { if (gen.current === id) setPlan({ busy: false, data: null, err: fail(e) }); });
    return () => { gen.current++; };
  }, [run.run_id, scope, objective]);

  const proposed = plan.data?.planogram ?? null;
  // the shelves always show the store as it is now; the arrow points at where a product would go
  useEffect(() => { live.current.onPreview(null); }, []);
  useEffect(() => () => { live.current.onPreview(null); moveFx.setArrows([]); }, []);

  // biggest-lift units first; within a unit keep the planner's order
  const moves = useMemo(() => plan.data ? [...plan.data.units].sort((a, b) => b.lift_pct - a.lift_pct).flatMap((u) => u.moves) : [], [plan.data]);
  const shown = moves.slice(0, shownN);

  // one arrow: the tapped move (ring where it is now, ghost box where it goes)
  useEffect(() => {
    const m = sel && proposed ? moves.find((x) => x.code === sel) : null;
    const a = m && proposed ? arrowFor(cfg, planogram, proposed, m, true) : null;
    moveFx.setArrows(a ? [a] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, proposed, scope, cfg]);

  const pick = (m: RearrangeMove) => {
    if (sel === m.code) { setSel(null); return; }
    setSel(m.code);
    const a = proposed && arrowFor(cfg, planogram, proposed, m, true);
    if (a) {
      const span = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y, a.to.z - a.from.z);
      moveFx.flyTo({ x: (a.from.x + a.to.x) / 2, y: (a.from.y + a.to.y) / 2, z: (a.from.z + a.to.z) / 2, fx: a.fx, fz: a.fz, dist: 3.0 + span * 0.6 });
    }
  };

  const runCheck = () => {
    if (!proposed) return;
    const id = gen.current;
    setCheck(loading);
    api.rearrangeValidate({ before: planogram, after: proposed, products: extraProducts, agents: TEST_AGENTS, seeds: testSeeds(run.seed), mock: !useLLM })
      .then((data) => { if (gen.current === id) setCheck({ busy: false, data, err: null }); })
      .catch((e) => { if (gen.current === id) setCheck({ busy: false, data: null, err: fail(e) }); });
  };
  const apply = () => { if (proposed) { setSel(null); props.onApplyPlanogram(proposed, 'rearranged shelves'); } };

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
        {plan.busy && <p className="ra-tile ra-wait muted" role="status">working out the best order…</p>}
        {plan.err && <ErrorNote err={plan.err} />}
        {!plan.busy && !plan.err && !plan.data && <p className="ra-tile ra-wait muted" role="status">no plan yet.</p>}
        {plan.data && <Summary plan={plan.data} />}
        {plan.data && proposed && plan.data.moves > 0 && (
          <>
            <p className="ra-tm-h muted">tap a move to see an arrow in the store</p>
            <ol className="ra-cards">
              {shown.map((m, i) => (
                <MoveCard key={m.code} n={i + 1} m={m} on={m.code === sel} cfg={cfg} before={planogram} after={proposed}
                  onPick={() => pick(m)} onAnalytics={() => props.onPickProduct(m.code)} />
              ))}
            </ol>
            {moves.length > shownN && (
              <button className="link-btn ra-more" onClick={() => setShownN(shownN + MOVES_SHOWN)}>
                show {Math.min(MOVES_SHOWN, moves.length - shownN)} more ({moves.length - shownN} left)
              </button>
            )}
            <div className="ra-btns">
              <button className="btn btn-brand ra-apply" onClick={apply} disabled={busy} title="re-run the store on the new layout">
                {busy ? 're-running…' : `do all ${plural(moves.length, 'move')}`}
              </button>
            </div>
            <details className="ra-how">
              <summary>test it with new shoppers</summary>
              <Actions check={check} useLLM={useLLM} busy={busy} seeds={testSeeds(run.seed)} onCheck={runCheck} />
            </details>
          </>
        )}
        {plan.data && <Method plan={plan.data} />}
      </div>
    </aside>
  );
}

// assumption: 'medium' plan size (up to three swaps per shelf unit) keeps the list short enough to act on
const MAX_SWAPS = 3;

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

/** a spot in words: aisle, side, shelf, height off the floor (metres, from the 3d layout), spot along the shelf, floor x/z */
function placeOf(cfg: StoreConfig, plan: Planogram, s: SpotRef, code: string) {
  const w = productWorld(cfg, plan, s.slot, code);
  if (!w) return null;
  return {
    aisle: w.unit.aisle, side: w.unit.side === 'L' ? 'left' : 'right', unit: w.unit.id,
    shelf: s.row, of: cfg.rows_per_unit, name: s.row_name, h: w.y - w.h / 2, spot: s.pos + 1, x: w.x, z: w.z,
  };
}
type Place = NonNullable<ReturnType<typeof placeOf>>;

function PlaceLine({ label, p }: { label: string; p: Place }) {
  return (
    <div className="ra-place">
      <span className="ra-place-l">{label}</span>
      <span>
        <b>aisle {p.aisle}</b>, {p.side} side · <b>{p.name} shelf</b> ({p.shelf} of {p.of} from the top) · <b>{p.h.toFixed(2)} m</b> off the floor · spot {p.spot}
        <small className="muted ra-xyz"> {p.unit} · x {p.x.toFixed(1)} m, z {p.z.toFixed(1)} m</small>
      </span>
    </div>
  );
}

interface MoveCardProps {
  n: number; m: RearrangeMove; on: boolean; cfg: StoreConfig; before: Planogram; after: Planogram;
  onPick: () => void; onAnalytics: () => void;
}

function MoveCard({ n, m, on, cfg, before, after, onPick, onAnalytics }: MoveCardProps) {
  const from = placeOf(cfg, before, m.from, m.code), to = placeOf(cfg, after, m.to, m.code);
  const dh = from && to ? to.h - from.h : 0;
  return (
    <li className={`ra-card ${on ? 'on' : ''}`}>
      <button className="ra-card-btn" aria-pressed={on} onClick={onPick}>
        <span className="ra-card-n">{n}</span>
        <span className="ra-card-body">
          <b className="ra-card-name">{prodLabel(m, m.code)}</b>
          {from && <PlaceLine label="now" p={from} />}
          {to && <PlaceLine label="move to" p={to} />}
          <span className="ra-card-sum">
            {Math.abs(dh) >= 0.05 ? (dh > 0 ? `⬆ up ${dh.toFixed(2)} m` : `⬇ down ${(-dh).toFixed(2)} m`) : '↔ same height'}
            {from && to && from.aisle !== to.aisle ? ` · from aisle ${from.aisle} to aisle ${to.aisle}` : ''}
            {' · '}seen by {pct(m.notice_before)} → <b>{pct(m.notice_after)}</b> of shoppers who pass
          </span>
        </span>
      </button>
      {on && (
        <p className="why">{m.why}. <button className="link-btn" onClick={onAnalytics}>analytics</button></p>
      )}
    </li>
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

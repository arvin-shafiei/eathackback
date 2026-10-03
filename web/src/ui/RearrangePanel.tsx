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
  const [plan1, setPlan1] = useState<RearrangePlan | null>(null);
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
    const ask = (max_swaps: number) => api.rearrangeSuggest({ planogram: live.current.planogram, products: live.current.extraProducts, run_ids: [run.run_id], objective, max_swaps });
    // one-swap and two-swap plans: a unit uses the two-swap plan when it is one loop of at most MAX_STEPS products
    Promise.all([ask(1), ask(MAX_SWAPS)])
      .then(([one, two]) => { if (gen.current === id) { setPlan({ busy: false, data: two, err: null }); setPlan1(one); } })
      .catch((e) => { if (gen.current === id) setPlan({ busy: false, data: null, err: fail(e) }); });
    return () => { gen.current++; };
  }, [run.run_id, scope, objective]);

  const proposed = plan.data?.planogram ?? null;
  // per unit: the two-swap plan if it is ONE loop of ≤ MAX_STEPS products, else the one-swap plan; best gain first
  const units = useMemo(() => {
    if (!plan.data) return [];
    const by1 = new Map((plan1?.units ?? []).map((u) => [u.unit, u]));
    const out: { u: RearrangeUnit; steps: RearrangeMove[] }[] = [];
    for (const u2 of plan.data.units) {
      const loop = u2.moves.length ? orderSteps(u2.moves) : null;
      if (loop && loop.length === u2.moves.length && loop.length <= MAX_STEPS) { out.push({ u: u2, steps: loop }); continue; }
      const u1 = by1.get(u2.unit), l1 = u1?.moves.length ? orderSteps(u1.moves) : null;
      if (u1 && l1 && l1.length === u1.moves.length) out.push({ u: u1, steps: l1 });
    }
    return out.sort((a, b) => b.u.lift_pct - a.u.lift_pct).slice(0, TOP_UNITS);
  }, [plan.data, plan1]);
  const cur = units.find((x) => x.u.unit === sel) ?? null;
  // the store with ONLY the chosen unit's steps done
  const one = useMemo(() => (cur ? applySteps(planogram, cur.steps) : null), [cur, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // preview: the shelves animate (packs fly) whenever this flips
  useEffect(() => { live.current.onPreview(after && one ? one : null); }, [after, one]);
  useEffect(() => () => { live.current.onPreview(null); moveFx.setArrows([]); }, []);
  // arrows for the chosen swap, only while showing 'before'
  useEffect(() => {
    const list: MoveArrow[] = [];
    if (cur && one && !after) cur.steps.forEach((m, i) => { const a = arrowFor(cfg, planogram, one, m, true); if (a) list.push({ ...a, label: String(i + 1) }); });
    moveFx.setArrows(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, proposed, after, scope, cfg]);

  const choose = (x: { u: RearrangeUnit; steps: RearrangeMove[] }) => {
    setAfter(false);
    if (sel === x.u.unit) { setSel(null); return; }
    setSel(x.u.unit);
    const done = applySteps(planogram, x.steps);
    const pts = x.steps.map((m) => arrowFor(cfg, planogram, done, m, true)).filter(Boolean) as MoveArrow[];
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
  const apply = () => { if (one && cur) props.onApplyPlanogram(one, `rearranged ${catLabel(cur.u.category)}`); };

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
            <p className="ra-tm-h"><b>pick a category.</b> <span className="muted">up to {MAX_STEPS} moves each, best first.</span></p>
            <ol className="ra-cats">
              {units.map(({ u, steps }) => {
                const unit = cfg.units.find((x) => x.id === u.unit);
                return (
                  <li key={u.unit}>
                    <button className={`ra-cat ${u.unit === sel ? 'on' : ''}`} aria-pressed={u.unit === sel} onClick={() => choose({ u, steps })}
                      title={`${u.before} → ${u.after} ${u.value_unit}`}>
                      <i className="dot" style={{ background: catColor(u.category) }} aria-hidden />
                      <span className="ra-cat-name">{catLabel(u.category)}<small className="muted"> aisle {unit?.aisle ?? '?'}{unit ? (unit.side === 'L' ? ', left' : ', right') : ''}</small></span>
                      <b className="ra-cat-lift">{lift(u.lift_pct)}</b>
                    </button>
                    {u.unit === sel && <SwapCard u={u} steps={steps} cfg={cfg} before={planogram} products={props.products}
                      showing={after} onWatch={() => setAfter(!after)} onApply={apply} busy={busy} onAnalytics={props.onPickProduct} />}
                  </li>
                );
              })}
            </ol>
            {cur && (
              <details className="ra-how">
                <summary>test this with new shoppers</summary>
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
/** most products one suggestion may touch (assumption: a loop a person can do by hand without losing track) */
const MAX_STEPS = 3;
const spotKey = (s: { slot: string; pos: number }) => `${s.slot}#${s.pos}`;
/**
 * the moves as steps you can do by hand, or null if they are not one closed loop.
 * loop A→B's spot, B→C's spot, C→A's spot: hold A, then C into A's gap, B into C's gap, A into B's gap.
 */
function orderSteps(moves: RearrangeMove[]): RearrangeMove[] | null {
  const byFrom = new Map(moves.map((m) => [spotKey(m.from), m]));
  const seq: RearrangeMove[] = [moves[0]];
  for (let m = byFrom.get(spotKey(moves[0].to)); m && m !== moves[0]; m = byFrom.get(spotKey(m.to))) {
    if (seq.length > moves.length) return null;
    seq.push(m);
  }
  if (spotKey(seq[seq.length - 1].to) !== spotKey(moves[0].from)) return null;
  return [...seq.slice(1).reverse(), seq[0]];
}
/** the current planogram with just these moves done (each product takes its facings with it) */
function applySteps(before: Planogram, steps: RearrangeMove[]): Planogram {
  const out: Planogram = { ...before };
  const touch = (slot: string) => (out[slot] = { ...out[slot], products: [...out[slot].products], facings: { ...out[slot].facings } });
  const f = new Map(steps.map((m) => [m.code, before[m.from.slot]?.facings?.[m.code] ?? 1]));
  for (const m of steps) if (out[m.from.slot] === before[m.from.slot]) touch(m.from.slot);
  for (const m of steps) if (out[m.to.slot] === before[m.to.slot]) touch(m.to.slot);
  for (const m of steps) delete out[m.from.slot].facings[m.code];
  for (const m of steps) { out[m.to.slot].products[m.to.pos] = m.code; out[m.to.slot].facings[m.code] = f.get(m.code) ?? 1; }
  return out;
}

// assumption: at most two swaps per shelf unit, so a suggestion is a swap or a loop of three
const MAX_SWAPS = 2;

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
  u: RearrangeUnit; steps: RearrangeMove[]; cfg: StoreConfig; before: Planogram; products: Record<string, Product>;
  showing: boolean; busy: boolean; onWatch: () => void; onApply: () => void; onAnalytics: (code: string) => void;
}

/** the moves as numbered steps that match the numbered arrows in the store */
function SwapCard({ u, steps, cfg, before, products, showing, busy, onWatch, onApply, onAnalytics }: SwapCardProps) {
  const name = (c: string) => prodLabel(products[c] ?? steps.find((m) => m.code === c), c);
  const where = (s: RearrangeMove['from'], code: string) => {
    const w = productWorld(cfg, before, s.slot, code);
    return <><b>{s.row_name} shelf</b>{w ? ` · ${(w.y - w.h / 2).toFixed(1)} m up` : ''} · spot {s.pos + 1}</>;
  };
  const held = steps[steps.length - 1];
  return (
    <div className="ra-swap">
      <Why u={u} steps={steps} name={name} />
      <p className="ra-step0">how: first, take <b>{name(held.code)}</b> off the shelf and hold it.</p>
      <ol className="ra-steps">
        {steps.map((m, i) => (
          <li key={m.code}>
            <span className="ra-step-n">{i + 1}</span>
            <span className="ra-step-b">
              <button className="link-btn ra-swap-name" onClick={() => onAnalytics(m.code)}>{name(m.code)}</button>
              <span className="ra-step-w">{where(m.from, m.code)} → {where(m.to, m.code)}</span>
              <span className="muted small">seen by {pct(m.notice_before)} → <b>{pct(m.notice_after)}</b> of shoppers who pass</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="ra-btns">
        <button className="btn btn-white" onClick={onWatch}>{showing ? '↺ put it back' : '▶ watch it'}</button>
        <button className="btn btn-brand" onClick={onApply} disabled={busy}>{busy ? 're-running…' : 'do it'}</button>
      </div>
    </div>
  );
}

/**
 * the reason in plain words, from the planner's own numbers: which product earns more per look (conversion, from the run),
 * how many shoppers notice each spot (notice model), and what the unit gains (rearrange.py unit value, per 100 passers)
 */
function Why({ u, steps, name }: { u: RearrangeUnit; steps: RearrangeMove[]; name: (c: string) => string }) {
  const up = [...steps].sort((a, b) => (b.notice_after - b.notice_before) * b.conversion - (a.notice_after - a.notice_before) * a.conversion)[0];
  const others = steps.filter((m) => m !== up);
  const money = u.value_unit.startsWith('£');
  return (
    <div className="ra-why">
      <p className="ra-why-big"><b>{lift(u.lift_pct)}</b> {money ? 'sales £' : 'sales'} from this shelf</p>
      <p className="ra-why-sub">{money ? `£${u.before.toFixed(2)} → £${u.after.toFixed(2)}` : `${u.before.toFixed(1)} → ${u.after.toFixed(1)} buys`} for every 100 shoppers who walk past</p>
      <ul className="ra-why-list">
        <li><b>{name(up.code)}</b> sells well: <b>{pct(up.conversion)}</b> of people who notice it buy it (this shelf's average is {pct(u.unit_conversion)}).</li>
        <li>but it sits on the <b>{up.from.row_name} shelf</b>, where only <b>{pct(up.notice_before)}</b> of shoppers notice it.</li>
        <li>on the <b>{up.to.row_name} shelf</b>, <b>{pct(up.notice_after)}</b> notice it, so more of them buy it.</li>
        {others.map((m) => (
          <li key={m.code}><b>{name(m.code)}</b> sells less per look ({pct(m.conversion)}), so it {m.notice_after < m.notice_before ? 'gives up the better spot' : 'shifts along'}.</li>
        ))}
      </ul>
      {up.thin && <p className="ra-why-thin muted">based on only {up.picked} buys in {up.noticed} looks, so it leans on the shelf average. test it before you commit.</p>}
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

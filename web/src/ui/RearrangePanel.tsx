import { useEffect, useMemo, useRef, useState } from 'react';
import type { Planogram, Product, RearrangeCheck, RearrangeMove, RearrangePlan, RearrangeUnit, StoreConfig, Unit } from '../types';
import { productWorld, unitLocalToWorld } from '../layout';
import { moveFx, type MoveArrow } from '../scene/MoveFx';
import { api } from '../api';
import { catLabel, prodLabel } from '../theme';
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
  // restock checklist ticks, keyed slot#pos; and which unit is open
  const [done, setDone] = useState<Set<string>>(() => new Set());
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
    setSel(null); setDone(new Set());
    api.rearrangeSuggest({ planogram: live.current.planogram, products: live.current.extraProducts, run_ids: [run.run_id], objective, max_swaps: MAX_SWAPS })
      .then((data) => { if (gen.current === id) setPlan({ busy: false, data, err: null }); })
      .catch((e) => { if (gen.current === id) setPlan({ busy: false, data: null, err: fail(e) }); });
    return () => { gen.current++; };
  }, [run.run_id, scope, objective]);

  const proposed = plan.data?.planogram ?? null;
  // the shelves always show the store as it is now; the arrow points at where a product would go
  useEffect(() => { live.current.onPreview(null); }, []);
  useEffect(() => () => { live.current.onPreview(null); moveFx.setArrows([]); }, []);

  // units that change, biggest lift first; each is restocked from empty, so its list is the whole unit, not a chain of swaps
  const units = useMemo(() => plan.data ? [...plan.data.units].filter((u) => u.moves.length).sort((a, b) => b.lift_pct - a.lift_pct) : [], [plan.data]);
  const totalMoves = plan.data?.moves ?? 0;

  // tapping a unit: small arrows for everything that changes place in it, camera framed on the whole unit
  useEffect(() => {
    const u = sel && proposed ? units.find((x) => x.unit === sel) : null;
    const list: MoveArrow[] = [];
    if (u && proposed) for (const m of u.moves) { const a = arrowFor(cfg, planogram, proposed, m, false); if (a) list.push(a); }
    moveFx.setArrows(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, proposed, scope, cfg]);

  const pick = (u: RearrangeUnit) => {
    if (sel === u.unit) { setSel(null); return; }
    setSel(u.unit);
    const unit = cfg.units.find((x) => x.id === u.unit);
    if (!unit) return;
    const mid = unitLocalToWorld(cfg, unit, 0, -0.2), f = frontOf(cfg, unit);
    moveFx.flyTo({ x: mid.x, y: 1, z: mid.z, fx: f.x, fz: f.z, span: UNIT_LEN });
  };
  const tick = (k: string) => setDone((d) => { const n = new Set(d); if (n.has(k)) n.delete(k); else n.add(k); return n; });

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
            <p className="ra-tm-h muted">clear these shelves, then put everything back in this order. tap a unit to see it in the store.</p>
            <ol className="ra-cards">
              {units.map((u, i) => (
                <UnitCard key={u.unit} n={i + 1} u={u} on={u.unit === sel} cfg={cfg} after={proposed} products={props.products}
                  done={done} onTick={tick} onPick={() => pick(u)} />
              ))}
            </ol>
            <div className="ra-btns">
              <button className="btn btn-brand ra-apply" onClick={apply} disabled={busy} title="re-run the store on the new layout">
                {busy ? 're-running…' : `apply all ${plural(units.length, 'unit')} (${plural(totalMoves, 'product')} change place)`}
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

/** length of one shelf bay along the aisle, metres (layout.ts G.unitLen) */
const UNIT_LEN = 6.4;

interface UnitCardProps {
  n: number; u: RearrangeUnit; on: boolean; cfg: StoreConfig; after: Planogram; products: Record<string, Product>;
  done: Set<string>; onTick: (k: string) => void; onPick: () => void;
}

/** one shelf unit as a restock checklist: shelves top to bottom, products left to right (as you face the shelf) */
function UnitCard({ n, u, on, cfg, after, products, done, onTick, onPick }: UnitCardProps) {
  const unit = cfg.units.find((x) => x.id === u.unit);
  const moved = new Set(u.moves.map((m) => m.code));
  const rows = Array.from({ length: cfg.rows_per_unit }, (_, i) => i + 1);
  const keys = rows.flatMap((r) => (after[`${u.unit}-r${r}`]?.products ?? []).map((_, p) => `${u.unit}-r${r}#${p}`));
  const ticked = keys.filter((k) => done.has(k)).length;
  return (
    <li className={`ra-card ${on ? 'on' : ''}`}>
      <button className="ra-card-btn" aria-pressed={on} onClick={onPick}>
        <span className="ra-card-n">{n}</span>
        <span className="ra-card-body">
          <b className="ra-card-name">aisle {unit?.aisle ?? '?'}, {unit?.side === 'L' ? 'left' : 'right'} side · {catLabel(u.category)}</b>
          <span className="muted small">{u.unit} · {plural(u.moves.length, 'product')} change place · {ticked}/{keys.length} placed</span>
        </span>
      </button>
      <div className="ra-shelves">
        {rows.map((r) => {
          const slot = `${u.unit}-r${r}`, set = after[slot], codes = set?.products ?? [];
          const w = productWorld(cfg, after, slot, null);
          return (
            <div key={r} className="ra-shelf-l">
              <p className="ra-shelf-h"><b>{cfg.row_names[String(r)] ?? `row ${r}`} shelf</b> <span className="muted">· {r} of {cfg.rows_per_unit} from the top{w ? ` · ${(w.y - w.h / 2).toFixed(2)} m off the floor` : ''} · left → right</span></p>
              <ol className="ra-check-list">
                {codes.map((c, p) => {
                  const k = `${slot}#${p}`, f = set?.facings?.[c] ?? 1;
                  return (
                    <li key={k} className={done.has(k) ? 'is-done' : ''}>
                      <label>
                        <input type="checkbox" checked={done.has(k)} onChange={() => onTick(k)} />
                        <span className="ra-pos">{p + 1}</span>
                        <span>{prodLabel(products[c], c)}{f > 1 ? <span className="muted"> ×{f} facings</span> : null}</span>
                        {moved.has(c) && <span className="ra-new" title="this product is in a different spot from today">new spot</span>}
                      </label>
                    </li>
                  );
                })}
                {!codes.length && <li className="muted">leave empty</li>}
              </ol>
            </div>
          );
        })}
      </div>
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

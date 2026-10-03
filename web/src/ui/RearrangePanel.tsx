import { useEffect, useMemo, useRef, useState } from 'react';
import type { Planogram, Product, RearrangeCheck, RearrangeMove, RearrangePlan, RearrangeUnit, StoreConfig, Unit } from '../types';
import { productWorld, unitLocalToWorld } from '../layout';
import { moveFx, type MoveArrow } from '../scene/MoveFx';
import { api } from '../api';
import { catColor, catLabel, prodLabel } from '../theme';
import type { RearrangeProps } from './featureProps';
import { Src, Sticker } from './bits';
import './rearrange.css';

// assumption: sample size picked for a hackathon demo, not from a power calculation
const TEST_AGENTS = 150;
/** shoppers the plan has not seen: two seeds away from the run it learned from */
const testSeeds = (learned: number | undefined) => [(learned ?? 1) + 100, (learned ?? 1) + 101];
const MOVES_SHOWN = 4;

type Objective = RearrangePlan['objective'];
const GOALS: { id: Objective; label: string }[] = [{ id: 'picks', label: 'more buys' }, { id: 'revenue', label: 'more revenue' }];
const AMOUNTS: { id: string; label: string; max: number | null; title: string }[] = [
  { id: 'light', label: 'light', max: 1, title: 'one swap per unit' },
  { id: 'medium', label: 'medium', max: 3, title: 'up to three swaps per unit' },
  { id: 'full', label: 'full', max: null, title: 'every swap that helps' },
];

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
const unitOf = (slot: string) => slot.replace(/-r\d+$/, '');
const spot = (s: RearrangeMove['from']) => `${s.row_name}, position ${s.pos + 1}`;

export function RearrangePanel(props: RearrangeProps) {
  const { run, planogram, extraProducts, useLLM, busy, cfg } = props;
  const [objective, setObjective] = useState<Objective>('picks');
  const [amount, setAmount] = useState('medium');
  const [plan, setPlan] = useState<Job<RearrangePlan>>(loading);
  const [check, setCheck] = useState<Job<RearrangeCheck>>(idle);
  // before / after on the 3d shelves; every flip animates (ShelfFill flies the packs that change place)
  const [view, setView] = useState<'before' | 'after'>('before');
  const [seen, setSeen] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [allArrows, setAllArrows] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [moving, setMoving] = useState(0);
  const gen = useRef(0);
  // extraProducts and the callbacks are fresh on every render; the effects read the latest without re-running for them
  const live = useRef({ planogram, extraProducts, onPreview: props.onPreview });
  live.current = { planogram, extraProducts, onPreview: props.onPreview };
  const scope = useMemo(() => JSON.stringify(planogram), [planogram]);
  const maxSwaps = AMOUNTS.find((a) => a.id === amount)?.max ?? null;

  useEffect(() => {
    const id = ++gen.current;
    setPlan(loading);
    setCheck(idle);
    setView('before'); setSeen(false); setSel(null);
    api.rearrangeSuggest({ planogram: live.current.planogram, products: live.current.extraProducts, run_ids: [run.run_id], objective, max_swaps: maxSwaps })
      .then((data) => { if (gen.current === id) setPlan({ busy: false, data, err: null }); })
      .catch((e) => { if (gen.current === id) setPlan({ busy: false, data: null, err: fail(e) }); });
    return () => { gen.current++; };
  }, [run.run_id, scope, objective, maxSwaps]);

  const proposed = plan.data?.planogram ?? null;
  useEffect(() => { live.current.onPreview(view === 'after' ? proposed : null); }, [view, proposed]);
  useEffect(() => () => { live.current.onPreview(null); moveFx.setArrows([]); }, []);
  // "moving N products" chip while packs are in the air
  useEffect(() => moveFx.on(() => {
    setMoving(moveFx.last.moved);
    const t = setTimeout(() => setMoving(0), 2600);
    return () => clearTimeout(t);
  }), []);

  // top moves, biggest-lift units first; within a unit keep the planner's order
  const moves = useMemo(() => plan.data ? [...plan.data.units].sort((a, b) => b.lift_pct - a.lift_pct).flatMap((u) => u.moves) : [], [plan.data]);
  const shown = moves.slice(0, allArrows ? ARROWS_ALL : TOP_MOVES);

  // 3d arrows: the selected move big (ring at its spot now, ghost where it goes), 'show all' adds small ones
  useEffect(() => {
    if (!proposed) { moveFx.setArrows([]); return; }
    const list: MoveArrow[] = [];
    for (const m of allArrows ? shown : shown.filter((x) => x.code === sel)) {
      const a = arrowFor(cfg, planogram, proposed, m, m.code === sel);
      if (a) list.push(a);
    }
    moveFx.setArrows(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, allArrows, proposed, scope, cfg]);

  const pick = (m: RearrangeMove) => {
    if (sel === m.code) { setSel(null); return; }
    setSel(m.code);
    const a = proposed && arrowFor(cfg, planogram, proposed, m, true);
    if (a) {
      const span = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y, a.to.z - a.from.z);
      moveFx.flyTo({ x: (a.from.x + a.to.x) / 2, y: (a.from.y + a.to.y) / 2, z: (a.from.z + a.to.z) / 2, fx: a.fx, fz: a.fz, dist: 3.4 + span * 0.9 });
    }
  };
  const showWhere = () => {
    if (!plan.data) return;
    const u = [...plan.data.units].sort((a, b) => b.moves.length - a.moves.length)[0];
    const m = u?.moves[0];
    const w = m && productWorld(cfg, planogram, m.from.slot, null);
    if (!w) return;
    const f = frontOf(cfg, w.unit);
    moveFx.flyTo({ x: w.x, y: 1, z: w.z, fx: f.x, fz: f.z, dist: 6 });
  };
  const show = (v: 'before' | 'after') => { setView(v); if (v === 'after') setSeen(true); };

  const runCheck = () => {
    if (!proposed) return;
    const id = gen.current;
    setCheck(loading);
    api.rearrangeValidate({ before: planogram, after: proposed, products: extraProducts, agents: TEST_AGENTS, seeds: testSeeds(run.seed), mock: !useLLM })
      .then((data) => { if (gen.current === id) setCheck({ busy: false, data, err: null }); })
      .catch((e) => { if (gen.current === id) setCheck({ busy: false, data: null, err: fail(e) }); });
  };
  // the preview stays on while the store re-runs, so the shelves don't fly back and forth; the new plan resets it
  const apply = () => { if (proposed && seen) props.onApplyPlanogram(proposed, 'rearranged shelves'); };

  void amount; void setAmount; // amount stays 'medium' (≤3 swaps per unit); the toggle was cut to keep the panel simple
  if (collapsed) {
    return (
      <button className="card rearrange ra-tab" onClick={() => setCollapsed(false)} aria-label="open rearrange panel">
        <span>rearrange</span>{view === 'after' && <i className="ra-tab-dot" aria-hidden />}
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
        {plan.data && plan.data.moves > 0 && (
          <>
            <section className="ra-stage">
              {!seen ? (
                <button className="btn btn-brand ra-showme" onClick={() => show('after')}>show me the new layout</button>
              ) : (
                <>
                  <div className="seg ra-ba" role="group" aria-label="before or after">
                    <button className={`seg-btn ${view === 'before' ? 'on' : ''}`} aria-pressed={view === 'before'} onClick={() => show('before')}>before</button>
                    <button className={`seg-btn ${view === 'after' ? 'on' : ''}`} aria-pressed={view === 'after'} onClick={() => show('after')}>after</button>
                  </div>
                  <div className="ra-mini">
                    <button className="link-btn" onClick={() => moveFx.replay()}>↻ replay</button>
                    <button className="link-btn" onClick={showWhere}>show me where</button>
                  </div>
                </>
              )}
              {moving > 0 && <p className="ra-moving" role="status">shuffling {plural(moving, 'shelf spot')}…</p>}
            </section>
            <TopMoves moves={shown} total={moves.length} sel={sel} all={allArrows} onAll={setAllArrows} onPick={pick} onAnalytics={props.onPickProduct} />
            <div className="ra-btns">
              <button className="btn btn-brand ra-apply" onClick={apply} disabled={busy || !seen} title={seen ? 're-run the store on the new layout' : 'look at it first'}>
                {busy ? 're-running…' : seen ? 'apply' : 'preview first'}
              </button>
            </div>
            <details className="ra-how">
              <summary>test it with new shoppers</summary>
              <Actions check={check} useLLM={useLLM} busy={busy} seeds={testSeeds(run.seed)} onCheck={runCheck} />
            </details>
            <details className="ra-how">
              <summary>see every shelf</summary>
              <Units plan={plan.data} planogram={planogram} cfg={props.cfg} products={props.products} focus={props.focus} onPickProduct={props.onPickProduct} />
            </details>
          </>
        )}
        {plan.data && <Method plan={plan.data} />}
      </div>
    </aside>
  );
}

const TOP_MOVES = 5;
const ARROWS_ALL = 12;

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

interface TopMovesProps {
  moves: RearrangeMove[]; total: number; sel: string | null; all: boolean;
  onAll: (v: boolean) => void; onPick: (m: RearrangeMove) => void; onAnalytics: (code: string) => void;
}

function TopMoves({ moves, total, sel, all, onAll, onPick, onAnalytics }: TopMovesProps) {
  return (
    <section className="ra-top-moves">
      <p className="ra-tm-h muted">tap a move to see it in the store</p>
      <ol>
        {moves.map((m) => (
          <li key={m.code} className={m.code === sel ? 'on' : ''}>
            <button className="ra-tm-row" aria-pressed={m.code === sel} onClick={() => onPick(m)}>
              <b>{prodLabel(m, m.code)}</b>
              <span className="muted">{m.from.row_name === m.to.row_name ? `${m.from.row_name}, spot ${m.from.pos + 1} → ${m.to.pos + 1}` : `${m.from.row_name} → ${m.to.row_name}`}</span>
            </button>
            {m.code === sel && (
              <p className="why">noticed {pct(m.notice_before)} → {pct(m.notice_after)}. {m.why}.{' '}
                <button className="link-btn" onClick={() => onAnalytics(m.code)}>analytics</button></p>
            )}
          </li>
        ))}
      </ol>
      {total > TOP_MOVES && (
        <button className="link-btn ra-more" aria-pressed={all} onClick={() => onAll(!all)}>
          {all ? 'fewer' : `show all arrows (top ${Math.min(ARROWS_ALL, total)})`}
        </button>
      )}
    </section>
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

interface UnitsProps {
  plan: RearrangePlan; planogram: Planogram; cfg: StoreConfig; products: Record<string, Product>;
  focus?: string; onPickProduct: (code: string) => void;
}

function Units({ plan, planogram, cfg, products, focus, onPickProduct }: UnitsProps) {
  const focusUnit = useMemo(() => {
    if (!focus) return null;
    const slot = Object.keys(planogram).find((s) => planogram[s]?.products.includes(focus));
    return slot ? unitOf(slot) : null;
  }, [focus, planogram]);
  const moved = plan.units.filter((u) => u.moves.length);
  const ordered = [...moved.filter((u) => u.unit === focusUnit), ...moved.filter((u) => u.unit !== focusUnit)];
  const alone = plan.units.length - moved.length;
  return (
    <>
      {ordered.map((u) => (
        <UnitTile key={u.unit} unit={u} before={planogram} after={plan.planogram} cfg={cfg} products={products}
          open={u.unit === (focusUnit ?? ordered[0]?.unit)} focus={u.unit === focusUnit ? focus : undefined} onPickProduct={onPickProduct} />
      ))}
      {(alone > 0 || !!plan.no_data_units?.length) && (
        <p className="ra-alone muted">
          {alone > 0 && <>{plural(alone, 'unit')} left as they are. </>}
          {!!plan.no_data_units?.length && <>{plural(plan.no_data_units.length, 'unit')} had no shoppers in this run.</>}
        </p>
      )}
    </>
  );
}

interface UnitTileProps {
  unit: RearrangeUnit; before: Planogram; after: Planogram; cfg: StoreConfig; products: Record<string, Product>;
  focus?: string; open: boolean; onPickProduct: (code: string) => void;
}

function UnitTile({ unit, before, after, cfg, products, focus, open, onPickProduct }: UnitTileProps) {
  const [all, setAll] = useState(false);
  const moved = useMemo(() => new Set(unit.moves.map((m) => m.code)), [unit.moves]);
  const shown = all ? unit.moves : unit.moves.slice(0, MOVES_SHOWN);
  return (
    <details className="ra-tile ra-unit" open={open}>
      <summary className="ra-unit-h"
        title={`${unit.before} → ${unit.after} ${unit.value_unit}, predicted · ${pct(unit.reach)} of shoppers pass · learned from ${unit.picked} buys in ${unit.noticed} notices`}>
        <h3>
          <i className="dot" style={{ background: catColor(unit.category) }} aria-hidden />
          {catLabel(unit.category)} <span className="muted">{unit.unit}</span>
        </h3>
        <div className="ra-unit-n">
          <span className="muted">{plural(unit.moves.length, 'move')}</span>
          <b className="ra-unit-lift">{lift(unit.lift_pct)}</b>
        </div>
      </summary>
      <ShelfDiff unit={unit.unit} cfg={cfg} before={before} after={after} products={products} moved={moved} focus={focus} />
      <ul className="ra-moves">
        {shown.map((m) => <MoveRow key={m.code} move={m} isFocus={m.code === focus} onPick={onPickProduct} />)}
      </ul>
      {unit.moves.length > MOVES_SHOWN && (
        <button className="link-btn ra-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? `show first ${MOVES_SHOWN}` : `show all ${unit.moves.length}`}
        </button>
      )}
    </details>
  );
}

interface ShelfDiffProps {
  unit: string; cfg: StoreConfig; before: Planogram; after: Planogram; products: Record<string, Product>;
  moved: Set<string>; focus?: string;
}

function ShelfDiff({ unit, cfg, before, after, products, moved, focus }: ShelfDiffProps) {
  const rows = Array.from({ length: cfg.rows_per_unit }, (_, i) => i + 1);
  const hasFocus = !!focus && rows.some((r) => before[`${unit}-r${r}`]?.products.includes(focus));
  const side = (title: string, plan: Planogram) => (
    <figure className="ra-shelfset">
      <figcaption>{title}</figcaption>
      <div className="ra-gondola">
        {rows.map((r) => {
          const codes = plan[`${unit}-r${r}`]?.products ?? [];
          return (
            <div key={r} className="ra-shelf">
              <span className="ra-rowname">{cfg.row_names[String(r)] ?? `row ${r}`}</span>
              <span className="ra-prods">
                {codes.map((c) => {
                  const p = products[c];
                  const cls = `ra-prod ${moved.has(c) ? 'is-moved' : ''} ${c === focus ? 'is-focus' : ''}`;
                  return <span key={c} className={cls} title={`${prodLabel(p, c)}${moved.has(c) ? ' (moves)' : ''}`}>{p?.brand || p?.name || c}</span>;
                })}
                {!codes.length && <span className="ra-empty muted">empty shelf</span>}
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
  return (
    <>
      <div className="ra-diff">{side('now', before)}{side('proposed', after)}</div>
      <p className="ra-key muted">
        <span className="ra-prod is-moved">moves</span>
        {hasFocus && <span className="ra-prod is-focus">your product</span>}
      </p>
    </>
  );
}

function MoveRow({ move, isFocus, onPick }: { move: RearrangeMove; isFocus: boolean; onPick: (code: string) => void }) {
  return (
    <li className={`ra-move ${isFocus ? 'is-focus' : ''}`}>
      <details>
        <summary className="ra-move-line" title={`${spot(move.from)} → ${spot(move.to)}`}>
          <b>{prodLabel(move, move.code)}</b>
          <span>{move.from.row_name === move.to.row_name ? `${move.from.row_name}, spot ${move.from.pos + 1} → ${move.to.pos + 1}` : <>{move.from.row_name} → <b>{move.to.row_name}</b></>}</span>
          {move.thin && <Sticker tone="white" title={`noticed ${move.noticed} times in the runs learned from, so its conversion leans on the unit average`}>few shoppers</Sticker>}
        </summary>
        <p className="why">noticed {pct(move.notice_before)} → {pct(move.notice_after)}. {move.why}.{' '}
          <button className="link-btn" onClick={() => onPick(move.code)}>open its analytics</button>
        </p>
      </details>
    </li>
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

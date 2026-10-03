import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Persona, Product, Run } from '../types';
import { isAI } from '../types';
import { archetypeOf, pct } from '../stats';
import {
  ARM_GAP, DIMENSION_ARM, EMPTY_FUNNEL, LOW_N_ROW, MIN_HUMAN_SHOWN,
  behaviour, behaviourCsv, breakdown, diagnose, diagnosisText, funnels, lostTo, mechLabel, rejections, rowOf, sampleSize, shelfOptions,
  slotOfProduct, slotProducts, stepRates, unitProducts,
  type Diagnosis, type Dimension, type Funnel, type InsightArm, type LostTo, type Rejections, type SampleSize,
} from '../insights';
import { AI_COLOR, DECISION, archColor, archLabel, catColor, catLabel, prodLabel } from '../theme';
import { Bar, Sticker } from './bits';
import type { InsightsProps } from './featureProps';
import { PlacementSection } from './PlacementSection';
import { InterviewSection } from './InterviewSection';
import { Select } from './Select';
import { engineOf } from './engineBadge';
import { ShelfOpportunity } from './ShelfOpportunity';
import './insights.css';
import { RankSection } from './RankSection';

const HUMAN_COLOR = '#2bb673';
const TRAIT_NAME: Record<string, string> = { O: 'openness', C: 'conscientiousness', E: 'extraversion', A: 'agreeableness', N: 'neuroticism' };
const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: 'archetype', label: 'shopper type' }, { key: 'mission', label: 'mission' }, { key: 'ocean', label: 'ocean segment' }, { key: 'model', label: 'ai model' },
];
const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function InsightsPanel(props: InsightsProps) {
  const { run, product: p, planogram, cfg, products, personas, onPickProduct, onTrace, onClose } = props;
  const slot = props.slot ?? slotOfProduct(planogram, p.code);
  const human = useMemo(() => funnels(run, 'human'), [run]);
  const ai = useMemo(() => funnels(run, 'ai'), [run]);
  const own = human[p.code] ?? EMPTY_FUNNEL, aiOwn = ai[p.code] ?? EMPTY_FUNNEL;
  const sample = useMemo(() => sampleSize(run, own, aiOwn), [run, own, aiOwn]);
  const diagnosis = useMemo(() => diagnose(run, p.code, unitProducts(planogram, slot), human, ai), [run, p.code, planogram, slot, human, ai]);
  const placementRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const neverShown = own.shown === 0 && aiOwn.shown === 0;

  return (
    <aside className="card insights" aria-label={`product analytics for ${p.name}`}>
      <RankSection run={run} products={products} current={p.code} onPickProduct={onPickProduct} />
      <div className="ins-top">
        <button className="x" onClick={onClose} aria-label="close product analytics">×</button>
        <Head product={p} slot={slot} rowName={slot ? cfg.row_names[rowOf(slot)] : undefined} options={shelfOptions(planogram, products)} products={products} onPickProduct={onPickProduct} />
        {p.pack_copy && <p className="ins-product-copy">{p.pack_copy}</p>}
        <p className="ins-purpose">product analytics for the shelf: who notices it, picks it up, puts it back or takes it, and why.</p>
        <SampleLine sample={sample} run={run} />
        {!neverShown && <nav className="ins-section-nav" aria-label="product analytics sections">
          <button className="btn btn-white" onClick={() => { setActivityOpen(true); requestAnimationFrame(() => activityRef.current?.scrollIntoView({ block: 'start' })); }}>view shopper activity</button>
          <button className="link-btn" onClick={() => placementRef.current?.scrollIntoView({ block: 'start' })}>test a change</button>
          {p.off_url && <a href={p.off_url} target="_blank" rel="noreferrer">product facts ↗</a>}
        </nav>}
      </div>
      {neverShown ? (
        <p className="notice">no shopper and no ai agent was shown this product in <code>{run.run_id}</code>, so there is nothing to count. pick another run in the run picker, or re-run the store with this product on the shelf.</p>
      ) : (
        <div className="ins-board">
          <Story own={own} ai={aiOwn} aiLoaded={sample.ai_loaded} d={diagnosis} unit={slot ? slot.split('-r')[0] : undefined} />
          <ShelfOpportunity sourceRun={props.sourceRun} product={p} slot={slot} planogram={planogram} cfg={cfg} products={products} extraProducts={props.extraProducts} onRearrange={props.onRearrange} />
          <BreakdownSection run={run} code={p.code} personas={personas} aiLoaded={sample.ai_loaded} />
          <LostToSection run={run} code={p.code} products={products} aiLoaded={sample.ai_loaded} onPickProduct={onPickProduct} />
          <RejectSection run={run} code={p.code} personas={personas} onTrace={onTrace} />
          <NeighbourSection codes={slotProducts(planogram, slot)} me={p.code} slot={slot} human={human} products={products} onPickProduct={onPickProduct} />
          <div ref={activityRef} className="ins-activity-wrap">
            <BehaviourSection run={run} code={p.code} name={p.name} personas={personas} onTrace={onTrace} expanded={activityOpen} onExpandedChange={setActivityOpen} />
          </div>
          <InterviewSection run={run} code={p.code} name={p.name} personas={personas} />
        </div>
      )}
      <div ref={placementRef} className="ins-placement">
        <div className="ins-band">
          <h3 className="display">what to change</h3>
          <label className="toggle llm" title="off = free. on = real llm calls via openrouter (costs money, cached). applies to the experiments below.">
            <input type="checkbox" checked={props.useLLM} onChange={(e) => props.onUseLLM(e.target.checked)} /> real ai shoppers (costs)
          </label>
        </div>
        <PlacementSection product={p} slot={slot} planogram={planogram} cfg={cfg} products={products} extraProducts={props.extraProducts}
          useLLM={props.useLLM} busy={props.busy} onApplyPlanogram={props.onApplyPlanogram} />
      </div>
      <details className="prov ins-how">
        <summary>how these numbers are counted</summary>
        <p>
          everything above "what to change" is counted in your browser from the events in <code>{run.run_id}</code> that touched <code>{p.code}</code>: {own.shown} shelf events from shoppers and {aiOwn.shown} feed events from ai agents, never added together. 95% ci is wilson (1927).
          assumptions: {MIN_HUMAN_SHOWN} shoppers as the "too few" line, {pct(ARM_GAP)} as the shopper vs ai gap worth a sentence, {LOW_N_ROW} as the grey-out line for a row.
        </p>
      </details>
    </aside>
  );
}

interface HeadProps {
  product: Product; slot?: string; rowName?: string; options: ReturnType<typeof shelfOptions>;
  products: Record<string, Product>; onPickProduct: (code: string) => void;
}
function Head({ product: p, slot, rowName, options, products, onPickProduct }: HeadProps) {
  const mine = options.filter((o) => o.brand_supplied), rest = options.filter((o) => !o.brand_supplied);
  const opt = (group: string) => (o: (typeof options)[number]) => ({ value: o.code, label: prodLabel(products[o.code], o.code), hint: o.slot, group });
  return (
    <header className="prod-head ins-head">
      <div className="prod-thumb" style={{ background: p.color || catColor(p.category) }}>
        {p.image ? <img src={p.image} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : <span>{(p.brand || '?').slice(0, 2)}</span>}
      </div>
      <div className="ins-head-main">
        <h2 className="display" title={`${p.brand} ${p.name}`}>{p.brand} <span className="thin">{p.brand && p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? p.name.slice(p.brand.length).trim() : p.name}</span></h2>
        <div className="chips">
          {p.brand_supplied && <Sticker tone="yellow" title="typed in by the brand; not checked against open food facts">your product</Sticker>}
          <Sticker>{catLabel(p.category)}</Sticker>
          <Sticker title={slot ? `slot ${slot}` : undefined}>{slot ? (rowName ? `${rowName} shelf` : slot) : 'not on the shelf'}</Sticker>
          <Sticker title={p.price_source}>£{Number(p.price_gbp).toFixed(2)}</Sticker>
        </div>
        <Select
          className="ins-select" ariaLabel="switch product" prefix="product" searchable value={p.code} onChange={onPickProduct}
          options={[
            ...(options.some((o) => o.code === p.code) ? [] : [{ value: p.code, label: prodLabel(p, p.code), hint: 'not on the shelf' }]),
            ...mine.map(opt('brand-supplied')), ...rest.map(opt(`on the shelf (${rest.length})`)),
          ]}
        />
      </div>
    </header>
  );
}

function SampleLine({ sample: s, run }: { sample: SampleSize; run: Run }) {
  const engine = engineOf(run);
  return (
    <>
      <p className="ins-data-note">simulated shoppers · {engine?.kind === 'mock' ? 'layout preview, rule-based decisions' : 'recorded simulation, not observed store customers'}
        {engine?.kind === 'mock' && <> · <a href="?store=standard&nointro&view=analytics&run=run_20261003_120823_s11_jev_4482&product=5070000126579">open recorded shopper demo →</a></>}
      </p>
      <p className="ins-sample">
        <b>{plural(s.human_shoppers, 'shopper')}</b> passed its shelf · {plural(s.human_shown, 'shelf event')} ·{' '}
        {s.ai_loaded ? <><b>{plural(s.ai_sessions, 'ai shopper')}</b> saw it</> : <span className="muted">no ai shoppers</span>}
      </p>
      {!!run.cost?.errors && (
        <p className="notice">{plural(run.cost.errors, 'llm call')} failed in this run. the sim logs each as a walk-past with the reason "(llm error)"; they are not shopper decisions, so every count on this page leaves them out.</p>
      )}
      {s.ai_loaded && s.ai_sessions === 0 && (
        <p className="notice">no ai agent was shown this product in the loaded run. there is no ai comparison for it yet.</p>
      )}
      {s.thin && s.human_shown > 0 && (
        <p className="notice">only {plural(s.human_shown, 'shopper')} passed it. that is too few to act on (we want {MIN_HUMAN_SHOWN}, an assumption). re-run with more shoppers.</p>
      )}
    </>
  );
}

const STEP_OF: Record<string, string> = { notice: 'noticed', consider: 'picked up', pick: 'taken' };

interface StoryProps {
  own: Funnel; ai: Funnel; aiLoaded: boolean; d: Diagnosis; unit?: string;
}
/** One run, four stages. Counts are visible; bar lengths use the same shelf-pass denominator. */
function Story({ own, ai, aiLoaded, d, unit }: StoryProps) {
  const text = diagnosisText(d);
  const rates = stepRates(own);
  const leak = d.bottleneck ? STEP_OF[d.bottleneck.step] : null;
  const steps = [
    { label: 'passed shelf', count: own.shown, rate: null },
    { label: 'noticed', count: own.noticed, rate: rates[0].rate },
    { label: 'picked up', count: own.considered, rate: rates[1].rate },
    { label: 'taken', count: own.picked, rate: rates[2].rate },
  ];
  return (
    <section className="tile t-7 ins-story" aria-label="summary">
      <h3>the product funnel</h3>
      <p className="ins-headline"><b>{pct(own.pick_rate)}</b> end up in the basket</p>
      <p className="ins-funnel-caption">{own.picked} takes from {own.shown} shelf passes · patterns in this run</p>
      <div className="ins-funnel-chart" role="img" aria-label={steps.map((s) => `${s.label}: ${s.count}`).join(', ')}>
        {steps.map((st, i) => (
          <div className={`ins-funnel-row ${leak === st.label ? 'is-leak' : ''}`} key={st.label}>
            <span className="ins-funnel-label">{st.label}</span>
            <div className="ins-funnel-track"><i style={{ width: `${own.shown ? st.count / own.shown * 100 : 0}%`, background: i === 3 ? 'var(--hot)' : i === 0 ? 'var(--ink)' : 'var(--muted)' }} /></div>
            <b>{st.count}</b><span className="ins-funnel-rate">{st.rate === null ? 'start' : pct(st.rate)}{leak === st.label && <small>biggest gap</small>}</span>
          </div>
        ))}
      </div>
      <p className="ins-funnel-caption">bar length = share of shelf passes · % = conversion from the previous step</p>
      <p className="ins-diagnosis">{text.main}</p>
      <p className="ins-outcomes"><b>{own.shown - own.noticed}</b> never noticed · <b>{own.walk_past}</b> moved on · <b>{own.rejected}</b> put back</p>
      {aiLoaded && ai.shown > 0 && <p className="ins-ai">ai feed comparison: <b>{ai.picked} of {ai.shown}</b> picked it</p>}
      <details className="ins-how">
        <summary>source and calculation</summary>
        <p>taken means added to the simulated basket. pick-up flags take priority; older logs infer handling from their stage or decision. each conversion is compared with the median of the other products in unit {unit ?? '?'}; the step furthest below is highlighted. this is a directional diagnosis, not proof of a cause. 95% wilson interval for takes per pass: {pct(own.ci95[0])}–{pct(own.ci95[1])}.{text.arm && <> {text.arm}</>}</p>
        <table className="kv ins-table">
          <thead><tr><th>step</th><th>this product</th><th>shelf median</th></tr></thead>
          <tbody>{d.gaps.map((g) => <tr key={g.step}><th>{STEP_OF[g.step]}</th><td>{g.rate === null ? 'n/a' : pct(g.rate)} ({g.k}/{g.n})</td><td>{g.unit_median === null ? 'n/a' : pct(g.unit_median)}</td></tr>)}</tbody>
        </table>
      </details>
    </section>
  );
}

interface MiniRow { key: string; label: string; value: number; right: string; me?: boolean }
/** up to four bars, scaled to the largest, so a tile shows its answer without being opened */
function MiniBars({ rows, color, empty, scale }: { rows: MiniRow[]; color?: string; empty: string; scale?: number }) {
  if (!rows.length) return <p className="q-empty muted">{empty}</p>;
  const max = scale ?? (Math.max(...rows.map((r) => r.value), 0) || 1);
  return (
    <div className="q-bars">
      {rows.map((r) => (
        <div key={r.key} className={`q-bar ${r.me ? 'is-me' : ''}`}>
          <span className="q-bar-l" title={r.label}>{r.label}</span>
          <span className="q-bar-t"><i style={{ width: `${Math.max(0, r.value / max) * 100}%`, background: r.me ? 'var(--hot)' : color }} /></span>
          <span className="q-bar-r">{r.right}</span>
        </div>
      ))}
    </div>
  );
}

/** one question on the overview: a small chart, the takeaway in a sentence, and the full detail on demand */
function Fold({ q, a, viz, span = 4, children, expanded, onExpandedChange, action = 'see all' }: { q: string; a?: ReactNode; viz?: ReactNode; span?: 4 | 6; children: ReactNode; expanded?: boolean; onExpandedChange?: (open: boolean) => void; action?: string }) {
  const [localOpen, setOpen] = useState(false);
  const open = expanded ?? localOpen;
  return (
    <section className={`tile ${open ? 't-12' : `t-${span}`} qtile`}>
      <h3>{q}</h3>
      {viz}
      {a && <p className="q-take">{a}</p>}
      <button className="link-btn q-more" aria-expanded={open} onClick={() => { setOpen(!open); onExpandedChange?.(!open); }}>{open ? 'show less' : action}</button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}

const secs = (x: number | null) => (x === null ? '–' : `${x.toFixed(1)}s`);

function BehaviourSection({ run, code, name, personas, onTrace, expanded, onExpandedChange }: { run: Run; code: string; name: string; personas: Record<string, Persona>; onTrace: (id: string, step: number) => void; expanded: boolean; onExpandedChange: (open: boolean) => void }) {
  const b = useMemo(() => behaviour(run, code, personas), [run, code, personas]);
  const [outcome, setOutcome] = useState('all');
  const [page, setPage] = useState(0);
  const filtered = b.rows.filter((r) => outcome === 'all' || r.decision === outcome);
  const pageSize = 20;
  const download = () => {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([behaviourCsv(filtered)], { type: 'text/csv' }));
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-shopper-log.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const per100 = (x: number | null) => (x === null ? '–' : x.toFixed(1));
  const share = (f: { k: number; n: number } | null) => (f ? <><b>{pct(f.k / f.n)}</b> <span className="muted">{f.k} of {f.n} noticed events with this flag logged</span></> : <span className="muted">not logged</span>);
  return (
    <Fold q="shopper activity" span={6} expanded={expanded} onExpandedChange={onExpandedChange} action="view activity log"
      a={`${b.rows.length} shelf events from ${new Set(b.rows.map((r) => r.agent_id)).size} simulated shoppers. open any event to see its reason and source.`}
      viz={(
        <div className="q-stats">
          <div><b>{per100(b.buys_per_100_visits)}</b><span>buys per 100 store visits</span></div>
          <div><b>{secs(b.seconds.walk_past.mean)}</b><span>modelled shelf time, walked past</span></div>
          <div><b>{secs(b.seconds.reject.mean)}</b><span>modelled shelf time, put it back</span></div>
        </div>
      )}>
      <div className="ins-log-tools">
        <label>outcome <select aria-label="filter shopper outcome" value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(0); }}>
          <option value="all">all events</option><option value="pick">taken</option><option value="reject">rejected</option><option value="walk_past">walked past</option><option value="not_noticed">never noticed</option>
        </select></label>
        <button className="btn btn-white ins-dl" onClick={download} disabled={!filtered.length}>download csv</button>
      </div>
      <p className="ins-funnel-caption">modelled shelf time is an input to the simulation, not measured dwell time. pick-up and label flags show “not logged” where the run did not record them.</p>
      <div className="ins-log-scroll">
        <table className="kv ins-table ins-event-table" aria-label="shopper activity log">
          <thead><tr><th>shopper / mission</th><th>outcome</th><th>picked up / label read</th><th>reason / trace</th></tr></thead>
          <tbody>{filtered.slice(page * pageSize, (page + 1) * pageSize).map((r) => (
            <tr key={`${r.agent_id}:${r.step}`}>
              <td><b>{personas[r.persona_id]?.name ?? archLabel(r.archetype)}</b><small>{archLabel(r.archetype)} · {r.agent_id}</small><small>{r.mission.replace(/_/g, ' ') || 'mission not logged'} · step {r.step}</small></td>
              <td>{r.decision === 'pick' ? 'taken' : r.decision === 'reject' ? 'rejected' : r.decision === 'not_noticed' ? 'never noticed' : 'walked past'}</td>
              <td>{r.picked_up === null ? 'not logged' : r.picked_up ? 'picked up' : 'not picked up'}<small>{r.back_of_pack === null ? 'label read not logged' : r.back_of_pack ? 'label read' : 'label not read'}</small></td>
              <td><button className="link-btn ins-event-link" onClick={() => onTrace(r.agent_id, r.step)}>{r.reason || (r.noticed ? 'no reason logged' : 'never noticed this product')}<span>open decision trace →</span></button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {!filtered.length && <p className="muted" role="status">no events with this outcome in this run.</p>}
      <div className="ins-log-pages">
        <span role="status">{filtered.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length} events` : '0 events'}</span>
        <button className="btn btn-white" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>previous</button>
        <button className="btn btn-white" disabled={(page + 1) * pageSize >= filtered.length} onClick={() => setPage((n) => n + 1)}>next</button>
      </div>
      <div className="beh-stats">
        <div><span className="kpi-l">buying frequency</span><b className="beh-n">{per100(b.buys_per_100_visits)}</b><span className="kpi-s">buys per 100 store visits · {b.store_shoppers} visits</span></div>
        <div><span className="kpi-l">per shelf pass</span><b className="beh-n">{per100(b.buys_per_100_passes)}</b><span className="kpi-s">buys per 100 at the shelf</span></div>
        <div><span className="kpi-l">modelled shelf time (buyers)</span><b className="beh-n">{secs(b.seconds.pick.mean)}</b><span className="kpi-s">n={b.seconds.pick.n} · walked past {secs(b.seconds.walk_past.mean)} (n={b.seconds.walk_past.n}) · put back {secs(b.seconds.reject.mean)} (n={b.seconds.reject.n})</span></div>
        <div><span className="kpi-l">picked it up</span><span className="beh-line">{share(b.picked_up)}</span><span className="kpi-l">turned it over</span><span className="beh-line">{share(b.back_of_pack)}</span></div>
      </div>
      <table className="kv ins-table">
        <thead><tr><th>shopper type</th><th>stood at it</th><th>noticed</th><th>picked up</th><th>bought</th><th>time at shelf</th><th>mean sentiment</th></tr></thead>
        <tbody>
          {b.by_archetype.map((g) => (
            <tr key={g.key} className={g.shown < LOW_N_ROW ? 'ins-thin' : ''}>
              <th><span className="dot" style={{ background: archColor(g.key) }} /> {archLabel(g.key)}</th>
              <td>{g.shown}</td><td>{g.noticed}</td><td>{b.picked_up ? g.picked_up : '–'}</td><td>{g.picked}</td>
              <td>{secs(g.mean_seconds)}</td><td>{g.mean_sentiment === null ? 'n/a' : signed(g.mean_sentiment)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="ins-how">
        <summary>how to read this</summary>
        <p>
          time at shelf is the seconds each shopper type gives a shelf (the persona's <code>seconds_at_shelf</code>, an input to the notice model). it is not a measured dwell.
          every shopper makes one trip per run, so there is no repeat purchase or retention here. rows under {LOW_N_ROW} shoppers are greyed.
        </p>
      </details>
    </Fold>
  );
}

function dimLabel(dim: Dimension, key: string) {
  if (dim !== 'ocean') return archLabel(key);
  const [t, level] = key.split('_');
  return `${TRAIT_NAME[t] ?? t} ${level}`;
}

function BreakdownSection({ run, code, personas, aiLoaded }: { run: Run; code: string; personas: Record<string, Persona>; aiLoaded: boolean }) {
  const [dim, setDim] = useState<Dimension>('archetype');
  const rows = useMemo(() => breakdown(run, code, dim, personas), [run, code, dim, personas]);
  const arm = DIMENSION_ARM[dim];
  const color = (key: string) => (dim === 'archetype' ? archColor(key) : dim === 'model' ? AI_COLOR : HUMAN_COLOR);
  const byType = useMemo(() => breakdown(run, code, 'archetype', personas), [run, code, personas]);
  const top = byType.find((r) => r.picked > 0);
  return (
    <Fold q="who takes it?" a={top ? `${archLabel(top.key)} shoppers buy it most: ${top.picked} of ${top.shown}.` : 'nobody has bought it yet. these types walk past it most.'}
      viz={<MiniBars scale={top ? 1 : undefined} color={HUMAN_COLOR} empty="no shopper passed it." rows={(top ? byType : [...byType].sort((x, y) => y.shown - x.shown)).slice(0, 4).map((r) => (
        { key: r.key, label: archLabel(r.key), value: top ? r.rate : r.shown, right: top ? `${pct(r.rate)} · ${r.picked}/${r.shown}` : `${r.shown} passed` }))} />}>
      <div className="seg small">
        {DIMENSIONS.map((d) => <button key={d.key} className={`seg-btn ${dim === d.key ? 'on' : ''}`} onClick={() => setDim(d.key)}>by {d.label}</button>)}
      </div>
      <div className="ins-bd-head"><span>{DIMENSIONS.find((d) => d.key === dim)?.label}</span><span>pick rate · 95% ci</span><span>picked / shown</span></div>
      {rows.map((r) => (
        <div key={r.key} className={r.thin ? 'ins-thin' : ''} title={r.thin ? `only ${r.shown} shown: too few to read (under ${LOW_N_ROW})` : undefined}>
          <Bar label={dimLabel(dim, r.key)} value={r.rate} ci={r.ci95} color={color(r.key)} right={`${pct(r.rate)} · ${r.picked}/${r.shown}${r.thin ? ' · thin' : ''}`} />
        </div>
      ))}
      {!rows.length && (
        <p className="muted">
          {arm === 'ai' ? (aiLoaded ? 'no ai agent saw this product in a feed.' : 'no ai arm loaded: pick one in the "+ ai arm" picker to see pick rate by model.') : 'no human shopper passed this product.'}
        </p>
      )}
      <p className="why">
        rows under {LOW_N_ROW} shoppers are greyed.
        {dim === 'ocean' && ' each shopper counts once per trait; 0.5 or more is high.'}
      </p>
    </Fold>
  );
}

interface LostListProps { lost: LostTo; arm: InsightArm; products: Record<string, Product>; onPickProduct: (code: string) => void }
function LostList({ lost, arm, products, onPickProduct }: LostListProps) {
  const who = arm === 'ai' ? 'ai agent session' : 'human shopper';
  const where = arm === 'ai' ? 'feed' : 'unit';
  if (!lost.denominator) return <p className="muted">no {who} noticed this product without picking it.</p>;
  return (
    <>
      <p className="why">of {lost.denominator} who {arm === 'ai' ? 'saw' : 'noticed'} it and didn't pick it.</p>
      {lost.rows.map((r) => {
        const rp = products[r.code];
        return (
          <button key={r.code} className="ins-row" onClick={() => onPickProduct(r.code)}>
            <span className="cmp-name"><span className="sw" style={{ background: rp?.color || catColor(rp?.category ?? '') }} />{prodLabel(rp, r.code)}</span>
            <span className="cmp-bar"><i style={{ width: `${r.share * 100}%`, background: arm === 'ai' ? AI_COLOR : HUMAN_COLOR }} /><em>{pct(r.share)}</em></span>
            <span className="ins-count">{r.count}</span>
          </button>
        );
      })}
      <p className="why">{lost.none} picked nothing else in the {where}.</p>
    </>
  );
}

interface LostToProps { run: Run; code: string; products: Record<string, Product>; aiLoaded: boolean; onPickProduct: (code: string) => void }
function LostToSection({ run, code, products, aiLoaded, onPickProduct }: LostToProps) {
  const human = useMemo(() => lostTo(run, code, 'human'), [run, code]);
  const ai = useMemo(() => lostTo(run, code, 'ai'), [run, code]);
  return (
    <Fold q="what do they buy instead?"
      a={human.rows[0] ? `${human.rows[0].count} of ${human.denominator} who skipped it bought ${products[human.rows[0].code]?.brand || 'this'} instead.` : 'shoppers who skipped it bought nothing else nearby.'}
      viz={<MiniBars scale={1} color={HUMAN_COLOR} empty="no rival picked up its shoppers." rows={human.rows.slice(0, 4).map((r) => (
        { key: r.code, label: prodLabel(products[r.code], r.code), value: r.share, right: `${pct(r.share)} · ${r.count}` }))} />}>
      <LostList lost={human} arm="human" products={products} onPickProduct={onPickProduct} />
      <h4 className="ins-sub">ai agents</h4>
      {aiLoaded ? <LostList lost={ai} arm="ai" products={products} onPickProduct={onPickProduct} /> : <p className="muted">no ai arm loaded.</p>}
    </Fold>
  );
}

interface RejectListProps { rej: Rejections; personas: Record<string, Persona>; onTrace: (agentId: string, step: number) => void }
function RejectList({ rej, personas, onTrace }: RejectListProps) {
  const [all, setAll] = useState(false);
  return (
    <>
      {rej.groups.slice(0, all ? undefined : 4).map((g) => (
        <div key={g.mechanism} className="reason-group">
          <div className="reason-head"><Sticker tone="bad">{mechLabel(g.mechanism)}</Sticker> <span className="muted">×{g.items.length} of {rej.total}</span></div>
          {g.items.slice(0, all ? undefined : 3).map(({ agent, event }) => (
            <button key={agent.agent_id + event.step} className="quote" onClick={() => onTrace(agent.agent_id, event.step)}>
              <span className="dot" style={{ background: archColor(archetypeOf(agent, personas)) }} />
              “{event.reason || 'no reason logged'}” <span className="muted">— {isAI(agent) ? agent.model : personas[agent.persona_id]?.name ?? agent.persona_id} · trace →</span>
            </button>
          ))}
        </div>
      ))}
      {(rej.groups.length > 4 || rej.groups.some((g) => g.items.length > 3)) && (
        <button className="link-btn" onClick={() => setAll((v) => !v)}>{all ? 'show fewer' : `show all ${rej.total} quotes`}</button>
      )}
    </>
  );
}

interface RejectProps { run: Run; code: string; personas: Record<string, Persona>; onTrace: (agentId: string, step: number) => void }
function RejectSection({ run, code, personas, onTrace }: RejectProps) {
  const human = useMemo(() => rejections(run, code, 'human'), [run, code]);
  const ai = useMemo(() => rejections(run, code, 'ai'), [run, code]);
  return (
    <Fold q="why do they put it back?"
      a={human.groups[0] ? <>“{human.groups[0].items[0]?.event.reason || mechLabel(human.groups[0].mechanism)}”</> : 'nobody picked it up and put it back.'}
      viz={<MiniBars color="var(--bad)" empty="no rejections in this run." rows={human.groups.slice(0, 4).map((g) => (
        { key: g.mechanism, label: mechLabel(g.mechanism), value: g.items.length, right: `${g.items.length} of ${human.total}` }))} />}>
      {human.total > 0 ? <RejectList rej={human} personas={personas} onTrace={onTrace} /> : <p className="muted">no shopper put it back with a reason in this run.</p>}
      {human.secondary > 0 && <p className="why">{plural(human.secondary, 'more rejection')} left out: the shopper was looking at something else.</p>}
      {ai.total > 0 && (
        <>
          <h4 className="ins-sub">ai agents <span className="muted">({plural(ai.total, 'rejection')})</span></h4>
          <RejectList rej={ai} personas={personas} onTrace={onTrace} />
        </>
      )}
    </Fold>
  );
}

interface NeighbourProps {
  codes: string[]; me: string; slot?: string; human: Record<string, Funnel>;
  products: Record<string, Product>; onPickProduct: (code: string) => void;
}
function NeighbourSection({ codes, me, slot, human, products, onPickProduct }: NeighbourProps) {
  const mine = human[me]?.pick_rate ?? 0;
  const ahead = codes.filter((c) => (human[c]?.pick_rate ?? 0) > mine).length;
  const level = codes.filter((c) => c !== me && (human[c]?.pick_rate ?? 0) === mine).length;
  const answer = !codes.includes(me) ? 'not on a shelf'
    : !human[me]?.shown ? 'no shopper passed it'
    : `${ahead + 1} of ${codes.length} on its shelf${level ? `, level with ${level}` : ''}`;
  return (
    <Fold q="how does it compare with its shelf?" a={answer} span={6}
      viz={<MiniBars color="var(--ink)" empty="it is not on a shelf in this plan." rows={codes.map((c) => (
        { key: c, label: prodLabel(products[c], c), value: human[c]?.pick_rate ?? 0, right: human[c]?.shown ? `${pct(human[c].pick_rate)} bought` : 'not passed', me: c === me }))} />}>
      {!codes.length && <p className="muted">this product is not on this shelf plan.</p>}
      {codes.length > 0 && (
        <table className="kv ins-table">
          <thead><tr><th>product</th><th>at shelf</th><th>noticed</th><th>picked (95% ci)</th><th>sentiment</th></tr></thead>
          <tbody>
            {codes.map((c) => {
              const f = human[c] ?? EMPTY_FUNNEL;
              return (
                <tr key={c} className={c === me ? 'is-me' : ''}>
                  <th>{c === me ? prodLabel(products[c], c) : <button className="link-btn" onClick={() => onPickProduct(c)}>{prodLabel(products[c], c)}</button>}</th>
                  <td>{f.shown}</td>
                  <td>{f.shown ? <>{pct(f.noticed / f.shown)} <span className="muted">({f.noticed}/{f.shown})</span></> : 'n/a'}</td>
                  <td>{f.shown ? <>{pct(f.pick_rate)} <span className="muted">({pct(f.ci95[0])}–{pct(f.ci95[1])}, {f.picked}/{f.shown})</span></> : 'n/a'}</td>
                  <td>{f.mean_sentiment === null ? 'n/a' : <>{signed(f.mean_sentiment)} <span className="muted">(n={f.sentiment_n})</span></>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="why">notice rate = noticed ÷ shown. pick rate = picked ÷ shown. sentiment runs −1 to +1, averaged over the events where the shopper gave one.</p>
    </Fold>
  );
}

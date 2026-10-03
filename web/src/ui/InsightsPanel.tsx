import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Persona, PlacementCandidate, Product, Run } from '../types';
import { api } from '../api';
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
import './insights.css';

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
  // the best spot for it, from the same free scan the placement section runs; null until it answers or if it fails
  const [best, setBest] = useState<{ spot: PlacementCandidate; now: number } | null>(null);
  const scanKey = `${p.code}|${slot ?? ''}|${run.run_id}`;
  useEffect(() => {
    let live = true;
    setBest(null);
    if (!slot) return;
    api.placementScan({ product: p.code, planogram, products: props.extraProducts, agents: 400 })
      .then((sc) => {
        const top = sc.candidates.filter((c) => !c.is_current && c.facings === sc.current.facings)[0];
        if (live && top && top.lift_vs_current > 0.005) setBest({ spot: top, now: sc.current.notice_rate });
      })
      .catch(() => { /* the placement section below shows the server error */ });
    return () => { live = false; };
    // planogram and extraProducts are fresh objects each render; the key covers what the scan depends on
  }, [scanKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const neverShown = own.shown === 0 && aiOwn.shown === 0;

  return (
    <aside className="card insights" aria-label={`product analytics for ${p.name}`}>
      <div className="ins-top">
        <button className="x" onClick={onClose} aria-label="close product analytics">×</button>
        <Head product={p} slot={slot} rowName={slot ? cfg.row_names[rowOf(slot)] : undefined} options={shelfOptions(planogram, products)} products={products} onPickProduct={onPickProduct} />
        <SampleLine sample={sample} run={run} />
      </div>
      {neverShown ? (
        <p className="notice">no shopper and no ai agent was shown this product in <code>{run.run_id}</code>, so there is nothing to count. pick another run in the run picker, or re-run the store with this product on the shelf.</p>
      ) : (
        <div className="ins-board">
          <Story own={own} ai={aiOwn} aiLoaded={sample.ai_loaded} d={diagnosis} unit={slot ? slot.split('-r')[0] : undefined}
            best={best} rowNames={cfg.row_names} topReject={diagnosis.top_reject} onRearrange={props.onRearrange}
            onPlacement={() => placementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          <BreakdownSection run={run} code={p.code} personas={personas} aiLoaded={sample.ai_loaded} />
          <LostToSection run={run} code={p.code} products={products} aiLoaded={sample.ai_loaded} onPickProduct={onPickProduct} />
          <RejectSection run={run} code={p.code} personas={personas} onTrace={onTrace} />
          <InterviewSection run={run} code={p.code} name={p.name} personas={personas} />
          <NeighbourSection codes={slotProducts(planogram, slot)} me={p.code} slot={slot} human={human} products={products} onPickProduct={onPickProduct} />
          <BehaviourSection run={run} code={p.code} name={p.name} personas={personas} />
        </div>
      )}
      <div ref={placementRef} className="ins-placement">
        <div className="ins-band">
          <h3 className="display">what to change</h3>
          <label className="toggle llm" title="off = mock heuristic, free. on = real llm calls via openrouter (costs money, cached). applies to the experiments below.">
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
  return (
    <>
      <p className="ins-sample">
        <b>{plural(s.human_shoppers, 'shopper')}</b> walked past it ·{' '}
        {s.ai_loaded ? <><b>{plural(s.ai_sessions, 'ai shopper')}</b> saw it</> : <span className="muted">no ai shoppers</span>}
        {run.mock ? ' · practice shoppers, not real results' : ''}
      </p>
      {!!run.cost?.errors && (
        <p className="notice">{plural(run.cost.errors, 'llm call')} failed in this run. the sim logs each as a walk-past with the reason "(llm error)"; they are not shopper decisions, so every count on this page leaves them out.</p>
      )}
      {s.ai_loaded && s.ai_sessions === 0 && (
        <p className="notice">no ai agent was shown this product, because no agent mission shops this category. that is a gap in the test, not a result.</p>
      )}
      {s.thin && s.human_shown > 0 && (
        <p className="notice">only {plural(s.human_shown, 'shopper')} passed it. that is too few to act on (we want {MIN_HUMAN_SHOWN}, an assumption). re-run with more shoppers.</p>
      )}
    </>
  );
}

const STEP_OF: Record<string, string> = { notice: 'noticed', consider: 'looked closer', pick: 'bought' };

interface StoryProps {
  own: Funnel; ai: Funnel; aiLoaded: boolean; d: Diagnosis; unit?: string; onPlacement: () => void;
  best: { spot: PlacementCandidate; now: number } | null; rowNames: Record<string, string>;
  topReject: Diagnosis['top_reject']; onRearrange?: () => void;
}
/** the whole page in one tile: did it sell, where it loses shoppers, and the four steps behind that */
function Story({ own, ai, aiLoaded, d, unit, onPlacement, best, rowNames, topReject, onRearrange }: StoryProps) {
  const text = diagnosisText(d);
  const [notice, consider, pick] = stepRates(own);
  const leak = d.bottleneck ? STEP_OF[d.bottleneck.step] : null;
  const steps = [
    { k: 'walked past', v: own.shown, rate: null as number | null, why: 'stood at its shelf' },
    { k: 'noticed', v: own.noticed, rate: notice.rate, why: 'of those who passed' },
    { k: 'looked closer', v: own.considered, rate: consider.rate, why: 'of those who noticed: picked it up or weighed it' },
    { k: 'bought', v: own.picked, rate: pick.rate, why: 'of those who considered' },
  ];
  return (
    <section className="tile t-12 ins-story" aria-label="summary">
      <p className="ins-headline">
        {own.shown ? <><b>{own.picked} of {own.shown}</b> shoppers who passed it bought it.</> : 'no shopper passed it in this run.'}
      </p>
      <p className="ins-diagnosis">{text.main}</p>
      <ol className="ins-steps">
        {steps.map((st) => (
          <li key={st.k} className={`ins-step ${leak === st.k ? 'is-leak' : ''}`} title={st.why}>
            <b>{st.v}</b>
            <span>{st.k}</span>
            {st.rate !== null && <i>{pct(st.rate)}</i>}
            {leak === st.k && <em>drops here</em>}
          </li>
        ))}
      </ol>
      {aiLoaded && ai.shown > 0 && <p className="ins-ai">ai agents picked it <b>{ai.picked} of {ai.shown}</b> times.</p>}
      <div className="ins-next">
        <h3>do this next</h3>
        <ol>
          {best && (
            <li>
              <span><b>move it to the {rowNames[String(best.spot.row)] ?? best.spot.row_name} shelf, spot {best.spot.pos + 1}.</b> noticed by {pct(best.spot.notice_rate)} there, {pct(best.now)} now.</span>
              <button className="btn btn-white" onClick={onPlacement}>test this spot</button>
            </li>
          )}
          {topReject && (
            <li>
              <span><b>answer "{mechLabel(topReject.mechanism)}".</b> it is the top reason shoppers put it back ({topReject.count}). try a new price or a claim.</span>
              <button className="btn btn-white" onClick={onPlacement}>try a fix</button>
            </li>
          )}
          {onRearrange && (
            <li>
              <span><b>rearrange its whole shelf.</b> see where every product in this unit would sell best.</span>
              <button className="btn btn-white" onClick={onRearrange}>rearrange</button>
            </li>
          )}
        </ol>
      </div>
      <details className="ins-how">
        <summary>how this was decided</summary>
        <p>
          shoppers only. three steps: noticed ÷ passed, considered ÷ noticed, bought ÷ considered. each is compared with the median of the other products in unit {unit ?? '?'}; the step furthest below is where it loses shoppers.
          pick rate {pct(own.pick_rate)}, 95% ci {pct(own.ci95[0])}–{pct(own.ci95[1])}. {own.walk_past} walked past, {own.rejected} put it back.
          {text.arm && <> {text.arm}</>}
        </p>
        <table className="kv ins-table">
          <thead><tr><th>step</th><th>this product</th><th>unit median</th><th>gap</th></tr></thead>
          <tbody>
            {d.gaps.map((g) => (
              <tr key={g.step} className={d.bottleneck?.step === g.step ? 'is-me' : ''}>
                <th>{g.step}</th>
                <td>{g.rate === null ? 'n/a' : pct(g.rate)} <span className="muted">({g.k}/{g.n})</span></td>
                <td>{g.unit_median === null ? 'n/a' : pct(g.unit_median)} <span className="muted">({plural(g.peers, 'neighbour')})</span></td>
                <td>{g.gap_pts === null ? 'n/a' : `${g.gap_pts > 0 ? '−' : '+'}${Math.abs(Math.round(g.gap_pts))} pts`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

interface MiniRow { key: string; label: string; value: number; right: string; me?: boolean }
/** up to four bars, scaled to the largest, so a tile shows its answer without being opened */
function MiniBars({ rows, color, empty }: { rows: MiniRow[]; color?: string; empty: string }) {
  if (!rows.length) return <p className="q-empty muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
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
function Fold({ q, a, viz, span = 4, children }: { q: string; a?: ReactNode; viz?: ReactNode; span?: 4 | 6; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`tile ${open ? 't-12' : `t-${span}`} qtile`}>
      <h3>{q}</h3>
      {viz}
      {a && <p className="q-take">{a}</p>}
      <button className="link-btn q-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'show less' : 'see all'}</button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}

const secs = (x: number | null) => (x === null ? '–' : `${x.toFixed(1)}s`);

function BehaviourSection({ run, code, name, personas }: { run: Run; code: string; name: string; personas: Record<string, Persona> }) {
  const b = useMemo(() => behaviour(run, code, personas), [run, code, personas]);
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([behaviourCsv(b.rows)], { type: 'text/csv' }));
    a.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-shopper-log.csv`; a.click();
  };
  const per100 = (x: number | null) => (x === null ? '–' : x.toFixed(1));
  const share = (f: { k: number; n: number } | null) => (f ? <><b>{pct(f.k / f.n)}</b> <span className="muted">{f.k} of {f.n} who noticed it</span></> : <span className="muted">not logged on mock</span>);
  return (
    <Fold q="how do shoppers behave at it?" span={6} a={`${b.rows.length} shoppers logged, one row each. download them as a csv under "see all".`}
      viz={(
        <div className="q-stats">
          <div><b>{per100(b.buys_per_100_visits)}</b><span>buys per 100 store visits</span></div>
          <div><b>{secs(b.seconds.walk_past.mean)}</b><span>at the shelf, walked past</span></div>
          <div><b>{secs(b.seconds.reject.mean)}</b><span>at the shelf, put it back</span></div>
        </div>
      )}>
      <button className="btn btn-white ins-dl" onClick={download} disabled={!b.rows.length}>download csv</button>
      <div className="beh-stats">
        <div><span className="kpi-l">buying frequency</span><b className="beh-n">{per100(b.buys_per_100_visits)}</b><span className="kpi-s">buys per 100 store visits · {b.store_shoppers} visits</span></div>
        <div><span className="kpi-l">per shelf pass</span><b className="beh-n">{per100(b.buys_per_100_passes)}</b><span className="kpi-s">buys per 100 at the shelf</span></div>
        <div><span className="kpi-l">time at shelf (buyers)</span><b className="beh-n">{secs(b.seconds.pick.mean)}</b><span className="kpi-s">n={b.seconds.pick.n} · walked past {secs(b.seconds.walk_past.mean)} (n={b.seconds.walk_past.n}) · put back {secs(b.seconds.reject.mean)} (n={b.seconds.reject.n})</span></div>
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
    <Fold q="who buys it?" a={top ? `${archLabel(top.key)} shoppers buy it most: ${top.picked} of ${top.shown}.` : 'nobody has bought it yet. these types walk past it most.'}
      viz={<MiniBars color={HUMAN_COLOR} empty="no shopper passed it." rows={(top ? byType : [...byType].sort((x, y) => y.shown - x.shown)).slice(0, 4).map((r) => (
        { key: r.key, label: archLabel(r.key), value: top ? r.rate : r.shown, right: top ? `${r.picked} of ${r.shown}` : `${r.shown} passed` }))} />}>
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
      viz={<MiniBars color={HUMAN_COLOR} empty="no rival picked up its shoppers." rows={human.rows.slice(0, 4).map((r) => (
        { key: r.code, label: prodLabel(products[r.code], r.code), value: r.share, right: `${r.count}` }))} />}>
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

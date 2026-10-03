import { useMemo, useRef, useState } from 'react';
import type { Persona, Product, Run } from '../types';
import { isAI } from '../types';
import { archetypeOf, pct } from '../stats';
import {
  ARM_GAP, DIMENSION_ARM, EMPTY_FUNNEL, LOW_N_ROW, MIN_HUMAN_SHOWN,
  breakdown, diagnose, diagnosisText, funnels, lostTo, mechLabel, rejections, rowOf, sampleSize, shelfOptions,
  slotOfProduct, slotProducts, stepRates, unitProducts,
  type Diagnosis, type Dimension, type Funnel, type InsightArm, type LostTo, type Rejections, type SampleSize,
} from '../insights';
import { AI_COLOR, DECISION, archColor, archLabel, catColor, catLabel, prodLabel } from '../theme';
import { Bar, Sticker } from './bits';
import type { InsightsProps } from './featureProps';
import { PlacementSection } from './PlacementSection';
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
          <KpiRow own={own} ai={aiOwn} aiLoaded={sample.ai_loaded} d={diagnosis} />
          <DiagnosisSection d={diagnosis} unit={slot ? slot.split('-r')[0] : undefined} onPlacement={() => placementRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          <FunnelSection f={own} />
          <BreakdownSection run={run} code={p.code} personas={personas} aiLoaded={sample.ai_loaded} />
          <LostToSection run={run} code={p.code} products={products} aiLoaded={sample.ai_loaded} onPickProduct={onPickProduct} />
          <RejectSection run={run} code={p.code} personas={personas} onTrace={onTrace} />
          <NeighbourSection codes={slotProducts(planogram, slot)} me={p.code} slot={slot} human={human} products={products} onPickProduct={onPickProduct} />
        </div>
      )}
      <div ref={placementRef} className="ins-placement">
        <div className="ins-band">
          <h3 className="display">make it sell</h3>
          <label className="toggle llm" title="off = mock heuristic, free. on = real llm calls via openrouter (costs money, cached). applies to the experiments below.">
            <input type="checkbox" checked={props.useLLM} onChange={(e) => props.onUseLLM(e.target.checked)} /> use llm (costs)
          </label>
        </div>
        <PlacementSection product={p} slot={slot} planogram={planogram} cfg={cfg} products={products} extraProducts={props.extraProducts}
          useLLM={props.useLLM} busy={props.busy} onApplyPlanogram={props.onApplyPlanogram} />
      </div>
      <footer className="prov">
        every number above the placement section is counted in your browser from the events in <code>{run.run_id}</code> that touched <code>{p.code}</code> ({own.shown} shelf events from human shoppers, {aiOwn.shown} feed events from ai agents; the two are never added together). 95% ci is wilson (1927).
        assumptions: {MIN_HUMAN_SHOWN} shelf passes as the "too thin" line, {pct(ARM_GAP)} as the human vs ai gap worth a sentence, {LOW_N_ROW} shown as the grey-out line for a breakdown row.
      </footer>
    </aside>
  );
}

interface HeadProps {
  product: Product; slot?: string; rowName?: string; options: ReturnType<typeof shelfOptions>;
  products: Record<string, Product>; onPickProduct: (code: string) => void;
}
function Head({ product: p, slot, rowName, options, products, onPickProduct }: HeadProps) {
  const mine = options.filter((o) => o.brand_supplied), rest = options.filter((o) => !o.brand_supplied);
  const opt = (o: (typeof options)[number]) => <option key={o.code} value={o.code}>{prodLabel(products[o.code], o.code)} · {o.slot}</option>;
  return (
    <header className="prod-head ins-head">
      <div className="prod-thumb" style={{ background: p.color || catColor(p.category) }}>
        {p.image ? <img src={p.image} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : <span>{(p.brand || '?').slice(0, 2)}</span>}
      </div>
      <div className="ins-head-main">
        <div className="eyebrowless muted">product analytics · {catLabel(p.category)}</div>
        <h2 className="display">{p.brand} <span className="thin">{p.brand && p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? p.name.slice(p.brand.length).trim() : p.name}</span></h2>
        <div className="chips">
          {p.brand_supplied && <Sticker tone="yellow" title="typed in by the brand; not checked against open food facts">brand-supplied, unverified</Sticker>}
          <Sticker title="where it sits in this planogram">{slot ? `${slot}${rowName ? ` · ${rowName} row` : ''}` : 'not on the shelf'}</Sticker>
          <Sticker title={p.price_source}>£{Number(p.price_gbp).toFixed(2)}</Sticker>
        </div>
        <label className="select ins-select">
          <span>product</span>
          <select value={p.code} onChange={(e) => onPickProduct(e.target.value)} aria-label="switch product">
            {!options.some((o) => o.code === p.code) && <option value={p.code}>{prodLabel(p, p.code)} · not on the shelf</option>}
            {mine.length > 0 && <optgroup label="brand-supplied">{mine.map(opt)}</optgroup>}
            <optgroup label={`on the shelf (${rest.length})`}>{rest.map(opt)}</optgroup>
          </select>
        </label>
      </div>
    </header>
  );
}

function SampleLine({ sample: s, run }: { sample: SampleSize; run: Run }) {
  return (
    <>
      <p className="ins-sample">
        <b>{plural(s.human_shoppers, 'human shopper')}</b> passed this product ({plural(s.human_shown, 'shelf event')}) ·{' '}
        {s.ai_loaded ? <><b>{plural(s.ai_sessions, 'ai agent session')}</b> saw it in a feed</> : <span className="muted">no ai arm loaded</span>} ·{' '}
        run <code>{run.run_id}</code>{run.mock ? ' (mock heuristic, not an llm)' : ''}
      </p>
      {!!run.cost?.errors && (
        <p className="notice">{plural(run.cost.errors, 'llm call')} failed in this run. each one is logged as a walk-past with the reason "(llm error)", so the walk-past counts below are inflated by that much.</p>
      )}
      {s.ai_loaded && s.ai_sessions === 0 && (
        <p className="notice">no ai agent was shown this product: none of the agent missions in <code>sim/agent_shopper.py</code> shops this category, so it never appeared in a feed. that is a gap in the test, not a result.</p>
      )}
      {s.thin && s.human_shown > 0 && (
        <p className="notice">only {plural(s.human_shown, 'human shelf pass', 'human shelf passes')}: the numbers below are too thin to act on. we ask for at least {MIN_HUMAN_SHOWN} (an assumption, not a sourced threshold). re-run with more shoppers.</p>
      )}
    </>
  );
}

/** gap_pts is unit median minus this product, so a positive gap means this product is behind */
function Versus({ gap, of }: { gap: number | null | undefined; of: string }) {
  if (gap === null || gap === undefined) return <span className="kpi-vs is-flat">no {of} to compare</span>;
  const n = Math.round(Math.abs(gap));
  if (n < 1) return <span className="kpi-vs is-flat">level with {of}</span>;
  return <span className={`kpi-vs ${gap > 0 ? 'is-down' : 'is-up'}`}>{gap > 0 ? '▼' : '▲'} {n} pts vs {of}</span>;
}

function KpiRow({ own, ai, aiLoaded, d }: { own: Funnel; ai: Funnel; aiLoaded: boolean; d: Diagnosis }) {
  const [notice, consider] = stepRates(own);
  const gap = (step: string) => d.gaps.find((g) => g.step === step)?.gap_pts;
  const rate = (r: number | null) => (r === null ? '–' : pct(r));
  return (
    <div className="ins-kpis">
      <div className="kpi is-hero">
        <span className="kpi-l">picked it</span>
        <span className="kpi-n">{own.shown ? pct(own.pick_rate) : '–'}</span>
        <span className="kpi-s">{own.picked} of {own.shown} shoppers who stood at it · 95% ci {pct(own.ci95[0])}–{pct(own.ci95[1])}</span>
      </div>
      <div className="kpi">
        <span className="kpi-l">noticed it</span>
        <span className="kpi-n">{rate(notice.rate)}</span>
        <span className="kpi-s">{notice.k} of {notice.n} who stood at it</span>
        <Versus gap={gap('notice')} of="unit median" />
      </div>
      <div className="kpi">
        <span className="kpi-l">weighed it up</span>
        <span className="kpi-n">{rate(consider.rate)}</span>
        <span className="kpi-s">{consider.k} of {consider.n} who noticed it picked or rejected it</span>
        <Versus gap={gap('consider')} of="unit median" />
      </div>
      <div className="kpi is-ai">
        <span className="kpi-l">ai agents picked it</span>
        <span className="kpi-n">{aiLoaded && ai.shown ? pct(ai.pick_rate) : '–'}</span>
        <span className="kpi-s">{aiLoaded ? `${ai.picked} of ${ai.shown} feed views` : 'no ai arm loaded'}</span>
        {aiLoaded && ai.shown > 0 && own.shown > 0 && <Versus gap={(own.pick_rate - ai.pick_rate) * 100} of="human shoppers" />}
      </div>
    </div>
  );
}

function DiagnosisSection({ d, unit, onPlacement }: { d: Diagnosis; unit?: string; onPlacement: () => void }) {
  const text = diagnosisText(d);
  return (
    <section className="tile t-12 ins-diag">
      <span className="chip chip-ink">diagnosis</span>
      <p className="ins-diagnosis">{text.main}</p>
      {text.arm && <p className="ins-diagnosis ins-arm">{text.arm}</p>}
      {d.bottleneck?.step === 'notice' && <button className="link-btn" onClick={onPlacement}>go to the placement search ↓</button>}
      <details className="ins-how">
        <summary>how we decided</summary>
        <p>
          human shoppers only. three step conversions: notice = noticed ÷ shown, consider = (picked + rejected) ÷ noticed, pick = picked ÷ considered.
          for each step we take the median over the other products in unit {unit ?? '?'}, and the step where this product sits furthest below that median, in percentage points, is the bottleneck.
          notice → placement. consider → pack copy or claim. pick → price or ingredients. no step below the median → at or above its neighbours.
          the ai sentence appears only when the ai and human pick rates differ by {pct(ARM_GAP)} or more (an assumption).
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

function FunnelSection({ f }: { f: Funnel }) {
  const [notice, consider, pick] = stepRates(f);
  const rows = [
    { k: 'shown', v: f.shown, why: 'a shopper stood at this slot', prev: null },
    { k: 'noticed', v: f.noticed, why: 'the p_notice roll succeeded', prev: { ...notice, of: 'shown' } },
    { k: 'considered', v: f.considered, why: 'picked or actively rejected', prev: { ...consider, of: 'noticed' } },
    { k: 'picked', v: f.picked, why: 'went in the basket', prev: { ...pick, of: 'considered' } },
  ];
  const max = Math.max(1, f.shown);
  return (
    <section className="tile t-7">
      <h3>funnel <span className="muted">(human shoppers)</span></h3>
      {f.shown === 0 && <p className="muted">no human shopper passed this product in this run; only the ai arm saw it.</p>}
      <div className="fn">
        {rows.map((r) => (
          <div key={r.k} className={`fn-step fn-${r.k}`} title={r.why}>
            <div className="fn-label"><b>{r.v}</b> {r.k}</div>
            <div className="fn-track"><div className="fn-fill" style={{ width: `${(r.v / max) * 100}%` }} /></div>
            <div className="fn-conv">
              {r.prev ? (r.prev.rate === null ? `no ${r.prev.of} to convert` : <><b>{pct(r.prev.rate)}</b> of {r.prev.of} <span className="ins-drop">−{r.prev.n - r.prev.k}</span></>) : 'stood at the shelf'}
            </div>
          </div>
        ))}
      </div>
      <div className="fn-out">
        <span className="chip" style={{ background: DECISION.walk_past.color }}>{f.walk_past} walked past</span>
        <span className="chip chip-bad">{f.rejected} put it back</span>
        <span className="muted small">of {f.shown} shown · pick rate = {f.picked} ÷ {f.shown}</span>
      </div>
    </section>
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
  return (
    <section className="tile t-5">
      <h3>breakdowns <span className="muted">({arm === 'ai' ? 'ai agents, feed views' : 'human shoppers, shelf passes'})</span></h3>
      <div className="seg small">
        {DIMENSIONS.map((d) => <button key={d.key} className={`seg-btn ${dim === d.key ? 'on' : ''}`} onClick={() => setDim(d.key)}>by {d.label}</button>)}
      </div>
      <div className="ins-bd-head"><span>{DIMENSIONS.find((d) => d.key === dim)?.label}</span><span>pick rate, line = 95% ci</span><span>picked / shown</span></div>
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
        sorted by pick rate. pick rate = picked ÷ shown within the row. rows with fewer than {LOW_N_ROW} shown are greyed.
        {dim === 'ocean' && ' each shopper counts in five rows, one per trait; a trait of 0.5 or more is high, as sim/run.py does.'}
      </p>
    </section>
  );
}

interface LostListProps { lost: LostTo; arm: InsightArm; products: Record<string, Product>; onPickProduct: (code: string) => void }
function LostList({ lost, arm, products, onPickProduct }: LostListProps) {
  const who = arm === 'ai' ? 'ai agent session' : 'human shopper';
  const where = arm === 'ai' ? 'feed' : 'unit';
  if (!lost.denominator) return <p className="muted">no {who} noticed this product without picking it.</p>;
  return (
    <>
      <p className="why">of {plural(lost.denominator, who)} who {arm === 'ai' ? 'saw' : 'noticed'} it and did not pick it. share = count ÷ {lost.denominator}; shares can add to more than 100% when one shopper picks two rivals.</p>
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
      <p className="why">{lost.none} of {lost.denominator} picked nothing else in the same {where}.</p>
    </>
  );
}

interface LostToProps { run: Run; code: string; products: Record<string, Product>; aiLoaded: boolean; onPickProduct: (code: string) => void }
function LostToSection({ run, code, products, aiLoaded, onPickProduct }: LostToProps) {
  const human = useMemo(() => lostTo(run, code, 'human'), [run, code]);
  const ai = useMemo(() => lostTo(run, code, 'ai'), [run, code]);
  return (
    <section className="tile t-6">
      <h3>lost to <span className="muted">(same unit)</span></h3>
      <LostList lost={human} arm="human" products={products} onPickProduct={onPickProduct} />
      <h4 className="ins-sub">ai agents <span className="muted">(same feed)</span></h4>
      {aiLoaded ? <LostList lost={ai} arm="ai" products={products} onPickProduct={onPickProduct} /> : <p className="muted">no ai arm loaded.</p>}
    </section>
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
    <section className="tile t-6">
      <h3>why they put it back <span className="muted">({plural(human.total, 'human rejection')})</span></h3>
      {human.total > 0 ? <RejectList rej={human} personas={personas} onTrace={onTrace} /> : <p className="muted">no human shopper rejected it with a reason of their own in this run.</p>}
      {human.secondary > 0 && <p className="why">{plural(human.secondary, 'more rejection')} left out: the shopper's attention went to another product, so there is no reason about this one.</p>}
      {ai.total > 0 && (
        <>
          <h4 className="ins-sub">ai agents <span className="muted">({plural(ai.total, 'rejection')})</span></h4>
          <RejectList rej={ai} personas={personas} onTrace={onTrace} />
        </>
      )}
    </section>
  );
}

interface NeighbourProps {
  codes: string[]; me: string; slot?: string; human: Record<string, Funnel>;
  products: Record<string, Product>; onPickProduct: (code: string) => void;
}
function NeighbourSection({ codes, me, slot, human, products, onPickProduct }: NeighbourProps) {
  return (
    <section className="tile t-12">
      <h3>against its shelf neighbours <span className="muted">({slot ?? 'no slot'} · human shoppers)</span></h3>
      {!codes.length && <p className="muted">this product is not in a slot of this planogram, so it has no shelf neighbours.</p>}
      {codes.length > 0 && (
        <table className="kv ins-table">
          <thead><tr><th>product</th><th>shown</th><th>notice rate</th><th>pick rate (95% ci)</th><th>mean sentiment</th></tr></thead>
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
    </section>
  );
}

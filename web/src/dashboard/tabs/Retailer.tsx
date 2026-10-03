import { useMemo, useState } from 'react';
import { useJSON } from '../lib/data';
import { S, urlsIn } from '../lib/src';
import { gbp, human, num, signedPct } from '../lib/stats';
import { Card, ErrorBox, Ext, FootSrc, Loading, Seg, Sticker } from '../ui/bits';

type Rel = { before: number; after: number; rel: number; rel_ci95: [number, number] };
type Summary = { created: string; cli: string; summary: Record<string, Record<string, Rel>> };
type Metric = { before: number; after: number; delta: number; rel_change: number; before_ci95: number[]; after_ci95: number[]; delta_ci95: number[]; rel_change_ci95: number[] };
type Diff = {
  kind: 'product_move' | 'category_move'; text: string; code?: string; name?: string; category?: string;
  from: { slot: string; unit: string; row: number } | string; to: { slot: string; unit: string; row: number } | string[];
  delta_rev_per_100?: number; delta_takes_per_100?: number;
  trace: { price_gbp?: number; price_source?: string; off_url?: string; formula?: string; leave_one_out?: { d_revenue_per_shopper: number; d_walk_m: number; d_challenger_looks: number; d_found: number; vs_swap_back: string }; mission_source?: string; walk_model?: string };
};
type Report = {
  objective: string; objective_definition: Record<string, unknown> & { weights: Record<string, number>; weight_sources: Record<string, string>; value_before: number; value_after: number };
  metrics_units: Record<string, string>; metrics: Record<string, Metric> & { _method: string }; metrics_layout_only_no_endcaps: Record<string, Metric>;
  diff: Diff[]; endcaps: { chosen: Record<string, { code: string; name: string; hfss: boolean }> };
  constraints: { hfss: { regs: { name: string; url: string; rule: string }; compliant: boolean; violations: unknown[]; method: { name: string; approximation: string } }; fridge_units: string[] };
  search: { iters: number; schedule: string; seed: number };
};

const OBJ = [
  { id: 'retailer', label: 'retailer' },
  { id: 'ease', label: 'shopper ease' },
  { id: 'blended', label: 'blended' },
] as const;
type Obj = (typeof OBJ)[number]['id'];
const METRICS: { k: string; label: string; good: 'up' | 'down'; fmt: (x: number) => string }[] = [
  { k: 'revenue', label: 'revenue per shopper', good: 'up', fmt: (x) => gbp(x) },
  { k: 'challenger_looks', label: 'challenger products looked at', good: 'up', fmt: (x) => num(x, 1) },
  { k: 'walk_m', label: 'metres walked for the mission', good: 'down', fmt: (x) => `${num(x, 1)} m` },
  { k: 'found', label: 'wanted products seen', good: 'up', fmt: (x) => `${num(x * 100, 0)}%` },
];
const SF = 'data/sim/layout/summary.json';

export default function Retailer() {
  const sum = useJSON<Summary>('layout/summary.json');
  const [obj, setObj] = useState<Obj>('blended');
  const rep = useJSON<Report>(`layout/report_${obj}.json`);
  if (sum.loading) return <Loading what="layout optimiser results" />;
  if (sum.error) return <ErrorBox error={sum.error} hint={<>run <code>python3 sim/layout_optimise.py --objective all</code>, then <code>node web/scripts/sync-dashboard.mjs</code>.</>} />;
  const s = sum.data!;
  return (
    <div className="d-stack">
      <p className="d-lede">
        the whole-store layout optimiser moves categories and products between shelves to serve two goals: <b>the retailer</b> (revenue and challenger exposure) and <b>the shopper</b> (shorter mission walks, wanted products where they look). it respects fridges and the UK HFSS placement rules.
      </p>
      <Card title="three objectives, side by side" sub={<>relative change vs today's layout, with 95% CI. <code>{s.cli}</code></>}
        foot={<FootSrc items={[[SF, 'summary.<objective>.<metric>.rel, rel_ci95']]} />}>
        <div className="d-matrix" role="table">
          <div className="d-matrix-row is-head" role="row"><span role="columnheader">objective</span>{METRICS.map((m) => <span key={m.k} role="columnheader">{m.label}</span>)}</div>
          {OBJ.map((o) => (
            <button key={o.id} className={`d-matrix-row ${obj === o.id ? 'is-on' : ''}`} role="row" onClick={() => setObj(o.id)}>
              <span className="d-matrix-name" role="rowheader">{o.label}</span>
              {METRICS.map((m) => {
                const r = s.summary[o.id]?.[m.k];
                if (!r) return <span key={m.k}>—</span>;
                const good = m.good === 'up' ? r.rel_ci95[0] > 0 : r.rel_ci95[1] < 0;
                const bad = m.good === 'up' ? r.rel_ci95[1] < 0 : r.rel_ci95[0] > 0;
                return (
                  <span key={m.k} role="cell">
                    <S src={{ file: SF, field: `summary.${o.id}.${m.k}.rel_ci95`, note: `${m.fmt(r.before)} → ${m.fmt(r.after)}; rel ${signedPct(r.rel)} (95% CI ${signedPct(r.rel_ci95[0])} to ${signedPct(r.rel_ci95[1])}). ${good ? 'CI excludes 0: better.' : bad ? 'CI excludes 0: worse.' : 'CI crosses 0: no clear change.'}` }}>
                      <RelCell r={r} good={good} bad={bad} />
                    </S>
                  </span>
                );
              })}
            </button>
          ))}
        </div>
        <p className="d-caption">green = the 95% CI is entirely on the good side; red = entirely on the bad side (for walking, fewer metres is good); grey = the CI crosses zero.</p>
      </Card>

      {rep.loading ? <Loading what={`the ${obj} report`} /> : rep.error ? <ErrorBox error={rep.error} /> : rep.data ? <ReportView r={rep.data} obj={obj} /> : null}
    </div>
  );
}

function RelCell({ r, good, bad }: { r: Rel; good: boolean; bad: boolean }) {
  const span = 0.35;
  const x = (v: number) => `${50 + (Math.max(-span, Math.min(span, v)) / span) * 50}%`;
  return (
    <span className={`d-rel ${good ? 'is-good' : bad ? 'is-bad' : 'is-flat'}`}>
      <b>{signedPct(r.rel)}</b>
      <span className="d-rel-track">
        <span className="d-rel-zero" />
        <span className="d-rel-ci" style={{ left: x(r.rel_ci95[0]), width: `calc(${x(r.rel_ci95[1])} - ${x(r.rel_ci95[0])})` }} />
        <span className="d-rel-dot" style={{ left: x(r.rel) }} />
      </span>
      <small>{signedPct(r.rel_ci95[0], 0)} to {signedPct(r.rel_ci95[1], 0)}</small>
    </span>
  );
}

function ReportView({ r, obj }: { r: Report; obj: Obj }) {
  const RF = `data/sim/layout/report_${obj}.json`;
  const [kind, setKind] = useState<'all' | 'product_move' | 'category_move'>('all');
  const diffs = useMemo(() => r.diff.map((d, i) => ({ d, i })).filter(({ d }) => kind === 'all' || d.kind === kind)
    .sort((a, b) => (a.d.kind === b.d.kind ? (b.d.delta_rev_per_100 ?? 0) - (a.d.delta_rev_per_100 ?? 0) : a.d.kind === 'category_move' ? -1 : 1)), [r, kind]);
  const def = r.objective_definition;
  return (
    <>
      <div className="d-kpis">
        {[...METRICS, { k: 'takes', label: 'items taken per shopper', good: 'up' as const, fmt: (x: number) => num(x, 2) }].map((m) => {
          const v = r.metrics[m.k] as Metric | undefined;
          if (!v) return null;
          const good = m.good === 'up' ? v.delta_ci95[0] > 0 : v.delta_ci95[1] < 0;
          return (
            <div key={m.k} className="d-card d-kpi">
              <span className="d-kpi-label">{m.label}</span>
              <div className="d-kpi-vals">
                <S src={{ file: RF, field: `metrics.${m.k}.before`, note: `today's layout. 95% CI ${m.fmt(v.before_ci95[0])}–${m.fmt(v.before_ci95[1])}. unit: ${r.metrics_units[m.k] || ''}` }}><span className="d-kpi-before">{m.fmt(v.before)}</span></S>
                <span className="d-arrow" aria-hidden>→</span>
                <S src={{ file: RF, field: `metrics.${m.k}.after`, note: `optimised (${obj}). 95% CI ${m.fmt(v.after_ci95[0])}–${m.fmt(v.after_ci95[1])}` }}><span className="d-kpi-after">{m.fmt(v.after)}</span></S>
              </div>
              <S src={{ file: RF, field: `metrics.${m.k}.rel_change_ci95`, note: r.metrics._method }}>
                <span className={`d-kpi-delta ${good ? 'is-good' : 'is-flat'}`}>{signedPct(v.rel_change)} <small>CI {signedPct(v.rel_change_ci95[0], 0)} to {signedPct(v.rel_change_ci95[1], 0)}</small></span>
              </S>
              {r.metrics_layout_only_no_endcaps?.[m.k] ? (
                <S src={{ file: RF, field: `metrics_layout_only_no_endcaps.${m.k}.rel_change`, note: 'the same moves without the end-cap picks: how much of the gain is shelf layout alone' }}>
                  <small className="d-kpi-sub">layout alone {signedPct(r.metrics_layout_only_no_endcaps[m.k].rel_change)}</small>
                </S>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="d-two-wide">
        <Card title={`the moves (${r.diff.length})`} sub="every change the optimiser kept, with its reason. hover a number for the formula."
          right={<Seg label="filter moves" value={kind} onChange={setKind} options={[{ id: 'all', label: 'all' }, { id: 'category_move', label: 'categories' }, { id: 'product_move', label: 'products' }]} />}
          foot={<FootSrc items={[[RF, 'diff[]']]} />}>
          <ol className="d-moves">
            {diffs.map(({ d, i }) => <Move key={i} d={d} i={i} RF={RF} />)}
          </ol>
        </Card>
        <div className="d-stack">
          <Card title="what the optimiser maximises" foot={<FootSrc items={[[RF, 'objective_definition']]} />}>
            <ul className="d-defs">
              {(['retailer', 'ease', 'blended'] as const).map((k) => <li key={k}><b>{k}</b> <code>{String(def[k])}</code></li>)}
            </ul>
            <ul className="d-params">
              {Object.entries(def.weights).map(([k, v]) => (
                <li key={k}><span>{k}</span><S src={{ file: RF, field: `objective_definition.weights.${k}`, note: def.weight_sources[k] }}><b>{v}</b></S></li>
              ))}
              <li><span>objective value</span><S src={{ file: RF, field: 'objective_definition.value_after', note: 'normalised: today = 1.0' }}><b>{num(def.value_before, 2)} → {num(def.value_after, 3)}</b></S></li>
            </ul>
          </Card>
          <Card title="end-caps (HFSS-checked)" foot={<FootSrc items={[[RF, 'endcaps.chosen, constraints.hfss']]} />}>
            <ul className="d-endcaps">
              {Object.entries(r.endcaps.chosen).map(([k, e]) => (
                <li key={k}><code>{k}</code> <span>{e.name}</span> {e.hfss ? <Sticker tone="bad">HFSS</Sticker> : <Sticker tone="good">not HFSS</Sticker>}</li>
              ))}
            </ul>
            <p className="d-note">
              <S src={{ file: RF, field: 'constraints.hfss.compliant', note: `${r.constraints.hfss.regs.rule}. scoring: ${r.constraints.hfss.method.name}. ${r.constraints.hfss.method.approximation}`, url: r.constraints.hfss.regs.url }}>
                {r.constraints.hfss.compliant ? 'compliant' : 'NOT compliant'}
              </S>{' '}with <Ext href={r.constraints.hfss.regs.url}>{r.constraints.hfss.regs.name}</Ext>. fridges stay fridges: {r.constraints.fridge_units.join(', ')}.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}

function Move({ d, i, RF }: { d: Diff; i: number; RF: string }) {
  const [open, setOpen] = useState(false);
  const isCat = d.kind === 'category_move';
  const from = typeof d.from === 'string' ? d.from : d.from.slot;
  const to = Array.isArray(d.to) ? d.to.join(', ') : d.to.slot;
  const priceAsm = /^assumption/i.test(d.trace.price_source || '');
  const [head, ...rest] = d.text.split(/ because | vs swapping it back: /);
  return (
    <li className={`d-move ${isCat ? 'is-cat' : ''}`}>
      <div className="d-move-head">
        <Sticker tone={isCat ? 'ink' : 'white'}>{isCat ? 'category' : 'product'}</Sticker>
        <span className="d-move-name">{isCat ? human(d.category || '') : d.name}</span>
        <span className="d-move-path"><code>{from}</code> → <code>{to}</code></span>
        {d.delta_rev_per_100 !== undefined ? (
          <S src={{ file: RF, field: `diff[${i}].delta_rev_per_100`, note: `${d.trace.formula || ''}. price ${gbp(d.trace.price_gbp)} from ${d.trace.price_source || '—'}`, url: [d.trace.off_url, ...urlsIn(d.trace.price_source)], kind: priceAsm ? 'assumption' : undefined }}>
            <b className="d-move-delta">{d.delta_rev_per_100 >= 0 ? '+' : '−'}£{Math.abs(d.delta_rev_per_100).toFixed(2)}</b><small>/100 shoppers</small>
          </S>
        ) : d.trace.leave_one_out ? (
          <S src={{ file: RF, field: `diff[${i}].trace.leave_one_out`, note: `${d.trace.leave_one_out.vs_swap_back}. walk model: ${d.trace.walk_model || ''}. mission → units: ${d.trace.mission_source || ''}`, kind: 'derived' }}>
            <b className="d-move-delta">{d.trace.leave_one_out.d_walk_m <= 0 ? '−' : '+'}{Math.abs(d.trace.leave_one_out.d_walk_m).toFixed(1)} m</b><small> walk vs undo</small>
          </S>
        ) : null}
        <button className="d-icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="show reason">{open ? '−' : '+'}</button>
      </div>
      <p className="d-move-why">{rest.length ? rest.join(' · ') : head}</p>
      {open ? (
        <div className="d-move-trace">
          <p>{d.text}</p>
          {d.trace.price_source ? <p>price: {gbp(d.trace.price_gbp)} {priceAsm ? <Sticker tone="yellow">assumption</Sticker> : null} <span className="d-muted">{d.trace.price_source}</span></p> : null}
          {d.trace.off_url ? <p><Ext href={d.trace.off_url}>open food facts page</Ext></p> : null}
        </div>
      ) : null}
    </li>
  );
}

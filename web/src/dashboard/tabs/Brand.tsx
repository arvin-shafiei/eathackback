import { useEffect, useMemo, useState } from 'react';
import { useJSON } from '../lib/data';
import { S, urlsIn } from '../lib/src';
import { gbp, human, num, pct, signed } from '../lib/stats';
import { CIBar, Card, Empty, ErrorBox, Ext, FootSrc, Loading, Sticker } from '../ui/bits';

type Rate = { k: number; n: number; rate: number; ci95: [number, number] };
type Funnel = { shown: number; looked: number; picked_up: number; put_back: number; taken: number; look: Rate; pick_up: Rate; keep: Rate; take: Rate };
type Trig = { trigger: string; n_events: number; mean_jev_p: number; personas: string[]; source?: string; verbatims?: { quote: string; url?: string; method?: string }[] };
type BrandRep = {
  code: string; name: string; brand: string; category: string; role: string; price_gbp: number; price_source: string; off_url: string; pack_copy: string;
  funnel: Funnel; category_funnel: Funnel; n_products_in_category: number;
  diagnosis: { stage: string | null; ratios_vs_category: Record<string, number>; strength: string | null; text: string; next_test: string | null; rule: string };
  evidence: {
    look: { mean_p_notice: number; category_mean_p_notice: number; shelf_rows_seen: Record<string, number>; mean_logit_terms: Record<string, number>; source: string };
    pick_up: { mean_jev_p_pick_up: number; category_mean_jev_p_pick_up: number; mean_jev_appeal_score_0_4: number; category_mean_jev_appeal_score_0_4: number; feeling_of_those_who_walked_on: Record<string, number>; source: string };
    put_back: { n_put_back: number; mechanisms: Record<string, number>; top_triggers: Trig[]; glance_triggers_on_lookers: Trig[]; example_reasons: { persona: string; reason: string; run: string; agent: string }[]; source: string };
  };
  by_archetype: Record<string, Funnel>;
  benchmark: { sim_take_rank_in_category: number; sim_ranked_products: number; sim_rank_rule: string; nielseniq: { rank: number; brand: string; product_or_range: string; sales_value_gbp_m: string; yoy_change: string; period: string; source_name: string; source_url: string; match_level: string; table_size: number }[]; nielseniq_note?: string };
  ai_agent_arm: Record<string, { k: number; n: number; rate: number; ci95: [number, number] }>; ai_agent_arm_note: string;
  trace: { runs: string[]; ci: string; definitions: Record<string, string> };
};
type Idx = { code: string; name: string; brand: string; category: string; role: string; shown: number; take: number; stage: string | null; niq: boolean; file: string }[];
type Pack = {
  code: string; name: string; slot: string; inputs: { persona_weighting: string; card: string };
  eligible_claims: { id: string; claim: string; evidence: string; rule: string; source: string; off_url: string }[];
  variants: { variant: string; pack_copy: string; how: string; mean_p_pick_up: number; mean_delta_p_pick_up_vs_control: number; personas_up: number; personas_down: number; delta_by_persona: Record<string, number>; p_pick_up_by_persona: Record<string, number>; mean_p_gimmick: number; mean_appeal_score: number; stats_note?: string }[];
  winner: string; winner_rule: string; verdict: string; noise_floor: number; noise_floor_source: string;
};

const STAGES: { k: 'look' | 'pick_up' | 'keep' | 'take'; label: string; emoji: string }[] = [
  { k: 'look', label: 'look', emoji: '👀' }, { k: 'pick_up', label: 'pick up', emoji: '🤚' }, { k: 'keep', label: 'keep (not put back)', emoji: '🧺' }, { k: 'take', label: 'take, of all shown', emoji: '✅' },
];

export default function Brand() {
  const idx = useJSON<Idx>('brand/index.json');
  const packIdx = useJSON<{ code: string; name: string; winner: string; winner_delta_p_pick_up: number }[]>('pack_test/index.json');
  const [code, setCode] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (code || !idx.data) return;
    const fromHash = new URLSearchParams(location.hash.split('?')[1] || '').get('code');
    const first = packIdx.data?.[0]?.code;
    setCode(fromHash || first || idx.data.find((x) => x.role === 'challenger' && x.stage)?.code || idx.data[0]?.code || null);
  }, [idx.data, packIdx.data, code]);
  const rep = useJSON<BrandRep>(code ? `brand/${code}.json` : null);
  const packCodes = new Set((packIdx.data || []).map((p) => p.code));
  const groups = useMemo(() => {
    const g: Record<string, Idx> = {};
    for (const x of idx.data || []) if (!q || `${x.name} ${x.brand}`.toLowerCase().includes(q.toLowerCase())) (g[x.category] ||= []).push(x);
    return Object.entries(g).sort();
  }, [idx.data, q]);

  if (idx.loading) return <Loading what="brand reports" />;
  if (idx.error) return <ErrorBox error={idx.error} hint={<>run <code>python3 sim/brand_report.py</code>, then <code>node web/scripts/sync-dashboard.mjs</code>.</>} />;
  return (
    <div className="d-brand">
      <aside className="d-picker d-card">
        <input className="d-input" placeholder="find a product or brand" value={q} onChange={(e) => setQ(e.target.value)} aria-label="find a product" />
        <div className="d-picker-list">
          {groups.map(([c, xs]) => (
            <div key={c}>
              <h5 className="d-picker-cat">{human(c)}</h5>
              {xs.map((x) => (
                <button key={x.code} className={`d-picker-item ${x.code === code ? 'is-on' : ''}`} onClick={() => setCode(x.code)}>
                  <span className="d-picker-name">{x.name}</span>
                  <span className="d-picker-meta">
                    <i className={`d-role d-role-${x.role}`}>{x.role.replace('_', ' ')}</i>
                    {packCodes.has(x.code) ? <i className="d-role is-pack">pack test</i> : null}
                    {x.stage ? <i className="d-role is-leak">leaks at {x.stage === 'keep' ? 'put-back' : x.stage.replace('_', ' ')}</i> : null}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {!groups.length ? <p className="d-note">nothing matches “{q}”.</p> : null}
        </div>
      </aside>
      <div className="d-stack">
        {rep.loading ? <Loading what="the product report" /> : rep.error ? <ErrorBox error={rep.error} /> : rep.data ? <BrandView b={rep.data} hasPack={packCodes.has(rep.data.code)} /> : <Empty>pick a product.</Empty>}
      </div>
    </div>
  );
}

function BrandView({ b, hasPack }: { b: BrandRep; hasPack: boolean }) {
  const F = `data/sim/brand/${b.code}.json`;
  const priceAsm = /^assumption/i.test(b.price_source || '');
  const leak = b.diagnosis.stage;
  const maxCount = b.funnel.shown || 1;
  return (
    <>
      <Card className="d-brand-head">
        <div className="d-brand-title">
          <div>
            <h2 className="d-h2">{b.name}</h2>
            <p className="d-sub">{b.brand} · {human(b.category)} · <Sticker tone={b.role === 'challenger' ? 'brand' : b.role === 'own_label' ? 'dim' : 'white'}>{b.role.replace('_', ' ')}</Sticker> · <Ext href={b.off_url}>open food facts</Ext></p>
            <p className="d-packcopy">“{b.pack_copy}”</p>
          </div>
          <S src={{ file: F, field: 'price_gbp', note: b.price_source, url: urlsIn(b.price_source), kind: priceAsm ? 'assumption' : undefined }} className="d-price">
            <span className="d-big">{gbp(b.price_gbp)}</span>{priceAsm ? <Sticker tone="yellow">assumed price</Sticker> : null}
          </S>
        </div>
      </Card>

      <div className="d-two-wide">
        <Card title="the funnel" sub={<>this product vs its category average (|) across {b.trace.runs.length} runs. {b.trace.ci}.</>}
          foot={<FootSrc items={[[F, 'funnel.<stage>.{k,n,rate,ci95}, category_funnel']]} />}>
          <div className="d-funnel-counts">
            {([['shown', b.funnel.shown], ['looked', b.funnel.looked], ['picked up', b.funnel.picked_up], ['put back', b.funnel.put_back], ['taken', b.funnel.taken]] as [string, number][]).map(([k, v]) => (
              <div key={k} className={`d-fc ${k === 'put back' ? 'is-back' : ''}`}>
                <div className="d-fc-bar" style={{ height: `${Math.max(3, (v / maxCount) * 88)}px` }} />
                <S src={{ file: F, field: `funnel.${k.replace(' ', '_')}`, note: `${v} agent events; ${b.trace.definitions[k === 'looked' ? 'look' : k === 'taken' ? 'take' : 'pick_up'] || ''}` }}><b>{v}</b></S>
                <span>{k}</span>
              </div>
            ))}
          </div>
          <div className="d-stages">
            {STAGES.map((s) => {
              const r = b.funnel[s.k], c = b.category_funnel[s.k];
              const isLeak = leak === s.k;
              return (
                <div key={s.k} className={`d-stage ${isLeak ? 'is-leak' : ''}`}>
                  <div className="d-stage-head">
                    <span>{s.emoji} {s.label}</span>
                    <S src={{ file: F, field: `funnel.${s.k}`, note: `${r.k}/${r.n} = ${pct(r.rate, 1)}, 95% CI ${pct(r.ci95[0])}–${pct(r.ci95[1])}. category: ${pct(c.rate, 1)} (${c.k}/${c.n}). ${b.trace.definitions[s.k] || ''}` }}>
                      <b>{pct(r.rate)}</b> <small>{pct(r.ci95[0])}–{pct(r.ci95[1])}</small>
                    </S>
                    {isLeak ? <Sticker tone="bad">leak</Sticker> : null}
                  </div>
                  <CIBar rate={r.rate} ci={r.ci95} base={c.rate} baseLabel={`category ${pct(c.rate)}`} tone={isLeak ? 'hot' : 'ink'} src={{ file: F, field: `funnel.${s.k}.ci95 vs category_funnel.${s.k}.rate`, note: `| marks the category average (${pct(c.rate)}) over ${b.n_products_in_category} products` }} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="diagnosis" sub={b.diagnosis.strength || undefined} foot={<FootSrc items={[[F, 'diagnosis, evidence']]} />}>
          <S as="div" src={{ file: F, field: 'diagnosis.text', note: `rule: ${b.diagnosis.rule}. ratios vs category: ${Object.entries(b.diagnosis.ratios_vs_category).map(([k, v]) => `${k} ${v}`).join(', ')}`, kind: 'derived' }}>
            <p className={`d-diag ${leak ? 'is-leak' : 'is-ok'}`}>{b.diagnosis.text}</p>
          </S>
          {b.diagnosis.next_test ? <p className="d-note">next test: {b.diagnosis.next_test}</p> : null}
          <ul className="d-params">
            <li><span>P(notice) this vs category</span><S src={{ file: F, field: 'evidence.look.mean_p_notice', note: b.evidence.look.source }}><b>{num(b.evidence.look.mean_p_notice)} vs {num(b.evidence.look.category_mean_p_notice)}</b></S></li>
            <li><span>jev P(pick up) this vs category</span><S src={{ file: F, field: 'evidence.pick_up.mean_jev_p_pick_up', note: b.evidence.pick_up.source, kind: 'jev' }}><b>{num(b.evidence.pick_up.mean_jev_p_pick_up)} vs {num(b.evidence.pick_up.category_mean_jev_p_pick_up)}</b></S></li>
            <li><span>appeal (0–4) this vs category</span><S src={{ file: F, field: 'evidence.pick_up.mean_jev_appeal_score_0_4', note: b.evidence.pick_up.source, kind: 'jev' }}><b>{num(b.evidence.pick_up.mean_jev_appeal_score_0_4)} vs {num(b.evidence.pick_up.category_mean_jev_appeal_score_0_4)}</b></S></li>
          </ul>
          <h4 className="d-h4">put back {b.evidence.put_back.n_put_back}× · mechanisms</h4>
          <div className="d-chips">
            {Object.entries(b.evidence.put_back.mechanisms).map(([k, v]) => (
              <S key={k} src={{ file: F, field: `evidence.put_back.mechanisms.${k}`, note: `${v} of ${b.evidence.put_back.n_put_back} put-backs; mechanism = jev Choice per event`, kind: 'jev' }}><span className="d-chip">{human(k)} <b>{v}</b></span></S>
            ))}
          </div>
          <TriggerList title="put-offs that fired on put-backs" ts={b.evidence.put_back.top_triggers} F={F} field="evidence.put_back.top_triggers" />
          <TriggerList title="put-offs seen at a glance by people who looked" ts={b.evidence.put_back.glance_triggers_on_lookers} F={F} field="evidence.put_back.glance_triggers_on_lookers" />
          {b.evidence.put_back.example_reasons?.length ? (
            <details className="d-details"><summary>example reasons <b>{b.evidence.put_back.example_reasons.length}</b></summary>
              <ul className="d-reasons">{b.evidence.put_back.example_reasons.map((r, i) => <li key={i}><S src={{ file: `data/sim/runs/${r.run}.json`, field: `agents[agent_id=${r.agent}].events[product=${b.code}].reason`, note: `persona ${r.persona}` }}>{r.reason}</S></li>)}</ul>
            </details>
          ) : null}
        </Card>
      </div>

      <div className="d-two-wide">
        <Card title="who takes it" sub="take rate (taken / shown) by persona archetype, 95% CI" foot={<FootSrc items={[[F, 'by_archetype.<archetype>.take']]} />}>
          <ul className="d-arche">
            {Object.entries(b.by_archetype).sort((a, b2) => b2[1].take.rate - a[1].take.rate).map(([k, f]) => (
              <li key={k}>
                <span className="d-arche-name">{human(k)}</span>
                <CIBar rate={f.take.rate} ci={f.take.ci95} base={b.funnel.take.rate} max={Math.max(0.6, ...Object.values(b.by_archetype).map((x) => x.take.ci95[1]))} src={{ file: F, field: `by_archetype.${k}.take`, note: `${f.take.k}/${f.take.n} taken; 95% CI ${pct(f.take.ci95[0])}–${pct(f.take.ci95[1])}; | = all shoppers ${pct(b.funnel.take.rate)}` }} />
                <span className="d-arche-v">{pct(f.take.rate)} <small>n={f.take.n}</small></span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="sim vs real sales" foot={<FootSrc items={[[F, 'benchmark, ai_agent_arm'], 'data/sales/uk_bestsellers.csv']} />}>
          <ul className="d-params">
            <li><span>sim take-rate rank in {human(b.category)}</span><S src={{ file: F, field: 'benchmark.sim_take_rank_in_category', note: b.benchmark.sim_rank_rule }}><b>#{b.benchmark.sim_take_rank_in_category} of {b.benchmark.sim_ranked_products}</b></S></li>
            {Object.entries(b.ai_agent_arm).filter(([k]) => k !== 'all').map(([m, r]) => (
              <li key={m}><span>AI agent ({m}) pick share</span><S src={{ file: F, field: `ai_agent_arm.${m}`, note: `${r.k}/${r.n} feed runs; 95% CI ${pct(r.ci95[0])}–${pct(r.ci95[1])}. ${b.ai_agent_arm_note}`, kind: 'jev' }}><b>{pct(r.rate)}</b> <small>{pct(r.ci95[0])}–{pct(r.ci95[1])}</small></S></li>
            ))}
          </ul>
          {b.benchmark.nielseniq.length ? (
            <table className="d-table">
              <thead><tr><th>NIQ rank</th><th>brand / range</th><th>sales</th><th>match</th></tr></thead>
              <tbody>
                {b.benchmark.nielseniq.slice(0, 5).map((n, i) => (
                  <tr key={i}>
                    <td><S src={{ file: 'data/sales/uk_bestsellers.csv', field: `${n.source_name} · ${n.period}`, note: `table of ${n.table_size}; ${n.yoy_change} yoy`, url: n.source_url, kind: 'data' }}><b>#{n.rank}</b></S></td>
                    <td>{n.product_or_range}</td><td>£{n.sales_value_gbp_m}m</td><td><Sticker tone="dim">{n.match_level}</Sticker></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="d-note">{b.benchmark.nielseniq_note || 'not in the NielsenIQ / Grocer top lists.'}</p>}
        </Card>
      </div>
      {hasPack ? <PackTest code={b.code} /> : (
        <Card title="pack test" sub="no pack test for this product yet."><p className="d-note">run <code>python3 sim/pack_test.py --products {b.code}</code> to test the true claims it qualifies for (Reg 1924/2006), then <code>node web/scripts/sync-dashboard.mjs</code>.</p></Card>
      )}
    </>
  );
}

function TriggerList({ title, ts, F, field }: { title: string; ts: Trig[]; F: string; field: string }) {
  if (!ts?.length) return null;
  return (
    <>
      <h4 className="d-h4">{title}</h4>
      <ul className="d-trigs">
        {ts.map((t, i) => (
          <li key={i}>
            <S src={{ file: F, field: `${field}[${i}].mean_jev_p`, note: `fired on ${t.n_events} events for ${t.personas.map(human).join(', ')}. persona source: ${t.source || '—'}`, url: urlsIn(t.source), kind: 'jev' }}>
              <span className="d-trig-text">{t.trigger}</span> <b>p {num(t.mean_jev_p)}</b> <small>×{t.n_events}</small>
            </S>
            {t.verbatims?.[0] ? <blockquote className="d-evq">“{t.verbatims[0].quote}” <Ext href={t.verbatims[0].url}>reddit</Ext></blockquote> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function PackTest({ code }: { code: string }) {
  const p = useJSON<Pack>(`pack_test/${code}.json`);
  if (p.loading) return <Loading what="pack test" />;
  if (p.error || !p.data) return <ErrorBox error={p.error || 'missing'} />;
  const d = p.data;
  const F = `data/sim/brand/pack_test/${code}.json`;
  const personas = Object.keys(d.variants[0]?.p_pick_up_by_persona || {});
  const maxAbs = Math.max(0.05, ...d.variants.flatMap((v) => Object.values(v.delta_by_persona).map(Math.abs)));
  return (
    <Card title="pack test: which true claim wins the pick-up?" sub={<>only claims the product legally qualifies for. <S src={{ file: F, field: 'verdict', note: d.winner_rule }}><b>{d.verdict}</b></S></>}
      foot={<FootSrc items={[[F, 'variants[].delta_by_persona, eligible_claims'], ['sim/pack_test.py', 'jev Noul per persona × variant']]} />}>
      <div className="d-claims">
        {d.eligible_claims.map((c) => (
          <S key={c.id} src={{ file: F, field: `eligible_claims[id=${c.id}]`, note: `${c.evidence} · ${c.rule}`, url: [c.off_url, ...urlsIn(c.source)], kind: 'off' }}><span className="d-chip">{c.claim}</span></S>
        ))}
      </div>
      <div className="d-heat-wrap">
        <table className="d-heat">
          <thead>
            <tr><th>variant</th><th>mean P(pick up)</th><th>Δ vs control</th>{personas.map((pp) => <th key={pp} className="d-heat-p"><span>{human(pp)}</span></th>)}</tr>
          </thead>
          <tbody>
            {d.variants.map((v, vi) => (
              <tr key={v.variant} className={v.variant === d.winner ? 'is-win' : ''}>
                <th>
                  <span className="d-variant">{v.variant.replace(/_/g, ' ')}</span>{v.variant === d.winner ? <Sticker tone="brand">winner</Sticker> : null}
                  <small className="d-variant-copy">{v.pack_copy}</small>
                </th>
                <td><S src={{ file: F, field: `variants[${vi}].mean_p_pick_up`, note: `equal-weighted mean over ${personas.length} personas. ${d.inputs.persona_weighting}. mean P(gimmick) ${num(v.mean_p_gimmick)}`, kind: 'jev' }}><b>{num(v.mean_p_pick_up, 3)}</b></S></td>
                <td><S src={{ file: F, field: `variants[${vi}].mean_delta_p_pick_up_vs_control`, note: `${v.personas_up} personas up, ${v.personas_down} down (noise floor ±${d.noise_floor}: ${d.noise_floor_source})`, kind: 'jev' }}><b className={v.mean_delta_p_pick_up_vs_control > d.noise_floor ? 'is-good-t' : v.mean_delta_p_pick_up_vs_control < -d.noise_floor ? 'is-bad-t' : ''}>{signed(v.mean_delta_p_pick_up_vs_control, 3)}</b> <small>↑{v.personas_up} ↓{v.personas_down}</small></S></td>
                {personas.map((pp) => {
                  const dv = v.delta_by_persona[pp] ?? 0;
                  const a = Math.min(1, Math.abs(dv) / maxAbs);
                  const bg = dv > d.noise_floor ? `rgba(22,163,74,${0.12 + a * 0.6})` : dv < -d.noise_floor ? `rgba(225,29,72,${0.12 + a * 0.6})` : 'transparent';
                  return (
                    <td key={pp} className="d-heat-cell" style={{ background: bg }}>
                      <S src={{ file: F, field: `variants[${vi}].delta_by_persona.${pp}`, note: `P(pick up) ${num(v.p_pick_up_by_persona[pp])} vs control ${num(d.variants[0].p_pick_up_by_persona[pp])}; jev returns calibrated probabilities, so no sampling CI`, kind: 'jev' }}>
                        {vi === 0 ? num(v.p_pick_up_by_persona[pp]) : signed(dv, 2)}
                      </S>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="d-caption">control row shows each persona's P(pick up); other rows show the change vs control. green/red only beyond the ±{d.noise_floor} noise floor. card shown to jev: {d.inputs.card}</p>
    </Card>
  );
}

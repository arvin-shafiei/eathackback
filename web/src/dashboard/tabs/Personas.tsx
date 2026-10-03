import { useMemo, useState } from 'react';
import { useJSON } from '../lib/data';
import { S, urlsIn } from '../lib/src';
import { gbp, human, num, pct } from '../lib/stats';
import { Card, Empty, ErrorBox, Ext, FootSrc, Loading, Seg, Sticker } from '../ui/bits';
import { EvidenceMix, MixLegend, Radar, TRAITS, TRAIT_NAME } from '../ui/charts';

export type Persona = {
  id: string; name: string; archetype: string; mission: string; budget_gbp: number; budget_source?: string; channel?: string;
  segment_note?: string; ocean: Record<string, number>; ocean_source?: string;
  ocean_effects?: { trait: string; score: number; effect: string; coef?: number; coef_source?: string; source?: string }[];
  lens: { attribute: string; off_field: string; direction: string; weight: number; weight_input?: number; gate?: string; why?: string; source?: string }[];
  lens_weights_source?: string;
  rejection_triggers: { trigger: string; off_check?: string; source?: string }[];
  trust_signals: { signal: string; source?: string }[];
  habits?: { habit: string; source?: string }[];
  verbatims?: { quote: string; url?: string; subreddit?: string; score?: number }[];
  sim_params?: Record<string, number>; sim_params_sources?: Record<string, string>;
  sim_params_borrowed_from?: { persona_id: string; similarity: number; method?: string };
  dossier?: string; _file: string; _custom?: boolean;
};
export type MixRow = { persona_id: string; name: string; kind: string; n_fields: number; evidence_mix: Record<string, number> };

const IDX = 'data/provenance/personas/index.json';

export default function Personas() {
  const ps = useJSON<Persona[]>('personas.json');
  const idx = useJSON<{ personas: MixRow[] }>('provenance/personas/index.json');
  const [sort, setSort] = useState<'name' | 'grounded' | 'assumed'>('grounded');
  const [q, setQ] = useState('');
  const mixBy = useMemo(() => Object.fromEntries((idx.data?.personas || []).map((r) => [r.persona_id, r])), [idx.data]);
  const list = useMemo(() => {
    const xs = (ps.data || []).filter((p) => !q || `${p.name} ${p.archetype} ${p.mission}`.toLowerCase().includes(q.toLowerCase()));
    const asm = (p: Persona) => mixBy[p.id]?.evidence_mix.assumption ?? 999;
    if (sort === 'name') return [...xs].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'grounded') return [...xs].sort((a, b) => asm(a) - asm(b));
    return [...xs].sort((a, b) => asm(b) - asm(a));
  }, [ps.data, mixBy, sort, q]);

  if (ps.loading) return <Loading what="personas" />;
  if (ps.error) return <ErrorBox error={ps.error} />;
  const staged = (idx.data?.personas || []).filter((r) => r.kind !== 'lens');

  return (
    <div className="d-stack">
      <div className="d-intro">
        <p className="d-lede">
          {ps.data?.length} shopper personas the sim runs. each one is a hypothesis built from reddit comments, papers and open food facts fields, and the
          <b> honesty meter</b> under every name shows how much of it is evidence and how much is assumption.
        </p>
        <div className="d-toolbar">
          <input className="d-input" placeholder="filter by name, archetype or mission" value={q} onChange={(e) => setQ(e.target.value)} aria-label="filter personas" />
          <Seg label="sort personas" value={sort} onChange={setSort} options={[{ id: 'grounded', label: 'most grounded' }, { id: 'assumed', label: 'most assumed' }, { id: 'name', label: 'a–z' }]} />
        </div>
        <MixLegend />
      </div>
      {list.length === 0 ? <Empty>no persona matches “{q}”.</Empty> : null}
      <div className="d-grid-personas">
        {list.map((p) => <PersonaCard key={p.id} p={p} mix={mixBy[p.id]} />)}
      </div>
      {staged.length ? (
        <Card title="staged personas behind them" sub="the 13 research dossiers (data/personas/staged_personas_v1.json) the lens personas borrow from. same honesty meter.">
          <div className="d-staged">
            {staged.map((r) => (
              <div key={r.persona_id} className="d-staged-row">
                <span className="d-staged-name">{r.name}</span>
                <EvidenceMix compact mix={r.evidence_mix} src={{ file: IDX, field: `personas[${r.persona_id}].evidence_mix`, note: `${r.n_fields} fields; each field = 1 unit split equally across the source classes it cites` }} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function PersonaCard({ p, mix }: { p: Persona; mix?: MixRow }) {
  const f = p._file;
  const effects = Object.fromEntries((p.ocean_effects || []).map((e) => [e.trait, e]));
  const maxW = Math.max(...p.lens.map((l) => l.weight), 0.01);
  return (
    <article className="d-card d-persona">
      <header className="d-persona-head">
        <div>
          <h3 className="d-persona-name">{p.name}</h3>
          <div className="d-persona-tags">
            <Sticker tone="ink">{human(p.archetype)}</Sticker>
            <Sticker>{human(p.mission)}</Sticker>
            {p.channel ? <Sticker tone="dim">{p.channel}</Sticker> : null}
            {p._custom ? <Sticker tone="yellow">custom</Sticker> : null}
          </div>
        </div>
        <S src={{ file: f, field: 'budget_gbp', note: p.budget_source, url: urlsIn(p.budget_source) }} className="d-persona-budget">
          <span className="d-big">{gbp(p.budget_gbp, 0)}</span><span className="d-unit">budget</span>
        </S>
      </header>

      {mix ? (
        <EvidenceMix mix={mix.evidence_mix} src={{ file: IDX, field: `personas[${p.id}].evidence_mix`, note: `${mix.n_fields} fields; each field = 1 unit split equally across the source classes it cites (scripts/build_provenance.py)` }} />
      ) : (
        <p className="d-note">no provenance file yet for this persona (run <code>python3 scripts/build_provenance.py</code>).</p>
      )}

      <div className="d-persona-body">
        <div className="d-persona-ocean">
          <Radar ocean={p.ocean} />
          <ul className="d-ocean-list">
            {TRAITS.map((t) => {
              const e = effects[t];
              return (
                <li key={t}>
                  <S src={{ file: f, field: `ocean.${t}`, note: e ? `${e.effect}${e.coef !== undefined ? ` · coef ${e.coef}` : ''}${e.coef_source ? ` (${e.coef_source})` : ''}` : p.ocean_source || 'ocean score on 0-1', url: urlsIn(e?.source) }}>
                    <span className="d-ocean-t">{t}</span> <span className="d-ocean-v">{num(p.ocean[t])}</span>
                  </S>
                  <span className="d-ocean-name">{TRAIT_NAME[t]}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="d-persona-lens">
          <h4 className="d-h4">what they look for <span className="d-h4-note">lens weights</span></h4>
          <ul className="d-lens">
            {[...p.lens].sort((a, b) => b.weight - a.weight).map((l, i) => (
              <li key={l.attribute + i}>
                <S as="div" className="d-lens-row" src={{ file: f, field: `lens[${p.lens.indexOf(l)}].weight`, note: `${l.why ? `why: ${l.why} ` : ''}· OFF field: ${l.off_field} · direction: ${l.direction}${l.gate ? ` · gate: ${l.gate}` : ''}${l.source ? ` · source: ${l.source}` : ''}`, url: urlsIn(l.source), kind: /^assumption/i.test(l.source || '') ? 'assumption' : undefined }}>
                  <span className="d-lens-name">{human(l.attribute)}</span>
                  <span className="d-lens-track"><span className="d-lens-fill" style={{ width: `${(l.weight / maxW) * 100}%` }} /></span>
                  <span className="d-lens-w">{pct(l.weight)}</span>
                </S>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <details className="d-details">
        <summary>put-offs <b>{p.rejection_triggers.length}</b> · trust signals <b>{p.trust_signals.length}</b></summary>
        <div className="d-two">
          <ul className="d-reasons is-bad">
            {p.rejection_triggers.map((t, i) => (
              <li key={i}><S src={{ file: f, field: `rejection_triggers[${i}]`, note: `${t.off_check ? `OFF check: ${t.off_check} · ` : ''}${t.source || 'no source given'}`, url: urlsIn(t.source) }}>{t.trigger}</S></li>
            ))}
          </ul>
          <ul className="d-reasons is-good">
            {p.trust_signals.map((t, i) => (
              <li key={i}><S src={{ file: f, field: `trust_signals[${i}]`, note: t.source || 'no source given', url: urlsIn(t.source) }}>{t.signal}</S></li>
            ))}
          </ul>
        </div>
      </details>

      {p.verbatims?.length ? (
        <details className="d-details">
          <summary>in their words <b>{p.verbatims.length}</b> reddit verbatims</summary>
          <ul className="d-quotes">
            {p.verbatims.map((v, i) => (
              <li key={i}>
                <blockquote>“{v.quote}”</blockquote>
                <Ext href={v.url}>{v.url ? v.url.replace(/^https?:\/\/(www\.)?/, '') : 'no url'}</Ext>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {p.sim_params && Object.keys(p.sim_params).length ? (
        <details className="d-details">
          <summary>sim parameters <b>{Object.keys(p.sim_params).length}</b></summary>
          <ul className="d-params">
            {Object.entries(p.sim_params).map(([k, v]) => (
              <li key={k}>
                <span>{human(k)}</span>
                <S src={{ file: f, field: `sim_params.${k}`, note: p.sim_params_sources?.[k] || 'no source given', url: urlsIn(p.sim_params_sources?.[k]) }}><b>{typeof v === 'number' ? num(v, v % 1 ? 2 : 0) : String(v)}</b></S>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <footer className="d-foot"><FootSrc items={[f]} /></footer>
    </article>
  );
}

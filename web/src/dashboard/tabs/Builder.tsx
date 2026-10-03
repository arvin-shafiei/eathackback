import { useEffect, useMemo, useState } from 'react';
import { useJSON } from '../lib/data';
import { findServer, post, saveApiBase, type Health } from '../lib/api';
import { S, urlsIn } from '../lib/src';
import { human, num, pct, wilson } from '../lib/stats';
import { Card, ErrorBox, Ext, FootSrc, Loading, Sticker } from '../ui/bits';
import { Radar, TRAITS, TRAIT_NAME } from '../ui/charts';
import type { Persona } from './Personas';

type OceanEffect = { id?: string; behaviour: string; direction: string; effect_size?: string; sim_mapping?: string; coef?: number; effect?: string; source: string; confidence?: string };
type OceanFile = Record<string, { trait_name: string; effects: OceanEffect[]; caveats?: string[]; _file: string; population_norms?: string }>;
type OffField = { field: string; label: string; unit: string; off: string; dir: string; n_non_null: number; n_products: number; min: number | null; max: number | null; example: unknown };
type Cat = { products: Record<string, { name: string; brand?: string; category: string; role?: string; off_url?: string }> };

// sim/run.py MISSION_CATEGORIES (the server validates the mission against it)
const MISSIONS: Record<string, string[]> = {
  weekly_shop: ['breakfast_cereal', 'yoghurt', 'plant_milk_dairy_alt', 'biscuits_chocolate', 'ready_meals_soup', 'crisps_savoury'],
  meal_deal: ['soft_drinks', 'crisps_savoury', 'snack_bars'],
  top_up: ['plant_milk_dairy_alt', 'yoghurt', 'ready_meals_soup'],
  treat: ['biscuits_chocolate', 'crisps_savoury', 'soft_drinks'],
  gym: ['snack_bars', 'yoghurt', 'soft_drinks'],
};
const DIRS = ['lower_better', 'higher_better', 'present_better', 'absence_better'];
type LensRow = { off_field: string; direction: string; raw: number; why: string };
type Form = {
  name: string; archetype: string; mission: string; budget: number; channel: string;
  ocean: Record<string, number>; lens: LensRow[]; triggers: string; trust: string;
};
const BLANK: Form = {
  name: '', archetype: '', mission: 'weekly_shop', budget: 40, channel: 'instore',
  ocean: { O: 0.5, C: 0.5, E: 0.5, A: 0.5, N: 0.5 },
  lens: [{ off_field: 'sugars_100g', direction: 'lower_better', raw: 5, why: '' }, { off_field: 'fiber_100g', direction: 'higher_better', raw: 3, why: '' }],
  triggers: '', trust: '',
};

export default function Builder() {
  const ocean = useJSON<OceanFile>('ocean.json');
  const off = useJSON<{ fields: OffField[] }>('off_fields.json');
  const personas = useJSON<Persona[]>('personas.json');
  const cat = useJSON<Cat>('catalog_min.json');
  const [form, setForm] = useState<Form>(BLANK);
  const [openTrait, setOpenTrait] = useState<string | null>('O');
  const [allFx, setAllFx] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [saved, setSaved] = useState<SavedPersona | null>(null);
  const [run, setRun] = useState<RunResp | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'run'>('');
  const [err, setErr] = useState('');
  const engine = new URLSearchParams(location.search).get('engine') || 'jev';

  const check = () => { setHealth(null); findServer().then(setHealth); };
  useEffect(check, []);

  const fields = off.data?.fields || [];
  const total = form.lens.reduce((s, l) => s + Math.max(0, l.raw), 0);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const problems = [
    !form.name.trim() && 'a name',
    !form.archetype.trim() && 'an archetype label',
    !(form.budget > 0) && 'a budget above £0',
    !(total > 0) && 'at least one lens weight above 0',
    !lines(form.triggers).length && 'at least one put-off',
    !lines(form.trust).length && 'at least one trust signal',
  ].filter(Boolean) as string[];

  function fromPersona(id: string) {
    const p = personas.data?.find((x) => x.id === id);
    if (!p) return;
    const valid = new Set(fields.map((f) => f.field));
    const lens = p.lens.filter((l) => valid.has(l.off_field)).map((l) => ({ off_field: l.off_field, direction: DIRS.includes(l.direction) ? l.direction : 'lower_better', raw: Math.round(l.weight * 100) / 10, why: l.why || '' }));
    setForm({
      name: `${p.name} (copy)`, archetype: `${p.archetype}_variant`, mission: MISSIONS[p.mission] ? p.mission : 'weekly_shop', budget: p.budget_gbp || 20, channel: p.channel || 'instore',
      ocean: { ...p.ocean }, lens: lens.length ? lens : BLANK.lens,
      triggers: p.rejection_triggers.map((t) => t.trigger).join('\n'), trust: p.trust_signals.map((t) => t.signal).join('\n'),
    });
    setSaved(null); setRun(null); setErr('');
  }

  async function save(): Promise<SavedPersona | null> {
    if (!health?.ok) return null;
    setBusy('save'); setErr('');
    try {
      const body = {
        name: form.name.trim(), archetype: form.archetype.trim().replace(/\s+/g, '_').toLowerCase(), mission: form.mission, budget_gbp: form.budget, channel: form.channel,
        ocean: form.ocean,
        lens: form.lens.filter((l) => l.raw > 0).map((l) => ({ attribute: l.off_field, off_field: l.off_field, direction: l.direction, weight: l.raw, why: l.why })),
        rejection_triggers: lines(form.triggers), trust_signals: lines(form.trust),
      };
      const p = await post<SavedPersona>(health.base, '/personas', body);
      setSaved(p);
      return p;
    } catch (e) { setErr(`save failed: ${(e as Error).message}`); return null; } finally { setBusy(''); }
  }
  async function test() {
    if (!health?.ok) return;
    const p = saved || (await save());
    if (!p) return;
    setBusy('run'); setErr(''); setRun(null);
    try {
      const r = await post<RunResp>(health.base, '/run', { persona_ids: [p.id], agents_per_persona: 10, engine, label: 'dashboard persona builder' });
      setRun(r);
    } catch (e) { setErr(`run failed: ${(e as Error).message}`); } finally { setBusy(''); }
  }

  if (ocean.loading || off.loading) return <Loading what="the builder" />;
  if (ocean.error || off.error) return <ErrorBox error={ocean.error || off.error || ''} />;
  const oc = ocean.data!;

  return (
    <div className="d-builder">
      <div className="d-builder-form">
        <Card title="who are they?" sub="everything you type here is saved with the source “user-defined (dashboard)”, so it never passes as evidence."
          right={personas.data ? (
            <label className="d-inline">start from
              <select className="d-select" defaultValue="" onChange={(e) => e.target.value && fromPersona(e.target.value)} aria-label="start from an existing persona">
                <option value="">blank</option>
                {personas.data.map((p) => <option key={p.id} value={p.id}>{p.name} · {human(p.archetype)}</option>)}
              </select>
            </label>
          ) : null}>
          <div className="d-fields">
            <label className="d-field"><span>name</span><input className="d-input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Nadia" /></label>
            <label className="d-field"><span>archetype label</span><input className="d-input" value={form.archetype} onChange={(e) => set('archetype', e.target.value)} placeholder="e.g. new parent on a budget" /></label>
            <label className="d-field"><span>mission</span>
              <select className="d-select" value={form.mission} onChange={(e) => set('mission', e.target.value)}>
                {Object.keys(MISSIONS).map((m) => <option key={m} value={m}>{human(m)}</option>)}
              </select>
              <S src={{ file: 'sim/run.py', field: `MISSION_CATEGORIES.${form.mission}`, note: 'assumption: which store units each mission sends a shopper to, built from the mission descriptions in data/personas/staged_personas_v1.json', kind: 'assumption' }}>
                <small className="d-help">walks: {MISSIONS[form.mission].map(human).join(', ')}</small>
              </S>
            </label>
            <label className="d-field"><span>budget (£)</span><input className="d-input" type="number" min={1} step={1} value={form.budget} onChange={(e) => set('budget', Number(e.target.value))} /></label>
          </div>
        </Card>

        <Card title="personality (OCEAN)" sub="traits nudge the sim through published trait → food-behaviour links. open a trait to see which links fire and their citations.">
          <div className="d-ocean-build">
            <Radar ocean={form.ocean} size={150} />
            <div className="d-sliders">
              {TRAITS.map((t) => {
                const f = oc[t];
                const open = openTrait === t;
                return (
                  <div key={t} className={`d-slider ${open ? 'is-open' : ''}`}>
                    <div className="d-slider-row">
                      <button className="d-slider-name" onClick={() => setOpenTrait(open ? null : t)} aria-expanded={open}>
                        <b>{t}</b> {TRAIT_NAME[t]} <span className="d-caret">{open ? '−' : '+'}</span>
                      </button>
                      <input type="range" min={0} max={1} step={0.05} value={form.ocean[t]} onChange={(e) => set('ocean', { ...form.ocean, [t]: Number(e.target.value) })} aria-label={`${TRAIT_NAME[t]} 0 to 1`} />
                      <span className="d-slider-v">{num(form.ocean[t])}</span>
                    </div>
                    {open && f ? (
                      <ul className="d-effects">
                        {[...f.effects].map((e, i) => ({ e, i })).sort((a, b) => Math.abs(b.e.coef ?? 0) - Math.abs(a.e.coef ?? 0)).slice(0, allFx ? 99 : 3).map(({ e, i }) => (
                          <li key={i}>
                            <p className="d-effect-b">{e.effect || e.behaviour}</p>
                            <p className="d-effect-d">{e.direction}{e.coef !== undefined ? <> · <S src={{ file: f._file, field: `effects[${i}].coef`, note: `${e.effect_size || ''} ${e.sim_mapping ? '· mapping: ' + e.sim_mapping : ''}`, url: urlsIn(e.source) }}>coef <b>{e.coef}</b></S></> : null}{e.confidence ? <> · confidence {e.confidence}</> : null}</p>
                            <p className="d-effect-s">{e.source.slice(0, 220)}{e.source.length > 220 ? '…' : ''}</p>
                          </li>
                        ))}
                        {f.effects.length > 3 ? <li className="d-effects-more"><button className="d-btn d-btn-white d-btn-sm" onClick={() => setAllFx(!allFx)}>{allFx ? 'strongest 3 only' : `all ${f.effects.length} links for ${TRAIT_NAME[t]}`}</button></li> : null}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card title="what they look for" sub={<>pick open food facts fields only. weights are normalised to 100% in code (<code>sim/server.py build_persona</code>), shown live.</>}
          foot={<FootSrc items={[['data/products/catalog.json', 'field coverage'], ['web/scripts/sync-dashboard.mjs', 'OFF allow-list']]} />}>
          <div className="d-lens-build">
            <div className="d-lens-build-head"><span>OFF field</span><span>better when</span><span>weight</span><span>share</span><span /></div>
            {form.lens.map((l, i) => {
              const f = fields.find((x) => x.field === l.off_field);
              const share = total > 0 ? Math.max(0, l.raw) / total : 0;
              const upd = (patch: Partial<LensRow>) => set('lens', form.lens.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <div key={i} className="d-lens-build-row">
                  <select className="d-select" value={l.off_field} onChange={(e) => { const nf = fields.find((x) => x.field === e.target.value); upd({ off_field: e.target.value, direction: nf?.dir || l.direction }); }} aria-label="OFF field">
                    {fields.map((x) => <option key={x.field} value={x.field}>{x.label}</option>)}
                  </select>
                  <select className="d-select" value={l.direction} onChange={(e) => upd({ direction: e.target.value })} aria-label="direction">
                    {DIRS.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
                  </select>
                  <input type="range" min={0} max={10} step={0.5} value={l.raw} onChange={(e) => upd({ raw: Number(e.target.value) })} aria-label="raw weight" />
                  <span className="d-lens-share"><b>{pct(share)}</b></span>
                  <button className="d-icon-btn" onClick={() => set('lens', form.lens.filter((_, j) => j !== i))} aria-label="remove attribute">×</button>
                  {f ? (
                    <S src={{ file: 'data/products/catalog.json', field: `[].${f.field}`, note: `OFF ${f.off}; filled for ${f.n_non_null}/${f.n_products} catalog products${f.min !== null ? `, range ${f.min}–${f.max}${f.unit ? ' ' + f.unit : ''}` : ''}`, kind: 'off' }} className="d-lens-cov">
                      <small>OFF <code>{f.off}</code> · {f.n_non_null}/{f.n_products} products</small>
                    </S>
                  ) : null}
                  <input className="d-input d-lens-why" placeholder="why does this matter to them? (optional, saved as your note)" value={l.why} onChange={(e) => upd({ why: e.target.value })} />
                </div>
              );
            })}
            <button className="d-btn d-btn-white" onClick={() => set('lens', [...form.lens, { off_field: fields.find((f) => !form.lens.some((l) => l.off_field === f.field))?.field || fields[0].field, direction: 'lower_better', raw: 3, why: '' }])}>+ add attribute</button>
          </div>
        </Card>

        <Card title="what puts them off, what earns trust" sub="one per line. jev asks “does this product show what this describes?” for each, so write them as things you could see on a pack or shelf.">
          <div className="d-two">
            <label className="d-field"><span>put-offs (rejection triggers)</span><textarea className="d-input" rows={5} value={form.triggers} onChange={(e) => set('triggers', e.target.value)} placeholder={'sweeteners in the ingredients\n“high protein” on something that is naturally protein-y'} /></label>
            <label className="d-field"><span>trust signals</span><textarea className="d-input" rows={5} value={form.trust} onChange={(e) => set('trust', e.target.value)} placeholder={'short ingredient list I can pronounce\nprice per 100g lower than the brand next to it'} /></label>
          </div>
        </Card>

        <div className="d-actions">
          {health?.ok ? <ServerStatus health={health} onRetry={check} /> : null}
          {problems.length ? <p className="d-note">to save, add {problems.join(', ')}.</p> : null}
          <div className="d-action-btns">
            <button className="d-btn d-btn-white" disabled={!health?.ok || !!problems.length || !!busy} onClick={save}>{busy === 'save' ? 'saving…' : 'save'}</button>
            <button className="d-btn d-btn-brand" disabled={!health?.ok || !!problems.length || !!busy} onClick={test}>{busy === 'run' ? 'shopping… (10 agents)' : 'test in store'}</button>
          </div>
          {engine !== 'jev' ? <p className="d-note is-warn">engine “{engine}” from the url: results are not jev judgments and are not evidence.</p> : null}
          {err ? <p className="d-note is-bad" role="alert">{err}</p> : null}
        </div>
      </div>

      <div className="d-builder-out">
        {!health?.ok ? <ServerStatus health={health} onRetry={check} /> : null}
        {saved ? <SavedCard p={saved} /> : <Card title="results land here" sub="save the persona, then test it: 10 agents walk the store with your persona and jev answers every pick-up, put-back and take."><ol className="d-steps"><li>fill the form (or start from an existing persona)</li><li><b>save</b> → <code>POST /api/personas</code></li><li><b>test in store</b> → <code>POST /api/run</code> with 10 agents, engine jev</li></ol></Card>}
        {busy === 'run' ? <Loading what="the store run (10 shoppers, usually under a minute)" /> : null}
        {run ? <RunResults run={run} cat={cat.data} /> : null}
      </div>
    </div>
  );
}

function ServerStatus({ health, onRetry }: { health: Health | null; onRetry: () => void }) {
  const [custom, setCustom] = useState('');
  if (!health) return <p className="d-server is-wait">looking for the sim server…</p>;
  if (health.ok) return <p className="d-server is-ok"><i /> sim server at <code>{health.base}</code> · {health.personas} personas</p>;
  return (
    <div className="d-server is-down" role="status">
      <p><b>the sim server isn't answering</b>, so save and test are off. the rest of the dashboard works from files.</p>
      <ul>{health.tried.map((t) => <li key={t.base}><code>{t.base}</code>: {t.why}</li>)}</ul>
      <p>start it from the repo root:</p>
      <pre>python3 sim/server.py</pre>
      <p>port 8787 taken by something else? run it on another port and point the dashboard there:</p>
      <pre>python3 sim/server.py 8788</pre>
      <div className="d-inline">
        <input className="d-input" placeholder="http://localhost:8788/api" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="sim server api base url" />
        <button className="d-btn d-btn-white" onClick={() => { if (custom) saveApiBase(custom.replace(/\/$/, '')); onRetry(); }}>retry</button>
      </div>
    </div>
  );
}

type SavedPersona = {
  id: string; name: string; archetype: string; _file?: string; lens: { attribute: string; off_field: string; weight: number; weight_input: number }[];
  sim_params?: Record<string, number>; sim_params_sources?: Record<string, string>;
  sim_params_borrowed_from?: { persona_id: string; similarity: number; ocean_cosine: number; lens_cosine: number; shared_lens_fields: string[]; method: string };
  ocean_source?: string;
};

function SavedCard({ p }: { p: SavedPersona }) {
  const f = p._file || `data/personas/custom/${p.id.replace('p_custom_', '')}.json`;
  const b = p.sim_params_borrowed_from;
  const sp = Object.entries(p.sim_params || {});
  return (
    <Card title={<>saved: {p.name} <Sticker tone="yellow">custom</Sticker></>} sub={<>written to <code>{f}</code> as <code>{p.id}</code></>} foot={<FootSrc items={[f, 'sim/server.py build_persona']} />}>
      <h4 className="d-h4">lens after normalising</h4>
      <ul className="d-params">
        {p.lens.map((l, i) => (
          <li key={i}><span>{human(l.off_field)}</span><S src={{ file: f, field: `lens[${i}].weight`, note: `you typed ${l.weight_input}; normalised = weight_input / sum(weight_input)` }}><b>{pct(l.weight)}</b></S></li>
        ))}
      </ul>
      <h4 className="d-h4">borrowed from the nearest persona</h4>
      {b ? (
        <>
          <p className="d-note">
            the sim needs parameters you can't easily type (notice rate at eye level, habit lock-in, price sensitivity…). they come from{' '}
            <S src={{ file: f, field: 'sim_params_borrowed_from', note: b.method }}><b>{b.persona_id}</b></S>, similarity{' '}
            <S src={{ file: f, field: 'sim_params_borrowed_from.similarity', note: `0.5 × OCEAN cosine (${b.ocean_cosine}) + 0.5 × lens cosine (${b.lens_cosine}); shared fields: ${b.shared_lens_fields.join(', ') || 'none'}` }}><b>{num(b.similarity)}</b></S>.
          </p>
          {sp.length ? (
            <ul className="d-params">
              {sp.map(([k, v]) => {
                const src = p.sim_params_sources?.[k] || '';
                return (
                  <li key={k}>
                    <span>{human(k)} {/^borrowed/.test(src) ? <Sticker tone="dim">borrowed</Sticker> : <Sticker tone="yellow">yours</Sticker>}</span>
                    <S src={{ file: f, field: `sim_params.${k}`, note: src, kind: /^borrowed/.test(src) ? 'derived' : 'assumption' }}><b>{num(v, v % 1 ? 2 : 0)}</b></S>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="d-note is-warn">
              the server returned no numeric sim parameters, so the run falls back to the sim defaults in <code>sim/run.py</code> (e.g. price sensitivity 0.5). check that the nearest persona's file has <code>sim_params</code>.
            </p>
          )}
        </>
      ) : <p className="d-note">no persona was close enough to borrow from; sim defaults apply.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- run results
type Ev = {
  product: string; stage_reached?: string; decision?: string; mechanism?: string; reason?: string;
  verbatim?: { quote: string; url?: string } | null;
  jev?: { mechanism?: { choice?: string; probabilities?: Record<string, number> }; nouls_fired?: Record<string, { text: string; p: number; source?: string }>; appeal?: { level?: number } };
};
type RunResp = { run_id: string; engine?: string; models?: string[]; agents: { agent_id: string; persona_id: string; events: Ev[]; calls?: { errors?: string[] } }[]; cost?: Record<string, number> };

function stageOf(e: Ev) {
  if (e.stage_reached) return e.stage_reached;
  return e.decision === 'pick' ? 'taken' : e.decision === 'reject' ? 'put_back' : e.decision === 'walk_past' ? 'looked' : 'not_noticed';
}

function RunResults({ run, cat }: { run: RunResp; cat?: Cat }) {
  const runFile = `data/sim/runs/${run.run_id}.json`;
  const evs = useMemo(() => run.agents.flatMap((a) => a.events.map((e) => ({ ...e, agent: a.agent_id }))), [run]);
  const byCat = useMemo(() => {
    const m: Record<string, { shown: number; looked: number; picked: number; back: number; taken: number }> = {};
    for (const e of evs) {
      const c = cat?.products[e.product]?.category || 'unknown';
      const r = (m[c] ||= { shown: 0, looked: 0, picked: 0, back: 0, taken: 0 });
      const s = stageOf(e);
      r.shown++;
      if (s !== 'not_noticed') r.looked++;
      if (s === 'put_back' || s === 'taken') r.picked++;
      if (s === 'put_back') r.back++;
      if (s === 'taken') r.taken++;
    }
    return Object.entries(m).sort((a, b) => b[1].shown - a[1].shown);
  }, [evs, cat]);
  const backs = evs.filter((e) => stageOf(e) === 'put_back');
  const mech = useMemo(() => {
    const m: Record<string, { n: number; p: number[]; reasons: string[] }> = {};
    for (const e of backs) {
      const k = e.mechanism || e.jev?.mechanism?.choice || 'unlabelled';
      const r = (m[k] ||= { n: 0, p: [], reasons: [] });
      r.n++;
      const p = e.jev?.mechanism?.probabilities?.[k];
      if (typeof p === 'number') r.p.push(p);
      if (e.reason && r.reasons.length < 2) r.reasons.push(e.reason);
    }
    return Object.entries(m).sort((a, b) => b[1].n - a[1].n);
  }, [backs]);
  const triggers = useMemo(() => {
    const m: Record<string, { n: number; p: number[]; source?: string; kind: string }> = {};
    for (const e of backs) for (const [k, v] of Object.entries(e.jev?.nouls_fired || {})) {
      const r = (m[v.text] ||= { n: 0, p: [], source: v.source, kind: k.startsWith('trust') ? 'trust' : 'put-off' });
      r.n++; r.p.push(v.p);
    }
    return Object.entries(m).filter(([, r]) => r.kind === 'put-off').sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  }, [backs]);
  const quotes = Array.from(new Map(backs.filter((e) => e.verbatim?.quote).map((e) => [e.verbatim!.quote, e.verbatim!])).values()).slice(0, 4);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

  const nErr = run.cost?.errors ?? 0;
  const firstErr = run.agents.flatMap((a) => a.calls?.errors || [])[0] || '';
  return (
    <>
      {nErr > 0 ? (
        <div className="d-server is-down" role="alert">
          <p><b>jev failed on {nErr} request{nErr === 1 ? '' : 's'}</b>, so these shoppers fell back to code-only rules and the numbers below are <b>not jev judgments</b>.</p>
          <S src={{ file: runFile, field: 'agents[].calls.errors', note: firstErr }}><code>{firstErr.slice(0, 180)}{firstErr.length > 180 ? '…' : ''}</code></S>
          {/402|credit/i.test(firstErr) ? <p>the TypeSafe account is out of credits: top up at console.typesafe.ai, then test again.</p> : null}
        </div>
      ) : null}
      <Card title="funnel by category" sub={<>👀 look → 🤚 pick up → ↩️ put back / 🧺 take, from {run.agents.length} shoppers · run <code>{run.run_id}</code>{run.engine && run.engine !== 'jev' ? <> · <Sticker tone="bad">{run.engine}</Sticker></> : null}</>}
        foot={<FootSrc items={[[runFile, 'agents[].events[].stage_reached'], ['catalog.json', 'category per product']]} />}>
        <table className="d-table d-funnel-table">
          <thead><tr><th>category</th><th>shown</th><th>look</th><th>pick up</th><th>put back</th><th>take</th></tr></thead>
          <tbody>
            {byCat.map(([c, r]) => {
              const cell = (k: number, n: number, field: string, what: string) => {
                const [lo, hi] = wilson(k, n);
                return (
                  <td>
                    <S src={{ file: runFile, field, note: `${what}: ${k}/${n} events; 95% Wilson CI ${pct(lo)}–${pct(hi)}` }}>
                      <b>{n ? pct(k / n) : '—'}</b> <small className="d-ci">{n ? `${pct(lo)}–${pct(hi)}` : ''}</small>
                    </S>
                  </td>
                );
              };
              return (
                <tr key={c}>
                  <th>{human(c)}</th>
                  <td><S src={{ file: runFile, field: 'agents[].events[] (count)', note: `${r.shown} product passes in ${human(c)}` }}>{r.shown}</S></td>
                  {cell(r.looked, r.shown, "stage_reached != 'not_noticed'", 'looked / shown')}
                  {cell(r.picked, r.looked, "stage_reached in ('put_back','taken')", 'picked up / looked')}
                  {cell(r.back, r.picked, "stage_reached == 'put_back'", 'put back / picked up')}
                  {cell(r.taken, r.shown, "stage_reached == 'taken'", 'taken / shown')}
                </tr>
              );
            })}
          </tbody>
        </table>
        {run.cost ? <p className="d-note">cost <S src={{ file: runFile, field: 'cost', note: `${run.cost.llm_calls ?? '?'} jev requests, ${run.cost.cached ?? 0} served from cache; $0.042 per 1M input tokens` }}><b>${num(run.cost.usd ?? 0, 4)}</b></S></p> : null}
      </Card>

      <Card title="why they put things back" sub={`${backs.length} put-backs. the mechanism is jev's typed answer; p is its probability for that mechanism.`}
        foot={<FootSrc items={[[runFile, 'events[].mechanism, events[].jev.mechanism.probabilities, events[].jev.nouls_fired']]} />}>
        {backs.length === 0 ? <p className="d-note">no put-backs in this run: every pick-up was taken (or nothing was picked up).</p> : (
          <>
            <ul className="d-reason-bars">
              {mech.map(([k, r]) => (
                <li key={k}>
                  <span className="d-reason-k">{human(k)}</span>
                  <span className="d-lens-track"><span className="d-lens-fill" style={{ width: `${(r.n / backs.length) * 100}%` }} /></span>
                  <S src={{ file: runFile, field: `events[mechanism='${k}'].jev.mechanism.probabilities.${k}`, note: `${r.n} of ${backs.length} put-backs; mean jev P(${k}) = ${num(mean(r.p))} over ${r.p.length} answers. e.g. ${r.reasons[0] || ''}`, kind: 'jev' }}>
                    <b>{r.n}</b> <small>p̄ {num(mean(r.p))}</small>
                  </S>
                </li>
              ))}
            </ul>
            {triggers.length ? (
              <>
                <h4 className="d-h4">put-offs jev saw on the pack (p &gt; 0.5)</h4>
                <ul className="d-reasons is-bad">
                  {triggers.map(([t, r]) => (
                    <li key={t}><S src={{ file: runFile, field: 'events[].jev.nouls_fired', note: `fired on ${r.n} put-backs, mean P(yes) ${num(mean(r.p))}. persona source: ${r.source || '—'}`, url: urlsIn(r.source), kind: 'jev' }}>{t}</S> <small>×{r.n} · p̄ {num(mean(r.p))}</small></li>
                  ))}
                </ul>
              </>
            ) : null}
            {quotes.length ? (
              <ul className="d-quotes">
                {quotes.map((v) => <li key={v.quote}><blockquote>“{v.quote}”</blockquote><Ext href={v.url}>{v.url?.replace(/^https?:\/\/(www\.)?/, '')}</Ext></li>)}
              </ul>
            ) : <p className="d-note">no reddit verbatims attached: custom personas only carry verbatims you add, so the “why” here rests on jev's probabilities alone.</p>}
          </>
        )}
      </Card>
    </>
  );
}

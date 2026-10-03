import { useMemo, useState } from 'react';
import type { Agent, Persona, Run } from '../types';
import { isAI } from '../types';
import { SIM_SERVER } from '../data';
import { archColor, archLabel } from '../theme';
import { APPEAL_SHORT, type LiveEvent } from './agentLive';
import { shortUrl } from './bits';
import './interview.css';

/**
 * interview the shoppers who met this product. rule zero: every sentence is assembled from one shopper's
 * recorded event (stage_reached, p_pick_up, the take distribution, triggers fired, appeal, mechanism, verbatim)
 * and their persona file. nothing is generated. mirrors sim/interview.py answer().
 * the what-if is the only paid path: POST /api/interview re-asks jev per interviewee (sim/interview.py whatif()).
 */

type Group = 'bought' | 'put_back' | 'walked_past' | 'never_noticed';
const GROUPS: { key: Group; label: string; color: string }[] = [
  { key: 'bought', label: 'bought it', color: '#2bb673' },
  { key: 'put_back', label: 'picked up & put back', color: '#e11d48' },
  { key: 'walked_past', label: 'looked & walked past', color: '#f59e0b' },
  { key: 'never_noticed', label: 'never noticed', color: '#9ca3af' },
];
const GROUP_OF: Record<string, Group> = { taken: 'bought', put_back: 'put_back', looked: 'walked_past', not_noticed: 'never_noticed' };
const STAGE_RANK: Record<string, number> = { taken: 3, put_back: 2, looked: 1, not_noticed: 0 };
type Qid = 'why_back' | 'why_pick' | 'change' | 'saw';
const QUESTIONS: { key: Qid; q: string }[] = [
  { key: 'why_back', q: 'why did you put it back?' },
  { key: 'why_pick', q: 'what made you pick it up?' },
  { key: 'change', q: 'what would change your mind?' },
  { key: 'saw', q: 'did you even see it?' },
];
const WHATIFS = ['at £1.20?', 'with a high-fibre claim?', 'on the eye-level shelf?'];
const NOUL_FIRES = 0.5; // sim/jev.py NOUL_FIRES

type Ev = LiveEvent & { secondary?: boolean };
interface Meeting { agent: Agent; event: Ev; group: Group }
interface Fired { key: string; text: string; p: number; source?: string }
interface Answer { text: string; inferred: boolean; fields: Record<string, unknown>; quote?: { quote?: string; url?: string } | null }

const stageOf = (e: Ev): string =>
  e.stage_reached && e.stage_reached in STAGE_RANK ? e.stage_reached : ({ pick: 'taken', reject: 'put_back', walk_past: 'looked' } as Record<string, string>)[e.decision] ?? 'not_noticed';
const isSecondary = (e: Ev) => Boolean(e.secondary) || (e.reason ?? '').startsWith('(secondary');
const f2 = (x: unknown) => (typeof x === 'number' ? x.toFixed(2) : '?');
const txt = (x: unknown, ...keys: string[]) => {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') for (const k of keys) { const v = (x as Record<string, unknown>)[k]; if (typeof v === 'string') return v; }
  return '';
};

function meetings(run: Run, code: string): Meeting[] {
  const out: Meeting[] = [];
  for (const a of run.agents) {
    if (isAI(a)) continue;
    const evs = (a.events as Ev[]).filter((e) => e.product === code && e.mechanism !== 'error');
    if (!evs.length) continue;
    const e = evs.reduce((b, x) => {
      const rb = STAGE_RANK[stageOf(b)] * 2 + Number(!isSecondary(b)), rx = STAGE_RANK[stageOf(x)] * 2 + Number(!isSecondary(x));
      return rx > rb ? x : b;
    });
    out.push({ agent: a, event: e, group: GROUP_OF[stageOf(e)] });
  }
  return out;
}

/** round-robin over the groups (largest first), a different persona each where possible */
function pickPanel(rows: Meeting[], n = 6): Meeting[] {
  const by: Record<Group, Meeting[]> = { bought: [], put_back: [], walked_past: [], never_noticed: [] };
  for (const r of rows) by[r.group].push(r);
  const order = (Object.keys(by) as Group[]).sort((a, b) => by[b].length - by[a].length);
  const seen = new Set<string>(), out: Meeting[] = [];
  while (out.length < n && order.some((g) => by[g].length)) {
    for (const g of order) {
      if (out.length >= n || !by[g].length) continue;
      const pool = by[g];
      const fresh = pool.filter((r) => !seen.has(r.agent.persona_id) && r.event.jev) ;
      const r = fresh[0] ?? pool.find((x) => !seen.has(x.agent.persona_id)) ?? pool[0];
      pool.splice(pool.indexOf(r), 1);
      seen.add(r.agent.persona_id);
      out.push(r);
    }
  }
  return out;
}

const takeP = (e: Ev) => { const j = e.jev; return j?.self ? j.decision?.probabilities?.[j.self] : undefined; };
function fired(e: Ev, kind: 'trigger' | 'trust'): Fired[] {
  return Object.entries(e.jev?.nouls_fired ?? {}).filter(([k]) => k.startsWith(kind))
    .map(([key, v]) => ({ key, text: v.text ?? key, p: v.p ?? 0, source: v.source })).sort((a, b) => b.p - a.p);
}
function missingTrust(e: Ev, persona?: Persona): Fired[] {
  return Object.entries(e.jev?.nouls ?? {}).flatMap(([k, p]) => {
    const m = /^trust_(\d+)$/.exec(k);
    if (!m || p >= NOUL_FIRES) return [];
    const t = persona?.trust_signals?.[Number(m[1])];
    return t ? [{ key: k, text: txt(t, 'signal', 'trust'), p, source: txt(t, 'source') }] : [];
  }).sort((a, b) => a.p - b.p);
}

function answer(m: Meeting, persona: Persona | undefined, q: Qid): Answer {
  const e = m.event, st = stageOf(e), j = e.jev ?? {}, nf = (e.notice_factors ?? {}) as Record<string, unknown>;
  const pick = e.p_pick_up, take = takeP(e), trig = fired(e, 'trigger'), ap = j.appeal, mech = j.mechanism;
  const appealWord = (lvl?: number) => APPEAL_SHORT[lvl ?? 2] ?? 'indifferent';
  const fields: Record<string, unknown> = {};
  if (q === 'saw') {
    Object.assign(fields, { p_notice: e.p_notice, noticed: e.noticed, row: nf.row, facings: nf.facings, on_mission: nf.on_mission });
    const where = `${nf.row ?? '?'} shelf, ${nf.facings ?? '?'} facing${nf.facings === 1 ? '' : 's'}, ${nf.on_mission ? 'on my list today' : 'not on my list today'}`;
    return { inferred: false, fields, text: e.noticed ? `yes, I noticed it (P notice ${f2(e.p_notice)}; ${where}).` : `no. I had a P ${f2(e.p_notice)} chance of noticing it (${where}) and I missed it.` };
  }
  if (q === 'why_pick') {
    Object.assign(fields, { stage_reached: st, p_pick_up: pick, picked_up: e.picked_up });
    if (st === 'taken' || st === 'put_back') {
      const bits = [`I picked it up (P ${f2(pick)})`];
      if (mech?.choice) { const mp = mech.probabilities?.[mech.choice]; fields.mechanism = { choice: mech.choice, p: mp }; bits.push(`the reaction jev named was ${mech.choice.replace(/_/g, ' ')} (p ${f2(mp)})`); }
      if (ap) { fields.appeal = { level: ap.level, score: ap.score }; bits.push(`I felt '${appealWord(ap.level)}' about it (${f2(ap.score)}/4)`); }
      const tr = fired(e, 'trust');
      if (tr.length) { fields.trust_fired = tr; bits.push(`and it showed something I trust: ${tr[0].text} (p ${f2(tr[0].p)})`); }
      return { inferred: false, fields, text: bits.join(', ') + '.' };
    }
    return { inferred: false, fields, text: st === 'looked' ? `I didn't. I looked at it but only had a P ${f2(pick)} of picking it up, and the draw said no.` : "I didn't. I never noticed it on the shelf." };
  }
  if (q === 'why_back') {
    Object.assign(fields, { stage_reached: st, p_pick_up: pick, p_take: take });
    if (st === 'put_back') {
      let t = `I picked it up (P ${f2(pick)}) but put it back`;
      if (trig.length) { fields.triggers_fired = trig; t += `: it showed '${trig[0].text}' (p ${f2(trig[0].p)})`; }
      else if (ap) { fields.appeal = { level: ap.level, p_dislike_or_avoid: ap.p_dislike_or_avoid }; t += `: none of my put-offs fired, but I only felt '${appealWord(ap.level)}'`; }
      if (take !== undefined) t += `. my chance of taking it was P ${f2(take)}`;
      if (e.verbatim?.quote) fields.verbatim = e.verbatim;
      return { inferred: false, fields, text: t + '.', quote: e.verbatim };
    }
    return {
      inferred: false, fields,
      text: st === 'taken' ? `I didn't put it back: I took it (P take ${f2(take)}).` : st === 'looked' ? `I never had it in my hand: P pick up ${f2(pick)}, and the draw said leave it.` : 'I never saw it, so there was nothing to put back.',
    };
  }
  // change: inferred from what fired / what was missing in the record
  fields.stage_reached = st;
  const tips: string[] = [];
  if (st === 'not_noticed') {
    const terms = (nf.logit_terms ?? {}) as Record<string, number>;
    const neg = Object.entries(terms).filter(([k, v]) => typeof v === 'number' && v < 0 && k !== 'alpha0').sort((a, b) => a[1] - b[1]);
    Object.assign(fields, { p_notice: e.p_notice, logit_terms: terms });
    tips.push(neg.length ? `being easier to see: the biggest drag on my noticing it was '${neg[0][0]}' (${neg[0][1] >= 0 ? '+' : ''}${neg[0][1].toFixed(2)} on the logit)` : `being easier to see (P notice was ${f2(e.p_notice)})`);
  }
  if (trig.length) fields.triggers_fired = trig;
  for (const t of trig.slice(0, 2)) tips.push(`if it didn't show '${t.text}' (p ${f2(t.p)})`);
  const miss = missingTrust(e, persona);
  if (miss.length) { fields.trust_missing = miss; tips.push(`if it showed '${miss[0].text}' (it read as only p ${f2(miss[0].p)})`); }
  if (!tips.length) tips.push(st === 'taken' ? 'nothing: I took it' : 'the record has no fired put-off or missing trust signal to point at');
  return { inferred: true, fields, text: tips.join('; ') + '.' };
}

// ---- what-if (sim/interview.py whatif)
interface WhatIfRow {
  agent_id: string; name?: string; group?: Group; error?: string;
  recorded?: { stage_reached?: string; p_pick_up?: number | null; p_take_shelf_choice?: number | null };
  baseline?: { take: number; pickup: number; appeal_level: number }; whatif?: { take: number; pickup: number; appeal_level: number };
  delta_take?: number; delta_pickup?: number; engine?: string; calibrated?: boolean; model?: string; cached?: boolean; cost_usd?: number; cache_keys?: string[];
}
interface WhatIfResp { question: string; what_changed_words: string | null; notes: string[]; results: WhatIfRow[]; cost_usd: number; method: string; backend?: { active?: string; switched_reason?: string | null } }

async function postInterview(body: unknown): Promise<WhatIfResp> {
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  let res = await fetch('/api/interview', init).catch(() => null);
  if (!res || !(res.headers.get('content-type') ?? '').includes('json')) res = await fetch(`${SIM_SERVER}/api/interview`, init);
  const data = await res.json();
  if (!res.ok || data?.error) throw new Error(data?.error ?? `sim server answered ${res.status}`);
  return data as WhatIfResp;
}

const personaFile = (a: Agent, p?: Persona) => (p as unknown as { _file?: string } | undefined)?._file ?? `data/personas/lens/${a.archetype ?? a.persona_id.replace(/^p_/, '')}.json`;
const signed = (x?: number) => (typeof x === 'number' ? `${x >= 0 ? '+' : ''}${x.toFixed(2)}` : '–');

export function InterviewSection({ run, code, name, personas }: { run: Run; code: string; name: string; personas: Record<string, Persona> }) {
  const rows = useMemo(() => meetings(run, code), [run, code]);
  const panel = useMemo(() => pickPanel(rows), [rows]);
  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.key, rows.filter((r) => r.group === g.key).length])) as Record<Group, number>, [rows]);
  const [q, setQ] = useState<Qid>('why_back');
  const [wq, setWq] = useState(WHATIFS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [wi, setWi] = useState<WhatIfResp | null>(null);
  const runFile = `data/sim/runs/${run.run_id}.json`;

  if (!rows.length) return null;
  const ask = async () => {
    setBusy(true); setErr(null);
    try { setWi(await postInterview({ run_id: run.run_id, product: code, agents: panel.map((m) => m.agent.agent_id), question: wq })); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const colorOf = (g: Group) => GROUPS.find((x) => x.key === g)!.color;

  return (
    <section className="tile t-12 iv" aria-label="interview the shoppers">
      <h3 className="display">interview the shoppers <span className="muted">answers built only from each shopper's recorded event, no chat</span></h3>
      <ul className="iv-groups">
        {GROUPS.map((g) => <li key={g.key}><i style={{ background: g.color }} /> {g.label} <b>{counts[g.key]}</b></li>)}
      </ul>
      <div className="iv-qs" role="tablist" aria-label="question">
        {QUESTIONS.map((x) => <button key={x.key} role="tab" aria-selected={q === x.key} className={q === x.key ? 'on' : ''} onClick={() => setQ(x.key)}>{x.q}</button>)}
      </div>
      <ol className="iv-panel">
        {panel.map((m) => {
          const p = personas[m.agent.persona_id];
          const arch = m.agent.archetype ?? p?.archetype ?? m.agent.persona_id;
          const a = answer(m, p, q);
          return (
            <li key={m.agent.agent_id} className="iv-card">
              <div className="iv-who">
                <i className="iv-dot" style={{ background: archColor(arch) }} />
                <b>{p?.name ?? m.agent.persona_id}</b> <span className="muted">{archLabel(arch)} · {m.agent.agent_id}</span>
                <span className="iv-tag" style={{ borderColor: colorOf(m.group), color: colorOf(m.group) }}>{GROUPS.find((g) => g.key === m.group)!.label}</span>
              </div>
              <p className="iv-a">"{a.text}"{a.quote?.quote && <> like someone on reddit said: <q>{a.quote.quote.length > 160 ? a.quote.quote.slice(0, 160) + '…' : a.quote.quote}</q>{a.quote.url && <> (<a href={a.quote.url} target="_blank" rel="noreferrer">{shortUrl(a.quote.url)}</a>)</>}</>}</p>
              {a.inferred && <p className="iv-inf">inferred from the record (fired put-offs, missing trust signals, notice terms); this shopper was not asked.</p>}
              <details className="iv-src">
                <summary>source</summary>
                <p>run: <code>{runFile}</code> → agent <code>{m.agent.agent_id}</code>, step {m.event.step}, slot {m.event.slot} · engine {m.event.jev_model ?? m.event.engine ?? 'unknown'}</p>
                <p>persona: <code>{personaFile(m.agent, p)}</code></p>
                <pre>{JSON.stringify(a.fields, null, 1)}</pre>
              </details>
            </li>
          );
        })}
      </ol>

      <div className="iv-whatif">
        <h4>what if…? <span className="muted">optional, costs: re-asks jev for these {panel.length} shoppers</span></h4>
        <div className="iv-wi-row">
          {WHATIFS.map((w) => <button key={w} className={wq === w ? 'on' : ''} onClick={() => setWq(w)}>{w}</button>)}
          <input value={wq} onChange={(e) => setWq(e.target.value)} placeholder={`e.g. at £1.20? / with a high-fibre claim?`} aria-label="what if" maxLength={240} />
          <button className="iv-go" disabled={busy || !wq.trim()} onClick={ask}>{busy ? 'asking jev…' : 'ask jev (costs)'}</button>
        </div>
        {err && <p className="notice">{err}</p>}
        {wi && (
          <>
            {wi.what_changed_words && <p className="iv-words">jev was told, in words: <i>{wi.what_changed_words}</i></p>}
            {wi.notes.map((n) => <p key={n} className="iv-inf">{n}</p>)}
            {wi.results.some((r) => r.calibrated === false) && (
              <p className="notice">typesafe jev is out of credits, so these came from the jev-router fallback (a general llm self-reporting probabilities). <b>uncalibrated</b>: treat as a direction, not a number.</p>
            )}
            <table className="kv iv-table">
              <thead><tr><th>shopper</th><th title="the run's shelf choice: P(take) among the products on the shelf; a different question, for reference">recorded</th><th title="same questions, product card as recorded">baseline</th><th>what-if</th><th>Δ take</th><th>engine</th></tr></thead>
              <tbody>
                {wi.results.map((r) => (
                  <tr key={r.agent_id}>
                    <th>{r.name ?? r.agent_id} <span className="muted">{r.agent_id}</span></th>
                    {r.error ? <td colSpan={5} className="muted">{r.error}</td> : (
                      <>
                        <td>{f2(r.recorded?.p_take_shelf_choice)}</td>
                        <td>{f2(r.baseline?.take)}</td>
                        <td>{f2(r.whatif?.take)} <span className="muted">({APPEAL_SHORT[r.whatif?.appeal_level ?? 2]})</span></td>
                        <td className={(r.delta_take ?? 0) > 0 ? 'iv-up' : (r.delta_take ?? 0) < 0 ? 'iv-down' : ''}>{signed(r.delta_take)}</td>
                        <td><span className={`iv-eng ${r.calibrated ? 'engine-jev' : 'engine-router'}`} title={`${r.model ?? ''}${r.cached ? ' · cached' : ''} · cache ${r.cache_keys?.map((k) => k.slice(0, 10)).join(', ')}`}>{r.calibrated ? 'jev · calibrated' : 'jev-router · uncalibrated'}</span></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <details className="iv-src">
              <summary>how this was asked · cost ${wi.cost_usd.toFixed(4)}</summary>
              <p>{wi.method}</p>
              {wi.backend?.switched_reason && <p>backend switched: {wi.backend.switched_reason}</p>}
            </details>
          </>
        )}
      </div>
      <p className="iv-foot muted">{rows.length} shoppers passed {name} in <code>{run.run_id}</code>. the panel mixes outcomes, one per persona where possible. P = probability from the record; nothing here is generated text.</p>
    </section>
  );
}

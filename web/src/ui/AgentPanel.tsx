import { useMemo, useState } from 'react';
import type { Agent, Persona, Product, StoreConfig } from '../types';
import { isAI } from '../types';
import type { Timeline } from '../layout';
import { archColor, archLabel, DECISION, AI_COLOR, prodLabel } from '../theme';
import { Bar, Radar, Src, Sticker } from './bits';
import { aiArchOf, aiLabel, decidedBy } from './aiArch';
import {
  agentEngine, APPEAL_SHORT, basketTotal, ENGINE_TEXT, eventEngine, feedDistribution, gbp, liveState, pct, slotText,
  STAGE_TEXT, takeDistribution, triggerRows, type DistRow, type LiveAgent, type LiveEvent,
} from './agentLive';
import './engine.css';
import './agent-live.css';

interface Props {
  agent: Agent; persona?: Persona; products: Record<string, Product>;
  following: boolean; onFollow: () => void;
  onTrace: (agentId: string, step: number) => void; onClose: () => void;
  /** replay clock (seconds) and this shopper's timeline; without them the panel shows the finished trip */
  time?: number; timeline?: Timeline;
  /** for shelf row names ("eye", "top") in the 'about to buy' line */
  config?: StoreConfig;
}

const name = (p: Product | undefined, code: string) => prodLabel(p, code);

function Thumb({ p }: { p?: Product }) {
  return (
    <div className="al-thumb" style={{ background: p?.color ?? 'var(--surface-dim)' }}>
      {p?.image ? <img src={p.image} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : <span>{(p?.brand || '?').slice(0, 2)}</span>}
    </div>
  );
}

function DistList({ rows, color }: { rows: DistRow[]; color: string }) {
  if (!rows.length) return null;
  return (
    <ul className="al-dist">
      {rows.map((r) => (
        <li key={r.key} className={r.isSelf ? 'self' : ''}>
          <span className="al-dist-label" title={r.label}>{r.label}</span>
          <span className="al-dist-track"><span className="al-dist-fill" style={{ width: `${Math.max(1, r.p * 100)}%`, background: color }} /></span>
          <span className="al-dist-p">{pct(r.p)}{r.isSampled ? ' ←' : ''}</span>
        </li>
      ))}
    </ul>
  );
}

/** the recorded decision numbers for one event (jev funnel for shelf shoppers, feed Choice for AI agents, or the mock rule) */
export function DecisionNumbers({ e, agent, persona, products, color }: { e: LiveEvent; agent: Agent; persona?: Persona; products: Record<string, Product>; color: string }) {
  const a = agent as LiveAgent;
  const eng = eventEngine(e, a);
  const ai = isAI(agent);
  const j = e.jev;
  if (ai) {
    const fd = feedDistribution(a, e, products, name);
    return (
      <div className="al-numbers">
        {a.mission_text && <p className="al-mission">“{a.mission_text}” <span className="muted small">the prompt it was given</span></p>}
        <p className="small">feed item <b>#{e.position ?? '?'}</b> of {fd.feedLen ?? '?'}{a.picked_position != null ? <> · it chose <b>#{a.picked_position}</b></> : null}</p>
        {fd.rows.length ? (
          <>
            <h4>choice over the feed {fd.confidence != null && <span className="muted">confidence {pct(fd.confidence)}</span>}</h4>
            <DistList rows={fd.rows} color={color} />
            {fd.pNone != null && <p className="muted small">none of them: {pct(fd.pNone)} · ← = the one it took</p>}
          </>
        ) : eng === 'mock' ? <p className="muted small">rule-based shoppers: a rule picked this, no probabilities were recorded.</p> : <p className="muted small">no choice distribution recorded for this agent.</p>}
      </div>
    );
  }
  const dist = takeDistribution(e, products, name);
  const trig = triggerRows(e, persona);
  const appealLvl = j?.appeal?.level;
  return (
    <div className="al-numbers">
      <div className="al-kpis">
        {e.p_pick_up != null && <div><b>{pct(e.p_pick_up)}</b><span>p(pick up)</span></div>}
        <div><b>{pct(e.p_notice)}</b><span>p(notice)</span></div>
        {appealLvl != null && <div><b>{APPEAL_SHORT[appealLvl] ?? appealLvl}</b><span>appeal{j?.appeal?.score != null ? ` ${j.appeal.score.toFixed(1)}/4` : ''}</span></div>}
        {e.mechanism && <div><b>{e.mechanism.replace(/_/g, ' ')}</b><span>why{j?.mechanism?.confidence != null ? ` · ${pct(j.mechanism.confidence)}` : ''}</span></div>}
      </div>
      {e.stage_reached && <p className="small">got as far as: <b>{STAGE_TEXT[e.stage_reached] ?? e.stage_reached.replace(/_/g, ' ')}</b></p>}
      {dist.length > 0 && (
        <>
          <h4>which would they take? {j?.decision?.confidence != null && <span className="muted">confidence {pct(j.decision.confidence)}</span>}</h4>
          <DistList rows={dist} color={color} />
          <p className="muted small">bold = this product · ← = the draw</p>
        </>
      )}
      {trig.length > 0 && (
        <>
          <h4>what could put them off / win them over</h4>
          <ul className="al-trig">
            {trig.map((t) => (
              <li key={t.key} className={t.fired ? 'fired' : ''} title={t.source}>
                <span className={`al-trig-kind ${t.kind}`}>{t.kind}</span> {t.text} <b>{pct(t.p)}</b>{t.fired ? ' · fired' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
      {eng === 'mock' && <p className="muted small">rule-based shoppers: a fixed rule made this call, no model, no probabilities.</p>}
    </div>
  );
}

export function AgentPanel({ agent, persona, products, following, onFollow, onTrace, onClose, time, timeline, config }: Props) {
  const ai = isAI(agent);
  const la = agent as LiveAgent;
  const arch = ai ? aiArchOf(agent) : agent.archetype ?? persona?.archetype ?? '';
  const color = ai ? AI_COLOR : archColor(arch);
  const ocean = agent.ocean && Object.keys(agent.ocean).length ? agent.ocean : persona?.ocean;
  const [showSkipped, setShowSkipped] = useState(false);
  const evs = agent.events.filter((e) => showSkipped || e.decision !== 'not_noticed');
  const maxW = Math.max(0.01, ...(persona?.lens ?? []).map((l) => l.weight));
  const engine = useMemo(() => ENGINE_TEXT[agentEngine(la)], [la]);
  const st = liveState(agent, timeline, time);
  const spent = basketTotal(st.taken, products);
  const budget = la.budget_gbp ?? persona?.budget_gbp;
  const cur = st.current;
  const curP = cur ? products[cur.e.product] : undefined;
  const mission = agent.mission ?? persona?.mission;

  const whereText: Record<typeof st.where, string> = {
    not_in: 'not in the shop yet', shopping: 'nothing else planned: heading to the tills', tills: 'at the tills',
    cafe: 'in the café', leaving: 'on the way out', gone: 'done and gone',
  };

  return (
    <aside className="card panel" aria-label="shopper">
      <button className="x" onClick={onClose} aria-label="close panel">×</button>
      <header className="agent-head">
        <div className="avatar" style={{ background: color }}>{ai ? '🤖' : (persona?.name ?? '?').slice(0, 1)}</div>
        <div>
          <h2 className="display">{ai ? aiLabel(arch, persona) : persona?.name ?? agent.persona_id}</h2>
          {ai && <p className="muted small">{decidedBy(agent)}</p>}
          <div className="chips">
            <Sticker tone={ai ? 'ink' : 'white'}>{ai ? '🤖 ai agent' : archLabel(arch || 'unknown')}</Sticker>
            {mission && <Sticker>{String(mission).replace(/_/g, ' ')}</Sticker>}
            {budget != null && <Sticker title="budget minus catalogue prices of what is in the trolley so far">{gbp(Math.max(0, budget - spent.sum))} of £{budget} left</Sticker>}
            <span className={`engine-badge ${engine.css}`} title={engine.title}>{engine.text}</span>
          </div>
        </div>
      </header>
      <button className={`btn ${following ? 'btn-ink' : 'btn-white'}`} onClick={onFollow}>{following ? 'following' : 'follow with camera'}</button>

      <section className="al-now">
        <h3>{st.live ? (cur?.now ? 'thinking now' : 'last call') : 'last call they made'} {st.live && <span className="muted small">{st.done}/{st.total} shelf stops</span>}</h3>
        {cur ? (
          <>
            <button className="al-prod" onClick={() => onTrace(agent.agent_id, cur.e.step)} title="open the full trace">
              <Thumb p={curP} />
              <span>
                <b>{name(curP, cur.e.product)}</b>
                <span className="muted small">{slotText(cur.seg?.slot ?? cur.e.slot, config?.row_names)}{curP?.price_gbp != null ? ` · ${gbp(curP.price_gbp)}` : ''}</span>
                {!cur.now && <span className="al-dec" style={{ color: DECISION[cur.e.decision].color }}>{DECISION[cur.e.decision].emoji} {DECISION[cur.e.decision].label}</span>}
                {cur.now && <span className="al-dec muted">deciding…</span>}
              </span>
            </button>
            {cur.e.reason && <p className="al-reason">“{cur.e.reason}”</p>}
            <DecisionNumbers e={cur.e} agent={agent} persona={persona} products={products} color={color} />
          </>
        ) : <p className="muted small">{st.where === 'not_in' ? 'not in the shop yet.' : 'hasn\'t looked at anything yet.'}</p>}
      </section>

      {st.live && (
        <section>
          <h3>about to buy</h3>
          {st.next ? (
            <div className="al-prod static">
              <Thumb p={products[st.next.e.product]} />
              <span>
                <b>{name(products[st.next.e.product], st.next.e.product)}</b>
                <span className="muted small">{slotText(st.next.seg.slot ?? st.next.e.slot, config?.row_names)}{time !== undefined ? ` · in ${Math.max(0, Math.round(st.next.seg.t0 - time))} s` : ''}</span>
              </span>
            </div>
          ) : <p className="small">{whereText[st.where]}</p>}
          <p className="muted small">the next pick already recorded in this run.</p>
        </section>
      )}

      <section>
        <h3>in the trolley <span className="muted small">{st.taken.length} item{st.taken.length === 1 ? '' : 's'}{spent.priced ? ` · ${gbp(spent.sum)}` : ''}</span></h3>
        {st.taken.length ? (
          <ul className="al-items">
            {st.taken.map(({ e }) => (
              <li key={e.step}><button className="link-btn" onClick={() => onTrace(agent.agent_id, e.step)}>{name(products[e.product], e.product)}</button><span>{products[e.product]?.price_gbp != null ? gbp(products[e.product].price_gbp) : '–'}</span></li>
            ))}
          </ul>
        ) : <p className="muted small">empty so far.</p>}
        {spent.priced < spent.n && <p className="muted small">{spent.n - spent.priced} item(s) have no price in the catalogue.</p>}
        {st.putBack.length > 0 && (
          <>
            <h4>put back</h4>
            <ul className="al-items back">
              {st.putBack.map(({ e }) => (
                <li key={e.step}>
                  <button className="link-btn" onClick={() => onTrace(agent.agent_id, e.step)}>{name(products[e.product], e.product)}</button>
                  {e.reason && <span className="q">“{e.reason}”</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {ai && (
        <details className="al-more">
          <summary>how this agent shops</summary>
          <p className="pack">{persona?.acts_for ? `acts for ${persona.acts_for}. ` : ''}reads the catalogue as a feed (randomised order). it never sees shelf height, facings or the pack. only structured fields. <span className="muted">agent id {agent.agent_id}</span></p>
          {persona?.ocean_note && <p className="muted small">ocean: {persona.ocean_note}</p>}
          {agent.prompt_state && (<><h4>what it was told</h4><p className="dossier">{agent.prompt_state}</p></>)}
        </details>
      )}
      {!ai && (
        <details className="al-more">
          <summary>who they are</summary>
          {ocean && Object.keys(ocean).length > 0 && (
            <section className="ocean">
              <h3>ocean</h3>
              <div className="ocean-wrap">
                <Radar ocean={ocean} color={color} ghost={persona?.ocean !== ocean ? persona?.ocean : undefined} />
                <ul className="effects">
                  {(persona?.ocean_effects ?? []).map((e, i) => (
                    <li key={i}><b>{e.trait}</b> {e.effect} <span className="muted">coef {e.coef}</span><br /><Src s={e.source} /></li>
                  ))}
                </ul>
              </div>
              {persona?.ocean !== ocean && persona && <p className="muted small">dashed = persona base; solid = this agent's sampled ocean.</p>}
            </section>
          )}
          {persona?.lens && (
            <section>
              <h3>what they weigh</h3>
              {persona.lens.map((l) => (
                <div key={l.attribute} className="lens-row">
                  <Bar label={l.attribute.replace(/_/g, ' ')} value={l.weight} max={maxW} color={color} right={l.weight.toFixed(2)} />
                  <div className="why">{l.direction.replace(/_/g, ' ')}{l.why ? ` · ${l.why}` : ''} · <Src s={l.source} /></div>
                </div>
              ))}
            </section>
          )}
          {persona?.dossier && (<section><h3>dossier</h3><p className="dossier">{persona.dossier}</p></section>)}
          {!!persona?.verbatims?.length && (
            <section>
              <h3>in their own words</h3>
              {persona.verbatims.map((v, i) => (
                <blockquote key={i} className="verbatim">“{v.quote}” <a href={v.url} target="_blank" rel="noreferrer">r/{v.subreddit ?? 'reddit'} ↗</a></blockquote>
              ))}
            </section>
          )}
          {!persona && <p className="muted">no persona file entry for <code>{agent.persona_id}</code>. run <code>npm run sync</code> once personas.json exists.</p>}
        </details>
      )}

      <details className="al-more">
        <summary>whole trip <span className="muted small">{agent.events.length} stops</span></summary>
        <label className="toggle"><input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} /> show unnoticed</label>
        <ol className="journey">
          {evs.map((e) => {
            const p = products[e.product];
            const d = DECISION[e.decision];
            return (
              <li key={e.step}>
                <button className={`quote small${cur?.e.step === e.step ? ' al-cur' : ''}`} onClick={() => onTrace(agent.agent_id, e.step)}>
                  <span className="dec" style={{ color: d.color }}>{d.emoji}</span> <b>{prodLabel(p, e.product)}</b> <span className="muted">{e.slot} · p_notice {e.p_notice.toFixed(2)}</span>
                  {e.reason && <span className="q">“{e.reason}”</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </details>
    </aside>
  );
}

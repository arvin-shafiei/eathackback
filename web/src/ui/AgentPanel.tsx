import { useState } from 'react';
import type { Agent, Persona, Product } from '../types';
import { isAI } from '../types';
import { archColor, archLabel, DECISION, AI_COLOR, prodLabel } from '../theme';
import { Bar, Radar, Src, Sticker } from './bits';

interface Props {
  agent: Agent; persona?: Persona; products: Record<string, Product>;
  following: boolean; onFollow: () => void;
  onTrace: (agentId: string, step: number) => void; onClose: () => void;
}

export function AgentPanel({ agent, persona, products, following, onFollow, onTrace, onClose }: Props) {
  const ai = isAI(agent);
  const arch = agent.archetype ?? persona?.archetype ?? '';
  const color = ai ? AI_COLOR : archColor(arch);
  const ocean = agent.ocean && Object.keys(agent.ocean).length ? agent.ocean : persona?.ocean;
  const [showSkipped, setShowSkipped] = useState(false);
  const evs = agent.events.filter((e) => showSkipped || e.decision !== 'not_noticed');
  const picks = agent.events.filter((e) => e.decision === 'pick');
  const maxW = Math.max(0.01, ...(persona?.lens ?? []).map((l) => l.weight));

  return (
    <aside className="card panel" aria-label="shopper">
      <button className="x" onClick={onClose} aria-label="close panel">×</button>
      <header className="agent-head">
        <div className="avatar" style={{ background: color }}>{ai ? '🤖' : (persona?.name ?? '?').slice(0, 1)}</div>
        <div>
          <h2 className="display">{ai ? 'ai shopping agent' : persona?.name ?? agent.persona_id}</h2>
          <div className="chips">
            <Sticker tone={ai ? 'ink' : 'white'}>{ai ? agent.model : archLabel(arch || 'unknown')}</Sticker>
            {(agent.mission ?? persona?.mission) && <Sticker>{String(agent.mission ?? persona?.mission).replace(/_/g, ' ')}</Sticker>}
            {persona?.budget_gbp != null && <Sticker>£{persona.budget_gbp} budget</Sticker>}
            <Sticker tone="yellow">{picks.length} in basket</Sticker>
          </div>
        </div>
      </header>
      <button className={`btn ${following ? 'btn-ink' : 'btn-white'}`} onClick={onFollow}>{following ? 'following' : 'follow with camera'}</button>

      {ai ? (
        <p className="pack">reads the catalogue as a feed (randomised order). it never sees shelf height, facings or the pack. only structured fields. <span className="muted">agent id {agent.agent_id}</span></p>
      ) : (
        <>
          {ocean && (
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
          {persona?.dossier && (
            <section>
              <h3>dossier</h3>
              <p className="dossier">{persona.dossier}</p>
            </section>
          )}
          {!!persona?.verbatims?.length && (
            <section>
              <h3>in their own words</h3>
              {persona.verbatims.map((v, i) => (
                <blockquote key={i} className="verbatim">“{v.quote}” <a href={v.url} target="_blank" rel="noreferrer">r/{v.subreddit ?? 'reddit'} ↗</a></blockquote>
              ))}
            </section>
          )}
          {!persona && <p className="muted">no persona file entry for <code>{agent.persona_id}</code>. run <code>npm run sync</code> once personas.json exists.</p>}
        </>
      )}

      <section>
        <h3>their trip <label className="toggle"><input type="checkbox" checked={showSkipped} onChange={(e) => setShowSkipped(e.target.checked)} /> show unnoticed</label></h3>
        <ol className="journey">
          {evs.map((e) => {
            const p = products[e.product];
            const d = DECISION[e.decision];
            return (
              <li key={e.step}>
                <button className="quote small" onClick={() => onTrace(agent.agent_id, e.step)}>
                  <span className="dec" style={{ color: d.color }}>{d.emoji}</span> <b>{prodLabel(p, e.product)}</b> <span className="muted">{e.slot} · p_notice {e.p_notice.toFixed(2)}</span>
                  {e.reason && <span className="q">“{e.reason}”</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </aside>
  );
}

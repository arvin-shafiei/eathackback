import { useMemo, useState } from 'react';
import type { Arm, Persona, Product, Run } from '../types';
import { productStats, pct, wilson, archetypeOf } from '../stats';
import { archColor, archLabel, catColor, catLabel, DECISION, AI_COLOR } from '../theme';
import { Bar, Src, Sticker } from './bits';
import { isAI } from '../types';
import { aiArchOf, aiLabel, modelName, shopperLabel } from './aiArch';

interface Props {
  run: Run; product: Product; arm: Arm; personas: Record<string, Persona>; slot?: string;
  onTrace: (agentId: string, step: number) => void; onClose: () => void;
  onAnalytics: () => void;
}

export function ProductPanel({ run, product: p, arm, personas, slot, onTrace, onClose, onAnalytics }: Props) {
  const s = useMemo(() => productStats(run, p.code, arm, personas), [run, p.code, arm, personas]);
  const human = useMemo(() => productStats(run, p.code, 'human', personas), [run, p.code, personas]);
  const ai = useMemo(() => productStats(run, p.code, 'ai', personas), [run, p.code, personas]);
  const [showAll, setShowAll] = useState(false);
  const [showLens, setShowLens] = useState(false);
  const simStats = run.stats?.per_product?.[p.code];
  const funnel = [
    { k: 'shown', v: s.shown, why: 'agent stood at this slot' },
    { k: 'noticed', v: s.noticed, why: 'p_notice roll succeeded' },
    { k: 'picked up', v: s.considered, why: 'recorded handling, inferred from the decision in older runs' },
    { k: 'picked', v: s.picked, why: 'went in the basket' },
  ];
  const maxArch = Math.max(0.01, ...s.byArch.map((b) => b.rate));

  return (
    <aside className="card panel" aria-label={`product ${p.name}`}>
      <button className="x" onClick={onClose} aria-label="close panel">×</button>
      <header className="prod-head">
        <div className="prod-thumb" style={{ background: p.color || catColor(p.category) }}>
          {p.image ? <img src={p.image} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : <span>{(p.brand || '?').slice(0, 2)}</span>}
        </div>
        <div>
          <div className="eyebrowless muted">{catLabel(p.category)}{slot ? ` · ${slot}` : ''}</div>
          <h2 className="display">{p.brand} <span className="thin">{p.brand && p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? p.name.slice(p.brand.length).trim() : p.name}</span></h2>
          <div className="chips">
            <Sticker tone={p.role === 'challenger' ? 'yellow' : p.role === 'incumbent' ? 'ink' : 'white'}>{String(p.role).replace('_', ' ')}</Sticker>
            <Sticker title={p.price_source}>£{Number(p.price_gbp).toFixed(2)}</Sticker>
            {p.nova != null && <Sticker title="NOVA group (OFF field nova_group)">nova {p.nova}</Sticker>}
            {p.nutriscore && <Sticker title="OFF field nutriscore_grade">nutri {p.nutriscore}</Sticker>}
            {p.ecoscore && <Sticker title="OFF field ecoscore_grade">eco {p.ecoscore}</Sticker>}
            {p.fixture && <Sticker tone="bad" title="synthetic placeholder until the real catalog lands">fixture</Sticker>}
          </div>
        </div>
      </header>
      {p.pack_copy && <p className="pack">“{p.pack_copy}”</p>}
      <p className="src-line">price: <Src s={p.price_source} />{p.off_url && <> · <a href={p.off_url} target="_blank" rel="noreferrer">open food facts ↗</a></>}</p>
      <button className="btn btn-brand" onClick={onAnalytics}>view product analytics →</button>

      <section>
        <h3>pick rate <span className="muted">({arm === 'both' ? 'everyone' : arm === 'ai' ? 'ai agents' : 'humans'})</span></h3>
        <div className="big-num">
          <span className="display num">{pct(s.pick_rate)}</span>
          <span className="muted">95% ci {pct(s.ci95[0])}–{pct(s.ci95[1])} · n={s.shown}</span>
        </div>
        <Bar label="humans" value={human.pick_rate} ci={human.ci95} color="#2bb673" right={`${pct(human.pick_rate)} (${human.picked}/${human.shown})`} />
        <Bar label="ai agents" value={ai.pick_rate} ci={ai.ci95} color={AI_COLOR} right={`${pct(ai.pick_rate)} (${ai.picked}/${ai.shown})`} />
        {human.shown > 0 && ai.shown > 0 && (
          <p className="divergence">
            divergence <b>{ai.pick_rate - human.pick_rate >= 0 ? '+' : ''}{Math.round((ai.pick_rate - human.pick_rate) * 100)} pts</b>{' '}
            {Math.abs(ai.pick_rate - human.pick_rate) < 0.1 ? 'humans and agents roughly agree' : ai.pick_rate > human.pick_rate ? 'agents like it more than people do' : 'people like it more than agents do'}
          </p>
        )}
      </section>

      <section>
        <h3>funnel</h3>
        {funnel.map((f) => <Bar key={f.k} label={f.k} value={f.v} max={Math.max(1, s.shown)} color={f.k === 'picked' ? 'var(--good)' : undefined} right={f.v} />)}
        <Bar label="walked past" value={s.walk_past} max={Math.max(1, s.shown)} color={DECISION.walk_past.color} right={s.walk_past} />
        <Bar label="rejected" value={s.rejected} max={Math.max(1, s.shown)} color={DECISION.reject.color} right={s.rejected} />
      </section>

      <section>
        <h3>by archetype</h3>
        {s.byArch.map((b) => (
          <Bar key={b.key} label={shopperLabel(b.key)} value={b.rate} max={maxArch} color={archColor(b.key)} ci={wilson(b.picked, b.shown).map((x) => Math.min(x, maxArch)) as [number, number]} right={`${b.picked}/${b.shown}`} />
        ))}
        {!s.byArch.length && <p className="muted">nobody in this arm stood in front of it.</p>}
      </section>

      <section>
        <h3>why they put it back</h3>
        {s.rejects.slice(0, 4).map((r) => (
          <div key={r.mechanism} className="reason-group">
            <div className="reason-head"><Sticker tone="bad">{r.mechanism.replace(/_/g, ' ')}</Sticker> <span className="muted">×{r.items.length}</span></div>
            {r.items.slice(0, 3).map(({ agent, event }) => (
              <button key={agent.agent_id + event.step} className="quote" onClick={() => onTrace(agent.agent_id, event.step)}>
                <span className="dot" style={{ background: archColor(archetypeOf(agent, personas)) }} />
                “{event.reason}” <span className="muted">— {isAI(agent) ? `🤖 ${aiLabel(aiArchOf(agent), personas[agent.persona_id])} (${modelName(agent.model)})` : personas[agent.persona_id]?.name ?? agent.persona_id} · trace →</span>
              </button>
            ))}
          </div>
        ))}
        {!s.rejects.length && <p className="muted">no rejections in this arm.</p>}
      </section>

      <section>
        <button className="link-btn" onClick={() => setShowAll((v) => !v)}>{showAll ? 'hide' : 'show'} all {s.decisions.length} decisions</button>
        {showAll && s.decisions.map(({ agent, event }) => (
          <button key={agent.agent_id + event.step} className="quote small" onClick={() => onTrace(agent.agent_id, event.step)}>
            <span aria-hidden>{DECISION[event.decision].emoji}</span> {agent.agent_id} · {shopperLabel(archetypeOf(agent, personas))}: “{event.reason}”
          </button>
        ))}
      </section>

      {p.lens_grades && (
        <section>
          <button className="link-btn" onClick={() => setShowLens((v) => !v)}>{showLens ? 'hide' : 'show'} lens grades (how each archetype scores it)</button>
          {showLens && Object.entries(p.lens_grades).map(([k, g]) => (
            <div key={k} className="lens-row">
              <Bar label={archLabel(k)} value={Number(g?.score ?? 0)} color={archColor(k)} right={Number(g?.score ?? 0).toFixed(2)} />
              <div className="why">{(g?.why ?? []).join(' · ')}</div>
            </div>
          ))}
        </section>
      )}

      <footer className="prov">
        every number above is counted in your browser from the {s.shown} events in <code>{run.run_id}</code> that touched <code>{p.code}</code>; 95% ci is wilson (1927).
        {simStats && <> sim-reported pick rate: {pct(simStats.pick_rate)} [{pct(simStats.ci95?.[0] ?? 0)}–{pct(simStats.ci95?.[1] ?? 0)}].</>}
      </footer>
    </aside>
  );
}

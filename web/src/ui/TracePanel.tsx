import type { Agent, Persona, Product, Run, SimEvent } from '../types';
import { isAI } from '../types';
import { archColor, archLabel, DECISION, AI_COLOR, prodLabel } from '../theme';
import { Radar, Src, Sticker } from './bits';

interface Props {
  run: Run; agent: Agent; event: SimEvent; persona?: Persona; product?: Product;
  onAgent: () => void; onProduct: () => void; onBack?: () => void; onClose: () => void;
}

function valueOf(p: Product | undefined, attr: string) {
  if (!p) return '—';
  const v = p[attr];
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none';
  return String(v);
}

/** find a sourced coefficient in run.notice_model for a factor, if the sim exported one */
function noticeSource(run: Run, factor: string, value: unknown): string | undefined {
  const nm = run.notice_model as Record<string, any> | undefined;
  if (factor === 'trait_boost' || factor === 'trait_terms') return 'ocean_effects on the persona card (each with its own source)';
  if (!nm) return undefined;
  const pools = [nm, nm.derived ?? {}, nm.coefficients ?? {}];
  const alias: Record<string, string[]> = { row: ['row', 'alpha_row'], facings: ['facings', 'alpha_f'], centrality: ['centrality', 'alpha_c'], on_mission: ['mission', 'alpha_mission'], seconds_at_shelf: ['time', 'alpha_time'] };
  for (const pool of pools) for (const k of alias[factor] ?? [factor]) {
    const c = pool[k];
    if (!c) continue;
    if (factor === 'row' && typeof value === 'string' && c[value]?.source) return `${c[value].source} (α=${Number(c[value].value).toFixed(2)})`;
    if (c.source) return c.value !== undefined ? `${c.source} (α=${Number(c.value).toFixed(2)})` : c.source;
  }
  return undefined;
}
const fmtVal = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (Array.isArray(v)) return v.length ? v.map(fmtVal).join(', ') : 'none';
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} ${fmtVal(x)}`).join(' · ');
  return String(v);
};

export function TracePanel({ run, agent, event: e, persona, product, onAgent, onProduct, onBack, onClose }: Props) {
  const ai = isAI(agent);
  const arch = agent.archetype ?? persona?.archetype ?? '';
  const color = ai ? AI_COLOR : archColor(arch);
  const d = DECISION[e.decision];
  const ocean = agent.ocean && Object.keys(agent.ocean).length ? agent.ocean : persona?.ocean;
  return (
    <aside className="card panel" aria-label="decision trace">
      <button className="x" onClick={onClose} aria-label="close panel">×</button>
      {onBack && <button className="link-btn back" onClick={onBack}>← back</button>}
      <h2 className="display">the trace</h2>
      <p className="muted">one decision, every input that produced it. nothing here is a black box.</p>

      <div className="trace-hero">
        <div className="sticker big" style={{ ['--stk' as string]: d.color }}><span aria-hidden>{d.emoji}</span> {d.label}</div>
        {e.reason && <p className="trace-quote">“{e.reason}”</p>}
        <div className="chips">
          {e.feeling && <Sticker>feels {e.feeling}</Sticker>}
          {typeof e.sentiment === 'number' && <Sticker tone={e.sentiment > 0.1 ? 'good' : e.sentiment < -0.1 ? 'bad' : 'white'}>sentiment {e.sentiment.toFixed(2)}</Sticker>}
          {e.mechanism && <Sticker tone="ink">{e.mechanism.replace(/_/g, ' ')}</Sticker>}
        </div>
      </div>

      <ol className="trace-steps">
        <li>
          <h3>1 · who</h3>
          <button className="row-btn" onClick={onAgent}>
            <span className="dot" style={{ background: color }} />
            <b>{ai ? `ai agent · ${agent.model}` : persona?.name ?? agent.persona_id}</b>
            <span className="muted"> {ai ? 'reads a feed' : archLabel(arch)} · {agent.agent_id} · open card →</span>
          </button>
          {ocean && !ai && <div className="trace-radar"><Radar ocean={ocean} color={color} size={140} /></div>}
        </li>
        <li>
          <h3>2 · did they notice it?</h3>
          <div className="formula">{typeof (run.notice_model as any)?.formula === 'string' ? (run.notice_model as any).formula : 'p_notice = σ(α0 + α_row + α_f·ln(facings) + α_c·centrality + trait_boost)'} = <b>{e.p_notice.toFixed(2)}</b> → {e.noticed ? 'noticed' : 'not noticed'}</div>
          <table className="kv">
            <tbody>
              {Object.entries(e.notice_factors ?? {}).map(([k, v]) => (
                <tr key={k}><th>{k.replace(/_/g, ' ')}</th><td>{fmtVal(v)}</td><td>{k === 'logit_terms' ? <span className="src">each term's α is sourced in the run's notice_model</span> : <Src s={noticeSource(run, k, v)} />}</td></tr>
              ))}
            </tbody>
          </table>
        </li>
        <li>
          <h3>3 · what they looked at</h3>
          <button className="row-btn" onClick={onProduct}><b>{prodLabel(product, e.product)}</b> <span className="muted">{e.slot} · open product →</span></button>
          {(e.attributes_cited ?? []).length ? (
            <table className="kv">
              <tbody>
                {(e.attributes_cited ?? []).map((a) => (
                  <tr key={a}><th>{a}</th><td>{valueOf(product, a)}</td><td><span className="src">{product?.off_url ? <a href={product.off_url} target="_blank" rel="noreferrer">OFF · {a}</a> : 'catalog field'}</span></td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">no attributes cited{e.decision === 'not_noticed' ? ' (never noticed it)' : ''}.</p>}
          {arch && product?.lens_grades?.[arch] && (
            <p className="why">lens grade for {archLabel(arch)}: <b>{Number(product.lens_grades[arch].score).toFixed(2)}</b> ← {(product.lens_grades[arch].why ?? []).join(' · ')}</p>
          )}
        </li>
        <li>
          <h3>4 · why it went that way</h3>
          <p>mechanism: <b>{(e.mechanism ?? 'unspecified').replace(/_/g, ' ')}</b></p>
          <ul className="refs">
            {(e.source_refs ?? []).map((s, i) => <li key={i}><Src s={s} /></li>)}
            {!(e.source_refs ?? []).length && <li><Src s={undefined} /></li>}
          </ul>
        </li>
      </ol>
      <footer className="prov">run <code>{run.run_id}</code> · step {e.step} · model {agent.model ?? '—'}{run._fixture ? ' · fixture data (synthetic, for ui only)' : ''}</footer>
    </aside>
  );
}

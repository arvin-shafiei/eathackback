import { useState } from 'react';
import { useJSON } from '../lib/data';
import { S } from '../lib/src';
import { human, num, pct, signed, wilson } from '../lib/stats';
import { Card, ErrorBox, FootSrc, Loading, Sticker } from '../ui/bits';

type PB = { model: string; file: string; runs: number; picks: number; pick_at_1: number; positions: number[]; share_at_1: number; ci95: [number, number]; expected_share_at_1: number; mean_prob_at_1?: number; uniform_prob_at_1?: number; argmax_at_1?: number };
type Side = { picked: number; shown: number; share: number; pick_rate: number | null; ci95: number[] | null };
type Cat = { category: string; human_picks: number; agent_picks: number; jsd_bits: number | null; products: { code: string; name: string; brand?: string; role?: string; human: Side; agent: Side; divergence_log: number }[] };
type AIVH = {
  agent_file: string; human_file: string;
  agent_run: { run_id: string; created: string; models: string[]; n: number; cost: { usd: number }; missions: { id: string; text: string; categories: string[]; source: string }[] };
  human_run: { run_id: string; created: string; n: number; seed: number };
  feed_lengths: number[]; position_bias: PB[]; position_bias_llm_earlier: PB[]; categories: Cat[]; method: Record<string, string>;
};
const DF = 'web/public/data/dashboard/aivh.json';

export default function AiVsHuman() {
  const d = useJSON<AIVH>('aivh.json');
  if (d.loading) return <Loading what="the AI-agent comparison" />;
  if (d.error || !d.data) return <ErrorBox error={d.error || 'missing'} />;
  const a = d.data;
  const jev = a.position_bias[0];
  const all = [...a.position_bias, ...a.position_bias_llm_earlier.filter((x) => x.picks >= 20)];
  const maxPos = Math.max(...a.feed_lengths, ...(jev?.positions || [1]));
  const hist = Array.from({ length: maxPos }, (_, i) => (jev?.positions || []).filter((p) => p === i + 1).length);
  // expected picks at position k under "position doesn't matter": sum over feeds of 1/len if len >= k
  const expected = Array.from({ length: maxPos }, (_, i) => a.feed_lengths.reduce((s, L) => s + (L >= i + 1 ? 1 / L : 0), 0));
  const hMax = Math.max(...hist, ...expected, 1);
  const ciMax = Math.max(0.3, ...all.map((p) => p.ci95[1]));
  return (
    <div className="d-stack">
      <p className="d-lede">the same range, shopped by an <b>AI agent</b> reading a product feed and by <b>human-like shoppers</b> walking the shelf. agents can't see eye level and never walk away; do they pick differently? agent run <code>{a.agent_run.run_id}</code> ({a.agent_run.n} feeds), human run <code>{a.human_run.run_id}</code> ({a.human_run.n} shoppers).</p>
      <div className="d-two-wide">
        <Card title="position bias: is slot 1 over-picked?" sub="share of agent picks that landed on the first item of a shuffled feed, vs what chance predicts. 95% Wilson CI."
          foot={<FootSrc items={[[a.agent_file, 'position_bias.<model>'], ...a.position_bias_llm_earlier.filter((p) => p.picks >= 20).map((p) => [p.file, `position_bias.${p.model}`] as [string, string])]} />}>
          <ul className="d-pbias">
            {all.map((p) => {
              const x = (v: number) => `${(v / ciMax) * 100}%`;
              const isJev = /jev/.test(p.model);
              return (
                <li key={p.model + p.file}>
                  <span className="d-pbias-name">{p.model} {isJev ? <Sticker tone="ai">engine</Sticker> : <Sticker tone="dim">earlier, retired</Sticker>}</span>
                  <S as="div" src={{ file: p.file, field: `position_bias.${p.model}`, note: `${p.pick_at_1} of ${p.picks} picks at position 1 = ${pct(p.share_at_1, 1)} (CI ${pct(p.ci95[0], 1)}–${pct(p.ci95[1], 1)}); chance ${pct(p.expected_share_at_1, 1)} = mean 1/feed length. ${p.share_at_1 / p.expected_share_at_1 > 1.5 && p.ci95[0] > p.expected_share_at_1 ? `${num(p.share_at_1 / p.expected_share_at_1, 1)}× chance: biased` : 'CI includes chance: no clear bias'}`, kind: isJev ? 'jev' : 'data' }} className="d-pbias-track">
                    <span className="d-pbias-exp" style={{ left: x(p.expected_share_at_1) }} />
                    <span className={`d-pbias-ci ${isJev ? 'is-ai' : ''}`} style={{ left: x(p.ci95[0]), width: `calc(${x(p.ci95[1])} - ${x(p.ci95[0])})` }} />
                    <span className={`d-pbias-dot ${isJev ? 'is-ai' : ''}`} style={{ left: x(p.share_at_1) }} />
                  </S>
                  <span className="d-pbias-v"><b>{pct(p.share_at_1, 1)}</b> <small>{num(p.share_at_1 / p.expected_share_at_1, 1)}× chance · n={p.picks}</small></span>
                </li>
              );
            })}
          </ul>
          <p className="d-caption">the dashed line is chance ({pct(jev?.expected_share_at_1 ?? 0, 1)}, the mean of 1/feed length). runs with fewer than 20 picks are left out.</p>
        </Card>
        <Card title={`where ${jev?.model || 'jev'} picked, by feed position`} sub="bars = picks at each position; dots = expected under no position effect (each feed contributes 1/length to every position it has)."
          foot={<FootSrc items={[[a.agent_file, `position_bias.${jev?.model}.positions[]`], [a.agent_file, 'agents[].events.length (feed lengths)']]} />}>
          <div className="d-hist" role="img" aria-label="histogram of pick positions">
            {hist.map((h, i) => (
              <S key={i} as="div" className="d-hist-col" src={{ file: a.agent_file, field: `position_bias.${jev?.model}.positions`, note: `position ${i + 1}: ${h} picks; expected ${num(expected[i], 2)} if position didn't matter` }}>
                <div className="d-hist-bar" style={{ height: `${(h / hMax) * 100}%` }} />
                <div className="d-hist-exp" style={{ bottom: `${(expected[i] / hMax) * 100}%` }} />
              </S>
            ))}
          </div>
          <div className="d-hist-axis"><span>1</span><span>position in feed</span><span>{maxPos}</span></div>
        </Card>
      </div>
      <Card title="human vs agent: who picks what" sub={<>within each category, each product's share of picks. <b>D = ln(agent share / human share)</b>; positive = the agent over-picks it. only categories the agent missions cover.</>}
        foot={<FootSrc items={[[a.human_file, 'stats.per_product[code].picked'], [a.agent_file, 'stats.per_product[code].picked'], [DF, 'derived by web/scripts/sync-dashboard.mjs']]} />}>
        <div className="d-legend-inline"><span><i className="d-dot is-human" /> human shoppers</span><span><i className="d-dot is-ai" /> AI agent</span></div>
        <div className="d-cats">
          {a.categories.map((c) => <CatPanel key={c.category} c={c} a={a} />)}
        </div>
        <p className="d-caption">{a.method.divergence}. {a.method.jsd}. agent pick counts are small (one pick per feed), so read shares with the CI in the tooltip.</p>
      </Card>
    </div>
  );
}

function CatPanel({ c, a }: { c: Cat; a: AIVH }) {
  const [all, setAll] = useState(false);
  const ps = all ? c.products : c.products.slice(0, 6);
  const max = Math.max(0.2, ...c.products.map((p) => Math.max(p.human.share, p.agent.share)));
  const x = (v: number) => `${(v / max) * 100}%`;
  return (
    <div className={`d-cat ${c.agent_picks < 10 ? 'is-thin' : ''}`}>
      <div className="d-cat-head">
        <h4 className="d-h4">{human(c.category)}</h4>
        <S src={{ file: 'web/public/data/dashboard/aivh.json', field: `categories[${c.category}].jsd_bits`, note: `${a.method.jsd}. picks: human ${c.human_picks}, agent ${c.agent_picks}` }}>
          <small>JSD <b>{num(c.jsd_bits ?? NaN, 2)}</b> · n {c.human_picks} / {c.agent_picks}</small>
        </S>
      </div>
      {c.agent_picks < 10 ? <p className="d-thin">only {c.agent_picks} agent pick{c.agent_picks === 1 ? '' : 's'} here: too few to compare shares.</p> : null}
      <ul className="d-dumb">
        {ps.map((p) => {
          const [hl, hh] = wilson(p.human.picked, c.human_picks);
          const [al, ah] = wilson(p.agent.picked, c.agent_picks);
          const lo = Math.min(p.human.share, p.agent.share), hi = Math.max(p.human.share, p.agent.share);
          return (
            <li key={p.code}>
              <span className="d-dumb-name" title={p.name}>{p.name}{p.role === 'challenger' ? <i className="d-role d-role-challenger">ch</i> : null}</span>
              <span className="d-dumb-track">
                <span className="d-dumb-line" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})` }} />
                <S src={{ file: a.human_file, field: `stats.per_product[${p.code}].picked`, note: `human: ${p.human.picked} of ${c.human_picks} picks in ${human(c.category)} = ${pct(p.human.share, 1)} (95% CI ${pct(hl, 0)}–${pct(hh, 0)}); shown ${p.human.shown}×` }} className="d-dumb-pt is-human" style={{ left: x(p.human.share) }} />
                <S src={{ file: a.agent_file, field: `stats.per_product[${p.code}].picked`, note: `agent: ${p.agent.picked} of ${c.agent_picks} picks = ${pct(p.agent.share, 1)} (95% CI ${pct(al, 0)}–${pct(ah, 0)}); shown in ${p.agent.shown} feeds`, kind: 'jev' }} className="d-dumb-pt is-ai" style={{ left: x(p.agent.share) }} />
              </span>
              <S src={{ file: 'web/public/data/dashboard/aivh.json', field: `categories[${c.category}].products[${p.code}].divergence_log`, note: a.method.divergence }}>
                <span className={`d-dumb-d ${p.divergence_log > 0.7 ? 'is-ai' : p.divergence_log < -0.7 ? 'is-human' : ''}`}>{signed(p.divergence_log, 1)}</span>
              </S>
            </li>
          );
        })}
      </ul>
      {c.products.length > 6 ? <button className="d-btn d-btn-white d-btn-sm" onClick={() => setAll(!all)}>{all ? 'top 6' : `all ${c.products.length}`}</button> : null}
    </div>
  );
}

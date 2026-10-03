import { Fragment, useEffect, useState } from 'react';
import { useJSON } from '../lib/data';
import { S, urlsIn } from '../lib/src';
import { gbp, human, num, pct, signed } from '../lib/stats';
import { Card, ErrorBox, Ext, FootSrc, Loading, Seg, Sticker } from '../ui/bits';

type SwapIdx = { file: string; src: string; persona: string; name: string; n_top: number; basket_source: { source?: string; run_id?: string; agent_id?: string } }[];
type Prod = { code: string; name: string; brand?: string; off_url?: string; claims?: string[]; image?: string; role?: string };
type Swap = {
  basket_item: Prod; alternative: Prod; category: string; rank: number; rank_score: number; rank_formula: string; headline: string;
  lens: { archetype: string; basket: number; alternative: number; delta: number; why_basket: string[]; why_alternative: string[]; source: string };
  health_deltas: { field: string; basket: number; alternative: number; delta: number; better: boolean; words: string; source: string }[];
  price: { basket_price_gbp: number; alternative_price_gbp: number; delta_gbp: number; delta_pct: number; unit_delta_pct?: number; words: string; price_sources: string[]; price_is_assumption: boolean[] };
  claim_premium_context?: Record<string, number>;
  jev: { p_accept: number; p_price_worth: number; benefit: { score: number; probabilities: Record<string, number>; confidence: number; levels: string[] }; triggers: Record<string, { text: string; source?: string; p_alternative: number; p_basket_item: number }> };
};
type SwapFile = { persona: { id: string; name: string; archetype: string }; basket: { code: string; name: string; price_gbp: number; lens_score: number }[]; basket_source: Record<string, string>; method: Record<string, string>; top: Swap[]; cost?: { usd: number; usd_if_uncached: number; jev_requests: number } };
type Claim = { n_claim_products: number; n_categories: number; unit_price_premium_median_pct: number; unit_price_premium_ci95_bootstrap: number[]; n_unit: number; shelf_price_premium_median_pct: number; shelf_price_premium_ci95_bootstrap: number[]; share_claim_products_dearer_per_100: number; reg_1924_reality: Record<string, number> | null; method: string; products: { code: string; name: string; category: string; price_gbp: number; price_source: string; unit_premium_pct: number | null; shelf_premium_pct: number; reg_1924_check?: string; nutrition?: string; off_url: string }[] };
type CP = { regulation: string; catalog: Record<string, Claim>; off_uk_pool: Record<string, Record<string, number | string>> & { source: string }; catalog_price_caveat: string };

const CPF = 'data/sim/swaps/claim_premium.json';

export default function Shopper() {
  const idx = useJSON<SwapIdx>('swaps/index.json');
  const [file, setFile] = useState<string | null>(null);
  useEffect(() => { if (!file && idx.data?.length) setFile((idx.data.find((x) => /demo/.test(x.file)) || idx.data[0]).file); }, [idx.data, file]);
  const sw = useJSON<SwapFile>(file ? `swaps/${file}` : null);
  const visits = useJSON<{ file: string; src: string; mock: boolean }[]>('visits/index.json');
  if (idx.loading) return <Loading what="basket swaps" />;
  if (idx.error) return <ErrorBox error={idx.error} />;
  return (
    <div className="d-stack">
      <p className="d-lede">for a shopper: <b>what better option could I swap to?</b> ranked by P(accept) from jev × how much better the alternative fits their lens. price deltas are shown, and flagged when the price itself is an assumption.</p>
      <Card title="basket swaps" right={idx.data?.length ? (
        <Seg label="whose basket" value={file || ''} onChange={setFile} options={idx.data.map((x) => ({ id: x.file, label: <>{x.name} <small>{x.basket_source?.run_id ? 'from a sim run' : 'demo basket'}</small></> }))} />
      ) : null}
        foot={<FootSrc items={[[`data/sim/swaps/${file}`, 'top[]'], ['sim/swaps.py', 'ranking']]} />}>
        {sw.loading ? <Loading what="swaps" /> : sw.error ? <ErrorBox error={sw.error} /> : sw.data ? <Swaps s={sw.data} F={`data/sim/swaps/${file}`} /> : null}
      </Card>
      <ClaimPremium />
      {visits.data && visits.data.length ? <RouteCards v={visits.data[visits.data.length - 1]} /> : null}
    </div>
  );
}

function Swaps({ s, F }: { s: SwapFile; F: string }) {
  return (
    <>
      <p className="d-note">
        {s.persona.name} · {human(s.persona.archetype)} · basket of {s.basket.length}: {s.basket.map((b) => b.name).join(', ')}.
        {s.cost ? <> jev cost <S src={{ file: F, field: 'cost', note: `${s.cost.jev_requests} requests; $${num(s.cost.usd_if_uncached, 4)} if uncached` }}><b>${num(s.cost.usd, 4)}</b></S>.</> : null}
      </p>
      <ol className="d-swaps">
        {s.top.map((t, i) => {
          const asm = t.price.price_is_assumption.some(Boolean);
          const trig = Object.entries(t.jev.triggers).filter(([, v]) => v.p_basket_item > 0.5 || v.p_alternative > 0.5);
          return (
            <li key={i} className="d-card d-swap">
              <div className="d-swap-pair">
                <ProdTile p={t.basket_item} label="in the basket" />
                <span className="d-swap-arrow" aria-hidden>→</span>
                <ProdTile p={t.alternative} label="swap to" />
              </div>
              <div className="d-swap-nums">
                <S src={{ file: F, field: `top[${i}].jev.p_accept`, note: `jev Noul: would ${s.persona.name} accept this swap? ${s.method.jev || ''}`, kind: 'jev' }} className="d-swap-num">
                  <span className="d-big">{pct(t.jev.p_accept)}</span><span className="d-unit">P(accept)</span>
                </S>
                <S src={{ file: F, field: `top[${i}].lens.delta`, note: `${t.lens.source}. basket ${num(t.lens.basket)}: ${t.lens.why_basket.join(', ')} → alternative ${num(t.lens.alternative)}: ${t.lens.why_alternative.join(', ')}`, kind: 'off' }} className="d-swap-num">
                  <span className="d-big">{signed(t.lens.delta)}</span><span className="d-unit">lens gain</span>
                </S>
                <S src={{ file: F, field: `top[${i}].price.delta_gbp`, note: `${gbp(t.price.basket_price_gbp)} → ${gbp(t.price.alternative_price_gbp)} (${signed(t.price.delta_pct, 1)}%${t.price.unit_delta_pct !== undefined ? `, ${signed(t.price.unit_delta_pct, 1)}% per 100g/ml` : ''}). price sources: ${t.price.price_sources.join(' | ')}`, url: t.price.price_sources.flatMap((x) => urlsIn(x)), kind: asm ? 'assumption' : undefined }} className="d-swap-num">
                  <span className="d-big">{t.price.delta_gbp > 0 ? '+' : t.price.delta_gbp < 0 ? '−' : ''}£{Math.abs(t.price.delta_gbp).toFixed(2)}</span>
                  <span className="d-unit">price {asm ? <Sticker tone="yellow">assumption</Sticker> : null}</span>
                </S>
                <S src={{ file: F, field: `top[${i}].rank_score`, note: t.rank_formula }} className="d-swap-num">
                  <span className="d-big">{num(t.rank_score, 3)}</span><span className="d-unit">rank score</span>
                </S>
              </div>
              <div className="d-chips">
                {t.health_deltas.filter((h) => h.better).map((h) => (
                  <S key={h.field} src={{ file: F, field: `top[${i}].health_deltas[field=${h.field}]`, note: `${h.basket} → ${h.alternative} (${signed(h.delta, 1)}). ${h.source}`, url: urlsIn(h.source), kind: 'off' }}><span className="d-chip is-good">{h.words}</span></S>
                ))}
                {t.claim_premium_context ? Object.entries(t.claim_premium_context).map(([k, v]) => (
                  <S key={k} src={{ file: CPF, field: `catalog.${k}.unit_price_premium_median_pct`, note: `products claiming '${k}' cost a median ${v}% more per 100g than same-category products without the claim` }}><span className="d-chip">'{k}' claims cost +{v}%/100g</span></S>
                )) : null}
              </div>
              {trig.length ? (
                <ul className="d-reasons is-bad">
                  {trig.map(([k, v]) => (
                    <li key={k}><S src={{ file: F, field: `top[${i}].jev.triggers.${k}`, note: `jev P(card shows this): basket ${num(v.p_basket_item)} → alternative ${num(v.p_alternative)}. ${v.source || ''}`, url: urlsIn(v.source), kind: 'jev' }}>{v.text}</S> <small>{num(v.p_basket_item)} → {num(v.p_alternative)}</small></li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function ProdTile({ p, label }: { p: Prod; label: string }) {
  return (
    <div className="d-prod">
      {p.image ? <img src={p.image} alt="" loading="lazy" /> : <div className="d-prod-ph" aria-hidden />}
      <div>
        <span className="d-prod-label">{label}</span>
        <Ext href={p.off_url}><b>{p.name}</b></Ext>
        <small>{p.brand}{p.claims?.length ? ` · claims: ${p.claims.join(', ')}` : ''}</small>
      </div>
    </div>
  );
}

function ClaimPremium() {
  const cp = useJSON<CP>('swaps/claim_premium.json');
  const [open, setOpen] = useState<string | null>(null);
  if (cp.loading) return <Loading what="claim premiums" />;
  if (cp.error || !cp.data) return <ErrorBox error={cp.error || ''} />;
  const c = cp.data;
  const pool = c.off_uk_pool;
  const poolShare: Record<string, [string, number | undefined, string]> = {
    fibre: ['high_fibre', pool.high_fibre?.share_meeting_own_claim as number, 'of 423 UK products claiming high fibre meet the legal threshold'],
    protein: ['protein', pool.protein?.share_meeting_high as number, 'of UK products claiming protein meet the 20%-of-energy “high protein” bar'],
    no_added_sugar: ['no_added_sugar', pool.no_added_sugar?.share_low_sugar_5g as number, 'of “no added sugar” products are also low in total sugar (≤5g/100g)'],
  };
  return (
    <Card title="the claim premium" sub={<>what a health claim costs at the shelf: price of claim products vs the median of same-category products without the claim. <S src={{ file: CPF, field: 'catalog_price_caveat', note: c.catalog_price_caveat, kind: 'assumption' }}><b>most prices are assumptions</b></S>.</>}
      foot={<FootSrc items={[[CPF, 'catalog.<claim>, off_uk_pool'], ['data/products/uk_products.parquet', 'OFF UK pool']]} />}>
      <table className="d-table">
        <thead><tr><th>claim</th><th>products</th><th>per 100g premium (median, 95% CI)</th><th>shelf price premium</th><th>dearer per 100g</th><th>claims that meet the law (UK OFF pool)</th></tr></thead>
        <tbody>
          {Object.entries(c.catalog).map(([k, v]) => {
            const ps = poolShare[k];
            return (
              <Fragment key={k}>
                <tr className="d-row-click" onClick={() => setOpen(open === k ? null : k)}>
                  <th>{k.replace(/_/g, ' ')} <span className="d-caret">{open === k ? '−' : '+'}</span></th>
                  <td><S src={{ file: CPF, field: `catalog.${k}.n_claim_products`, note: `${v.n_categories} categories; ${v.n_unit} with a unit price` }}>{v.n_claim_products}</S></td>
                  <td><S src={{ file: CPF, field: `catalog.${k}.unit_price_premium_ci95_bootstrap`, note: `${v.method}; bootstrap 95% CI` }}><b>+{num(v.unit_price_premium_median_pct, 1)}%</b> <small>{num(v.unit_price_premium_ci95_bootstrap[0], 0)} to {num(v.unit_price_premium_ci95_bootstrap[1], 0)}%</small></S></td>
                  <td><S src={{ file: CPF, field: `catalog.${k}.shelf_price_premium_ci95_bootstrap`, note: v.method }}>+{num(v.shelf_price_premium_median_pct, 1)}% <small>{num(v.shelf_price_premium_ci95_bootstrap[0], 0)} to {num(v.shelf_price_premium_ci95_bootstrap[1], 0)}%</small></S></td>
                  <td><S src={{ file: CPF, field: `catalog.${k}.share_claim_products_dearer_per_100` }}>{pct(v.share_claim_products_dearer_per_100)}</S></td>
                  <td>{ps && ps[1] !== undefined ? <S src={{ file: CPF, field: `off_uk_pool.${ps[0]}`, note: `${ps[2]}. ${pool.source}` }}>{pct(ps[1])}</S> : v.reg_1924_reality ? <S src={{ file: CPF, field: `catalog.${k}.reg_1924_reality` }}>{Object.entries(v.reg_1924_reality).map(([a, b]) => `${b} ${a}`).join(', ')}</S> : <span className="d-muted">no nutrient threshold</span>}</td>
                </tr>
                {open === k ? (
                  <tr className="d-row-x"><td colSpan={6}>
                    <ul className="d-cp-products">
                      {v.products.map((p) => (
                        <li key={p.code}>
                          <Ext href={p.off_url}>{p.name}</Ext> <small>{human(p.category)}</small>
                          <S src={{ file: CPF, field: `catalog.${k}.products[code=${p.code}].unit_premium_pct`, note: `price ${gbp(p.price_gbp)}: ${p.price_source}`, kind: /^assumption/i.test(p.price_source) ? 'assumption' : undefined, url: urlsIn(p.price_source) }}>
                            <b>{p.unit_premium_pct === null ? '—' : `${p.unit_premium_pct > 0 ? '+' : ''}${num(p.unit_premium_pct, 0)}%`}</b>
                          </S>
                          {p.reg_1924_check ? <Sticker tone={p.reg_1924_check === 'none' ? 'bad' : 'dim'}>{p.reg_1924_check}{p.nutrition ? ` · ${p.nutrition}` : ''}</Sticker> : null}
                        </li>
                      ))}
                    </ul>
                  </td></tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {pool.unclaimed_fibre ? (
        <p className="d-note">
          the honest lever: <S src={{ file: CPF, field: 'off_uk_pool.unclaimed_fibre.n_qualify_high_fibre_but_dont_say_so', note: String(pool.unclaimed_fibre.note || '') }}><b>{Number(pool.unclaimed_fibre.n_qualify_high_fibre_but_dont_say_so).toLocaleString('en-GB')}</b></S> UK products qualify for “high fibre” but don't say so.
        </p>
      ) : null}
    </Card>
  );
}

type RouteCard = { key: string; archetype: string; visit: number; card: null | { lines: { kind: string; code: string; name: string; category: string; from: { unit: string; slot: string } | null; to: { unit: string; slot: string }; reason: string; evidence: Record<string, unknown>; assumptions?: string[] }[]; route: { stops: { unit: string; walkway: number }[]; metres: number; seconds: number; source: string }; posterior: { distribution: Record<string, number>; lens_from: string }; framing: string } };

function RouteCards({ v }: { v: { file: string; src: string; mock: boolean } }) {
  const d = useJSON<{ run_id: string; cards: RouteCard[] }>(`visits/${v.file}`);
  if (d.loading) return <Loading what="route cards" />;
  if (d.error || !d.data) return null;
  const cards = d.data.cards.filter((c) => c.card && c.card.lines.length).slice(0, 6);
  if (!cards.length) return null;
  return (
    <Card title="personal route cards" sub={<>what a returning shopper's next visit card would say: products that moved, and one new thing on their way. {v.mock ? <Sticker tone="bad">mock run: not jev evidence</Sticker> : null}</>}
      foot={<FootSrc items={[[v.src, 'cards[].card'], ['sim/routes.py', 'route + card logic']]} />}>
      <div className="d-routes">
        {cards.map((c, ci) => {
          const card = c.card!;
          const top = Object.entries(card.posterior.distribution).sort((a, b) => b[1] - a[1]).slice(0, 2);
          return (
            <div key={c.key} className="d-card d-route">
              <div className="d-route-head">
                <b>visit {c.visit}</b>
                <S src={{ file: v.src, field: `cards[${ci}].card.route`, note: card.route.source }}><span>{num(card.route.metres, 0)} m · {num(card.route.seconds / 60, 1)} min</span></S>
              </div>
              <p className="d-route-stops">{card.route.stops.map((s) => s.unit).join(' → ')}</p>
              <ul>
                {card.lines.map((l, li) => (
                  <li key={li}>
                    <Sticker tone={l.kind === 'new' ? 'brand' : 'white'}>{l.kind}</Sticker> <b>{l.name}</b>
                    <S src={{ file: v.src, field: `cards[${ci}].card.lines[${li}]`, note: `${l.reason}${l.assumptions?.length ? ' · assumptions: ' + l.assumptions.join('; ') : ''}`, kind: 'derived' }}>
                      <small className="d-route-reason">{l.from ? `${l.from.slot} → ` : ''}{l.to.slot}: {l.reason}</small>
                    </S>
                  </li>
                ))}
              </ul>
              <S src={{ file: v.src, field: `cards[${ci}].card.posterior.distribution`, note: `lens inferred from their past picks (${card.posterior.lens_from}); sensitive lenses are only used when declared. ${card.framing}` }}>
                <small className="d-muted">shops like: {top.map(([k, p]) => `${human(k)} ${pct(p)}`).join(', ')}</small>
              </S>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

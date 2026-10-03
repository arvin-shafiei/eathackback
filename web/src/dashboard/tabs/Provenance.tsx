import { useEffect, useMemo, useRef, useState } from 'react';
import { useJSON } from '../lib/data';
import { S } from '../lib/src';
import { human } from '../lib/stats';
import { Card, ErrorBox, Ext, FootSrc, Loading, Sticker } from '../ui/bits';
import { EVIDENCE, EvidenceMix } from '../ui/charts';

type GNode = { id: string; layer: number; layer_name: string; label: string; count: number; url?: string; kind?: string; primary_class?: string; persona?: string; source_class?: string; evidence_mix?: Record<string, number>; subreddit?: string; theme?: string; post_score?: number; family?: string };
type Evid = { verbatim: string; url?: string | null; score?: number; subreddit?: string; class?: string; verified_in_corpus?: boolean };
type GLink = { source: string; target: string; value: number; value_unit: string; method: string; evidence?: Evid[]; fields?: string[]; via_themes?: Record<string, number>; via_thread_ids?: string[] };
type Graph = { layers: string[]; value_units: Record<string, string>; nodes: GNode[]; links: GLink[]; source_nodes: Record<string, string> };
type Corpus = {
  totals: Record<string, number>;
  by_mechanism_family: { family: string; label: string; approx_count: number; coded_mechanisms: number }[];
  by_mechanism: { id: string; theme: string; mechanism: string; family: string; approx_count: number; top_verbatims: { url: string; subreddit: string; score: number; verbatim: string; verified_in_corpus?: boolean; selection?: string }[] }[];
};

const GF = 'data/provenance/graph.json';
const CF = 'data/provenance/corpus_stats.json';
const COLS = ['subreddit', 'thread', 'theme', 'mechanism / source', 'persona', 'attribute'];
const UNIT = ['comments', 'comments', 'coded count', 'attributes', 'attributes'];
const KIND_LABEL: Record<string, string> = { lens_weight: 'lens weights', sim_param: 'sim parameters', trigger: 'put-offs', trust_signal: 'trust signals', habit: 'habits', ocean_trait: 'OCEAN traits', profile: 'profile (budget, mission…)' };
const classColor = (c?: string) => EVIDENCE.find((e) => e.key === c)?.color || '#eb6834';

type VN = GNode & { x: number; y: number; h: number; inSum: number; outSum: number; members?: GNode[] };
type VL = GLink & { s: VN; t: VN; sy0: number; sy1: number; ty0: number; ty1: number; color: string };

function buildView(g: Graph, focus: string) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  let nodes: GNode[] = [];
  let links: GLink[] = [];
  if (focus === 'all') {
    nodes = g.nodes.filter((n) => n.layer < 5);
    links = g.links.filter((l) => (byId.get(l.target)?.layer ?? 0) < 5);
    // collapse the 1,159 attribute nodes into one node per attribute kind
    const agg = new Map<string, GNode & { members: GNode[] }>();
    const aggLinks = new Map<string, GLink>();
    for (const l of g.links) {
      const t = byId.get(l.target);
      if (!t || t.layer !== 5) continue;
      const k = t.kind || 'other';
      const id = `agg:${k}`;
      if (!agg.has(id)) agg.set(id, { id, layer: 5, layer_name: 'attribute', label: KIND_LABEL[k] || human(k), count: 0, kind: k, members: [] });
      const a = agg.get(id)!;
      a.count += 1; a.members.push(t);
      const key = `${l.source}|${id}`;
      const ex = aggLinks.get(key);
      if (ex) ex.value += l.value;
      else aggLinks.set(key, { source: l.source, target: id, value: l.value, value_unit: 'attributes', method: `aggregated in the dashboard: attributes of kind '${k}' (persona->attribute links, 1 per attribute)`, evidence: [] });
    }
    nodes = nodes.concat([...agg.values()]);
    links = links.concat([...aggLinks.values()]);
  } else {
    const pid = `persona:${focus}`;
    const inP = g.links.filter((l) => l.target === pid);
    const mechs = new Set(inP.map((l) => l.source));
    const themes = new Set(inP.flatMap((l) => Object.keys(l.via_themes || {}).map((t) => `theme:${t}`)));
    const threads = new Set(inP.flatMap((l) => (l.via_thread_ids || []).map((t) => `thr:${t}`)));
    const subs = new Set(g.links.filter((l) => threads.has(l.target) && l.source.startsWith('sub:')).map((l) => l.source));
    const attrs = new Set(g.links.filter((l) => l.source === pid).map((l) => l.target));
    const keep = new Set([pid, ...mechs, ...themes, ...threads, ...subs, ...attrs]);
    nodes = g.nodes.filter((n) => keep.has(n.id));
    links = g.links.filter((l) => keep.has(l.source) && keep.has(l.target));
  }
  return { nodes, links };
}

function layout(nodes: GNode[], links: GLink[], W: number, H: number) {
  const vn = new Map<string, VN>(nodes.map((n) => [n.id, { ...n, x: 0, y: 0, h: 0, inSum: 0, outSum: 0 }]));
  const ls = links.filter((l) => vn.has(l.source) && vn.has(l.target));
  for (const l of ls) { vn.get(l.source)!.outSum += l.value; vn.get(l.target)!.inSum += l.value; }
  const cols: VN[][] = [[], [], [], [], [], []];
  for (const n of vn.values()) cols[n.layer].push(n);
  // ordering: themes by size, then barycentres outward so ribbons cross less
  const idx = new Map<string, number>();
  const setIdx = (c: VN[]) => c.forEach((n, i) => idx.set(n.id, i));
  const inL = new Map<string, GLink[]>(), outL = new Map<string, GLink[]>();
  for (const l of ls) { (inL.get(l.target) || inL.set(l.target, []).get(l.target)!).push(l); (outL.get(l.source) || outL.set(l.source, []).get(l.source)!).push(l); }
  const baryMap = (c: VN[], dir: 'in' | 'out') => {
    const m = new Map<string, number>();
    for (const n of c) {
      let s = 0, w = 0;
      for (const l of (dir === 'in' ? inL.get(n.id) : outL.get(n.id)) || []) {
        const o = dir === 'in' ? l.source : l.target;
        if (idx.has(o)) { s += idx.get(o)! * l.value; w += l.value; }
      }
      m.set(n.id, w ? s / w : 1e9);
    }
    return m;
  };
  const sortBy = (c: VN[], dir: 'in' | 'out', pre?: (a: VN, b: VN) => number) => {
    const m = baryMap(c, dir);
    c.sort((a, b) => (pre ? pre(a, b) : 0) || m.get(a.id)! - m.get(b.id)! || b.count - a.count);
    setIdx(c);
  };
  cols[2].sort((a, b) => b.outSum + b.inSum - (a.outSum + a.inSum)); setIdx(cols[2]);
  sortBy(cols[1], 'out');
  sortBy(cols[0], 'out');
  sortBy(cols[3], 'in', (a, b) => (a.id.startsWith('src:') ? 1 : 0) - (b.id.startsWith('src:') ? 1 : 0));
  sortBy(cols[4], 'in');
  sortBy(cols[5], 'in');

  const nw = 10, labelRoom = 150;
  const step = (W - labelRoom - nw) / 5;
  cols.forEach((c, ci) => {
    if (!c.length) return;
    const gap = c.length > 80 ? 1 : c.length > 30 ? 2 : 5;
    const size = (n: VN) => (ci === 5 ? n.inSum : n.outSum || n.inSum * 0.0001) || 0;
    const tot = c.reduce((s, n) => s + size(n), 0) || 1;
    const avail = H - gap * (c.length - 1);
    let y = 0;
    for (const n of c) {
      n.h = Math.max(1.5, (size(n) / tot) * avail);
      n.x = ci * step; n.y = y; y += n.h + gap;
    }
    const over = y - gap - H;
    if (over > 0) { const k = H / (y - gap); for (const n of c) { n.y *= k; n.h *= k; } }
  });
  // ribbons: each end is the link's share of that node's out- (source) or in-flow (target) -> per-band scaling
  const outOff = new Map<string, number>(), inOff = new Map<string, number>();
  const sorted = [...ls].sort((a, b) => vn.get(a.target)!.y - vn.get(b.target)!.y || vn.get(a.source)!.y - vn.get(b.source)!.y);
  const vl: VL[] = [];
  for (const l of sorted) {
    const s = vn.get(l.source)!, t = vn.get(l.target)!;
    const sh = s.outSum ? (l.value / s.outSum) * s.h : 0;
    const so = outOff.get(s.id) || 0; outOff.set(s.id, so + sh);
    vl.push({ ...l, s, t, sy0: s.y + so, sy1: s.y + so + sh, ty0: 0, ty1: 0, color: '#eb6834' });
  }
  for (const l of [...vl].sort((a, b) => a.s.y - b.s.y)) {
    const th = l.t.inSum ? (l.value / l.t.inSum) * l.t.h : 0;
    const to = inOff.get(l.t.id) || 0; inOff.set(l.t.id, to + th);
    l.ty0 = l.t.y + to; l.ty1 = l.t.y + to + th;
    l.color = l.s.layer === 3 ? classColor(l.s.source_class || 'reddit') : l.s.layer === 4 ? (l.t.primary_class ? classColor(l.t.primary_class) : '#141014') : '#eb6834';
  }
  return { nodes: [...vn.values()], links: vl, nw, step };
}

export default function Provenance() {
  const g = useJSON<Graph>('provenance/graph.json');
  const cs = useJSON<Corpus>('provenance/corpus_stats.json');
  const [focus, setFocus] = useState('all');
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(640, Math.floor(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [g.data]);
  const H = focus === 'all' ? 860 : 620;
  const view = useMemo(() => (g.data ? buildView(g.data, focus) : null), [g.data, focus]);
  const lay = useMemo(() => (view ? layout(view.nodes, view.links, W, H) : null), [view, W, H]);
  const active = hover || sel;
  const lit = useMemo(() => {
    if (!lay || !active) return null;
    const up = new Map<string, string[]>(), down = new Map<string, string[]>();
    for (const l of lay.links) { (down.get(l.source) || down.set(l.source, []).get(l.source)!).push(l.target); (up.get(l.target) || up.set(l.target, []).get(l.target)!).push(l.source); }
    const seen = new Set([active]);
    const walk = (m: Map<string, string[]>, start: string) => { const st = [start]; while (st.length) { const x = st.pop()!; for (const y of m.get(x) || []) if (!seen.has(y)) { seen.add(y); st.push(y); } } };
    walk(up, active); walk(down, active);
    return seen;
  }, [lay, active]);

  if (g.loading) return <Loading what="the provenance graph (1.8 MB)" />;
  if (g.error) return <ErrorBox error={g.error} />;
  const graph = g.data!;
  const lensPersonas = graph.nodes.filter((n) => n.layer === 4);
  const selNode = lay?.nodes.find((n) => n.id === sel) || null;

  return (
    <div className="d-stack">
      <p className="d-lede">
        how a reddit comment becomes a number the sim uses: <b>subreddit → thread → theme → behavioural mechanism → persona → attribute</b>. non-reddit evidence (papers, open food facts, sales data, assumptions) enters at the mechanism column. hover to trace a path; click a node for its verbatims, urls and match method.
      </p>
      {cs.data ? <CorpusTotals c={cs.data} /> : null}
      <div className="d-prov">
        <Card className="d-prov-chart" title="where every persona attribute comes from"
          right={
            <label className="d-inline">focus
              <select className="d-select" value={focus} onChange={(e) => { setFocus(e.target.value); setSel(null); }} aria-label="focus on one persona">
                <option value="all">all personas (attributes grouped by kind)</option>
                {lensPersonas.map((p) => <option key={p.id} value={p.id.replace('persona:', '')}>{p.label}</option>)}
              </select>
            </label>
          }
          foot={<FootSrc items={[[GF, `nodes[${lay?.nodes.length}] · links[${lay?.links.length}] shown`]]} />}>
          <div ref={wrap} className="d-sankey-wrap">
            <div className="d-sankey-cols" style={{ gridTemplateColumns: `repeat(5, ${lay?.step ?? 100}px) 1fr` }}>
              {COLS.map((c, i) => <span key={c}>{c}{i < 5 ? <small> {UNIT[i]} →</small> : null}</span>)}
            </div>
            {lay ? (
              <svg width={W} height={H} className="d-sankey" role="img" aria-label="provenance sankey">
                <g>
                  {lay.links.map((l, i) => {
                    const x0 = l.s.x + lay.nw, x1 = l.t.x, xm = (x0 + x1) / 2;
                    const on = !lit || (lit.has(l.source) && lit.has(l.target));
                    return (
                      <path key={i} d={`M${x0},${l.sy0}C${xm},${l.sy0} ${xm},${l.ty0} ${x1},${l.ty0}L${x1},${l.ty1}C${xm},${l.ty1} ${xm},${l.sy1} ${x0},${l.sy1}Z`}
                        fill={l.color} className={`d-ribbon ${on ? (lit ? 'is-lit' : '') : 'is-dim'}`} />
                    );
                  })}
                </g>
                <g>
                  {lay.nodes.map((n) => {
                    const on = !lit || lit.has(n.id);
                    const showLabel = n.h >= 9 || n.id === active || (lit && lit.has(n.id) && n.layer >= 2);
                    const color = n.layer === 3 && n.source_class ? classColor(n.source_class) : n.layer === 5 && n.primary_class ? classColor(n.primary_class) : '#141014';
                    return (
                      <g key={n.id} className={`d-snode ${on ? '' : 'is-dim'} ${sel === n.id ? 'is-sel' : ''}`}
                        onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={() => setSel(sel === n.id ? null : n.id)}
                        tabIndex={0} role="button" aria-label={`${n.layer_name}: ${n.label}`} onKeyDown={(e) => e.key === 'Enter' && setSel(n.id)}>
                        <rect x={n.x} y={n.y} width={lay.nw} height={Math.max(1, n.h)} rx={2} fill={color} />
                        <rect x={n.x - 3} y={n.y - 2} width={lay.nw + 6} height={Math.max(5, n.h + 4)} fill="transparent" />
                        {showLabel ? (
                          <text x={n.x + lay.nw + 5} y={n.y + n.h / 2} dominantBaseline="central" className="d-snode-label">
                            {n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label}
                          </text>
                        ) : null}
                        <title>{`${n.layer_name}: ${n.label}`}</title>
                      </g>
                    );
                  })}
                </g>
              </svg>
            ) : null}
          </div>
          <p className="d-caption">
            <b>each band is scaled on its own.</b> the unit changes between columns: {Object.entries(graph.value_units).filter(([k]) => k !== 'note').map(([k, v]) => <span key={k}><code>{k}</code> {v}; </span>)}
            so a ribbon's thickness at each end shows its <i>share</i> of that node's flow, not a quantity you can compare across bands. ribbon colour = evidence class of the mechanism/source it passes through (reddit orange, paper blue, OFF aqua, assumption ink).
          </p>
        </Card>
        <aside className="d-prov-side">
          {selNode ? <NodePanel n={selNode} links={lay!.links} /> : (
            <Card title="click a node" sub="the panel shows its count, its links with match method and value, and the verbatims or citations behind each link.">
              <ul className="d-steps"><li>start at a <b>persona</b> to see which mechanisms feed it</li><li>pick <b>assumption</b> (ink, bottom of the mechanism column) to see what is not evidenced</li><li>use <b>focus</b> to trace one persona all the way back to threads</li></ul>
            </Card>
          )}
        </aside>
      </div>
      {cs.data ? <TopVerbatims c={cs.data} /> : cs.error ? <ErrorBox error={cs.error} /> : null}
    </div>
  );
}

function CorpusTotals({ c }: { c: Corpus }) {
  const t = c.totals;
  const items: [string, string, string][] = [
    ['threads', 'threads', 'reddit threads collected (data/reddit/)'],
    ['comments', 'comments', 'comments in data/reddit/comments.csv'],
    ['subreddits', 'subreddits', 'distinct subreddits'],
    ['themes', 'themes', 'search themes the threads were collected under'],
    ['coded_mechanisms', 'coded mechanisms', 'behavioural mechanisms coded from the comments (research/03-reddit-coded.json)'],
    ['coder_verbatims_located_in_corpus', 'verbatims re-found', `coder verbatims located verbatim in the corpus, of ${t.coder_verbatims}`],
  ];
  return (
    <div className="d-totals">
      {items.map(([k, label, note]) => (
        <S key={k} src={{ file: CF, field: `totals.${k}`, note }} className="d-total">
          <span className="d-total-v">{(t[k] ?? 0).toLocaleString('en-GB')}</span>
          <span className="d-total-k">{label}{k === 'coder_verbatims_located_in_corpus' ? ` / ${t.coder_verbatims}` : ''}</span>
        </S>
      ))}
    </div>
  );
}

function NodePanel({ n, links }: { n: VN; links: VL[] }) {
  const inL = links.filter((l) => l.target === n.id).sort((a, b) => b.value - a.value);
  const outL = links.filter((l) => l.source === n.id).sort((a, b) => b.value - a.value);
  const unitNote: Record<number, string> = { 0: 'comments in this subreddit', 1: 'comments in this thread', 2: 'comments under this theme', 3: n.id.startsWith('src:') ? 'persona attributes citing this source class' : 'summed approx_count of coded mechanisms in this family', 4: 'attributes in this persona', 5: 'attributes' };
  return (
    <Card title={n.label} sub={<><Sticker tone="ink">{n.layer_name}</Sticker> {n.subreddit ? <Sticker>r/{n.subreddit}</Sticker> : null} {n.post_score ? <Sticker tone="dim">{n.post_score} upvotes</Sticker> : null}</>}
      foot={<FootSrc items={[[GF, `nodes[id=${n.id}]`]]} />}>
      <p className="d-node-count">
        <S src={{ file: GF, field: `nodes[id=${n.id}].count`, note: unitNote[n.layer] }}><b className="d-big">{n.count.toLocaleString('en-GB')}</b></S> <span className="d-unit">{unitNote[n.layer]}</span>
      </p>
      {n.url ? <p><Ext href={n.url}>{n.url.replace(/^https?:\/\/(www\.)?/, '')}</Ext></p> : null}
      {n.evidence_mix ? <EvidenceMix mix={n.evidence_mix} src={{ file: GF, field: `nodes[id=${n.id}].evidence_mix` }} /> : null}
      {n.members ? (
        <>
          <h4 className="d-h4">{n.members.length} attributes · by strongest evidence class</h4>
          <ul className="d-classcount">
            {Object.entries(n.members.reduce<Record<string, number>>((m, a) => { const k = a.primary_class || '?'; m[k] = (m[k] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k}><i className="d-swatch" style={{ ['--c' as string]: classColor(k) }} />{human(k)} <b>{v}</b></li>
            ))}
          </ul>
        </>
      ) : null}
      <LinkList title="flows in" ls={inL} other={(l) => l.s} />
      <LinkList title="flows out" ls={outL} other={(l) => l.t} />
    </Card>
  );
}

function LinkList({ title, ls, other }: { title: string; ls: VL[]; other: (l: VL) => VN }) {
  const [all, setAll] = useState(false);
  if (!ls.length) return null;
  const shown = all ? ls : ls.slice(0, 6);
  return (
    <div className="d-linklist">
      <h4 className="d-h4">{title} <span className="d-h4-note">{ls.length} links</span></h4>
      <ul>
        {shown.map((l, i) => (
          <li key={i}>
            <div className="d-link-head">
              <span>{other(l).label}</span>
              <S src={{ file: GF, field: `links[source=${l.source},target=${l.target}].value`, note: `match method: ${l.method}${l.fields?.length ? ` · fields: ${l.fields.slice(0, 8).join(', ')}${l.fields.length > 8 ? '…' : ''}` : ''}` }}>
                <b>{l.value.toLocaleString('en-GB')}</b> <small>{l.value_unit}</small>
              </S>
            </div>
            <p className="d-link-method">{l.method}</p>
            {(l.evidence || []).slice(0, 2).map((e, j) => (
              <blockquote key={j} className="d-evq">
                “{e.verbatim}”{' '}
                {e.url ? <Ext href={e.url}>{e.subreddit ? `r/${e.subreddit}` : 'link'}{e.score !== undefined ? ` · ${e.score}↑` : ''}</Ext> : e.class ? <Sticker tone="dim">{human(e.class)}</Sticker> : null}
              </blockquote>
            ))}
          </li>
        ))}
      </ul>
      {ls.length > 6 ? <button className="d-btn d-btn-white d-btn-sm" onClick={() => setAll(!all)}>{all ? 'show fewer' : `show all ${ls.length}`}</button> : null}
    </div>
  );
}

function TopVerbatims({ c }: { c: Corpus }) {
  const [fam, setFam] = useState(c.by_mechanism_family[0]?.family);
  const max = Math.max(...c.by_mechanism_family.map((f) => f.approx_count));
  const mechs = c.by_mechanism.filter((m) => m.family === fam).sort((a, b) => b.approx_count - a.approx_count);
  const quotes = mechs.flatMap((m) => m.top_verbatims.map((v) => ({ ...v, mech: m }))).sort((a, b) => b.score - a.score).slice(0, 6);
  const fi = c.by_mechanism_family.findIndex((f) => f.family === fam);
  return (
    <Card title="what people actually said, by mechanism" sub="approx. coded comment counts per behavioural mechanism family; pick one to read its highest-voted verbatims."
      foot={<FootSrc items={[[CF, 'by_mechanism_family[].approx_count, by_mechanism[].top_verbatims']]} />}>
      <div className="d-fam">
        <ul className="d-fam-list">
          {c.by_mechanism_family.map((f, i) => (
            <li key={f.family}>
              <button className={`d-fam-btn ${f.family === fam ? 'is-on' : ''}`} onClick={() => setFam(f.family)}>
                <span className="d-fam-name">{f.label}</span>
                <span className="d-lens-track"><span className="d-lens-fill" style={{ width: `${(f.approx_count / max) * 100}%` }} /></span>
                <S src={{ file: CF, field: `by_mechanism_family[${i}].approx_count`, note: `${f.coded_mechanisms} coded mechanisms; counts are the coders' approximate comment counts (directional: reddit over-represents label-readers)` }}><b>{f.approx_count}</b></S>
              </button>
            </li>
          ))}
        </ul>
        <div className="d-fam-quotes">
          {quotes.length ? quotes.map((q, i) => (
            <figure key={i} className="d-fq">
              <blockquote>“{q.verbatim}”</blockquote>
              <figcaption>
                <Ext href={q.url}>r/{q.subreddit}</Ext> · <S src={{ file: CF, field: `by_mechanism[id=${q.mech.id}].top_verbatims[].score`, note: `reddit comment score; ${q.verified_in_corpus ? 'verified verbatim in data/reddit/comments.csv' : 'not re-found in the corpus'}; selection: ${q.selection || '—'}`, url: q.url }}>{q.score}↑</S>
                {' · '}<span className="d-muted">{q.mech.mechanism.slice(0, 90)}{q.mech.mechanism.length > 90 ? '…' : ''}</span>
              </figcaption>
            </figure>
          )) : <p className="d-note">no verbatims located for this family{fi >= 0 ? '' : ''}.</p>}
        </div>
      </div>
    </Card>
  );
}

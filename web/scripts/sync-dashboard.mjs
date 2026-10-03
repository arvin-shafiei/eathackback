#!/usr/bin/env node
// Copies (and, where a file is too big to ship, derives) the data the dashboard reads into
// web/public/data/dashboard/. Every derived number keeps a pointer to the file + field it came from.
//   node scripts/sync-dashboard.mjs
// Owned by the dashboard page only (never touches web/public/data/* outside dashboard/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.resolve(HERE, '..', 'public', 'data', 'dashboard');
const D = (...p) => path.join(ROOT, 'data', ...p);
const rel = (abs) => path.relative(ROOT, abs);

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const exists = (p) => fs.existsSync(p);
const ls = (dir, re = /\.json$/) => (exists(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).sort() : []);
function write(name, obj) {
  const fp = path.join(OUT, name);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj));
  return fp;
}
function copy(src, name) {
  const fp = path.join(OUT, name);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.copyFileSync(src, fp);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const manifest = { synced: new Date().toISOString(), script: 'web/scripts/sync-dashboard.mjs', files: {} };
const note = (out, src, how = 'copy') => (manifest.files[out] = { src, how });

// ---------------------------------------------------------------- personas
const personas = [];
for (const [dir, custom] of [[D('personas', 'lens'), false], [D('personas', 'custom'), true]]) {
  for (const f of ls(dir)) {
    const p = readJSON(path.join(dir, f));
    personas.push({ ...p, _file: rel(path.join(dir, f)), _custom: custom });
  }
}
write('personas.json', personas);
note('personas.json', 'data/personas/lens/*.json + data/personas/custom/*.json', 'concatenated, each item keeps _file');

const ocean = {};
for (const t of 'OCEAN') {
  const fp = D('personas', 'ocean', `${t}.json`);
  if (exists(fp)) ocean[t] = { ...readJSON(fp), _file: rel(fp) };
}
write('ocean.json', ocean);
note('ocean.json', 'data/personas/ocean/{O,C,E,A,N}.json', 'merged by trait');

// ---------------------------------------------------------------- provenance
const provDir = D('provenance');
for (const f of ['graph.json', 'corpus_stats.json']) {
  if (exists(path.join(provDir, f))) { copy(path.join(provDir, f), `provenance/${f}`); note(`provenance/${f}`, `data/provenance/${f}`); }
}
for (const f of ls(path.join(provDir, 'personas'))) {
  copy(path.join(provDir, 'personas', f), `provenance/personas/${f}`);
}
note('provenance/personas/*.json', 'data/provenance/personas/*.json');

// ---------------------------------------------------------------- catalog (slim, for name/category lookups)
const catalog = {};
for (const f of ['catalog.json']) {
  const fp = D('products', f);
  if (!exists(fp)) continue;
  const c = readJSON(fp);
  for (const p of Array.isArray(c) ? c : c.products || []) {
    catalog[p.code] = {
      name: p.name, brand: p.brand, category: p.category, role: p.role, price_gbp: p.price_gbp,
      price_source: p.price_source, off_url: p.off_url, image: p.image,
    };
  }
}
write('catalog_min.json', { _src: 'data/products/catalog.json', products: catalog });
note('catalog_min.json', 'data/products/catalog.json', 'name/brand/category/role/price/off_url per code');

// OFF fields the persona builder may pick. Must be keys of catalog.json (sim/server.py validates that),
// and must come from Open Food Facts (not curator fields such as price_gbp/role/pack_copy).
const OFF_FIELDS = {
  sugars_100g: { label: 'sugars per 100g', unit: 'g', off: 'nutriments.sugars_100g', dir: 'lower_better' },
  fiber_100g: { label: 'fibre per 100g', unit: 'g', off: 'nutriments.fiber_100g', dir: 'higher_better' },
  proteins_100g: { label: 'protein per 100g', unit: 'g', off: 'nutriments.proteins_100g', dir: 'higher_better' },
  salt_100g: { label: 'salt per 100g', unit: 'g', off: 'nutriments.salt_100g', dir: 'lower_better' },
  energy_kcal_100g: { label: 'energy per 100g', unit: 'kcal', off: 'nutriments.energy-kcal_100g', dir: 'lower_better' },
  nova: { label: 'NOVA processing group (1-4)', unit: '', off: 'nova_group', dir: 'lower_better' },
  nutriscore: { label: 'Nutri-Score grade (a-e)', unit: '', off: 'nutriscore_grade', dir: 'lower_better' },
  ecoscore: { label: 'eco-score / Green-Score (a-e)', unit: '', off: 'ecoscore_grade', dir: 'lower_better' },
  additives_n: { label: 'number of additives', unit: '', off: 'additives_n', dir: 'lower_better' },
  sweeteners: { label: 'sweetener additives (count)', unit: '', off: 'additives_tags (e950/e951/e955/e960/e965…)', dir: 'lower_better' },
  palm_oil_n: { label: 'palm-oil ingredients (count)', unit: '', off: 'ingredients_from_palm_oil_n', dir: 'lower_better' },
  ingredients_n: { label: 'number of ingredients', unit: '', off: 'ingredients_n', dir: 'lower_better' },
  labels: { label: 'labels (organic, vegan, fairtrade…)', unit: '', off: 'labels_tags', dir: 'present_better' },
  allergens: { label: 'allergens', unit: '', off: 'allergens_tags', dir: 'absence_better' },
  completeness: { label: 'OFF data completeness (0-1)', unit: '', off: 'completeness', dir: 'higher_better' },
};
{
  const fp = D('products', 'catalog.json');
  const c = exists(fp) ? readJSON(fp) : [];
  const items = Array.isArray(c) ? c : c.products || [];
  const keys = new Set(items.flatMap((p) => Object.keys(p)));
  const fields = Object.entries(OFF_FIELDS)
    .filter(([k]) => keys.has(k))
    .map(([k, v]) => {
      const vals = items.map((p) => p[k]).filter((x) => x !== null && x !== undefined && !(Array.isArray(x) && x.length === 0));
      const nums = vals.filter((x) => typeof x === 'number');
      return {
        field: k, ...v, n_non_null: vals.length, n_products: items.length,
        min: nums.length ? Math.min(...nums) : null, max: nums.length ? Math.max(...nums) : null,
        example: vals[0] ?? null,
      };
    });
  write('off_fields.json', { _src: 'data/products/catalog.json (keys) — allow-list of OFF-derived fields in web/scripts/sync-dashboard.mjs', fields });
  note('off_fields.json', 'data/products/catalog.json', 'OFF field allow-list intersected with catalog keys, with coverage counts');
}

// ---------------------------------------------------------------- retailer (layout optimiser)
const layoutDir = D('sim', 'layout');
for (const f of ls(layoutDir, /^(summary|report_.*)\.json$/)) {
  copy(path.join(layoutDir, f), `layout/${f}`);
  note(`layout/${f}`, `data/sim/layout/${f}`);
}

// ---------------------------------------------------------------- brand
const brandDir = D('sim', 'brand');
const brandIndex = [];
for (const f of ls(brandDir)) {
  const b = readJSON(path.join(brandDir, f));
  if (!b.code) continue;
  copy(path.join(brandDir, f), `brand/${f}`);
  brandIndex.push({
    code: b.code, name: b.name, brand: b.brand, category: b.category, role: b.role,
    shown: b.funnel?.shown, take: b.funnel?.take?.rate, stage: b.diagnosis?.stage ?? null,
    niq: (b.benchmark?.nielseniq || []).length > 0, file: `data/sim/brand/${f}`,
  });
}
write('brand/index.json', brandIndex);
note('brand/index.json', 'data/sim/brand/*.json', 'one row per product: code, name, funnel.take.rate, diagnosis.stage');
// pack test: sim/pack_test.py writes data/sim/brand/pack_test/<code>.json + index.json
const packDir = path.join(brandDir, 'pack_test');
const packCodes = [];
for (const f of ls(packDir)) {
  copy(path.join(packDir, f), `pack_test/${f}`);
  if (f !== 'index.json') packCodes.push(f.replace('.json', ''));
}
note('pack_test/*.json', 'data/sim/brand/pack_test/*.json');

// ---------------------------------------------------------------- shopper (swaps + visits)
const swapDir = D('sim', 'swaps');
const swapIndex = [];
for (const f of ls(swapDir)) {
  copy(path.join(swapDir, f), `swaps/${f}`);
  if (f === 'claim_premium.json') continue;
  const s = readJSON(path.join(swapDir, f));
  swapIndex.push({ file: f, src: `data/sim/swaps/${f}`, persona: s.persona?.id, name: s.persona?.name, n_top: (s.top || []).length, basket_source: s.basket_source });
}
write('swaps/index.json', swapIndex);
note('swaps/*.json', 'data/sim/swaps/*.json');
const visitDir = D('sim', 'visits');
const visits = [];
// route cards only (sim/routes.py writes <run>.cards.json next to the multi-MB raw visit log)
for (const f of ls(visitDir, /\.cards\.json$/)) { copy(path.join(visitDir, f), `visits/${f}`); visits.push({ file: f, src: `data/sim/visits/${f}`, mock: /mock|dry/.test(f) }); }
write('visits/index.json', visits);

// ---------------------------------------------------------------- ai vs human (derived; run files are 1-40 MB)
const runsDir = D('sim', 'runs');
const agentFiles = ls(runsDir, /^agent_.*jev.*\.json$/);
const humanFiles = ls(runsDir, /^run_.*jev.*\.json$/);
// latest = lexicographically last (names start with a YYYYMMDD_HHMMSS timestamp)
const agentF = agentFiles.at(-1);
const humanF = humanFiles.at(-1);
if (agentF && humanF) {
  const A = readJSON(path.join(runsDir, agentF));
  const H = readJSON(path.join(runsDir, humanF));
  const aSrc = `data/sim/runs/${agentF}`;
  const hSrc = `data/sim/runs/${humanF}`;
  // earlier non-Jev agent runs (OpenRouter LLMs, retired) for the position-bias comparison
  const llmBias = [];
  for (const f of ls(runsDir, /^agent_.*\.json$/)) {
    if (f === agentF || /mock/.test(f)) continue;
    const r = readJSON(path.join(runsDir, f));
    for (const [model, pb] of Object.entries(r.position_bias || {})) {
      if (/jev/.test(model)) continue;
      const { positions, ...rest } = pb;
      llmBias.push({ model, file: `data/sim/runs/${f}`, ...rest, positions });
    }
  }
  const missionCats = new Set((A.missions || []).flatMap((m) => m.categories));
  const cat = (code) => catalog[code]?.category || H.stats?.per_product?.[code]?.category || 'unknown';
  const hp = H.stats?.per_product || {};
  const ap = A.stats?.per_product || {};
  const codes = [...new Set([...Object.keys(ap), ...Object.keys(hp)])].filter((c) => missionCats.has(cat(c)) && ap[c]);
  const byCat = {};
  for (const c of codes) (byCat[cat(c)] ||= []).push(c);
  const SMOOTH = 0.5;
  const categories = Object.entries(byCat).map(([category, cs]) => {
    const hTot = cs.reduce((s, c) => s + (hp[c]?.picked || 0), 0);
    const aTot = cs.reduce((s, c) => s + (ap[c]?.picked || 0), 0);
    const k = cs.length;
    const products = cs.map((c) => {
      const h = hp[c] || { shown: 0, picked: 0 };
      const a = ap[c];
      const sH = hTot ? h.picked / hTot : 0;
      const sA = aTot ? a.picked / aTot : 0;
      const sHs = (h.picked + SMOOTH) / (hTot + SMOOTH * k);
      const sAs = (a.picked + SMOOTH) / (aTot + SMOOTH * k);
      return {
        code: c, name: catalog[c]?.name || a.name || h.name || c, brand: catalog[c]?.brand, role: catalog[c]?.role || a.role,
        human: { picked: h.picked, shown: h.shown, share: sH, pick_rate: h.pick_rate ?? null, ci95: h.ci95 ?? null },
        agent: { picked: a.picked, shown: a.shown, share: sA, pick_rate: a.pick_rate ?? null, ci95: a.ci95 ?? null },
        divergence_log: Math.log(sAs / sHs),
      };
    }).sort((x, y) => y.human.share + y.agent.share - (x.human.share + x.agent.share));
    return { category, human_picks: hTot, agent_picks: aTot, products };
  }).sort((a, b) => a.category.localeCompare(b.category));
  // Jensen-Shannon divergence per category (natural log, bits shown in UI = /ln2)
  for (const c of categories) {
    const P = c.products.map((p) => p.human.share), Q = c.products.map((p) => p.agent.share);
    const M = P.map((p, i) => (p + Q[i]) / 2);
    const kl = (X) => X.reduce((s, x, i) => s + (x > 0 ? x * Math.log2(x / M[i]) : 0), 0);
    c.jsd_bits = c.human_picks && c.agent_picks ? 0.5 * kl(P) + 0.5 * kl(Q) : null;
  }
  const pbJev = Object.entries(A.position_bias || {}).map(([model, pb]) => ({ model, file: aSrc, ...pb }));
  const feedLens = (A.agents || []).map((g) => g.events?.length || 0).filter(Boolean);
  write('aivh.json', {
    agent_file: aSrc, human_file: hSrc,
    agent_run: { run_id: A.run_id, created: A.created, models: A.models, n: (A.agents || []).length, cost: A.cost, missions: A.missions },
    human_run: { run_id: H.run_id, created: H.created, models: H.models, n: (H.agents || []).length, cost: H.cost, seed: H.seed },
    feed_lengths: feedLens,
    position_bias: pbJev,
    position_bias_llm_earlier: llmBias,
    categories,
    method: {
      share: 'within-category pick share: picked_j / sum(picked) over products in the same category; human = stats.per_product[code].picked in the human run, agent = stats.per_product[code].picked in the agent run. Only categories the agent missions cover (agent_run.missions[].categories).',
      divergence: `D_j = ln(s_agent / s_human) with +${SMOOTH} add-half smoothing on picks (assumption: avoids log(0); README "Divergence per product")`,
      jsd: 'Jensen-Shannon divergence between the human and agent share vectors in each category, log base 2 (0 = identical, 1 = disjoint)',
      category: 'catalog.json category per code',
    },
  });
  note('aivh.json', `${aSrc} + ${hSrc}`, 'derived in sync-dashboard.mjs: per-product pick shares, divergence, position bias');
}

// ---------------------------------------------------------------- run list (latest runs, small summary only)
write('runs_index.json', ls(runsDir).map((f) => ({ file: `data/sim/runs/${f}`, size: fs.statSync(path.join(runsDir, f)).size })));

write('manifest.json', manifest);
console.log(`dashboard data -> ${rel(OUT)}  (${Object.keys(manifest.files).length} entries, ${personas.length} personas, ${brandIndex.length} brand reports, ${packCodes.length} pack tests, ${swapIndex.length} swap files, ${visits.length} visit files)`);

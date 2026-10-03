#!/usr/bin/env node
// Generates FIXTURE data in web/public/data/ that matches CONTRACT.md shapes exactly.
// Used only until the real pipeline (data/store, data/products, data/sim/runs) lands;
// `npm run sync` overwrites these with real files.
//
// Honesty rules for fixtures:
//  - product brands are fictional ("fixture"), codes are FX-prefixed, never real barcodes
//  - every coefficient carries a `source`; anything invented says "assumption: fixture ..."
//  - persona verbatims are REAL Reddit comments pulled from data/reddit/comments.csv with thread URL
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const ROOT = path.resolve(WEB, '..');
const OUT = path.join(WEB, 'public', 'data');
fs.mkdirSync(path.join(OUT, 'runs'), { recursive: true });

// ---------- seeded rng ----------
let seed = 20261003;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const rr = (a, b) => a + rnd() * (b - a);
const ri = (a, b) => Math.floor(rr(a, b + 1));
const r2 = (x) => Math.round(x * 100) / 100;
const sig = (x) => 1 / (1 + Math.exp(-x));
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ---------- reddit verbatims (real) ----------
function parseCSV(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
let comments = [];
try { comments = parseCSV(fs.readFileSync(path.join(ROOT, 'data/reddit/comments.csv'), 'utf8')); } catch { console.warn('no comments.csv, verbatims will be empty'); }
const usedQuotes = new Set();
function verbatims(theme, words, n = 2) {
  const out = [];
  const cands = comments
    .filter((c) => (!theme || c.theme === theme) && c.body && c.body.length > 40 && c.body.length < 240)
    .filter((c) => words.some((w) => c.body.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.score) - Number(a.score));
  for (const c of cands) { if (usedQuotes.has(c.body)) continue; usedQuotes.add(c.body); out.push({ quote: c.body.replace(/\s+/g, ' ').trim(), url: c.thread_url, subreddit: c.subreddit, score: Number(c.score) }); if (out.length >= n) break; }
  return out;
}

// ---------- store ----------
const CATS = ['soft_drinks', 'crisps_savoury', 'snack_bars', 'breakfast_cereal', 'yoghurt', 'biscuits_chocolate', 'plant_milk_dairy_alt', 'ready_meals_soup'];
const units = CATS.map((category, i) => ({ id: `U${i + 1}`, aisle: Math.floor(i / 2) + 1, side: i % 2 === 0 ? 'L' : 'R', category }));
const storeConfig = {
  aisles: 4, rows_per_unit: 3, row_names: { 1: 'top', 2: 'eye', 3: 'bottom' }, units,
  entrance: { x: 0, z: -2 }, checkout: { x: 0, z: 22 },
  _fixture: 'web/scripts/make-fixtures.mjs: placeholder until data/store/store.config.json exists',
};

// ---------- products (fictional fixtures) ----------
const NAMES = {
  soft_drinks: [['gutsy pop', 'raspberry prebiotic soda 330ml', 'challenger'], ['fizzco', 'zero sugar cola 330ml', 'incumbent'], ['fizzco', 'original cola 330ml', 'incumbent'], ['shop own', 'light cola 330ml', 'own_label'], ['brightwater', 'sparkling lemon water 500ml', 'incumbent'], ['kombu & co', 'ginger kombucha 330ml', 'challenger'], ['shop own', 'orange squash 1l', 'own_label'], ['volta', 'energy drink 250ml', 'incumbent'], ['juno', 'apple & elderflower presse 275ml', 'challenger']],
  crisps_savoury: [['crunchly', 'ready salted crisps 6pk', 'incumbent'], ['crunchly', 'salt & vinegar crisps 6pk', 'incumbent'], ['poppa', 'popped lentil chips 85g', 'challenger'], ['shop own', 'cheese puffs 6pk', 'own_label'], ['seaside', 'sea salt kettle chips 150g', 'incumbent'], ['chickp', 'roasted chickpea crunch 100g', 'challenger'], ['shop own', 'tortilla chips 200g', 'own_label'], ['twistz', 'bbq corn twists 6pk', 'incumbent'], ['nori nori', 'seaweed thins 10g', 'challenger']],
  snack_bars: [['nutty crunch', 'oat & nut bar 35g', 'challenger'], ['grenadier', '20g protein bar cookie dough 60g', 'incumbent'], ['shop own', 'protein bar chocolate 40g', 'own_label'], ['bare date', '4-ingredient date bar 35g', 'challenger'], ['oatsy', 'chewy oat bar 5pk', 'incumbent'], ['kidbite', 'fruit & oat lunchbox bar 5pk', 'incumbent'], ['shop own', 'cereal bar 6pk', 'own_label'], ['musclr', 'high protein flapjack 70g', 'challenger'], ['barely', 'cocoa orange bar 35g', 'incumbent']],
  breakfast_cereal: [['morning gold', 'cornflakes 500g', 'incumbent'], ['shop own', 'bran flakes 750g', 'own_label'], ['grainful', 'low sugar granola 400g', 'challenger'], ['choco pops', 'chocolate rice pops 375g', 'incumbent'], ['shop own', 'wheat biscuits 24pk', 'own_label'], ['proteo', 'high protein crunch 300g', 'challenger'], ['porridge co', 'rolled oats 1kg', 'incumbent'], ['honeyhoop', 'honey loops 375g', 'incumbent']],
  yoghurt: [['hillside dairy', 'greek style natural 500g', 'incumbent'], ['shop own', 'fat free strawberry 4pk', 'own_label'], ['kefir kind', 'live kefir 500ml', 'challenger'], ['tubbz', 'kids yoghurt tubes 9pk', 'incumbent'], ['skyr north', 'high protein skyr 450g', 'challenger'], ['shop own', 'greek style 1kg', 'own_label'], ['corner fruit', 'split pot strawberry 4pk', 'incumbent'], ['oatgurt', 'oat yoghurt alternative 400g', 'challenger'], ['proteo', 'protein pot vanilla 200g', 'incumbent']],
  biscuits_chocolate: [['crumbly', 'milk chocolate digestives 300g', 'incumbent'], ['shop own', 'rich tea 300g', 'own_label'], ['cocoa honest', '70% dark chocolate 90g', 'challenger'], ['crumbly', 'chocolate fingers 114g', 'incumbent'], ['shop own', 'milk chocolate bar 200g', 'own_label'], ['oat & honey', 'oaty biscuits 300g', 'incumbent'], ['unwrapped', 'low sugar choc bites 40g', 'challenger'], ['cuppa', 'custard creams 400g', 'incumbent'], ['viral bake', 'pistachio crunch bar 100g', 'challenger']],
  plant_milk_dairy_alt: [['oatlee', 'barista oat drink 1l', 'incumbent'], ['shop own', 'unsweetened soya 1l', 'own_label'], ['almondia', 'almond drink 1l', 'incumbent'], ['pea-nut', 'pea protein milk 1l', 'challenger'], ['shop own', 'oat drink 1l', 'own_label'], ['coco cove', 'coconut drink 1l', 'incumbent'], ['oatlee', 'chocolate oat drink 1l', 'incumbent'], ['hemp & hum', 'hemp drink 1l', 'challenger']],
  ready_meals_soup: [['souperb', 'tomato & basil soup 600g', 'challenger'], ['shop own', 'chicken tikka masala 400g', 'own_label'], ['tommy kettle', 'cream of tomato soup 400g', 'incumbent'], ['big pot', 'macaroni cheese 400g', 'incumbent'], ['gut feel', 'lentil dahl pouch 300g', 'challenger'], ['shop own', 'lasagne 400g', 'own_label'], ['fresh kitchen', 'chicken noodle soup 600g', 'incumbent'], ['protein pot', 'high protein chilli 400g', 'challenger'], ['shop own', 'vegetable soup 400g', 'own_label']],
};
const CAT_PROFILE = {
  soft_drinks: { price: [0.5, 2.0], sugar: [0, 10.6], fiber: [0, 2], protein: [0, 0.5], salt: [0, 0.05], ingr: [3, 14] },
  crisps_savoury: { price: [0.9, 2.5], sugar: [0.5, 4], fiber: [3, 8], protein: [5, 18], salt: [0.8, 1.9], ingr: [3, 18] },
  snack_bars: { price: [0.8, 2.6], sugar: [3, 30], fiber: [2, 9], protein: [4, 33], salt: [0.05, 0.6], ingr: [4, 26] },
  breakfast_cereal: { price: [1.0, 4.0], sugar: [1, 35], fiber: [3, 14], protein: [7, 25], salt: [0.01, 1.1], ingr: [1, 16] },
  yoghurt: { price: [0.9, 3.2], sugar: [3, 13], fiber: [0, 1.5], protein: [3, 11], salt: [0.05, 0.2], ingr: [2, 14] },
  biscuits_chocolate: { price: [0.6, 3.0], sugar: [10, 50], fiber: [1, 11], protein: [5, 9], salt: [0.05, 0.9], ingr: [4, 20] },
  plant_milk_dairy_alt: { price: [0.6, 2.2], sugar: [0, 7], fiber: [0, 1.5], protein: [0.4, 3.4], salt: [0.05, 0.15], ingr: [2, 12] },
  ready_meals_soup: { price: [1.0, 4.5], sugar: [1, 6], fiber: [1, 5], protein: [2, 12], salt: [0.4, 1.4], ingr: [6, 30] },
};
const CAT_COLOR = { soft_drinks: '#e8463c', crisps_savoury: '#f4b400', snack_bars: '#8d5524', breakfast_cereal: '#f08a24', yoghurt: '#7fb8e6', biscuits_chocolate: '#5b3a29', plant_milk_dairy_alt: '#a7c957', ready_meals_soup: '#c0392b' };
const ADDITIVES = ['en:e330', 'en:e322', 'en:e471', 'en:e150d', 'en:e338', 'en:e950', 'en:e955', 'en:e412', 'en:e415', 'en:e202', 'en:e960', 'en:e300', 'en:e407'];
const SWEETENER = new Set(['en:e950', 'en:e955', 'en:e960']);

const clamp01 = (x) => Math.max(0, Math.min(1, x));
function lensGrades(p) {
  const nsMap = { a: 1, b: 0.8, c: 0.55, d: 0.3, e: 0.1 };
  const ns = nsMap[p.nutriscore] ?? 0.5; const es = nsMap[p.ecoscore] ?? 0.5;
  const g = (score, why) => ({ score: r2(clamp01(score)), why });
  const unit = p.price_gbp;
  return {
    eco_low_chemical: g(0.45 * es + 0.35 * (1 - p.additives_n / 6) + 0.2 * (p.labels.includes('en:organic') ? 1 : 0.4), [`ecoscore ${p.ecoscore} (OFF)`, `additives_n=${p.additives_n} (OFF)`, `labels=${p.labels.join('|') || 'none'} (OFF)`]),
    upf_avoider_parent: g(0.5 * (1 - (p.nova - 1) / 3) + 0.3 * (1 - p.ingredients_n / 30) + 0.2 * (1 - p.sugars_100g / 40), [`nova ${p.nova} (OFF)`, `ingredients_n=${p.ingredients_n} (OFF)`, `sugars_100g=${p.sugars_100g} (OFF)`]),
    glp1_small_appetite: g(0.5 * Math.min(1, p.proteins_100g / 20) + 0.3 * (1 - p.sugars_100g / 40) + 0.2 * (p.sweeteners ? 0 : 1), [`proteins_100g=${p.proteins_100g} (OFF)`, `sugars_100g=${p.sugars_100g} (OFF)`, `sweeteners=${p.sweeteners} (OFF additives)`]),
    frugal_unit_price: g(1 - (unit - 0.5) / 4 + (p.role === 'own_label' ? 0.15 : 0), [`price_gbp=${unit} (${p.price_source})`, `role=${p.role}`]),
    protein_gym: g(Math.min(1, p.proteins_100g / 22) * 0.8 + 0.2 * (1 - unit / 5), [`proteins_100g=${p.proteins_100g} (OFF)`, `price_gbp=${unit}`]),
    protein_sceptic_gimmick_reactant: g(0.6 * (/protein/.test(p.name) ? 0.1 : 0.8) + 0.4 * (p.sweeteners ? 0 : 1), [`name contains 'protein': ${/protein/.test(p.name)}`, `sweeteners=${p.sweeteners} (OFF additives)`]),
    habit_loyalist_shrinkflation_angry: g(p.role === 'incumbent' ? 0.85 : p.role === 'own_label' ? 0.35 : 0.15, [`role=${p.role} (familiarity proxy)`]),
    meal_deal_office: g(0.5 * (unit <= 1.6 ? 1 : 0.2) + 0.5 * (p.category === 'soft_drinks' || p.category === 'crisps_savoury' || p.category === 'snack_bars' ? 1 : 0.2), [`price_gbp=${unit}`, `category=${p.category} (meal-deal eligible proxy)`]),
    vegan_ethical: g(p.labels.includes('en:vegan') ? 0.8 + 0.2 * es : 0.15, [`labels=${p.labels.join('|') || 'none'} (OFF)`, `ecoscore ${p.ecoscore} (OFF)`]),
    allergen_coeliac: g(p.allergens.includes('en:gluten') ? 0.02 : 0.8, [`allergens=${p.allergens.join('|') || 'none'} (OFF)`]),
    ai_delegator: g(0.5 * ns + 0.3 * (p.role === 'incumbent' ? 1 : 0.4) + 0.2 * (1 - unit / 5), [`nutriscore ${p.nutriscore} (OFF)`, `role=${p.role}`, `price_gbp=${unit}`]),
    novelty_seeker_tiktok: g(p.role === 'challenger' ? 0.8 : 0.25, [`role=${p.role}`]),
  };
}

const catalog = [];
let n = 1;
for (const cat of CATS) {
  const pr = CAT_PROFILE[cat];
  for (const [brand, name, role] of NAMES[cat]) {
    const nova = role === 'challenger' ? pick([1, 3, 3, 4]) : pick([3, 4, 4, 4]);
    const addN = nova === 4 ? ri(2, 6) : ri(0, 2);
    const adds = shuffle(ADDITIVES).slice(0, addN);
    if (/zero|light|protein|low sugar/.test(name) && !adds.some((a) => SWEETENER.has(a))) adds.push(pick(['en:e950', 'en:e955']));
    const sweet = adds.filter((a) => SWEETENER.has(a)).length;
    let sugar = r2(rr(...pr.sugar)); if (/zero|light|unsweetened|natural/.test(name)) sugar = r2(rr(0, 1));
    let protein = r2(rr(...pr.protein)); if (/protein|skyr|greek/.test(name)) protein = r2(Math.max(protein, rr(9, 30)));
    const labels = [];
    if (cat === 'plant_milk_dairy_alt' || /oat|lentil|chickpea|seaweed|dahl|date/.test(name)) labels.push('en:vegan');
    if (role === 'challenger' && rnd() < 0.35) labels.push('en:organic');
    const allergens = [];
    if (/oat|biscuit|digest|wheat|bran|flakes|granola|lasagne|macaroni|noodle|crunch|rich tea|custard|flapjack/.test(name)) allergens.push('en:gluten');
    if (/nut|almond|pistachio/.test(name)) allergens.push('en:nuts');
    if (/yoghurt|skyr|kefir|greek|cheese|milk choc|creamy|cream/.test(name) && !/oat yoghurt/.test(name)) allergens.push('en:milk');
    const code = `FX${String(n++).padStart(4, '0')}`;
    const price = r2(rr(...pr.price) * (role === 'own_label' ? 0.6 : role === 'challenger' ? 1.15 : 1));
    const p = {
      code, name, brand, category: cat, role,
      price_gbp: price, price_source: 'assumption: fixture price in the category range of a UK supermarket, replaced by data/products/catalog.json',
      pack_copy: role === 'challenger' ? pick(['made with real ingredients', 'no nasties, nothing artificial', 'gut-loving goodness', 'small batch, big flavour']) : role === 'own_label' ? 'great value' : pick(['the classic', 'family favourite', 'now with less sugar', '']),
      nova, nutriscore: pick(sugar > 15 ? ['d', 'e'] : sugar > 6 ? ['b', 'c', 'd'] : ['a', 'b', 'c']), ecoscore: pick(['a', 'b', 'c', 'd']),
      additives_n: adds.length, additives: adds, labels, allergens,
      ingredients_n: nova === 1 ? ri(1, 4) : ri(pr.ingr[0], pr.ingr[1]), ingredients_text: '',
      sugars_100g: sugar, fiber_100g: r2(rr(...pr.fiber)), proteins_100g: protein, salt_100g: r2(rr(...pr.salt)),
      sweeteners: sweet, palm_oil_n: cat === 'biscuits_chocolate' && rnd() < 0.4 ? 1 : 0, recycling: [],
      image: '', off_url: `https://world.openfoodfacts.org/product/${code}`,
      color: CAT_COLOR[cat], fixture: true,
    };
    p.lens_grades = lensGrades(p);
    catalog.push(p);
  }
}

// ---------- planogram: split each category across its 3 rows, challengers sink to the bottom ----------
const planogram = {};
for (const u of units) {
  const prods = catalog.filter((p) => p.category === u.category);
  const order = [...prods.filter((p) => p.role === 'incumbent'), ...prods.filter((p) => p.role === 'own_label'), ...prods.filter((p) => p.role === 'challenger')];
  // eye level gets incumbents (paid position), top mixed, bottom own-label + challengers
  const eye = order.slice(0, 3); const top = order.slice(3, 6); const bottom = order.slice(6);
  const rows = { 1: top, 2: eye, 3: bottom };
  for (const r of [1, 2, 3]) {
    const set = rows[r].slice(0, 4);
    planogram[`${u.id}-r${r}`] = { category: u.category, products: set.map((p) => p.code), facings: Object.fromEntries(set.map((p) => [p.code, p.role === 'incumbent' ? ri(2, 3) : p.role === 'own_label' ? 2 : 1])) };
  }
}

// ---------- personas (contract shape) ----------
const REDDIT_ATTENTION = 'research/04-3d-sim-evidence-and-tech.md';
const A = [
  ['p_eco_parent', 'priya', 'eco_low_chemical', 'weekly_shop', 'instore', { O: 0.62, C: 0.74, E: 0.45, A: 0.6, N: 0.58 }, 'say_do_healthy', ['additive', 'e number', 'chemical', 'organic'], [['additives_n', 'lower_better', 0.35], ['ecoscore', 'higher_better', 0.3], ['labels', 'organic_vegan_bonus', 0.2], ['price_gbp', 'lower_better', 0.15]], 'loss_aversion'],
  ['p_upf_parent', 'hannah', 'upf_avoider_parent', 'weekly_shop', 'online', { O: 0.55, C: 0.78, E: 0.4, A: 0.65, N: 0.62 }, 'say_do_healthy', ['upf', 'ultra processed', 'ultra-processed'], [['nova', 'lower_better', 0.4], ['ingredients_n', 'lower_better', 0.3], ['sugars_100g', 'lower_better', 0.3]], 'loss_aversion'],
  ['p_glp1', 'sam', 'glp1_small_appetite', 'top_up', 'instore', { O: 0.5, C: 0.7, E: 0.35, A: 0.55, N: 0.6 }, 'protein_gimmick', ['ozempic', 'mounjaro', 'calories per gram', 'appetite'], [['proteins_100g', 'higher_better', 0.45], ['sugars_100g', 'lower_better', 0.3], ['sweeteners', 'lower_better', 0.25]], 'trust'],
  ['p_frugal', 'dev', 'frugal_unit_price', 'top_up', 'instore', { O: 0.45, C: 0.6, E: 0.55, A: 0.5, N: 0.5 }, 'own_brand_vs_branded', ['own brand', 'cheaper', 'aldi', 'lidl'], [['price_gbp', 'lower_better', 0.6], ['role', 'own_label_bonus', 0.4]], 'price_anchor'],
  ['p_gym', 'kai', 'protein_gym', 'gym', 'instore', { O: 0.5, C: 0.72, E: 0.68, A: 0.45, N: 0.35 }, 'protein_gimmick', ['protein', 'macros'], [['proteins_100g', 'higher_better', 0.7], ['price_gbp', 'lower_better', 0.3]], 'goal_fit'],
  ['p_sceptic', 'jo', 'protein_sceptic_gimmick_reactant', 'top_up', 'instore', { O: 0.58, C: 0.55, E: 0.5, A: 0.35, N: 0.45 }, 'protein_gimmick', ['gimmick', 'marketing', 'scam'], [['name', 'protein_claim_penalty', 0.6], ['sweeteners', 'lower_better', 0.4]], 'gimmick_reactance'],
  ['p_loyalist', 'margaret', 'habit_loyalist_shrinkflation_angry', 'weekly_shop', 'instore', { O: 0.25, C: 0.7, E: 0.4, A: 0.6, N: 0.55 }, 'shrinkflation_switch', ['shrink', 'smaller', 'same price'], [['role', 'familiar_bonus', 0.7], ['price_gbp', 'lower_better', 0.3]], 'habit'],
  ['p_meal_deal', 'jordan', 'meal_deal_office', 'meal_deal', 'instore', { O: 0.6, C: 0.4, E: 0.65, A: 0.55, N: 0.45 }, 'meal_deal', ['meal deal'], [['meal_deal_eligible', 'yes_better', 0.6], ['price_gbp', 'lower_better', 0.4]], 'price_anchor'],
  ['p_vegan', 'ana', 'vegan_ethical', 'weekly_shop', 'instore', { O: 0.75, C: 0.65, E: 0.5, A: 0.7, N: 0.45 }, null, ['vegan', 'plant based', 'plant-based'], [['labels', 'vegan_required', 0.7], ['ecoscore', 'higher_better', 0.3]], 'identity'],
  ['p_coeliac', 'ruth', 'allergen_coeliac', 'weekly_shop', 'instore', { O: 0.4, C: 0.85, E: 0.4, A: 0.55, N: 0.65 }, null, ['coeliac', 'gluten free', 'celiac'], [['allergens', 'gluten_veto', 0.9], ['price_gbp', 'lower_better', 0.1]], 'safety_veto'],
  ['p_ai_delegator', 'tess', 'ai_delegator', 'weekly_shop', 'agent', { O: 0.7, C: 0.35, E: 0.55, A: 0.6, N: 0.4 }, 'chatgpt_shopping', ['chatgpt', 'gpt to', 'asked it', 'shopping list'], [['nutriscore', 'higher_better', 0.5], ['rating_proxy', 'incumbent_bonus', 0.3], ['price_gbp', 'lower_better', 0.2]], 'delegation'],
  ['p_tiktok', 'mia', 'novelty_seeker_tiktok', 'treat', 'instore', { O: 0.85, C: 0.35, E: 0.75, A: 0.5, N: 0.4 }, null, ['tiktok', 'viral'], [['role', 'challenger_bonus', 0.7], ['price_gbp', 'lower_better', 0.3]], 'novelty'],
];
const personas = A.map(([id, name, archetype, mission, channel, ocean, theme, words, lens, mech]) => {
  const v = verbatims(theme, words, 2);
  const src = v[0]?.url || 'assumption: fixture, no matching verbatim';
  return {
    id, name, archetype, mission, budget_gbp: mission === 'weekly_shop' ? 120 : mission === 'meal_deal' ? 4 : 15, channel, ocean,
    ocean_effects: [
      { trait: 'C', effect: 'reads labels → +attention to nutrition fields', coef: r2(0.3 * ocean.C), source: 'assumption: fixture coefficient; direction from research/05-personas.md (label-readers are high-C)' },
      { trait: 'O', effect: 'notices unfamiliar brands → +p_notice for challengers', coef: r2(0.4 * ocean.O), source: 'assumption: fixture coefficient; Openness ↔ novelty seeking' },
    ],
    lens: lens.map(([attribute, direction, weight]) => ({ attribute, off_field: attribute, direction, weight, why: `${archetype} weighs ${attribute}`, source: src })),
    rejection_triggers: [{ trigger: lens[0][0] + ' fails lens', source: src }],
    trust_signals: [], habits: [mech],
    dossier: `fixture persona (${archetype}). the real dossier comes from data/personas/personas.json, grounded in the verbatims below.`,
    verbatims: v,
    _mechanism: mech,
  };
});

// ---------- notice model (contract formula) ----------
const NOTICE = {
  a0: { value: -0.35, source: 'assumption: fixture intercept so average shelf notice ≈ 0.45' },
  row: { top: { value: 0.1, source: `${REDDIT_ATTENTION}: top shelf +17% noticing (Chandon et al. 2009)` }, eye: { value: 0.55, source: `${REDDIT_ATTENTION}: eye vs floor ≈ +39% sales (Wikipedia Planogram field study)` }, bottom: { value: -0.45, source: `${REDDIT_ATTENTION}: floor is worst vertical position` } },
  facings: { value: 0.17, source: `${REDDIT_ATTENTION}: facings elasticity 0.17 (Eisend 2014 meta-analysis)` },
  centrality: { value: 0.3, source: `${REDDIT_ATTENTION}: horizontal centre bias (Atalay, Bodur & Rasolofoarison 2012, JCR 39(4))` },
};
const REASONS = {
  pick: {
    eco_low_chemical: (p) => `only ${p.additives_n} additives and ecoscore ${p.ecoscore}. that'll do.`,
    upf_avoider_parent: (p) => `nova ${p.nova}, ${p.ingredients_n} ingredients. i can actually read this list.`,
    glp1_small_appetite: (p) => `${p.proteins_100g}g protein per 100g, i can eat a small amount of this.`,
    frugal_unit_price: (p) => `£${p.price_gbp.toFixed(2)}. cheapest thing here that isn't awful.`,
    protein_gym: (p) => `${p.proteins_100g}g protein, macros check out.`,
    protein_sceptic_gimmick_reactant: () => `no protein shouting on the front, just food. fine.`,
    habit_loyalist_shrinkflation_angry: () => `this is the one we always have. in the basket.`,
    meal_deal_office: (p) => `£${p.price_gbp.toFixed(2)} and it's in the deal. done.`,
    vegan_ethical: () => `vegan label, decent ecoscore. happy with that.`,
    allergen_coeliac: () => `no gluten listed. safe.`,
    ai_delegator: () => `the assistant put this in, looks fine, approved.`,
    novelty_seeker_tiktok: (p) => `${p.brand}? never seen it. saw something like it on tiktok, trying it.`,
    ai_agent: (p) => `ranked #1 on nutriscore ${p.nutriscore} and price £${p.price_gbp.toFixed(2)} for the request.`,
  },
  reject: {
    eco_low_chemical: (p) => `${p.additives_n} additives? not putting that in the trolley.`,
    upf_avoider_parent: (p) => `nova ${p.nova} with ${p.ingredients_n} ingredients. that's a upf, back it goes.`,
    glp1_small_appetite: (p) => p.sweeteners ? `sweeteners again. my stomach can't do it.` : `${p.sugars_100g}g sugar, i'll feel sick after two bites.`,
    frugal_unit_price: (p) => `£${p.price_gbp.toFixed(2)} for that? the own brand is right there.`,
    protein_gym: (p) => `only ${p.proteins_100g}g protein, pointless.`,
    protein_sceptic_gimmick_reactant: () => `"protein" slapped on a biscuit. it's a gimmick and i'm not paying for it.`,
    habit_loyalist_shrinkflation_angry: (p) => `never heard of ${p.brand}. i'm not wasting money finding out.`,
    meal_deal_office: () => `not in the meal deal so it's basically double the price.`,
    vegan_ethical: () => `not vegan. no.`,
    allergen_coeliac: () => `contains gluten. hard no.`,
    ai_delegator: () => `assistant swapped it out, didn't argue.`,
    novelty_seeker_tiktok: () => `same old stuff my mum buys. boring.`,
    ai_agent: (p) => `excluded: nutriscore ${p.nutriscore}, ${p.role === 'challenger' ? 'too few reviews' : 'price per unit not competitive'}.`,
  },
  walk_past: (p) => `looked at the ${p.brand} for a second, nothing grabbed me.`,
};
const ATTRS = { eco_low_chemical: ['additives_n', 'ecoscore'], upf_avoider_parent: ['nova', 'ingredients_n'], glp1_small_appetite: ['proteins_100g', 'sweeteners', 'sugars_100g'], frugal_unit_price: ['price_gbp'], protein_gym: ['proteins_100g'], protein_sceptic_gimmick_reactant: ['name', 'sweeteners'], habit_loyalist_shrinkflation_angry: ['brand'], meal_deal_office: ['price_gbp'], vegan_ethical: ['labels'], allergen_coeliac: ['allergens'], ai_delegator: ['nutriscore'], novelty_seeker_tiktok: ['brand', 'pack_copy'], ai_agent: ['nutriscore', 'price_gbp', 'role'] };

const unitById = Object.fromEntries(units.map((u) => [u.id, u]));
const byCode = Object.fromEntries(catalog.map((p) => [p.code, p]));
const MODELS = ['google/gemini-2.5-flash', 'openai/gpt-4.1-mini', 'anthropic/claude-haiku-4.5', 'meta-llama/llama-3.3-70b-instruct'];
const agents = [];
const N_HUMAN = 32, N_AI = 8;
for (let i = 0; i < N_HUMAN + N_AI; i++) {
  const isAI = i >= N_HUMAN;
  const persona = isAI ? null : personas[i % personas.length];
  const arche = isAI ? 'ai_agent' : persona.archetype;
  const ocean = isAI ? {} : Object.fromEntries(Object.entries(persona.ocean).map(([k, v]) => [k, r2(clamp01(v + rr(-0.08, 0.08)))]));
  // path: a handful of units visited in aisle order, 1-2 rows each (humans), feed slots (ai)
  const nUnits = isAI ? 4 : ri(3, 6);
  const visit = shuffle(units).slice(0, nUnits).sort((a, b) => a.aisle - b.aisle || (a.side < b.side ? -1 : 1));
  const slotPath = [];
  for (const u of visit) {
    const rows = isAI ? [1, 2, 3] : shuffle([1, 2, 3]).slice(0, ri(1, 2)).sort();
    for (const r of rows) slotPath.push(`${u.id}-r${r}`);
  }
  const events = []; let step = 0;
  for (const slot of slotPath) {
    const pl = planogram[slot]; const rowName = storeConfig.row_names[slot.split('-r')[1]];
    let pickedHere = false;
    pl.products.forEach((code, idx) => {
      const p = byCode[code];
      const f = pl.facings[code] || 1;
      const centrality = r2(1 - Math.abs(idx - (pl.products.length - 1) / 2) / Math.max(1, (pl.products.length - 1) / 2));
      let trait = 0;
      if (!isAI) trait = r2((p.role === 'challenger' ? 0.4 * ocean.O : 0) + 0.3 * ocean.C * 0.3);
      const z = NOTICE.a0.value + NOTICE.row[rowName].value + NOTICE.facings.value * Math.log(f) + NOTICE.centrality.value * centrality + trait;
      const pn = isAI ? 1 : r2(sig(z));
      const noticed = isAI ? true : rnd() < pn;
      const score = p.lens_grades[isAI ? 'ai_delegator' : arche]?.score ?? 0.5;
      const aiScore = isAI ? r2(0.55 * score + 0.25 * (p.role === 'incumbent' ? 1 : p.role === 'own_label' ? 0.5 : 0.05) + 0.2 * (1 - p.price_gbp / 5)) : score;
      let decision = 'not_noticed';
      if (noticed) {
        const pp = sig(7 * (aiScore - 0.62));
        const u = rnd();
        if (!pickedHere && u < pp) { decision = 'pick'; pickedHere = true; }
        else if (aiScore < 0.45 || u > 0.75) decision = 'reject';
        else decision = 'walk_past';
      }
      const ev = {
        step: step++, slot, product: code, p_notice: pn,
        notice_factors: isAI ? { row: 'feed (shelf position not visible)', facings: f, trait_boost: 0, centrality: 0 } : { row: rowName, facings: f, trait_boost: trait, centrality },
        noticed, decision,
        reason: decision === 'not_noticed' ? '' : decision === 'walk_past' ? REASONS.walk_past(p) : REASONS[decision][arche](p),
        attributes_cited: decision === 'not_noticed' ? [] : ATTRS[arche],
        feeling: decision === 'pick' ? pick(['relieved', 'pleased', 'curious', 'fine']) : decision === 'reject' ? pick(['annoyed', 'suspicious', 'meh', 'wary']) : decision === 'walk_past' ? 'indifferent' : '',
        sentiment: decision === 'pick' ? r2(rr(0.3, 0.9)) : decision === 'reject' ? r2(rr(-0.9, -0.3)) : decision === 'walk_past' ? r2(rr(-0.2, 0.2)) : 0,
        mechanism: decision === 'not_noticed' ? 'attention' : isAI ? 'structured_field_ranking' : persona._mechanism,
        source_refs: isAI
          ? ['research/05-personas.md §1b (agents read claims not experience)', `lens_grades.ai_delegator (${p.lens_grades.ai_delegator.why.join('; ')})`]
          : [NOTICE.row[rowName].source, NOTICE.facings.source, ...(persona.verbatims[0] ? [persona.verbatims[0].url] : []), `lens_grades.${arche}: ${p.lens_grades[arche].why.join('; ')}`],
      };
      events.push(ev);
    });
  }
  agents.push({ agent_id: `a${String(i + 1).padStart(3, '0')}`, persona_id: isAI ? 'ai_agent' : persona.id, model: isAI ? MODELS[(i - N_HUMAN) % MODELS.length] : MODELS[i % MODELS.length], ocean, path: slotPath, events });
}

// ---------- stats ----------
function wilson(k, n, z = 1.96) { if (!n) return [0, 0]; const p = k / n; const d = 1 + z * z / n; const c = p + z * z / (2 * n); const m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [r2((c - m) / d), r2((c + m) / d)]; }
const archOf = (a) => a.persona_id === 'ai_agent' ? 'ai_agent' : personas.find((p) => p.id === a.persona_id)?.archetype;
const per = {};
for (const p of catalog) per[p.code] = { shown: 0, noticed: 0, considered: 0, picked: 0, rejected: 0, walk_past: 0, pick_rate: 0, ci95: [0, 0], by_archetype: {}, by_ocean_segment: {}, top_reject_reasons: [], mean_sentiment: 0, _s: 0, _ns: 0 };
for (const a of agents) for (const e of a.events) {
  const s = per[e.product]; const ar = archOf(a);
  s.shown++; s.by_archetype[ar] ??= { shown: 0, picked: 0, pick_rate: 0 }; s.by_archetype[ar].shown++;
  if (e.noticed) s.noticed++;
  if (e.decision === 'pick' || e.decision === 'reject') s.considered++;
  if (e.decision === 'pick') { s.picked++; s.by_archetype[ar].picked++; }
  if (e.decision === 'reject') { s.rejected++; s.top_reject_reasons.push({ agent_id: a.agent_id, mechanism: e.mechanism, reason: e.reason }); }
  if (e.decision === 'walk_past') s.walk_past++;
  if (e.noticed) { s._s += e.sentiment; s._ns++; }
  if (!a.ocean || a.ocean.O === undefined) continue;
  const seg = a.ocean.O >= 0.6 ? 'high_O' : 'low_O'; s.by_ocean_segment[seg] ??= { shown: 0, picked: 0 }; s.by_ocean_segment[seg].shown++; if (e.decision === 'pick') s.by_ocean_segment[seg].picked++;
}
for (const s of Object.values(per)) {
  s.pick_rate = s.shown ? r2(s.picked / s.shown) : 0; s.ci95 = wilson(s.picked, s.shown);
  for (const b of Object.values(s.by_archetype)) b.pick_rate = r2(b.picked / b.shown);
  s.mean_sentiment = s._ns ? r2(s._s / s._ns) : 0; delete s._s; delete s._ns;
  s.top_reject_reasons = s.top_reject_reasons.slice(0, 5);
}

const run = {
  run_id: 'fixture_run_001', created: new Date('2026-10-03T10:00:00Z').toISOString(), planogram: 'planogram.json', models: MODELS,
  notice_model: NOTICE, _fixture: 'generated by web/scripts/make-fixtures.mjs: synthetic decisions to exercise the UI. NOT results.',
  agents, stats: { per_product: per },
};

const w = (f, d) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(d, null, 1));
w('store.config.json', storeConfig); w('planogram.json', planogram); w('catalog.json', catalog); w('personas.json', personas);
w('runs/fixture_run_001.json', run);
w('runs/index.json', [{ run_id: run.run_id, file: 'fixture_run_001.json', created: run.created, agents: agents.length, fixture: true }]);
console.log(`fixtures: ${catalog.length} products, ${Object.keys(planogram).length} slots, ${personas.length} personas, ${agents.length} agents, ${agents.reduce((s, a) => s + a.events.length, 0)} events → ${OUT}`);

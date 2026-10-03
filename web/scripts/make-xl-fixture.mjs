#!/usr/bin/env node
// FIXTURE ONLY: scaled store layouts that prove the 3D builds any store from store.config.json.
// It never touches the real synced files in web/public/data/*.json or anything under data/.
//
//   public/data/fixtures6/   6 aisles / 12 units / 36 slots (the 8 synced units + the 4 new categories)
//   public/data/fixturesxl/  "XL": 5 aisles x 2 sides x 2 bays = 20 units x 4 rows = 80 slots, ~480 SKUs,
//                            2 entrances, 2 exits with EAS gates, 6 staffed tills + 12 self-checkouts,
//                            a stockroom and a café (the shape data/store/store_xl.config.json is expected to have)
//
// Products, in order of preference:
//   1. the synced planogram's own slots (U1..U8 keep their ids + products, so every real run replays on it)
//   2. real curated products from data/products/curated/<category>.json (OFF barcodes + images, sourced prices)
//   3. fictional filler packs (code FXL…, fixture:true, price "assumption: fixture") to fill the XL shelves
// Open with ?store=fixtures6 or ?store=fixturesxl (a yellow banner marks fixture layouts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', 'public', 'data');
const CURATED = path.resolve(HERE, '..', '..', 'data', 'products', 'curated');

const base = JSON.parse(fs.readFileSync(path.join(DATA, 'store.config.json'), 'utf8'));
const basePlan = JSON.parse(fs.readFileSync(path.join(DATA, 'planogram.json'), 'utf8'));
const catalog = (() => { try { const c = JSON.parse(fs.readFileSync(path.join(DATA, 'catalog.json'), 'utf8')); return Array.isArray(c) ? c : c.products ?? []; } catch { return []; } })();
const have = new Set(catalog.map((p) => p.code));

const curated = {};
if (fs.existsSync(CURATED)) for (const f of fs.readdirSync(CURATED).filter((f) => f.endsWith('.json'))) {
  try { const d = JSON.parse(fs.readFileSync(path.join(CURATED, f), 'utf8')); const list = Array.isArray(d) ? d : d.products; if (Array.isArray(list) && list.length) curated[list[0].category ?? f.replace('.json', '')] = list; } catch { /* skip */ }
}
const slim = (p) => {
  const keep = ['code', 'name', 'brand', 'category', 'role', 'price_gbp', 'price_source', 'pack_copy', 'nova', 'nutriscore', 'ecoscore', 'additives_n', 'additives', 'labels', 'allergens', 'ingredients_n', 'sugars_100g', 'fiber_100g', 'proteins_100g', 'salt_100g', 'sweeteners', 'palm_oil_n', 'image', 'off_url'];
  return Object.fromEntries(keep.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]));
};

const COLORS = { soft_drinks: '#e8463c', crisps_savoury: '#f4b400', snack_bars: '#a0643a', breakfast_cereal: '#f08a24', yoghurt: '#7fb8e6', biscuits_chocolate: '#6b4430', plant_milk_dairy_alt: '#8fbf4a', ready_meals_soup: '#c0392b', bakery_bread: '#d9a05b', frozen_icecream: '#9ad7f5', hot_drinks: '#7a4b2a', confectionery_sweets: '#ff7ac8' };
const WORDS = {
  soft_drinks: ['fizz', 'cola', 'lemonade', 'sparkling water', 'orange crush', 'ginger beer'],
  crisps_savoury: ['ready salted', 'cheese & onion', 'salt & vinegar', 'pretzels', 'popcorn', 'lentil puffs'],
  snack_bars: ['oat bar', 'protein bar', 'fruit & nut bar', 'cereal bar', 'flapjack', 'nut butter bar'],
  breakfast_cereal: ['granola', 'bran flakes', 'muesli', 'porridge oats', 'choco hoops', 'wheat biscuits'],
  yoghurt: ['greek style', 'strawberry pots', 'kefir', 'skyr', 'vanilla pots', 'coconut yog'],
  biscuits_chocolate: ['digestives', 'choc chip cookies', 'shortbread', 'rich tea', 'choc bar', 'wafer fingers'],
  plant_milk_dairy_alt: ['oat drink', 'soya drink', 'almond drink', 'coconut drink', 'oat barista', 'pea drink'],
  ready_meals_soup: ['tomato soup', 'lasagne', 'curry & rice', 'mac & cheese', 'lentil soup', 'noodle pot'],
  bakery_bread: ['white loaf', 'seeded loaf', 'bagels', 'crumpets', 'wraps', 'brioche'],
  frozen_icecream: ['vanilla tub', 'choc ices', 'lollies', 'sorbet', 'cookie dough tub', 'mini cones'],
  hot_drinks: ['tea bags', 'instant coffee', 'hot chocolate', 'ground coffee', 'herbal tea', 'coffee pods'],
  confectionery_sweets: ['jelly sweets', 'sour belts', 'toffees', 'mints', 'gummy bears', 'fizzy laces'],
};
const BRANDS = ['shop own', 'big brand', 'little label', 'good co', 'value pick', 'fancy foods', 'tiktok viral', 'farm fresh'];
const ROLES = ['own_label', 'incumbent', 'challenger', 'challenger', 'own_label', 'incumbent', 'challenger', 'incumbent'];

let fxN = 0;
const filler = (category, n, extra) => Array.from({ length: n }, (_, i) => {
  const code = `FXL${String(++fxN).padStart(4, '0')}`;
  const k = fxN * 7 + i;
  extra.push({ code, name: `${WORDS[category]?.[k % 6] ?? category} ${['', 'big pack', 'multipack', 'mini', 'family size', 'light'][(k >> 1) % 6]}`.trim(), brand: BRANDS[k % BRANDS.length], category, role: ROLES[k % ROLES.length],
    price_gbp: Math.round((0.8 + ((fxN * 37) % 45) / 10) * 100) / 100, price_source: 'assumption: fixture price, not a real shelf price', pack_copy: '', color: COLORS[category], fixture: true, off_url: '' });
  return code;
});
const setOf = (category, codes, eye) => ({ category, products: codes, facings: Object.fromEntries(codes.map((c, i) => [c, eye && i === 0 ? 2 : 1])) });

/** rows of real curated products for a category (by their curated `row`), adding them to the extra catalog */
function curatedRows(category, extra) {
  const list = curated[category] ?? [];
  const rows = { 1: [], 2: [], 3: [] };
  list.forEach((p, i) => { const r = [1, 2, 3].includes(p.row) ? p.row : (i % 3) + 1; rows[r].push(p.code); if (!have.has(p.code)) { extra.push(slim(p)); have.add(p.code); } });
  return rows;
}

// ---------------------------------------------------------------- fixtures6
{
  const OUT = path.join(DATA, 'fixtures6'); fs.mkdirSync(OUT, { recursive: true });
  const NEW = ['bakery_bread', 'frozen_icecream', 'hot_drinks', 'confectionery_sweets'];
  const units = [...base.units.map((u) => ({ ...u }))];
  NEW.forEach((category, i) => units.push({ id: `U${9 + i}`, aisle: 5 + Math.floor(i / 2), side: i % 2 === 0 ? 'L' : 'R', category }));
  const cfg = { ...base, aisles: 6, units, _fixture: 'web/scripts/make-xl-fixture.mjs: 6-aisle scaling fixture (real curated products for the 4 new categories), not the real store' };
  const plan = { ...basePlan }, extra = [];
  for (const u of units.slice(base.units.length)) {
    const rows = curatedRows(u.category, extra);
    for (let r = 1; r <= 3; r++) plan[`${u.id}-r${r}`] = setOf(u.category, rows[r].length ? rows[r].slice(0, 4) : filler(u.category, 3, extra), r === 2);
  }
  fs.writeFileSync(path.join(OUT, 'store.config.json'), JSON.stringify(cfg, null, 1));
  fs.writeFileSync(path.join(OUT, 'planogram.json'), JSON.stringify(plan, null, 1));
  fs.writeFileSync(path.join(OUT, 'catalog_extra.json'), JSON.stringify(extra, null, 1));
  console.log(`fixtures6: ${units.length} units, ${Object.keys(plan).length} slots, +${extra.length} products`);
}

// ---------------------------------------------------------------- fixturesxl
{
  const OUT = path.join(DATA, 'fixturesxl'); fs.mkdirSync(OUT, { recursive: true });
  fxN = 0;
  have.clear(); for (const p of catalog) have.add(p.code);
  // 5 aisles x L/R x 2 bays. original U1..U8 keep their category; chilled categories share the back aisles (fridges)
  const order = ['soft_drinks', 'soft_drinks', 'crisps_savoury', 'crisps_savoury', 'snack_bars', 'confectionery_sweets', 'breakfast_cereal', 'hot_drinks',
    'biscuits_chocolate', 'bakery_bread', 'bakery_bread', 'biscuits_chocolate', 'yoghurt', 'yoghurt', 'plant_milk_dairy_alt', 'ready_meals_soup', 'frozen_icecream', 'frozen_icecream', 'plant_milk_dairy_alt', 'ready_meals_soup'];
  const baseByCat = Object.fromEntries(base.units.map((u) => [u.category, u]));
  const used = new Set();
  let next = base.units.length + 1;
  const units = order.map((category, i) => {
    const aisle = Math.floor(i / 4) + 1, side = (i >> 1) % 2 === 0 ? 'L' : 'R', bay = i % 2;
    const orig = baseByCat[category];
    const id = orig && !used.has(orig.id) ? (used.add(orig.id), orig.id) : `U${next++}`;
    return { id, aisle, side, bay, category };
  });
  const rows_per_unit = 4;
  const plan = {}, extra = [];
  const seenCat = new Set();
  for (const u of units) {
    const first = !seenCat.has(u.category); seenCat.add(u.category);
    const cur = first && !baseByCat[u.category] ? curatedRows(u.category, extra) : null;
    for (let r = 1; r <= rows_per_unit; r++) {
      const slot = `${u.id}-r${r}`;
      if (basePlan[slot] && r <= 3) { plan[slot] = basePlan[slot]; continue; }
      const real = cur?.[r] ?? [];
      plan[slot] = setOf(u.category, real.length ? real.slice(0, 6) : filler(u.category, 6, extra), r === 2);
    }
  }
  const cfg = {
    aisles: 5, rows_per_unit, row_names: { 1: 'top', 2: 'eye', 3: 'waist', 4: 'bottom' }, units,
    entrance: { x: -8, z: -2 }, entrances: [{ x: -8, z: -2 }, { x: 8, z: -2 }],
    checkout: { x: 0, z: 26 }, checkouts: { staffed: 6, self: 12 }, exits: [{ x: -9, z: 40 }, { x: 9, z: 40 }],
    stockroom: { w: 6 }, cafe: { tables: 6 },
    _fixture: 'web/scripts/make-xl-fixture.mjs: XL scaling fixture, not the real store (real U1..U8 slots + curated + fictional filler)',
  };
  fs.writeFileSync(path.join(OUT, 'store.config.json'), JSON.stringify(cfg, null, 1));
  fs.writeFileSync(path.join(OUT, 'planogram.json'), JSON.stringify(plan, null, 1));
  fs.writeFileSync(path.join(OUT, 'catalog_extra.json'), JSON.stringify(extra, null, 1));
  const skus = new Set(Object.values(plan).flatMap((s) => s.products));
  console.log(`fixturesxl: ${units.length} units x ${rows_per_unit} rows = ${Object.keys(plan).length} slots, ${skus.size} SKUs (+${extra.length} products, ${extra.filter((p) => p.fixture).length} fictional)`);
}

// ---------------------------------------------------------------- stores.json (store picker)
{
  const p = path.join(DATA, 'stores.json');
  let list = []; try { list = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { list = []; }
  const add = (e) => { list = list.filter((x) => x.id !== e.id); list.push(e); };
  if (!list.some((x) => x.id === 'standard')) add({ id: 'standard', dir: '', label: 'standard store', fixture: false });
  add({ id: 'fixtures6', dir: 'fixtures6', label: '6 aisles (fixture)', fixture: true });
  add({ id: 'fixturesxl', dir: 'fixturesxl', label: 'xl store (fixture)', fixture: true });
  fs.writeFileSync(p, JSON.stringify(list, null, 1));
}

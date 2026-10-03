#!/usr/bin/env node
// FIXTURE ONLY: a 6-aisle / 12-unit / 36-slot store to prove the 3D layout scales from store.config.json.
// Writes web/public/data/fixtures6/{store.config.json, planogram.json, catalog_extra.json}.
// Open with  http://localhost:5173/?store=fixtures6  (a yellow banner marks it as a fixture layout).
// It never touches the real synced files in web/public/data/ or data/store/.
//  - U1..U8 reuse the real synced planogram slots as-is.
//  - U9..U12 hold the four new categories with fictional FX6 products (no barcodes, no images, fixture:true,
//    prices labelled "assumption: fixture").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', 'public', 'data');
const OUT = path.join(DATA, 'fixtures6');
fs.mkdirSync(OUT, { recursive: true });

const base = JSON.parse(fs.readFileSync(path.join(DATA, 'store.config.json'), 'utf8'));
const basePlan = JSON.parse(fs.readFileSync(path.join(DATA, 'planogram.json'), 'utf8'));

const NEW = {
  bakery_bread: [['loaf & co', 'seeded sourdough 800g', 'challenger'], ['big bake', 'medium white loaf 800g', 'incumbent'], ['shop own', 'wholemeal loaf 800g', 'own_label'], ['crumpet club', 'crumpets 6pk', 'incumbent'], ['rye not', 'dark rye bread 500g', 'challenger'], ['shop own', 'white rolls 6pk', 'own_label'], ['gluten free gang', 'gf white loaf 400g', 'challenger'], ['big bake', 'thick toastie loaf 800g', 'incumbent'], ['shop own', 'plain bagels 5pk', 'own_label']],
  frozen_icecream: [['scoopy', 'vanilla ice cream 900ml', 'incumbent'], ['shop own', 'neapolitan 2l', 'own_label'], ['oat dream', 'oat choc ice cream 500ml', 'challenger'], ['froyo lab', 'protein froyo 450ml', 'challenger'], ['scoopy', 'choc ices 4pk', 'incumbent'], ['shop own', 'ice lollies 10pk', 'own_label'], ['gelato nonna', 'pistachio gelato 500ml', 'challenger'], ['mega cone', 'mint cones 4pk', 'incumbent'], ['shop own', 'mint choc chip 1l', 'own_label']],
  hot_drinks: [['bru', 'instant coffee 200g', 'incumbent'], ['shop own', 'tea bags 240pk', 'own_label'], ['mush brew', 'mushroom coffee 100g', 'challenger'], ['cuppa uk', 'everyday tea 160pk', 'incumbent'], ['shop own', 'hot chocolate 400g', 'own_label'], ['matcha now', 'matcha latte mix 150g', 'challenger'], ['bru', 'decaf coffee 100g', 'incumbent'], ['bean there', 'ground coffee 227g', 'challenger'], ['shop own', 'green tea 50pk', 'own_label']],
  confectionery_sweets: [['chewy town', 'fruity chews 150g', 'incumbent'], ['shop own', 'jelly babies 200g', 'own_label'], ['sugarless', 'low sugar gummies 90g', 'challenger'], ['fizz pop', 'sour belts 160g', 'incumbent'], ['shop own', 'mint imperials 200g', 'own_label'], ['vegan bear', 'plant gummy bears 100g', 'challenger'], ['chewy town', 'wine gums 190g', 'incumbent'], ['viral sweets', 'freeze-dried skittles-style 60g', 'challenger'], ['shop own', 'toffees 200g', 'own_label']],
};
const COLORS = { bakery_bread: '#d9a05b', frozen_icecream: '#9ad7f5', hot_drinks: '#7a4b2a', confectionery_sweets: '#ff7ac8' };

const units = [...base.units.map((u) => ({ ...u }))];
const cats = Object.keys(NEW);
cats.forEach((category, i) => units.push({ id: `U${9 + i}`, aisle: 5 + Math.floor(i / 2), side: i % 2 === 0 ? 'L' : 'R', category }));
const cfg = { ...base, aisles: 6, units, _fixture: 'web/scripts/make-store6-fixture.mjs: 6-aisle scaling fixture, not the real store' };

const plan = { ...basePlan };
const extra = [];
let n = 0;
for (const u of units.slice(8)) {
  const list = NEW[u.category];
  for (let r = 1; r <= 3; r++) {
    const prods = list.slice((r - 1) * 3, r * 3).map(([brand, name, role]) => {
      const code = `FX6${String(++n).padStart(3, '0')}`;
      extra.push({ code, name, brand, category: u.category, role, price_gbp: Math.round((0.8 + ((n * 37) % 40) / 10) * 100) / 100, price_source: 'assumption: fixture price, not a real shelf price', pack_copy: '', color: COLORS[u.category], fixture: true, off_url: '' });
      return code;
    });
    plan[`${u.id}-r${r}`] = { category: u.category, products: prods, facings: Object.fromEntries(prods.map((c, i) => [c, r === 2 && i === 0 ? 2 : 1])) };
  }
}
fs.writeFileSync(path.join(OUT, 'store.config.json'), JSON.stringify(cfg, null, 1));
fs.writeFileSync(path.join(OUT, 'planogram.json'), JSON.stringify(plan, null, 1));
fs.writeFileSync(path.join(OUT, 'catalog_extra.json'), JSON.stringify(extra, null, 1));
console.log(`fixtures6: ${cfg.aisles} aisles, ${units.length} units, ${Object.keys(plan).length} slots, ${extra.length} fixture products → ${path.relative(process.cwd(), OUT)}`);

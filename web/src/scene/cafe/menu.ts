// Café menu: real catalog products (hot_drinks for cups, bakery_bread for bites) when the loaded catalog has them,
// else the sim's own café menu (data/sim/ops/params_extra.json cafe.menu: real OFF products, prices are assumptions).
// Prices shown are the catalog's price_gbp, which the catalog itself labels (price_source, mostly
// "assumption: typical UK shelf price"); a café would charge differently, so the board says "shelf price".
import type { Product } from '../../types';
import { packColor } from '../textures';

export interface MenuItem { code: string; name: string; short: string; price: number; kind: 'drink' | 'bite'; color: string; source: string }

/** data/sim/ops/params_extra.json cafe.menu (source: "assumption: … all menu prices are unsourced; menu items are real OFF products") */
const SIM_MENU: MenuItem[] = [
  { code: '7610900100514', name: 'Caffe Latte Skinny (Emmi)', short: 'latte', price: 2.6, kind: 'drink', color: '#c8a27a', source: 'params_extra.json cafe.menu (assumption)' },
  { code: '5000436734345', name: 'All Butter Croissant', short: 'croissant', price: 1.6, kind: 'bite', color: '#e8a85c', source: 'params_extra.json cafe.menu (assumption)' },
  { code: '5057545890691', name: 'Pain au chocolat', short: 'pain au choc', price: 1.8, kind: 'bite', color: '#b8743a', source: 'params_extra.json cafe.menu (assumption)' },
  { code: '03297537', name: 'Falafel & houmous sandwich', short: 'falafel sarnie', price: 3.5, kind: 'bite', color: '#d9c48a', source: 'params_extra.json cafe.menu (assumption)' },
];

const DRINK = [/flat white/i, /latte/i, /hot choc|drinking choc|belgian choc/i, /chai/i, /earl grey|yorkshire tea|black tea|green tea|everyday tea/i, /matcha/i, /coffee/i];
const BITE = [/croissant|pain au/i, /hot cross/i, /crumpet/i, /bagel/i, /cinnamon/i, /rolls?\b/i];

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/\b(\w)(\w*)/g, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
function shortName(n: string, kind: 'drink' | 'bite') {
  const s = n.toLowerCase();
  if (kind === 'drink') {
    if (s.includes('flat white')) return 'flat white';
    if (s.includes('caramel latte')) return 'caramel latte';
    if (s.includes('latte')) return 'latte';
    if (/choc/.test(s)) return 'hot choc';
    if (s.includes('chai')) return 'chai';
    if (s.includes('matcha')) return 'matcha';
    if (/tea/.test(s)) return 'cuppa tea';
    return 'coffee';
  }
  if (s.includes('hot cross')) return 'hot cross bun';
  if (s.includes('crumpet')) return 'crumpet';
  if (s.includes('bagel')) return 'bagel';
  if (s.includes('croissant')) return 'croissant';
  return s.split(' ').slice(-1)[0];
}

export function buildMenu(products: Record<string, Product>): MenuItem[] {
  const ps = Object.values(products);
  const pick = (cat: string, pats: RegExp[], kind: 'drink' | 'bite', n: number) => {
    const out: MenuItem[] = [], seen = new Set<string>();
    for (const re of pats) {
      const p = ps.find((x) => x.category === cat && re.test(x.name) && x.price_gbp > 0 && x.price_gbp < 7);
      if (!p) continue;
      const short = shortName(p.name, kind);
      if (seen.has(short)) continue;
      seen.add(short);
      out.push({ code: p.code, name: tidy(p.name).slice(0, 26), short, price: p.price_gbp, kind, color: packColor(p), source: p.price_source ? `catalog price_gbp: ${p.price_source}` : 'catalog price_gbp' });
      if (out.length >= n) break;
    }
    return out;
  };
  const drinks = pick('hot_drinks', DRINK, 'drink', 5);
  const bites = pick('bakery_bread', BITE, 'bite', 3);
  const menu = [...(drinks.length ? drinks : SIM_MENU.filter((m) => m.kind === 'drink')), ...SIM_MENU.filter((m) => m.kind === 'bite').slice(0, 2), ...bites];
  return menu.slice(0, 9);
}

const PLEASE = ['please ☕', 'please!', 'pls 🙏', 'to stay pls', 'extra hot pls'];
export function orderLine(m: MenuItem, i: number) { return `${m.short} ${PLEASE[i % PLEASE.length]}`; }

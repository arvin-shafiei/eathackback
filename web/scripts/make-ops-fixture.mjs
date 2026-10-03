#!/usr/bin/env node
// FIXTURE ONLY: a synthetic "store day" in the ops replay shape, so the frontend's ops layer (staff, spills,
// orders, café, security alarms, queues, stock, KPI HUD, time-of-day clock) can be built and demoed before
// sim/ops.py writes data/sim/ops/day_*.json. `npm run sync` copies real ops days over and lists them first.
// Every parameter below carries a `source`; all of them are labelled assumptions because this is a fixture.
//
// Shape (one record per minute of trading; the frontend tolerates missing fields):
// { day, store, _fixture?, open:"08:00", close:"22:00", params:[{name,value,unit,source}],
//   staff:[{id, role:"restocker|cleaner|manager|guard|cashier", lane?}],
//   minutes:[{ t:<minute of day>, in_store, arrivals, shoppers:{<mission>:n}, queues:{<lane id>:n},
//     staff:[{id, task, at:<slot id|"stockroom"|"cafe"|"office"|lane id|gate id|"spill:<id>"|{x,z}>}],
//     spills:[{id, at, state:"open|cleaning"}], orders:[{code, qty, why}], alarms:[{gate, kind:"eas|skip_scan", value_gbp}],
//     cafe:{occupied, seats, turned_away}, stock:{<slot>: 0..1},
//     kpi:{wait_p50_s, wait_p90_s, stockouts, lost_sales_gbp, spills_open, cafe_occupancy, shrink_gbp, incidents} }],
//   kpi_sources:{<kpi>: source} }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(HERE, '..', 'public', 'data');
const OUT = path.join(DATA, 'ops');
fs.mkdirSync(OUT, { recursive: true });
const plan = JSON.parse(fs.readFileSync(path.join(DATA, 'planogram.json'), 'utf8'));
const slots = Object.keys(plan).filter((s) => /^U[1-8]-r[1-3]$/.test(s)); // exist in every store layout (standard, 6-aisle, xl)

let seed = 20261003;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const A = (why) => `assumption: fixture — ${why}`;
const params = [
  { name: 'footfall_curve', value: 'lunch + after-work peaks', unit: 'arrivals/min', source: A('shape of a UK convenience/superstore day (busy 12-14h and 17-19h); replace with sim/ops.py sourced curve') },
  { name: 'staffed_tills', value: 6, unit: 'lanes', source: A('xl store config: 6 staffed + 12 self') },
  { name: 'scan_s_per_item', value: 3.0, unit: 's', source: A('cashier scan pace placeholder') },
  { name: 'spill_p_per_min', value: 0.03, unit: 'p', source: A('placeholder spill rate (inflated so a 2-minute demo shows one)') },
  { name: 'theft_p_per_min', value: 0.02, unit: 'p', source: A('placeholder attempt rate (inflated so a demo shows one); ops engine to use BRC/ONS sourced rate') },
  { name: 'cafe_seats', value: 12, unit: 'seats', source: A('6 tables x 2 seats (xl fixture)') },
  { name: 'reorder_point', value: 0.2, unit: 'share of facing capacity', source: A('placeholder for demand during lead time + safety stock') },
];
const MISSIONS = ['weekly_shop', 'meal_deal', 'top_up', 'treat', 'gym'];
const LANES = [...Array.from({ length: 6 }, (_, i) => `T${i + 1}`), ...Array.from({ length: 12 }, (_, i) => `S${i + 1}`)];
const staff = [
  { id: 'R1', role: 'restocker' }, { id: 'R2', role: 'restocker' }, { id: 'C1', role: 'cleaner' }, { id: 'M1', role: 'manager' }, { id: 'G1', role: 'guard' },
  ...Array.from({ length: 4 }, (_, i) => ({ id: `K${i + 1}`, role: 'cashier', lane: `T${i + 1}` })),
];
const footfall = (m) => { const h = m / 60; return 0.6 + 2.2 * Math.exp(-((h - 12.8) ** 2) / 1.2) + 2.6 * Math.exp(-((h - 17.8) ** 2) / 1.6) + 0.8 * Math.exp(-((h - 10) ** 2) / 2); };
const missionMix = (m) => { const h = m / 60; return { weekly_shop: h > 17 ? 0.15 : 0.3, meal_deal: Math.exp(-((h - 12.7) ** 2) / 0.8) * 0.7 + 0.05, top_up: h > 17 ? 0.45 : 0.2, treat: h > 15 && h < 17.5 ? 0.3 : 0.1, gym: h > 17 && h < 20 ? 0.2 : 0.05 }; };

const stock = Object.fromEntries(slots.map((s) => [s, 0.7 + rnd() * 0.3]));
const tasks = Object.fromEntries(staff.map((s) => [s.id, { task: s.role === 'cashier' ? 'serve' : 'idle', at: s.role === 'cashier' ? s.lane : s.role === 'manager' ? 'office' : s.role === 'guard' ? 'G1a' : 'stockroom', until: 0, then: null }]));
let spills = [], spillN = 0, inStore = 0, cafeOcc = 0, shrink = 0, incidents = 0, lost = 0;
const minutes = [];
for (let t = 480; t <= 1320; t++) {
  const arrivals = Math.round(footfall(t) * (0.7 + rnd() * 0.6));
  inStore = Math.max(0, Math.round(inStore * 0.93 + arrivals));
  const mix = missionMix(t); const tot = Object.values(mix).reduce((a, b) => a + b, 0);
  const shoppers = Object.fromEntries(MISSIONS.map((k) => [k, Math.round(inStore * mix[k] / tot)]));
  const load = inStore / 30;
  const queues = Object.fromEntries(LANES.map((l, i) => [l, l.startsWith('T') && i >= 4 && load < 1.2 ? 0 : Math.max(0, Math.round(load * (l.startsWith('T') ? 1.4 : 0.7) + (rnd() - 0.5) * 2))]));
  // stock depletes with footfall, restockers fix the lowest slot
  for (const s of slots) stock[s] = Math.max(0, stock[s] - rnd() * 0.012 * footfall(t));
  const orders = [];
  for (const st of staff) {
    const k = tasks[st.id];
    if (k.until > t) continue;
    if (k.then) { Object.assign(k, k.then, { then: null }); continue; }
    if (st.role === 'restocker') {
      const low = slots.filter((s) => stock[s] < 0.3 && !Object.values(tasks).some((o) => o.at === s)).sort((a, b) => stock[a] - stock[b])[0];
      if (k.task === 'restock' && stock[k.at] !== undefined) stock[k.at] = 1;
      if (low) Object.assign(k, { task: 'fetch', at: 'stockroom', until: t + 2, then: { task: 'restock', at: low, until: t + 6 } });
      else Object.assign(k, { task: 'idle', at: 'stockroom', until: t + 3 });
    } else if (st.role === 'cleaner') {
      const sp = spills.find((x) => x.state === 'open');
      if (k.task === 'clean') spills = spills.filter((x) => x.id !== k.spill);
      if (sp) { sp.state = 'cleaning'; Object.assign(k, { task: 'clean', at: `spill:${sp.id}`, spill: sp.id, until: t + 4 }); }
      else Object.assign(k, { task: 'idle', at: 'cafe', until: t + 4 });
    } else if (st.role === 'manager') {
      const low = slots.filter((s) => stock[s] < 0.2);
      if (low.length && rnd() < 0.5) {
        const s = low[Math.floor(rnd() * low.length)]; const code = plan[s].products[0];
        orders.push({ code, qty: 12 + Math.floor(rnd() * 4) * 6, why: `stock ${Math.round(stock[s] * 100)}% < reorder point 20% (fixture rule)` });
        Object.assign(k, { task: 'order', at: s, until: t + 3 });
      } else Object.assign(k, { task: 'walk', at: slots[Math.floor(rnd() * slots.length)], until: t + 5 });
    } else if (st.role === 'guard') {
      Object.assign(k, { task: 'patrol', at: rnd() < 0.5 ? 'G1a' : 'G2a', until: t + 6 });
    }
  }
  if (rnd() < 0.03 * Math.max(0.4, load)) { const s = slots[Math.floor(rnd() * slots.length)]; spills.push({ id: `sp${++spillN}`, at: s, state: 'open' }); }
  const alarms = [];
  if (rnd() < 0.02 * Math.max(0.5, load)) {
    const gate = rnd() < 0.5 ? 'G1a' : 'G2b'; const value = Math.round((2 + rnd() * 18) * 100) / 100;
    alarms.push({ gate, kind: rnd() < 0.7 ? 'eas' : 'skip_scan', value_gbp: value });
    Object.assign(tasks.G1, { task: 'respond', at: gate, until: t + 3, then: null });
    incidents++; shrink += rnd() < 0.4 ? value : 0;
  }
  const seats = 12, want = Math.round(seats * (0.25 + 0.6 * Math.exp(-((t / 60 - 10.5) ** 2) / 1.5) + 0.55 * Math.exp(-((t / 60 - 15.5) ** 2) / 1.5)) * (0.85 + rnd() * 0.3));
  cafeOcc = Math.min(seats, want);
  const stockouts = slots.filter((s) => stock[s] < 0.05).length;
  lost += stockouts * 0.04 * footfall(t);
  const qv = Object.values(queues).filter((q, i) => i < 6);
  const p50 = Math.round((qv.slice().sort((a, b) => a - b)[3] ?? 0) * 75 + 20), p90 = Math.round(Math.max(...qv) * 75 + 40);
  minutes.push({
    t, in_store: inStore, arrivals, shoppers, queues,
    staff: staff.map((s) => ({ id: s.id, task: tasks[s.id].task, at: tasks[s.id].at })),
    spills: spills.map((s) => ({ ...s })), orders, alarms,
    cafe: { occupied: cafeOcc, seats, turned_away: Math.max(0, want - seats) },
    stock: Object.fromEntries(slots.map((s) => [s, Math.round(stock[s] * 100) / 100])),
    kpi: { wait_p50_s: p50, wait_p90_s: p90, stockouts, lost_sales_gbp: Math.round(lost * 100) / 100, spills_open: spills.length, cafe_occupancy: Math.round((cafeOcc / seats) * 100) / 100, shrink_gbp: Math.round(shrink * 100) / 100, incidents },
  });
}
const day = {
  day: 'fixture', store: 'any', open: '08:00', close: '22:00', created: new Date().toISOString().slice(0, 19),
  _fixture: 'web/scripts/make-ops-fixture.mjs: synthetic ops day to build the replay against; not results',
  params, staff, minutes,
  kpi_sources: Object.fromEntries(['wait_p50_s', 'wait_p90_s', 'stockouts', 'lost_sales_gbp', 'spills_open', 'cafe_occupancy', 'shrink_gbp', 'incidents'].map((k) => [k, A('computed in the fixture generator from the placeholder params above')])),
};
fs.writeFileSync(path.join(OUT, 'day_fixture.json'), JSON.stringify(day));
const idxP = path.join(OUT, 'index.json');
let idx = []; try { idx = JSON.parse(fs.readFileSync(idxP, 'utf8')); } catch { idx = []; }
idx = [...idx.filter((d) => d.file !== 'day_fixture.json'), { file: 'day_fixture.json', day: 'fixture', fixture: true }];
fs.writeFileSync(idxP, JSON.stringify(idx, null, 1));
console.log(`ops fixture: ${minutes.length} minutes, ${spillN} spills, ${incidents} alarms → public/data/ops/day_fixture.json`);

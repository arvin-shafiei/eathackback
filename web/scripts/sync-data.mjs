#!/usr/bin/env node
// Copies the real pipeline outputs into web/public/data so the frontend replays them.
//   data/store/*.json             → public/data/
//   data/products/catalog.json    → public/data/catalog.json
//   data/personas/personas.json   → public/data/personas.json
//   data/sim/runs/*.json          → public/data/runs/  (+ runs/index.json)
// Anything missing is left as-is (the fixtures from `npm run fixtures` stay in place).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.resolve(HERE, '..', 'public', 'data');
fs.mkdirSync(path.join(OUT, 'runs'), { recursive: true });

const copied = [];
const copy = (src, dst) => {
  if (!fs.existsSync(src)) return false;
  try { JSON.parse(fs.readFileSync(src, 'utf8')); } catch (e) { console.warn(`skip (invalid json): ${src}: ${e.message}`); return false; }
  fs.copyFileSync(src, dst); copied.push(path.relative(ROOT, src)); return true;
};

// real pipeline first; if a file is missing fall back to the sim's own fixtures (sim/fixtures/) so the
// catalog/planogram always match the product codes used in data/sim/runs.
const SIMFX = path.join(ROOT, 'sim', 'fixtures');
const storeDir = path.join(ROOT, 'data', 'store');
for (const f of ['store.config.json', 'planogram.json']) {
  copy(path.join(storeDir, f), path.join(OUT, f)) || copy(path.join(SIMFX, f), path.join(OUT, f));
}
if (fs.existsSync(storeDir)) for (const f of fs.readdirSync(storeDir)) if (f.endsWith('.json') && !['store.config.json', 'planogram.json'].includes(f)) copy(path.join(storeDir, f), path.join(OUT, f));
copy(path.join(ROOT, 'data', 'products', 'catalog.json'), path.join(OUT, 'catalog.json')) || copy(path.join(SIMFX, 'catalog.json'), path.join(OUT, 'catalog.json'));
if (!copy(path.join(ROOT, 'data', 'personas', 'personas.json'), path.join(OUT, 'personas.json'))) {
  const dir = path.join(SIMFX, 'personas');
  if (fs.existsSync(dir)) {
    const list = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    fs.writeFileSync(path.join(OUT, 'personas.json'), JSON.stringify(list, null, 1));
    copied.push(`sim/fixtures/personas/*.json (${list.length}) → personas.json`);
  }
}

const runsDir = path.join(ROOT, 'data', 'sim', 'runs');
const realRuns = [];
if (fs.existsSync(runsDir)) {
  for (const f of fs.readdirSync(runsDir).filter((f) => f.endsWith('.json') && f !== 'index.json')) {
    if (!copy(path.join(runsDir, f), path.join(OUT, 'runs', f))) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
      const ai = (r.agents || []).filter((a) => a.persona_id === 'ai_agent').length;
      realRuns.push({ run_id: r.run_id || f.replace(/\.json$/, ''), file: f, created: r.created || '', agents: (r.agents || []).length, ai_agents: ai, fixture: false });
    } catch { /* validated above */ }
  }
}

// index = real runs first (newest first), then any fixture runs still on disk
const idxPath = path.join(OUT, 'runs', 'index.json');
let existing = [];
try { existing = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch { existing = []; }
// fixture runs use the web fixture catalog; once real runs exist they would mismatch, so drop them from the index
const fixtures = realRuns.length ? [] : existing.filter((r) => r.fixture && fs.existsSync(path.join(OUT, 'runs', r.file)));
realRuns.sort((a, b) => String(b.created).localeCompare(String(a.created)));
fs.writeFileSync(idxPath, JSON.stringify([...realRuns, ...fixtures], null, 1));

// ---- XL store (data/store/store_xl.config.json + planogram_xl.json + data/products/catalog_xl.json) → public/data/xl/
const xlCfg = path.join(storeDir, 'store_xl.config.json');
const storesPath = path.join(OUT, 'stores.json');
let stores = []; try { stores = JSON.parse(fs.readFileSync(storesPath, 'utf8')); } catch { stores = []; }
if (!stores.some((s) => s.id === 'standard')) stores.unshift({ id: 'standard', dir: '', label: 'standard store', fixture: false });
if (fs.existsSync(xlCfg)) {
  fs.mkdirSync(path.join(OUT, 'xl'), { recursive: true });
  const ok = copy(xlCfg, path.join(OUT, 'xl', 'store.config.json'));
  copy(path.join(storeDir, 'planogram_xl.json'), path.join(OUT, 'xl', 'planogram.json'));
  copy(path.join(ROOT, 'data', 'products', 'catalog_xl.json'), path.join(OUT, 'xl', 'catalog_extra.json'));
  if (ok && fs.existsSync(path.join(OUT, 'xl', 'planogram.json'))) { stores = stores.filter((s) => s.id !== 'xl'); stores.splice(1, 0, { id: 'xl', dir: 'xl', label: 'xl store', fixture: false }); }
}
fs.writeFileSync(storesPath, JSON.stringify(stores, null, 1));

// ---- dashboards + ops: copy whole folders of json and write an index.json per folder
const syncDir = (src, dst, filter = (f) => f.endsWith('.json') && f !== 'index.json') => {
  if (!fs.existsSync(src)) return [];
  fs.mkdirSync(dst, { recursive: true });
  const files = [];
  for (const f of fs.readdirSync(src).filter(filter)) if (copy(path.join(src, f), path.join(dst, f))) files.push(f);
  return files;
};
const SIM = path.join(ROOT, 'data', 'sim');
for (const d of ['layout', 'brand', 'swaps', 'visits']) {
  const files = syncDir(path.join(SIM, d), path.join(OUT, 'sim', d));
  if (files.length) fs.writeFileSync(path.join(OUT, 'sim', d, 'index.json'), JSON.stringify(files.sort(), null, 1));
}
const opsFiles = syncDir(path.join(SIM, 'ops'), path.join(OUT, 'ops'), (f) => /^day_.*\.json$/.test(f));
if (opsFiles.length || fs.existsSync(path.join(OUT, 'ops'))) {
  fs.mkdirSync(path.join(OUT, 'ops'), { recursive: true });
  const fx = fs.existsSync(path.join(OUT, 'ops', 'day_fixture.json')) ? [{ file: 'day_fixture.json', day: 'fixture', fixture: true }] : [];
  fs.writeFileSync(path.join(OUT, 'ops', 'index.json'), JSON.stringify([...opsFiles.filter((f) => f !== 'day_fixture.json').sort().reverse().map((f) => ({ file: f, day: f.replace(/^day_|\.json$/g, ''), fixture: false })), ...fx], null, 1));
}
const PROV = path.join(ROOT, 'data', 'provenance');
if (fs.existsSync(PROV)) {
  fs.mkdirSync(path.join(OUT, 'provenance', 'personas'), { recursive: true });
  copy(path.join(PROV, 'graph.json'), path.join(OUT, 'provenance', 'graph.json'));
  copy(path.join(PROV, 'corpus_stats.json'), path.join(OUT, 'provenance', 'corpus_stats.json'));
  syncDir(path.join(PROV, 'personas'), path.join(OUT, 'provenance', 'personas'), (f) => f.endsWith('.json'));
}

console.log(copied.length ? `synced ${copied.length} files:\n  ${copied.join('\n  ')}` : 'nothing to sync yet (fixtures kept)');
console.log(`runs/index.json: ${realRuns.length} real run(s), ${fixtures.length} fixture run(s)`);

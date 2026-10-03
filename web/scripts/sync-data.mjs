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

console.log(copied.length ? `synced ${copied.length} files:\n  ${copied.join('\n  ')}` : 'nothing to sync yet (fixtures kept)');
console.log(`runs/index.json: ${realRuns.length} real run(s), ${fixtures.length} fixture run(s)`);

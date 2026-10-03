# web: the 3D store ("simsbury: same shelf, two shoppers")

Vite + React + TypeScript + three + @react-three/fiber + @react-three/drei.
It replays sim runs in a low-poly store and makes every number clickable back to its source.

## run it

```bash
cd web
npm install
npm run sync      # copy the pipeline outputs into public/data (see below)
npm run dev       # http://localhost:5173
npm run build     # type-check + production build into web/dist
```

`npm run fixtures` regenerates the synthetic fixture set: 24 slots, 70 fictional `FX` products, 12 personas, and 1 run with 40 agents (32 human, 8 ai). Use it when the pipeline has produced nothing yet. A yellow banner in the UI marks fixture data. Fixture verbatims are real Reddit comments from `data/reddit/comments.csv`, each with its thread URL. Fixture coefficients are labelled `assumption: fixture …` or cite `research/04`.

## data the app loads (`web/public/data/`)

| file | copied by `npm run sync` from | fallback |
|---|---|---|
| `store.config.json`, `planogram.json` | `data/store/*.json` | `sim/fixtures/` |
| `catalog.json` | `data/products/catalog.json` | `sim/fixtures/catalog.json` |
| `personas.json` | `data/personas/personas.json` | `sim/fixtures/personas/*.json` merged into one array |
| `runs/*.json` + `runs/index.json` | `data/sim/runs/*.json` | the fixture run (dropped from the index once real runs exist) |

The shapes follow `/CONTRACT.md`. Tolerated extras:
- `run.planogram_inline`: shoppers replay on the layout that run actually used.
- `agent.archetype`, `notice_factors.logit_terms`.
- feed slots (`"feed:<mission>"`) from the ai-agent arm: those agents walk to the product's shelf slot.
- `agent_*.json` runs (only ai agents) appear in the **+ ai arm** picker and merge into the human run for the compare view.

## what's on screen

- **replay**: shoppers are capsules coloured by archetype. ai agents are purple robots. They walk the aisle walkways and pause at each slot. A sticker pops for each decision: ✅ picked, ✖ rejected, 👀 walked past. Thought bubbles show the agent's own reason. You get play/pause (space), a 0.5–8× speed control, a scrubber and live counters. Camera presets are overview, walk (wasd/arrows) and follow shopper.
- **click a product**: a Card3D panel opens with:
  - the funnel (shown → noticed → considered → picked, plus walked past and rejected)
  - pick rate with a Wilson 95% CI
  - humans vs ai bars and the divergence between them
  - by-archetype bars
  - "why they put it back", grouped by mechanism, with the agents' own quotes
  - every decision, plus lens grades with their `why` fields

  Every quote opens **the trace**.
- **the trace** covers one decision:
  1. who: persona and OCEAN radar
  2. did they notice: the p_notice formula, each factor and the sourced α from the run's `notice_model`
  3. what they looked at: the attributes they cited, with the product's actual values linked to Open Food Facts
  4. why: the mechanism and `source_refs`, with clickable links
- **click a shopper**: persona card with the OCEAN radar (sampled vs base), ocean effects with sources, lens weights with sources, dossier, Reddit verbatims, and their whole trip.
- **humans vs ai**: per-product pick rate for each arm, sorted by divergence. ★ marks rows where the 95% CIs don't overlap. A shelf-edge heat strip in the 3D view shows the pick rate, or ai − human.
- **edit planogram**: drag a set onto another slot in the grid, or click two slots on the shelves, to swap them. Changed slots turn yellow. **re-run shoppers** POSTs `{planogram, agents: 20, seed, mock, label}` to `/api/run`. In dev, vite proxies `/api` to `http://localhost:8787`. If that fails it tries `http://localhost:8787/api/run` directly (`sim/server.py`). The returned run loads straight into the replay. With no server you get a stub message and a **download json** button. "use llm" is off by default (rule-based heuristic, free). Turn it on to spend OpenRouter budget.

Start the sim server with `python sim/server.py`. If something else is already on :8787, the UI falls back to the stub.

## add product and analytics

- **＋ add product**: paste a Tesco link or barcode (calls `/api/import`) or type the pack in; pick the product it replaces; **send the shoppers** runs 150 shoppers plus the AI arm on the store on screen and opens analytics. Needs the sim server.
- **📊 analytics**: per-product numbers counted in the browser from the run's events (`src/insights.ts`), plus the placement heatmap, placement test and other fixes from the server (`src/ui/PlacementSection.tsx`).
- Both screens pause the 3D replay while open. "use llm" off means the rule-based heuristic.

## where things live

- `src/layout.ts`: store geometry, built only from `store.config.json`, so more aisles, units or rows just work. Also waypoint routing and the replay timeline.
- `src/stats.ts`: in-browser counting from events and the Wilson CI. The panel footers say exactly which events were counted.
- `src/scene/`: Store (gondolas, shelves, product boxes with OFF images or canvas-drawn fallback packs), Shoppers, Scene (camera rig and clock).
- `src/ui/`: ProductPanel, AgentPanel, TracePanel, ComparePanel, EditPanel.
- `scripts/sync-data.mjs` and `scripts/make-fixtures.mjs`.

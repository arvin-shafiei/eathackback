# evidence dashboard (`web/dashboard.html`)

A second Vite page beside the 3D store. It shows the personas, where their numbers come from, and every
simulation result. **Rule zero: every number on screen carries its source.** Hover, focus or tap any
dotted number to see the repo file, the JSON field, the method, and any external URL (OFF page, Reddit
thread, paper). Click to pin the tooltip and Esc to close it. Dashed amber underlines mark **assumptions**
and violet underlines mark **Jev probabilities**.

## run it

```bash
cd web
node scripts/sync-dashboard.mjs     # copy data/ -> public/data/dashboard/ (re-run after any new sim output)
npm run dev                         # http://localhost:5173/dashboard.html
# or a static build
npx vite build && npx vite preview --port 4174   # http://localhost:4174/dashboard.html
```

The persona builder needs the sim server:

```bash
python3 sim/server.py               # :8787. The dashboard tries /api (vite proxy) first, then http://localhost:8787/api
python3 sim/server.py 8788          # if 8787 is taken; then open dashboard.html?api=http://localhost:8788/api
```

You can also type the URL into the "server isn't answering" panel; it is remembered in localStorage.
`?engine=mock` runs the builder test without Jev. The page then shows a banner saying the results are not evidence.

## tabs (`#hash` routes)

| tab | reads | what it shows |
|---|---|---|
| `#personas` | `data/personas/lens/*.json` (+ `custom/`), `data/provenance/personas/index.json` | One card per persona: OCEAN radar, lens weights (hover shows `why` + `source` + OFF field), put-offs and trust signals with sources, Reddit verbatims with thread links, sim parameters, and the **evidence-mix honesty meter** (reddit / paper / OFF / staged / web / internal / sales / assumption). The assumption share is always printed. The 13 staged dossiers get the same meter. |
| `#build` | `data/personas/ocean/*.json`, `off_fields.json` (catalog keys ∩ OFF allow-list) | Form with name, archetype, mission, budget, OCEAN sliders, lens attributes and put-offs/trust signals. Each OCEAN trait lists its trait→behaviour links with coefficient and citation (strongest 3 first). Weights auto-normalise live. **save** sends `POST /api/personas` and shows the normalised lens plus each sim parameter, marked *borrowed* (with the nearest persona + similarity) or *yours*. **test in store** sends `POST /api/run {persona_ids:[id], agents_per_persona:10, engine:"jev"}` and shows the per-category funnel look → pick up → put back → take with Wilson 95% CIs, put-back mechanisms with mean Jev p, and fired put-offs with sources and verbatims. **Jev errors are surfaced as a banner.** |
| `#provenance` | `data/provenance/graph.json`, `corpus_stats.json` | Sankey subreddit → thread → theme → mechanism/source → persona → attribute. **Each band is scaled on its own** (units change: comments → coded counts → attributes), so a ribbon end shows its share of that node's flow, and the caption says so. With "all personas", the 1,159 attributes are grouped by kind. "Focus" traces one persona back through `via_themes` / `via_thread_ids`. Clicking a node shows its count, its links with match method, and the verbatims/URLs. Corpus totals and the top verbatims for each mechanism family sit below. |
| `#retailer` | `data/sim/layout/summary.json`, `report_{retailer,ease,blended}.json` | Three objectives × four metrics (relative change with 95% CI, coloured only when the CI excludes 0), before→after KPI cards (+ "layout alone" without end-caps), the move list with reasons and formulas (assumed prices flagged), the objective definition and weights, and the HFSS-checked end-caps. |
| `#brand` | `data/sim/brand/<code>.json`, `data/sim/brand/pack_test/<code>.json` | Product picker, then the funnel with CIs against the category average, the leak-stage diagnosis and its rule, notice/pick-up/appeal evidence, fired put-offs with Jev p and verbatims, take rate by archetype, sim rank vs NielsenIQ (The Grocer) rank where matched, the AI-agent pick share, and the **pack test** heatmap (variant × persona ΔP(pick up), with the ±0.02 noise floor). |
| `#shopper` | `data/sim/swaps/*.json`, `claim_premium.json`, `data/sim/visits/*.cards.json` | Swaps ranked by P(accept) × lens gain, with the price delta (stickered **assumption** where `price_is_assumption`), the health deltas from OFF, and the triggers removed. The claim-premium table shows per-100g and shelf premiums with bootstrap CIs and whether claims meet Reg 1924/2006 in the UK OFF pool. Route cards appear only if `data/sim/visits/` has `*.cards.json`; a mock run is stickered. |
| `#ai` | newest `data/sim/runs/agent_*jev*.json` + `run_*jev*.json` (derived into `aivh.json`) | Position bias: share of picks at position 1 vs chance, with CI, for Jev and the earlier OpenRouter LLM runs, plus a pick-position histogram against the uniform expectation. Human vs agent within-category pick shares as dumbbells with D = ln(s_agent/s_human) (+0.5 smoothing, labelled) and JSD per category. Categories with fewer than 10 agent picks are greyed. |

## data flow

`scripts/sync-dashboard.mjs` copies files as they are, except where the source is too big to ship. The run
logs are 1–40 MB, so `aivh.json` is derived from them. It records its method, and each derived number
points back to `run_*.json → stats.per_product[code].picked`. "Newest run" means the newest by filename
that has `cost.errors == 0` and at least 50 shoppers (or 20 feeds), so a small dashboard test run never
becomes the baseline. `manifest.json` lists every source; the "data synced" stamp in the header links to it.

## files

- `web/dashboard.html` is the entry point.
- `web/src/dashboard/`
  - `App.tsx` is the shell.
  - `lib/src.tsx` holds the `<S src={{file, field, note, url, kind}}>` source wrapper and its tooltip.
  - `lib/api.ts` is the sim-server client.
  - `lib/stats.ts` has the Wilson CI and formatting helpers.
  - `ui/` holds the cards, CI bars, radar and evidence meter.
  - `tabs/*.tsx` has one file per tab.
- `web/scripts/sync-dashboard.mjs` copies the data. Its output in `web/public/data/dashboard/` is regenerated, so don't edit it.
- `vite.config.ts` gains `build.rollupOptions.input = {main, dashboard}` and a `preview.proxy` for `/api`. The existing keys are unchanged.

## design

This follows `design/design-language.md`. The brand gradient appears once (the header), every card has a
2px ink outline on a solid ledge, titles and numbers use Baloo 2 with Inter for body text, badges are
stickers, and all copy is lowercase. The tokens come from `src/styles.css`, which is imported read-only.
Evidence-class colours run in a fixed order and pass the dataviz palette validator (CVD and normal-vision
separation). Assumption is always an ink hatch, so it reads without colour.

## known gaps

- `sim/server.py build_persona` borrows sim parameters from the nearest persona's normalised
  `sim_parameters`; the dashboard shows exactly what the server returns.
- The pack test only exists for the products `sim/pack_test.py` was run on (3 today). Other products show the command to run it.

# sim: the shelf simulation engine

Python 3 (stdlib + `requests`). Everything is traceable: each coefficient has a `source`, each event records the logit terms behind its `p_notice`, and each LLM decision records the model and prompt that produced it.

## Pipeline (one shopper)

1. **Spawn.** Personas are sampled from `data/personas/lens/*.json`, stratified so every archetype appears. If that folder is missing, the loader falls back to `data/personas/personas.json`, then to `sim/fixtures/personas/`. Each agent gets the persona's OCEAN plus N(0, 0.08) jitter (`ocean_jitter_sd`, an assumption).
2. **Path.** The shopper walks the units in aisle order. A unit is visited if its category is on the mission (`MISSION_CATEGORIES` in `run.py`, an assumption, overridable per persona), or by browsing with p = 0.25 (`browse_prob`, an assumption). The shopper scans every row of each visited unit.
3. **Notice gate (no LLM)**, in `notice.py`:
   `p = σ(α0 + α_row + α_f·ln(min(facings,6)) + α_c·(centrality−1) + mission + time + Σ OCEAN)`
   - α0 = logit(0.55), or logit of the persona's skeptic-calibrated `p_notice_eye_level` when it has one.
   - Row offsets come from the eye vs floor +39% sales and top vs bottom +17% noticing figures (research/04). The resulting top, eye and bottom rates are 0.46, 0.55 and 0.40.
   - α_f = 0.17 / (1 − p_ref) is the facings elasticity of 0.17 (Eisend 2014 via research/04). Doubling facings gives about +12% p.
   - α_c is the centre-vs-edge +15% (Atalay et al. 2012).
   - OCEAN terms are read from `data/personas/ocean/*.json`. Only effects whose `sim_mapping` targets the notice or label-read stage are used, z-scored with each file's own UK norm convention (Rentfrow et al. 2015). If those files are missing, the labelled defaults in `coefficients.json` apply.
   - Label reading: p_read = σ(logit(0.27) + C/E/N label terms), with the 27% base from Grunert et al. 2010 via C.json. This is blended 50/50 with the persona's `reads_structured_data_0_1`. If the shopper reads labels, the card shows ingredients and nutrition.
   - The uniform draws are hashed on (seed, agent, product), so the optimiser compares like with like (common random numbers).
4. **LLM (only for noticed products).** There is one call per slot covering the products noticed in it. The persona system prompt is built in `prompts.py` from the dossier, OCEAN with behavioural meaning, lens, rejection triggers, trust signals, habits, Reddit verbatims, mission, seconds at shelf and remaining budget. It explicitly says that walking past is normal. The output is JSON: `{decision, product, reason, attributes_cited, feeling, sentiment, mechanism, others}`. The card shows only what is on the pack; shelf position is not shown, because the notice model already accounts for it.
5. **Budget.** If the LLM picks something over the remaining budget, the pick becomes `reject` and is flagged `budget_override: true, llm_decision: "pick"`.

The run log is written to `data/sim/runs/<run_id>.json` in the CONTRACT shape. Extra fields: `notice_model` (all coefficients and sources), `inputs`, `cost`, and per event `notice_factors.logit_terms` and `trait_terms`. Stats include `pick_rate` (picked/shown) with a Wilson 95% CI, `notice_rate`, `pick_rate_given_noticed` with its CI, `by_archetype`, `by_ocean_segment` (trait ≥ 0.5 counts as high), `top_reject_reasons` grouped by mechanism with verbatim examples, and `mean_sentiment`. Secondary products (seen but not the focus of the decision) count as walk_past or reject and are flagged `secondary: true`.

## CLI

```bash
python3 sim/run.py --agents 30 --mock                       # dry run, no API, deterministic heuristic (reasons prefixed [mock])
python3 sim/run.py --agents 30 --models google/gemini-2.5-flash,openai/gpt-4.1-mini --seed 1 --planogram data/store/planogram.json
python3 sim/agent_shopper.py --models google/gemini-2.5-flash,openai/gpt-4.1-mini --runs 5      # AI-agent arm
python3 sim/optimise.py --product <code> --agents 40 --seeds 1,2 --edits eye,facings,claim [--price 1.40]
python3 sim/server.py            # :8787  POST /api/run /api/agent_run /api/optimise, GET /api/runs /api/runs/<id> /api/coefficients
python3 sim/notice.py            # print the coefficient table + p_notice grid
python3 sim/llm.py               # print OpenRouter limit_remaining
```

## AI-agent arm (`agent_shopper.py`)

The same catalogue is rendered as a JSON feed of structured OFF fields, shuffled with a seed on each run, under 4 missions that each carry a source. The run log uses the same event shape, with `persona_id: "ai_agent"` and the feed `position` on every event. `position_bias` reports, per model, the share of picks at position 1 against the 1/n expected if order did not matter (with a CI).

## Optimiser (`optimise.py`)

It makes honest edits only:
- **eye**: swaps the product's slot set with the eye-level set in the same unit.
- **facings**: adds one facing, taken from the widest neighbour.
- **claim**: adds a true nutrition claim to `pack_copy`, using the product's own OFF fields and the Reg. (EC) 1924/2006 thresholds (high fibre ≥ 6 g, low sugar ≤ 5 g or ≤ 2.5 g for liquids, high protein ≥ 20% of energy, low salt ≤ 0.3 g).
- **price**: sets a new price.

Only agents whose path enters the edited unit are re-run, with the same seed and the same notice draws. The output is Δpick with a Newcomb hybrid-Wilson 95% CI, which is conservative because it treats the two arms as independent. Results go to `data/sim/optimise/`.

## LLM plumbing (`llm.py`)

- Calls OpenRouter `/chat/completions` with `response_format: json_object`, `usage.include` (to get the real cost per call) and `reasoning.enabled=false`. It retries with backoff on 429/5xx or bad JSON.
- Responses are cached on disk at `data/sim/cache/<sha256(model, messages, max_tokens, temperature)>.json`.
- Each call's cost is appended to `data/sim/cost_log.jsonl`.
- **Spend guard**: before every uncached call it reads `limit_remaining` from `https://openrouter.ai/api/v1/key` (cached for 20 s). It refuses to call if the value is below $5 or cannot be read.
- The key is read from `.env` first and only then from the shell environment, so spend always lands on the capped project key.

## Tested (2026-10-03)

- Mock end to end: `run.py --mock` with 40 agents, `agent_shopper.py --mock`, `optimise.py --mock` (2 seeds × 3 edits), and the server endpoints.
- Real: `run.py --agents 2 --models google/gemini-2.5-flash --max-tokens 250` made 15 LLM calls, 0 errors, for **$0.0126**. That is about 2.1k prompt tokens and 95 completion tokens per call, or roughly $0.006 per shopper, so 100 shoppers cost about $0.65.
- Real: `agent_shopper.py`, 1 run, cost under $0.001.

## Caveats (say these out loud)

- Fixtures (`sim/fixtures/`) are placeholders marked `fixture: true`. They are used only until `data/store/*.json` and `data/products/catalog.json` exist.
- Several magnitudes are labelled assumptions in `coefficients.json`: the off-mission penalty, the seconds-at-shelf slope, browse probability and OCEAN jitter.
- Choice-stage OCEAN effects (as opposed to notice-stage ones) reach the LLM only through the persona prompt, not as numbers.
- Turning a sales lift into a noticing lift assumes the whole shelf effect runs through attention (Chandon 2009).

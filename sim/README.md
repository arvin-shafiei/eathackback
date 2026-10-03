# sim: the shelf simulation engine

Python 3 (stdlib + `requests` + `typesafe-sdk`). Everything is traceable: each coefficient has a `source`, each event records the logit terms behind its `p_notice`, and each decision records the engine, the exact Jev question set (by cache key) and the full answer distributions behind it.

**Default engine: TypeSafe Jev** (`sim/jev.py`, see [engine: jev](#engine-typesafe-jev-simjevpy)). OpenRouter LLMs are only called with an explicit `--engine llm`; no code path falls back to them.

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
4. **Decision (only for noticed products): the 4-stage funnel.** LOOK = noticed (step 3) → PICK_UP → PUT_BACK or TAKE. With `--engine jev` (default) there is one Jev fan-out request per slot covering every noticed product (details below). Each event gets `stage_reached` ∈ {not_noticed, looked, picked_up, put_back, taken} and `p_pick_up`; `decision` stays for back-compat (taken→pick, put_back→reject, looked→walk_past). `--engine llm` keeps the original persona-prompt LLM path (`prompts.py`, JSON `{decision, product, reason, …}`); `--engine mock` is a deterministic heuristic. For those two, stage is mapped from decision.
5. **Budget.** If the engine picks something over the remaining budget, the pick becomes `reject` / `put_back` and is flagged `budget_override: true, llm_decision: "pick", engine_decision: "pick"`.

The run log is written to `data/sim/runs/<run_id>.json` in the CONTRACT shape. Extra fields: `notice_model` (all coefficients and sources), `inputs`, `cost`, and per event `notice_factors.logit_terms` and `trait_terms`. Stats include a per-product `funnel` (looked, picked_up, put_back, taken counts and rates per shown, each with a Wilson 95% CI, plus conversions look→pickup and pickup→take with CIs) and `funnel_by_archetype`, `pick_rate` (picked/shown) with a Wilson 95% CI, `notice_rate`, `pick_rate_given_noticed` with its CI, `by_archetype`, `by_ocean_segment` (trait ≥ 0.5 counts as high), `top_reject_reasons` grouped by mechanism with verbatim examples, and `mean_sentiment`. Secondary products (seen but not the focus of the decision) count as walk_past or reject and are flagged `secondary: true`.

## CLI

```bash
python3 sim/run.py --agents 30 --seed 1                    # Jev (default): TypeSafe System One
python3 sim/run.py --agents 30 --engine mock                # dry run, no API, deterministic heuristic (reasons prefixed [mock])
python3 sim/run.py --agents 30 --engine llm --models google/gemini-2.5-flash   # OpenRouter, only when explicitly asked
python3 sim/agent_shopper.py --runs 20                      # AI-agent arm, Jev Choice over the shuffled feed
python3 sim/optimise.py --product <code> --agents 40 --seeds 1,2 --edits eye,facings,claim [--price 1.40]   # Jev by default
python3 sim/server.py            # :8787, see "Server" below
python3 sim/notice.py            # print the coefficient table + p_notice grid
```

`run.py` flags: `--engine jev|llm|mock` (default jev; `--mock` = `--engine mock`), `--workers` (default 40 agents in flight for jev), `--jev-max-usd` (session stop, default $5).

## engine: TypeSafe Jev (`sim/jev.py`)

Code stays in control; Jev answers narrow typed judgments ([building guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md)). All arithmetic is done in code and handed over as words ([jaggedness #2, math and numbers](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)):

- **price** → "£1.80, about 2x the cheapest here"; unit price → "lowest price per litre in this set"; budget → "fits easily in the budget left"
- **nutrition** (only on cards whose back of pack is seen) → UK FoP traffic lights per 100 g/ml ("sugar: red (high)", DHSC/FSA 2016 thresholds; drink thresholds for liquids), protein/fibre claim bands (Reg. 1924/2006), additives bucket ("one or two additives"), NOVA words, sweeteners, palm oil, allergens, first 180 chars of ingredients
- **shopper** → 3 dossier sentences, mission, budget in words, OCEAN as behaviour phrases (only traits ≥ 0.65 or ≤ 0.35, e.g. "high conscientiousness: sticks to the list and budget, reads labels, plans"), top 3 lens priorities, top 3 rejection triggers (`put_offs`), top 2 trust signals, 2 habits, basket so far. Kept small on purpose ([jaggedness #5, large state](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)).

**Questions, all in one request per (agent, slot)** ([speculative fan-out](https://docs.typesafe.ai/patterns/fan-out.md)); state is counted once per request, so each extra question costs ~15 input tokens:

| id | primitive | asks |
|---|---|---|
| `decision` | Choice | options `p0..pN` "takes `products[i]` (name) and puts it in the basket" + `none` "walks past without taking anything". Option order shuffled with a seeded RNG and recorded ([jaggedness #8](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)) |
| `pickup_i` | Noul | "Does `shopper` pick up `products[i]` to look at it more closely?" |
| `appeal_i` | Score, 5 levels | would actively avoid / dislikes / indifferent / mildly drawn / really wants it → sentiment = score/2 − 1 |
| `trig_i_k` | Noul ×3 | "Does `products[i]` show what `shopper.put_offs[k]` describes?" (the traceable WHY) |
| `trust_i_k` | Noul ×2 | "Does `products[i]` show what `shopper.trusts[k]` describes?" |
| `mechanism_i` | Choice | habit, loss_aversion (betrayal), price_anchor, trust, gimmick_reactance, social_proof, health_goal, mission_fit, novelty, effort, indifference (order shuffled + recorded) |

**Composition in code.** Pick-up is sampled per product with `u = sha256(seed, agent, "pickup", product)` < `p_pick_up`. If the shopper doesn't read labels (C draw) but picked something up, a **second request (B)** re-asks every judgment with the back of pack revealed for the picked-up items (a follow-up is warranted when an answer changes the state); otherwise request A is final. The decision is **sampled** from the Choice distribution with `u = sha256(seed, agent, "jev_decide", slot)` walking the shuffled option order; the event stores the full distribution, `confidence` ([confidence](https://docs.typesafe.ai/confidence.md)), the sampled option and whether it equals the argmax. Stage: sampled product → `taken`; else picked up → `put_back`; else `looked`. Deterministic draws = common random numbers, so the optimiser compares like with like.

**Reasons are built from evidence, not generated**: e.g. `[jev] picked it up, put it back: sees 'Protein/'new recipe' claim carrying a price premium…' (p=0.53) — like "Aldi briefly sold "protein" chicken sausages…"`. The matching persona verbatim (quote + URL) is attached in `verbatim`, found by (1) a persona verbatim from a thread the trigger cites, (2) a quote inside the trigger's source, (3) the persona verbatim with the most word overlap; the method is recorded.

**Per event** (`jev` block): `decision` {probabilities, options, option_order, confidence, argmax, sampled, sampled_is_argmax, draw_u}, `self`, `pick_up` {p, draw_u, examined}, `appeal` {score, level, probabilities, confidence, p_dislike_or_avoid}, `nouls` (all p), `nouls_fired` (text, p, source), `mechanism` {choice, probabilities, confidence, option_order}, `requests` [{purpose A/B, jev_model e.g. `jev-1.13.0`, cache_key, input/output tokens, cost_usd}]. Static text (rules, level labels, pricing, docs) is in the run-level `jev_legend`. `data/sim/cache/jev/<cache_key>.json` holds the exact state, questions and raw answer for every request.

**Plumbing.** `jev.ask(state: dict, questions: dict, *, tag: str) -> dict` is the reusable entry point (also for `swaps.py`, `pack_test.py`, `layout_optimise.py`): returns the raw API JSON (`model`, `answers`, `usage`) plus `cached`, `cost`, `cache_key`. Disk cache on sha256(model, state, questions); every uncached call is appended to `data/sim/cost_log.jsonl` with `model: "jev"`. Key from `.env` (`TYPESAFE_API_KEY`) first. A shared token bucket keeps under 70 req/s and 90k tok/s (limits 80 req/s, 100k tok/s); the SDK retries 429/5xx with backoff (`max_retries=6`). Cost = input tokens × $0.042/M (output free).

## AI-agent arm (`agent_shopper.py`)

The same catalogue is rendered as a feed, shuffled with a seed on each run, under 4 missions that each carry a source. Default model is **Jev**: one Choice whose options are the feed items **in feed order** (`f0` = position 1) plus `none`, so the first-option lean is measured rather than hidden; feeds over 254 items go hierarchical (per-category Choice, then a final Choice over category winners). Numbers are bucketed to words like the shopper engine. The pick is sampled from the distribution with a seeded draw. The run log uses the same event shape, with `persona_id: "ai_agent"` and the feed `position` on every event. `position_bias` reports, per model, the share of picks at position 1 against the 1/n expected (with a CI), and for Jev also `mean_prob_at_1` vs `uniform_prob_at_1` and `argmax_at_1`. OpenRouter models are only used if named in `--models`.

## Optimiser (`optimise.py`)

It makes honest edits only:
- **eye**: swaps the product's slot set with the eye-level set in the same unit.
- **facings**: adds one facing, taken from the widest neighbour.
- **claim**: adds a true nutrition claim to `pack_copy`, using the product's own OFF fields and the Reg. (EC) 1924/2006 thresholds (high fibre ≥ 6 g, low sugar ≤ 5 g or ≤ 2.5 g for liquids, high protein ≥ 20% of energy, low salt ≤ 0.3 g).
- **price**: sets a new price.

Only agents whose path enters the edited unit are re-run, with the same seed and the same notice draws. The output is Δpick with a Newcomb hybrid-Wilson 95% CI, which is conservative because it treats the two arms as independent. Results go to `data/sim/optimise/`.

## Server (`server.py`, :8787, CORS on every response)

- `POST /api/run` `{planogram, agents, seed, engine: "jev"|"mock"|"llm", persona_ids?: [...], agents_per_persona?: N}`: runs the store (Jev by default; the UI's `mock: false` means Jev) and returns the run JSON. `persona_ids` + `agents_per_persona` test only those personas.
- `POST /api/agent_run` `{models: ["jev"], runs, seed}` · `POST /api/optimise` `{product, agents, seeds, edits, engine}` · `GET /api/runs`, `/api/runs/<id>`, `/api/coefficients`, `/api/health`.
- `GET /api/personas`: every persona from `data/personas/lens/*.json` and `data/personas/custom/*.json`, each with `custom: true|false`.
- `POST /api/personas` (persona builder): body in CONTRACT shape; required `name, archetype, mission, budget_gbp, ocean{O,C,E,A,N}, lens[{attribute, off_field, direction, weight, why}], rejection_triggers[], trust_signals[]`. Validation: mission must be a known mission; OCEAN clamped to 0–1 (clamps recorded); every `off_field` must be a real catalogue field (400 with the valid list otherwise); lens weights normalised to sum to 1 (the typed value is kept as `weight_input`). Missing `sim_params` are borrowed from the nearest existing persona by 0.5·cosine(OCEAN centred at 0.5) + 0.5·cosine(lens weights by off_field), recorded in `sim_params_borrowed_from` and per key in `sim_params_sources`. Every user-set value has source `"user-defined (dashboard)"`. Saved to `data/personas/custom/<slug>.json` (id `p_custom_<slug>`), which `run.py` loads automatically.

## LLM plumbing (`llm.py`, only for `--engine llm` or explicit OpenRouter models)

- Calls OpenRouter `/chat/completions` with `response_format: json_object`, `usage.include` (to get the real cost per call) and `reasoning.enabled=false`. It retries with backoff on 429/5xx or bad JSON.
- Responses are cached on disk at `data/sim/cache/<sha256(model, messages, max_tokens, temperature)>.json`.
- Each call's cost is appended to `data/sim/cost_log.jsonl`.
- **Spend guard**: before every uncached call it reads `limit_remaining` from `https://openrouter.ai/api/v1/key` (cached for 20 s). It refuses to call if the value is below $5 or cannot be read.
- The key is read from `.env` first and only then from the shell environment, so spend always lands on the capped project key.

## Tested (2026-10-03)

- Mock end to end: `run.py --engine mock`, `agent_shopper.py --mock`, `optimise.py --mock`, server endpoints.
- **Jev, 10 agents** (`run.py --agents 10 --engine jev --seed 3`): 204 requests (160 slots + 44 follow-ups), 786k input tokens, **$0.033**, 10.2 s wall, 0 errors. Funnel: 406 looked → 143 picked up (35%) → 76 taken (53% of pick-ups).
- **Jev, 300 agents** (`--agents 300 --engine jev --seed 11`, real 96-SKU catalogue + 24-slot planogram): 6,187 requests (461 served from cache: identical state + option order), 22.7M input tokens, **$0.87** spent ($0.95 if uncached), **222.6 s** wall (throttled by the 100k tok/s limit), 0 errors, 0 budget overrides. 19,992 product-passes: notice 57.0%, take 12.1% [11.7, 12.6], look→pickup 38.0%, pickup→take 55.9%; 8.1 items per shopper. By role, take rate: own-label 20.0%, incumbent 11.0%, challenger 8.9%. Sampled = argmax on 69% of takes; mean decision confidence 0.60. Re-running is fully cached ($0, 3.6 s).
- **Jev AI-agent arm** (`agent_shopper.py --runs 20`): 80 shuffled feeds of 24–36 items, $0.027, 5.4 s. No first-position bias: 2.5% of picks at position 1 vs 3.5% expected (CI [0.7, 8.7]%); mean P(position 1) 0.039 vs uniform 0.035.
- Jev optimiser smoke test (`optimise.py --product 5060088709047 --agents 12`): works; arms re-use the cache when the state is unchanged.
- Server persona builder: GET/POST `/api/personas` and a persona-filtered Jev `POST /api/run` (3 agents, $0.005).
- Earlier OpenRouter LLM test: about $0.006 per shopper with Gemini 2.5 Flash (2.1k prompt + 95 completion tokens per call).

## Caveats (say these out loud)

- Fixtures (`sim/fixtures/`) are placeholders marked `fixture: true`. They are used only until `data/store/*.json` and `data/products/catalog.json` exist.
- Several magnitudes are labelled assumptions in `coefficients.json`: the off-mission penalty, the seconds-at-shelf slope, browse probability and OCEAN jitter.
- Choice-stage OCEAN effects (as opposed to notice-stage ones) reach the decision engine only as behaviour phrases in the shopper state (Jev) or the persona prompt (LLM), not as numbers.
- Jev thresholds are labelled choices, not calibrated to real shoppers: a Noul "fires" at p > 0.5; P(appeal ≤ dislikes) > 0.5 is quoted in put-back reasons. Items taken per shopper (300-agent run): 3.5 meal-deal office, 2.9 gym, 4.5 GLP-1, up to 12.4 for weekly-shop personas. Every on-mission slot gets its own decision and there is no per-trip basket cap (adding one would be a further assumption).
- Turning a sales lift into a noticing lift assumes the whole shelf effect runs through attention (Chandon 2009).

## Personal routes: re-layout insurance (`visits.py`, `routes.py`)

Spec: `docs/ideas/personal-route-spec.md`. Results: `data/sim/visits/RESULTS.md`. Engine: Jev, or mock for a $0 dry run. No OpenRouter.

- **`routes.py`** (code only) holds the aisle graph, the route and the card:
  - Unit categories come from the current planogram's slots.
  - `route()` reuses `layout_optimise.walk_metres`. That function is order-independent, so the 4-case search only fixes the stop order.
  - `moved()` compares the shopper's remembered `cat_unit` against the plan.
  - `card()` lists moved habit items and at most one new SKU already on the route. The SKU must pass the declared gates, be non-HFSS (conservative) and have lens score > 0. It is ranked by Σ posterior × surrogate P(pick up)·P(take). The card abstains when max posterior < τ. Every line is traced; `funded: false`; no price.
- **`visits.py`** runs the multi-visit loop. v1–v2 use the as-built layout minus 8 withheld challengers. v3–v4 use `planogram_retailer.json` with the challengers listed. Both potential outcomes (control and card) are simulated for v3–v4. Compliance `hu(seed, agent, "comply", 3) < c × reactance_k` is applied afterwards, so the c sweep is free.
  - Spec section 2 engine changes are a **visit-aware port** (`simulate_agent_v`), not edits to `run.py`: visit salt in every draw key, planogram unit categories, route override, carded-SKU logit, and a memory line injected as a third Jev `habits` entry.
  - With `visit=None` the port reproduces `run_20261003_120823_s11_jev_4482` exactly: 300 agents, events identical, all from cache.
- **Evaluation:**
  - paired A/B with bootstrap CIs (B = 2000);
  - Naive Bayes persona identifiability with a mission-only baseline, leave-one-out, undeclared-sensitive safety count, and the 12-way vs restricted cost;
  - next-basket P@k/R@k against random, popularity, repeat-last, most-frequent and oracle.

```bash
python3 sim/visits.py run --engine mock --agents-per-persona 1 --seeds 21
python3 sim/visits.py run --agents-per-persona 4 --seeds 21,22,23 --p-search-moved 0.5 --route-card-logit 0 --jev-max-usd 5
python3 sim/visits.py eval --run <run_id> [--sensitivity <sweep ids>]
python3 sim/visits.py report --run <run_id> [--preface notes.md]      # writes data/sim/visits/RESULTS.md
python3 sim/visits.py card --run visits_20261003_123624_jev_s21-22_main --agent s21:a004 --visit 3   # habit_loyalist (demo card)
python3 sim/visits.py recard --run <run_id>   # rebuild card text/evidence from stored inputs, $0; refuses if anything simulated would change
python3 sim/routes.py --planogram data/sim/layout/planogram_retailer.json --units U2,U5,U7
```

Tested 2026-10-03:
- **Main Jev run:** 96 shoppers (seeds 21–22), 576 agent-visits, $1.24, 0 errors. Seed 23 was lost to a TypeSafe 402 (out of credits) and is excluded.
- **Primary result:** at c = 0.2, v3 basket completion moves +0.002 [0.000, +0.004], which is not a claimable lift. This is a single compliance draw in which 1 of 21 compliers was helped. Averaged over the draw it is +0.005 [+0.003, +0.008]: tiny, and assumption-driven either way. Visit 4 all-follow +0.007 [−0.001, +0.016] does not persist. See the verifier addendum in RESULTS.md.
- **Baseline note:** `most_frequent` and `repeat_last` in `eval_next_basket` break ties with the persona posterior, so they are not the plain baselines the spec describes.
- **Where the lift comes from:** the whole v3 lift comes from routing (0 judgment differences on shared slots).
- **Not run (no credits):** the sweep, mixtures, OCEAN jitter, the detour variant, the `server.py` endpoint and the UI panel.

## store ops (`ops.py`)

Discrete-event simulation of whole trading days in the XL store (`data/store/store_xl.config.json` + `planogram_xl.json` + `catalog_xl.json`; falls back to the small store with labelled synthetic geometry). Spec: `docs/ideas/store-ops.md`. It uses a heapq event loop because simpy is not installed. Every parameter comes from `data/ops/params.json` (research, sourced) or `data/sim/ops/params_extra.json` (the extra knobs ops needs, almost all labelled `assumption: <why>`). Every day file carries `params_used` with each value, unit, source and confidence, and each KPI block lists the params and event counts behind it.

```bash
python3 sim/ops.py --day Sat --compress 1 --staff restock=6,clean=2,guard=1 --routing smart --seed 1   # one day -> data/sim/ops/day_<id>.json
python3 sim/ops.py --routing jsq --restock fifo --seed 1                                              # baselines
python3 sim/ops.py --compare --seeds 1,2,3 --days 3 --sweep-restock 4,6,8                             # arms A-G (CRN) -> RESULTS.json + RESULTS.auto.md
python3 sim/ops.py --set shelf_capacity_multiplier=1 ...                                              # sensitivity on any param
python3 sim/ops.py --no-jev ...                                                                        # $0: labelled fallback acceptance table
```

**Arrivals.** Each minute draws a Poisson count with rate = `store_customers_per_week` × `shopping_trips_by_day_share[dow]` × NTS hour share at (t − 15 min lag) / 60. A Saturday comes to about 2,280 shoppers. The mission is drawn from `mission_mix_by_daypart`: lunch is meal deals, 15–17 (after school) is 2× treats/desserts, and the evening is top-ups. The persona is then sampled from the lens personas (plus custom ones) that have that mission.

**Basket (fast surrogate, no model calls).**
- **Route:** the mission's units plus browsed units (p = 0.25), visited nearest-neighbour from whichever of the two entrances gives the shorter walk.
- **Taking an item:** each product on a visited row is noticed with `notice.p_notice` (rows 3–4 map to "bottom", see the store config's `notice_row_map`). A noticed product is taken with P(take | noticed) per (archetype, product). That probability comes from the Jev run logs (`data/sim/runs/run_*jev*.json`, 12,234 noticed events, 1,115 pairs), shrunk toward the archetype mean with m = 5, and Wilson CIs are kept.
- **Products the runs never showed** (all `auto_xl` products and the 4 new curated categories): a lens-grade logit fitted on the seen pairs, labelled `lens_logit`, β ≈ 1.97 on 778 pairs.
- **Basket size:** taking stops at round(NB(mission mean) × `in_range_share_of_basket`). The rest of the mission basket is off-range items (fresh, household and so on) that are scanned but don't touch our shelves.
- **Common random numbers:** every draw is hashed on (seed, shopper, purpose), so all policies see the same shoppers wanting the same things.

**Time in store.** Walking uses the aisle graph: walkways between gondolas plus the front and back cross-aisles at 1.3 m/s. Dwell is rows × the persona's `seconds_at_shelf`.

**Stock and out-of-stocks.**
- **Out of stock:** when a wanted SKU has an empty shelf, a Gruen 2002 reaction is drawn (store switch / other brand / same brand / delay / don't buy). A substitute is the in-stock product in the same category with the highest surrogate score. Lost £ is counted net of what the substitute recovers.
- **Cause:** each OOS records whether the back room had stock (a shelf-restocking failure) or not (an ordering failure), to compare with Gruen & Corsten's root causes.
- **Staff queries:** 10% of OOS-hit shoppers ask staff, which costs a restocker 6 min.
- **Restockers** (N agents, `fifo` | `priority` | `priority_bay`) walk to the stockroom door and then the bay. Cases are worked at 45 cases/h, and other SKUs in the bay under 50% full come along.
  - `priority_bay` scores each bay by Σ E[(D − s)+] × price × margin proxy ÷ the trip's labour seconds, where D ~ Poisson(forecast rate × time until the next round).
  - `priority` is the spec-literal per-SKU P(OOS before next round) × demand × margin.
- **Night fill** at 07:00 refills shelves from the back room, an assumption.

**Manager.** Reviews hourly. ROP = L·E(D) + z·√(L·σ_D² + E(D)²σ_L²) with σ_D² = E(D) (Poisson) and z = 1.65. Lead time is 1 day for chilled and 2 for ambient, with SD 0.25 d, and deliveries land at 06:00. When inventory position ≤ ROP, the manager orders up to ROP + one review period of demand. E(D) is the manager's "history": a Monte Carlo of the same shopper model (200 shoppers per mission, seed namespace `forecast`) × the arrival curve. The manager also raises `going_out_alert` when shelf + back room is less than the rest of today's forecast.

**Spills and cleaners.** Each unit visit has P(spill) = 2/1,000 ÷ the number of route units, ×5 if the shopper just bumped someone. P(bump) = 1 − exp(−0.04 × others in the same walkway). The dropped item is waste. The nearest free cleaner walks over and mops for 3 min, and the walkway is blocked until then. Shoppers detour (+12.8 m) and retry the bay once, otherwise they skip it.

**Checkout.**
- **Service time** follows `service_time_formula` (Klee 2006 staffed; WPI 2004 self-checkout, including 34% interventions held by a bank attendant, one per 5 terminals) × lognormal noise (CV 0.3).
- **Routing:**
  - `smart`: a router picks the lane with the lowest walk + predicted work ahead + own predicted service. The work ahead counts shoppers it has already sent and who are still walking.
  - `smart_wait` ignores own service time.
  - `smart_blind` does not count inbound shoppers (ablation).
  - Baselines: `jsq` (fewest people visible, nearest on ties) and `nearest`.
- **Abandonment:** a shopper leaves the queue after gamma-distributed patience (mean by mission, shape 3). The abandoned trolley goes back to the back room.
- **Self-checkout acceptance is the one Jev judgment:** a Noul, "Would `shopper` choose the self-checkout for `basket` if both had the same wait?". It is asked once per (persona, mission, basket-size bucket, needs weighing, age-restricted), cached, and capped by `--jev-max-calls`. The fallback table `sco_accept_fallback` is labelled and used only when Jev is off or fails; a 402 halts further calls.

**Café, security and checkout theatre.**
- **Café:** 24 seats (capacity resource). The visit share depends on daypart, with dwell ~20 min. A shopper waits ≤3 min for a seat or is turned away. The menu is real OFF products with labelled prices.
- **Theft:** 0.4% of trips (assumption, BRC/ONS not fetched), either walking out unscanned or skip-scanning at self-checkout. EAS gates fire an `alarm` event (gate, x, z, t) with an assumed tag share and detection rate. A guard runs over; stock is recovered if the guard arrives within 25 s. KPIs: shrink £, incidents per hour, detection rate, guard utilisation.
- **Checkout theatre:** each paid shopper carries `theatre {unload, scans[t...], skipped[], bag, pay, done}`. Scan i is item i of `basket`, then the off-range items.

**Output: `data/sim/ops/day_<id>.json`.**
- `kpis`: traffic, checkout, stock, manager, spills, café, security and revenue, each with `trace` and `params`.
- `timeline.frames`: one per minute (or per `--compress` minutes). Each frame has shoppers per aisle segment, people per lane, fill per slot, empty SKUs, staff x/z and task, active spills, café occupancy, orders and back-room units.
- `events`: oos, spill, spill_cleared, restocked, orders, going_out_alert, abandon, alarm, café.
- `orders` (with ROP/IP/SS), `spills`, `shoppers` (waypoints `[t, x, z, unit|lane|cafe|exit]`, basket, OOS records, lane, wait, theatre).
- `geometry` (unit/lane/entrance/door positions), `surrogate` summary, `jev` (question, table, calls, cost) and `params_used`.

A Saturday file is about 5–6 MB and takes about 5–7 s to run.

**Results.** See `data/sim/ops/RESULTS.md`.

# spec: re-layout insurance (the personal route, after pressure testing)

*3 Oct 2026. Status: **build-with-changes**, scoped to the 17:30 deadline. Source idea: [personal-route.md](personal-route.md). Engine: TypeSafe Jev only. No OpenRouter or LLM calls anywhere in this spec.*

## 0. Decision

**Build with changes. It is not a fourth surface.** Six hostile reviews (RGC judges, behavioural science, ML evaluation, UK GDPR, build engineering, retail P&L) all returned build-with-changes. They agreed on five fatal flaws, and this spec fixes each one or accepts it with a stated reason (section 11):

1. As a consumer app it is not original: "the Tesco app with a map".
2. Persona-ID accuracy measured against sim ground truth is circular.
3. Inferring GLP-1, coeliac or vegan from a basket breaks our own privacy doc (UK GDPR Art. 9).
4. The sim has no memory between visits, and every draw replays across visits, so any "habit" result would be fake.
5. The route-card lift would simply equal our own visit-probability assumption.

**What we build** is one pre-computed experiment that answers a retailer question EPOS can't:

> *"If I re-lay out the store and list new challengers, what does it cost the shoppers who know the route, and how much of that does an opt-in route card win back, without making me lose impulse spend?"*

It lives inside the **retailer layout surface**, as a "habit cost" panel next to the optimiser's before→after diff. The card's single new-item slot comes from the **shopper swaps** engine. The story stays "same shelf, two shoppers, traceable", now with a time axis.

**Pitch line:** *"A re-layout is the one moment a habit is loose (habit discontinuity: Verplanken & Wood 2006). We time a challenger's first trial to that window, and the regular shopper doesn't have to hunt for their oat milk."*

**Non-goals (cut):**
- a live personalisation system;
- real-person onboarding;
- 3D route animation;
- new-category products;
- more than one layout change;
- Jev-based persona ID on the critical path;
- Bayesian OCEAN updating;
- any personalised price.

## 1. Privacy-safe design (deployment architecture; the sim imitates its data flow)

| rule | what it means | why |
|---|---|---|
| **The shopper brings their own identity** | A card exists only when the shopper scans their own app or loyalty QR at entry, or uses scan-and-go. No scan means no card. Never face/CV, gait, BLE/Wi-Fi MAC or payment-card re-identification. | Keeps `docs/data-collection.md:71` true ("no cross-visit tracking"): the store never tracks, the shopper carries their own history. |
| **On-device habit log** | The habit log and persona posterior live in the shopper's app. The server sends public inputs only: layout map, new-SKU list with OFF facts, and cached archetype-to-P(take) tables. The card is assembled locally. | Data minimisation (Art. 5(1)(c)). |
| **Retailer and brand see aggregates only** | Counts of "card shown, then usual item found, then new item looked at / picked up / taken", with k ≥ 10 per cell. | Matches `data-collection.md:75`. |
| **Special categories are declared, never inferred** | `glp1_small_appetite`, `allergen_coeliac` and `vegan_ethical` are **out of the inference set**. They switch on only through a separate explicit-consent toggle. `upf_avoider_parent` may be inferred only as the lens "family shop"; nothing is inferred about the children. | Art. 9; ICO inference guidance; CJEU C-184/20; `data-collection.md:59,70`. |
| **Show the lens, not the label** | The card says "your picks: high fibre, small portions", never "you look like a GLP-1 user". A "not me" control corrects the posterior. | Reddit failures #9 (covert profiling, ~85 comments) and #10 ("Cheat day?" moralising). |
| **Opt-in, capped, dismissable** | At most **1** new item, always on the existing route. "Skip" is one tap. Every line carries its reason. The framing is an offer, never a "task". | Truth 8 reactance (`research/03:57`); White et al. 2008; Aguirre et al. 2015. |
| **No personalised prices, ever** | The card never carries a price that differs from the shelf price. | Reddit failure #2 ("$3.49 if I used the app … buy none"); keeps Art. 22 risk low. |
| **Payment buys eligibility, not rank** | A brand may pay only to put a SKU in the "new" candidate pool. Rank is computed in code (section 4.3). A funded slot is labelled "new, brand-funded trial". | Rule zero; `research/03:90` sponsored-crowding reactance. |
| **Children and HFSS** | Personalisation is off by default for under-18 accounts (ICO Children's Code std 7, 12, 13). The new-item slot never offers an HFSS product (reuses `layout_optimise.hfss`). | UK HFSS placement rules. |
| **Retention** | Habit log: last 8 visits or 90 days, whichever is shorter. The posterior is recomputed each visit and never stored as a label. "Forget me" wipes device and server immediately. | Art. 5(1)(e). |
| **AI agents** | An agent's buy-again history is its principal's personal data. The same rules apply, and it is never used to profile the human without consent. | Same lawful basis. |
| **DPIA** | Required (profiling + combining datasets). Key risks: special-category inference, cross-visit linkage, children. Mitigations are this table. Any store-entry push or beacon trigger is PECR opt-in. | ICO list of processing that requires a DPIA. |

**In the sim:** the classifier sees **basket contents only**: taken SKUs and basket size. It never sees units visited or the route, because a real deployment would not have them without tracking. Sensitive personas are simulated in two conditions: *declared* (the lens is given and nothing is inferred) and *undeclared* (the classifier must abstain or answer "none").

**Doc fixes to land before judges read the repo:**
- (a) Add one sentence and two retention rows to `docs/data-collection.md`: "the store never tracks across visits; an opted-in shopper's app carries their own history", plus a row for the habit log and a row for the posterior.
- (b) `integrations/ecom-rerank` infers `glp1_small_appetite p=0.68` from session signals (`integrations/ecom-rerank/README.md:44`). Gate it to non-sensitive lenses, or list it explicitly as a known gap.
- (c) `README.md:70` still says "Several models via OpenRouter" and `README.md:189` says "the Claude API for real agent shoppers". Change both to Jev.

## 2. Engine changes in `sim/run.py` (small, backwards compatible)

1. **Visit salt (fixes the replay bug).**
   - What goes wrong today: every draw is `hu(seed, aid, ...)`, so visit 2 replays visit 1 exactly.
   - Fix: in `simulate_agent`, set `dk = aid if ctx.get("visit") is None else f"{aid}#v{ctx['visit']}"`. Use `dk` in **every** `hu()` key: labels, browse, notice, jev_decide, pickup, and the mock `rng_key`.
   - Old runs stay byte-reproducible when `visit` is None.
   - Do **not** change `--seed` per visit: `spawn_agents` seeds persona order from the seed (`run.py:152`), so agent a001 would become a different persona.
   - Spawn once and reuse the agent specs for every visit.
   - Jev disk-cache hits on identical *state* stay legitimate: same state, same judgment. Draws now differ by visit.
2. **Unit category from the planogram (bug fix the layout surface also needs).** `on_mission` currently reads `store.config` `unit['category']`. The retailer planogram moves 72 of 96 products to a different unit. Fix: a unit's categories are the set of its slots' `category` fields in the *current* planogram, falling back to `store.config` only when a slot has none.
3. **Route override.** If `ctx["route_units"]` is set, a unit is visited when it is in `route_units` or passes the existing browse draw (`browse_prob` = 0.25, already a labelled assumption). Otherwise behaviour is unchanged.
4. **Carded-SKU notice term.** `ctx["extra_logit"] = {code: x}` adds `x` to that product's notice logit. It is recorded in `notice_factors.logit_terms.route_card` with its source. **Headline default x = 0**, swept as {0, 0.5, 1.0} and labelled `route_card_logit` in `coefficients.json`.
5. **Memory in the Jev state (labelled injection).** On visits ≥ 2, `ctx["memory_line"]` is added as a third `habits` entry in the shopper state, for example `"usually buys: Oatly Barista (2/2 visits), Yeo Valley 0% (2/2)"`. It is built from counts in code and recorded as `memory_injected_by: "sim/visits.py"`. Turn it off with `--no-memory-state`.

Draw keys **never include the arm**. Control and card arms share every draw, which gives common random numbers and a paired design.

## 3. `sim/routes.py`: aisle graph and route, all in code

**Graph from `data/store/store.config.json`:**
- 4 aisles, 8 units (`U1..U8`, sides L/R), entrance (0, −2), checkout (0, 22).
- Nodes: entrance, checkout, and walkways `w ∈ {0..aisles}`. A unit faces `walkway_of(u)`: L → aisle−1, R → aisle. This reuses `layout_optimise.walkway_of`, `walkway_x`, `GEOM` and `walk_metres`, so the route uses the same geometry as the 3D scene (`web/src/layout.ts`).

**Functions:**
- `required_units(memory, plan, mission_cats, new_item)`: the units that **currently** hold each mission category (majority slot category), plus the new item's unit only if it is already on the route (detour variant: section 6).
- `route(store, units) -> {stops, walkways, metres, seconds}`:
  - Exact search over the walkways needed: at most 5, so 2 sweep directions × entry ends, ≤ 64 cases.
  - The cost is `walk_metres`; seconds = metres / `walk_speed_mps` 1.3 (assumption already in `layout_optimise.PARAMS`).
  - Stops are ordered along the sweep, and units within a walkway by z.
  - The route **covers** the needs; it does not minimise against impulse. Metres are *reported*, not optimised (Hui et al. 2013: section 6).
- `moved(memory, plan) -> [{category, from_unit, to_unit, from_slot, to_slot}]`: from the layout diff (`layout_optimise.positions` and `build_diff`).
- `card(agent_view, plan, posterior, new_skus) -> card`: section 4.3.

## 4. `sim/visits.py`: the multi-visit loop

### 4.1 Memory (counts, never prose)

```
memory[agent] = {
  "cat_unit": {category: unit_id last walked for it},      # the remembered route
  "bought":   {code: [visit numbers taken]},                # habit log
  "baskets":  [[codes] per visit],
  "posterior":[{lens: p} per visit]                         # recomputed, not stored as a label
}
```

### 4.2 Arms (paired, same agents, same draws)

| visit | layout | new SKUs | control | card |
|---|---|---|---|---|
| 1 | as built (`data/store/planogram.json` minus new SKUs) | withheld | route = units holding mission categories. Assumption: the shopper already knows the as-built store. | same run as control (shared) |
| 2 | as built | withheld | route = `memory.cat_unit` (same units) | shared |
| 3 | **re-layout**: `data/sim/layout/planogram_retailer.json` (the layout surface's own revenue plan) | **listed** | route = `memory.cat_unit`, which is now stale. A moved category's new unit is found by search with p = `p_search_moved` (default **0.5**, swept {0.25, 0.5, 0.75}). Otherwise only the browse draw applies. Memory updates to wherever the category was found. | **compliers**: route = `routes.required_units` (correct units), and ≤ 1 carded new SKU with `extra_logit`. **Non-compliers** are identical to control. |
| 4 | retailer layout | listed | stale memory partly repaired at visit 3, same rule | same rule; card again |

**New SKUs.** For each of the 8 categories, withhold one existing `role: "challenger"` SKU. The default rule is deterministic: the challenger with the fewest facings in `planogram_retailer.json`, with the lowest barcode breaking ties. The catalogue has 4–7 challengers per category, so this is always possible. The SKUs are listed in `data/sim/visits/<id>.json → design.new_skus` with their rule.

**Compliance costs nothing to sweep.** For each agent at visits 3–4 we simulate **both potential outcomes**: following the card, and ignoring it (= control). Compliance is applied afterwards by a seeded draw, `hu(seed, aid, "comply", visit) < c × reactance_k`, so sweeping c ∈ {0.2, 0.5, 0.8} needs no new Jev calls.
- `c` is labelled an assumption: there is no grounded card-follow rate.
- `reactance_k` is per persona, also labelled: 1.0 by default; 0.25 for `protein_sceptic_gimmick_reactant`, `habit_loyalist_shrinkflation_angry` and `frugal_unit_price`.
- Sources for `reactance_k`: Brehm 1966; White et al. 2008; `research/03:57`.
- **The headline is taken at c = 0.2, the conservative end.**

### 4.3 The route card (built in code; Jev only for P(take))

1. **"Your usual items moved"**: one line per moved mission category the shopper bought in visits 1–2, ordered by `bought` count.
2. **At most one "new on your way"**:
   - *Candidates:* new SKUs on a unit already on the card route (no detour). Each must pass `swaps.gate_fail` for the shopper's *declared* gates, be non-HFSS (`layout_optimise.hfss`), and have `lens_score > 0`. The lens comes only from the non-sensitive posterior or a declared lens.
   - *Rank:* `Σ_k posterior(k) · P_take(k, sku)`. `P_take` comes from the existing Jev surrogate (`data/sim/layout/surrogate.json`, already cached, so no new calls).
   - *Abstain:* if `max posterior < τ = 0.5` (labelled assumption) and no lens is declared, the card shows **no** new item. Habit lines only.
3. **Labels:** `funded: false` always in the sim; `dismissable: true`; no price field.

### 4.4 Trace fields (every card line; rule zero)

```json
{
  "kind": "moved" | "new",
  "code": "5000...", "name": "...", "category": "...",
  "from": {"unit": "U5", "slot": "U5-r2"}, "to": {"unit": "U2", "slot": "U2-r1"},
  "reason": "habit: taken 2/2 visits; moved U5-r2 → U2-r1 in the retailer layout",
  "evidence": {
    "habit": {"taken_visits": [1, 2], "of": 2},
    "layout_diff": {"source": "data/sim/layout/planogram_retailer.json", "diff_ref": "report_retailer.json#moves[17]"},
    "lens": {"lens": "high_fibre", "from": "posterior" | "declared", "posterior_p": 0.71,
             "off_field": "fiber_100g", "off_value": 8.1, "off_url": "https://world.openfoodfacts.org/product/..."},
    "p_take": {"value": 0.41, "source": "data/sim/layout/surrogate.json", "jev_cache_key": "…", "persona_mix": {"eco_low_chemical": 0.71, "...": 0.29}},
    "gates_passed": ["declared gates", "non-HFSS (layout_optimise.hfss)"],
    "route": {"walkways": [1, 3], "metres": 61.4, "detour_metres": 0.0}
  },
  "funded": false, "dismissable": true,
  "assumptions": ["route_card_logit=0 (coefficients.json)", "compliance c=0.2 × reactance_k"]
}
```

The persona posterior is always shown as a full distribution. Health and belief lenses are shown greyed out as "declared only".

## 5. Evaluation (anti-circularity built in)

**Framing rule.** Every number reads "in simulation, N synthetic shoppers per archetype, under assumption X". Never "we identify shoppers with Y% accuracy".

### 5.1 Persona identifiability (renamed from "accuracy"; it is an upper bound, not validation)

**Model: Naive Bayes in code, about 40 lines, no Jev.**
- Multinomial over taken SKUs plus a basket-size bucket.
- Laplace-smoothed P(sku | lens), trained on the held-out run `data/sim/runs/run_20261003_120823_s11_jev_4482.json` (seed 11).
- Evaluated on fresh seed blocks (21, 22, 23) and new agents.
- Inference set: **9 non-sensitive lenses + `none`**. Output `none` when max P < τ.
- Optional side-by-side: a Jev Choice using short independent labels that are not the dossier text. Keep it only if it beats Naive Bayes; it is not on the critical path.

**Report** by cumulative visits 1, 2, 3, 4:
- top-1, top-3, log-loss, Brier, ECE;
- a reliability diagram (10 bins);
- Wilson 95% CIs;
- the full 10×10 confusion matrix.

**Mandatory reference lines:**
- chance (1/9 for inferable lenses);
- a **mission-only baseline** (categories present + basket-size bucket). Claim only the lift over this baseline;
- accuracy **within `weekly_shop`** separately.

**Stress tests:**
- (a) **Mixed households**: 24 extra agents, each visit drawn as persona A with p = 0.6, else persona B (both non-sensitive). The honest output is a spread posterior.
- (b) **Leave-one-archetype-out**: retrain without lens k and test on k's agents. Success = `none` or low confidence.
- (c) **OCEAN jitter** sd 0.08 vs 0.25 (seed block 21 only).
- (d) **Undeclared sensitive shoppers** (glp1, coeliac, vegan agents): abstain rate, the share confidently labelled with a wrong lens, and **cards that offered an item failing the shopper's true hard gate**, a safety count that must be 0, or reported if it is not.
- (e) **Cost of refusing health inference**: an unrestricted 12-way model is fitted *offline on synthetic agents only* and never used for cards. Report the accuracy and P@5 lost, with a CI. Pitch line: "never guessing your diagnosis costs X points".

**Expected failures, stated up front:**
- the reviewer's single-basket Naive Bayes reached 83% top-1 on pure archetypes, which is circular and therefore never a headline;
- glp1 ↔ upf_avoider, and frugal ↔ protein_sceptic ↔ habit_loyalist, will be confused;
- mission-unique personas (meal_deal, treat, gym) leak through basket size.

### 5.2 Next-basket prediction (must beat baselines)

Predict the visit v+1 basket from visits 1..v. Report P@k and R@k for k ∈ {3, 5, 10}, with bootstrap CIs over shoppers (B = 2000), **split into repeat items and explore items**, overall and for visit 4 (after the re-layout).

| method | definition |
|---|---|
| random | uniform over SKUs on the shopper's mission units |
| global popularity | take counts in run s11 |
| **repeat-last** | the previous basket, filled with persona-posterior popularity |
| **most-frequent** | personal top-frequency over the visits so far (Li et al. 2023: the baseline that is hard to beat) |
| posterior popularity | `Σ_k P(k \| baskets) · P(sku \| k)` |
| **ours** | `λ · personal frequency + (1−λ) · posterior popularity`. λ = 0.5 is labelled; λ ∈ {0.25, 0.5, 0.75} is shown. |
| oracle (ceiling) | popularity for the true persona |

Reviewer reference numbers from one visit of run s11, to be **recomputed and not quoted until then**: random 0.091, global 0.248, repeat-last 0.365, oracle 0.399 (P@5).
- **The claim rule:** we only claim "ours" if its CI is above most-frequent and repeat-last.
- Stated limitation: the sim's repeat behaviour comes only from the injected memory line plus Jev's habit judgment. Without memory the ceiling is the oracle.

### 5.3 Route-card A/B (paired)

**Design:**
- 12 personas × 4 agents × 3 seed blocks = **144 agents**, 4 visits.
- Visits 1–2 are shared. Visits 3–4 run both potential outcomes.
- Analysis is paired within shopper. CIs are **paired bootstrap over shoppers** (B = 2000), not Newcomb independent-arms intervals. Proportions per arm carry Wilson CIs.

**Pre-registered primary metric** (written here before the run): **basket completion at visit 3**. Definition: the share of a shopper's habit items (taken in ≥ 1 of visits 1–2) that are taken again at visit 3. It is reported as card − control at c = 0.2, `route_card_logit` = 0, `p_search_moved` = 0.5.
- Reason for choosing it: it is the value claim the evidence supports (Truth 2: "baskets shrink during the disruption").

**Secondary metrics** (all labelled secondary):
- habit-category found rate at visits 3 and 4 (control's v4 recovery shows memory repair);
- new-SKU look → pick up → take at visits 3 and 4, per arm;
- **trial-to-repeat**: taken at v3 *and* v4, card − control. This is the metric a supplier pays for, as cost per incremental repeater. It counters the 76% year-one NPD failure figure (Nielsen via Marketing Week; `research/02:66,423`), which must not be mixed with POPAI's 76% in-store decisions or NIQ's 76% claimed repeat.

**Revenue guardrails, reported side by side:**
- total basket £ and items;
- **unplanned £** (taken from units visited by browse or search, not on the planned route);
- metres walked (`routes.route` over the walkways actually visited);
- take-rate of non-carded SKUs (cannibalisation).

We report the *sign* the sim gives. **We do not claim baskets grow.** Hui et al. (2013, J. Marketing) show that shorter paths can cut unplanned spend, so the retailer sees the trade-off.

**Variant `--detour 1`:** the new item may sit on one off-route unit. This reports how much the honest detour adds in unplanned £ and how much it costs in metres.

**Sensitivity:**
- c ∈ {0.2, 0.5, 0.8} (free, post-processed);
- `p_search_moved` ∈ {0.25, 0.75} and `route_card_logit` ∈ {0.5, 1.0}, on seed block 21 only.

**Decomposition shown openly:** we display how much of the lift comes from *routing* (`p_search_moved` vs 1.0, an assumption) and how much from Jev's take judgments. Example wording: "IF a shopper finds a moved category with p = 0.5, THEN …".

**Sanity assertions:**
- visit-1 and visit-2 baskets for the same agent differ; report mean Jaccard;
- control ≡ card for non-compliers, byte for byte;
- `visit=None` reproduces run s11's events exactly.

### 5.4 AI-agent arm (stretch, P3: cut first)

The agent's memory is a buy-again list. `agent_shopper.py` gains a state line, "usual order: …", and the feed now contains the new SKUs. We measure the new-SKU pick share at visits 3–4 with and without a "new on your list" line, against the human card arm.

Hypothesis to test, not assert: *"for the robot, memory is the incumbent's moat"* (`research/03:127`, "buy-again … never shows unknowns").

## 6. CLI

```bash
python3 sim/visits.py run --engine mock --agents-per-persona 1 --seeds 21          # $0 dry run, asserts in 5.3
python3 sim/visits.py run --agents-per-persona 4 --seeds 21,22,23 --visits 4 \
    --relayout-at 3 --relayout data/sim/layout/planogram_retailer.json \
    --new-skus auto --p-search-moved 0.5 --route-card-logit 0 [--detour 0] [--no-memory-state] [--jev-max-usd 5]
python3 sim/visits.py sweep --base <run_id> --seeds 21 --p-search-moved 0.25,0.75 --route-card-logit 0.5,1.0
python3 sim/visits.py eval  --run <run_id> --train-run run_20261003_120823_s11_jev_4482 --compliance 0.2,0.5,0.8 --tau 0.5
python3 sim/visits.py card  --run <run_id> --agent a007 --visit 3      # prints one traced route card (demo)
python3 sim/routes.py --planogram data/sim/layout/planogram_retailer.json --units U2,U5,U7   # route + metres
```

**Cost and time.** Measured ≈ $0.003 and ≈ 74k input tokens per agent-visit (`run_20261003_120714_s1`). The token bucket allows 90k tok/s.

| part | agent-visits | cost | wall time |
|---|---|---|---|
| main run: 288 (v1–2) + 288 control + 288 card | 864 | ≈ $2.60 | ≈ 12 min |
| sweep | ≈ 384 | ≈ $1.15 | — |
| mixtures + jitter | ≈ 190 | ≈ $0.60 | — |

Each invocation stays under the $5 `DEFAULT_MAX_USD` guard. Cache hits lower all of these.

## 7. Outputs (`data/sim/visits/`)

- `<run_id>.json`. Top-level keys:
  - `design`: arms, visits, new_skus + rule, relayout source, seeds, every assumption with `value` and `source`, and the pre-registered primary;
  - `agents`: per agent, visits[] with `run.simulate_agent` events (CONTRACT shape plus `visit`, `arm`, `potential_outcome`), basket, memory snapshot, posterior, card;
  - `cost`.
- `<run_id>.eval.json`:
  - `persona_id`: by visit; confusion; calibration bins; baselines; stress tests (a)–(e);
  - `next_basket`: methods × k × {all, repeat, explore} with CIs;
  - `ab`: primary, secondary and guardrails, per compliance level, with paired CIs; plus sensitivity and decomposition;
  - `assertions`: pass/fail.
- `<run_id>.cards.json`: every card issued, with full trace fields (section 4.4).
- `sim/server.py`: `GET /visits/latest` returns the eval and a sample card, for the layout surface's "habit cost" panel.

## 8. Demo (about 30 seconds, inside the retailer layout surface)

1. **One chart.** Basket completion at v1–v4, control vs card, with CIs. It shows the v3 dip and the recovery. Beside it: new-SKU take and trial-to-repeat, and the unplanned-£ guardrail. A compliance slider (0.2 / 0.5 / 0.8) and a "share of lift from routing assumption" bar sit underneath.
2. **One card.** Margaret (`habit_loyalist_shrinkflation_angry`) at visit 3:
   - "Your usual items moved: …";
   - one new item with its reason trail (habit count, layout-diff ref, OFF field, surrogate P(take) cache key), `funded: false`, and a skip option;
   - her posterior as a distribution, with health lenses greyed "declared only".
3. **One "where it breaks" line.** Mixtures and leave-one-out get `none`, glp1 ↔ upf_avoider are confused, and what the sim can't know: real card-follow and repeat rates. A live pilot measures those against a holdout (incremental repeaters).

## 9. Build order (about 2 h; each step is shippable)

| step | priority | work | time |
|---|---|---|---|
| 1 | P0 | `run.py` changes 2.1–2.4, with the `visit=None` reproducibility assertion | 25 min |
| 2 | P0 | `routes.py`: route, moved, card with trace | 30 min |
| 3 | P0 | `visits.py run`: memory, arms, potential outcomes. Mock dry run, then the Jev main run in the background. | 35 min |
| 4 | P0 | `visits.py eval`: A/B primary and guardrails, paired bootstrap | 20 min |
| 5 | P1 | persona ID Naive Bayes, baselines, confusion and calibration; next-basket table | 25 min |
| 6 | P1 | doc fixes (section 1) | 10 min |
| 7 | P2 | stress tests, sweep, memory injection 2.5, server endpoint, UI panel | — |
| 8 | P3 | AI-agent arm | — |

## 10. Assumptions register (each goes into `coefficients.json` or `design.assumptions` with a source)

| name | value | sweep | source / reason |
|---|---|---|---|
| `p_search_moved` | 0.5 | 0.25, 0.75 | assumption; direction from Truth 2, "can't be bothered to look" (r/britishproblems 1uosc29, 507 pts) |
| `compliance c` | 0.2 headline | 0.5, 0.8 | assumption; there is no grounded card-follow rate |
| `reactance_k` | 1.0 / 0.25 | — | assumption; Brehm 1966; White et al. 2008; `research/03:57` |
| `route_card_logit` | 0 | 0.5, 1.0 | assumption; nothing in `notice.py` models "told to look" |
| `tau` (abstain) | 0.5 | 0.4, 0.6 | assumption |
| `lambda` (next basket) | 0.5 | 0.25, 0.75 | assumption |
| visit-1 route = mission units | — | — | assumption: shoppers know the as-built store (`research/03` Truth 2, memorised route) |
| habit formation | — | — | **not modelled** beyond the injected memory line. Lally et al. 2010 (median ~66 days) says one trial is not a habit, so "repeat" means v3 → v4 only and is never called a habit |
| `browse_prob` | 0.25 | — | existing, `coefficients.json` |
| `walk_speed_mps` | 1.3 | — | existing, `layout_optimise.PARAMS` |

## 11. Fatal flaws: fixed or accepted

| flaw (lens) | resolution |
|---|---|
| Not original as a consumer product (judges, retail) | **Accepted and reframed.** We don't pitch a consumer app. Prior art (Tesco app aisle locator and Favourites, Clubcard/dunnhumby offers, Amazon and Ocado buy-again, Instacart pick routing) is acknowledged; it comes from general knowledge and was not web-verified. The novelty is the *sim answer* to the retailer's question: the habit cost of a re-layout, human vs agent, traced. |
| Persona ID circular (judges, behavioural, ML, retail) | Code Naive Bayes trained on a held-out run; fresh seeds; mixtures; leave-one-out; jitter; mission-only baseline; calibration; "identifiability within the sim, an upper bound". Never a headline. |
| Mission leakage (ML, engineer) | Mission-only baseline plus within-`weekly_shop` accuracy; we claim only the lift over mission-only. |
| Special-category inference (judges, behavioural, GDPR) | Declared-only; excluded from the inference set; lens shown, not label; ecom-rerank gap fixed or disclosed. |
| Cross-visit tracking contradicts `data-collection.md` (GDPR) | The shopper brings identity and keeps the log on device; the doc sentence is reconciled. |
| No retention spec (GDPR) | 8 visits / 90 days, recompute the posterior, forget-me; rows added. |
| No memory; visits replay (engineer, ML, behavioural) | Visit salt in every draw key; memory as counts; `cat_unit` route memory; assertions in 5.3. |
| Re-layout routing bug, 72/96 stale unit labels (engineer) | Unit categories come from planogram slots (2.2). |
| No new products in the store (engineer) | Withhold one challenger per category for v1–2 and list it at v3. |
| Lift = our assumption (behavioural, ML, retail, engineer) | Routing assumption swept and decomposed; `route_card_logit` = 0 headline; compliance c = 0.2 headline with reactance; potential outcomes shown. Accepted residual: **the size of the v3 dip is assumption-driven**, and we say so on screen. |
| Repeat rate ungrounded (retail, behavioural) | Called trial-to-repeat v3 → v4 under labelled memory injection, never "habit". Real repeat needs a live pilot with a holdout. |
| Shortest path cuts impulse spend (behavioural, retail) | No distance optimisation; unplanned £ and total £ reported side by side; detour variant. |
| Reactance to forced recommendations (all) | Opt-in, ≤ 1 new item, reasons shown, skip, no "task" framing, no personalised price, HFSS excluded, abstain when unsure. |
| Retail-media covert ranking (retail) | Payment buys eligibility only; funded label; rank in code. |
| Scope vs 17:30 (judges, engineer) | One pre-computed experiment; no fourth surface; P0–P3 cut order; about 2 h. |
| `README.md` mentions OpenRouter / Claude API (judges) | Fix lines 70 and 189. |
| Walking metric has no geometry in `run.py` (ML) | Metres come from `layout_optimise.walk_metres` over the walkways actually visited. |

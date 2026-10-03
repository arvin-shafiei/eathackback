# retailer surface: whole-store layout optimisation

`sim/layout_optimise.py` → `data/sim/layout/`

This surface answers the store owner's question: **where should each category and product sit?** It optimises for one of three objectives:

| objective | what it maximises (the as-is store scores 1.0) |
|---|---|
| `retailer` | expected revenue per shopper, plus challenger exposure: `(rev/rev0 + w_ch·chal/chal0)/(1+w_ch)`, with `w_ch = 0.25` |
| `ease` | shopper ease: "put products where people are going anyway": `(1−w_f)·walk0/walk + w_f·found/found0`, with `w_f = 0.3` |
| `blended` | `(1−w)·retailer + w·ease`, where the user sets `--w-ease` (default 0.5) |

## the model (cheap, explainable surrogate)

Each shopper and product goes through the same three stages a brand sees on a real shelf:

```
E[take_i,k] = P(visit unit | route_k) · P(look | slot) · P(pick up | looked) · P(take | picked up)
E[revenue]  = Σ_k w_k Σ_i E[take_i,k] · price_i
```

- **P(look | slot)**: `sim/notice.py` `p_notice()`, with no LLM. It covers row, centrality, facings, mission, seconds at shelf and OCEAN terms, and every coefficient is sourced in `sim/coefficients.json`.
- **P(visit unit | route)** depends on the unit's relation to the shopper's mission:
  - mission unit: 1.0
  - a unit facing a walkway the shopper already walks (pass-by): 0.5 (assumption)
  - a unit that needs a detour: 0.25 (`browse_prob`)
  - Missions come from `sim/run.py` `MISSION_CATEGORIES`.
- **P(pick up | looked)** and **P(take | picked up)** come from a **TypeSafe Jev** Noul, asked **once** for each (persona, product, label-reading variant).
  - That is 12 × 96 × 2 = 2,304 requests, cached in `data/sim/cache/jev/` and `data/sim/layout/surrogate.json`.
  - The state is `jev.shopper_state` plus `jev.product_state`, so numbers reach the model already bucketed into words.
  - The "take" question states its premise explicitly ("Assume they have already picked it up…").
  - The two variants are mixed with `notice.p_reads_labels` (Grunert et al. 2010, base rate 0.27).
- **Walking distance**: the shopper goes entrance → every mission walkway → checkout. The geometry is identical to `web/src/layout.ts`.
  - Each walkway costs `unitLen + 2·crossGap` = 11.2 m.
  - Lateral movement costs 2 × the x-span (including the entrance x).
  - Time = metres / 1.3 m/s.
- **found**: the want-weighted P(look) on the persona's mission products, where want = P(pick up)·P(take). It answers "can they see what they came for?".

## constraints

- **Category integrity.** There is one category per unit, unless you pass `--cross-merch`, which allows product swaps between units of the same temperature class.
- **Chilled stays in fridges.**
  - Fridge units come from `units[].fridge` if the config has that flag. Otherwise they are the units that hold yoghurt, plant milk or ready meals today (U5, U7, U8), which is an assumption.
- **UK HFSS placement**, under the Food (Promotion and Placement) (England) Regulations 2021, SI 2021/1368 (https://www.legislation.gov.uk/uksi/2021/1368/contents/made), in force since 1 Oct 2022.
  - The rule: no in-scope "less healthy" product at entrances, aisle ends (end-caps), or within 2 m of a checkout, in stores of 2,000 sq ft or more.
  - Store area is computed from the 3D geometry: 25 m × 29 m = 725 m², which is about 7,804 sq ft, so the rule applies.
  - There are 8 end-cap sites (front and back of each of the 4 gondolas). No home slot is within 2 m of the entrance or checkout.
- **HFSS status (approximation).** It uses the UK 2004/05 Nutrient Profiling Model on OFF nutriments (food is HFSS at a score of 4 or more, drinks at 1 or more), plus a Schedule 1 scope mapping per category.
  - Fruit/veg/nut content is unknown, so it scores 0.
  - Products whose data is doubtful are barred conservatively. For example, Walkers has OFF salt = 0.003 g.
  - Result: 32 products are HFSS and 35 are barred from end-caps.

## search and outputs

The search is seeded simulated annealing (20k iterations, about 20–30 s per objective). It uses these moves:
- swap whole units within the same temperature class
- swap rows
- swap products within a unit
- set the end-cap product
- swap products across units (with `--cross-merch` only)

A **reset-labour pass** then undoes any change worth less than 0.05% of the objective, so the diff only lists moves that pay for the reset.

The run writes these files to `data/sim/layout/`:
- `planogram_<objective>.json` in CONTRACT planogram shape, which drops straight into `sim/run.py --planogram`.
- `report_<objective>.json`, which contains:
  - before/after metrics with paired persona-bootstrap 95% CIs (1,000 resamples of the 12 archetypes);
  - a layout-only (no end-caps) decomposition;
  - per-persona routes;
  - the diff list with traces: the leave-one-out effect of each category move; for each product move, its P(look) before/after, the per-persona funnel, the Jev surrogate probabilities with cache keys, and the notice logit terms;
  - an end-cap report showing which products the regulations hold back;
  - the constraint checks.
- `summary.json`, with all three objectives, the HFSS table, and a run-log cross-check: the empirical pick|noticed rate from the Jev run logs vs the surrogate's P(pick up)·P(take), per persona.

## results (seed 1, 20k iterations; Δ with 95% CI)

| | revenue/shopper | challenger looks | walk | wanted products seen |
|---|---|---|---|---|
| retailer | **+10.9%** (+6.9..+14.9) | **+21.8%** (+18.0..+27.0) | +15.8% (+7.5..+22.4) | +3.0% (−0.1..+6.5) |
| ease | +4.2% (+1.8..+7.4) | +1.5% (−0.2..+3.3) | −3.3% (−11.6..+2.4) | **+8.0%** (+4.8..+11.4) |
| blended (w=0.5) | +8.4% (+4.6..+12.9) | +14.2% (+10.8..+18.9) | −3.3% (−11.6..+2.4) | +4.3% (+1.6..+7.6) |

What the results show:
- **Revenue and walking pull against each other.** The retailer layout spreads mission categories across walkways, so shoppers pass more shelves. One example from the diff: "move soft_drinks from U1 to U6 … vs swapping it back: revenue +12.6p/shopper, walk +12.4 m".
- **Shopper ease costs little revenue.** The ease layout moves wanted products to eye level, which raises takes by 7.7% even though revenue gains less.
- **The HFSS regulations bind on end-caps.** The best single end-cap candidates include Tyrrell's crisps, Mister Free'd tortilla chips and Happy Hippy chocolate, and all three are barred. The compliant end-caps go to Fage Total 0%, Lizi's granola, the dhal and the protein soups.

## run

```bash
python3 sim/layout_optimise.py --surrogate-only                       # 2,304 Jev calls, ~40 s, ~$0.12 (cached after)
python3 sim/layout_optimise.py --objective all --iters 20000 --seed 1   # all three objectives, ~90 s, $0 (cache)
python3 sim/layout_optimise.py --objective blended --w-ease 0.8 --w-challenger 0.5 --cross-merch --endcaps 4
```

**Cost (real):**
- The surrogate cost **$0.126** for 2,496 calls and about 2.99M input tokens: 12 personas plus one extra test persona that another agent added during the run.
- That works out to about 1,170 input tokens per call, logged to `data/sim/cost_log.jsonl` as `model: "jev"`.

## caveats (say these out loud)

- The Jev probabilities are a judgment per product, made in isolation, so the product does not compete with the rest of its shelf.
  - The run-log cross-check in `summary.json` shows the surrogate sits close to the slot-level Jev runs on pick|noticed (for example, vegan 0.226 vs 0.214 and novelty 0.171 vs 0.184), and lower for the meal-deal persona (0.07 vs 0.11).
- The pass-by visit rate (0.5), the end-cap noticing ratio (1.5×), the objective weights and the reset tolerance are **labelled assumptions**. They are all set in `PARAMS` and copied into every report.
- The bootstrap CIs capture *which shoppers walk in* (sampling over personas). They do not capture Jev sampling noise or uncertainty in the literature coefficients.
- HFSS uses the NPM approximation (fruit/veg/nut = 0, AOAC fibre from OFF). It is a screening tool, not a compliance sign-off.

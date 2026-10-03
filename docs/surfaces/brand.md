# brand surface: where does my product lose shoppers, and which honest pack fixes it?

The shop-owner surface asks "where should this go on the shelf?". The brand surface asks two other questions:

1. **Funnel.** Of the shoppers who walk past my product, how many **look**, how many **pick it up**, how many **put it back**, and how many **take** it? Which stage leaks, and why?
2. **Pack test.** Which *true* front-of-pack claim makes more shoppers stop and pick it up, and for whom?

The model is only ever TypeSafe Jev (`jev-latest`, through `sim/jev.py`). Every number traces to a logged event, a Jev probability, an OFF field, a persona verbatim URL, a paper, or a labelled `assumption:`.

## 1. funnel report: `sim/brand_report.py`

```
SHOWN ──notice gate (sim/notice.py, literature-calibrated)──▶ LOOK
LOOK  ──Jev Noul "does shopper pick up products[i] to look closer?" (sampled, CRN draw)──▶ PICK_UP
PICK_UP ──Jev decision Choice (sampled) ──▶ TAKE        else PUT_BACK
```

- **Input.** Non-rule-based Jev shelf runs in `data/sim/runs/run_*.json`, plus the AI-agent arm in `agent_*.json`. The script makes no model calls; it counts what is already logged.
- **Stage per event.** It uses `stage_reached`, `picked_up` and `p_pick_up` when the event has them (the new `sim/jev.py` funnel). Older logs fall back to: noticed and walk_past → looked, reject → put_back, pick → taken. The method used is recorded in `trace.stage_method`.
- **Rates.** look = looked/shown, pick_up = picked_up/looked, keep = taken/picked_up, take = taken/shown. Each comes with a Wilson 95% CI, and each is broken down by archetype and by OCEAN segment (a trait ≥ 0.5 counts as high).
- **Leak diagnosis.** For each stage it compares the product's conversion with the pooled category average from the same runs, and names the stage with the lowest ratio (only stages with n ≥ 3, which is an assumption):
  - *look* → "shelf position / salience". Evidence: P(notice), row, facings and logit terms.
  - *pick_up* → "the pack doesn't earn a closer look". Evidence: the mean Jev P(pick up) and the appeal Score against the category.
  - *keep* → "label / price / trigger kills it". Evidence: put-off Nouls that fired (p > 0.5), each with the persona's sourced trigger and a Reddit verbatim and URL, plus the Jev mechanism Choice.
  - A diagnosis is marked **clear** when the product's 95% CI upper bound is below the category rate. Otherwise it is marked **directional**.
- **Benchmark.** The product's take-rate rank within its category in the sim is shown next to its real NielsenIQ / The Grocer rank from `data/sales/uk_bestsellers.csv`. The match is labelled *product* or *brand only*, and only same-category lists are used. If the brand is absent from those lists, that is reported as "below the published cut-off", not as zero sales.
- **Output.** `data/sim/brand/<code>.json` (everything, including definitions and run files), `data/sim/brand/<code>.md` (a one-pager for a buyer) and `data/sim/brand/index.json` (all products, including leak stage and NIQ rank).

```bash
python3 sim/brand_report.py                          # all products in the Jev runs
python3 sim/brand_report.py --product 5060430292760  # one product
python3 sim/brand_report.py --runs data/sim/runs/run_A.json,data/sim/runs/run_B.json
```

The latest run, over 2 Jev runs with 20,664 shelf events and 96 products, puts the leak at PUT_BACK for 39 products (16 clear), at LOOK for 23 (10 clear) and at PICK_UP for 20 (10 clear). 14 products convert at or above the category average at every stage.

## 2. pack test: `sim/pack_test.py`

1. **Claims, computed in code from OFF and never generated.** The thresholds come from the Reg (EC) 1924/2006 Annex:
   - high fibre: ≥ 6 g/100g or ≥ 3 g/100kcal
   - source of fibre: ≥ 3 g/100g or ≥ 1.5 g/100kcal
   - high protein: ≥ 20% of energy; source of protein: ≥ 12% of energy
   - low sugar: ≤ 5 g/100g (≤ 2.5 g/100ml for liquids); sugar free: ≤ 0.5 g
   - no added sugar: allowed only if `ingredients_text` contains no sugar, syrup, honey, juice or dates (deliberately conservative)
   - low salt: ≤ 0.3 g; low calorie: ≤ 40 kcal/100g (≤ 20 kcal/100ml)
   - organic, vegan, gluten free, Fairtrade and B Corp: only when the OFF label is present

   One addition to the regulation is labelled as an assumption: protein claims need ≥ 3 g/100g, so the script never promotes "high protein" on a cola that has 1.1 g. Each claim stores its OFF field, value, rule and source.
2. **Variants.** The script builds the current pack (control), one "LEAD WITH <CLAIM>" variant per eligible claim, and a stack of the two strongest nutrition claims, for 3-5 variants in total.
3. **Jev fan-out.** For each persona × variant there is one request, with front-of-pack only and the price put into words against the planogram slot set. The questions are:
   - `pickup` Noul: "Would `shopper` stop and pick up `product` …?"
   - `appeal` Score: 5 levels
   - `gimmick` Noul
   - `believe` Noul: is the lead claim relevant to their priorities?
   - the persona's own `put_off_k` and `trust_k` Nouls, with their sources

   Each variant goes in its own request, so Jev never compares packs side by side.
4. **Composition, done in code.** It reports Δ P(pick-up) per variant per persona against the control. The winner is the highest equal-weighted mean P(pick-up), excluding any variant whose mean P(gimmick) rises more than 0.10. A |Δ| < 0.02 counts as no change (an assumption). Jev returns calibrated probabilities rather than samples, so the spread is shown as the number of personas that went up or down, not as a sampling CI.

```bash
python3 sim/pack_test.py --list-claims        # every challenger's eligible vs already-on-pack claims, no API
python3 sim/pack_test.py                      # default 3 challengers whose true fibre/protein claims are NOT on pack
python3 sim/pack_test.py --products 5060043225353,5036589253471
```

Results from 3 Oct 2026 (12 personas each; outputs in `data/sim/brand/pack_test/<code>.{json,md}`):

| product | true claims not on pack today | winner | Δ P(pick-up) panel mean | biggest segment lift |
|---|---|---|---|---|
| BOL Protein Power Soup | high fibre, high protein, low sugar | HIGH FIBRE · HIGH PROTEIN | **+0.022** (4 up / 0 down) | ai_delegator 0.35 → 0.45 (lead high protein) |
| Dalston's Raspberry Soda | high fibre (per 100 kcal), low sugar, low calorie | LOW SUGAR | +0.018 (5 up / 0 down; below the 0.02 floor) | glp1 0.29 → 0.36 (high fibre + low sugar) |
| Bio&Me Granola Super Nutty | high fibre, low salt | HIGH FIBRE · LOW SALT | +0.007 (no meaningful change) | glp1 0.50 → 0.55, ai_delegator 0.25 → 0.30 |

**What to tell the brand.** A true high-fibre or high-protein claim is not a panel-wide win; the lift is +0.01 to +0.02 in P(pick-up). It is a *segment* win, for small-appetite (GLP-1) shoppers and AI-delegated shoppers. It costs nothing with the gimmick-reactant persona: no variant raised mean P(gimmick) by more than 0.05. The funnel report for BOL shows why this matters. BOL leaks at PUT_BACK, where the "protein claim on a food that is naturally that thing" trigger fires (mean p = 0.97, with a Reddit verbatim). So a protein-led front of pack earns the pick-up and loses the sceptic at put-back.

**Cost.** The pack test made 168 Jev requests, 270,736 input tokens, **$0.0114** in total (each request is ≈1.6k tokens; output tokens are free). The brand report makes no model calls.

## files

- `sim/brand_report.py`: funnel, leak diagnosis and benchmark → `data/sim/brand/<code>.{json,md}`, `index.json`
- `sim/pack_test.py`: the claims engine, the variants and the Jev fan-out → `data/sim/brand/pack_test/<code>.{json,md}`, `index.json`
- Both import `sim/jev.py`, which provides `ask()` with the disk cache in `data/sim/cache/jev/` and the cost log in `data/sim/cost_log.jsonl`, plus the words-not-numbers helpers.

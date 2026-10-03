# calibration: do the synthetic shoppers agree with real humans?

The 3D sim produces pick shares for every product. That claim is only worth something if it survives contact with real people. **The Shelf** at EAT_HACK puts 25 challenger brands in front of about 50 builders, so we have real ground truth today. This folder turns their votes into human shares and scores the sim against them, honestly and per segment, with a statistical correction.

> RGC (careers page): *"A number that cannot be traced back to its source is worse than no number at all."*
> Ege (RGC blog, Apr 2026): synthetic shoppers are *"only as credible as the behavioural data underneath them"* and *"the grounding matters more than the simulation."*

## Files

| file | what |
|---|---|
| `form_spec.md` | The 60 s phone form, ready to paste into Tally or Google Forms. Fields are top-3 brands, buy-at-shelf-price, why-tags (the same vocabulary as the sim `mechanism`), walk-past, mission, segment screener, and the optional TIPI Big Five (Gosling 2003). |
| `ingest.py` | CSV → `out/human_shares.json`: per-brand top-1 share with a Wilson CI, top-3 rate given tasted, a **Bradley–Terry** share with a bootstrap CI, why-tags, walk-pasts, segments, missions and TIPI OCEAN. |
| `compare.py` | Sim run log + human shares → `out/compare.json`. Reports rank correlation (Spearman, Kendall τ-b, permutation p), MAE in pp, per-segment error, positivity bias and variance compression, why-tag distance, OCEAN gap, and an **AIPW / prediction-powered correction** with an 80/20 holdout. |
| `make_demo.py` | **Fake** fixtures (`fixtures/DEMO_*`) to test the pipeline before votes arrive. Never present these numbers: every output is labelled `DEMO - FAKE`. |
| `brand_map.example.json` | Shelf brand → sim product barcodes (copy it to `brand_map.json`). |

## Run on the day

```bash
# 0. put the 25 Shelf brand names in calibration/brands.txt (one per line, same spelling as the form)
# 1. after voting closes, export CSV from Tally/Google Forms
python calibration/ingest.py ~/Downloads/responses.csv --brands calibration/brands.txt
# 2. map Shelf brands onto sim products (or rely on catalog.json brand match)
cp calibration/brand_map.example.json calibration/brand_map.json   # then edit
# 3. score the sim run
python calibration/compare.py --run data/sim/runs/<run_id>.json
# dry run on fake data:
python calibration/compare.py --demo
```

Both scripts use the standard library only, and both run end-to-end on the demo fixtures (checked 3 Oct).

## Methods and where each comes from

| quantity | method | source |
|---|---|---|
| top-1 share CI | Wilson score interval | Wilson, E. B. (1927) *JASA* 22:209–212 |
| brand strength | Bradley–Terry on rank-broken pairs: #1 > #2 > #3 > every other tasted brand | Bradley & Terry (1952) *Biometrika* 39:324; MM fit from Hunter (2004) *Ann. Statist.* 32:384; rank-breaking from Azari Soufiani, Parkes & Xia (2014) ICML |
| BT shrinkage | 0.5 virtual wins and losses against a reference | assumption: keeps brands with zero wins finite at n ≈ 50 |
| BT CI | percentile bootstrap over voters, B = 300 | Efron & Tibshirani (1993) |
| OCEAN | TIPI, 10 items on a 1–7 scale, items 2/4/6/8/10 reversed, rescaled to 0–1 | Gosling, Rentfrow & Swann (2003) *J. Res. Pers.* 37:504 |
| sim share | exposure-adjusted: (picked / shown) normalised across Shelf brands | assumption: the sim's notice gate shows brands unevenly, while Shelf tasters tried everything they ticked |
| rank agreement | Spearman ρ (tie-averaged) + Kendall τ-b + permutation p (2,000 permutations) | standard |
| per-segment error | the same metrics within each screener segment ↔ the sim agents of that CONTRACT archetype; reported only when n ≥ 8 | arXiv 2609.13148: subgroup error of 10–30 pp despite good topline accuracy; the n ≥ 8 floor is an assumption |
| positivity bias | sim P(pick \| considered) and mean sentiment vs the human share answering *no/maybe* to buying **their own #1** at shelf price | research/05-personas.md §6.6 ("LLM personas don't reject"); arXiv 2609.13148 (variance compression) |
| variance compression | SD(sim shares) / SD(human shares) | arXiv 2609.13148 |
| why-tag agreement | total-variation distance between human why-tags on #1 and sim mechanisms on picks | standard |
| correction | θ̂_b = mean over sim agents of f_b(x) + mean over voters of (Y_ib − f_b(x_i)), with Var = Var(f)/N + Var(resid)/n. This is AIPW with a constant labelling propensity, i.e. prediction-powered inference. | Angelopoulos et al. (2023) *Science* 382:669; Tigre & Souto, *When Can You Trust Your Synthetic Users? Diagnostics and Corrections for LLM Consumer Panels*, [arXiv 2609.13148](https://arxiv.org/abs/2609.13148): doubly robust AIPW with n = 50–300 real responses, **83–94 % bias reduction** on a consumer pricing dataset |

### AIPW, in plain English

The sim gives us a prediction for every kind of shopper (cheap and plentiful, but biased). The 50 humans give us a small, unbiased sample. We measure how wrong the sim is **on the humans we actually have** (the residual) and subtract that error from the sim's population estimate. If the sim is right, the residual is about 0 and we keep the sim's precision. If it is wrong, the humans pull it back.

To check this, we fit the correction on 80 % of voters, score it on the held-out 20 %, repeat over 50 random splits, and report naive versus corrected MAE.

## A second, larger ground truth we could ask for

The EAT_HACK submission form makes every team **select their three favourite brands from The Shelf** (brief, "What to submit"). That is a top-3 ranking with the same shape as our `[top1..3]` fields, collected by RGC from every team. Its aggregate, with no individual data, would feed `ingest.py` unchanged if we name the columns `top1`, `top2` and `top3`. We have no tasted-set or segment data for those voters, so the BT fit treats all 25 brands as tasted (assumption) and the per-segment metrics are skipped.

## Read the results honestly (what we will say on stage)

- **n ≈ 50 is a topline check, not a segment study.** The paper's correction regime starts at 50 and runs to 300. Per-segment rows print next to their n, and anything under 8 is suppressed.
- **The room is not the UK.** Hackathon builders who got free samples and a forced choice are not shoppers. The Shelf gives no real willingness to pay, no repeat purchase and no walk-past rate (research/05 §6.7). The `buy_top1` and `walkpast` questions are there to partly close that gap.
- **The Shelf measures taste; the sim measures shelf behaviour.** The Shelf removes the notice gate, because everyone tasted. So we compare **conditional on exposure** (exposure-adjusted sim share). A good match validates the read-and-decide layer, not the shelf-position layer. The 2-second shelf-photo test in research/05 §6 would be how to calibrate noticing.
- **TIPI is a screen, not a diagnosis.** Compare room means against sim means. Never label an individual.
- **What we will not do:** tune the sim on the same votes we score it against. The 80/20 holdout exists for exactly that reason.

## Outputs (shape)

`out/human_shares.json` → `{n_voters, methods, positivity_check, ocean_summary, brands: {<brand>: {top1_share, top1_ci95, bt_share, bt_ci95, top3_rate_given_tasted, buy_top1, why_top1, walkpast_votes, why_walkpast}}, by_segment, by_mission, voters[]}`

`out/compare.json` → `{topline: {spearman_rho, spearman_perm_p, kendall_tau_b, mae_pp, top5_overlap, sd_ratio_sim_over_human}, per_segment, positivity_bias, why_tags, ocean, aipw: {per_brand, holdout_80_20}, per_brand}`

The frontend can show `topline` as a "trust score" sticker next to every sim number, and `per_segment` as the "where not to trust it" list.

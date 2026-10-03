# store ops: results

*`sim/ops.py`, 3 Oct 2026. Full tables, with a paired 95% CI on every diff, are in `RESULTS.auto.md`. Per-seed KPIs with traces are in `RESULTS.json`.*

**Command:** `python3 sim/ops.py --compare --seeds 1,2,3 --days 3 --sweep-restock 4,6,8`

**Setup**
- XL store: 480 SKUs, 24 bays, 6 staffed tills + 12 self-checkouts (SCO), 2 entrances.
- 3 trading days, Sat → Sun → Mon, 08:00–22:00, about 2,280 shoppers on Saturday.
- Staff: 6 restockers, 2 cleaners, 1 guard.
- Common random numbers: every arm sees the same shoppers, baskets and draws.

**Replay files (Saturday, seed 1):**
- `day_20261003_130238_s1_smart_priority_bay.json` (smart routing)
- `day_20261003_130248_s1_jsq_priority_bay.json` (baseline)

**Read this first: what is and isn't real**
- **Self-checkout acceptance did not come from Jev.** The TypeSafe API returned **402 (no credits)** on every call. All 132 (persona × basket) combinations used the labelled fallback table `sco_accept_fallback`: few items 0.85, small 0.70, big 0.40, very big 0.20. That table is an assumption. Rerun once credits are added; it needs ≤192 calls, about $0.01.
- **8 calls accidentally went to OpenRouter (~$0.004).** `sim/jev.py`, edited by another agent, now falls back to OpenRouter's `typesafe/jev-router` on a 402. Before I pinned `JEV_BACKEND=typesafe` in `ops.py`, 8 calls went that way (tags `jev-router:ops_sco:*` in `cost_log.jsonl`). Their answers were discarded. `ops.py` now refuses any answer that is not TypeSafe or not calibrated.
- **Many parameters are labelled assumptions**, all in `params_extra.json` with low confidence: shelf capacity ×2, case size, patience, bump rate, theft rates, café, the in-range share of the basket and the initial back-room cover. The sourced ones come from `data/ops/params.json`: Klee/WPI service times, NTS footfall, Gruen out-of-stock (OOS) reactions, the ROP formula and Reiner lead times.

## 1. Checkout routing: it helps, but only because the router coordinates

Mean over 3 seeds, 3 days each. All diffs vs B have 95% CIs that exclude 0 (see `RESULTS.auto.md`).

| arm | mean wait | p90 wait | abandon | time in checkout (wait + service) | served | SCO share |
|---|---|---|---|---|---|---|
| **B: JSQ baseline** (join the visibly shortest queue) | 25.5 s | 91 s | 1.7% | 143 s | 5,026 | 62% |
| **A: smart** (walk + predicted work ahead + own service; counts shoppers it already sent) | **8.4 s** | **16 s** | **0.2%** | **109 s** | 5,103 | 31% |
| E: smart_wait (same, but ignores own service time) | 4.1 s | 0 s | 0.1% | 121 s | 5,107 | 62% |
| **F: smart_blind** (A's cost, but doesn't count inbound shoppers) | 40.5 s | 141 s | 2.5% | 140 s | 4,988 | 26% |
| D: nearest lane | 252 s | 722 s | 45% | 376 s | 2,819 | 56% |

- **A cuts waiting by 17 s per shopper and checkout time by 35 s (−24%).** Abandoned baskets fall from 1.7% to 0.2%, and about 77 more shoppers are served over 3 days.
- **The gain comes from coordination, not the service-time formula.** F uses the same formula but doesn't remember whom it already sent, and it does **worse than JSQ**: waits rise by 15 s.
  - **Why F fails:** the formula says a staffed till is always quicker per shopper (43 s + 3.24 s/item, against 48.6 s + 6 s/item at SCO). So everyone piles onto the tills while the SCOs sit idle. That is selfish routing.
  - **What JSQ loses:** shoppers herd towards the same idle lane during the ~20 s walk from the aisle end.
  - **What fixes it:** a router that tracks its own assignments.
- **A or E depends on what you optimise.** E has the shortest queues (4 s) but more SCO use, so slower service: 121 s in checkout against A's 109 s. A is better for total time in checkout; E is better on the queue-length optics.
- **Caveats:**
  - Results depend on the 30% service-time noise, the gamma patience and the self-checkout acceptance fallback.
  - JSQ shoppers decide at the aisle end and can't see who else is walking over. That is plausible, but it is a modelling choice.
  - The router knows basket sizes (for example from a trolley camera or scale), which is an assumption.

## 2. Restocking priority: no clear gain over FIFO; the spec-literal score is worse

| arm (6 restockers, 3 days) | SKU-minutes OOS | shoppers hitting ≥1 OOS | lost sales £ (3 days) | restock trips |
|---|---|---|---|---|
| C: FIFO (first SKU under 25% full goes first) | 28.9% | 47.2% | 46,806 | 958 |
| A: priority_bay (expected lost margin ÷ trip labour, per bay) | 28.6% | 47.2% | 45,963 | 971 |
| G: spec-literal P(OOS before next round) × demand × margin, per SKU | **31.6%** | **53.3%** | 49,277 | 1,403 |

- **A vs C: no clear difference.** Every CI spans 0, with lost sales −£844 [−2,786, +1,099].
- **G vs C: clearly worse.** The literal score keeps sending staff back to the fast-selling SKUs for a few units each time, so it makes 46% more trips and leaves the long tail empty.
- **Policy matters a little only when staff are short.** The staffing sweep (Saturday only) shows this:

| restockers | SKU-min OOS, FIFO → priority_bay | shoppers hitting OOS | lost £ (one Saturday) | utilisation |
|---|---|---|---|---|
| 4 | 45.5% → 43.2% | 69% → 67% | 37,778 → 33,520 (CI spans 0) | 0.79 / 0.87 |
| 6 | 13.8% → 13.7% | 41% → 39% | 5,756 → 5,450 (CI spans 0) | 0.61 |
| 8 | 12.2% → 12.1% | 32% | 4,493 → 4,464 | 0.48 |

**What helps is headcount, not the priority rule.** With 4 restockers a Saturday collapses: 45% of SKUs empty at any moment and 69% of shoppers hit an empty shelf. Going to 6 removes most of that, and 8 is about where returns flatten. The empty shelves that remain are ordering failures, not shelf-filling ones (section 3). For comparison, Gruen et al. 2002 measure 8.3% of SKUs out of stock on average and 40% of shoppers hitting at least one OOS per trip. At 6–8 restockers our Saturday is 12–14% and 32–41%: same order of magnitude, a bit high.

## 3. Manager / ordering: the cold start dominates

SKU-minutes OOS by day, arm A, seed 1:

| Sat | Sun | Mon |
|---|---|---|
| 16% | **65%** | 8% |

- **Sunday is an ordering failure.** Over the 3 days, 92% of OOS encounters happen with an empty back room (22,679 "store ordering" against 2,024 "shelf restocking"; this count is not split by day, but Sunday holds most of the OOS-minutes).
- **The cause is the setup, not the formula.** The store starts with an assumed 0.3–1.5 days of back-room cover and nothing on order. Ambient lead time is 2 days, so orders the manager places on Saturday (about 780 orders over the 3 days) don't arrive until Monday. Monday drops to 8%, close to Gruen's 8.3%.
- **The model is too clean.** Gruen & Corsten 2008 put 47% of real OOS down to store ordering and forecasting, 25% to shelf restocking and 28% upstream. We have no upstream failures, and the cold start inflates the ordering share.
- **Not yet done:** a run that starts from a warm pipeline (orders already in transit), so steady-state ordering can be measured.

## 4. Spills, café, security (arm A, seed 1, 3 days)

- **Spills:** 16, about 5 per day, at 2 per 1,000 trips, raised ×5 after a bump.
  - Mean cleaner response is 28 s, well inside the 5-minute target (an assumption).
  - The aisle stays blocked about 3.5 min per spill.
  - 2 cleaners is more than enough at this spill rate. The rate is an unsourced assumption; HSE only says "promptly".
- **Café:** 292 visits, 0 turned away, £769 revenue. All café parameters are assumptions.
- **Security:** 17 theft attempts (an assumed 0.4% of trips), 8 EAS alarms, all 8 recovered by the guard, £80 shrink. Every theft parameter is an assumption; BRC/ONS figures were not fetched.

## 5. Traffic by time of day (Saturday)

- **Arrivals:** follow the NTS hour curve shifted by 15 min, peaking about 11:00–12:00 (`kpis.traffic.arrivals_by_hour` in the day file).
- **Missions:** the 15–17 window carries 2× the treat/dessert mission share (assumption, anchored on the NTS 15:00 school-run peak); 17–19 is mostly top-ups.
- **Waits by hour:** `kpis.traffic.mean_wait_s_by_hour` shows when tills should open.

## 6. Cost

- **TypeSafe Jev:** $0. Every call returned 402.
- **OpenRouter:** about $0.004 through the router fallback, as described at the top; answers discarded.
- **Compute:** about 10 min of CPU for the full comparison and about 6 s per Saturday.

## 7. Adversarial verification (3 Oct, separate agent)

**Reproduced.** Re-running both replay commands with `--no-jev` gives byte-identical KPIs to the two day files (the fallback table is the same either way). Every number in sections 1–4 matches `RESULTS.json`.

**KPIs recomputed from the raw day JSON with an independent script** (Saturday, seed 1, smart / JSQ):

| KPI | recomputed from | smart | JSQ | match |
|---|---|---|---|---|
| mean wait | `theatre.unload − t_join`, paid shoppers | 19.51 s | 37.21 s | yes |
| abandon rate | `abandon` events ÷ shoppers who joined a queue | 13/2,285 | 59/2,285 | yes |
| SKU-minutes OOS | `timeline.frames[].empty`, trading hours | 0.1518 | 0.1469 | yes |
| shoppers hitting OOS | distinct shoppers in `oos` events | 0.4543 | 0.4468 | yes |
| lost sales £ | `shoppers[].oos` | **£5,313 net** | **£5,189 net** | **no: the KPI showed £6,290 / £6,145** |

- **Lost sales was overstated by about 18%.** `lost_sales_gbp` clips each substitution at 0, so a shopper who trades up to a pricier substitute recovers nothing in the KPI (£977 of trade-ups on the smart Saturday). It is kept for comparability, and the day files now also carry `lost_sales_net_gbp` and `substitution_trade_up_gbp`. The £ figures in section 2 are gross. The A-vs-C verdicts do not change, because both arms are gross.

**Queue sanity check against Erlang C (M/M/c), hour by hour, using the simulated arrival rate and mean service time per lane type:**
- **Staffed tills (c = 6) are in the same ballpark at moderate load.** With smart routing at 13:00–17:00 (ρ 0.6–0.76), Erlang C gives 8–37 s and the sim 2–11 s. The sim comes in *lower* because the router sends overflow to self-checkout, so staffed arrivals are not Poisson.
- **At the 10:00–12:00 peak (ρ ≈ 0.97–1.09), Erlang C diverges to ∞, while the sim stays finite (100–150 s).** That is expected for a one-hour overload with reneging (Erlang A) and diversion to self-checkout.
- **The self-checkout bank under JSQ is the real gap.** It runs at ρ 0.3–0.5 with 12 terminals, where pooled Erlang C gives about 0 s; the sim gives 20–56 s. The cause is the baseline, not a bug:
  - each terminal has its own queue;
  - JSQ breaks ties by nearest lane and can't see shoppers already walking over;
  - so shoppers herd. On the Saturday JSQ run, terminal SE3 served 293 shoppers and SW5 served 0.
  - **Implication:** much of A's win over B on the self-checkout side is a win over a *blind, un-pooled* JSQ. Real UK self-checkout banks usually run one shared queue, which would already be close to Erlang C. A fairer baseline is a pooled self-checkout queue, and it is not modelled yet.

**Rule zero fixes in `sim/ops.py`.**
- **13 hard-coded numbers moved to `params_extra.json`, each with a labelled assumption:**
  - `margin_proxy_default`
  - `restock_task_s_prior`
  - `restock_lookahead_s`
  - `restock_bay_shortfall_units`
  - `default_capacity_units`
  - `default_seconds_at_shelf`
  - `staff_idle_poll_s`
  - `cleaner_poll_s` (up to 15 s of the 28 s mean spill response is this polling latency)
  - `post_close_drain_h`
  - `ocean_phrase_thresholds`
  - `theatre_bag_pay_offsets`
  - `surrogate_min_pair_n`
  - `dayparts`
- **Surrogate params now reach `params_used`.** `surrogate_shrinkage_m` and the new `surrogate_min_pair_n` were read through the shared `Params()` and never appeared there; they do now.
- **Same outputs.** Frames, events and KPIs are identical before and after the change.

**`catalog_xl` checks.**
- **Pack copy:** 20 sampled auto SKUs. Every claim in `pack_copy` is the OFF name plus OFF label tags; 0 of 336 auto SKUs carry a claim missing from their own labels.
- **Nutrients:** they equal the OFF parquet values to 2 dp.
- **Curated pack copy:** the 36 curated SKUs without `pack_copy_source` were checked against their own protein, kcal, organic, vegan, no-added-sugar and additive fields: no contradictions.
- **Two own-label errors fixed.** Both SKUs were rebuilt with the script's own `build_product`, so their price and lens grades follow the new role; selection and planogram are unchanged:
  - `Lipton, Waitrose` was own_label because OFF lists the stockist. It is now a challenger.
  - `Marks & Spencers` (misspelt) was a challenger. It is now own_label.
- **`scripts/scale_catalog.py` `role_for`:**
  - a retailer named only *after* a non-retailer first brand no longer makes a product own-label;
  - `marks & spencers` and `taste the difference` were added to the lists.
- **Effect on results:** on the Saturday seed-1 runs it changes OOS share by <0.1 pp and lost £ by <1%. The tables above predate it.

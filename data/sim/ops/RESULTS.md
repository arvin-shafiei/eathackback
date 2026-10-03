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

- **Sunday is an ordering failure.** On Sunday 92% of OOS encounters happen with an empty back room (22,679 "store ordering" against 2,024 "shelf restocking").
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

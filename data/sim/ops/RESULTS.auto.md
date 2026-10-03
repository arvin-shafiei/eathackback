# store ops: results (sim/ops.py)

*Generated 2026-10-03T12:43 by `python3 sim/ops.py --compare --seeds 1,2,3 --no-jev`. Seeds [1, 2, 3] (common random numbers: every arm sees the same shoppers, baskets, service-time noise and draws), 1 trading day(s) from Sat 08-22, staff restock=4,clean=2,guard=1. Day files: `data/sim/ops/day_20261003_124222_s1_smart_priority_A.json`, `data/sim/ops/day_20261003_124226_s1_jsq_priority_B.json`.*

Every number below comes out of the event log of a run. Parameters and their sources are in each day file's `params_used` (`data/ops/params.json` + `data/sim/ops/params_extra.json`). Low-confidence parameters are labelled assumptions there.

## arms (mean over seeds)

| KPI | A: smart routing + priority restock | B: JSQ routing (baseline) + priority restock | C: smart routing + FIFO restock (baseline) | D: nearest-lane routing + priority restock |
|---|---|---|---|---|
| mean_wait_s | 49.7 | 33.4 | 51.8 | 298.767 |
| p90_wait_s | 169.167 | 123.2 | 178.033 | 814.833 |
| abandon_rate | 0.029 | 0.02 | 0.031 | 0.518 |
| served | 2185 | 2204.333 | 2179.667 | 1083.667 |
| throughput_per_open_hour | 156.1 | 157.467 | 155.667 | 77.4 |
| share_self_checkout | 0.316 | 0.618 | 0.311 | 0.549 |
| oos_events | 21828.667 | 23050.333 | 16740 | 172.333 |
| sku_minutes_oos_share | 0.488 | 0.505 | 0.417 | 0.012 |
| shoppers_hit_oos_share | 0.672 | 0.692 | 0.688 | 0.059 |
| lost_sales_gbp | 41939.433 | 44397.983 | 30855.117 | 308.083 |
| restock_tasks | 357.667 | 346.333 | 129.333 | 321.333 |
| restocker_utilisation | 0.924 | 0.924 | 0.791 | 0.515 |
| orders | 508 | 510.667 | 542 | 309 |
| spills | 7 | 7 | 7 | 7 |
| mean_spill_response_s | 27.933 | 27.933 | 27.933 | 27.933 |

## 1. does smart checkout routing help? (A vs B, and A vs D)

**A vs B (JSQ routing (baseline) + priority restock)**, paired over seeds, difference = A - B:

- mean_wait_s: B 33.4 -> A 49.7; diff 16.3, 95% CI [13.9042, 18.6958] -> **worse**
- p90_wait_s: B 123.2 -> A 169.167; diff 45.9667, 95% CI [35.3207, 56.6127] -> **worse**
- abandon_rate: B 0.02 -> A 0.029; diff 0.0086, 95% CI [0.0063, 0.0109] -> **worse**
- throughput_per_open_hour: B 157.467 -> A 156.1; diff -1.3667, 95% CI [-1.7462, -0.9872] -> **worse**

**A vs D (nearest-lane routing + priority restock)**, paired over seeds, difference = A - D:

- mean_wait_s: D 298.767 -> A 49.7; diff -249.0667, 95% CI [-283.8619, -214.2714] -> **better**
- p90_wait_s: D 814.833 -> A 169.167; diff -645.6667, 95% CI [-759.7474, -531.5859] -> **better**
- abandon_rate: D 0.518 -> A 0.029; diff -0.4896, 95% CI [-0.503, -0.4763] -> **better**
- throughput_per_open_hour: D 77.4 -> A 156.1; diff 78.7, 95% CI [74.8193, 82.5807] -> **better**

## 2. does priority restocking help? (A vs C)

- oos_events: FIFO 16740 -> priority 21828.667; diff 5088.6667, 95% CI [1806.0893, 8371.244] -> **worse**
- sku_minutes_oos_share: FIFO 0.417 -> priority 0.488; diff 0.0708, 95% CI [0.0455, 0.0961] -> **worse**
- shoppers_hit_oos_share: FIFO 0.688 -> priority 0.672; diff -0.0163, 95% CI [-0.0541, 0.0215] -> **no clear difference (CI spans 0)**
- lost_sales_gbp: FIFO 30855.117 -> priority 41939.433; diff 11084.3167, 95% CI [3443.3391, 18725.2943] -> **worse**
- restock_tasks: FIFO 129.333 -> priority 357.667; diff 228.3333, 95% CI [209.687, 246.9797] -> **worse**

## Jev calls and cost

- one Noul per (persona, mission, basket-size bucket, needs weighing, age-restricted): 122 combos; 0 uncached calls, 0 from cache, 122 fallbacks, errors 0; **$0.0000** this run (sources: {'fallback': 122}).
- mean P(use self-checkout) by basket bucket: big 0.40 (n=37), small 0.70 (n=40), very_big 0.20 (n=24), few 0.85 (n=21).


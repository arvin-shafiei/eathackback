# store ops: auto results

`python3 sim/ops.py --compare --seeds 1,2,3 --days 3 --sweep-restock 4,6,8` · seeds [1, 2, 3] · 3 day(s) from Sat · staff restock=6,clean=2,guard=1 · 2026-10-03T13:02

## arms (mean over seeds)

- A: smart routing + priority_bay restock: smart routing + bay-priority restock (the proposal)
- B: jsq routing + priority_bay restock: baseline routing: join shortest visible queue, nearest on ties
- C: smart routing + fifo restock: baseline restock: first SKU under the trigger first
- D: nearest routing + priority_bay restock: baseline routing: nearest lane shopper accepts
- E: smart_wait routing + priority_bay restock: router variant: least predicted work ahead (ignores own service time)
- F: smart_blind routing + priority_bay restock: ablation: smart cost but router does not count shoppers it already sent
- G: smart routing + priority restock: restock variant: spec-literal SKU score P(OOS before next round) x demand x margin

| KPI | A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|---|
| mean_wait_s | 8.367 | 25.5 | 8.367 | 251.8 | 4.067 | 40.467 | 8.367 |
| p90_wait_s | 16.033 | 91.167 | 15.767 | 722.267 | 0.033 | 141.0 | 15.733 |
| abandon_rate | 0.002 | 0.017 | 0.002 | 0.449 | 0.001 | 0.025 | 0.002 |
| mean_time_in_checkout_s | 108.567 | 143.333 | 108.567 | 376.1 | 121.433 | 139.733 | 108.933 |
| served | 5103.333 | 5026 | 5103 | 2819 | 5107.333 | 4987.667 | 5104.667 |
| share_self_checkout | 0.308 | 0.617 | 0.308 | 0.555 | 0.615 | 0.264 | 0.307 |
| oos_events | 23617 | 22699 | 24010 | 3178 | 23525.333 | 21714.333 | 26426 |
| sku_minutes_oos_share | 0.286 | 0.279 | 0.289 | 0.055 | 0.285 | 0.272 | 0.316 |
| shoppers_hit_oos_share | 0.472 | 0.464 | 0.472 | 0.212 | 0.473 | 0.464 | 0.533 |
| lost_sales_gbp | 45962.573 | 44071.18 | 46806.18 | 5569.67 | 45750.993 | 41725.967 | 49277.397 |
| restock_tasks | 971 | 999 | 958.333 | 1144.333 | 973.333 | 1019 | 1402.667 |
| restocker_utilisation | 0.449 | 0.457 | 0.444 | 0.495 | 0.451 | 0.463 | 0.532 |
| orders | 768.333 | 763.333 | 765.333 | 409 | 767.667 | 758.333 | 819.333 |
| spills | 12.667 | 12.667 | 12.667 | 12.667 | 12.667 | 12.667 | 12.667 |
| mean_spill_response_s | 28.1 | 28.1 | 28.1 | 28.1 | 28.1 | 28.1 | 28.1 |

## checkout routing vs baseline B (JSQ)

**A vs B** (smart routing + bay-priority restock (the proposal) vs baseline routing: join shortest visible queue, nearest on ties), difference = A - B, paired over seeds [1, 2, 3]:

| KPI | B | A | diff | 95% CI | verdict for A |
|---|---|---|---|---|---|
| mean_wait_s | 25.5 | 8.367 | -17.1333 | [-19.9035, -14.3632] | better |
| p90_wait_s | 91.167 | 16.033 | -75.1333 | [-81.8288, -68.4379] | better |
| abandon_rate | 0.017 | 0.002 | -0.0151 | [-0.0199, -0.0103] | better |
| mean_time_in_checkout_s | 143.333 | 108.567 | -34.7667 | [-37.853, -31.6803] | better |
| served | 5026 | 5103.333 | 77.3333 | [51.9574, 102.7093] | better |

**E vs B** (router variant: least predicted work ahead (ignores own service time) vs baseline routing: join shortest visible queue, nearest on ties), difference = E - B, paired over seeds [1, 2, 3]:

| KPI | B | E | diff | 95% CI | verdict for E |
|---|---|---|---|---|---|
| mean_wait_s | 25.5 | 4.067 | -21.4333 | [-22.6074, -20.2593] | better |
| p90_wait_s | 91.167 | 0.033 | -91.1333 | [-106.8385, -75.4282] | better |
| abandon_rate | 0.017 | 0.001 | -0.0159 | [-0.0214, -0.0103] | better |
| mean_time_in_checkout_s | 143.333 | 121.433 | -21.9 | [-23.5291, -20.2709] | better |
| served | 5026 | 5107.333 | 81.3333 | [51.2807, 111.386] | better |

**F vs B** (ablation: smart cost but router does not count shoppers it already sent vs baseline routing: join shortest visible queue, nearest on ties), difference = F - B, paired over seeds [1, 2, 3]:

| KPI | B | F | diff | 95% CI | verdict for F |
|---|---|---|---|---|---|
| mean_wait_s | 25.5 | 40.467 | 14.9667 | [13.7926, 16.1407] | worse |
| p90_wait_s | 91.167 | 141.0 | 49.8333 | [46.317, 53.3496] | worse |
| abandon_rate | 0.017 | 0.025 | 0.0075 | [0.0068, 0.0082] | worse |
| mean_time_in_checkout_s | 143.333 | 139.733 | -3.6 | [-5.5719, -1.6281] | better |
| served | 5026 | 4987.667 | -38.3333 | [-43.5049, -33.1618] | worse |

**D vs B** (baseline routing: nearest lane shopper accepts vs baseline routing: join shortest visible queue, nearest on ties), difference = D - B, paired over seeds [1, 2, 3]:

| KPI | B | D | diff | 95% CI | verdict for D |
|---|---|---|---|---|---|
| mean_wait_s | 25.5 | 251.8 | 226.3 | [219.199, 233.401] | worse |
| p90_wait_s | 91.167 | 722.267 | 631.1 | [571.4878, 690.7122] | worse |
| abandon_rate | 0.017 | 0.449 | 0.4316 | [0.4132, 0.45] | worse |
| mean_time_in_checkout_s | 143.333 | 376.1 | 232.7667 | [228.9475, 236.5859] | worse |
| served | 5026 | 2819 | -2207 | [-2358.1776, -2055.8224] | worse |

## restocking vs baseline C (FIFO)

**A vs C** (smart routing + bay-priority restock (the proposal) vs baseline restock: first SKU under the trigger first), difference = A - C, paired over seeds [1, 2, 3]:

| KPI | C | A | diff | 95% CI | verdict for A |
|---|---|---|---|---|---|
| sku_minutes_oos_share | 0.289 | 0.286 | -0.0031 | [-0.0133, 0.0071] | no clear difference (CI spans 0) |
| shoppers_hit_oos_share | 0.472 | 0.472 | -0.0002 | [-0.0286, 0.0283] | no clear difference (CI spans 0) |
| oos_events | 24010 | 23617 | -393 | [-1310.4611, 524.4611] | no clear difference (CI spans 0) |
| lost_sales_gbp | 46806.18 | 45962.573 | -843.6067 | [-2785.8867, 1098.6734] | no clear difference (CI spans 0) |
| restock_tasks | 958.333 | 971 | 12.6667 | [-19.7569, 45.0902] | no clear difference (CI spans 0) |

**G vs C** (restock variant: spec-literal SKU score P(OOS before next round) x demand x margin vs baseline restock: first SKU under the trigger first), difference = G - C, paired over seeds [1, 2, 3]:

| KPI | C | G | diff | 95% CI | verdict for G |
|---|---|---|---|---|---|
| sku_minutes_oos_share | 0.289 | 0.316 | 0.027 | [0.0057, 0.0483] | worse |
| shoppers_hit_oos_share | 0.472 | 0.533 | 0.0611 | [0.0469, 0.0753] | worse |
| oos_events | 24010 | 26426 | 2416 | [188.956, 4643.044] | worse |
| lost_sales_gbp | 46806.18 | 49277.397 | 2471.2167 | [-2876.8464, 7819.2797] | no clear difference (CI spans 0) |
| restock_tasks | 958.333 | 1402.667 | 444.3333 | [404.7135, 483.9531] | worse |

## restocker staffing sweep (1 day, smart routing; mean over seeds)

| restockers | policy | SKU-minutes OOS | shoppers hit OOS | lost sales £ | restocker utilisation |
|---|---|---|---|---|---|
| 4 | fifo | 0.455 | 0.691 | 37778 | 0.79 |
| 4 | priority_bay | 0.432 | 0.671 | 33520 | 0.87 |
| 4 | priority_bay - fifo | -0.0236 [-0.0589, 0.0117] (no clear difference (CI spans 0)) | | -4258.32 [-13532.5492, 5015.9092] (no clear difference (CI spans 0)) | |
| 6 | fifo | 0.138 | 0.406 | 5756 | 0.61 |
| 6 | priority_bay | 0.137 | 0.394 | 5450 | 0.62 |
| 6 | priority_bay - fifo | -0.0005 [-0.0044, 0.0034] (no clear difference (CI spans 0)) | | -306.2267 [-662.8159, 50.3625] (no clear difference (CI spans 0)) | |
| 8 | fifo | 0.122 | 0.324 | 4493 | 0.48 |
| 8 | priority_bay | 0.121 | 0.319 | 4464 | 0.48 |
| 8 | priority_bay - fifo | -0.0003 [-0.0031, 0.0024] (no clear difference (CI spans 0)) | | -29.6633 [-88.1384, 28.8117] (no clear difference (CI spans 0)) | |

## Jev

- 132 (persona, mission, basket bucket, weighing, age) combos; 0 uncached calls, 0 cached, 132 fallbacks ({'fallback': 132}); halt: 402 no TypeSafe credits; spend **$0.0000**.


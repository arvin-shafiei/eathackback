# Store-ops evidence (checkout, traffic, restock, ordering, spills)

Built 3 Oct 2026 for `docs/ideas/store-ops.md`. The machine-readable values are in `data/ops/params.json`. Each entry there has `value, unit, range, source, confidence`.

Confidence levels:
- **high:** official or peer-reviewed measurement.
- **medium:** a real measurement, but small, old or from the US.
- **low:** a labelled assumption.

The WebSearch quota had run out, so every source below was fetched directly (gov.uk ODS files, Federal Reserve and WPI PDFs, the NACDS PDF, a Surrey green-OA PDF, HSE, Wikipedia, OpenAlex abstracts). Nothing is quoted from memory without a fetched page behind it.

## 1. Checkout service time

**Staffed till: Klee (2006), Federal Reserve FEDS 2006-02, Table 3(a)** ([PDF](https://www.federalreserve.gov/pubs/feds/2006/200602/200602pap.pdf))
- Data: scanner data from a US grocery chain, 10,760 debit and 13,594 check transactions. "Ring time" runs from the first item crossing the scanner to the drawer closing.
- Ring time = **42.997 s + 3.242 s × items** (debit; adj. R² 0.595). For check payers it is 75.061 + 3.775 × items.
- The items² term is −0.001 and not significant for debit, so the model is effectively linear.
- Mean ring time by tender: cash 56 s, debit 101 s, credit 112 s, check 148 s.
- Median basket is ~12 items (mean 16.66). Median ring time is 109 s (mean 128 s).

**Self-checkout vs staffed: Edwards & Kenner (2004), WPI IQP, Table 13** ([PDF](http://digital.wpi.edu/downloads/8049g5702))
- Timed purchases at Home Depot, Wal-Mart, BJ's and Price Chopper.

| | Home Depot | Wal-Mart | BJ's | Price Chopper | mean |
|---|---|---|---|---|---|
| Cashier unit scan (s/item) | 3 | 2 | 3 | 3 | 2.75 |
| SCO unit scan (s/item) | 5 | 6 | 5 | 8 | **6.0** |
| SCO initiation (s) | 5 | 5 | 5 | 15 | 7.5 |
| SCO card payment (s) | 20 | 30 | 20 | 25 | 23.75 |
| SCO cash payment (s) | 30 | 35 | 30 | 40 | 33.75 |
| SCO problem frequency | 25% | 30% | 20% | 60% | **34%** |
| SCO problem resolution (s) | 40 | 30 | 45 | 60 | 43.75 |
| Queue wait, staffed vs SCO (s) | 120 / 0 | 288 / 105 | 150 / 0 | 450 / 360 | |

- The authors' conclusion: SCO is "only faster than [its] manned counterparts due to limited waiting periods."
- They add that missing staff "may add between 1 and 5 minutes to the transaction time."
- At Home Depot, items without barcodes add "about 40 sec for each item" when assistance is needed. We use this as the upper bound for produce look-up.

**Other checkout sources**
- **Attendant ratio:** "one attendant can often run four to six checkout lanes" ([Wikipedia: Self-checkout](https://en.wikipedia.org/wiki/Self-checkout)).
- **Scan-only lanes:** a Singapore within-cashier field experiment (4 outlets, 152,246 transactions, 38 cashiers) found scan-only counters raised scanning speed **10.9%** and the customer service rate **~21%** (doi:10.66033/jmpr2024-111, abstract via OpenAlex).

**Model** (`service_time_formula` in params.json)
- Staffed = 43 + 3.24·n (+ produce and age-check terms).
- SCO = 7.5 + 6.0·n + 23.75 + 2.5 + 0.34·43.75 (+ produce and age-check terms).
- For 12 items, staffed takes **81.9 s** and SCO takes **120.6 s**, excluding queues.
- So routing pays off only when the SCO queue is shorter, and that is exactly what the queue-aware router computes.

**Assumptions, all marked low confidence:**
- Produce weighing: 4 s staffed, 10 s SCO.
- Age-check delay at SCO: modelled as one intervention, 43.75 s.
- Age-check delay staffed: 8 s.

## 2. Traffic by hour and day

**Hour of day: DfT National Travel Survey 2025, NTS0502b** ([ODS](https://assets.publishing.service.gov.uk/media/6a9ecdd5474b8101ece46434/nts0502.ods))
- Covers weekday shopping-trip start times in England (n = 35,864 trips).
- Share of trips starting in each hour:

| hour | 07 | 08 | 09 | 10 | **11** | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| % | 1.0 | 3.2 | 7.2 | 11.6 | **13.0** | 11.0 | 10.0 | 8.9 | 7.6 | 7.2 | 6.2 | 5.4 | 4.4 | 1.8 | 0.8 |

- The same table gives the **school-escort peak at 15:00 (31.2%)** and the **commute-home peak at 17:00 (13.6%)**. These anchor the after-school and after-work windows.

**Day of week: NTS0504b, shopping trips per person per year**
- Mon 20.0, Tue 18.2, Wed 17.6, Thu 18.5, Fri 22.0, **Sat 30.1**, Sun 19.0.
- Saturday is 1.45× an average day.
- The Sunday Trading Act 1994 caps large stores at 6 hours on Sundays.

**Absolute scale** comes from Gruen & Corsten (2008), whose cost table uses a store with 10,900 customers a week. Combined with the curves above, the Saturday 11:00 peak is **~294 arrivals/h**. At a 97 s mean staffed service time and 85% utilisation, that needs **~10 staffed-lane equivalents**, which supports the "more checkouts" ask.

**Not sourced (low confidence):**
- The mission mix inside each daypart.
- The 2× treat/dessert uplift after school.
- The 15-minute lag from trip start to store arrival.
- Poisson arrivals: this is the standard queueing assumption and is labelled as one.

IGD and Kantar mission and daypart data were not reachable (see `research/04` §1).

## 3. Basket size by mission

- **Meal deal (3), top-up (5–10) and weekly shop (40+):** carried over from `research/04-3d-sim-evidence-and-tech.md`, where they are labelled [M]. The meal deal is main + snack + drink (r/CasualUK 1bc79kh).
- **Treat (2) and gym (3):** assumptions.
- **Sanity check:** Klee's all-transaction median is 12 and mean 16.7, i.e. right-skewed. That is why the basket distribution is negative binomial (an assumption).

## 4. Out-of-stock

**Rate and shopper reactions**
- **Average OOS rate is 8.3%** (Gruen, Corsten & Bharadwaj 2002).
- Gruen (2007), as quoted in [Prague Econ. Papers 2015](https://pep.vse.cz/doi/10.18267/j.pep.556.pdf), gives regional rates: Europe 8.6%, north-west Europe 7.2%, south/east Europe 10.8%, US 7.9%.
- Shopper reactions: 31% buy at another store, 26% switch brand, 19% switch to the same brand, 15% delay, 9% don't buy.

**From Gruen & Corsten (2008)** ([NACDS PDF](https://www.nacds.org/pdfs/membership/out_of_stock.pdf))
- **Root causes:** store ordering and forecasting **47%**, shelf restocking **25%**, upstream **28%**.
- **Shopper experience:** 40% of shoppers meet at least one OOS per trip. 10% of those ask staff, which costs 6 staff-minutes (4 in a small format).
- **Other findings:**
  - OOS rises on Saturday and Sunday.
  - Retailers lose about 4% of sales to OOS.
  - Fixes include "check the stock more frequently" and restocking "multiple times during the day."

## 5. Restocking labour

**Reiner, Teller & Kotzab (2013), POMS 22(4)** ([green OA](https://openresearch.surrey.ac.uk/view/delivery/44SUR_INST/12138884720002346/13140556810002346)): 202 stores, dairy category
- In-store logistics takes ">40% of the working hours of store employees" (citing Liebmann & Zentes 2001).
- Dairy shelf replenishment takes **2.7 h/day** in a supermarket, 4.7 in a small hypermarket and 6.4 in a large hypermarket (4.1/8.8/14.3 staff-hours).
- Stock sits 12.5 h in the cold room before going on shelf.

**Cases per hour (45) is an assumption.** The measured source, van Zelst et al. 2009 in IJPE, is paywalled. The restock trigger (shelf 25% full) is also an assumption.

## 6. Ordering (manager agent)

**Reorder point** ([Wikipedia: Safety stock](https://en.wikipedia.org/wiki/Safety_stock), citing Ballou, *Business Logistics/Supply Chain Management* 5e; Chopra et al. 2004)
- ROP = E(L)·E(D) + SS, where SS = z·√(E(L)σ_D² + E(D)²σ_L²).
- z = 1.65 for a 95% service level.

**Lead time** (Reiner et al. 2013)
- Dairy is "delivered daily to all stores", with 5.9 orders a week and 38.2 min/day spent ordering. Their simulation delivers at 06:00 the next day.
- We therefore use **1 day for chilled**. Ambient is 2 days, an assumption.
- Lead-time SD is 0.25 days, also an assumption.

## 7. Slips, spills and cleaners

- **HSE INDG225(rev2)** ([PDF](https://www.hse.gov.uk/pubns/indg225.pdf)): slips and trips "cause 40 per cent of all reported major injuries" and are "the most reported injury to members of the public." The guidance is to "Remove spillages promptly." It gives no time target.
- **Spill rate:** 2 per 1,000 shoppers, rising 5× after a collision. This is an assumption.
- **Cleaner response:** 5 minutes. This is an assumption.
- **Clean-and-dry block:** 3 minutes. This is an assumption.
- No public per-shopper spill frequency was found.

## Gaps (honest)

- There is no UK-measured SCO intervention rate (we used WPI 2004) and no UK footfall by hour specific to grocery. NTS covers all shopping.
- There is no data on dessert or snack share by daypart.
- There are no measured figures for cases per hour, spill frequency or cleaner response.
- All of these gaps are low-confidence assumptions in params.json. Each has a range, so a sensitivity sweep can show whether a conclusion depends on it.

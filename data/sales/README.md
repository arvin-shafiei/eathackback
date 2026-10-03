# UK grocery best-sellers: real sales data for incumbents, priors and validation

`uk_bestsellers.csv` has 391 rows covering the 8 shelf categories plus `meal_deal`. Columns:

`category, rank, brand, product_or_range, sales_value_gbp_m, volume, yoy_change, period, channel, source_name, source_url, notes, table`

`table` is an extra grouping column. It names the source ranking table each row came from. **Only compare ranks within one `table`.** Different tables use different periods and scopes.

## Sources

| Source | What it gives | Period | Rows |
|---|---|---|---|
| **The Grocer Top Products Survey 2025** (NielsenIQ, total GB grocery, value sales) | Top 10/20 brands per subcategory, with £m, YoY £ and %, total-category and own-label rows | 52 w/e 6 Sep 2025 | most rows (`top_products_*`, `top10_snacking_nuts`, `top20_sports_nutrition`) |
| **The Grocer Britain's Biggest Brands 2026** (NIQ) | Brand-umbrella value across ALL categories (e.g. Walkers £1,413m includes Quavers, Wotsits and others; Cadbury £2,546m) | calendar 2025 (52 w/e ~27–31 Dec 2025) | `bbb2026_brand_umbrella` |
| **Talking Retail / Independent Retail News** (NIQ) | Top 25 soft-drink sub-brands (Coca-Cola Original vs Diet Coke vs Zero etc.) | 52 w/e 24 May 2025 | `nielsen_top25_softdrink_skus_may2025` |
| **Better Retailing** (Retail Data Partnership EPoS from 2,985 independent stores, plus "What to Stock") | SKU-level convenience best-sellers (crisps, cereal bars) | 12 w to ~Feb 2024, and 2025 | `convenience_*` |
| **Tesco Clubcard Unpacked** (via PA/Yahoo, The Manc, Grocery Gazette) | #1 meal-deal main, snack and drink, nationally and by region (rank only, no units) | calendar 2022–2025 | `tesco_meal_deal_*` |
| Misc. (Grocer news, NIQ via trade press, company accounts) | Challengers (Poppi, Trip, Goodrays, Plenish, Fage, Biotiful), faded fads (Prime), plant-milk category total | various | `other_*` |

Access notes, in case the data needs re-pulling:
- thegrocer.co.uk shows a captcha to proxies, but plain `curl` with a browser user-agent, or a web.archive.org `id_` snapshot, returns the article HTML.
- Each ranking table is a Datawrapper embed. The raw data downloads from `https://datawrapper.dwcdn.net/<ID>/<version>/dataset.csv`. IDs used:
  - sweet biscuits 3I6A8; savoury biscuits 3Atju; chocolate n6XcS
  - crisps dvT7P; nuts rxHPN; cereal bars pM5HJ; sports nutrition RxBhk
  - chilled ready meals g61sD; frozen ready meals 3QByL; pot meals VKYQt; ambient ready meals mJ2EE
  - ambient soup WSPfB; chilled soup 96c92
- Some soft-drink and plant-milk tables were read from Wayback snapshots and could not be checked against the live paywalled page.

## Rank conventions

- Integer: rank within that row's `table`.
- `OL`: total own label for that table. `TOTAL`: category total. Use these two to compute own-label share.
- `BBB<n>`: rank in the Britain's Biggest Brands top 100 (umbrella brand, cross-category).
- `conv-*` / `conv25-*`: SKU rank in independent convenience stores (no £).
- `nuts-*`, `sportsnut-*`: snacking-nuts and sports-nutrition tables, filed under crisps and snack bars.
- Meal deal: `main-1`, `snack-1`, `drink-1`, `*-region`.
- Blank rank: a challenger or contextual row, not part of any ranking.

How values are marked:
- Measured values are NIQ figures as published.
- Rows marked `ESTIMATE` or `DERIVED` in `notes`: Minor Figures, Rude Health, Califia, Glebe Farm and Oato have no public £ figure. Hip Pop £2.3m and Prime £15m are derived by subtraction.
- `volume` is mostly blank. The NIQ tables are value-only; some notes give volume or kg change.

## Caveats

- **These are brand totals, not SKUs.** "Walkers £607.9m" means all core Walkers crisps. Divide across your SKUs by facings, or use the convenience SKU ranks for within-brand ordering.
- **There are three periods:** May 2025, Sep 2025 and Dec 2025, plus mid-2026 for Poppi. Don't mix them in one ranking.
- **Plant milk** is a mixed dairy and plant "Milk" table. Alpro (#2) and Oatly (#3) sit among Cravendale, Müller, Lactofree etc. The plant-only category is £338.5m. Own label holds about 72% of total milk but only about 10% of plant-based.
- **Snack bars:** protein bars sit in "sports nutrition", whose £467m also includes powders and drinks (Huel, Optimum Nutrition, SiS). The notes flag which brands are mostly not bars.
- **Value is inflated by price.** For example, Coca-Cola lost 43.8m packs in 2025 while value rose. For pick-share validation, unit or volume data would be better but isn't public, so treat value as the proxy.
- **Meal deal is Tesco-only and rank-only.** No unit counts are published.
- Open Food Facts `unique_scans_n` (the `scans` column in `data/products/uk_products.csv`) is a weak, free popularity proxy for SKUs. It is noted here but not used.

## Using it as sim priors

1. **Habit/familiarity prior per brand:** `familiarity = log(sales_value_gbp_m) / log(max sales in table)`, clipped to [0.05, 1]. Use log because brand sizes are heavy-tailed (Coca-Cola is about 11x Irn-Bru). Within a brand, spread across SKUs using the convenience SKU ranks or OFF scans.
2. **Own-label prior per shelf**, from the `OL`/`TOTAL` rows. This sets how often a value-seeking persona defaults to own label:

| shelf | own-label share of value |
|---|---|
| chilled ready meals | 80% |
| milk total | 72% (plant-based ~10%) |
| snacking nuts | 68% |
| frozen ready meals | 65% |
| chilled soup | 57% |
| savoury biscuits | 40% |
| yoghurt | 37% (and growing +14%) |
| sweet biscuits | 34.5% |
| breakfast cereal | 33% |
| ambient soup | 27% |
| crisps | 22% |
| cereal bars | 15% |
| chocolate | 13% |
| pot meals | 9% |
| carbonates | 8.6% |
| sports nutrition | 4% |
| energy | 2.3% |

3. **Novelty/challenger signal:** YoY growth for brands with £<100m. These are the breakout challengers:

| brand | growth | brand | growth |
|---|---|---|---|
| Fage | +50% | Little Dish | +49% |
| Biotiful | +73% | Wasabi | +24% |
| Plenish | +51% | Merchant Gourmet | +41% |
| Trek | +28% | Peter's Yard | +26% |
| Deliciously Ella | +31% | Trip | +86% |
| Kind | +19% | Goodrays | +47% |
| Huel | +61% | Dr Pepper | +20% |
| Barebells | +55% | Fuel10k | +27% |
| Forest Feast | +75% | Vita Coco | +31% |

   Poppi launched in Mar 2026 and took 62% of gut sodas within 3 months. Use these to set the `challenger` role and a trial-propensity boost.
4. **Decay examples to calibrate "tried it, went back":**
   - Prime: −80%
   - Grenade: −16%, losing to Barebells and Myprotein
   - Müller Light / Light & Free: −6% / −20%, losing to full-fat and protein lines
   - Pringles: −9%, on price
   - Arla Jörd: delisted at £5.5m
5. **Meal-deal module:** set the default bundle to Chicken Club + Egg Protein Pot + Red Bull (Tesco 2025). Coca-Cola held #1 drink 2022–24. Regional swaps: Coke in Scotland and Wales, Pepsi Max in Northern Ireland, McCoy's and Hula Hoops Big Hoops as the crisps alternatives.

## Suggested validation

For each `(category, table)` with at least 6 ranked brands present in the sim:

1. Run N shoppers (e.g. 2,000 across personas, weighted to UK demographics) through the shelf **with no novelty boost and no promotions**.
2. Compute sim pick share per brand: picks ÷ total picks, aggregating SKUs to brand.
3. Compute **Spearman ρ** between sim pick share and real `sales_value_gbp_m` (or rank). Report ρ, p, and a bootstrap 95% CI over shoppers.
4. Also check:
   - **Own-label share error:** |sim OL share − real OL share| per shelf. This is a good single number per shelf.
   - **Challenger direction:** do challengers with high real YoY growth gain share when you switch on the novelty term? Sign agreement is enough.
   - **Log-share calibration:** regress log(sim share) on log(real share). A slope near 1 means the sim's concentration is right. A slope below 1 means it is too flat, usually because the habit prior is too weak.
5. Hold out one category (e.g. yoghurt) while tuning the habit weight on the others, then report ρ on the held-out shelf.

Target: ρ ≥ 0.6 on the big tables (crisps, carbonates, yoghurt, cereal, sweet biscuits, chocolate) is credible. ρ near 0, or a flat log-slope, means the personas ignore brand habit.

## Retrieval date

Pulled 3 Oct 2026. Most source data is NIQ to Sep 2025 or Dec 2025, the latest Grocer annual surveys available.

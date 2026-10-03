# catalog_superstore + store formats: how the big-supermarket data was built

Built by `scripts/scale_superstore.py`. The run is deterministic and makes no LLM or Jev calls: it is selection plus arithmetic only.

Rule zero applies throughout. Every number in the outputs is one of:
- an Open Food Facts (OFF) field from `data/products/uk_products.parquet`;
- a formula over OFF fields, written down here or in `curated_xl_rules.md`, whose code is **imported** from `scripts/scale_catalog.py` rather than copied;
- a value from `data/ops/params.json`, `data/sales/uk_bestsellers.csv` or `data/personas/lens/*.json`;
- a value labelled `assumption: <why>`.

| output | what |
|---|---|
| `data/products/catalog_superstore.json` | All 480 `catalog_xl.json` products, with every original field unchanged and only shelf-dimension fields appended, plus `curation:"auto_superstore"` additions. Compact JSON. |
| `data/store/formats/{express,metro,superstore}.config.json` | Floor plans: the `store_xl.config.json` schema, extended (see §7). |
| `data/store/formats/planogram_{express,metro,superstore}.json` | CONTRACT planogram shape (`category`, `products`, `facings`) plus `stock`, `capacity`, `width_cm`, `filled_cm` and `fill_ratio` per slot. |
| `data/store/stores.json` | Named example stores, each with a format, footfall, mission mix and persona weights. |

`catalog.json`, `catalog_xl.json`, `store_xl.config.json` and `planogram_xl.json` are only read, never written.

Re-run: `python scripts/scale_superstore.py` takes about 5 minutes, mostly the greedy picker. `--layout-only` rebuilds only the formats from the existing catalog, and `--pools` prints the candidate pool per category.

## 1. Categories (OFF category tags)

There are 36 categories: the 12 from XL plus 24 new ones. A product is assigned in priority order:
1. **Pre-XL new categories** (`free_from`, `food_to_go`, `low_no_alcohol`). A gluten-free loaf belongs in the free-from bay, not in bread.
2. **The XL `SELECTORS`**, imported from `scale_catalog.py`, so XL top-ups land in exactly the category XL would have used.
3. **The remaining new categories**, in the `POST_XL` order.

Each new category has an include tag set, an exclude tag set and a name-reject regex (`NEW` in the script). *Assumption: OFF tags are crowd-sourced. The regexes only remove candidates; they never add one.*

There are two extra rules:
- `fresh_produce` additionally requires NOVA 1–2. *Assumption: produce tables hold unprocessed food; NOVA 3/4 items tagged as vegetables were prepared dishes such as cauliflower cheese and hash browns.*
- `world_foods` also takes a sauce, noodle or condiment whose OFF name matches a world-cuisine word list (`WORLD_NAME`: tikka, korma, teriyaki, gochujang, …).

**Asked for but dropped or renamed (honest):**
- **wine**: the OFF UK pull contains no alcoholic drinks.
- **beer_cider**: same reason. It becomes `low_no_alcohol`, the alcohol-free range only. The pool has 19 clean SKUs, and all of them are used.
- **baby_food**: about 5 products in the whole pool. Dropped rather than padded (`MIN_KEEP = 15`, an assumption).

## 2. Candidate filter

- **New categories:** the spec minimum is an `image` (not `/invalid/`), a `name` and a `brand`. On top of that, the XL English-name rules apply: the `FOREIGN` regex and `englishish()`, no `oz` quantities.
- **XL top-ups:** these keep the stricter XL filter, which also requires `ingredients_text` and `sugars_100g`, so they grade exactly like the XL set.

Products are deduplicated by barcode against everything already chosen, and by the XL near-duplicate rule (difflib on brand plus normalised name).

## 3. Picking (same greedy picker as XL)

The picker is `scale_catalog.main`'s algorithm, reused:
- **quality** = `log1p(scans) + 2·completeness + UK signal`;
- **variety bonus** over the NOVA, additives, organic, vegan, sugar and sub-type bins;
- **role quota** of 40% challenger / 35% incumbent / 25% own label, relaxed when the pool runs out;
- **near-duplicate skip.**

The new categories have their own sub-type bins (`SUB_NEW`), e.g. milk/butter/eggs/cream/spread and fruit/veg/herb.

**Targets** *(assumption)*:
- XL categories are topped up to 65, from 40 in XL.
- New categories get 80, capped by pool depth. Categories are never padded.

**Brand cap:** XL categories keep 4 per brand. New categories allow `max(4, 8% of target)`, which is 6. *Assumption: in a superstore each retailer's own label (Tesco, Sainsbury's, Asda, M&S, Aldi…) carries many fresh lines, so a cap of 4 would starve produce, meat and dairy.*

**Role detection:** `scale_catalog.role_for` is unchanged (own-label retailer names and sub-brands, `uk_bestsellers.csv`, curated incumbents, assumed leaders). One extra list applies only when that function returns `challenger`: `INCUMBENT_ASSUMED_SUPER` (Heinz, Hellmann's, Lurpak, Cathedral City, Birds Eye, Tilda, Patak's, …). Its `role_source` reads `assumption: '<brand>' is a long-standing UK category leader in a superstore-only category`, because `uk_bestsellers.csv` covers only 9 categories plus the meal deal.

## 4. Prices (all assumptions, every SKU spells out its own arithmetic in `price_source`)

**XL top-ups** use the XL model unchanged (`store_xl.config.json → derivation.price_model`):

`base[cat] × role_mult × (pack/median)^0.296`, clipped to the curated band.

**New categories** use:

`price = U[cat|subtype] × median_pack[cat]/1000 × role_mult[role] × (pack/median_pack)^0.7`, clipped to 0.3×–6× the base, then snapped to an .x4/.x9 ending.

- `U` is `UNIT_PRICE_ASSUMED`, the incumbent shelf £/kg or £/L. It is the author's UK 2025–26 estimate, not scraped. Examples:

  | category | £/kg or £/L |
  |---|---|
  | produce | 3.0 |
  | meat | 9.0 |
  | fish | 16 |
  | cheese | 10 |
  | water | 0.6 |
  | food to go | 15 |

  Sub-type overrides apply where one category mixes very different £/kg: milk 1.1, butter 9, eggs 4.5, spices 35, flour 1.2. The values are in `superstore.config.json → derivation.catalog_derivation`.
- `median_pack` is the median OFF pack size of the category's picks (data-derived).
- `role_mult` is incumbent 1.0, own label 0.573, challenger 1.294, fitted on the curated set (XL).
- **Pack elasticity β = 0.7** *(assumption)*. Weighed and fresh foods price close to linearly in weight, and doubling a UK pack typically cuts £/kg by about 20%. The XL value of 0.296 was fitted on snacks and drinks.
- `unit_price_gbp_per_kg = price / pack`, with ml counted as g (XL assumption).

## 5. Lens grades (same transparent rule set)

All 12 lenses are computed by `scale_catalog.grade()`, imported rather than re-implemented. The formulas are in `curated_xl_rules.md` §6.

The per-category inputs for the **new** categories are:
- **Caps** for sugar, kcal, protein and fibre: the 95th percentile of the category's OFF candidate pool (data-derived; floors of 2 g, 30 kcal, 5 g and 3 g). XL categories keep their curated caps.
- **Unit-price band** for the frugal lens: the 5th–95th percentile of the category's (assumed) £/kg.
- **Serve thresholds:** `SERVE_NEW` *(assumption: UK pack-format conventions)*, e.g. food to go 250/400 g, cheese 50/250 g, water 500/1000 ml.

## 6. Physical pack size (for shelf filling)

Each product gets `width_cm` (the **facing** width), `height_cm`, `depth_cm` and `dims_source`.

`dims = reference pack (w,h,d at ref g/ml) × (pack/ref)^(1/3)`, clipped to 0.55×–2.0×. *Assumption: isometric scaling.* The reference packs (`DIMS`, `DIMS_SUB`) are typical UK formats, not measurements: a 500 ml bottle at 6.5×21×6.5 cm, a 2 L milk at 11×24×11 cm, a 6-egg box at 16×7×10 cm, a sandwich wedge at 8×14×12 cm, and so on. An unknown pack size gives the reference size.

## 7. Store formats: a real UK floor plan, not a grid

**Layout logic** (`adjacency.source` in every config; *assumption: standard UK grocery layout as used by the large multiples, not a cited planogram*):

```
                      back of house: stockroom (2 staff doors) + goods-in dock (back-right)
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │ bakery │ meat & poultry │ fish │ cheese & deli │ dairy & eggs │  … chilled racetrack (back wall) │
 │ (back- │──────────────────────── racetrack 3.5 m ─────────────────────────────────│ ready  │
 │  left) │   [promo/seasonal floor if the chilled run needs more wall]              │ meals  │
 │────────│   back bank:  aisles 1 … 18 (numbered left→right, end caps both ends)    │ chilled│
 │ fruit  │──────────────────────── cross aisle 3 m ─────────────────────────────────│ desserts│
 │ & veg  │   front bank: aisles 19 … 36 (… frozen, BWS at the front-right)          │ (right │
 │ tables │──────────────────────── racetrack 3.5 m ─────────────────────────────────│  wall) │
 │flowers │ food to go · meal deal │ ═══ checkout rail ═══ 10 staffed tills │ 20 self-checkouts │
 │ café   │ E1 (main entrance)     X0+gates                              X1+gates    E2 │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
 z=0 front wall
```

The walk order is:
1. entrance, then fruit & veg plus flowers. *Assumption:* fresh, low-decision products come first; this is Underhill's "decompression zone" idea.
2. the in-store bakery.
3. the chilled perimeter "racetrack": the back wall left to right, then down the right wall.
4. the numbered centre-store ambient aisles.
5. **frozen towards the end**, to limit time out of the freezer. This is the same rule as `store_xl` `layout_notes`.
6. **beer, wine & spirits** in the highest-numbered aisle at the front-right, next to the tills, where age checks happen.
7. the checkout bank across the front.
8. exits with EAS security gates. The café is by the main entrance.

**Coordinate system.** All three configs use metres:
- The origin is the front-left outside corner. x runs to the right and z towards the back.
- The front wall (z=0) holds the entrances, exits and checkouts. *This differs from the web/`store_xl` grid, where the tills sit behind the aisles.*
- Every unit has `x` and `z` (the centre of its shelf face), `facing` (±x/±z) and `length_m`.

**Centre aisles:**
- Superstore: 36 numbered aisles in two banks of 18. The back bank is numbered 1–18 and the front bank 19–36, so the last numbers (frozen, BWS) sit near the tills.
- Metro: 6 aisles. Express: 2 aisles.
- Each aisle has two sides (`L`, `R`) and each side is one unit.
- Sides are shared out among the centre departments (ambient, frozen, BWS) by largest remainder, in proportion to `Σ single-facing width / side capacity`, with at least 1 side each. A department may therefore share an aisle with its neighbour, and the aisle sign lists both.

**Perimeter fixtures** (produce tables, bakery, food to go, chilled wall) are sized by the rule `units = need_cm × min(space_to_range_ratio, F_PERIM = 4) / unit_capacity`, with at least enough rows for one per category. They are then laid along the walls in walk order.

The ratio is set by the centre store, and the cap of 4 is an *assumption*: without it the chilled racetrack would be about 165 m long. As a result, perimeter facings average about 4 and centre facings about 7.

BWS gets exactly **1 side**, because 18 alcohol-free SKUs cannot fill more.

If the chilled run is longer than the back wall plus the right wall, the store is made deeper. The extra depth becomes **promo/seasonal floor** (`footprint_m.promo_seasonal_floor_depth_m`), as in real Extra-format stores.

**Geometry** (`geometry` in the config; all *assumption*):

| element | size |
|---|---|
| walkway | 2.2 m (two trolleys pass) |
| gondola side | 0.6 m |
| racetrack | 3.5 m |
| cross aisle | 3.0 m |
| end cap | 0.6 m |
| wall multideck | 1.1 m |
| front band (checkouts, lobby, café) | 14 m |
| back of house | 12 m |

**Fixtures** (`fixtures` in the config; all *assumption*, UK shopfitting module conventions rather than a cited standard):

| fixture_type | rows | bay | shelf depth | notes |
|---|---|---|---|---|
| `gondola` | 5 | 100 cm | 45 cm | centre aisles |
| `multideck_fridge` | 5 | 125 cm | 50 cm | open chilled, `fridge:true` |
| `wall_chiller` | 5 | 125 cm | 50 cm | food to go / meal deal, express drinks |
| `freezer_doors` | 5 | 75 cm (one glass door) | 60 cm | `freezer:true`, `doors` |
| `produce_tables` | 3 tiers | 120 cm (2 crates) | 40 cm | tables and crates, **not shelves** |
| `bakery_counter` | 4 | 100 cm | 40 cm | bread racks + counter |

**Why the aisles are short (honest).** A real superstore ranges about 25–40k SKUs (*assumption*) on aisles of about 20 m. Ours ranges 2,638, so a centre side is 3 bays (3 m), and the mean is still 5.7 facings per SKU in the superstore. Longer aisles would multiply facings proportionally. `FORMATS[...]["bays_per_side"]` lengthens the aisles, and facings scale with it.

### New config keys (`store_xl.config.json` schema, extended)

| key | meaning |
|---|---|
| `format`, `coordinate_system`, `footprint_m` | format id; axes; w × d, sales m², promo-floor depth |
| `centre_aisles` | number of numbered centre aisles. `aisles` is kept for the schema: perimeter units get pseudo-aisle numbers after the centre ones and `aisle_number: null` |
| `units[]` | Extra fields: `department`, `aisle_number`, `zone` (produce / bakery / food_to_go / perimeter / centre / frozen / bws), `fixture`, `fixture_type`, `rows`, `bays`, `bay_width_cm`, `shelf_width_cm`, `shelf_depth_cm`, `row_clear_cm`, `doors`, `categories` (per row), `perimeter`, `wall`, `facing`, `length_m`. Units keep `id`, `aisle`, `side`, `category` (majority category), `fridge`, `freezer`, `x` and `z` |
| `departments[]` | `id`, `name`, `zone {x0,z0,x1,z1}` floor rectangle, `zone_kind`, `floor_color` (hint), `sign_text`, `aisle_numbers`, `fixture_type`, `categories`, `units`, and `sub_zones` (flowers inside fruit & veg) |
| `aisle_signage[]` | One overhead sign per numbered aisle: `sign_text` ("12 · pasta, rice & tins · cooking sauces & condiments"), categories, departments, x, z, hang height |
| `end_caps[]` | One promo bay per gondola-run end facing a racetrack or cross aisle. The bay is 1.2 m × 5 rows. Its `planogram` is a secondary placement of the top 3 eye-row lines (by OFF scans) from the adjacent aisle, filled by width. End caps are not in the contract planogram, and their stock is not counted separately |
| `entrances[]`, `exits[]`, `security_gates[]` | Exits have EAS pedestals either side |
| `checkouts[]`, `checkout_counts` | See below |
| `cafe` | `tables`, `table_positions`, `seats[]` (4 per table), `counter`, `zone`. Superstore only |
| `stockroom`, `goods_in` | Back of house, staff doors and dock doors |
| `walls[]` | Exterior and stockroom-partition segments, with gaps at the doors |
| `dividers[]` | End panels between neighbouring wall departments, and the checkout rail |
| `meal_deal` | Stand units, eligible codes by main/snack/drink, and the £3.85 price (source below) |
| `fixtures`, `geometry`, `adjacency`, `stock_rules`, `derivation` | Every rule and number above, with its source |

`checkout_counts`:
- **Superstore, 10 staffed:** from `params.json checkout_lanes_needed_example`, i.e. about 10 lanes at the Saturday 11:00 peak (Gruen & Corsten 2008 + DfT NTS).
- **Superstore, 20 self:** *assumption:* 2 per staffed lane, with one attendant per about 5 kiosks (params).
- **Express 2+4, metro 4+8:** *assumption.*

`meal_deal`:
- The structure is **main + snack + drink**, from `data/sales/uk_bestsellers.csv` (Tesco Clubcard Unpacked #1 main/snack/drink) and r/CasualUK 1bc79kh.
- Eligibility depends on category plus single-item size (`MD_SNACK`, `MD_DRINK`; *assumption*), e.g. crisps ≤ 55 g and drinks ≤ 500 ml.
- The £3.85 price comes from `data/personas/lens/meal_deal_office.json` budget_source.

### Ranges per format

- **superstore:** the whole catalog.
- **metro:** *assumption:* 40% of each role (incumbent, own label, challenger) within each category, by popularity, which keeps the role mix.
- **express:** the `EXPRESS_QUOTA` count per category. *Assumption:* the author's convenience-range estimate of about 330 lines; IGD/Kantar range data was not reachable. Lines are ranked by `0.5·popularity + 0.5·meal_deal_office lens score`.

In both cases, popularity = `log1p(OFF scans)` normalised within the category, with OFF scans used as a popularity proxy.

Express merges departments onto fewer fixtures (`EXPRESS_DEPTS`): one chilled drinks wall, one dairy-cheese-deli wall, one ready-meals-and-desserts wall, two grocery aisles (snacks; food cupboard) and a wall freezer by the tills. *Assumption: UK convenience layout.* Metro puts the 8 alcohol-free SKUs in the drinks aisle, because 8 lines cannot fill a BWS bay.

## Results (last run)

**Catalog:** 2,638 SKUs across 36 categories.

| split | counts |
|---|---|
| curation | 144 curated + 336 auto_xl (the XL base, unchanged) + 2,158 auto_superstore |
| role | 1,057 challenger / 884 incumbent / 697 own label |
| per category | XL categories 65 each; new categories 80 each, except `low_no_alcohol` at 18 (the whole clean pool) |

**Formats:**

| format | units | slots | SKUs placed | facings (mean) | fill ratio mean / min / p5 | footprint |
|---|---|---|---|---|---|---|
| express | 12 | 57 | 343 / 343 | 3.7 | 0.983 / 0.935 / 0.957 | 22 × 26 m |
| metro | 25 | 120 | 1,053 / 1,053 | 3.5 | 0.988 / 0.942 / 0.968 | 40 × 27 m |
| superstore | 107 (72 centre sides + 35 perimeter) | 519 | 2,638 / 2,638 | 5.7 | 0.986 / 0.932 / 0.957 | 91 × 44 m, incl. 9.3 m promo floor |

`python scripts/scale_superstore.py` prints the full summary.

## 8. Planogram: shelves fully filled

1. **Rows to categories.** Within a department, in walk order, each category gets rows in proportion to its total single-facing width (largest remainder, at least 1). Rows are filled sequentially unit by unit, top to bottom (sequential blocking).
2. **Products to rows.** The rows a category gets are balanced first: every row gets at least `floor(n / rows)` SKUs, so no shelf is left empty, and none gets more than `ceil(n / rows)`. Within that, each product goes to the first row that fits it, by role preference:

   | role | row order |
   |---|---|
   | incumbent | eye (2), middle, top, lower, bottom |
   | own label | lower, bottom, middle, eye, top |
   | challenger | top, middle, eye, lower, bottom |

   *Assumption:* the same convention as `store_xl`, extended to 5 rows. A product must also fit at 1 facing.
3. **Facings fill.** Every SKU starts at 1 facing. A facing is then repeatedly added to the SKU with the lowest `facings / weight` that still fits the remaining width. The weights are incumbent 2, own label 1.5 and challenger 1 (*assumption: leaders hold more facings*), with at most 14 facings (*assumption*). The result is `Σ(facings × width_cm) ≤ shelf width`, and the leftover gap is smaller than the narrowest SKU on that shelf.
4. **Stock.** `capacity = facings × floor(shelf_depth_cm / depth_cm)`, and `stock` starts at capacity, i.e. the store opens fully faced up.
5. **Notice rows.** Rows 3–5 use the `bottom` notice alpha. This is the same conservative mapping as `store_xl`, because `sim/notice.py` has alphas only for top, eye and bottom.

## 9. stores.json

| store | context | format | customers/week |
|---|---|---|---|
| Ludgate Lane Express | office district | express | 4,000 (params range, Gruen & Corsten smaller format) |
| Quad Express | university campus | express | 4,000 |
| Northgate Metro | high street | metro | 10,900 (params `store_customers_per_week`) |
| Kingsmead Superstore | retail park | superstore | 20,000 (*assumption:* ~2× the params supermarket example) |

All four names are fictional.

- **Footfall** = `customers_per_week × NTS day share × NTS hour share × multiplier`. The day and hour shares are referenced from `params.json`; the per-store hour and day multipliers are labelled assumptions anchored on the sourced NTS peaks (lunch, commute at 17:00, school escort at 15:00).
- **Mission mix.** The baseline is **derived**: `params.mission_mix_by_daypart` (itself an assumption, low confidence) weighted by the NTS hour shares in each daypart window. Each store then applies labelled multipliers and renormalises. The mission keys are the params keys; `treat` covers the family after-school trip.
- **Persona weights** = `mission_mix[persona.mission] / (number of personas with that mission) × multiplier`, renormalised. `persona.mission` comes from `data/personas/lens/*.json`. The multipliers are labelled assumptions with their reasoning, e.g. campus `frugal ×2` and `upf_avoider_parent ×0.2`, and retail park `upf_avoider_parent ×1.6`.

## 10. Known gaps (honest)

- No alcohol, wine or baby food is in the OFF UK pull. BWS is alcohol-free only.
- Prices and pack dimensions for the new categories are assumptions, not scraped or measured. Every SKU's `price_source` and `dims_source` says so.
- OFF `scans` is a popularity proxy, not sales. Sales data (`uk_bestsellers.csv`) only decides incumbent roles.
- The range is about 10% of a real superstore's, so aisles are short and facings are higher than in a real store.
- The new configs use real-store coordinates (tills at the front). The current web `layout.ts` derives its own grid from `aisle`/`side`, and reads `checkouts` as `{staffed, self}`, not the `store_xl` list. Rendering the real floor plan needs the web to read `x`, `z`, `facing` and `departments`.

# biscuits_chocolate: selection and lens-grading rules

Reproduce with `python3 data/products/curated/biscuits_chocolate_build.py`. It reads `data/products/uk_products.parquet` (Open Food Facts UK pool) and writes `biscuits_chocolate.json`. Every grade is a closed-form formula over OFF fields plus the price/role inputs below. There are no hidden weights. The lens weights themselves are **assumption: hand-set by the curator to express each archetype's stated priority (see CONTRACT.md lens list); to be replaced by persona-file `lens[].weight` when the sim joins them**.

## Shelf sets (3 rows x 4 SKUs, each row = incumbent + challenger + own-label)
| row | theme | incumbent | challenger | own-label |
|---|---|---|---|---|
| 1 top | everyday biscuits | McVitie's Digestives 5000168036755, Lotus Biscoff 5410126716016 | Nairn's Stem Ginger Oat 0061232201047 | Tesco Bourbon Creams 5054402919854 |
| 2 eye | chocolate bars | Cadbury Dairy Milk 7622300845759 | Tony's Chocolonely Milk 8717677339914, Montezuma's Happy Hippy 74% organic 5060719920162 | Tesco Dark Milk 5059697710001 |
| 3 bottom | better-for-you / free-from | belVita Soft Bakes 7622210445346, Snickers Hi Protein Low Sugar 5056357909546 | Gullón Sugar Free ZERO choc chip 8410376058116 | Sainsbury's Free From choc chip cookies 00227643 |

Selection criteria: has an OFF image, sold in UK (OFF `stores`/UK barcode/brand), and as much spread as possible across NOVA, additives, organic, vegan, gluten-free, protein, sweeteners, palm oil, eco-score, price and role. Role is **assumption: market position** (incumbent = long-established mass brand; challenger = smaller/newer brand; own_label = retailer brand).

## Derived fields (the pull's `palm_oil_n` and `sweeteners` columns were empty)
- `palm_oil` = 1 if OFF `ingredients_analysis` has `en:palm-oil`, 0.5 if `en:may-contain-palm-oil`, else 0.
- `sweeteners` = OFF additives in E420, E421, E950–E969 (polyols and intense sweeteners, EU Reg. 1333/2008 sweetener class).
- `organic` = OFF label `en:organic`. `vegan` = OFF analysis `en:vegan` (unknown counts as not vegan).
- `gf_label` = OFF label `en:no-gluten` or `en:suitable-for-celiacs`. `gluten` = `en:gluten` in OFF allergens, OR (wheat/barley/spelt/oat/flour in ingredients_text AND no gf_label).
- Maps (assumption: linear spacing of ordinal grades): ecoscore a+/a=1, b=.8, c=.6, d=.4, e=.2, f=0, unknown=.3. Nutri-Score a=1, b=.75, c=.5, d=.25, e=0. NOVA 1=1, 2=.75, 3=.5, 4=0.
- `price_per_100g` = price_gbp / pack grams (OFF `quantity`). Prices are **assumption: typical UK non-promo shelf price, not verified live** (WebFetch of retailer pages was not attempted, because retailer sites block bots).

## Lens formulas (each clipped to 0–1)
| lens | formula |
|---|---|
| eco_low_chemical | 0.4·(1−min(additives_n,10)/10) + 0.3·eco_map + 0.2·organic + 0.1·(palm_oil=0) |
| upf_avoider_parent | 0.5·nova_map + 0.3·(1−min(additives_n,5)/5) + 0.2·(no sweeteners) |
| glp1_small_appetite | 0.35·min(protein/20,1) + 0.25·min(fibre/6,1) + 0.25·(1−min(sugars/50,1)) + 0.15·(pack ≤100 g or single-serve) |
| frugal_unit_price | 1 − (£/100g − 0.20)/(2.50 − 0.20). Anchors are an assumption: £0.20/100g is own-label biscuit floor, £2.50/100g is premium bar ceiling |
| protein_gym | 0.7·min(protein/30,1) + 0.3·(1−min(sugars/40,1)) |
| protein_sceptic_gimmick_reactant | 0.4·(no protein/zero/sugar-free/low-sugar/slim claim in name or OFF labels) + 0.3·(no sweeteners) + 0.3·(1−min(additives_n,5)/5) |
| habit_loyalist_shrinkflation_angry | 0.6·familiarity(incumbent 1, own_label .6, challenger .2) + 0.4·(1−min(£/100g/2.50,1)). We have no pack-size history in OFF, so value per 100 g stands in for shrinkflation anger (assumption) |
| meal_deal_office | 0.5·portable(single-serve 1, ≤110 g bar .6, 180 g bar .4, sharing pack .2) + 0.3·(1−min(max(price−1,0)/3,1)) + 0.2·nutriscore_map |
| vegan_ethical | 0.5·vegan + 0.3·min(#ethics labels,2)/2 + 0.2·(palm_oil=0). Ethics labels are fair-trade, fairtrade-international, rainforest-alliance, organic, cocoa-life, sustainable-palm-oil, B-corp, soil-association-organic |
| allergen_coeliac | 0 if gluten; 1 if gf_label; 0.4 if no gluten cereal but no GF label (may-contain risk unknown) |
| ai_delegator | 0.4·nutriscore_map + 0.3·min(OFF completeness,1) + 0.3·(1−min(additives_n,10)/10). Assumption: an LLM shopping agent ranks on structured, complete, "healthier" data |
| novelty_seeker_tiktok | 0.5·role_novelty(challenger 1, incumbent .3, own_label .2) + 0.25·(distinctive flavour/format word in name: ginger, orange, geranium, caramel, biscoff, 74%, hi protein, free from, soft bakes) + 0.25·(1−min(OFF scans/250,1)). Fewer scans is used as a proxy for less mainstream (assumption) |

Each product's `lens_grades[lens].why` lists the exact OFF values used.

## Known data caveats (traceable, not hidden)
- McVitie's Digestives OFF `energy-kcal_100g` = 2092.9, which is the kJ value entered in the kcal field. Energy is not used in any grade.
- Snickers Hi Protein OFF `allergens` lists only milk, but ingredients_text contains peanuts. Its OFF analysis says non-vegetarian (collagen).
- Gullón Sugar Free ZERO: ingredients_text has OCR errors ("when flour" = wheat flour), and `quantity` is missing, so we use 150 g from sibling 8410376065220. Treat it as gluten-containing.
- belVita Soft Bakes: OFF quantity is "5x". We use 5×50 g = 250 g (assumption). Tony's OFF allergens field is empty, but the product contains milk (dried whole milk) and soya.

# plant_milk_dairy_alt: curation + lens grading rules

Source pool: `data/products/uk_products.parquet` (Open Food Facts UK). Every input below is an OFF field, or a curation field (`role`, `price_gbp`) with its own `price_source`. Weights are **assumption: hand-set, equal-ish split across the attributes each persona says it cares about**. They are kept in round numbers so a judge can recompute any grade by hand.

## Shelf rows (one "set" per row)
| row | theme | incumbent | challenger | own_label |
|---|---|---|---|---|
| 1 top | oat drinks | Oatly Whole Oat 7394376620713 | Minor Figures Barista Oat 5060406080223, Rude Health Oat Organic 5060120281975 | Tesco Oat Drink 5057753940317 |
| 2 eye | cow milk & protein | Cravendale Semi-Skimmed 2L 5000181024043, Arla B.O.B 2L 5000246728183 | Mighty Pea Protein Oat 5060674960098 | Tesco Semi-Skimmed 1 pint 5031021057952 |
| 3 bottom | soya & almond | Alpro Soya Original 5411188083191, Alpro Almond Original 5411188110835 | Plenish Organic Soya 5060362072263 | Aldi Everyday Essentials Soya 4088600574530 |

Each lens finds both a winner and a loser in this set: NOVA 1/3/4, additives 0 to 3, organic (4) vs not, vegan vs dairy, gluten-free label (Rude Health) vs oats carrying gluten, protein 0.25 to 4.6 g/100ml, eco-score a-plus to c, unit price £0.69 to £2.40/L, packs of 568ml, 1L and 2L, and a "new recipe" label (Aldi: "HULLED SOYA BEANS 7% (was 8%)", a shrinkflation-style change taken from OFF ingredients_text).
Known gaps: no SKU here has intense sweeteners or palm oil. The OFF `sweeteners` and `palm_oil_n` fields are null for the whole pool, so palm status is taken from the OFF `analysis` tag `en:palm-oil-free`. Plain milks do not use sweeteners, so the category is honest about this.

## Shared maps (assumption: linear ordinal mapping of OFF grades)
- `addS = 1 - min(additives_n,5)/5` (OFF additives_n; 5 is about the maximum seen in this category in the pool)
- `novaS`: NOVA 1→1.0, 2→0.75, 3→0.5, 4→0.0 (OFF nova)
- `ecoS`: a-plus 1.0, a 0.85, b 0.65, c 0.45, d 0.25, e 0.1, unknown 0.4 (OFF ecoscore)
- `nsS`: a 1.0, b 0.8, c 0.55, d 0.3, e 0.1 (OFF nutriscore)
- `organic` = 1 if any OFF label contains "organic" or the name says organic
- `palm_free` = 1 if OFF analysis contains `en:palm-oil-free`
- `vegan` = 1 for `en:vegan`, 0.5 for maybe or unknown, 0 for `en:non-vegan` (OFF analysis)
- `protein_claim` = 1 if "protein" appears in the name, in a label (e.g. `en:rich-in-plant-protein`) or as "enriched with protein" in the ingredients
- `fam = min(ln(1+scans)/ln(700), 1)`: OFF scans, used as a familiarity proxy. 700 is roughly the top-scanned milk alternative in the pool.
- `allergens_d` = OFF allergens, plus `en:milk` for products in the en:milks category when OFF left the field blank, plus `en:soybeans` when the ingredients list soya. These are derived values, and each `why` says so.
- unit price `£/L = price_gbp / volume_l` (volume from OFF quantity. Mighty Pea's quantity is missing, so it is an assumption: 1L carton)

## Lens formulas (score clipped to 0..1)
| lens | formula | OFF fields |
|---|---|---|
| eco_low_chemical | 0.35·addS + 0.30·ecoS + 0.20·organic + 0.15·palm_free | additives_n, ecoscore, labels, analysis |
| upf_avoider_parent | 0.50·novaS + 0.30·addS + 0.20·(1 − min(sugars,5)/5) | nova, additives_n, sugars_100g |
| glp1_small_appetite | 0.50·min(protein/4,1) + 0.30·nsS + 0.20·pack (≤0.6L 1, ≤1L 0.5, else 0) | proteins_100g, nutriscore, quantity |
| frugal_unit_price | clip((2.50 − £/L)/2.00) | price_gbp, quantity. Anchors £0.50 and £2.50/L come from the spread between own-label and premium oat in the Reddit verbatim "Lidl's super cheap £1.09 oat milk is better than the £2.20 Oatly stuff" (https://www.reddit.com/comments/1bq1qcm) |
| protein_gym | 0.80·min(protein/5,1) + 0.20·protein_claim | proteins_100g, name, labels |
| protein_sceptic_gimmick_reactant | 0.50·(1 − protein_claim) + 0.25·addS + 0.25·novaS | name, labels, additives_n, nova |
| habit_loyalist_shrinkflation_angry | 0.50·role_h (incumbent 1, own_label 0.6, challenger 0.2) + 0.30·fam + 0.20·(1 − new_recipe) | scans, labels (en:new-recipe) |
| meal_deal_office | 0.50·(pack ≤ 0.6L) + 0.30·(price ≤ £1) + 0.20·barista | quantity, name |
| vegan_ethical | 0.60·vegan + 0.20·organic + 0.20·(B-Corp or Vegan Society label) | analysis, labels |
| allergen_coeliac | 0.70·gluten_safe + 0.30·(1 − min(#allergens_d,2)/2). gluten_safe: no-gluten label 1, oats or en:gluten without a GF label 0, otherwise 0.8 | labels, ingredients_text, allergens |
| ai_delegator | 0.40·completeness + 0.30·nsS + 0.30·min(#labels,6)/6. An agent can only reason over structured data that exists. | completeness, nutriscore, labels |
| novelty_seeker_tiktok | 0.60·role_n (challenger 1, incumbent 0.3, own_label 0) + 0.25·barista + 0.15·(1 − fam) | name, scans |

## Prices
None of the prices were fetched from a retailer page (the supermarket sites block scraping). Each `price_source` is an `assumption: typical UK RRP …` with its reason. The oat tier is cross-checked against the Reddit verbatim above (Oatly £2.20, own-label oat about £1.09). The sim should treat price as an editable lever, not a measured value.

## pack_copy
Built only from OFF labels, the OFF name, and the OFF ingredients and nutrition (e.g. "4.6g protein/100ml" from proteins_100g, "was 8%" from the OFF ingredients_text). Nothing is invented.

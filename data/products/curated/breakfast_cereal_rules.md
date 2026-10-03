# breakfast_cereal: curation and lens-grading rules

Source pool: `data/products/uk_products.parquet` (Open Food Facts UK). Every input below is an OFF field unless marked **assumption**. Output: `breakfast_cereal.json`.

## Shelf rows (3 sets of 4)
| row | theme | challenger | incumbent | own_label |
|---|---|---|---|---|
| 1 top | granola & muesli | Bio&Me Granola Super Nutty `5070000126579` (gut/prebiotic), Lizi's Low Sugar Granola `5060043225353` (vegan) | Jordans Organic Muesli `5010477348630` (NOVA 1, eco A) | Sainsbury's SO Organic Granola `01835588` (organic but **palm oil**) |
| 2 eye | everyday wholegrain | Nestlé Gluten Free Corn Flakes `5900020042538` (only GF-labelled SKU) | Weetabix `5010029000023`, Kellogg's Corn Flakes 1kg `5000127014084` | Tesco Wheat Biscuits `5000119117342` |
| 3 bottom | protein & kids | Surreal Chocolate `5070000313801` (37.5g protein, erythritol + stevia) | Weetabix Protein Crunch `5010029221091` (20g protein **and** 22g sugar), Kellogg's Krave Milk Choc `5059319015279` (7 additives, palm, Nutri-Score E) | Lidl Crownfield Multigrain Hoops `20425609` |

Selection criteria: has an image, high `scans`/`completeness` within brand, and maximum spread across the 12 lenses. The tensions are deliberate: organic + palm oil (SO Organic), "protein" + high sugar (Protein Crunch), gut-health claim on a NOVA 4 product (Bio&Me), and a near-identical own-label vs Weetabix pair (verbatim: "Weetabix, never any other brand" vs "My dad buys the aldi version… refuses to buy weetabix because of the price": https://www.reddit.com/comments/r2udam).

## Derived fields
- `ecoscore_map`, `nutriscore_map`: a-plus/a=1, b=.75, c=.5, d=.25, e=0, unknown=.5 (**assumption**: linear spacing of letter grades)
- `nova_map`: 1=1, 2=.75, 3=.5, 4=0 (NOVA, Monteiro et al. 2019, *Public Health Nutr* 22(5):936)
- `sweeteners`: count of OFF `additives` in {E950–E969 sweeteners}. The pool's `sweeteners` column is empty, so it is derived from the additive codes.
- `palm_oil`: 1 if `analysis` has `en:palm-oil`, .5 if `en:may-contain-palm-oil`, else 0. The pool's `palm_oil_n` column is empty.
- `organic`: `en:organic` in `labels`
- `vegan`: 1 if `en:vegan` in labels/analysis, .5 maybe-vegan, 0 non-vegan, .3 unknown (**assumption**)
- `unit_price` £/kg = `price_gbp` / pack g. **All prices are assumptions** (typical UK RRP 2025-26; retailer pages were not fetched) and are flagged in `price_source`.
- `scans_fam` = min(log10(scans+1)/log10(601), 1) (**assumption**: OFF scan count as a familiarity proxy; 600 ≈ the Weetabix maximum in the pool)

## Lens rules (score 0–1; the weights are **assumptions** set by hand to reflect each archetype's stated priorities in `research/05-personas.md`)
| lens | rule | OFF fields |
|---|---|---|
| eco_low_chemical | .4·(1−min(additives_n,10)/10) + .3·ecoscore_map + .2·organic + .1·(palm_oil==0) | additives_n, ecoscore, labels, analysis |
| upf_avoider_parent | .5·nova_map + .2·(1−min(additives_n,5)/5) + .15·(sweeteners==0) + .15·(1−min(sugars,25)/25) | nova, additives, sugars_100g |
| glp1_small_appetite | .4·min(protein,20)/20 + .3·min(fibre,10)/10 + .3·(1−min(sugars,25)/25). Rationale: protein and fibre density under small portions (Mozaffarian et al. 2025, joint advisory on nutrition with GLP-1 therapy, *Am J Clin Nutr*) | proteins_100g, fiber_100g, sugars_100g |
| frugal_unit_price | 1 − (clip(£/kg, 1.5, 15) − 1.5)/13.5 | price (assumption), quantity |
| protein_gym | .7·min(protein,30)/30 + .3·(1−min(sugars,20)/20) | proteins_100g, sugars_100g |
| protein_sceptic_gimmick_reactant | .35·(1−min(additives_n,5)/5) + .25·(sweeteners==0) + .2·nova_map + .2·(1−gimmick), where gimmick = name/labels contain protein\|gut\|prebiotic AND nova==4. Verbatim: "Weetabix came out with some protein Weetabix, you'd of had to eat the whole box to match a few tins of tuna" (https://www.reddit.com/comments/1tbf6zw) | additives, nova, name, labels |
| habit_loyalist_shrinkflation_angry | .6·(role==incumbent) + .25·scans_fam + .15·(pack ≥500g) | scans, quantity |
| meal_deal_office | .5·dry-snackable (name has granola/hoops/pillows/crunch/chocolate) + .3·min(protein,20)/20 + .2·nutriscore_map (**assumption**: cereal is not sold in meal deals, so this lens scores eat-from-the-pack desk snacking) | name, proteins_100g, nutriscore |
| vegan_ethical | .6·vegan + .2·(palm_oil==0) + .2·ecoscore_map | labels, analysis, ecoscore |
| allergen_coeliac | 1 if `en:no-gluten` label and no gluten allergen; 0 if gluten allergen or wheat/barley/oats/rye in ingredients_text without a GF label (Coeliac UK: only oats labelled gluten-free are safe); 0.2 if unknown | labels, allergens, ingredients_text |
| ai_delegator | .5·nutriscore_map + .3·completeness + .2·(1−min(additives_n,5)/5) (**assumption**: LLM shopping agents lean on structured, complete nutrition data and Nutri-Score) | nutriscore, completeness, additives_n |
| novelty_seeker_tiktok | .5·(role==challenger) + .25·(1−scans_fam) + .25·distinct_claim (protein ≥20, prebiotic, gluten-free or chocolate) | scans, proteins_100g, labels, name |

Each product's `lens_grades[lens].why` lists the exact field values used. Regenerate with the build script by re-running the selection on the parquet. Known data caveats: Jordans `5010477348630` and Weetabix Protein Crunch have French OFF ingredient text (they are the same barcodes as the UK packs). Lidl hoops carries the OFF `en:vegan` label but also lists a milk allergen (likely may-contain), so its vegan grade reflects the OFF label.

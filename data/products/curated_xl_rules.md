# catalog_xl: how the 5x store's 480 SKUs were picked and graded

Output: `data/products/catalog_xl.json` (480 products, 12 categories × 40). Built by `scripts/scale_catalog.py`. Re-running the script regenerates the same output from the same inputs. No LLM or Jev calls are made: this is selection plus arithmetic only.
Layout outputs: `data/store/store_xl.config.json`, `data/store/planogram_xl.json`.

## 1. What is kept and what is added

- **144 curated SKUs are kept byte-for-byte.** These are the 96 in `catalog.json` plus 12 each from `curated/{bakery_bread,frozen_icecream,hot_drinks,confectionery_sweets}.json`. Their hand-curated `lens_grades`, prices and roles come from the per-category `curated/*_rules.md`. The only change is one added field, `"curation": "curated"`.
- **336 auto SKUs** are added from `uk_products.parquet` (Open Food Facts, UK) and marked `"curation": "auto_xl"`. Every field is either the OFF field of the same name, a formula below, or a value marked `assumption:`.

## 2. Candidate filter (all OFF fields)

1. The record has an `image` (not an `/invalid/` URL), a non-empty `name`, `brand` and `ingredients_text`, and a non-null `sugars_100g`.
2. The name reads as English. It must not match the `FOREIGN` word list (`de|avec|mit|ohne|lait|chocolat|…`) and must not contain a run of 5 or more digits. Quantities in `oz` are rejected. *Assumption: shoppers read English UK pack copy, and the OFF UK pool contains EU and US imports.*
3. **Category** comes from OFF `categories` tags. Each category has an include set and an exclude set (`SELECTORS` in the script), and a product goes to the first category it matches, in priority order. A `NAME_REJECT` regex then removes products whose name contradicts the tag, e.g. "Salad Cream" tagged `en:meals`, or a coconut cooking milk tagged as a plant milk. *Assumption: OFF tags are crowd-sourced and noisy. These regexes only remove candidates; they never add one.*
4. **Not already curated** (deduplicated by barcode).

## 3. Ranking and picking (per category, greedy)

- **quality** = `log1p(OFF scans) + 2·OFF completeness + 1·UK signal`. The UK signal is a GS1 UK `50…` barcode, or OFF `stores` listing a UK grocer. *Assumption: these weights let a UK-sold, well-documented SKU beat a heavily scanned import.*
- **variety bonus** = Σ over bins of `1/(1 + count of SKUs already in that bin)`. The bins are NOVA, additives (0 / 1–3 / 4+), organic, vegan, sugar (<5 / <20 / ≥20 g) and a category subtype (×1.5), e.g. biscuit vs chocolate, or cola / energy / kombucha / iced tea / flavoured water. The curated SKUs are counted first, so the added ones fill gaps.
- **pick score** = `quality/max_quality + 0.6·variety`.
- **Near-duplicates are skipped.** A candidate is skipped when it has the same brand and its normalised name (brand words, sizes and punctuation removed) is at least 0.8 similar (difflib) to a product already chosen. It is also skipped when the normalised name is identical and the brand is at least 0.6 similar.
- **Brand cap:** at most 4 SKUs per brand (first word of the brand) per category. *Assumption: this keeps variety.*
- **Role quota for the 28 added per category:** about 40% challenger, 35% incumbent, 25% own_label. *Assumption: this is close to the curated mix (66/48/30) but with more own-label, as on real UK shelves.* If a role's pool runs out, the remaining places are filled from any role.

## 4. Role (string match on OFF `brands`)

| role | rule | `role_source` text |
|---|---|---|
| own_label | brand contains tesco, sainsbury's, asda, aldi, lidl, morrisons, co-op, m&s / marks & spencer, waitrose, iceland or ocado | "brand contains UK retailer name …" |
| own_label | brand is a retailer-exclusive sub-brand (Freeway, Crownfield, Milbona, Vemondo, Moser Roth, Specially Selected, Acti Leaf, …) | "assumption: … is a retailer-exclusive sub-brand" |
| incumbent | brand is in `data/sales/uk_bestsellers.csv` top lists (the `other_*` challenger watch-lists are excluded). A whole-word match is used, or a match on the first word when that word is at least 4 letters and not generic | "appears in data/sales/uk_bestsellers.csv" |
| incumbent | brand is an incumbent in the curated set | "is an incumbent in the curated set" |
| incumbent | long-standing leaders in the 4 categories that the sales file does not cover (Warburtons, Hovis, Ben & Jerry's, Yorkshire Tea, Haribo, …) | "assumption: … long-standing UK category leader" |
| challenger | everything else | |

## 5. Price: `assumption: category median RRP band by role`

The curated prices are themselves curator assumptions (see each `curated/*_rules.md`). We fit one log-linear model on the 131 curated SKUs whose pack size parses:

`log(price) = a_category + β·log(pack / median_pack_category) + γ_role`

| fitted (see `store_xl.config.json → derivation.price_model`) | value |
|---|---|
| β (pack-size elasticity) | 0.296 (prices rise much more slowly than pack size) |
| role multiplier: incumbent / own_label / challenger | 1.00 / 0.573 / 1.294 |
| base price per category (incumbent, median pack) | e.g. bread £1.88, cereal £3.08, soft drinks £1.11, ice cream £4.40 |

For each new SKU, `price = base[cat] × role_mult[role] × (pack/median_pack)^β`. The price is then clipped to the curated min–max for its category and snapped to a `.x4`/`.x9` ending. When the pack size is unknown, `pack/median_pack` is set to 1. Every auto SKU's `price_source` spells out its own numbers. `unit_price_gbp_per_kg = price / pack g (or ml)`, where ml counts as g (*assumption: density ≈ 1, used only for shelf maths*).

## 6. Lens grades: one shared rule set for all auto SKUs

This is reverse-engineered from the curated rule files. The soft_drinks template is the most common one: bakery, frozen and confectionery copy it, changing only the scales. Every `why` names the OFF field it used. All scores are clipped to 0–1.

**Feature maps (shared)**
- `add_s = 1 − min(additives_n,10)/10`
- `eco_map`: a-plus 1, a .9, b .75, c .5, d .25, e .1, f 0, unknown .5
- `nutri_map`: a 1, b .75, c .5, d .25, e 0, unknown .5
- `vegan_s`: label en:vegan 1, analysis en:vegan .8, en:maybe-vegan .5, otherwise .3
- `palm_free`: analysis en:palm-oil-free or "no palm oil" → 1; "palm" in ingredients → 0; otherwise .5
- `sweeteners` = max(count of sweetener E-numbers e950–e969/e420/e421 in OFF additives, count of sweetener words in ingredients_text). This is the curated derivation; the OFF `sweeteners` column is null.
- `markers` = azo dyes (e102/e104/e110/e122/e124/e129, from the soft_drinks and confectionery rules) ∪ emulsifiers and thickeners (e471/e472e/e481/e482/e461/e464/e466/e433/e407/e322i, from the bakery and frozen rules)
- `claims` = how many of {protein, gut/pre/probiotic/kombucha/kefir, high fibre, vitamins/energy/adaptogen/superfood, low/zero sugar, keto/skinny/light} appear in the name, labels or ingredients
- `trend` = name or labels match protein | prebiotic | kombucha | oat | plant-based | vegan | gluten-free | keto | matcha | mochi | sour | sourdough | collagen | ginger | turmeric | lentil | chickpea | seaweed | yuzu | biscoff | pistachio | …
- `mixed` = sugars > 0.5 g AND a sweetener is present (the sign of a sugar-levy reformulation)
- `mainstream` = role incumbent/own_label, or OFF `stores` names a major UK grocer
- **Per-category scales, all data-derived:** each cap is the maximum value among that category's curated SKUs (`derivation.scales_from_curated`). `sugar_s = 1 − min(sugar, sugar_cap)/sugar_cap`, and `kcal_s` works the same way. `protein_s = min(protein/protein_cap,1)`; `fibre_s = min(fibre/fibre_cap,1)`.
- **Unit-price band:** the curated min–max £/kg (or £/L) for the category (`derivation.unit_price_band_gbp_per_kg`). `unit_s = 1 − (clip(up, lo, hi) − lo)/(hi − lo)`, and an unknown pack gives .5.
- **Serve:** single-item size ≤ small → 1, ≤ medium → .5, otherwise 0 (unknown .5). The thresholds are in `SERVE`. soft drinks 330/500, confectionery 50/150, frozen 125/500 and plant milk 600/1000 come from the curated rules. The rest are *assumption: UK pack-format conventions*: crisps/bars/biscuits 50/150, cereal 60/375, yoghurt 150/500, soup/meals 400/600, bread 100/450 and hot drinks 30/250.

**Lens formulas**
| lens | formula |
|---|---|
| eco_low_chemical | .4·add_s + .3·eco_map + .2·organic + .1·palm_free |
| upf_avoider_parent | .4·(4−nova)/3 + .2·add_s + .2·(no sweeteners) + .1·(no markers) + .1·sugar_s |
| glp1_small_appetite | .35·sugar_s + .25·serve + .2·fibre_s + .2·kcal_s |
| frugal_unit_price | .85·unit_s + .15·own_label |
| protein_gym | .6·protein_s + .2·sugar_s + .2·kcal_s |
| protein_sceptic_gimmick_reactant | .6·(1 − min(claims,3)/3) + .2·(no sweeteners) + .2·add_s |
| habit_loyalist_shrinkflation_angry | .5·incumbent + .3·(not mixed) + .2·unit_s |
| meal_deal_office | .4·serve + .3·mainstream + .3·sugar_s |
| vegan_ethical | .6·vegan_s + .2·organic + .2·(any ethical label: carbon/b-corp/fairtrade/climatepartner/vegan-society/vegetarian-society/soil-association/fsc/rainforest/utz) |
| allergen_coeliac | gluten word (wheat/barley/rye/spelt/gluten/malt, where malt is not followed by o or i) in the ingredients, or allergen en:gluten → .1; label en:no-gluten or category en:products-without-gluten → 1.0; otherwise .7; −.1 if the ingredients are missing |
| ai_delegator | .4·completeness + .4·nutri_map + .2·(OFF stores known) |
| novelty_seeker_tiktok | .55·challenger + .45·trend |

The grounding (papers and Reddit verbatims) for each formula is the same as in the curated rule files it was copied from: `soft_drinks_rules.md`, `bakery_bread_rules.md`, `frozen_icecream_rules.md` and `confectionery_sweets_rules.md`.

**Known differences from the curated graders (honest):** the curated cereal, yoghurt, crisps and plant-milk files used other weights, e.g. `upf = .5·nova + .3·add + .2·short`. Their 48 SKUs keep those grades. Scores are therefore comparable *within* the auto set and *within* each curated category. Across the two sets the scale may differ; that difference has not been measured.

## 7. Shelf, facings and stock (planogram_xl.json)

- **Layout:** 12 aisles × 2 sides = 24 units × 4 rows (top, eye, lower, bottom) × 5 products = 480. Each aisle holds one category on both sides.
- **Curated SKUs** stay on the L unit in their curated row: row 1 → r1 (top), row 2 → r2 (eye), row 3 → r4 (bottom).
- **Auto SKUs** fill rows by role preference. Incumbents go eye → lower → top → bottom; own-label goes bottom → lower; challengers go top → lower. *Assumption: common UK merchandising convention.*
- **Facings:** curated SKUs keep their `planogram.json` facings (all 1). Auto incumbents get 2 and everything else 1. *Assumption: category leaders typically hold more facings.*
- **Capacity** = facings × depth. Depth is 8 deep for items ≤150 g/ml, 6 for ≤500, 4 for ≤1000 and 3 for anything larger or unknown; freezers use ×0.75. *Assumption: a standard 0.45 m shelf depth divided by pack depth.* **Stock** starts at capacity.

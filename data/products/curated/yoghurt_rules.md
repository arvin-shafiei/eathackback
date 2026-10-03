# Yoghurt unit: curation and lens-grading rules

Output: `data/products/curated/yoghurt.json`. Build script logic is reproduced here so every score can be recomputed by hand.
Source pool: `data/products/uk_products.parquet` (Open Food Facts UK). Every product field is an OFF field unless it is marked otherwise.

## Shelf rows (3 sets, 12 SKUs)
| row | theme | incumbent | challenger | own_label |
|---|---|---|---|---|
| 1 top | natural & strained | FAGE Total 0% 450g (5201054017418) | Yeo Valley Organic Greek Recipe 0% 450g (5036589253471), Arla Skyr creamy natural 450g (4016241050199) | Tesco Greek Style 500g (5000462416772) |
| 2 eye | flavoured everyday pots | Müller Corner Vanilla Choc Balls 124g (4025500277031), Müllerlight Toffee 160g (4025500243579), Activia Strawberry 4x115g (5060360506128) | Arla Protein Strawberry 200g (6413300018042) | none (the row has only 3 incumbents and 1 challenger) |
| 3 bottom | gut health & plant | Alpro Greek Style Plain 400g (5411188121213) | Biotiful Kefir Original 500ml (5060337220415), Oatly Oatgurt Greek 400g (7394376617164) | ASDA Plain Soya 500g (5054781763529) |

Roles are a curation judgement: incumbent means a long-standing UK category leader brand, challenger means a newer or premium-niche brand, and own_label means a retailer brand. The roles do not come from OFF.

## Prices
11 of 12 prices come from trolley.co.uk listings fetched on 2026-10-03, and each product's `price_source` holds the URL. Two have caveats:
- Yeo Valley: the price is from the closest current listing ("Organic Super Thick 0%"). It is an assumption that this is the same 0% organic strained line.
- ASDA soya: no listing was found, so the price is an assumption (the upper bound of the own-label £0.95 to £1.15 range on the trolley search page).

## Derived fields (the pool's OFF `sweeteners`, `palm_oil_n`, `recycling` and `ingredients_n` columns are empty)
- **sweeteners**: count of OFF `additives` in the EU sweetener range E950 to E969 (e.g. e951 aspartame, e950 acesulfame K, e960a steviol glycosides).
- **palm**: from OFF `analysis`. `palm-oil-free` gives 0, `may-contain-palm-oil` or unknown gives 0.5, and `palm-oil` gives 1.
- **ingredients_n**: count of the top-level comma-separated items in OFF `ingredients_text`, with bracketed sub-ingredients and allergy-advice text removed.
- **organic**: `en:organic` in OFF `labels`. **vegan**: `en:vegan` in `analysis`/`labels` gives 1, `en:maybe-vegan` gives 0.5, and anything else gives 0.
- **pack_g**: grams per pack, from OFF `quantity` or the retailer listing (Activia comes as 4x115g, so 460).
- Map tables (assumption: linear, ordinal scales spread evenly):
  - `ecoscore_map` a-plus=1, a=.9, b=.75, c=.5, d=.3, e=.1, unknown=.4. Unknown is set just below the middle so that missing data is not rewarded.
  - `nutri_map` a=1, b=.75, c=.5, d=.25, e=0.
  - `nova_map` 1=1, 2=.7, 3=.4, 4=0.
- **price_per_kg** = price / pack_g × 1000. **protein_per_£** = proteins_100g × pack_g / 100 / price. Both are normalised across the 12 SKUs on this shelf (min-max for price/kg, and divided by the shelf max for protein/£).

## Lens grade formulas (each one is clipped to 0-1)
All weights are **assumption: hand-set by the curator to reflect the persona's stated priority order** from `research/05-personas.md` and `data/personas/staged_personas_v1.json`. Verbatims are given where they shaped a rule.

1. **eco_low_chemical** = 0.4·(1 − min(additives_n,10)/10) + 0.3·ecoscore_map + 0.2·organic + 0.1·(1 − palm)
2. **upf_avoider_parent** = 0.5·nova_map + 0.25·(1 − min(additives_n,5)/5) + 0.15·[sweeteners=0] + 0.10·(1 − min(sugars_100g,15)/15)
3. **glp1_small_appetite** = 0.4·min(proteins_100g/10,1) + 0.25·(1 − min(sugars,15)/15) + 0.2·single_serve + 0.15·nutri_map. Here single_serve is 1 if pack_g ≤ 200, 0.5 if ≤ 500, and 0 otherwise. The idea is a small, protein-dense portion.
4. **frugal_unit_price** = 0.7·(1 − normalised price_per_kg) + 0.3·(protein_per_£ / shelf max)
5. **protein_gym** = 0.6·min(proteins_100g/10,1) + 0.2·(1 − min(sugars,15)/15) + 0.2·(protein_per_£ / shelf max). Grounding: "I get the high protein yoghurts … every little helps towards the daily protein goal" (https://www.reddit.com/comments/191icpc).
6. **protein_sceptic_gimmick_reactant** = 0.4·(1 − min(additives_n,5)/5) + 0.3·[sweeteners=0] + 0.3·(1 − gimmick). Here gimmick = 1 when the OFF `name` contains "protein" and the product has additives > 0 or ingredients_n > 3. Grounding:
   - "advertising 'Protein Yogurt' because it has 10g of protein per 100g, when normal Greek yogurt or Skyr has that anyway, you're paying for branding" (https://www.reddit.com/comments/1tbf6zw)
   - "Fage Total 0% Greek yoghurt is 10.3% protein, with no additives" (https://www.reddit.com/comments/1wqczct)
7. **habit_loyalist_shrinkflation_angry** = 0.5·familiarity + 0.5·min(scans/150,1). Familiarity is incumbent=1, own_label=.6, challenger=.4. OFF `scans` stands in for popularity (assumption: 150 ≈ the top of this category in the pool). There is no shrinkflation history in OFF, so that part of the persona is not graded here.
8. **meal_deal_office** = 0.5·single_serve + 0.3·[price ≤ £1.50] + 0.2·nutri_map (assumption: the meal-deal snack slot is a grab-and-go pot under about £1.50).
9. **vegan_ethical** = 0.7·vegan + 0.2·organic + 0.1·ecoscore_map
10. **allergen_coeliac** = 0 if `en:gluten` is in OFF `allergens`, 1 if the OFF labels include `en:no-gluten` and gluten is absent, and 0.6 if gluten is absent but there is no gluten-free claim (cross-contamination is not ruled out).
11. **ai_delegator** = 0.4·min(completeness,1) + 0.4·nutri_map + 0.2·nova_map (assumption: an LLM shopping agent ranks on structured, complete data and headline health scores).
12. **novelty_seeker_tiktok** = 0.4·[role=challenger] + 0.3·trend_kw + 0.3·(1 − min(scans/150,1)). Here trend_kw = 1 if the OFF name or categories match kefir|skyr|oat|protein (assumption: the current UK trending yoghurt formats).

Each product's `lens_grades[*].why` lists the exact field values used.

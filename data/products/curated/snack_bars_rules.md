# snack_bars: selection and lens-grading rules

Output: `data/products/curated/snack_bars.json`. Builder: `data/products/curated/snack_bars_build.py` (it reads the OFF UK pool and per-barcode OFF API v2 snapshots).
Every score is a weighted sum of OFF fields, clamped to [0,1]. Each weight is marked `assumption:` because no paper gives these exact weights. Wherever a Reddit verbatim or the research file motivates a weight, that source is cited.

## Shelf rows (3 sets × 4 SKUs)
| row | theme | incumbent | challenger | own_label |
|---|---|---|---|---|
| 1 top | oat / cereal bars | Nature Valley Crunchy Oats & Honey `8410076600790` | Deliciously Ella Apple & Raisin `5060482840179`, Organix Raspberry & Apple Soft Oaty (organic) `5024121100475` | Lidl Crownfield Muesli Bars Chocolate (no added sugar, maltitol) `20422684` |
| 2 eye | fruit & nut bars | Nakd Cocoa Orange `5060088701478`, Eat Natural Dark Choc Cranberry Macadamia `8000500417195` | KIND Chocolate Chip Cashew `5000159558396` | Lidl Alesto Cacao & Orange raw bar (Nakd dupe) `4056489239918` |
| 3 bottom | protein bars | TREK Protein Flapjack Salted Caramel `5060088709047` | Grenade High Protein Oreo `5060811384084`, Bounce Sweet & Salty Almond `5060411920040` | Lidl Deluxe Fruit & Nut Protein Bars `20402167` |

The rows were chosen to maximise contrast within each row. Row 1 sets NOVA 3 vs 4, organic vs not, and sweetener vs sugar side by side. Row 2 sets a branded raw bar against the own-label dupe made from almost the same ingredients (shelf-edge comparison, research/03 Truth 4). Row 3 sets 8 additives with 2 sweeteners and palm oil (Grenade) against 0 additives (Lidl Deluxe) and a vegan flapjack with palm oil (Trek).

## Data caveats (read before trusting a number)
- **Grenade is missing from the UK pool.** The record was pulled from OFF API v2 `/product/5060811384084`. Its OFF `quantity` field is empty, so the 60g pack size is an assumption.
- **The pool `sweeteners` and `palm_oil_n` columns are empty**, so both fields are derived:
  - `sweeteners` = number of OFF `additives` in E420, E421 or E950–E969 (the EU sweetener/polyol range).
  - `palm_oil_n` = number of `palm` tokens in OFF `ingredients_text`, or 0.5 when OFF analysis says `may-contain-palm-oil`.
  - For Grenade, the OFF analysis tag says palm-oil-free but the ingredient text lists "Palm Oil". The text wins.
- `ingredients_n`, `allergens`, `traces` and `recycling` come from an OFF API v2 per-barcode fetch, because `ingredients_n` is NaN in the pool.
- OFF tags "gluten free oats" as `en:gluten`. For coeliac grading, the `en:no-gluten` label wins (DE, Trek).
- **No prices were fetched from retailers.** Each `price_source` is `assumption: typical UK RRP …`. Every price-based grade (`frugal_unit_price`, `meal_deal_office`, the price part of `habit_loyalist` and `protein_gym`) inherits that assumption.
- `pack_copy` is generated from OFF `labels` and `product_name` only. One exception: Grenade's "low sugar" claim comes from sibling Grenade SKU names on OFF ("HIGH PROTEIN, LOW SUGAR"). It also meets the UK/EU claim threshold, because OFF sugars_100g is 1.7, below 5 g/100g (Reg. (EC) 1924/2006 annex).

## Maps (assumption: linear ordinal maps, same in every category)
- ecoscore: a-plus/a=1, b=.75, c=.5, d=.25, e/f=0, unknown=.4 (assumption: unknown is treated as below-median rather than zero).
- nutriscore: a=1 … e=0, unknown or not-applicable=.4.
- nova: 1=1, 2=.75, 3=.5, 4=0.
- add = min(additives_n,10)/10.
- 10x test: pass when kcal_100g < 10 × proteins_100g. Source: Reddit verbatim "my quick check for what is actually 'high protein' is that the number of kcals is less than 10x the gs of protein" (https://www.reddit.com/comments/191icpc), cited in research/03 as the rule GLP-1 users and sceptics apply.

## Lens rules
1. **eco_low_chemical** = 0.4·(1−add) + 0.3·eco + 0.2·organic + 0.1·(palm_oil_n==0). Fields: additives_n, ecoscore, labels(en:organic), ingredients_text(palm).
2. **upf_avoider_parent** = 0.5·nova + 0.25·(1−add) + 0.15·(1−min(sugars,40)/40) + 0.1·(sweeteners==0). Fields: nova, additives_n, sugars_100g, additives. NOVA carries half the weight because "UPF" is the NOVA 4 concept.
3. **glp1_small_appetite** = 0.3·min(protein/25,1) + 0.2·10x + 0.2·min(fibre/10,1) + 0.1·(1−min(sugars,40)/40) + 0.2·portion. portion = 1 if unit ≤ 40g, .6 if ≤ 50g, else .3. The weighting follows research/03: GLP-1 users want "protein-dense, small-portion food".
4. **frugal_unit_price** = 1 − (price_per_100g − min)/(max − min), min-max scaled across these 12 SKUs. Fields: price (assumption) and OFF quantity.
5. **protein_gym** = 0.5·min(protein/30,1) + 0.2·10x + 0.15·(1−min(sugars,30)/30) + 0.15·(protein g per £ / max in shelf). The protein-per-£ benchmark follows "40g protein… for like a quid" (research/03, https://www.reddit.com/comments/1wqczct).
6. **protein_sceptic_gimmick_reactant** = 0.45·nova + 0.3·(1−add) + 0.25·(ingredients_n ≤ 10) − penalty.
   - penalty = 0.35 when the product claims protein (name, `en:high-in-protein` label or `en:protein-bars` category) AND (fails the 10x test OR sweeteners > 0 OR additives_n ≥ 3).
   - penalty = 0.1 when the protein claim is clean.
   - Source: "Babybel Protein… additional 6 calories for 0.2 grams of protein. Not worth it." (https://www.reddit.com/comments/1wqczct) and "WHY?! IT'S CHICKEN." (https://www.reddit.com/comments/1oqtnv1).
7. **habit_loyalist_shrinkflation_angry** = 0.5·familiarity + 0.3·log1p(scans)/log1p(max scans) + 0.2·frugal.
   - familiarity: incumbent=1, own_label=.6, challenger=.3 (assumption).
   - OFF unique scans stand in for familiarity.
   - No pack-size history is available, so shrinkflation itself is not graded. Motivating source: "The thing I hate more about shrinkflation is being LIED to about it." (https://www.reddit.com/comments/1oi5mf0).
8. **meal_deal_office** = 0.4·single-serve (1 if units_per_pack==1, else .4) + 0.3·min(protein/20,1) + 0.3·per-unit price score. The price score is 1 if ≤ £1.50 and falls linearly to 0 at £3.00 (assumption: typical meal-deal snack slot price).
9. **vegan_ethical** = 0.6·vegan + 0.15·(palm_oil_n==0) + 0.15·eco + 0.1·ethical cert. vegan comes from OFF analysis `en:vegan` or label `en:vegan`. An ethical cert is any of rainforest-alliance, fsc, organic, fairtrade or utz in OFF labels.
10. **allergen_coeliac** = 0.7·(label en:no-gluten) + 0.3·(1−min(non-gluten allergens,4)/4). Fields: labels, allergens_tags. Traces are listed in `why` but not scored (assumption: coeliac risk hinges on the GF claim).
11. **ai_delegator** = 0.4·nutriscore + 0.3·(1−add) + 0.3·completeness. Rationale: an LLM shopper cites legible, verifiable data (research/03 Truth 5, "clear, intent-matched, verifiable listings"). OFF completeness stands in for listing legibility.
12. **novelty_seeker_tiktok** = 0.5·(role==challenger) + 0.3·(1 − log-scaled scans) + 0.2·(indulgent or collab flavour word in name: oreo, caramel, choc, cocoa, cacao, toffee, bakewell). All three terms are assumptions: fewer scans means less familiar, and indulgent or collab flavours are the TikTok-trend format.

## Variety coverage
- NOVA: 3 (DE) and 4 (the other 11). The UK bar aisle has almost no NOVA 1–2 SKUs; Nakd and Alesto are NOVA 4 on OFF only because of "natural flavouring".
- additives_n: 0 (6 SKUs) through 1, 2 and 3, up to 8 (Grenade).
- sweeteners: 0, 1 (Crownfield, maltitol) and 2 (Grenade, maltitol + sucralose).
- palm oil: 0, 0.5 (Bounce), 1 (Grenade) and 3 (Trek).
- organic: Organix only.
- vegan: DE, Organix, Nakd, Alesto and Trek.
- gluten-free label: 7 SKUs.
- protein_100g: 4.3 to 34.3.
- nutriscore: b to e, plus not-applicable.
- ecoscore: a, c and unknown.
- price per 100g: £0.65 to £4.17.
- roles per row: incumbent, challenger and own_label in every row.

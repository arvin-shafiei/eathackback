# hot_drinks unit: curation and lens-grading rules

Output: `data/products/curated/hot_drinks.json`, built by `data/products/curated/hot_drinks_build.py`. Source pool: `data/products/uk_products.parquet` (Open Food Facts UK). OFF API v2 snapshots (fetched 2026-10-03) live in `data/products/curated/hot_drinks_off_api/api_<code>.json`. They fill the fields the bulk pool leaves empty: allergens, traces, ingredients_n, recycling and serving_size.
Every product field comes from its OFF record (`off_url`) unless the field says otherwise. Each lens grade has a `why` list naming the OFF fields used.

## Rows (one set per row)

| row | theme | products (role) |
|---|---|---|
| 1 top | coffee | Nescafé Gold Blend 150g `8445290522740` (incumbent) · Kenco Original Latte sachets `8711000677810` (incumbent) · Grind Iced Oat Flat White 250ml `5060574954630` (challenger) · Lidl Bellarom Kenya ground 250g `4056489639145` (own_label) |
| 2 eye | everyday black tea | PG Tips Black Tea 40 bags `8720608039593` (incumbent) · Yorkshire Tea (Taylors of Harrogate) 240 bags `5010357112092` (incumbent) · Clipper Organic Everyday 80 unbleached bags `5021991113673` (challenger) · Asda Everyday Tea Bags `5054781861034` (own_label) |
| 3 bottom | hot chocolate and herbal | Cadbury Hot Chocolate 500g `5034660021582` (incumbent) · Options Belgian Choc 220g `7612100053607` (incumbent of the low-cal sub-type) · Tesco Lighter Hot Chocolate 270g `5059697390005` (own_label) · Pukka Day to Night organic herbal collection `5060519143730` (challenger) |

Tea sits at eye level because it is the category's highest-frequency staple (assumption, mirroring the soft_drinks colas-at-eye placement).

**Lens spread achieved:**
- NOVA 1 (pure coffee, tea) vs 3 (Grind) vs 4 (lattes, hot chocolate).
- Additives from 0 up to 7 (Options).
- Sweeteners: aspartame e951 (Options), sucralose e955 (Tesco Lighter), none elsewhere.
- Organic: Clipper, Pukka.
- Fair trade: Pukka.
- Rainforest Alliance: PG Tips, Asda, Bellarom, Tesco.
- Vegan Society: Cadbury.
- Gluten-free label: Options. Oats: Grind.
- Hydrogenated fat and glucose syrup: Kenco.
- Eco-score from a-plus to e (Bellarom).
- Nutri-Score from a (Tesco Lighter) to e (Kenco, Cadbury).
- Price per cup from £0.02 (Asda) to £2.00 (Grind).

**Why these roles:**
- `data/sales/uk_bestsellers.csv` has **no hot-drinks rows** (grep for tea, coffee, Nescafé, PG Tips and Yorkshire found none). Incumbent roles are therefore an **assumption**: these are the long-standing UK category-leader brands.
- The Reddit corpus (`data/reddit/comments.csv`) backs the tea and coffee incumbents' habit status:
  - "The only categorical brand I go for is Yorkshire tea. That's it" (https://www.reddit.com/comments/1ow5fne)
  - "The only thing we won't budge on is Yorkshire tea bags" (https://www.reddit.com/comments/1wbyp1n)
  - "Nescafe Gold Blend" as a brand someone insists on (https://www.reddit.com/comments/r2udam)
  - "Only branded products I tend to buy are tea bags…" (https://www.reddit.com/comments/13u6xww)

### Brief items not stocked (kept visible on purpose)
- **Whittard hot chocolate** is not in the OFF UK pool. Whittard has only 4 SKUs there, all teas or fruit infusions. **Taylors coffee** exists (Rich Italian Coffee Bags `0615357122468`) but has no ecoscore. Taylors is represented by Yorkshire Tea instead.
- **Kenco instant jar** (Smooth/Rich) is not in the pool, so the Kenco latte sachet is used. **Pukka** tea has one SKU in the pool, the collection box.

### Data caveats
- **Nescafé Gold Blend `8445290522740`**: the barcode has a Spanish GS1 prefix (84), but OFF `countries=united-kingdom` and the image is the UK jar. Nutrition is per 100g of powder, which explains fibre 19.1 and protein 19.4.
- **Kenco `8711000677810`**:
  - OFF `serving_size` reads "approx 6g", which is implausible for a latte sachet that is 36% skimmed milk powder. The per-cup dose instead uses 18.5g, the sachet weight of the comparable Nescafé Gold Vanilla Latte in the pool (`7613034315557`, quantity "8 x 18.5 g"). This is an assumption.
  - OFF quantity is empty. The 8 sachets per box is an assumption.
  - `e14xx` is OFF's tag for unspecified "modified starch".
- **Grind `5060574954630`**: Grind's hot or instant range is not in the pool. Its only SKU is a chilled ready-to-drink (RTD) carton, kept as the challenger and novelty anchor.
  - The pool says sugars 2.2g/100ml and 40 kcal. The OFF API snapshot now says 5.5g and 100 kcal. **Pool values are used**, for consistency with other units.
  - Allergen `en:gluten` (from the oats) comes from the OFF API.
- **Bellarom `4056489639145`**: the ingredients text is in Croatian ("Mljevena pržena kava" = ground roasted coffee), because the SKU is sold across many markets. OFF stores=Lidl and countries includes the UK. Eco-score e is OFF's value for coffee (high land use per kg).
- **PG Tips `8720608039593`**: OFF stores is "Save-On-Foods" (Canada), but countries includes the UK. The `en:plant-based-tea-bags` label is OFF's.
- **Yorkshire Tea `5010357112092`**: the OFF quantity is just "240". It is read as the 240-bag box (assumption).
- **Tea nutrition**: the pool carries ~1.26 kcal/100 for every tea, while the API shows none. These are read as infusion values: 250ml mug, ~3 kcal, 0g sugar.
- **Cadbury `5034660021582`**: the per-cup values exclude milk (OFF serving_size 18g of powder: 9.9g sugar, 72 kcal). The API "prepared" values (127g sugar/100g) are a clear OFF data error and are ignored. Labels include the-vegan-society and cocoa-life. Traces: milk.
- **Options `7612100053607`** and **Tesco Lighter `5059697390005`**: OFF nutrition is **as prepared**, per 100ml (20 and 19 kcal), so per-cup = per-100ml × 2.11 (211ml serving, OFF serving_size).
  - Pack copy says "~42 kcal per prepared cup". This is computed, and the brand's own "40 calories" claim was not verified.
  - Tesco powder per serve (11g) is an assumption, copied from Options' format.
- **Pukka `5060519143730`**:
  - OFF lists additive `e175` (gold). This is most likely a parse artefact of a "golden" blend name. It is kept as-is (OFF field) and flagged here.
  - NOVA 4 is OFF's value, probably driven by "essential oil flavour".
  - The ingredients include **"oat flowering tops"**, so the coeliac lens drops it to 0.1. This is conservative: the product is oat-derived and carries no gluten-free label.
  - The sachets-per-box count (20) is an assumption.
- **Prices**: all prices are **assumptions** (typical UK shelf RRP, curator estimate, Oct 2026). No retailer page was fetched. Each `price_source` says so.
  - `price_per_cup_gbp = price_gbp / cups_per_pack`, and every `cups_per_pack_source` names its OFF field or assumption.
  - Doses are assumptions: 1.8g instant coffee per mug, 7g ground coffee per cup.
- `sweeteners`: the pool column is empty. It is derived as max(count of OFF additives in E420/E421/E950–E969, count of sweetener words in ingredients_text).
- `ecoscore` unknown maps to a neutral 0.5 (assumption: missing ≠ bad).

## Shared feature maps
- `add_s = 1 - min(additives_n,10)/10`
- `eco_map`: a-plus 1, a 0.9, b 0.75, c 0.5, d 0.25, e 0.1, f 0, unknown 0.5
- `nutri_map`: a 1, b .75, c .5, d .25, e 0
- **per cup** (hot drinks are sold as powder, bags or RTD, so per-100g figures are not comparable): powder → per100g × dose_g/100, prepared → per100ml × ml/100. The dose and its source are in `per_cup`.
- `sugar_s = max(0, 1 − sugars_per_cup/12)` (assumption: 12g ≈ 3 tsp sugar in a cup, roughly a full-sugar hot chocolate)
- `kcal_s = max(0, 1 − kcal_per_cup/100)`
- `ppc_s = 1 − ln(ppc/ppc_min)/ln(ppc_max/ppc_min)`. This is log-scaled within the shelf (£0.02–£2.00 per cup). Log is used because a 100× range would crush linear scaling (assumption).
- `palm_free`: OFF analysis palm-oil-free with no "palm" in the ingredients → 1; content-unknown → 0.5; palm present or may-contain → 0.
- `UPF markers`: glucose syrup, maltodextrin, hydrogenated, whey, permeate, polydextrose, modified starch, flavouring, milk proteins, found in ingredients_text. Grounding: Monteiro et al. 2019, the NOVA "cosmetic additives and industrial ingredients" marker list.
- `functional/diet claims`: functional botanicals (ginseng, matcha, tulsi, turmeric, adaptogen, detox), added vitamins or minerals, or an OFF reduced/low-sugar label.
- `reformulated`: a sweetener is present OR an OFF reduced/low-sugar label is present.
- `trend`: oat, cold brew, iced, matcha, ginseng, turmeric, mushroom or collagen in name, ingredients or labels.

## Lens formulas (all clipped to 0–1)
| lens | formula | grounding |
|---|---|---|
| eco_low_chemical | 0.4·add_s + 0.3·eco_map + 0.2·organic + 0.1·palm_free | same weights as soft_drinks (CONTRACT example) |
| upf_avoider_parent | 0.4·(4−nova)/3 + 0.2·add_s + 0.2·(no sweeteners) + 0.1·(no UPF markers) + 0.1·sugar_s | NOVA (Monteiro et al. 2019, Public Health Nutr.). The azo-dye term from soft_drinks is swapped for UPF marker ingredients, since there are no dyes in this category |
| glp1_small_appetite | 0.4·sugar_s + 0.4·kcal_s + 0.2·(no sugar/glucose in ingredients) | assumption: GLP-1 users want low-sugar, low-kcal drinks (research/05-personas.md) |
| frugal_unit_price | 0.85·ppc_s + 0.15·own_label | verbatim: "I buy Asda's own everyday teabags" because "we get through so much tea" (https://www.reddit.com/comments/1ow5fne). Also "I prefer Lidl hot chocolate powder to Cadbury's." (https://www.reddit.com/comments/r38ifw) |
| protein_gym | 0.6·min(protein_per_cup/10,1) + 0.2·sugar_s + 0.2·kcal_s | assumption: hot drinks carry almost no protein (milk excluded), so the grades stay low (honest null) |
| protein_sceptic_gimmick_reactant | 0.6·(1 − min(claims,3)/3) + 0.2·(no sweeteners) + 0.2·add_s | verbatim: "High protein can just be the headline grabber. Check the ingredients as you're bound to find a bunch of additives and sweeteners." (https://www.reddit.com/comments/191icpc). The same reactance is applied to "lighter" and functional-botanical claims |
| habit_loyalist_shrinkflation_angry | 0.5·incumbent + 0.3·(not reformulated) + 0.2·ppc_s | verbatims: "The only categorical brand I go for is Yorkshire tea" (https://www.reddit.com/comments/1ow5fne); "The only thing we won't budge on is Yorkshire tea bags" (https://www.reddit.com/comments/1wbyp1n); "Nescafe Gold Blend" (https://www.reddit.com/comments/r2udam) |
| meal_deal_office | 0.6·format (RTD single serve 1 / individual sachets 0.5 / jar or box 0.2) + 0.2·mainstream (incumbent/own_label, or OFF stores lists a big-4/discounter) + 0.2·sugar_s | verbatim: "if there's a costa machine that you can include then i'll sometimes get a hot chocolate" (https://www.reddit.com/comments/1bc79kh). Format weights are an assumption: only RTD fits a UK meal deal, and sachets suit the office desk |
| vegan_ethical | 0.6·vegan_s + 0.2·organic + 0.2·(any ethical label: fair-trade, rainforest-alliance, vegan-society, 1%-for-the-planet, cocoa-life, ethical-tea-partnership, soil-association) | OFF labels/analysis. vegan_s: label 1, analysis 0.8, maybe 0.5, non-vegan 0, unknown 0.3 |
| allergen_coeliac | label en:no-gluten → 1.0; gluten word (barley/wheat/rye/malt/spelt/oat) or OFF allergen en:gluten → 0.1; otherwise 0.7; −0.1 if ingredients missing | assumption: a coeliac shopper trusts explicit labels. Oats count because UK coeliac guidance needs oats labelled gluten-free |
| ai_delegator | 0.4·min(completeness,1) + 0.4·nutri_map + 0.2·(OFF stores known) | same as soft_drinks (machine-readable data quality + Nutri-Score) |
| novelty_seeker_tiktok | 0.55·challenger + 0.45·trend | assumption: the TikTok novelty persona responds to challenger brands and oat, iced or adaptogen trends (research/05-personas.md) |

Reproduce: `python3 data/products/curated/hot_drinks_build.py`. It reads the parquet and the API snapshots, and gives identical scores.

# bakery_bread unit: curation and lens-grading rules

Output: `data/products/curated/bakery_bread.json`. Source pool: `data/products/uk_products.parquet` (Open Food Facts UK).
Every product field comes from its OFF record (`off_url`) unless the field says otherwise. Each lens grade has a `why` list naming the OFF fields used. All 12 SKUs have an OFF front image.

## Rows (one set per row)

| row | theme | products (role) |
|---|---|---|
| 1 top | sourdough, rye and organic | Jason's White Ciabatta Sourdough `5025125000006` (challenger) · Biona Organic Rye Chia & Flax `5032722312920` (challenger) · Allinson's Scandalous Seeds Wholemeal (organic, B Corp) `5010092736812` (incumbent) · Aldi Specially Selected Seeded Sourdough `4088600246291` (own_label) |
| 2 eye | everyday sliced: the big three vs discounter | Warburtons Toastie Soft Thick White 400g `5010044000275` (incumbent) · Hovis Seed Sensations Seven Seeds 800g `5010003064744` (incumbent) · Kingsmill 50/50 800g `5010092093441` (incumbent) · Aldi Everyday Essentials Medium Sliced White 800g `4088600011820` (own_label) |
| 3 bottom | free-from and wraps | Genius GF Soft White Farmhouse `5060195901334` (challenger) · Promise GF Multi Grain Loaf `5391526414385` (challenger) · BFree GF Sweet Potato Wraps `5391521690494` (challenger) · Mission Protein Plant Powered Tortilla Wraps `5036034406803` (incumbent of the wraps sub-type) |

Selection logic: the brief's brands were looked up in the pool with an image and non-empty ingredients, and the best-scanned SKU was taken (OFF `scans`), unless a sister SKU gave more lens spread. The picks span these ranges:
- NOVA 3 (rows 1) vs 4 (rows 2–3).
- Additives from 0 (Jason's, Biona, Aldi sourdough) to 8–9 (Promise, Mission, BFree).
- Organic: Biona and Allinson's.
- Vegan label vs egg-white GF loaves (Genius, Promise).
- Gluten-free: 3 SKUs. Every wheat loaf scores 0.1 for coeliac.
- Palm oil: Allinson's, Warburtons, Kingsmill and Mission list palm in their ingredients. Aldi Essentials states "No palm oil".
- Eco-score from a-plus to b.
- Price from £0.74/kg to £10.91/kg.
- Roles: 5 challengers, 5 incumbents, 2 own-label.
- Protein from 1.8 g (BFree) to 17 g (Mission).

### Data caveats (kept visible on purpose; also in each product's `data_caveat`)
- **Incumbents**: `data/sales/uk_bestsellers.csv` was checked and has **no bakery/bread rows**. It covers soft_drinks, crisps, snack_bars, cereal, yoghurt, biscuits, plant milk, ready meals and meal_deal. So there is no NIQ rank to cite. Incumbent roles for Warburtons, Hovis and Kingsmill are labelled `assumption: long-standing UK branded sliced-bread leaders`. Mission is labelled an incumbent of the wraps sub-type by the same logic as Remedy in soft_drinks. Allinson's is labelled an incumbent because it is a heritage ABF brand (assumption).
- **"Bread Bakers"** (from the brief) is not in the OFF UK pool (0 matches on brand), so it was not used. **Own-label protein wraps** exist (Aldi Village Bakery `4088600550572`, Co-op `5000129379693`). Mission was chosen instead because it lists palm oil, has Nutri-Score d and is an incumbent, which gives more lens spread. The Aldi SKU is used only to source Mission's pack weight.
- **Biona `5032722312920`**: OFF energy-kcal_100g = 598, which is implausible for rye bread (probably kJ or a data-entry error). The kcal term in glp1 uses a neutral 0.5 for this SKU.
- **Aldi sourdough `4088600246291` and Hovis `5010003064744`**: OFF salt_100g ≈ 0.002, which is implausible (probably mis-scaled). Salt is not used in any lens.
- **Aldi Essentials `4088600011820`**: OFF analysis says `may-contain-palm-oil`, but the ingredients_text says "No palm oil". The ingredients statement wins.
- **Mission `5036034406803`**: the OFF quantity is missing. pack_g = 366 (6 × 61 g) is an assumption copied from the equivalent Aldi protein wrap's OFF quantity. The SKU has no OFF labels.
- **BFree `5391521690494`**: it has no `en:no-gluten` label tag, but the OFF categories include `en:products-without-gluten|en:gluten-free-breads`. The coeliac rule accepts either.
- **Prices**: all prices are **assumptions** (typical UK RRP, Oct 2026, curator estimate). No retailer page was fetched. One cross-check: Kingsmill £1.40 matches a verbatim, "loaf of bread 1.40" (https://www.reddit.com/comments/1k4ayi9). The gluten-free premium matches "all gluten free stuff is premium" (https://www.reddit.com/comments/191icpc). `unit_price_gbp_per_kg = price_gbp / pack_g × 1000`.
- `sweeteners`: computed with the same derivation as soft_drinks (sweetener E-numbers in OFF additives). It is 0 for all 12. That is an honest null, because UK bread does not use sweeteners.
- `palm_oil_n` is null in the whole parquet. It is derived per SKU (see `palm_oil_source`): ingredients_text "No palm oil" → 0; "palm" in ingredients or analysis `en:palm-oil` → 1; `may-contain` → null (0.5 in lenses); `palm-oil-free` → 0.

## Shared feature maps
- `add_s = 1 - min(additives_n,10)/10`
- `eco_map`: a-plus 1, a 0.9, b 0.75, c 0.5, d 0.25, e 0.1, f 0; unknown 0.5
- `nutri_map`: a 1, b .75, c .5, d .25, e 0
- `sugar_s = max(0, 1 - sugars_100g/5)` (assumption: bread scale. 5 g/100g is roughly sweetened enriched bread, so it scores 0)
- `kcal_s = max(0, 1 - kcal/300)` (implausible kcal ≥450 → 0.5)
- `vegan_s`: label en:vegan → 1; analysis en:vegan → 0.8; en:maybe-vegan → 0.5; unknown/non-vegan → 0.3
- `ppk_s = 1 - (clip(£/kg, 0.7, 14) - 0.7)/13.3` (assumption: UK range from an entry-price 800g loaf at about £0.70/kg to free-from wraps at about £14/kg)
- `emulsifiers`: e471, e472e, e481, e482, e461, e464, e466, e433. `preservatives`: e200–e203, e280–e283 (calcium/sodium propionate, sorbates).
- `claims`: protein · high fibre · superfood/veg halo (chia | quinoa | sweet potato | seven seeds) · plant powered. Each is matched in name, labels and pack_copy.
- `trend`: sourdough | protein | sweet potato | chia | quinoa | gluten free | rye | seed, matched in name or the start of the ingredients.

## Lens formulas (all clipped to 0–1; the same 12 lens names as the other units)
| lens | formula | grounding |
|---|---|---|
| eco_low_chemical | 0.4·add_s + 0.3·eco_map + 0.2·organic + 0.1·palm-oil-free | same weights as soft_drinks (assumption: mirrors the CONTRACT example) |
| upf_avoider_parent | 0.4·(4−nova)/3 + 0.25·add_s + 0.15·(no emulsifiers) + 0.1·(no preservatives) + 0.1·sugar_s | NOVA (Monteiro et al. 2019, Public Health Nutr.). The emulsifier term swaps out soft_drinks' azo-dye term, because emulsifiers are the UPF marker in bread (Chassaing et al. 2015, Nature, "Dietary emulsifiers impact the mouse gut microbiota…"). Verbatim on supermarket bread: "the enshittifaction of bread… by supermarkets" (https://www.reddit.com/comments/1v79v53) |
| glp1_small_appetite | 0.4·min(fibre/6,1) + 0.3·min(protein/12,1) + 0.3·kcal_s | assumption: GLP-1 users favour satiating fibre and protein per calorie (research/05-personas.md). Bread has no single-serve size, so the serve term is dropped |
| frugal_unit_price | 0.85·ppk_s + 0.15·own_label | same as soft_drinks, per kg. Verbatim: "a loaf of bread 1.40" (https://www.reddit.com/comments/1k4ayi9) |
| protein_gym | 0.6·min(protein/15,1) + 0.2·min(fibre/6,1) + 0.2·sugar_s | assumption: 15 g/100g ≈ "high protein" wrap tier (Mission 17 g, Aldi 16 g) |
| protein_sceptic_gimmick_reactant | 0.6·(1 − min(claims,3)/3) + 0.2·(no protein isolate / added wheat gluten) + 0.2·add_s | verbatim: "High protein can just be the headline grabber. Check the ingredients as you're bound to find a bunch of additives and sweeteners." (https://www.reddit.com/comments/191icpc) |
| habit_loyalist_shrinkflation_angry | 0.5·incumbent + 0.3·(standard ≥750g loaf) + 0.2·ppk_s | assumption: the 800g loaf is the UK reference pack, and smaller packs are a shrinkflation sentinel. Same structure as soft_drinks |
| meal_deal_office | 0.4·portable lunch format (wrap/roll/pitta/ciabatta) + 0.3·mainstream (incumbent/own_label or OFF stores lists a major UK grocer) + 0.3·sugar_s | verbatim: "Boots for a duck hoison wrap" and "two slices of white bread… a protein" (research/corpus/meal_deal.md). Format rule is an assumption |
| vegan_ethical | 0.6·vegan_s + 0.2·organic + 0.2·(any ethical label: carbon/b-corp/fair-trade/vegan-society/vegetarian-society/soil-association/fsc) | OFF labels/analysis |
| allergen_coeliac | label en:no-gluten or OFF category en:products-without-gluten → 1.0; gluten word (wheat/barley/rye/malt/spelt/gluten) in ingredients → 0.1; otherwise 0.7 | verbatim: "I'm coeliac and can't eat gluten… GF items become more and more expensive" (https://www.reddit.com/comments/191icpc). **All 9 wheat/rye SKUs → 0.1; Genius, Promise and BFree → 1.0** |
| ai_delegator | 0.4·completeness + 0.4·nutri_map + 0.2·(OFF stores known) | same as soft_drinks (research/corpus/chatgpt_shopping.md) |
| novelty_seeker_tiktok | 0.55·challenger + 0.45·trend | same as soft_drinks, with bread trend terms (sourdough, protein, GF, veg flours, seeds) |

Reproduce: run the build script (pandas over the parquet, using the formulas above). It recomputes every score from the OFF fields named in each `why`. It is kept in the curator's scratchpad. The formulas above are complete, so scores can be re-derived without it.

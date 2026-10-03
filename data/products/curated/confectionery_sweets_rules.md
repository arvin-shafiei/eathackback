# confectionery_sweets unit: curation and lens-grading rules

Output: `data/products/curated/confectionery_sweets.json`. Source pool: `data/products/uk_products.parquet` (Open Food Facts UK).
Every product field comes from its OFF record (`off_url`) unless the field says otherwise. Each lens grade has a `why` list naming the OFF fields used.

## Rows (one set per row)

| row | theme | products (role) |
|---|---|---|
| 1 top | sharing-bag gummies | HARIBO Starmix 175g `5012035927592` (incumbent) · Maynards Bassetts Jelly Babies 165g `7622210575036` (incumbent) · Candy Kittens Wild Strawberry Gourmet Sweets 140g `5060384262918` (challenger) · M&S Percy Pig 170g `00132589` (own_label) |
| 2 eye | chews, sweet-shop classics and pick-n-mix | Swizzels Squashies Drumstick 140g `5010478014510` (incumbent) · Swizzels Love Hearts 39g `5010478432567` (incumbent) · Rowntree's Pick & Mix Pouch 150g `8445290094148` (incumbent) · Tesco Strawberry Flavour Laces `5000462822474` (own_label) |
| 3 bottom | sugar-free, natural liquorice and chewing gum | Free From Fellows Gummy Bears 100g `5060308360140` (challenger) · Lidl Sweet Corner sugar-free Gummy Bears `4056489372691` (own_label) · Panda Natural Original Liquorice 4 bars 128g `0075172079123` (challenger) · Wrigley's Doublemint 77g `4009900507509` (incumbent, gum) |

Selection logic: every SKU has an OFF front image and a UK-pool record. Within the unit, the picks are chosen to sit far apart on the lens axes:
- **NOVA**: 3 (Panda, 4 ingredients, 0 additives) against NOVA 4 for everything else.
- **Additives**: 0 (Panda) up to 12 (Love Hearts) and 10 (Rowntree's Pick & Mix).
- **Sugar and sweeteners**: three positions. Full sugar runs from 46 to 85.5 g/100g. Polyol and stevia sugar-free products are Free From Fellows, Lidl and Doublemint. Panda has low sugar per OFF and no sweetener (see caveat).
- **Gelatine**: Haribo, Maynards and Squashies are OFF `en:non-vegan`, against vegan-labelled Love Hearts, Rowntree's, Tesco, Lidl and Panda.
- **Gluten**: Free From Fellows carries `en:no-gluten`. Tesco Laces contain wheat flour, Panda contains wheat flour, and Percy Pig has OFF allergen `en:gluten`.
- **Palm oil**: Tesco Laces list palm oil, Candy Kittens is labelled `en:no-palm-oil`, and two products are unknown.
- **Ethics**: Candy Kittens is B Corp and carbon-compensated.
- **Eco-score**: b to a.
- **Price**: £0.86/100g (Haribo) to £2.92/100g (gum).
- **Role**: 6 incumbents, 3 challengers, 3 own-label.

### Incumbent choice and data caveats (kept visible on purpose)
- **No sugar-confectionery table in `data/sales/uk_bestsellers.csv`.** The CSV covers soft drinks, crisps, snack bars, biscuits and chocolate confectionery, cereal, yoghurt, plant milk and ready meals, and has no sweets/gum rows. Chocolate brands such as Kit Kat and Aero rows 290/301 come from The Grocer chocolate table and are not used here. The incumbent role is therefore an **assumption**. It is supported by OFF popularity as a proxy: Haribo has the most UK-pool sweets SKUs (59 candy barcodes with images; Starmix scans=24), Maynards Bassetts Jelly Babies has scans=17, Swizzels has 30+ barcodes, and Rowntree's has 20+ barcodes. Wrigley's is the gum incumbent by assumption, because no UK Extra/Airwaves SKU with full data is in the pool. No WebSearch was possible this session because the budget was exhausted. Replace this with The Grocer Top Products "sugar confectionery" table when someone can fetch it.
- **Not in the pool**: SmartSweets (0 matches). Free From Fellows is the vegan/low-sugar challenger instead, and Lidl Sweet Corner is the own-label sugar-free counterpart. The pool has no own-label "pick-n-mix" bag with an image, so Tesco Strawberry Laces (a pick-n-mix staple, own label) and the branded Rowntree's Pick & Mix pouch together cover the pick-n-mix concept.
- **Organic**: no organic UK sweets with a full record. The only organic sweets in the pool are French Les Anis de Flavigny tins, which were excluded as non-UK-mainstream. `organic=False` for all 12 picks (honest gap).
- **Candy Kittens `5060384262918`**: OFF `fiber_100g=60` is implausible for a gummy, so the GLP-1 grade treats it as 0 (flagged in `why`). The labels give vegetarian only, and analysis gives `en:maybe-vegan`, so vegan_s=0.5. Other Candy Kittens barcodes carry `en:vegan`.
- **Percy Pig `00132589`**: OFF allergens list `en:gluten` and `en:fish`, but the ingredients show no gluten grain. This is likely a "may contain" / M&S factory declaration. The coeliac grade follows the OFF allergen field (0.1).
- **Squashies `5010478014510`**: the OFF ingredients_text is from an Australian import sticker. Recipe is gelatine-based (non-vegan). Palm unknown.
- **Panda `0075172079123`**: OFF `sugars_100g=4.0` looks low because molasses syrup is the first ingredient. It is used as-is because it is the OFF value, but treat Panda's sugar-dependent grades with caution.
- **Wrigley's Doublemint `4009900507509`**: German GS1 prefix (Mars Wrigley EU), OFF `stores=Spar`. Colour E132 (indigo carmine) is not an azo dye. The OFF quantity of 77g is a multi-pack.
- **Polyols**: E420 sorbitol, E953 isomalt, E965 maltitol and E967 xylitol must carry the "excessive consumption may produce laxative effects" statement (Regulation (EU) No 1169/2011 Annex III, retained in UK law). This is relevant to the sugar-free row and is noted for persona reasoning. It is not scored.
- **Pack sizes**: two `pack_grams` are assumptions (`pack_grams_source`): Tesco Laces 75g (sibling `5000462822436` lists 75g) and Lidl Gummy Bears 75g (sibling `4056489372684` lists 75g).
- **Prices**: all prices are **assumptions** (typical UK RRP, curator estimate, Oct 2026). No retailer page was fetched. Each `price_source` states the range it was taken from. `price_per_100g = price_gbp / pack_grams × 100`.
- `sweeteners`: the pool column is null. It is derived as max(count of sweetener E-numbers in `additives` (e420/e421, e950–e969), count of sweetener words in `ingredients_text` (stevia/steviol/erythritol/sucralose/aspartame/acesulfame/maltitol/sorbitol/isomalt/xylitol)).
- `palm_oil_n` (pool column is null): 1 if "palm" appears in ingredients_text, 0 if OFF analysis is `en:palm-oil-free`, otherwise null (scored 0.5).

## Shared feature maps
- `add_s = 1 - min(additives_n,10)/10`
- `eco_map`: a-plus 1, a 0.9, b 0.75, c 0.5, d 0.25, e 0.1, f 0; unknown 0.5
- `nutri_map`: a 1, b .75, c .5, d .25, e 0
- `sugar_s = max(0, 1 - sugars_100g/75)` (assumption: 75 g/100g ≈ jelly-baby level of sugar → 0)
- `vegan_s`: label en:vegan → 1; analysis en:vegan → 0.8; en:maybe-vegan → 0.5; en:non-vegan (gelatine) → 0; unknown → 0.3
- `serve`: pack ≤50g → 1, ≤150g → 0.5, larger → 0 (assumption: sharing bags invite over-portioning)
- `kcal_s = max(0, 1 - kcal_100g/400)`
- `ppg_s = max(0, 1 - (price_per_100g - 0.30)/2.70)` (£0.30/100g → 1, £3.00/100g → 0; assumption: UK range from discounter value bags to gum)
- `claims` (front-of-pack headline claims, from OFF name/labels/pack_copy): sugar-free (or sugars < 0.5 with sweetener), natural/no-artificial/no-additives, gourmet, eco/B-Corp, free-from (gelatine/gluten)
- `trend`: name/labels match gourmet | sour | sugar-free | b-corporation | no-gelatin | vegan-society

## Lens formulas (all clipped to 0–1, identical lens names to soft_drinks)
| lens | formula | grounding |
|---|---|---|
| eco_low_chemical | 0.4·add_s + 0.3·eco_map + 0.2·organic + 0.1·palm_s (free 1 / unknown 0.5 / contains 0) | assumption: same weights as soft_drinks (CONTRACT example) |
| upf_avoider_parent | 0.4·(4−nova)/3 + 0.2·add_s + 0.2·(no sweeteners) + 0.1·(no azo dyes e102/e104/e110/e122/e124/e129) + 0.1·sugar_s | NOVA (Monteiro et al. 2019, Public Health Nutr.). Azo dyes: McCann et al. 2007, Lancet / UK FSA warning |
| glp1_small_appetite | 0.35·sugar_s + 0.25·serve + 0.2·min(fiber/5,1) + 0.2·kcal_s | assumption: GLP-1 users want small, low-sugar, low-kcal portions (research/05-personas.md). OFF fibre >30 g/100g treated as a data error |
| frugal_unit_price | 0.85·ppg_s + 0.15·own_label | verbatim: "Aldi for chocolate and sweets. And biscuits." (https://www.reddit.com/comments/1vjypr7) |
| protein_gym | 0.6·min(protein/10,1) + 0.2·sugar_s + 0.2·kcal_s | assumption: honest null. Sweets carry no meaningful protein. Gelatine gums reach 6.6 g/100g at most |
| protein_sceptic_gimmick_reactant | 0.6·(1 − min(claims,3)/3) + 0.2·(no sweeteners) + 0.2·add_s | verbatim: "Like the sugar free Tic Tacs, which are almost 100% sugar. But they're allowed to do it because the serving size is under a certain weight." (https://www.reddit.com/comments/1wqczct). Also "Fat Free, Sugar Free, low calorie, non-gluten, etc etc. Just a buzzword." (https://www.reddit.com/comments/1wmfkpi) |
| habit_loyalist_shrinkflation_angry | 0.5·incumbent + 0.3·(no sweetener reformulation) + 0.2·ppg_s | verbatim (brand lock-in): "The only branded food we ever have is nestle Cheerios as autistic son won't tolerate own brand ones" (https://www.reddit.com/comments/1ow5fne) |
| meal_deal_office | 0.4·(pocket pack ≤60g) + 0.3·mainstream (incumbent/own_label or OFF stores lists a major UK grocer) + 0.3·sugar_s | verbatim: "…we were on a road trip and already had plenty of sweets/chocolate in the car" (https://www.reddit.com/comments/1bc79kh). Pocket-pack rule: assumption from UK meal-deal snack formats |
| vegan_ethical | 0.6·vegan_s + 0.2·organic + 0.2·(any ethical label: B-Corp / carbon-compensated / fair-trade / vegan-society / vegetarian-society / climatepartner) | OFF labels/analysis. Gelatine products score 0 on vegan_s |
| allergen_coeliac | gluten word (wheat/barley/rye/malt/spelt) in ingredients or OFF allergen en:gluten → 0.1; label en:no-gluten → 1.0; otherwise 0.7; −0.1 if ingredients missing | assumption: the coeliac shopper trusts explicit labels. `malt` is matched as a whole word so that maltitol/isomalt are not flagged |
| ai_delegator | 0.4·completeness + 0.4·nutri_map + 0.2·(OFF stores known) | assumption: an LLM agent ranks by machine-readable data quality and Nutri-Score (research corpus chatgpt_shopping) |
| novelty_seeker_tiktok | 0.55·challenger + 0.45·trend | assumption: TikTok novelty persona responds to challenger brands and gourmet/sour/sugar-free trends (research/05-personas.md) |

## Score snapshot (eco, upf, glp1, frugal, gym, sceptic, habit, mealdeal, vegan, coeliac, ai, novelty)
- Haribo Starmix .53 .42 .16 .68 .50 .68 .96 .41 .00 .70 .66 .00
- Candy Kittens .57 .44 .28 .54 .13 .50 .43 .41 .50 .70 .61 1.00
- Love Hearts .33 .30 .25 .58 .00 .80 .94 .70 .60 .70 .47 .00
- Free From Fellows .57 .30 .57 .32 .29 .10 .07 .30 .30 1.00 .60 1.00
- Panda liquorice .77 .73 .49 .45 .45 .80 .41 .28 .60 .10 .79 .55

Reproduce: run the build script (pandas over the parquet with the formulas above; kept at the curator's scratchpad as `build_sweets.py`). Re-running gives identical scores from the OFF fields listed in each `why`.

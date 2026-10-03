# soft_drinks unit: curation and lens-grading rules

Output: `data/products/curated/soft_drinks.json`. Source pool: `data/products/uk_products.parquet` (Open Food Facts UK).
Every product field comes from its OFF record (`off_url`) unless the field says otherwise. Each lens grade has a `why` list naming the OFF fields used.

## Rows (one set per row)

| row | theme | products (role) |
|---|---|---|
| 1 top | gut and fermented sodas | Hip Pop Gut Lovin' Soda Cola `5060512671247` (challenger) · Dalston's Raspberry "Probiotic" Soda (prebio blend) `5060494810665` (challenger) · Remedy Kombucha Ginger Lemon `9350271002014` (incumbent of the kombucha sub-type) · One Living Organic Ginger Kombucha `5060587580055` (challenger) |
| 2 eye | colas | Coca-Cola Original Taste 330ml `5000112545326` (incumbent) · Coke Zero 1L `5000112630688` (incumbent) · Whole Earth Organic Cola `5013665116417` (challenger) · Lidl Freeway Cola `4056489010104` (own_label) |
| 3 bottom | lemonade, flavoured water and light "functional" drinks | Tesco Diet Lemonade `5059697704932` (own_label) · IRN-BRU Original & Best 500ml `50271511` (incumbent) · Dash Lime Sparkling Water `5060489730657` (challenger) · Purdey's Rejuvenate `5024115330055` (challenger) |

Selection logic: prefer UK barcodes (50…, or retailer 8-digit codes) that have an OFF image. Within each row, pick SKUs that sit far apart on the lens axes: NOVA 1 vs 4, additives 0–5, organic vs not, sweetened vs sugar vs neither, and price from £1.00/L to £8.00/L.

### Data caveats (kept visible on purpose)
- **Hip Pop `5060512671247`**: the OFF `name` and `brand` fields are empty. The brand and claims were read off the OFF front image (`front_en.3`): "HIP POP gut lovin' soda / COLA / prebiotic | no sweeteners | live cultures | low sugar | high fibre". These match the OFF labels `en:source-of-fibre|en:high-fibres` and the ingredients (chicory root fibre, Bacillus coagulans). OFF completeness is 0.39, the lowest in the set.
- **Dalston's `5060494810665`**: OFF names it "Raspberry Probiotic Soda", but the ingredients list a *prebiotic* blend (chicory root fibre, corn fibre, baobab) and no live cultures. pack_copy uses the ingredients rather than the name. Allergen `en:apple` and store "Holland & Barrett" come from the OFF API v2 (fetched 2026-10-03), because the parquet allergens field was empty.
- **Remedy `9350271002014`**: the barcode has an Australian GS1 prefix, but OFF `stores=Tesco`. The incumbent role is an assumption: Remedy has the most kombucha SKUs in the OFF pool (8+ barcodes).
- **Coca-Cola `5000112545326`**: the OFF ingredients_text is in Danish (multi-market can), and the nutrition data matches the UK can (10.6g sugar/100ml).
- **IRN-BRU `50271511`**: the ingredients_text is partly OCR-garbled. OFF `additives` lists e110 and e124 (azo dyes, which carry the UK "may have an adverse effect on activity and attention in children" warning) and e950. Sugar is 4.5g/100ml, a sugar plus sweetener blend.
- **Prices**: all prices are **assumptions** (typical UK single-unit shelf price, curator estimate, Oct 2026). No retailer page was fetched. `price_per_litre_gbp = price_gbp / pack litres`. Replace them with retailer URLs if time allows; the frugal and habit grades will then recompute.
- `sweeteners` is not populated in the OFF pool (the column is all null). It is derived here as the count of sweetener E-numbers in `additives` (e950–e969, e420/e421, e965–e967), or the count of sweetener words in `ingredients_text` (stevia/steviol/erythritol/sucralose/aspartame/acesulfame), whichever is larger.
- `ecoscore` is `not-applicable` for most soft drinks in OFF. It is mapped to a neutral 0.5 (assumption: missing ≠ bad).

## Shared feature maps
- `add_s = 1 - min(additives_n,10)/10`
- `eco_map`: a-plus 1, a 0.9, b 0.75, c 0.5, d 0.25, e 0.1, f 0; not-applicable/unknown 0.5
- `nutri_map`: a 1, b .75, c .5, d .25, e 0
- `sugar_s = max(0, 1 - sugars_100g/10)` (10g/100ml ≈ full-sugar cola, so 0)
- `vegan_s`: label en:vegan → 1; analysis en:vegan → 0.8; en:maybe-vegan → 0.5; unknown → 0.3
- `serve`: ≤330ml → 1, ≤500ml → 0.5, larger → 0
- `ppl_s = max(0, 1 - (price_per_litre - 1)/7)` (£1/L → 1, £8/L → 0; assumption: UK range of soft drinks from discounter 2L to craft 275ml glass)
- `trend`: name/ingredients/labels match kombucha|prebio|probio|gut|live culture|natural energy|botanical
- `gimmick claims`: count of {prebiotic/probiotic, gut, live cultures, kombucha, energy/botanicals, added vitamins/minerals} found in name/labels/ingredients/pack_copy
- `mixed = sugars_100g > 0.5 AND sweetener present` (a sign of the UK sugar-levy reformulation)

## Lens formulas (all clipped to 0–1)
| lens | formula | grounding |
|---|---|---|
| eco_low_chemical | 0.4·add_s + 0.3·eco_map + 0.2·organic + 0.1·palm-oil-free | assumption: weights mirror the CONTRACT example; this persona counts additives first |
| upf_avoider_parent | 0.4·(4−nova)/3 + 0.2·add_s + 0.2·(no sweeteners) + 0.1·(no azo dyes e102/e104/e110/e122/e124/e129) + 0.1·sugar_s | NOVA (Monteiro et al. 2019, Public Health Nutr. "Ultra-processed foods: what they are and how to identify them"). Azo dye warning from UK FSA / Southampton study (McCann et al. 2007, Lancet) |
| glp1_small_appetite | 0.35·sugar_s + 0.25·serve + 0.2·min(fiber/3,1) + 0.2·max(0,1−kcal/45) | assumption: GLP-1 users want small, low-sugar, low-kcal portions (see research/05-personas.md). Fibre rewarded per the Reddit verbatim "Olipop is 9g fiber for 45cals… worth it" (https://www.reddit.com/comments/1sit7ev) |
| frugal_unit_price | 0.85·ppl_s + 0.15·own_label | unit-price shopper. Verbatim: "Take a 500ml bottle of drink. 10 years ago would've been £1, now theyre more than double that" (https://www.reddit.com/comments/1pmmtcv) |
| protein_gym | 0.6·min(protein/10,1) + 0.2·sugar_s + 0.2·max(0,1−kcal/45) | assumption: soft drinks carry no protein, so these grades stay low (honest null) |
| protein_sceptic_gimmick_reactant | 0.6·(1 − min(claims,3)/3) + 0.2·(no sweeteners) + 0.2·add_s | verbatim: "High protein can just be the headline grabber. Check the ingredients as you're bound to find a bunch of additives and sweeteners." (https://www.reddit.com/comments/191icpc). The same reactance is applied to gut/functional claims |
| habit_loyalist_shrinkflation_angry | 0.5·incumbent + 0.3·(not mixed) + 0.2·ppl_s | verbatim: "they haven't bowed to the sugar tax… we can't have proper Dr Pepper, Sprite, Fanta, Pepsi, Irn Bru… But at least we have Red Bull and we have good old Coke" (https://www.reddit.com/comments/1p3q2ce). Also "red Coke only - sugar not sweeteners, real Coke taste" (https://www.reddit.com/comments/r2udam) |
| meal_deal_office | 0.4·(250–500ml single-serve) + 0.3·mainstream (incumbent/own_label, or OFF stores lists a major UK grocer) + 0.3·sugar_s | verbatim: "Sometimes in Tesco you can get something like Kombucha for the drink in the meal deal. I'm not turning that down." (https://www.reddit.com/comments/1bc79kh). Single-serve rule: assumption from UK meal-deal drink formats (≤500ml) |
| vegan_ethical | 0.6·vegan_s + 0.2·organic + 0.2·(any ethical label: carbon/b-corp/fair-trade/climatepartner/vegan-society/vegetarian-society) | OFF labels/analysis |
| allergen_coeliac | gluten word (barley/wheat/rye/malt/spelt) in ingredients → 0.1; label en:no-gluten → 1.0; otherwise 0.7 (likely free but unlabelled); −0.1 if ingredients missing | assumption: a coeliac shopper trusts explicit labels. **Whole Earth Organic Cola contains natural barley malt flavouring → 0.1** |
| ai_delegator | 0.4·completeness + 0.4·nutri_map + 0.2·(OFF stores known) | assumption: an LLM shopping agent ranks by machine-readable data quality and Nutri-Score (research/04, research corpus chatgpt_shopping) |
| novelty_seeker_tiktok | 0.55·challenger + 0.45·trend | assumption: the TikTok novelty persona responds to challenger brands and gut/kombucha trends (research/05-personas.md) |

Reproduce: the build script used `pandas` over the parquet with the formulas above. Re-running gives identical scores from the OFF fields listed in each `why`.

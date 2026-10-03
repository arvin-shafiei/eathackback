# frozen_icecream unit: curation and lens-grading rules

Output: `data/products/curated/frozen_icecream.json`. Source pool: `data/products/uk_products.parquet` (Open Food Facts UK).
Every product field comes from its OFF record (`off_url`) unless the field says otherwise. Each lens grade has a `why` list naming the OFF fields used.
All 12 SKUs have an OFF front image.

## Rows (one set per row)

| row | theme | products (role) |
|---|---|---|
| 1 top | take-home tubs: family value vs premium vs clean-label organic | Carte d'Or Madagascan Vanilla 900ml `8711327529793` (incumbent) · Häagen-Dazs Vanilla 460ml `3415581101928` (incumbent) · Booja Booja Chocolate Salted Caramel 465ml `5060002043981` (challenger) · Tesco Soft Scoop Vanilla 2L `5057545473788` (own_label) |
| 2 eye | indulgence & handhelds: the TikTok mochi next to its own-label dupe | Ben & Jerry's Cookie Dough `8711327373105` (incumbent) · Magnum Double Gold Caramel Billionaire 3x85ml `8711327483071` (incumbent) · Little Moons Passionfruit & Mango Mochi 6x32g `5027324001839` (challenger) · Lidl Japanese Style Mochi 6x35g `4056489919094` (own_label) |
| 3 bottom | better-for-you: low-cal, high-protein and dairy-free | Halo Top Chocolate Chip Cookie Dough `5056285800175` (challenger) · Gelatelli (Lidl) Protein Ice Bar 5x50g `4056489411680` (own_label) · Swedish Glace Smooth Vanilla dairy-free `8714100590430` (incumbent) · Northern Bloc Vegan Chocolate & Blood Orange 500ml `5060444911367` (challenger) |

Mix: 5 incumbents, 4 challengers, 3 own-label. The lens axes it spans:
- NOVA 3 vs 4: Häagen-Dazs and Booja Booja are 3, the rest are 4.
- additives: 0 (Häagen-Dazs, Booja Booja) up to 8 (Magnum, Gelatelli).
- organic (Booja Booja) vs not.
- vegan label (Little Moons, Swedish Glace, Northern Bloc).
- gluten-free label (Häagen-Dazs, Little Moons, Swedish Glace) vs wheat or barley (B&J, Halo Top, Gelatelli).
- sweeteners (Halo Top: erythritol and stevia; Gelatelli: xylitol and stevia) vs none.
- palm oil (Tesco, Gelatelli) vs palm-oil-free (Häagen-Dazs, Booja Booja, B&J, Northern Bloc).
- eco-score from a-plus to b.
- unit price from £1.00/L (Tesco 2L) to £24.74/L (Little Moons).

## Incumbent and challenger evidence (sales)
`data/sales/uk_bestsellers.csv` has **no ice-cream rows**, so incumbents come from **The Grocer Top Products Survey 2025 (NIQ data), "Frozen ice cream 2025: pre-spinoff Magnum sees bumper year"**, published 12 Dec 2025: https://www.thegrocer.co.uk/rankings/frozen-ice-cream-2025-pre-spinoff-magnum-sees-bumper-year/713055.article. The tables were read from its datawrapper charts: tubs https://datawrapper.dwcdn.net/S8LHb/1/ and handheld https://datawrapper.dwcdn.net/Zjk0q/1/.

| table | rank | brand (owner) | £m | YoY |
|---|---|---|---|---|
| tubs (category £649.5m, own label £202.1m) | 1 | Ben & Jerry's (Magnum Ice Cream Co) | 160.5 | +6.8% |
| tubs | 2 | Häagen-Dazs (General Mills) | 71.7 | +17.7% |
| tubs | 3 | Carte D'Or (Magnum Ice Cream Co) | 40.0 | +3.5% |
| tubs | 8 | Halo Top (Brand of Brothers) | 12.3 | +5.2% |
| tubs | 9 | Swedish Glace (Magnum Ice Cream Co) | 10.2 | +7.1% |
| handheld (category £1,272.9m, own label £401.0m) | 1 | Magnum (Magnum Ice Cream Co) | 275.1 | +16.0% |

The same article (text) says Booja Booja "entered the top 20 with a value gain of 45.5%", which is why it is the row-1 challenger. Little Moons and Northern Bloc do not appear in the top-10 tables, so their challenger role is an **assumption**: Little Moons is the TikTok mochi brand, and Northern Bloc is an independent vegan brand.
Halo Top is ranked #8 but is still labelled a challenger. This is an assumption: it is the lower-calorie insurgent against the Unilever and General Mills incumbents.
Suggestion for the coordinator: append the rows above to `uk_bestsellers.csv` (table `grocer_top_products_ice_cream_2025`).

## Data caveats (kept visible on purpose)
- **Energy fix (B&J, Carte d'Or).** The OFF `energy-kcal_100g` value conflicts with the OFF macros for two products:
  - B&J: 67.2 kcal against fat 15g and sugar 25g.
  - Carte d'Or: 357.7 kcal against fat 7.5g and sugar 19g.
  - Rule: when OFF kcal is below 0.9× or above 2× the macro floor `4·(sugars+proteins)+9·fat`, use that floor and label it in `why`. Here it gives B&J 251.4 and Carte d'Or 151.9.
- **Halo Top `5056285800175`.**
  - The OFF name is just "Ice Cream". The flavour and the "370 kcal per tub" copy come from the OFF front image (`front_en.3`).
  - The OFF `allergens` field lists only milk, but the ingredients contain wheat flour, barley flavouring and eggs. The coeliac grade uses the ingredients.
  - The ingredients_text is bilingual EN/DE with OCR noise at the end.
  - OFF stores = Monoprix. This is a multi-market tub.
- **Gelatelli `4056489411680`.**
  - The ingredients_text is in German (Lidl multi-market).
  - "350 ml / 250 g, 4.9g protein per bar" is read from the OFF front image (`front_en.49`).
  - Allergen en:gluten comes from OFF.
- **Magnum `8711327483071`.** Multi-market pack. OFF stores include Sainsbury's.
- **Booja Booja `5060002043981`.** OFF analysis is `en:maybe-vegan`, with no vegan label in OFF. It therefore scores vegan_signal 0.5, not 1. That is honest to the OFF data, even though the ingredients contain no animal product.
- **Volumes used for unit price.**
  - Little Moons (192 g) and Lidl mochi (210 g) assume 1 g ≈ 1 ml. This is an assumption for dense mochi.
  - B&J 465 ml, Halo Top 473 ml and Swedish Glace 750 ml are assumptions of the standard UK tub size, because OFF quantity gives grams.
  - The source of each is in `pack_litres_source`.
- **Prices**: all prices are **assumptions** (typical UK RRP, Oct 2026, estimated by the curator; no retailer page fetched). Each `price_source` names the price tier. `price_per_litre_gbp = price_gbp / pack_litres`.
- `sweeteners`: the OFF column is null. It is derived as max(count of sweetener E-numbers e420/e421/e95x/e96x in `additives`, count of distinct sweetener words in ingredients_text: erythritol / stevia / xylitol / maltitol / sucralose / aspartame / acesulfame / sorbitol).
- `palm_oil_n` = number of "palm" mentions in ingredients_text (Tesco: palm stearin, palm oil and palm kernel oil, so 3).
- `ingredients_n` and `recycling` are null or empty in the OFF pool for all 12 products, and are kept that way.

## Shared feature maps
- `add_s = 1 - min(additives_n,10)/10`
- `eco_map`: a-plus 1, a 0.9, b 0.75, c 0.5, d 0.25, e 0.1, f 0; not-applicable/unknown 0.5
- `nutri_map`: a 1, b .75, c .5, d .25, e 0
- `sugar_s = max(0, 1 - sugars_100g/30)`. This is an assumption: 30g/100g is about the top of the set (Lidl mochi 33g).
- `palm-oil-free`: OFF analysis en:palm-oil-free → 1; en:palm-oil or "palm" in ingredients → 0; may-contain or unknown → 0.5
- `vegan_s`: label en:vegan → 1; analysis en:vegan → 0.8; en:maybe-vegan → 0.5; else 0.3
- `serve` (format): individually portioned (sticks, mochi, bars) → 1; pint ≤500ml → 0.5; family tub → 0
- `ppl_s = max(0, 1 - (price_per_litre - 1)/24)`. £1/L → 1 and £25/L → 0. This is an assumption: the UK range runs from an own-label 2L soft scoop to premium mochi.
- `kcal` = OFF energy-kcal_100g, or the macro floor (see caveats)
- `NOVA-4 markers` = e471, e407, e466, e476, e433 in OFF additives. Emulsifiers and thickeners are "cosmetic additives" that mark NOVA 4 (Monteiro et al. 2019).
- `claims` (gimmick cues) = {protein claim (name/pack/label en:protein-source), calorie-count callout ("kcal per" on pack), added fibre (e1200 polydextrose/inulin/chicory), sweetener-based sugar cut}
- `mixed = sugars_100g > 0.5 AND sweetener present`
- `trend` = mochi | protein | yuzu | blood orange | kcal per tub | dairy-free in the name or pack copy

## Lens formulas (all clipped to 0–1)
| lens | formula | grounding |
|---|---|---|
| eco_low_chemical | 0.4·add_s + 0.3·eco_map + 0.2·organic + 0.1·palm-oil-free | assumption: same weights as soft_drinks (CONTRACT example) |
| upf_avoider_parent | 0.4·(4−nova)/3 + 0.2·add_s + 0.2·(no sweeteners) + 0.1·(no NOVA-4 emulsifier/thickener markers) + 0.1·sugar_s | NOVA: Monteiro et al. 2019, Public Health Nutr., "Ultra-processed foods: what they are and how to identify them". Booja Booja on "kitchen cupboard ingredients" amid UPF concern (Grocer article above) |
| glp1_small_appetite | 0.35·sugar_s + 0.25·serve + 0.2·min(fiber/3,1) + 0.2·max(0,1−kcal/300) | assumption: GLP-1 users want small, portioned, low-sugar treats (research/05-personas.md). The portion signal is grounded in pack copy (e.g. Little Moons "77 kcal per mochi") |
| frugal_unit_price | 0.85·ppl_s + 0.15·own_label | verbatims: "Lidl do a range of similar ice cream for less than half the price." (https://www.reddit.com/comments/1e8k6o1); "Aldi's Cookie dough ice cream as opposed to Ben & Jerry's." (https://www.reddit.com/comments/r38ifw) |
| protein_gym | 0.6·min(protein/10,1) + 0.2·sugar_s + 0.2·max(0,1−kcal/300) | verbatim: "the mint choc chip ice cream is fantastic… a fraction of the calories of a normal tub of ice cream but more protein so I can fit it in with my macros" (https://www.reddit.com/comments/191icpc) |
| protein_sceptic_gimmick_reactant | 0.6·(1 − min(claims,3)/3) + 0.2·(no sweeteners) + 0.2·add_s | verbatims: "people who buy an ice cream maker to make ice cream with protein powder… they're lying to themselves" (https://www.reddit.com/comments/1tbf6zw); "do not need high protein cereal or ice cream" (https://www.reddit.com/comments/191icpc) |
| habit_loyalist_shrinkflation_angry | 0.5·incumbent + 0.3·(not mixed) + 0.2·ppl_s | verbatims: "Those individual ice creams. Magnum etc. are now fun-size. Well, not very fun at all." (https://www.reddit.com/comments/1qgcwyr); "Tesco have stopped selling Ben & Jerry's Baked Alaska and Phish Food." (https://www.reddit.com/comments/1e8k6o1) |
| meal_deal_office | 0.4·serve + 0.3·mainstream (incumbent/own_label, or OFF stores lists a major UK grocer) + 0.3·sugar_s | verbatim: "In the Sainsbury I used to go, yes, the ice cream was a snack option." (https://www.reddit.com/comments/1h1g0jq). Single-serve as the meal-deal format is an assumption |
| vegan_ethical | 0.6·vegan_s + 0.2·organic + 0.2·(any ethical label: fair-trade / rainforest-alliance / vegan- or vegetarian-society / EVU / carbon / b-corp / made-with-recycled) | OFF labels/analysis |
| allergen_coeliac | gluten word (wheat/barley/rye/spelt/malt/weizen/gerste; "malt" not followed by o/i, so maltodextrin and maltitol are not gluten) in ingredients, or en:gluten allergen → 0.1; label en:no-gluten → 1.0; otherwise 0.7; −0.1 if ingredients missing | assumption: a coeliac shopper trusts explicit labels. **Halo Top: wheat flour + barley flavouring → 0.1 despite the OFF allergens listing only milk** |
| ai_delegator | 0.4·completeness + 0.4·nutri_map + 0.2·(OFF stores known) | assumption: an LLM agent ranks by machine-readable data quality and Nutri-Score (research/04, corpus chatgpt_shopping) |
| novelty_seeker_tiktok | 0.55·challenger + 0.45·trend | assumption: the TikTok persona responds to challengers and mochi/protein/novel-flavour trends (research/05-personas.md) |

## Headline contrasts the sim should surface
- **Little Moons vs the Lidl mochi dupe** (eye row, adjacent).
  - Novelty: 1.0 vs 0.45. Frugal: 0.01 vs 0.57. Coeliac: 1.0 (gluten-free label) vs 0.7.
- **Halo Top / Gelatelli vs Häagen-Dazs.**
  - Protein-sceptic: 0.06 / 0.04 vs 1.0. UPF-avoider: 0.11 / 0.07 vs 0.67.
  - Protein-gym: Gelatelli is the best at 0.66.
- **Booja Booja** is top for eco_low_chemical (1.0). **Tesco 2L** is top for frugal (1.0) but scores 0.39 on eco.

Reproduce: the build used `pandas` over the parquet with the formulas above. The curator's build script was `build_frozen_icecream.py`, kept in the agent scratchpad and not committed. Re-running these formulas on the OFF fields listed in each `why` gives identical scores.

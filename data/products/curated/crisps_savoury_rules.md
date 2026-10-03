# crisps_savoury: curation and lens-grading rules

Source pool: `data/products/uk_products.parquet` (Open Food Facts UK export). Output: `crisps_savoury.json`.
The generator script was a one-off. Each formula below gives every score exactly, from OFF fields plus the stated assumptions.

## Selection (12 SKUs, 3 rows)
Candidates are rows whose `categories` match crisps|chips|savoury snack|popcorn|puffs|appetizer|salty snack and that have an `image`. Within a brand or sub-type I picked the record with the most `scans` and the highest `completeness`.

| row | theme | SKUs |
|---|---|---|
| 1 | hand-cooked & classic potato | Walkers Cheese & Onion 25g (incumbent), Tyrrell's Lightly Sea Salted 150g (challenger), Kettle Lightly Salted 25g (challenger), Sainsbury's Lightly Sea Salted 150g (own_label) |
| 2 | stacked / baked / popped / veggie cakes | Pringles Sour Cream 165g (incumbent), Walkers Oven Baked Cheese & Onion 6x22g (incumbent), Popchips Sea Salt & Vinegar 85g (challenger), Kallo Lentil & Pea Veggie Cakes 122g (challenger) |
| 3 | legume / free-from vs discounter | Eat Real Lentil Chips 95g, Proper Sea Salt Lentil Chips 85g, Mister Free'd organic Blue Maize Tortilla 135g (challengers), Lidl Lentil Bites 110g (own_label) |

Known gaps, stated rather than hidden:
- **Sweeteners.** No UK crisp in the pool has `sweeteners>0`, so every SKU here is 0.
- **Palm oil.** OFF `palm_oil_n` is null for every crisp. Palm status comes from the OFF `analysis` tag instead. Only Pringles is `en:may-contain-palm-oil`; every other SKU is `en:palm-oil-free`. Confirmed palm-oil products in this category are crackers and oatcakes (Ritz, Nairn's, Jacob's), not crisps.
- **ingredients_n.** OFF `ingredients_n` is null. I count the top-level comma-separated items in `ingredients_text` after removing bracketed sub-ingredients.
- **Data errors kept as-is.** Walkers 51000005 has `salt_100g=0.0029`, which is almost certainly an entry error, and no grade uses salt. Pringles 5053990127740 carries the German ingredients panel for the same EAN.

## Prices
None of the prices were scraped. Each `price_source` reads `"assumption: typical UK RRP … <band/reason>"`. `unit_price_per_100g = price_gbp / pack_g * 100`. Swap in real retailer prices when you have them; the frugal and habit grades update mechanically.

## Shared maps (all assumptions, chosen to be monotonic and simple)
- `add_s = 1 - min(additives_n,10)/10` (OFF additives_n)
- `nova_s`: NOVA 1→1.0, 2→0.75, 3→0.5, 4→0.0 (OFF nova)
- `eco_s`: a-plus 1.0, a 0.9, b 0.7, c 0.5, d 0.3, e 0.15, f 0, unknown 0.4 (neutral-ish; assumption) (OFF ecoscore)
- `nut_s`: a 1, b .75, c .5, d .25, e 0, unknown .4 (OFF nutriscore)
- `organic` = `en:organic` in labels; `vegan` = `en:vegan` in analysis or labels; `palm_free` = `en:palm-oil-free` in analysis; `gf` = `en:no-gluten` in labels

## Lens formulas (score 0-1)
| lens | formula | OFF fields |
|---|---|---|
| eco_low_chemical | 0.4·add_s + 0.3·eco_s + 0.2·organic + 0.1·palm_free | additives_n, ecoscore, labels, analysis |
| upf_avoider_parent | 0.5·nova_s + 0.3·add_s + 0.2·short, where short = 1 if ≤5 top-level ingredients, else max(0, 1-(n-5)/10) | nova, additives_n, ingredients_text |
| glp1_small_appetite | 0.4·portion + 0.3·min(protein,20)/20 + 0.3·min(fibre,6)/6, where portion = 1 (≤30g), .6 (≤50g), .3 (≤100g), 0 (larger) | quantity, proteins_100g, fiber_100g |
| frugal_unit_price | clamp((3.00 - £/100g)/(3.00-0.60), 0, 1) | price (assumption) + quantity |
| protein_gym | 0.8·min(protein,25)/25 + 0.2·[en:high-proteins] | proteins_100g, labels |
| protein_sceptic_gimmick_reactant | 0.5·nova_s + 0.3·add_s + 0.2·(1 - min(claims,3)/3), where claims = count of labels in {high-proteins, source-of-proteins, rich-in-vegetable-protein, high-fibres, source-of-fibre} plus 1 if the name contains protein/veggie/lentil/hummus/pea | nova, additives_n, labels, name |
| habit_loyalist_shrinkflation_angry | 0.6·familiarity + 0.4·frugal, where familiarity = incumbent 1, own_label .6, challenger .2 | role (curation), price |
| meal_deal_office | 0.6·[pack ≤45g] + 0.4·[brand commonly in UK meal-deal crisp ranges: Walkers, Kettle, Tyrrell's, Popchips, Proper, Eat Real, Pringles] (assumption) | quantity, brand |
| vegan_ethical | 0.6·vegan + 0.2·palm_free + 0.2·[organic or B-Corp or TerraCycle label] | analysis, labels |
| allergen_coeliac | 0 if gluten is in allergens; otherwise 0.6·gf + 0.4·[no wheat/gluten/barley in ingredients_text and no "may contain" for them] | allergens, labels, ingredients_text |
| ai_delegator | 0.4·completeness + 0.35·nut_s + 0.25·add_s. Assumption: LLM shopping agents rank on structured, complete data, mainly Nutri-Score and additives | completeness, nutriscore, additives_n |
| novelty_seeker_tiktok | 0.5·novelty + 0.3·[non-potato base: lentil/pea/corn/maize/chickpea] + 0.2·[flavoured], where novelty = challenger 1, own_label .3, incumbent 0 | role, ingredients_text, name |

## Reddit grounding for the role-driven lenses (data/reddit/comments.csv)
- Habit loyalty to Walkers despite going own-brand elsewhere: "there are a couple of things I still buy branded because I just like the taste so much … Heinz soup, Branston pickle, and Walkers crisps." https://www.reddit.com/comments/1ow5fne
- Shrinkflation anger at Pringles and Kettle: "Pringles is my issue mate, they're trying to pass off 150g tubes as the old 200g" https://www.reddit.com/comments/82m9zj and "Kettle chips. Higher in price and smaller bad [sic]." https://www.reddit.com/comments/1tsbmt5
- Own-label comes from the same factories: "Own brand from most supermarkets is made by branded companies usually … Source: I work for Kettle Chips" https://www.reddit.com/comments/1511znd
- Meal-deal pack-size logic: "Imagine buying a different flavour of crisps to the one you prefer just because the packet is bigger." https://www.reddit.com/comments/1bc79kh

## pack_copy
`pack_copy` is built only from the OFF `name` plus mapped OFF labels (gluten free, vegan, organic, high protein, high fibre, no artificial flavours/colours, no MSG, B Corp, no GMOs, made in England, kosher). It adds "suitable for vegans" when OFF analysis says vegan, and "no additives listed" when `additives_n=0`. Nothing is invented.

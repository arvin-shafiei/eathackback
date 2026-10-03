# shopper surface: basket swaps

> "You've got **Kellogg's Krave** in your basket. **Weetabix Original** has a lot more fibre and far less sugar, and it's 65p cheaper."

When something goes in the basket (in store via a shelf tag or app, or online), we suggest one same-category alternative that is better for *this* shopper's goals. We only suggest it if they are likely to accept it.

Code: `sim/swaps.py` · outputs: `data/sim/swaps/` · engine: TypeSafe **Jev** (`jev-latest`) through `sim/jev.py`'s `ask()` (disk cache, cost log, spend guard). No other LLM is used.

## How it works

1. **Find candidates (code, OFF data).** For each basket item, look in `catalog.json` for same-category products where:
   - the persona's lens grade goes up by more than 0.02. The grade is `lens_grades[archetype].score`, computed from OFF fields, and each one keeps its `why` trail.
   - at least one OFF health field improves by an amount a shopper would notice: fibre +1 g/100 g, sugar −2 g, protein +3 g, salt −0.2 g, or one fewer additive, sweetener, NOVA level or palm-oil ingredient, or the product gains organic. These minimums are an assumption, stated in the output.
   - the persona's hard gates pass. The coeliac persona never gets a product with gluten, and the vegan persona only gets products labelled vegan.

   We keep the top 2 per basket item by lens improvement. Every rejected candidate is logged in `considered[].dropped` with the reason.
2. **Compute deltas, then turn them into words (code).** Each delta is computed in code, for example fibre +Xg/100g, sugar −Yg, price Δ£ and Δ%, and unit price per 100 g/ml (`price_gbp` divided by the parsed OFF `quantity`). Jev is given only bucketed words such as *"a lot more fibre (high fibre)"* or *"about 65p more per pack (about 1.5x the price); much worse value per 100g/ml"*. This follows jaggedness rule #2: keep arithmetic in code.
3. **Judge the swap (Jev, one fan-out request per swap).** The request holds a small state: a shopper summary (dossier, mission, OCEAN phrases, top lens priorities, every rejection trigger, trust signals), both product cards (front and back of pack), and the swap words. It asks these questions:

| id | primitive | question |
|---|---|---|
| `accept` | Noul | The shopper already has `basket_item`. A shelf tag or app suggests `alternative`. Would they swap? |
| `benefit` | Score (5 levels) | How much real benefit do they see in `alternative` over `basket_item`, judged against their priorities? |
| `price_worth` | Noul | Is `swap.price_change` worth it for what `alternative` offers? |
| `alt_trig_k` | Noul ×k | Does the **alternative** itself have rejection trigger k? This is why they would refuse. |
| `base_trig_k` | Noul ×k | Does the **basket item** have trigger k? This shows which put-offs the swap removes. |

4. **Rank (code).** `rank = P(accept) × Δlens`. Each swap also records `refusal_reasons` (trigger Nouls above 0.5 on the alternative, with the persona's sourced trigger and a matching Reddit/Mumsnet verbatim), `triggers_removed_by_swap`, and `p_price_worth`.

### Every number traces to a source
Each swap in `data/sim/swaps/<persona>_<run>.json` carries:
- `lens`: both lens scores and their `why` lists, taken from OFF fields.
- `health_deltas`: each field with its basket value, alternative value, delta, the words Jev saw, and both OFF URLs.
- `price`: the shelf and unit-price change, the parse method, both `price_source` strings, and a flag for each saying whether it is an assumption.
- `jev`: every probability, the Score distribution and confidence, the cache key, tokens, cost, and the exact `state_sent`.
- `claim_premium_context`: for each claim the alternative is marketed with, the median catalogue premium for that claim.

### Jev prompt fixes we needed (found by testing; the generated outputs include all of them)
- **Indirection (jaggedness #4).** At first the trigger Nouls pointed at `shopper.put_offs[k]` by reference. Jev then said Weetabix "has sweeteners" with p = 0.86. We now put the trigger text and its `off_check` directly into the question, and ask it about one product card only. After that change, Weetabix gets p = 0.04 for sweeteners, Diet lemonade gets p = 0.98, and Surreal (sucralose) gets p = 0.70.
- **Literal reading (jaggedness #1).** When a field was missing, Jev read it as "can't tell". The card now says "no sweeteners or polyols listed" whenever OFF reports zero sweeteners.

## Results (real Jev runs, 3 Oct 2026)

| persona | basket source | top swap | P(accept) | Δlens | main refusal risk |
|---|---|---|---|---|---|
| GLP-1, small appetite | demo basket (5 items) | Krave → **Weetabix Original**: high fibre, far less sugar, 65p cheaper | 0.76 | +0.53 | none fired |
| | | Activia Strawberry → **Total 0%**: low sugar, more protein, no additives, about 2× the price | 0.69 | +0.47 | share-size tub (p = 0.66) |
| | | Coca-Cola → **Gut Lovin' Soda**: more fibre, low sugar, 65p more | 0.41 | +0.53 | still carbonated (p = 0.79), price not worth it (p_worth = 0.25) |
| | | *Coca-Cola → Diet lemonade (ranked 8th)* | 0.18 | | **sweeteners p = 0.98** |
| UPF-avoider parent | run `…120130_s3_jev_c554` a004 | Vanilla Choc Balls yoghurt → Plain Soya: low sugar, no additives | 0.33 | +0.85 | |
| protein sceptic | same run | Lentil & Pea cakes → Lightly Salted chips: not ultra-processed, 85p cheaper | 0.34 | +0.45 | |
| eco / low-chemical | same run | Everyday Essentials Soya → Organic soya drink: no additives, organic, £1.31 more | 0.48 | +0.52 | |

The diet-lemonade case shows why Jev is in the loop. A lens built only on sugar would push Diet lemonade, but this shopper refuses on sweeteners. The sweeteners trigger fires on the alternative, and P(accept) drops to 0.18.

## Do claim-marketed products cost more? (`data/sim/swaps/claim_premium.{json,md}`)

**Method.** For each claim product, premium = its price ÷ the median price of the **same-category** products *without* the claim − 1. We report the median across products, with a bootstrap 95% CI. Claim detection uses regex over `pack_copy` and the product name, plus OFF label tags.

**Price caveat.** 85 of the 96 catalogue prices are curator assumptions (`price_source: "assumption: ..."`).

| claim | n | unit-price premium (median) | 95% CI | share dearer per 100 g/ml |
|---|---|---|---|---|
| fibre / prebiotic | 13 | **+24%** | [+10, +88] | 85% |
| protein | 15 | +25% | [−3, +153] | 73% |
| gut (pre/probiotic, live cultures, kefir) | 8 | +54% | [−29, +99] | 63% |
| organic | 9 | +8% | [−21, +146] | 67% |
| no added sugar | 9 | +3% | [−61, +67] | 56% |

The only claim whose CI clears zero is fibre: fibre-marketed products cost more per 100 g. The prices behind it are mostly assumptions, so treat it as directional.

**Claim vs reality in the OFF UK pool** (36,548 products, no prices). Thresholds are from Reg (EC) 1924/2006:
- 'High fibre' claims: 93% meet the legal test (≥6 g/100 g *or* ≥3 g/100 kcal). On the strict ≥6 g/100 g test alone the figure is 87% (362 of 416).
- In the catalogue, the two prebiotic sodas (2.4 g and 1.2 g fibre per 100 ml) count as "high fibre" only through the per-100 kcal route, and they carry the biggest premiums (+71% and +89% per 100 ml).
- **6,865 products with no fibre claim already qualify for 'high fibre'**, 4,457 of them on ≥6 g/100 g alone. That makes the cheaper better-for-you swap often an *unmarketed* product. Code finds these from OFF nutrition, not from the pack copy, and they are the honest-claim lever that `sim/optimise.py` uses.
- 'Protein' claims: 87% get ≥20% of their energy from protein.
- 'No added sugar': median total sugars is 4.1 g/100 g, and only 61% are also 'low sugar'.

## The three surfaces: what this feeds
- **Shopper:** the swap card itself, showing the reason, the price in words and P(accept).
- **Store owner:** swaps with high acceptance point to products to place next to the basket incumbent (same unit, adjacent facings). Products that get rejected often (`refusal_reasons`) are candidates for a facing cut.
- **Brand:** `triggers_removed_by_swap` and `refusal_reasons` per product tell a challenger which put-off costs it the swap (for example, carbonation for the gut sodas). `p_price_worth` shows whether its premium is justified to each persona.
- **E-commerce / agent:** the output is plain JSON keyed by OFF barcode, so it plugs into an online basket's "you might swap" slot with no change.

## Run it
```bash
python3 sim/swaps.py --claims                                                    # premium analysis, no Jev calls
python3 sim/swaps.py --persona p_glp1_small_appetite \
  --basket 5000112545326,5060088709047,5059319015279,5060360506128,5000157062673 --top 3 --name demo_basket
python3 sim/swaps.py --from-run data/sim/runs/run_20261003_120130_s3_jev_c554.json --persona p_upf_avoider_parent --top 3
python3 sim/swaps.py --from-run <run.json> --agent a004       # basket = that agent's picks
# --per-item N (candidates per basket item, default 2), --dry (build requests, no calls)
```
**Cost:** about 3.6k input tokens per swap, which is about **$0.00015 per swap** ($0.042 per 1M input tokens; output is free). All testing in this session took 72 requests and 251k tokens, for **$0.0106**.

# ecom-rerank

This module re-ranks a product listing page for a kind of shopper and explains every position. It also checks how **agent-ready** the listing data is: which fields an AI shopping agent needs but can't find.

The judgment calls go to TypeSafe Jev (`jev-latest`, via `sim/jev.py::ask`, disk-cached, cost-logged). Code does all the arithmetic.

## how it works

1. **Who is shopping.** Either pass `--archetype` (one of the 12 lens archetypes in `data/personas/lens/`), or pass anonymous `--signals`. With signals, one Jev **Choice** picks from the 12 archetypes plus `unclear`. Option order is shuffled and recorded (jaggedness #8). If the answer is `unclear`, the listing gets a neutral ranking and is not personalised.
2. **Fit.** One Jev request asks two questions per product:
   - a **Score** of fit to the shopper's own priorities, with 5 described levels;
   - a **Noul**, "does it clearly show one of the shopper's put-offs?"

   Product cards are words, not numbers: price bands, traffic lights and "high fibre" are computed in code by `jev.feed_state_item`. Products are shuffled in state so their list position can't leak into the answers.
3. **Compose in code.** `final = 0.4·lens + 0.6·fit − 0.3·P(put-off)`. Here `lens` is the code-computed `lens_grades[archetype].score` from `catalog.json`, with its `why` list of OFF fields. The weights are labelled assumptions and come back in the output, so a merchandiser can change them without re-running inference.
4. **Explain.** Each row carries the formula with its numbers, the fit-level probabilities, confidence, P(put-off), the lens `why`, the move from the original position and the OFF link.
5. **Agent readiness** is code only. It checks 17 fields an AI agent uses: GTIN, price and whether it is verified or estimated, unit price, allergens, nutrition, ingredients, rating/reviews and so on. Each field carries a weight, the reason and a source (ACES arXiv 2508.02630 coefficients, Reg. 1169/2011, schema.org, the Google Merchant spec). The honest fix is to fill true missing data, never to add prompt text.

## run

```bash
python3 integrations/ecom-rerank/rerank.py --category breakfast_cereal --archetype glp1_small_appetite --out integrations/ecom-rerank/example_output_glp1_cereal.json
python3 integrations/ecom-rerank/rerank.py --category snack_bars \
  --signals "searched: high fibre snack" "viewed: Fibre One bar" "removed from cart: chocolate protein bar (sweeteners)" "filter applied: under £2" \
  --out integrations/ecom-rerank/example_output_session_snackbars.json
python3 integrations/ecom-rerank/rerank.py --category yoghurt --readiness-only
```

Over HTTP: run `python3 integrations/api_server.py`, then `POST /v1/ecom/rerank` with `{"listing": [barcodes or product objects], "archetype" | "session_signals"}`.

As a library:

```python
sys.path += ["sim", "integrations", "integrations/ecom-rerank"]
import rerank; from common import load_personas
out = rerank.rerank(listing_products, "glp1_small_appetite", load_personas())
```

## measured (real Jev calls, 3 Oct 2026)

| example | result | tokens | cost |
|---|---|---|---|
| GLP-1 shopper × 12 breakfast cereals | Tesco Wheat Biscuits rises 7 places to #1. Surreal Chocolate drops to #11 *despite* a lens grade of 0.84, because Jev puts P(put-off) = 0.98 (it reads the sweetener and the dessert flavour, both on the persona's put-off list) | 5,659 | $0.00024 |
| session signals → archetype | `glp1_small_appetite` p = 0.68 (upf_avoider_parent 0.18), confidence 0.64 | 1,244 | $0.00005 |
| inferred shopper × 12 snack bars | Grenade High Protein Oreo and the salted-caramel protein flapjacks drop to the bottom (P(put-off) 0.98 / 0.96) | 5,979 | $0.00025 |

Example outputs: `example_output_glp1_cereal.json` and `example_output_session_snackbars.json`.

## honest limits

- The original order is `catalog.json` order, standing in for the retailer's real ranking. A real integration passes its own order in.
- `rating_reviews` is missing for every product because OFF has no ratings. That is a real gap: the ACES study shows agents weight ratings heavily.
- `price_verified` fails wherever `price_source` begins with "assumption". Most catalog prices are curator estimates, and the output says so.
- The fit weights have not been tuned. They need click and purchase outcomes before anyone claims a lift.

# connecting a challenger brand on Shopify

Many RGC-club challengers sell direct on Shopify before (and alongside) grocery listings. This page covers how their store would connect to the shelf sim, the funnel and the agent-readiness check.

**Status, honestly:** nothing on this page is built yet. It is a design that maps onto pieces that *are* built:
- `integrations/openapi.yaml` (spec)
- `integrations/api_server.py` (local server)
- `integrations/ecom-rerank/rerank.py` (readiness and re-rank)
- `integrations/widget/` (embed)
- `integrations/common.py::brand_funnel` (funnel maths)

No Shopify app exists, no OAuth app is registered and no webhook endpoint is deployed.

## 1. product feed → catalog shape

Read the products through the Admin GraphQL API (`products` query, read-only scope `read_products`), then map:

| catalog.json field (CONTRACT.md) | Shopify source | notes |
|---|---|---|
| `code` | `variant.barcode` | must be a GTIN/EAN. If it's empty the product can't be matched to Open Food Facts, which is flagged as a readiness gap |
| `name` | `product.title` (+ `variant.title` if not "Default Title") | |
| `brand` | `product.vendor` | |
| `category` | `product.productType` or `product.category` (Shopify Standard Product Taxonomy) → one of our 8 categories | mapping table per brand; anything unmapped is skipped, not guessed |
| `role` | always `challenger` for the connecting brand | the incumbent and own-label comparators come from `catalog.json` |
| `price_gbp` | `variant.price` (GBP market) | `price_source: "shopify:<shop>/products/<handle> <date>"`, so it counts as **verified**, unlike our curator estimates |
| `price_per_kg_gbp` / `_litre_` | computed in code from price and `variant.weight` / `unitPriceMeasurement` | |
| `quantity` | `unitPriceMeasurement` or `variant.weight` + unit | |
| `pack_copy` | the first 220 characters of `product.description`, HTML stripped | **only true claims**. A nutrition claim in the copy is checked in code against the OFF/metafield value (Reg. 1924/2006 thresholds) and flagged if unsupported |
| `ingredients_text`, `allergens`, nutrition `*_100g`, `labels` | metafields (`custom.ingredients`, `custom.allergens`, `custom.nutrition_per_100g`) **or** Open Food Facts by barcode | OFF wins when present: open, sourced, traceable. Metafields fill the gaps, and the source records which one was used |
| `image` | `product.featuredImage.url` | |
| `rating`, `reviews_n` | review-app metafields (e.g. `reviews.rating`, `reviews.rating_count`, the Shopify standard) | this is the field OFF *doesn't* have, and the one AI agents weight most (ACES rating +4.91) |
| `lens_grades` | computed by our grader from the fields above | the same code as the curated catalog |

Then run `agent_readiness()` on every mapped product. That gives the brand the "what's missing for AI shopping agents" list immediately, at no model cost.

## 2. webhooks (keep the copy fresh)

| topic | action |
|---|---|
| `products/update` | re-map → re-grade → invalidate cached Jev answers for that product (the cache key is the state, so changed copy produces a new key automatically) |
| `products/delete` | drop it from the brand's virtual shelf |
| `app/uninstalled` | delete the brand's mapped catalog and tokens within 48 h (see `docs/data-collection.md` retention) |
| GDPR mandatory: `customers/data_request`, `customers/redact`, `shop/redact` | we store **no customer data** from Shopify. We answer `data_request` with "none held" and act on `shop/redact` |

Verify every webhook with the `X-Shopify-Hmac-Sha256` header before doing anything with it.

## 3. what the brand sees

1. **A virtual listing test.** Their SKU goes into its category slot next to the incumbent and own-label from `catalog.json`. Then `POST /v1/shelf/simulate` (synthetic shoppers in store) and the AI-agent arm (`sim/agent_shopper.py`) run against it.
2. **A funnel and the top put-back reason** in `<shelf-insight>` on their Shopify admin page (an app block or an embedded admin page), the same component as `integrations/widget/`.
3. **Honest fixes** via `POST /v1/brand/pack-test`: surface a true claim, fill missing fields, test a price. Each comes with a Δpick and a CI.
4. **A weekly Slack digest** (`integrations/slack/weekly_digest.py`).

## 4. their own store's funnel (optional, real data)

The online equivalent of the shelf funnel comes from Shopify's Web Pixels API (customer events):
- `product_viewed` → noticed
- `product_added_to_cart` → considered
- `product_removed_from_cart` → put back
- `checkout_completed` → kept

Collection-page impressions need a small theme pixel. These are aggregated per SKU per day, with k ≥ 10 before export, so no customer IDs ever leave Shopify. This is the brand's own real funnel, which calibrates the synthetic one (see `docs/data-collection.md`, calibration path).

## 5. what we would not do

- We don't write to the brand's store. All scopes are read-only, except an optional app-block install.
- We don't put generated "agent-bait" text into descriptions. Edits are only ever true facts.
- We don't use customer-level data, and nothing from one brand is shared with another.

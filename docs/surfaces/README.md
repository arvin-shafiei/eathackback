# three surfaces, one shelf

The same simulation serves three audiences, and each gets embedded where it already works. One funnel shape (shown → looked → picked up → kept, plus the walked-away and put-back leaks) runs through all of them, offline and online. See [`../data-collection.md`](../data-collection.md#the-4-stage-funnel).

```
                       data/sim/runs/*.json  (every decision logged: persona, OCEAN, fields read, Jev probabilities, source)
                                  │
         ┌────────────────────────┼─────────────────────────┐
     1. brand                2. retailer                3. shopper
  funnel + put-back       layout what-ifs           better-fit swaps,
  reasons, pack tests     by mission                re-ranked listings
         │                        │                         │
         └──────── integrations/openapi.yaml (/v1/...) ─────┘
                 widget · slack digest · ecom re-rank · shopify
```

## 1. brand

**The question:** *is anyone interested in my product, where do I lose them, and why?*

- **The funnel per SKU**: how many shoppers looked at it and walked away, and how many picked it up and put it back. EPOS can't see either. Built: `integrations/common.py::brand_funnel`, served at `POST /v1/brand/funnel`.
- **Put-back reasons**: a mechanism (habit, price anchor, gimmick reactance and so on) with a logged example and the persona's own verbatim. Built in the sim run logs.
- **Pack tests and honest fixes**: surface a true claim, adjust facings or price, and get Δpick with a CI. Built: `sim/optimise.py`, proxied as `POST /v1/brand/pack-test`.
- **AI-agent visibility**: will ChatGPT or the Tesco agent pick it? Built: `sim/agent_shopper.py`, plus the agent-readiness field check in [`../../integrations/ecom-rerank`](../../integrations/ecom-rerank/README.md).
- **Where it's embedded**:
  - [`<shelf-insight>`](../../integrations/widget/) on a product page or intranet
  - the [weekly Slack digest](../../integrations/slack/weekly_digest.py)
  - [Shopify](../../integrations/shopify/README.md) for DTC challengers (designed)

## 2. retailer / shop owner

**The question:** *which layout best fits the missions my shoppers come in on?*

- **Layout what-ifs**: move a set to eye level or add facings, then re-run the same shoppers with common random numbers and get the lift per mission and archetype. Partly built: per-product edits via `sim/optimise.py`, proxied as `POST /v1/retailer/layout`. Whole-store annealing with HFSS rules is designed.
- **Why they're shopping**: missions (weekly shop, top-up, meal deal, treat, gym) drive which aisles each shopper walks and what they notice. The real-data versions (intercept question, app prompt, basket → mission via Jev) are in [`../data-collection.md`](../data-collection.md#surface-2-the-retailer--shop-owner).
- **Big shops vs top-ups**: big shops follow a memorised route, so moving things causes abandonment, not discovery (human truth #2). Top-ups live at eye level. The two get separate layout recommendations.
- **Where it's embedded**: the 3D store web app (`web/`), the same widget on a category-review intranet page, and the API.

## 3. shopper

**The question:** *help me find what fits me, e.g. a genuinely high-fibre version of what's already in my basket.*

- **Swaps from the basket**: for each item, find a same-category product that passes the claim threshold *in code* from OFF data (high fibre ≥ 6 g/100 g). Jev judges fit, and whether the swap would feel like a gimmick to this shopper. **The price difference is always shown**, because high-fibre-marketed products tend to cost more. Designed: `POST /v1/shopper/swaps` is specified in the OpenAPI spec and returns 501 from the demo server until a swaps module exists.
- **Re-ranked listings**: an anonymous session's signals go through a Jev Choice to an archetype, then the listing is re-ranked with an explanation per position. Built: [`../../integrations/ecom-rerank`](../../integrations/ecom-rerank/README.md).
- **Place products where this shopper will look**: in store, that's the retailer layout for the shopper's mission. Online, it's the re-rank.

## embed and integrate (what to hand an engineer)

| piece | path | status |
|---|---|---|
| REST spec for all surfaces | [`integrations/openapi.yaml`](../../integrations/openapi.yaml) | built (spec) |
| local API server | [`integrations/api_server.py`](../../integrations/api_server.py) (:8788) | built: funnel, rerank, readiness · proxied: simulate, layout, pack-test · designed: swaps |
| e-com re-rank + agent readiness | [`integrations/ecom-rerank/`](../../integrations/ecom-rerank/README.md) | built, tested with real Jev calls |
| web component | [`integrations/widget/`](../../integrations/widget/) `<shelf-insight product api>` | built (static fixture or live API) |
| Slack weekly digest | [`integrations/slack/weekly_digest.py`](../../integrations/slack/weekly_digest.py) | built (dry-run by default; never posts unless `--post` and a webhook URL are given) |
| Shopify connection | [`integrations/shopify/README.md`](../../integrations/shopify/README.md) | designed |
| data collection, privacy, cost | [`docs/data-collection.md`](../data-collection.md) | written |

Every number carries its inputs and sources: run ids, OFF fields, Jev probabilities with option order, or a labelled `assumption:`.

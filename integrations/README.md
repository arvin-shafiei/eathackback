# integrations

This folder makes the shelf sim usable from a workplace (intranet, Slack) and from e-commerce (listing re-rank, agent readiness, Shopify). The overview is in [`../docs/surfaces/README.md`](../docs/surfaces/README.md). What a real deployment collects is in [`../docs/data-collection.md`](../docs/data-collection.md).

The only model used is TypeSafe Jev (`jev-latest`, through `sim/jev.py::ask`, disk-cached in `data/sim/cache/jev/`, costs appended to `data/sim/cost_log.jsonl`). Everything else is counting and code.

| path | what it is |
|---|---|
| `openapi.yaml` | the REST API for all three surfaces (`/v1/brand/funnel`, `/v1/brand/pack-test`, `/v1/retailer/layout`, `/v1/shopper/swaps`, `/v1/shelf/simulate`, `/v1/ecom/rerank`, `/v1/ecom/readiness`) with an honest build-status table |
| `api_server.py` | stdlib server for the spec on :8788. Proxies the simulate, layout and pack-test endpoints to `sim/server.py` |
| `common.py` | loads the catalog and personas; `brand_funnel()` counts the 4-stage funnel from run logs with Wilson CIs |
| `ecom-rerank/` | re-rank a listing for an archetype or anonymous session (Jev Choice, Score and Noul), plus the agent-readiness check |
| `widget/` | `<shelf-insight product api>` vanilla web component, a demo page and a fixture builder |
| `slack/` | weekly brand digest as Block Kit (dry-run by default) |
| `shopify/` | how a DTC challenger on Shopify would connect (designed, not built) |

## run

```bash
# API
python3 integrations/api_server.py                       # :8788
curl -s localhost:8788/v1/brand/funnel -d '{"product":"5000168036755"}'
curl -s localhost:8788/v1/ecom/rerank -d '{"listing":["5070000126579","5060043225353"],"archetype":"glp1_small_appetite"}'

# e-com re-rank (real Jev calls, about $0.0003 each)
python3 integrations/ecom-rerank/rerank.py --category breakfast_cereal --archetype glp1_small_appetite
python3 integrations/ecom-rerank/rerank.py --category snack_bars --signals "searched: high fibre snack" "removed from cart: chocolate protein bar (sweeteners)"

# widget
python3 integrations/widget/build_fixture.py             # re-count fixture.json from the latest runs
python3 -m http.server -d integrations/widget 8123       # open http://localhost:8123

# slack digest (prints and writes example_digest.json; posts only with --post + SLACK_WEBHOOK_URL)
python3 integrations/slack/weekly_digest.py --top 3
python3 integrations/slack/weekly_digest.py --brand "McVitie's"
```

Set `SHELF_API_TOKEN` to require `Authorization: Bearer <token>` on the API. Set `SIM_SERVER` if `sim/server.py` isn't on :8787.

# what a real deployment collects, and why

Today the shoppers are synthetic: deep personas walking a 3D store of real Open Food Facts products, with TypeSafe Jev making the judgments. This page covers what a **real** deployment would collect to calibrate those personas and replace them where possible. It is organised by surface, and for each item it says why we need it, how we would get it, and what we would refuse to collect.

> Rule we build by: *"A number that cannot be traced back to its source is worse than no number at all."* Every collected signal keeps its provenance (device, store, time window, consent basis) all the way to the stat it feeds.

Status key: **built** = running in this repo · **designed** = specified here, not built.

---

## the 4-stage funnel

The same four stages work in a store and online. That shared structure is what lets one API (`integrations/openapi.yaml`) serve both channels.

| stage | in store (offline) | online (e-commerce event) | in the sim today (built) |
|---|---|---|---|
| **shown** | the shopper's path passes the shelf bay | impression: the product tile rendered in the viewport | `shown`: the agent's path visited the slot |
| **noticed** | they look: gaze or dwell ≥ ~1 s facing the bay | product-detail view, or a tile hover/zoom of ≥ 1 s | `noticed`: the literature-calibrated notice gate fired |
| **considered** | **pick-up**: the product leaves the shelf | add-to-cart | `considered`: Jev's appeal and decision stage |
| **kept** | it is in the basket at checkout | purchase | `picked` |
| *leak:* looked, walked away | dwell with no pick-up | PDP view with no add-to-cart (a bounce) | `noticed − considered` |
| *leak:* **put back** | the product returns to the shelf | remove-from-cart, or an abandoned cart | `rejected` |

The two leaks matter most to a brand, because EPOS sees neither. *Looked and walked away* means the pack got attention but didn't convert, which points at the pack or the price. *Picked up and put back* means the back of pack, the price or the claim lost the sale.

`integrations/common.py::brand_funnel` (built) computes exactly these counts from run logs, with Wilson 95% CIs. The widget and the Slack digest render them.

---

## surface 1: the brand

**What they want:** is anyone interested in my product, at which stage do I lose them, and why?

| signal | how we'd collect it | why | status |
|---|---|---|---|
| shelf funnel per SKU (shown / looked / picked up / kept / put back) | **shelf sensors**: weight or load-cell strips per facing give pick-up and put-back events. **CV**: a shelf-edge camera does on-device person and hand detection and emits only counts (see privacy) | the walk-past and put-back numbers EPOS can't see | designed (the sim produces the same shape) |
| e-com funnel per SKU | retailer analytics events: impression → PDP → add-to-cart → remove → purchase, aggregated per SKU per day | the online equivalent, and usually the first data a challenger can get | designed; API shape built |
| put-back reason | (a) a 1-tap intercept on the scan-and-go app or the e-receipt ("you put back X, why?" with options shuffled per user); (b) Jev inference from the context, e.g. a price ladder or a cheaper own-label at the same moment | the "why" behind the leak | (b) built in the sim (`mechanism` per event); (a) designed |
| pack and claim tests | A/B of honest edits only: a true claim the OFF data supports, a true description, price | the lift with a CI, not an opinion | built in the sim (`sim/optimise.py`) |

## surface 2: the retailer / shop owner

**What they want:** a layout that fits the missions their shoppers come in on, and range decisions backed by evidence.

| signal | how | why | status |
|---|---|---|---|
| **mission per trip** ("why they're shopping") | (1) an **intercept question** at the entrance or in the app: "what's today's trip?" with a shuffled choice of weekly shop / top-up / meal deal / treat / gym / for the kids; (2) an **app prompt** at basket start; (3) **basket inference**: Jev reads the basket contents as words (e.g. "12 items, 3 chilled, a meal-deal set") and returns a Choice over missions with probabilities | the notice and choice models are mission-conditional (`MISSION_CATEGORIES` in `sim/run.py`), so the store layout should be too | (3) is cheap: one Choice of about 1k tokens, roughly $0.00004 a basket; designed |
| **long / big shops vs top-ups** | trip length (entry to checkout timestamps), basket size and value banded *in code* into words (top-up < 10 items, < 15 min; big shop ≥ 30 items) | big shops follow a memorised route (human truth #2: disruption leads to abandonment, not discovery), while top-ups are fast, eye-level and mission-only. Layout changes affect the two in opposite ways | designed |
| path and dwell per bay | ceiling CV that emits only zone-level counts and dwell histograms; or Wi-Fi/BLE presence with opt-in only | drives P(notice) per slot instead of the literature prior | designed |
| out of stock | shelf-gap CV or sensor | an OOS slot can't be noticed; Gruen et al. (2002) substitution splits | designed |

## surface 3: the shopper

**What they want:** to find the products that fit their goals more easily, e.g. a **true high-fibre alternative** to something already in the basket.

| signal | how | why | status |
|---|---|---|---|
| basket contents | online cart, or scan-and-go | swaps work from what's already in the basket ("you have X; Y is high fibre and is the same kind of product") | API designed (`/v1/shopper/swaps`) |
| stated goals | an opt-in profile: high fibre / low sugar / GLP-1 friendly / vegan / allergens | maps to a lens archetype; nothing inferred about health without consent | designed |
| anonymous session signals | searches, filters, views and removes in this session only | Jev Choice → archetype → re-rank (`integrations/ecom-rerank`), no login needed | **built** |

**Price honesty for swaps.** A product marketed as high fibre is often dearer. Every swap must show Δprice and Δunit price next to the claim, and the claim must pass the Reg. (EC) 1924/2006 threshold *in code* (high fibre ≥ 6 g/100 g; source of fibre ≥ 3 g/100 g) from the OFF field, never from marketing copy.

---

## privacy, consent, GDPR

| principle | what we do |
|---|---|
| **lawful basis** | Store sensors and CV use legitimate interest, supported by a DPIA (UK GDPR Art. 35), with no identification. Intercepts, app prompts, stated goals and basket history use **consent** (Art. 6(1)(a)). Health-related goals (GLP-1, coeliac) are **special category data** (Art. 9) and need explicit opt-in, or we don't collect them. |
| **no faces, no identities in store** | CV runs **on device** at the shelf edge. Frames never leave the camera and are never stored. The device emits only `{bay, 5-min window, shown, looked, picked_up, put_back}` counts. No face recognition, no re-identification across bays, no cross-visit tracking. Signage is at the store entrance (ICO CCTV guidance). |
| **aggregation threshold** | **k-anonymity ≥ 10.** Any cell (SKU × store × day × segment) with fewer than 10 shoppers is suppressed or rolled up (to week, then to region) before it leaves the retailer. The API never returns a smaller cell to a brand key. The sim flags `small_sample` (< 30) for statistical reasons, which is stricter again. |
| **minimisation** | Mission and shop size are stored as **bands** (words), not raw timestamps or basket lines. Session signals for re-ranking stay in the session and are not stored by default. |
| **retention** | Raw sensor events: 30 days. Aggregated counts: 25 months (two seasonal cycles). Intercept answers: 12 months. Consent withdrawal deletes the profile and future swaps immediately. |
| **data ownership** | The **retailer** owns store and shopper-level data. A **brand** gets aggregated funnels (k ≥ 10) for **its own SKUs** plus category benchmarks, and never a competitor's SKU-level funnel. The synthetic sim outputs belong to whoever ran them. OFF product data is ODbL, so attribution is kept (`off_url` on every product). |
| **honest edits only** | Optimisation and pack tests may only surface true facts. No adversarial text aimed at AI shopping agents. |

---

## cost at scale (Jev pricing: $0.042 per 1M input tokens, output free)

Measured from `data/sim/cost_log.jsonl` and the run logs on 3 Oct 2026, not estimated:

| job | measured | per unit | 1k | 100k |
|---|---|---|---|---|
| synthetic **human shopper** (full store walk, one Jev fan-out request per noticed slot) | `run_20261003_120522_s11_jev_e5e0`: 300 shoppers, 6,187 requests, 22.7M input tokens, 222 s wall | ~75.7k tokens ≈ **$0.0032 / shopper** | ≈ $3.18 | ≈ $318 |
| **AI-agent arm** decision (whole-catalog feed, one Choice) | `agent_20261003_115907_s1_jev_5945`: 80 decisions, 642,520 tokens | ~8.0k tokens ≈ $0.00034 | ≈ $0.34 | ≈ $34 |
| **e-com re-rank** of a 12-product listing (24 questions) | `integrations:ecom-rerank` in cost_log: 5,659–5,979 tokens | ≈ $0.00024 / listing | ≈ $0.24 | ≈ $24 |
| **session → archetype** (one Choice over 13 options) | 1,244 tokens | ≈ $0.00005 / session | ≈ $0.05 | ≈ $5 |
| **mission from basket** (one Choice) | not measured; ~1k tokens assumed by analogy with the row above | ≈ $0.00004 / basket | ≈ $0.04 | ≈ $4 |

Notes:
- **Re-rank cost scales with the catalogue, not with traffic.** The re-rank depends only on (archetype, listing). There are 13 archetypes (12 plus `unclear`), so a retailer with 2,000 listing pages pays about 26k listings × $0.00024 ≈ **$6** for every page, and serves from cache after that (`data/sim/cache/jev/`, keyed by sha256 of state and questions).
- The human-shopper cost is dominated by state size (persona card plus product cards). Trimming state is the lever, per jaggedness #5, and also improves accuracy.
- Sensors and CV hardware dominate real deployment cost. Model inference is not the constraint.
- Total Jev spend for the whole project up to this point: about **23.4M input tokens, about $0.98** (cost_log, model `jev`).

---

## calibration path (how the synthetic becomes trustworthy)

1. The first real k ≥ 10 funnel cells per SKU replace the literature priors in `sim/notice.py` (row, facings, centrality).
2. Real put-back intercept answers form a labelled set for the Jev `mechanism` Choice. We measure agreement and report it.
3. With 50–300 real responses, apply AIPW debiasing to the synthetic stats (arXiv 2609.13148 reports 83–94% bias reduction).
4. The same funnel shape online gives a cheap second calibration source before any shelf hardware exists.

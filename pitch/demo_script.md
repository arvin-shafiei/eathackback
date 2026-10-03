# Demo video: 2:00 shot list

**The rule for this video:** every number said aloud or shown in a caption comes from a REAL Jev file named in the "source" column. The superstore crowd shots are **MOCK** (rule-based engine). Their on-screen badge, *"⚠ mock engine: layout & traffic demo, not evidence"*, stays visible, and the voice-over says so. The superstore leaderboard stickers ("most picked", "humans vs ai gap +65pts") come from the mock run, so **never read them out**.

## Before recording (10 min)

```bash
# terminal 1: sim server (needed for add-product / persona builder)
python3 sim/server.py                 # :8787 (the 3D app's /api proxy targets 8787)
# python3 sim/server.py 8788          # only if 8787 is taken; then open dashboard.html?api=http://localhost:8788/api

# terminal 2: web
cd web && npm i && npm run sync && node scripts/sync-dashboard.mjs && npm run dev   # http://localhost:5173

# superstore replay (gitignored, regenerate once, $0, mock):
python3 sim/run.py --agents 120 --engine mock --seed 21 --store-format superstore
python3 scripts/slim_run.py data/sim/runs/<new run file>.json && (cd web && npm run sync)
```

Open these tabs in this order:

| tab | URL | prep |
|---|---|---|
| A | `http://localhost:5173/?store=superstore&nointro` | MOCK crowd. Set speed 2×, thoughts "all". |
| B | `http://localhost:5173/?store=standard&nointro&follow=a001` | In the **run** dropdown choose `run_20261003_120823_s11_jev_4482 · 300` (REAL). The follow link then opens shopper a001. |
| C | `http://localhost:5173/dashboard.html#provenance` | Persona filter: "Dev" (`p_frugal_unit_price`). |
| D | `http://localhost:5173/dashboard.html#brand?code=5060512671247` | Gut Lovin' Soda Cola. |
| E | `http://localhost:5173/dashboard.html#ai` | Position bias. |
| F | `http://localhost:5173/dashboard.html#retailer` | Blended objective. |
| G | `http://localhost:5173/?nointro` (XL store, default) | **＋ add product**, with a Tesco link pasted and ready. |

Record at 1080p, 60 fps. Lowercase captions of 8 words or fewer.

## Shot list

| time | screen (exact clicks) | voice-over | source for every number |
|---|---|---|---|
| **0:00–0:10** hook | **Tab A.** Low angle on a superstore aisle. Shoppers push trolleys and pick items into baskets. A 👀 "walked past" sticker appears. Hold so the yellow **mock engine, not evidence** badge is readable. | "EPOS sees the sale. It never sees the shopper who picked your product up and put it back." | none |
| **0:10–0:20** the store | Still tab A. Click **overview** (camera panel), then pan across the queues at the tills and the café. Hover the mock badge. | "A whole superstore: aisles, queues, a café. This crowd runs on our free mock engine. It's for layout and traffic, and the badge says it isn't evidence. The evidence comes next." | badge text: `web/src/ui/engineBadge.tsx` |
| **0:20–0:45** THE TRACE (REAL) | **Tab B** (run 4482 selected, shopper **a001** panel open, Dev the frugal unit-price shopper). Scroll his trip to slot **U2-r2**, Kallo Lentil & Pea Veggie Cakes, and click the quote to open **the trace**. Show in order: p_notice **0.50** with logit terms; Jev **P(pick up) 0.26**; fired put-off *"protein / new-recipe claim carrying a price premium"* **p = 0.53**; the Reddit verbatim (Aldi "protein" sausages, "about £1 more… absolutely pointless") with its thread link. | "This is real. 300 shoppers, every decision from TypeSafe Jev. Dev noticed the veggie cakes, a 50% chance from shelf position. He picked them up, then put them back: Jev puts 53% on 'a protein claim carrying a price premium'. That trigger comes from a real Reddit thread. Every number here clicks to its source." | `data/sim/runs/run_20261003_120823_s11_jev_4482.json` → agent `a001`, event `slot U2-r2`, product `5013665115373`: `p_notice 0.4982`, `p_pick_up 0.26`, reason text and `verbatim` |
| **0:45–1:00** grounding | **Tab C** `#provenance`. Sankey: subreddit → thread → theme → mechanism → persona → attribute. Click **focus** for Dev. Cut to `#personas` and Dev's **evidence-mix meter**. | "Where does Dev come from? Reddit threads, coded mechanisms, papers, product fields, and an honest meter of how much is still assumption: 22% for Dev." | `data/provenance/personas/index.json` → `p_frugal_unit_price.evidence_mix`: reddit 49.5, assumption 22.5 |
| **1:00–1:20** THE FINDING (brand) | **Tab D** `#brand`, Gut Lovin' Soda Cola. Show the funnel against the category and the **leak-stage diagnosis**: "loses people at PUT-BACK". | "Across the 300 shoppers, challengers get picked up as often as the big brands, 35 against 34%. But only 48% of challenger pick-ups make it to the basket, against 54% for incumbents and 67% for own-label. Challengers lose in the hand. This one keeps 20% of pick-ups, and its category keeps 40%." | role split re-derived from run 4482 (`pitch/submission.md` §4 table); product: `data/sim/brand/5060512671247.json` → `funnel.keep.rate 0.2 [0.089, 0.391]`, `category_funnel.keep.rate 0.401`, `diagnosis.text` |
| **1:20–1:32** AI shoppers | **Tab E** `#ai`. The position-bias bars. | "Now the shopper that isn't human. On a shuffled product feed, GPT-4.1-mini put 16% of its picks in slot one and Gemini Flash 13%, when chance is 3.5%. Jev doesn't show that bias: 2.5%." | Jev: `data/sim/runs/agent_20261003_115907_s1_jev_5945.json` → `position_bias` (2/80, CI [0.7, 8.7]%); LLMs: `agent_20261003_114253_s1_eda5.json` (OpenRouter comparison run: 13/80 GPT-4.1-mini, 10/76 Gemini) |
| **1:32–1:45** retailer | **Tab F** `#retailer`, blended objective. Show the move list and the HFSS-checked end-caps. | "For the retailer: a layout optimiser that respects chilled units and UK HFSS rules. Every move has a reason and a confidence interval. Prices are assumptions, and it says so." | `data/sim/layout/summary.json`, `report_blended.json` (don't read the % aloud: revenue rests on 85/96 assumed prices) |
| **1:45–1:55** add product | **Tab G.** Click **＋ add product**, paste a Tesco link, show the draft with its field sources, pick the product to replace, and click **send the shoppers**. Cut when analytics opens and the engine badge is visible. | "A brand pastes its Tesco link, takes a slot, and the shoppers come back with a funnel." | `sim/tesco.py`, `sim/uploads.py`. If credits are out, this run is mock or router: keep the badge in shot |
| **1:55–2:00** close | End card: **same shelf**. "the shoppers EPOS never sees, traced to source." Repo URL. | "same shelf. No black box." | none |

## Lines you must NOT say

- Any number from the superstore leaderboard or counters (MOCK).
- "Validated against real shoppers." We built the Shelf-vote harness (`calibration/`), but only DEMO (fake) outputs exist.
- Any revenue or "+X% sales" lift from the layout optimiser, unless you also say that prices are assumptions.
- That routing cards increased basket completion. The pre-registered result is a null (`data/sim/visits/RESULTS.md`).

## Fallbacks

- If the 3D stutters, record at 1× with `thoughts: selected`. `?shadows=1` is off by default, so leave it off.
- If the follow link doesn't open a001, click the run dropdown again after load, or open the shopper from the trip list.
- If the sim server is down for add-product, cut that beat and extend the brand beat. The pack-test heatmap on tab D (`#brand`, product `5060494810665`) is REAL Jev: the best true claim lifts P(pick-up) by +0.018, which is under the 0.02 noise floor. That is an honest null (`data/sim/brand/pack_test/5060494810665.md`).

## 3-minute live final (if we make the six)

Use the same beats, with two additions:

1. **+30 s, honesty slide.** Two nulls we published:
   - Route cards: +0.002 [0.000, +0.004] basket completion (`data/sim/visits/RESULTS.md`).
   - Pack claim: +0.018 P(pick-up), below the noise floor.

   Then: "we report what doesn't work".
2. **+30 s, cost and scale.** $0.87 for 300 shoppers, about $3.20 per 1,000 (`sim/README.md`). Store formats are config files. Calibration path: Shelf votes, then AIPW.

Q&A prep: `pitch/judge_qa.md`.

# simsbury: 2:00 demo video + 3:00 live final

Built against the brief's rubric. Every beat below is tagged with the criterion it scores:
**O** Originality 30% · **B** Build & execution 30% · **V** Value & relevance, with evidence, 25% · **D** Demo & communication 15%.

**Rule for every take:** any number spoken or captioned comes from a **REAL Jev file** listed in the source column. The superstore crowd is the **mock** engine, which is for layout and traffic only. Keep its badge, *"⚠ mock engine: layout & traffic demo, not evidence"*, in frame, and never read its counters aloud.

---

## setup (5 min, before recording)

```bash
python3 sim/server.py 8788            # sim server (8787 is taken on this Mac); the app proxy targets 8788
cd web && npm run sync && node scripts/sync-dashboard.mjs && npm run dev   # http://localhost:5173
```

| tab | URL | prep |
|---|---|---|
| A | `localhost:5173/?store=superstore&weather=auto` | Let the intro fly-through play once (it's the hook). Speed 2×, thoughts "all". |
| B | `localhost:5173/?store=standard&nointro&follow=a001` | **run** dropdown → `run_20261003_120823_s11_jev_4482 · 300` (REAL Jev). Shopper a001 panel open. |
| C | `localhost:5173/dashboard.html#provenance` | Focus persona "Dev" (`p_frugal_unit_price`). |
| D | `localhost:5173/dashboard.html#brand?code=5060512671247` | Gut Lovin' Soda Cola. |
| E | `localhost:5173/?store=xl&nointro` | **your store** open (heatmap on). Then **rearrange** with "more buys"; on xl it returns in seconds. |
| F | tab E → **shoppers** | Click "use a simulated shopper's basket", then **build profile** and **next visit**. |

Record at 1080p, 60 fps. Captions in lowercase, 8 words or fewer. Practise once and cut the dead time.

---

## the 2:00 video

| time | screen | voice-over | scores | source |
|---|---|---|---|---|
| **0:00–0:12** hook | **A.** The intro flies over the car park (auto weather) and through the doors into the superstore: minion shoppers with trolleys, one picks a product up and **puts it back** (✖ sticker). | "Every supermarket knows what sold. None of them know who picked it up and put it back. EPOS can't see that, and for small stores it's the whole story." | V, D | none |
| **0:12–0:28** what it is | Still **A**: pull back to the overview with the departments, 36 aisles, queues and café. Keep the mock badge visible. | "simsbury is a living supermarket: 2,638 real UK products from Open Food Facts, walked by shoppers built from 10,000 real Reddit comments and published shelf research. AI shopping agents walk the same aisles. This crowd is our free mock engine for layout and traffic; the evidence is next." | **O**, B | products: `data/products/catalog_superstore.json`; Reddit: `data/reddit/comments.csv` (10,642) |
| **0:28–0:52** the trace (REAL) | **B**, shopper a001 (Dev, frugal). Click the Kallo veggie cakes stop at U2-r2 to open the **trace**: noticing 0.50 with its logit terms → **P(pick up) 0.26** → put-off *"protein claim at a price premium"* **p = 0.53** → the Reddit quote and its thread link. | "Here's a real run: 300 shoppers, every decision from TypeSafe Jev, which returns calibrated probabilities, not chat. Dev noticed these veggie cakes, a coin-flip from shelf position, picked them up, then put them back. Jev puts 53% on 'a protein claim carrying a price premium', a trigger taken from a real Reddit thread. Click any number and it goes back to its source. No black box." | **B**, **V**, O | `data/sim/runs/run_20261003_120823_s11_jev_4482.json` → a001, slot U2-r2, `5013665115373`: `p_notice 0.4982`, `p_pick_up 0.26`, trigger p 0.53, verbatim + URL |
| **0:52–1:08** the finding | **D** `#brand`: the funnel against its category, with the leak-stage diagnosis "loses people at put-back". | "Across all 300, challengers get picked up as often as big brands, 35 versus 34%. But only 48% are kept, against 54% for incumbents and 67% for own-label. Challengers lose *in the hand*, the moment EPOS never sees." | **V** (evidence), O | role split re-derived from run 4482 (`README.md` headline table); `data/sim/brand/5060512671247.json` → keep 0.20 vs category 0.40 |
| **1:08–1:22** brands | Still **D**: pack-test row (true claims only), then **E** → **＋ add product** with a Tesco link pasted. | "For brands: see where you lose shoppers, test pack claims you're legally allowed to make, or paste your Tesco link and drop your product onto a shelf." | V, B | pack test: `data/sim/brand/pack_test/`; import: `sim/tesco.py` |
| **1:22–1:38** store owners | **E** **your store**: floor heatmap and hotspots, the "which shelf" panel (top / eye / bottom with source), then **rearrange** → top moves → **preview**. | "For the owner of a small store: where it gets congested, which shelf a product earns, what to put next to what. Rearrange, preview, and test it on fresh shoppers before moving a single tin." | **V**, B | shelf effects: `sim/coefficients.json` (eye vs floor, facings 0.17; cited papers) |
| **1:38–1:52** shoppers | **F** **shoppers**: basket → persona card (likes and avoids with sources) → **next visit**: the route lights up on the shelves, plus "moved from aisle 3 to 1" and one new item. | "And for the customer: we learn from what they buy, never guessing health from a basket, so after a re-layout their next visit is a short route to their usual things, plus one new thing they'd actually like." | **O**, V | `sim/customer.py` (method + assumptions in the response) |
| **1:52–2:00** close | End card: **simsbury**, "the shoppers EPOS never sees, traced to source", plus the repo URL. | "Brands, store owners, shoppers. About $3 per thousand simulated shoppers. simsbury: no black box." | V, D | cost: `data/sim/cost_log.jsonl` (measured $0.87 / 300 shoppers ≈ $3.20/1k) |

---

## the 3:00 live final (finalists)

1. **0:00–0:20, hook (D):** "EPOS sees the sale, not the put-back." Show tab A live (weather on).
2. **0:20–1:00, the trace (B, V):** tab B. Click a real decision all the way to its Reddit source. Say "calibrated, not chat" and "rule zero: if we can't trace a number, we don't show it." Also mention the Stop hook that makes us check every session for black boxes (`.claude/hooks/blackbox-check.sh`).
3. **1:00–1:30, the finding (V):** challengers lose in the hand: picked up 35 vs 34%, kept 48 vs 54 vs 67%.
4. **1:30–2:30, the three services (V, B):** brand funnel (D) → your store heatmap + rearrange (E) → shoppers persona + route (F). One sentence each, and click, don't talk.
5. **2:30–3:00, beyond the demo (B, V):**
   - **Scale and cost:** about $3.20 per 1,000 shoppers, 13 min per 1,000 at Jev's rate limit.
   - **Privacy:** health traits only if declared; k ≥ 10 aggregation.
   - **Honest limits:** not yet calibrated against real shoppers. The Shelf-vote harness exists in `calibration/`.
   - **Next step:** a live pilot with one independent store.

## judge Q&A crib (full list: `pitch/judge_qa.md`)

- **"Isn't this a GPT wrapper?"** No. Code decides noticing with a published-coefficient logit, and Jev returns typed, calibrated probabilities. No generated prose is treated as data.
- **"Synthetic personas already exist (RGC's Signal Twins)."** Ours are grounded and auditable. Each persona carries an evidence-mix meter showing how much is assumption (21–34% for the lens personas), and they shop a physical shelf, so we can see the put-back.
- **"Is it validated?"** Not against real shoppers yet, and we say so. The 300-shopper run is real Jev, and the superstore crowd is labelled mock.
- **"Incrementality?"** The rearrange and placement tests run on held-out shoppers, so we can see whether a move wins new buys or just takes them from a neighbour.

## don't say

- Superstore leaderboard or counter numbers (mock).
- "Validated against real shoppers."
- Any £ or +% from layout/rearrange without "prices are assumptions / mock shoppers".
- That the personal route improved basket completion: the pre-registered result was null (`data/sim/visits/RESULTS.md`).

## fallbacks

- **Superstore loads slowly** (about 20 s): start tab A before recording.
- **Rearrange on the superstore takes about 55 s:** demo it on xl (tab E).
- **Sim server down:** `python3 sim/server.py 8788`. If add-product fails, cut that beat and extend the trace.

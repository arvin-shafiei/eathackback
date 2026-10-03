# simsbury: 2:00 demo video

Rubric (from the brief): **O** Originality 30% · **B** Build & execution 30% · **V** Value & relevance, with evidence, 25% · **D** Demo & communication 15%.

**One rule:** only say a number out loud if it comes from the **real Jev run** `run_20261003_120823_s11_jev_4482` (300 shoppers). Pick that run in the **run** dropdown for every beat that shows numbers. The superstore crowd is for looks.

---

## setup (5 min before recording)

```bash
python3 sim/server.py 8788          # sim server (needed for rearrange)
cd web && npm run dev               # http://localhost:5173
```

| tab | URL | prep |
|---|---|---|
| A | `localhost:5173/?store=superstore&weather=auto` | let the fly-in intro play once. speed 2×. |
| B | `localhost:5173/?store=standard&nointro` | **run** → `…jev_4482 · 300`. this is the evidence tab. |
| C | `localhost:5173/dashboard.html#brand?code=5060512671247` | Gut Lovin' Soda Cola brand page. |

Record 1080p. Captions lowercase, ≤ 8 words. Hard-refresh every tab (Cmd+Shift+R) first.

---

## the script (2:00)

| time | on screen | say | scores |
|---|---|---|---|
| **0:00–0:10** hook | **A.** fly-in over the car park, through the doors. a minion picks a product up and **puts it back** (✖). | "Every supermarket knows what sold. Nobody knows who picked it up and put it back. The till can't see that." | V, D |
| **0:10–0:22** what it is | **A.** pull back over the full store: aisles, bakery, tech corner, crowd moving. | "This is simsbury. A living supermarket: real UK products from Open Food Facts, shoppers built from ten thousand real Reddit comments and published shelf research, each decision made by TypeSafe Jev." | **O**, B |
| **0:22–0:40** click a shopper | **B.** click any minion. the panel shows **thinking now / about to buy / in the trolley**. click a put-back → **trace**: noticed → picked up → put back, with Jev's probability and the Reddit quote + link. | "Click anyone and see what they're thinking. This shopper picked these up and put them back. Jev gives the reason a probability, and it links back to the real Reddit thread it came from. Every number traces to a source. No black box." | **B**, V |
| **0:40–0:58** analytics | **B → analytics.** top: **best and worst sellers** (top 10 green, bottom 10 red). click a bottom-10 product → "0 of N shoppers bought it" + the funnel. | "For a brand: the top and bottom ten straight away. Click the worst one and you see exactly where it loses people. Across 300 shoppers, challenger brands get picked up as often as big brands, 35 versus 34 percent, but they're kept far less: 48 percent against 54 and 67 for own-label. They lose in the hand, the moment the till never sees." | **V** (evidence), O |
| **0:58–1:15** your store | **B → your store.** heatmap is on: blue quiet → red busy. drag **hide quiet areas** so only the hotspots stay. | "For the shop owner: where the store gets busy, and where nobody goes. Slide it and only the hotspots are left." | V, B |
| **1:15–1:40** rearrange | **B → rearrange.** pick the top category. green box: **"+X% sales from this shelf"** + the plain-words why. numbered arrows 1, 2 on the shelf. press **▶ watch it**: packs fly and swap. **do it**. | "Then fix it. Pick a category. It says why: this product sells when people see it, but it's on the bottom shelf. Swap it to eye level. Here are the moves, in order, with arrows. Watch it. Do it. Then test it on new shoppers before you move a single tin." | **V**, **B**, O |
| **1:40–1:52** shoppers + trolleys | **B → shoppers.** use a shopper's basket → profile → **next visit** route lights up. flick to **smart trolleys**. | "And for the customer: we learn what they buy and give them a short route to their usual things after a re-layout, plus one new thing they'd like." | O, V |
| **1:52–2:00** close | end card: **simsbury**, "the shoppers the till never sees", repo URL. | "Brands, store owners, shoppers. About three dollars per thousand simulated shoppers. simsbury. No black box." | V, D |

**Rearrange numbers:** read the "+X%" only if the run dropdown is on `…jev_4482`. If the panel says "learned on a different layout", don't read the % aloud; just show the swap.

---

## sources for every number said

| number | where it comes from |
|---|---|
| 35% vs 34% picked up, 48 / 54 / 67% kept | run 4482, role split (`README.md` headline table) |
| ten thousand Reddit comments | `data/reddit/comments.csv` (10,642 rows) |
| about $3 per 1,000 shoppers | run 4482: $0.95 uncached ($0.87 actual) for 300 shoppers ≈ $3.20 per 1,000 (`README.md` cost table, `run_…4482.json → cost`) |
| "+X% sales from this shelf" | `sim/rearrange.py` unit value before → after, on the run picked |
| top / bottom 10 % | taken ÷ shown per product, counted from the picked run's events; 10+ shoppers only (assumption) |

## don't say

- "validated against real shoppers" (not yet).
- superstore crowd counters or leaderboard numbers.
- any £ figure without "prices are assumptions".

## 3:00 live final (if shortlisted)

Same order, slower, plus 30 s at the end:
- **Scale:** about $3.20 per 1,000 shoppers, ~13 min per 1,000 at Jev's rate limit.
- **Privacy:** health traits only if the shopper declares them; results grouped in tens or more.
- **Honest limit:** not yet calibrated against a real store. Next step: a pilot with one independent shop.
- **Rule zero:** a Stop hook checks every session for black boxes (`.claude/hooks/blackbox-check.sh`).

## fallbacks

- superstore slow to load: open tab A first and leave it.
- sim server down: `python3 sim/server.py 8788`; if rearrange still fails, cut that beat and stay on analytics longer.
- the plane crash / creator visit / UFO may play on their own. They're fine in the background, but don't wait for them.

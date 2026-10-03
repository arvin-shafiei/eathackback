# simsbury: 2:00 demo video

Rubric (from the brief): **O** Originality 30% · **B** Build & execution 30% · **V** Value & relevance, with evidence, 25% · **D** Demo & communication 15%.

**Tone:** a salesman who believes it. Short sentences. Pauses. Sell the *feeling of finally knowing*. Every beat goes **raw data → what it means → what you do about it**.

**One rule:** only say a number out loud if it comes from the **real Jev run** `run_20261003_120823_s11_jev_4482` (300 shoppers). Pick that run in the **run** dropdown for every beat that shows numbers.

---

## setup (5 min before)

```bash
python3 sim/server.py 8788          # sim server (needed for rearrange)
cd web && npm run dev               # http://localhost:5173
```

| tab | URL | prep |
|---|---|---|
| A | `localhost:5173/?store=superstore&weather=auto` | let the fly-in play once. speed 2×. |
| B | `localhost:5173/?store=standard&nointro` | **run** → `…jev_4482 · 300`. the evidence tab. |

Record 1080p. Hard-refresh every tab (Cmd+Shift+R) first. Captions lowercase, ≤ 8 words.

---

## the script (2:00)

### 0:00–0:12 · the problem *(V, D)*
**Screen:** tab A. Fly in over the car park, through the doors. A minion picks something up… and puts it back (✖).

> "Every night, a shop owner looks at the till and asks one question: *why didn't that sell?*
> And the till can't answer. It only knows what left the building.
> It never saw the person who picked it up… looked at it… and put it back."

### 0:12–0:25 · what simsbury is *(O, B)*
**Screen:** pull back over the whole store: aisles, bakery, the crowd moving.

> "So we built the shop that *can* see it.
> simsbury is a living supermarket. Real UK products. Shoppers built from ten thousand real Reddit comments and published shelf research.
> Every choice they make is decided by TypeSafe Jev, and every one is written down."

### 0:25–0:45 · see inside a shopper's head *(B, V)*
**Screen:** tab B. Click a minion → **thinking now / about to buy / in the trolley**. Click a put-back → the trace: noticed → picked up → put back, the probability, the Reddit quote and its link.

> "Click anyone. Here's what they're thinking. Here's what's in their trolley.
> They picked this up… and put it back. Why? Here's the reason, here's how sure we are, and here's the real person on Reddit who said it first.
> That's the difference. Not a guess. A reason, and where it came from."

### 0:45–1:05 · turn it into knowledge *(V: evidence, O)*
**Screen:** **analytics**. The big **best and worst sellers** box at the top. Click a bottom-10 product → "0 of N bought it" and the funnel.

> "Now multiply that by three hundred shoppers.
> Your ten best. Your ten worst. One click and you see *exactly* where you're losing people.
> And here's what nobody could see before: small challenger brands get picked up just as often as the big names: thirty-five percent against thirty-four.
> But they're *kept* far less. Forty-eight percent, against fifty-four for the big brands and sixty-seven for own-label.
> They don't lose on the shelf. They lose *in the hand*. And now you know."

### 1:05–1:20 · see your floor *(V, B)*
**Screen:** **your store**. Heatmap on: blue = quiet, red = busy. Drag **hide quiet areas** until only the hotspots glow.

> "If you own the shop: here's where your customers actually go.
> Red is where they crowd. Blue is where they never look.
> That blue? That's shelf space you're paying for and nobody sees."

### 1:20–1:42 · then act on it *(V, B, O)*
**Screen:** **rearrange**. Pick the top category. Read the green box: the "why". Numbered arrows 1 → 2 on the shelf. Press **▶ watch it**: the packs fly and swap. Then **do it**.

> "So don't just know it. Fix it.
> Pick a category, and it tells you *why* in plain English: this one sells when people see it, but it's stuck on the bottom shelf.
> Here are the moves, in order. Watch it happen.
> And before you move a single tin, test it on brand-new shoppers."

### 1:42–1:52 · and the customer wins too *(O, V)*
**Screen:** **shoppers** → use a shopper's basket → profile → **next visit** route lights up on the shelves.

> "And your regulars? After a re-layout they get a short route straight to their usual things, plus one new thing they'll actually like."

### 1:52–2:00 · close *(V, D)*
**Screen:** end card: **simsbury** · "the shoppers the till never sees" · repo URL.

> "Brands. Store owners. Shoppers.
> Stop guessing why it didn't sell.
> simsbury. Now you know."

---

## rearrange numbers

Say a "+X%" only if the run dropdown is on `…jev_4482`. If the panel says "learned on a different layout", show the swap and don't read the number.

## sources for every number spoken

| said | where it comes from |
|---|---|
| ten thousand Reddit comments | `data/reddit/comments.csv` (10,642 rows) |
| three hundred shoppers | run 4482 (`run_20261003_120823_s11_jev_4482.json`, 300 agents) |
| picked up 35% vs 34% · kept 48 / 54 / 67% | run 4482, take funnel by brand role (`README.md` headline table) |
| best / worst ten | taken ÷ shown per product, counted from the picked run; only products 10+ shoppers saw (assumption) |
| "+X% from this shelf" | `sim/rearrange.py`, the shelf's value before → after, on the picked run |

## don't say

- costs or prices: the £ figures in the app are assumptions, not real prices.
- "validated against real shoppers" (not yet).
- superstore crowd counters or leaderboard numbers.

## if you make the 3:00 final

Same story, slower, then 30 s:
- **How the data becomes knowledge:** Open Food Facts gives the product, Reddit and shelf research give the shopper, Jev gives a probability for every choice, and code adds it up. Click any number and it goes back to its source.
- **Privacy:** health traits only if a shopper declares them; results shown in groups of ten or more.
- **What's next:** check it against one real independent shop's sales.
- **Rule zero:** a hook checks every coding session for black boxes (`.claude/hooks/blackbox-check.sh`).

## fallbacks

- superstore slow: open tab A first and leave it.
- sim server down: `python3 sim/server.py 8788`. If rearrange still fails, cut it and stay on analytics longer.
- the plane crash, creator visit or UFO might play on their own. They're fine in the background; don't wait for them.

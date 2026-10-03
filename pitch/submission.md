# Submission: paste-ready answers

Tally form: https://tally.so/r/obJp2P. **Due 17:30, to the minute.** Every link must open without signing in.

Rule zero applies to this page. Every number below names the file it comes from or is labelled an assumption. **REAL** means a TypeSafe Jev run log. **MOCK** means the rule-based demo engine, which is not evidence.

---

## 1. Project name

| option | why it works | risk |
|---|---|---|
| **same shelf** ✅ | It is already the app's on-screen title (`web/src/App.tsx` header), so the video, repo and form all match. Same shelf, two kinds of shopper (human and AI), and every shopper is traced. | It doesn't say "walk-past" or "put-back" by itself, so the tagline has to carry that. |
| put back | Names the finding: challengers lose at the put-back, which EPOS can't see. | Sounds like a returns or reverse-logistics product. |
| walk-past | Echoes David's EPOS blog ("the shoppers who walked past without buying"). | Our strongest result is the put-back, not the walk-past. |

**Recommendation: `same shelf`**. Tagline: **"the shoppers EPOS never sees, traced to source."**

## 2. Team members

`[FILL: full names]`. Git authors in this repo are Arvin, Anson and chocoliticekreem (`git log --format=%an`).

## 3. Track

**Recommend Human Truth.** The Track 1 brief lists both of our cores word for word: *"what someone nearly chose or rejected"* and *"how AI shopping agents choose differently from humans"*.

(Retail Futures would also fit the layout optimiser and the store-ops sim. But both are built on the human-choice model, so leading with them would make us look like a planogram tool.)

## 4. Project description (187 words; paste as is)

> EPOS records the sale. It never sees the shopper who picked a product up and put it back. same shelf is a 3D supermarket stocked with 96 real UK products from Open Food Facts, walked by synthetic shoppers grounded in 10,642 coded Reddit comments, shelf-effect research and Big Five traits. Code decides what each shopper notices (eye level, facings, mission). TypeSafe Jev then returns calibrated probabilities for pick-up, put-back or take, and for which rejection trigger fired. Every number clicks through to its source: a paper, a Reddit thread, an Open Food Facts field, a Jev distribution or a labelled assumption.
>
> The non-obvious finding, from a real 300-shopper Jev run: once noticed, challengers are picked up as often as incumbents (35% vs 34%) but kept less often (48% vs 54%; own-label 67%). Challengers lose in the hand, at the stage EPOS can't see.
>
> Brands get a funnel diagnosis and legal pack-claim tests. Retailers get an HFSS-aware layout optimiser. An AI-agent arm measures position bias. It is all simulated and not yet validated against real shoppers, and the busy superstore replay is a labelled mock. Built during EAT_HACK.

### Where each number in the description comes from

| claim | source |
|---|---|
| 96 real UK products | `data/products/catalog.json` (96 entries: 40 challenger, 35 incumbent, 21 own-label) |
| 10,642 coded Reddit comments | `data/reddit/comments.csv` (10,642 rows, 133 threads in `threads_index.csv`); coding in `research/03-reddit-coded.json` |
| 300-shopper Jev run | `data/sim/runs/run_20261003_120823_s11_jev_4482.json` (`engine: "jev"`, `mock: false`, `models: ["jev-1.13.0"]`, 300 agents, 19,992 product passes, `cost.errors: 0`) |
| picked up 35% vs 34% (of products looked at) | same file, re-derived from `agents[].events[].stage_reached`: challenger 1,539 of 4,448 looks = 34.6% [33.2, 36.0]; incumbent 1,492 of 4,398 = 33.9% [32.5, 35.3] (Wilson 95%) |
| kept 48% vs 54%; own-label 67% | same file: taken ÷ picked up = challenger 739/1,539 = 48.0% [45.5, 50.5]; incumbent 809/1,492 = 54.2% [51.7, 56.7]; own-label 874/1,298 = 67.3% [64.7, 69.8] |

Honest qualifier, not in the paste text: challengers are also *noticed* less often (53.8% vs 59.8% of passes). That gap comes from the notice model in code plus where challengers sit in the planogram, not from Jev.

## 5. Pre-existing work (paste as is)

> No substantial pre-existing work. The store, simulation engine, Jev integration, AI-agent arm, optimisers, dashboard and 3D app were built during EAT_HACK on 3 Oct 2026. We used only open datasets, public APIs and open-source libraries: Open Food Facts (ODbL) for products; Reddit comments via the Arctic Shift public archive; published NielsenIQ bestseller tables as reported by The Grocer and Talking Retail (`data/sales/uk_bestsellers.csv`); the TypeSafe Jev API for shopper judgments; plus React, three.js / react-three-fiber, Vite and Python's standard library. The research notes and Reddit corpus were collected on the day (first commit 11:05).

⚠️ **Team must confirm this before pasting.** The first commits (`f85b13c` → `a13afd7`, 11:05–11:17) already hold a lot of research: the RGC intel, the 10.6k-comment corpus and the coded human truths. If any of that was prepared before the 11:00 start, replace the last sentence with: *"Before the build period we gathered the research notes and Reddit corpus; everything else was built during EAT_HACK."*

## 6. Links

- **Repository:** https://github.com/arvin-shafiei/eathackback (check that it is **public**; README has run instructions)
- **Video (≤ 2:00):** `[FILL: unlisted YouTube / Loom URL, opens without login]`. Script: `pitch/demo_script.md`
- **Live URL:** optional, and it earns no extra points. Skip it.

## 7. Best Brand vote (three brands from The Shelf)

1. `[FILL]`
2. `[FILL]`
3. `[FILL]`

(This vote is separate from judging and doesn't affect our score.)

---

## Pre-submit checklist (14:20 → 17:30)

- [ ] Repo is public, and `README.md` opens with the judge summary.
- [ ] Video ≤ 2:00, unlisted but public, with captions. It shows the **"mock engine: layout & traffic demo, not evidence"** badge on the superstore shots.
- [ ] **Jev credits:** TypeSafe started returning HTTP 402 (out of credits) partway through the 12:36 visits run (`data/sim/visits/RESULTS.md`, `data/sim/ops/RESULTS.md`). Since then, any new run is either mock or the `jev-router` OpenRouter fallback, which is an uncalibrated LLM. `run_20261003_125423_s909_jev_5c63.json` is one of these despite "jev" in its filename (`models: ["openrouter:typesafe/jev-router"]`). Top up credits before recording a live Jev run. Otherwise, quote only the cached REAL runs.
- [ ] The superstore replay file is gitignored (`.gitignore`: `run_20261003_133908_s21_mock_bffd.json`). The README tells judges how to regenerate it.
- [ ] Team names, the three Best Brand picks and the pre-existing-work sentence are confirmed.

## Beyond the demo (for the form's free text, or for the live final)

- **Cost (measured):** the 300-shopper Jev run cost $0.87 actual, or $0.95 if uncached, for 6,187 requests and 22.7M input tokens. That is about **$3.20 per 1,000 shoppers** (`sim/README.md` "Tested"; `run_…4482.json → cost.usd_if_uncached = 0.954`). All Jev spend today was $2.69 over 19,580 calls (`data/sim/cost_log.jsonl`, `model == "jev"`).
- **Scale:** the store is a config file (`data/store/formats/*.config.json`: express, metro, superstore). Only *noticed* products cost a Jev call. Identical states are served from cache for $0.
- **Privacy:** no personal shopper data. Reddit is used as coded mechanisms plus quoted verbatims with thread URLs, and no usernames are stored (`data/reddit/comments.csv` has no author column).
- **Security:** keys live in `.env` (gitignored). Optimisers only make honest edits (slot, facings, a true Reg 1924/2006 claim, price) and never write free text into the feed. Brand-uploaded products are stamped `brand-supplied, unverified` (`sim/uploads.py`).
- **Data ownership:** Open Food Facts is ODbL with attribution. A Tesco link is read once for a single product page and is not crawled (`sim/tesco.py`). A production version would need a licensed feed.
- **Limitations (say them first):**
  - There is no real-shopper calibration yet. The Shelf-vote harness exists (`calibration/`), but only `DEMO_*` (fake) outputs exist.
  - 85 of 96 prices are labelled curator assumptions (`data/sim/swaps/claim_premium.md`).
  - Lens personas are on average 28% assumption by field (`data/provenance/personas/index.json`).
  - Our personal-route experiment found **no** claimable lift (`data/sim/visits/RESULTS.md`).

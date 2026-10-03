# Judge Q&A: the 15 hardest questions

The live final allows up to 2 minutes of Q&A. Give **one sentence, then one piece of proof (a file or a screen)**. Judge profiles come from `research/06-rgc-team-linkedin.md`. **REAL** = a TypeSafe Jev run log. Never quote the superstore crowd's numbers; quote the REAL runs.

Main REAL file: `data/sim/runs/run_20261003_120823_s11_jev_4482.json` (300 shoppers, `jev-1.13.0`, 19,992 product passes, 0 errors). Below it is called **run 4482**.

---

### Adam Williams (co-founder): GPT wrappers, incrementality, buyers

**1. "Isn't this just a GPT wrapper with a 3D skin?"**
No. Code decides what gets noticed, using a literature-calibrated logit (`sim/notice.py`, coefficients and sources in `sim/coefficients.json`). Jev never writes prose; it returns typed, calibrated probabilities to a few dozen narrow questions per shelf. For example, agent a006 at slot U1-r1 got 33 questions in one request, then 29 more after the back of pack was revealed. The "why" is assembled from the triggers that fired, with p values and the Reddit verbatim behind them. Proof: any event in run 4482 stores the full Choice distribution, P(pick-up), the appeal levels and the trigger Nouls (`events[].jev`).

**2. "Buyers only care about incrementality. Where does the volume come from?"**
Each slot decision is one Jev Choice over the products the shopper noticed, plus "walk past". So every take records what it beat, and every put-back records what was taken instead. Example: run 4482, agent a006 put back Gut Lovin' Soda and took Remedy Kombucha. We have **not** aggregated that into a source-of-volume report yet. The counterfactual set is in every event; the buyer-ready rollup is the next build.

**3. "Buyers don't trust brand-funded evidence. Why trust this?"**
Because they can audit it, and we publish our nulls. Click any number to see the shopper, slot, notice terms, Jev distribution, trigger and source. Two results did *not* work:
- Route cards: +0.002 [0.000, +0.004] basket completion, which is not a lift (`data/sim/visits/RESULTS.md`).
- The best legal pack claim on Raspberry Probiotic Soda moved P(pick-up) by +0.018, below our 0.02 noise floor (`data/sim/brand/pack_test/5060494810665.md`).

**4. "Tesco and Waitrose shoppers differ. Does this?"**
Structurally, yes. Store formats are config files (`data/store/formats/{express,metro,superstore}.config.json`, and `sim/run.py --store-format`), and the persona mix and missions are parameters. We have **not** calibrated a retailer-specific shopper mix, and we say so.

### David Cook (co-founder): EPOS, evidence

**5. "EPOS is the best data in retail. Why believe a sim over sales?"**
We don't ask you to. We model the part EPOS can't see: the look, the pick-up and the put-back. Where sales exist, they are the benchmark. Each brand page shows our in-category take rank next to the NielsenIQ rank (as published by The Grocer and Talking Retail) for the 42 of 96 products that match (`data/sim/brand/index.json → niq_rank`, `data/sales/uk_bestsellers.csv`). We have not computed a formal rank correlation, so don't claim one.

**6. "How do you know the sim is right?"**
We don't yet, and we won't pretend. The Shelf-vote calibration harness is built (`calibration/`: Bradley–Terry shares, Spearman/Kendall, per-segment error, AIPW correction), but only fake `DEMO_*` outputs exist. Today we have internal checks only:
- the notice model reproduces published shelf effects by construction (eye vs floor +39% sales, facings elasticity 0.17; `sim/README.md`);
- `data/sim/layout/summary.json → runlog_check` compares the surrogate against run logs per persona.

**7. "What's the non-obvious finding?"**
Once noticed, challengers are picked up as often as incumbents, 34.6% vs 33.9%, but only 48.0% of challenger pick-ups are kept, against 54.2% for incumbents and 67.3% for own-label (run 4482, Wilson CIs in `pitch/submission.md`). For 20 of 40 challengers, the biggest leak is the put-back (`data/sim/brand/index.json → leak_stage == "keep"`). Challengers lose in the hand, and EPOS is blind to that.

### Sophie Yau (product & growth): taste, trends, context

**8. "Trends move fast. How quickly can you test a new product?"**
Paste a Tesco link or a barcode. `sim/tesco.py` reads that single page, and Open Food Facts supplies the rest by barcode. Put it in a slot and 150 shoppers plus the AI arm run on it (`sim/uploads.py`, ＋ add product in the app). Compute cost is about $3.20 per 1,000 Jev shoppers (`sim/README.md`, measured).

**9. "Where's the taste? Anyone can run agents."**
The taste is in what we refused to do:
- no number without a source;
- no LLM deciding what gets *seen*;
- no adversarial copy, only true Reg 1924/2006 claims computed from OFF;
- every event records its engine, so any number can be traced to whether a model made it.

**10. "Claude and GPT have no retail context. How is this different?"**
The context is in the data, not the model. Each shopper gets real OFF label fields turned into words (UK traffic lights, "about 2x the cheapest here", NOVA), a real shelf position, a mission, a budget, and put-offs taken from UK shopper verbatims. Jev never sees a raw number it would have to do maths on (`sim/README.md`, "engine: TypeSafe Jev").

### Ege Kemal Karaca (AI engineer): grounding

**11. "Synthetic shoppers are only as good as the data underneath. What's underneath yours?"**
- 10,642 Reddit comments from 133 threads, coded into 15 themes and 8 human truths (`data/reddit/`, `research/03-reddit-human-truths.md`);
- shelf-effect papers;
- OCEAN → food-behaviour links with citations (`data/personas/ocean/*.json`);
- Open Food Facts fields.

Every persona field is tagged with its evidence class. Across the 12 lens personas, a mean 38.9% of fields are Reddit-sourced and **28.4% are still assumptions** (range 20.6–33.7%). The 13 staged dossiers are 53% assumption (`data/provenance/personas/index.json`). The dashboard prints that meter on every persona.

**12. "OCEAN is pop-psych, and LLM role-play of personality is shaky."**
OCEAN only adjusts what each shopper notices, and only through effects that cite a source. Each term is logged per event (`notice_factors.trait_terms` → `data/personas/ocean/O.json`, etc.). Personality reaches Jev only as behaviour phrases for extreme traits (≥ 0.65 or ≤ 0.35), not as a number it role-plays.

### Oriol Morros Vilaseca (full-stack / AI): does it work?

**13. "Is anything here live?"**
The REAL runs are cached Jev logs, replayed in 3D with every distribution stored. Re-running them is $0 and gives identical results. Live runs work through `sim/server.py`. Honest caveat: our TypeSafe credits ran out (HTTP 402) during the 12:36 visits run. Since then:
- new runs use the layout simulation, or fall back to OpenRouter's `typesafe/jev-router`;
- the app badges that fallback as "LLM, uncalibrated";
- `run_20261003_125423_s909_jev_5c63.json` is one of these despite its filename.

The superstore crowd in the video is the fast layout simulation; the numbers we quote are from the Jev run.

**14. "What breaks first at scale?"**
1. The Jev token rate limit (100k tok/s). 1,000 shoppers take about 13 minutes (`sim/README.md`). Cost is not the bottleneck: $0.87 for 300 shoppers, and all of today's Jev spend was $2.69 over 19,580 calls (`data/sim/cost_log.jsonl`).
2. Prices: 85 of 96 are curator assumptions (`data/sim/swaps/claim_premium.md`), so revenue-based outputs such as the layout optimiser's £ lift need a real price feed.
3. Calibration against real shoppers (Q6).

### Gianni Austin (B2B growth): the story

**15. "One sentence: who pays, and for what?"**
A challenger brand pays to walk into a buyer meeting knowing *where* shoppers drop its product (look, pick-up or put-back), *why* (the trigger, its p value and the verbatim), and which honest fix to test. A retailer pays for HFSS-safe layout what-ifs. Price anchors are the £999 Watch Humans Retail Report add-on and virtual-store studies at £20–60k each. Both are market references from `README.md` "who pays", not our pricing.

---

## Grenades (one-liners)

- **"RGC already shipped Buyer Agent and Signal Twins."** Those have no shelf, no notice gate, no put-back stage and no per-number trace. This is the grounding layer they could sit on.
- **"Your AI-agent arm is tiny."** Agreed: 80 Jev feeds and 80 per OpenRouter model. The position-bias result is solid (GPT-4.1-mini 13/80 at slot 1, Gemini Flash 10/76, against 3.5% chance; Jev 2/80; `data/sim/runs/agent_*.json`). Per-product human-vs-agent divergences are not, and the dashboard greys categories with fewer than 10 agent picks.
- **"Claim-marketed products cost more. So what?"** Of UK OFF products with no fibre claim, 22% already qualify for "high fibre" (6,865 of 30,621; `data/sim/swaps/claim_premium.md`). That is a free, honest claim the brand isn't using.
- **"Checkout routing cut waits from 25.5 s to 8.4 s?"** That is a discrete-event model, and its self-checkout acceptance is a **labelled fallback table**, because Jev was out of credits (`data/sim/ops/RESULTS.md`). Treat it as a hypothesis, not evidence.
- **"Is gaming AI agents ethical?"** We only fill in true facts. A missing fibre value that legally qualifies is honesty, not gaming.

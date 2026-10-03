# Judge Q&A: the 15 hardest questions, with crisp answers

There are 2 minutes of Q&A in the live final. Answer in **one sentence, then one piece of proof**, and point at the screen where possible. The judge profiles behind these come from `research/06-rgc-team-linkedin.md`. **[ ]** = fill from today's run logs, or drop the number.

---

### Adam Williams (co-founder): incrementality, buyers, "GPT wrapper"

**1. "Isn't this just a GPT wrapper with a 3D skin?"**
No. The LLM never decides whether a product gets seen. A deterministic, literature-calibrated notice model does that first (eye level vs floor ≈ +39% sales; facings elasticity 0.17), and most products never reach the LLM. The LLM only reads real OFF label fields for products that were noticed. Its output is tagged to a coded mechanism and checked against real Shelf votes. Adam's own line was "proprietary data creation, systems built to replace labour". What we produce is a new dataset of walk-pasts that EPOS can't see.

**2. "A buyer only cares about incrementality. Where does the volume come from?"**
Every pick in the log records what the shopper *would otherwise* have taken from the same slot set (the challenger, the incumbent, own-label, or nothing), so the optimiser reports lift split into *new-to-slot picks* and *switches from named SKUs*. That split is the start of the "what happens to my category if I say yes" slide. It is simulated, so we show it as a hypothesis with a CI, not as EPOS.
*(Only say this if the optimiser output includes source-of-volume. Otherwise say: "We report pick lift per segment today. Source-of-volume is the next field, because the event log already holds the counterfactual set.")*

**3. "Buyers don't trust brand-funded evidence. Why would they trust this?"**
Because they can audit it. Click any number and it opens the agent, slot, notice factors, fields read, reason, mechanism and source. RGC's careers page says "a number that cannot be traced back to its source is worse than no number at all", and we built to that rule. The optimiser also can't cheat: it only allows slot, facings, a true claim already on the label, or price.

**4. "Tesco and Waitrose shoppers differ. Does this?"**
Yes, structurally. Missions, archetype mix and channel are parameters, and the store layout is a config file. So a Waitrose-skewed archetype mix versus an Express meal-deal mix is a re-run, not a rebuild. We haven't calibrated retailer-specific mixes today, and we say so.

### David Cook (co-founder): EPOS, buyers deciding on other people's evidence

**5. "EPOS is the best data in retail. Why should anyone believe a sim over sales?"**
We don't replace EPOS. We cover what your own blog says it can't see: "the ranges you did not run, the prices you did not test, or the shoppers who walked past without buying". When EPOS exists, it becomes the calibration target, exactly as we used The Shelf today.

**6. "How do you know the sim is right?"**
We checked it against [n] real people at The Shelf today: rank correlation ρ = [rho], segment errors are shown next to their n, and the sim was more positive than humans ([sim] vs [human]). We correct that with a doubly robust (AIPW) estimator. Tigre & Souto (arXiv 2609.13148) report 83–94% bias reduction on consumer pricing with 50–300 real responses. Our 80/20 holdout today: error [a]pp → [b]pp.
*If the votes didn't land: "We built the harness and ran it end-to-end; we won't quote a fit we haven't measured."*

**7. "Star ratings are shallow. What's deeper here?"**
The why, not the score: each decision carries a mechanism (habit, trust, price anchor, gimmick reactance, loss aversion), grounded in coded Reddit comments. For example, *"Since when did people need to be told that meat is protein?"* (r/AskUK, [thread](https://www.reddit.com/comments/1oqtnv1)) grounds protein-gimmick reactance. It's the "what they nearly bought and why not" layer, which RGC's voice memos capture for real.

### Sophie Yau (product and growth lead): taste, speed of trends, context

**8. "Trends move fast. How quickly can this test a new one?"**
Add the SKUs from OFF by barcode, drop them into a slot in the config, and re-run. That's minutes, not the weeks a virtual-store study takes (£20–60k each, README). New Reddit or forum signals become new mechanism weights, each with its source, so the shopper model updates as fast as the culture feed does.

**9. "Where's the taste? Anyone can run agents."**
The taste is in what we refused to do. No made-up numbers: a sourced number or nothing. No adversarial copy: honest edits only. No asking an LLM whether it likes a product before deciding whether it would even be seen. We also chose to measure the shopper nobody models yet, the AI agent.

**10. "You said Claude has no retail context. How is this different?"**
The context is the product. Real OFF label fields, a real shelf position, a persona built from UK shopper verbatims, and a mission and budget. The model is told what is on the pack and where it sits, and it can walk past.

### Ege Kemal Karaca (AI engineer): grounding

**11. "Synthetic shoppers are only as good as the data underneath. What's underneath yours?"**
Four layers, each one inspectable:
1. 10,642 Reddit comments from 133 threads, coded into eight mechanisms with counts and verbatims;
2. shelf-effect literature for noticing;
3. OCEAN → food-behaviour links, applied only where a citation exists;
4. Open Food Facts fields for every product attribute.

We agree with your blog: the grounding matters more than the simulation. That's why the calibration harness ships with it.

**12. "Isn't OCEAN pop-psych? And LLMs role-playing personality is shaky."**
Traits are *modifiers* on grounded personas, not the model. Each trait effect has a coefficient and a citation, visible on hover. We also collected real TIPI scores (Gosling 2003, 10 items) from the room, so we can compare the OCEAN we assumed against the OCEAN of real people. Room means only.

### Oriol Morros Vilaseca (full-stack / AI engineer): does it actually work?

**13. "Is anything here live, or is it a pre-rendered video?"**
The runs are real logs, replayed in 3D. We can kick off a live re-run on stage. The agent arm calls real models through OpenRouter on a randomised product feed (ACES-style) and logs the same event shape as the human arm. Responses are cached, so re-runs are reproducible and cheap.

**14. "What breaks first at scale?"**
Mostly the cost of LLM reads. It scales with *noticed* products, roughly $1.5–18 per 1,000 shoppers depending on model at today's OpenRouter prices (see `pitch/submission.md`). Next comes run-to-run variance between models. ACES shows position bias flipping between model versions, so we report across several models with CIs rather than trusting one.

### Gianni Austin (B2B growth / GTM): the story

**15. "In one sentence: who pays, and for what?"**
A challenger brand pays to walk into a buyer meeting with traced evidence: who walks past their SKU, why, which honest change fixes it, and how AI shopping agents see it. Anchors are the £999 Retail Report add-on and digital-shelf tools at around £10–50k a year (README). For RGC it's an eighth dimension, "agent", that none of the seven covers.

---

## Grenades: answers to keep in your pocket

- **"RGC already shipped Buyer Agent and Signal Twins."** Yes, and they don't have a shelf, a walk-past or an AI-agent shopper arm. This is the grounding and space layer underneath them, plus a calibration harness that gives them a per-segment trust score.
- **"n = 50 builders isn't a panel."** Agreed. It's a topline sanity check, and we report it as one. The AIPW correction is built to take RGC's real voice-memo or EPOS data at n = 50–300.
- **"Your personas scored 5–6.5/10 on realism."** That's our own skeptic audit (research/05 §6), and we published it. It's why walk-pasts come from the notice gate and corpus rules, not from the LLM's judgement.
- **"Is gaming AI agents ethical?"** We only allow true facts. If a field is missing from the feed and the product genuinely has 6 g of fibre, filling it in is honesty, not gaming.

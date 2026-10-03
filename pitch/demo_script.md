# Demo video: 2-minute beat sheet

**Rule for this video:** every number on screen comes from a real run log (`data/sim/runs/<run_id>.json`), from `calibration/out/compare.json`, or from a cited paper. Square brackets like **[X]** are slots to fill from those files just before recording. **If a run hasn't produced the number, cut the line. Don't say an estimate out loud.** (research/05 §6.2 warns that the staged persona journeys contain invented precision, and none of it goes on stage.)

- **Format:** 1080p screen recording with voice-over, all lowercase captions, design tokens from `design/design-language.md`.
- **Hard cap:** 2:00 (the brief says "no more than 2 minutes").
- **Judges:** Adam, David, Sophie, Oriol, Gianni, Ege (see `research/06-rgc-team-linkedin.md`). The beats map to what each of them cares about.

| time | on screen | voice-over (say it, roughly) | who it lands with |
|---|---|---|---|
| **0:00–0:12** HOOK: the walk-past | 3D store at shopper height, low angle. A meal-deal shopper (the Margaret/office persona) walks the aisle. A challenger snack sits on the **bottom shelf, 1 facing**. She walks straight past. A sticker pops up: **"never saw it."** Then, small, the real quote: *"It makes me spend less as I can't be bothered to look for it"* (r/britishproblems, 507 upvotes, [thread](https://www.reddit.com/comments/1uosc29)). | "EPOS never sees this moment. A shopper who walked past and didn't buy leaves no data. Here, she does." | David ("says nothing about… the shoppers who walked past"), Oriol (vivid moment) |
| **0:12–0:20** what it is | Pull back to a top-down view of the 24-slot store: 4 aisles, 8 units, 3 rows, real Open Food Facts products, ~**[N_agents]** shoppers moving at once. | "A 3D store stocked with real UK products. Synthetic shoppers grounded in 10,642 Reddit comments and published shelf science. Every one of them leaves a trace." | Gianni (clear story) |
| **0:20–0:45** THE TRACE | Click shopper **#[id]**. A side panel opens: **slot `U3-r3` (bottom) → p_notice [0.xx]**, split into the row term (*eye level vs floor ≈ +39% sales*, source shown), the facings term (*elasticity 0.17, Eisend 2014*) and the trait term (*Conscientiousness → label reading*, citation). Then the product card: OFF fields she read (`additives_n`, `nutriscore`) with links to the OFF page. Her reason, in her own words. Mechanism tag `habit`. The Reddit verbatim that grounds it, with its URL. | "Why did shopper [id] walk past? Bottom row, one facing, notice probability [0.xx]. Every term links to its source. When she does notice something, she reads real label fields, and her reason is tagged to a mechanism we coded from real comments. No number without a source." | Ege ("grounding matters more than the simulation"), Adam (not a GPT wrapper), careers-page quote |
| **0:45–1:05** THE STATS + calibration | Product dashboard for the challenger: notice / consider / pick / walk-past, by archetype and by OCEAN segment, with CI bars. Then a sticker: **"checked against The Shelf: ρ = [rho], n = [n] humans"**, plus the honest line **"segments: wide, n too small"**. | "Per product: who noticed, who picked, who walked past, and why. We checked the sim against today's Shelf votes from [n] real people: rank correlation [rho]. The sim was more positive than the humans ([sim P(pick)] vs [human no/maybe]). We show that, and we correct it." | Ege, Adam (evidence), the brief's "how you validated it" |
| **1:05–1:25** THE OPTIMISATION LIFT | Toggle the optimiser: **move to eye level** and **surface the true "high fibre" claim** from OFF (`fiber_100g`). Re-run. Before/after bars with CIs: **notice +[X]pp, pick +[Y]pp among [segment]**. The losing honest edit shows too: e.g. "price −10p: no significant change". | "Only honest changes: shelf slot, facings, a true claim that was already on the label, price. Eye level plus the fibre claim moves pick share [Y] points for [segment], confidence interval shown. That's the buyer-meeting slide: what happens to the category if you say yes." | Adam (incrementality), David ("what happens if I say yes") |
| **1:25–1:45** THE AI-AGENT DIVERGENCE | Same shelf, flattened into a product feed. Model logos (via OpenRouter) shop it in randomised order. Split bar: **humans [h]% vs agents [a]%**, with **D = log(a/h) = [D]**. Then the mirror image: the agent's favourite is a product the humans walked past. | "Now the shopper that isn't human. Same products, read by AI agents. They can't taste and can't see eye level. They read structured data, and they're known to favour incumbents and shift with model versions (ACES, Allouah et al. 2025). Our challenger: [h]% with humans, [a]% with agents. The fix for humans did nothing for agents. The fix for agents is the missing data field." | Sophie ("speed of trends", the future), Oriol (working agents) |
| **1:45–2:00** CLOSE | RGC's seven dimensions as seven stickers. An eighth sticker drops in: **"8 · agent"**. End card: project name, repo URL, *"a number that cannot be traced back to its source is worse than no number at all."* | "Really Good Culture has seven dimensions, and they all model humans. This is the eighth: the agent shopper, measured side by side with grounded humans, traced to source, checked against real people today." | All. Gianni (stakeholder-ready ending) |

## Shot list / prep checklist

- [ ] Pick the hero challenger from the catalogue: `role: "challenger"`, on a bottom row in `planogram.json`, with a **true** claim available in OFF (e.g. `fiber_100g` ≥ 6 g qualifies for "high fibre" under EU Reg. 1924/2006 Annex; check the value).
- [ ] Choose the hero shopper id from a run where the decision is `walk_past` or `not_noticed`, and whose trace has ≥3 sourced factors.
- [ ] Fill all **[ ]** slots from `data/sim/runs/*.json` and `calibration/out/compare.json`. Screenshot the JSON in the repo as a backup.
- [ ] Record the 3D at 60 fps. If it stutters, record the replay, not the live run.
- [ ] Show one live re-run (Oriol: "working agents"). Keep the cached replay as a fallback.
- [ ] Captions for each beat, lowercase. Keep each line under 8 words.
- [ ] Make sure the repo, video and README links are public without sign-in (brief requirement).

## 3-minute live final version (if we make the six)

The brief gives finalists **3 minutes plus 2 minutes of Q&A**. Use the same beats, with three additions:

1. **+30 s, live calibration:** open `compare.json` from today's Shelf votes. Show the topline ρ, then the per-segment table, and say out loud where we **don't** trust the sim yet.
2. **+15 s, the AIPW correction:** "fit on 80% of voters, tested on the other 20%: error [naive]pp → [corrected]pp".
3. **+15 s, the "beyond the demo" slide:** cost per 1k shoppers, privacy and data ownership (`pitch/submission.md`).

Prepare answers from `pitch/judge_qa.md`.

# Submission (Tally form: https://tally.so/r/obJp2P, due 17:30 to the minute)

## Project name options

1. **same shelf, two shoppers**: the current working name (README). It says the whole idea: humans vs AI agents on the same shelf.
2. **walk-past**: names the data EPOS never has (David's blog: EPOS "says nothing about… the shoppers who walked past without buying").
3. **the 8th shopper**: points straight at RGC's seven dimensions. Risky if it sounds presumptuous.
4. **traceshelf**: leads with "every number traces to a source".
5. **passed over**: punchy and human, but less clear about the agent arm.

**Recommendation:** *same shelf, two shoppers*, with the tagline **"walk-pasts, traced to source."**

## Track: **Human Truth**

Reasoning:
- The Human Truth brief literally lists our two cores: *"What someone nearly chose or rejected"* and *"How AI shopping agents choose differently from humans, and what that means for brands."* Its fit test, *"uses human behaviour to explain or predict a choice and enables a useful action"*, describes the trace plus the honest-edit optimiser.
- Our behavioural layer is the differentiator: coded Reddit mechanisms (habit, trust, loss aversion, reactance), OCEAN modifiers with citations, and a literature notice gate. That is Track 1's vocabulary ("habit, trust, loss aversion, social proof").
- Track 2 (Retail Futures) would fit the optimiser output ("tells a buyer what to do next"), but the optimiser *depends on* the human-truth model. Leading with it would make us look like a planogram tool.
- Finalists are the top 3 *per track*, so track choice is also a bet on the competition. We can't observe it; the brief fit is the stronger reason.

## Project description (target 100–200 words; this is ~170)

> EPOS never sees the shopper who walked past. We built a 3D supermarket, 24 shelf slots stocked with real UK products from Open Food Facts, and let synthetic shoppers walk it. Each shopper is grounded in 10,642 coded Reddit comments and given Big Five traits, a mission and a budget. Before any LLM reads a pack, a literature-calibrated shelf model decides whether the product is even noticed (eye level, facings, centrality). Noticed products are read and picked, rejected or walked past, with a first-person reason tagged to a behavioural mechanism. Every number traces to a source: a paper, a Reddit thread, or an OFF field. An optimiser tests only honest edits (slot, facings, a true claim, price) and reports lift with confidence intervals. A second arm runs real AI shopping agents through OpenRouter on the same products, exposing where agents and humans diverge. We calibrated the sim against today's Shelf votes and report rank agreement, per-segment error and positivity bias openly. The result is a candidate eighth RGC dimension: the shopper that isn't human.

Before pasting:
1. Update the calibration sentence with the real ρ and n, or delete it if the votes didn't come in.
2. **Pre-existing work, to declare** (the brief asks for this). The research, Reddit corpus, persona staging and contract were committed between 11:05 and 11:17 on 3 Oct (`f85b13c` → `9f9e745`). The build period opened at 11:00, so anything prepared before then should be listed. Suggested line: *"Before the build period we gathered the research corpus and evidence notes; the store, sim, agents, optimiser, calibration and UI were built during EAT_HACK."* The team needs to confirm this is accurate.

## Beyond the demo

### Scale
- The notice gate and choice-model maths are cheap, deterministic Python/JS (CONTRACT `sim/notice.py`, no LLM). Only **noticed** products cost an LLM call, so cost scales with attention, not catalogue size.
- The store comes from a config file (`store.config.json`, CONTRACT). Going from 24 slots to a full 300-SKU category or a full store is a config change plus more OFF pulls. OFF has 4M+ products, and RGC's Product Graph claims 4M+ too (research/00).
- Runs are logged as replayable JSON and responses are cached (`data/sim/cache/`), so a re-run with one edit only pays for the agents whose noticed set changed.

### Cost: OpenRouter spend per 1,000 shoppers

Prices are live from `https://openrouter.ai/api/v1/models`, fetched 3 Oct 2026, in USD per token.

Assumptions:
- **~9 LLM calls per shopper.** This is the number of products noticed per walk. Assumption: 24 slots × ~2.5 products shown × mean p_notice ~0.15. **Replace with the real mean from the run log.**
- **~1,200 input tokens per call** (persona dossier + product card). Assumption.
- **~150 output tokens per call.** CONTRACT caps `max_tokens` at ≤300.

| model | $/M in | $/M out | per shopper | **per 1k shoppers** |
|---|---|---|---|---|
| meta-llama/llama-3.3-70b-instruct | 0.10 | 0.32 | $0.0015 | **≈ $1.5** |
| openai/gpt-4.1-mini | 0.40 | 1.60 | $0.0065 | **≈ $6.5** |
| google/gemini-2.5-flash | 0.30 | 2.50 | $0.0066 | **≈ $6.6** |
| anthropic/claude-haiku-4.5 | 1.00 | 5.00 | $0.0176 | **≈ $17.6** |
| equal 4-model mix | | | | **≈ $8** |

- The AI-agent arm costs one call per agent session over the whole feed, roughly 8k tokens in (assumption): about **$2–10 per 1k sessions** at the same prices.
- The hackathon budget cap is $50 (CONTRACT), which is about 6k mixed-model shoppers.
- At RGC scale, prompt-prefix caching of the persona dossier would cut input cost further. This is unmeasured, so we don't claim a number.
- Compare traditional virtual-store tests at £20–60k each, taking weeks (README "who pays").

### Privacy
- **No personal shopper data is needed.** Personas come from public Reddit comments (Arctic Shift archive) that are coded into mechanisms. We quote verbatims with thread URLs but store no usernames (`data/reddit/comments.csv` has no author column).
- The Shelf calibration form collects **no name, email or phone number**. It only takes an optional nickname and is reported in aggregate, with segments under n=8 suppressed (`calibration/README.md`).
- TIPI personality scores are compared only as room means, never shown per person.
- In production with RGC's Watch Humans voice memos, the grounding would sit in RGC's environment. The sim only needs coded mechanisms and parameters, not raw recordings.

### Security
- API keys stay in `.env` (gitignored).
- Agents receive the product feed as data. **Honest edits only:** the optimiser can't write free text into the feed, which closes off prompt-injection "optimisation" against AI shoppers.

### Data ownership
- Product data comes from Open Food Facts under the ODbL, with attribution and share-alike on the product database. Images are under their own CC licences, linked per product.
- Reddit excerpts are used as research quotes with links. We don't redistribute a model trained on them.
- No retailer scraping (README pressure test).
- A brand's own planogram, prices and claims stay the brand's. The run log is theirs to keep.
- RGC's proprietary data (EPOS partners, voice memos) would replace our public grounding inside their walls. Nothing leaves.

### Limitations (say these before the judges do)
1. **Simulated personas are hypotheses.** Skeptic agents scored the staged journeys 5–6.5/10 for realism, citing over-noticing, over-articulate reasons and acting on what personas *say* rather than what they *do* (research/05 §6).
2. **LLM shoppers are positivity-biased and variance-compressed** (arXiv 2609.13148: subgroup error 10–30pp). Our mitigations:
   - a notice gate before the LLM;
   - a forced walk-past option;
   - several models;
   - a Shelf calibration with an AIPW correction.
3. **The Shelf is ~50 builders tasting free samples.** It is a topline check, not a UK shopper panel, and gives no willingness to pay or repeat data.
4. **Reddit skews toward label-readers and complainers**, so mechanism counts are directional.
5. **Shelf-effect coefficients come from non-UK and older studies.** Several primary papers were paywalled and are cited through secondary summaries, tagged in research/04. The ACES agent coefficients come from non-food categories.
6. **No claim legality check** (HFSS placement, claim wording) beyond using true OFF values.

## Team / links checklist
- [ ] team member names
- [ ] public repo URL (README has run instructions)
- [ ] public video URL, ≤ 2:00
- [ ] Best Brand vote: our 3 favourites from The Shelf (and note this is the same shape as our calibration form)

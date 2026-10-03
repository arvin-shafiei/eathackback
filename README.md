# same shelf, two shoppers 🛒🤖

**EAT_HACK · Really Good Culture · 3 Oct 2026**: Track 1 *Human Truth*, with a Track 2 *Retail Futures* output

## ⛔ rule zero: we don't build a black box

RGC's judges say *"a number that cannot be traced back to its source is worse than no number at all."* So we hold ourselves to this standard:

- **Every number can be clicked down to its source.** That means an Open Food Facts field (barcode + field), a Jev probability (the exact question + answer distribution), a Reddit verbatim (thread URL), a paper or URL, real NielsenIQ sales (`data/sales/`), or a clearly **labelled assumption**.
- **Every persona shows its provenance:** Reddit threads → coded themes → behavioural mechanisms → the persona's lens weights, triggers and verbatims → the sim parameters it ends up with. You can see the breakdown visually on the dashboard.
- **Personas are editable, not magic.** A shop owner can build a new persona on the dashboard (OCEAN sliders, mission, budget, lens weights, triggers), run it through the store, and see why each of its decisions happened.
- **Arithmetic lives in code. Judgment lives in Jev**, which returns typed answers with calibrated probabilities. There is no generated prose pretending to be data.
- **It's enforced.** A Claude Code Stop hook (`.claude/hooks/blackbox-check.sh`) makes every work session end by answering *"is anything I just built a black box? if so, explain it."*

## the idea (v2, locked 3 Oct)

**Deep synthetic shoppers walk a 3D store, read real products, and every number they produce traces back to a source.**

1. **3D store (three.js / react-three-fiber).** Keep it simple and expandable.
   - 4 aisles with a divider down each, giving **8 shelving units × 3 rows = 24 slots**.
   - Each slot holds a *set* of items: one product family, the challenger next to its incumbent and the own-label version.
   - Layout comes from a config file, so it scales to more aisles, rows and items.
2. **Real products, real descriptions.** UK products from **Open Food Facts**: name, brand, pack copy, ingredients, additives (E-numbers), NOVA processing level, Nutri-Score, eco-score, labels (organic, vegan, Fairtrade), allergens, price per unit where available, and the image.
   - Every attribute links back to its OFF product page by barcode.
3. **Deep synthetic audiences using OCEAN (the Big Five).** Each shopper has Big Five trait scores *plus* a grounded persona: mission, budget, channel and habits, taken from the 13 evidence-grounded personas and 10.6k coded Reddit comments.
   - Traits map to shopping behaviour through **published links**, for example:
     - Openness → food neophilia and trying challengers
     - Conscientiousness → label reading and health-driven choice
     - Neuroticism → risk aversion, loss aversion and health anxiety
     - Agreeableness → ethical and eco concern
     - Extraversion → social proof and impulse
   - Agents run through **OpenRouter** (several models, so the audience isn't one model's monoculture).
4. **What each persona looks for, made explicit.** Every persona has a weighted **attribute lens**. The eco-minded parent looks for fewer additives, organic, eco-score A/B and recyclable packaging. The GLP-1 user looks for small portions, high fibre and low sugar. The frugal student looks for price per 100g and meal-deal eligibility. The protein-sceptic looks for the "gimmick" cue.
   - We **pick products to span those lenses**: high and low additives, NOVA 1→4, organic vs not, challenger vs incumbent vs own-label, cheap vs premium.
   - Each product is **graded per lens** with a visible, traceable score.
5. **Agents shop.** Each one walks the aisles, *notices* items (driven by shelf position and salience), *reads* the description, then *chooses, rejects or walks past*, and says **why in its own words**. That reason is tagged to the lens attribute and the behavioural mechanism it came from.
6. **Stats for brands.** Per product:
   - notice rate, consideration, pick share and walk-past rate, by persona, OCEAN segment and mission;
   - the top rejection reasons;
   - the **predicted sentiment** ("how shoppers would feel about it");
   - an AI-agent shopper comparison (human ↔ agent divergence).
7. **Optimisation for brands.** The system tests honest changes and re-runs the store to show the lift with a confidence interval: shelf slot, facings, pack claim, description rewrite (true facts only), price, own-label adjacency.
   - Output: *"move to eye level: +X% notice; add the true 'high fibre' claim: +Y% pick among conscientious, GLP-1 shoppers."*

### one engine, three surfaces (+ embed)

Every product has a **4-step funnel**: 👀 **look** → 🤚 **pick up** → ↩️ **put back** *or* 🧺 **take**. EPOS only sees the last step. We simulate all four, so we can say *where* a product loses people and *why*.

| surface | question | what it does |
|---|---|---|
| 🏪 **retailer / store owner** | "Which layout sells best, and which is easiest for my shoppers?" | Whole-store layout optimiser. Objective 1 is revenue and challenger exposure; objective 2 is shopper ease (shorter mission paths: put products where people already go). You can blend them. It respects the chilled-unit and UK HFSS placement rules, and shows before/after with CIs and a "move X to Y because…" diff. |
| 🏷️ **brand** | "Do people look, pick up, then put my product back, and why?" | Per-product funnel by persona and OCEAN segment. It diagnoses where people drop off: at *look* (shelf position/salience), at *pick-up* (the pack doesn't earn a second look), or at *put-back* (a label, price or trigger kills it, with the Jev probability and the Reddit verbatim). Plus a **pack test**: true claims the product qualifies for under Reg (EC) 1924/2006, tested for which version wins the pick-up. |
| 🧺 **shopper** | "What better option should I swap to?" | **Basket swaps**, e.g. a high-fibre alternative to an item in the basket, ranked by P(accept) × lens improvement. Shows the price delta, because claim-marketed products ("high fibre", "protein", "gut") usually carry a premium; we quantify that, and check whether the claim actually meets the legal threshold. |
| 🔌 **embed** | Use it inside retail workplaces and e-commerce | REST API (OpenAPI); a `<shelf-insight>` web component for product pages and intranets; an e-commerce search **re-ranker** per shopper type, with an agent-readiness check; a Slack brand digest; a Shopify mapping. |

**Engine: TypeSafe Jev** (System One). It returns calibrated probabilities instead of generated text: Choice for take / put-back / walk-past, Score for appeal, and Noul for each rejection trigger. Every "why" therefore comes with a probability, and the arithmetic stays in code. It costs about $0.04 per million input tokens, roughly $0.40 per 1,000 shoppers. **No LLM calls in the loop.**

**What a real deployment collects:** shopping mission and why they're shopping (big shop vs top-up), dwell, pick-up and put-back (shelf sensors / on-device CV counts), and the e-commerce equivalents (impression → detail view → add-to-cart → remove → purchase). Everything is aggregated (k ≥ 10) and consented. See `docs/data-collection.md`.

**Rule we build by** (RGC's own words): *"A number that cannot be traced back to its source is worse than no number at all."*
- Every stat is a count of logged agent decisions.
- Every decision carries its persona, OCEAN scores, the product fields it read, its stated reason, and the source each assumption came from: a Reddit verbatim, a paper, or an OFF field.
- No black boxes.

## pressure test (honest)

| attack | risk | answer / mitigation |
|---|---|---|
| **"It's a synthetic persona panel. RGC already shipped Buyer Agent and Signal Twins (Apr 2026)."** | 🔴 high | Don't pitch "personas". Pitch **grounding + traceability + space**. RGC's twins have no shelf, no walk-past and no agent-shopper arm. Lead with the 3D walk-past and the trace for each decision, not the panel. |
| **"LLM personas are too rational and too positive"** (NN/g: chatbots "want to please"; arXiv 2609.13148: subgroup error 10–30pp, WTP overstated ~3×). | 🔴 high | (a) A **notice gate before the LLM**: most products are never seen, decided by a literature-calibrated shelf model, not the LLM. (b) A forced **walk-past / no-buy** option and a budget. (c) Several models via OpenRouter. (d) A **calibration check** against real votes from The Shelf today (25 brands, 50 builders), reported honestly. |
| **"OCEAN is pop-psych."** | 🟠 med | Use only trait→food-behaviour links with citations (e.g. openness ↔ food neophilia/variety seeking; conscientiousness ↔ healthier eating and label use; neuroticism ↔ emotional eating and risk aversion). Show the link and source on hover. Traits are a *modifier* on grounded personas, not the whole model. |
| **"The 3D is eye candy."** | 🟠 med | The 3D *is* the data: shelf position drives P(notice) with cited effects (eye level ~+39% sales, facings elasticity ~0.17). The walk-pasts are visible. Ugly-but-true beats pretty-but-fake: 24 slots, boxes plus product images. |
| **"Can you build it by 17:30?"** | 🟠 med | Scope: one store, 24 slots, ~50–70 products, ~200 agent runs, one optimisation loop. Pre-compute runs and render replays; the live demo shows replay plus one live re-run. A fast utility model handles noticing; the LLM handles read-and-decide only for noticed items. |
| **"Where's the money?"** | 🟢 low | Challenger brands (RGC Club: 400+) want buyer-meeting evidence before listing; retailers want layout and range what-ifs. Anchors: the £999 Retail Report add-on; virtual-store tests at £20–60k taking weeks. |
| **"Scraped Tesco data?"** | 🟢 avoided | We use **Open Food Facts** (open licence, ingredients, additives, NOVA, eco-score). Better for traceability, and no ToS issue. Retailer price data is optional enrichment. |
| **"Is the agent-shopper arm a gimmick?"** | 🟢 low | It's the most original part: no RGC dimension covers it, and IGD/Kantar are warning about exactly this. Same products, structured feed, ACES-style randomised positions, report divergence. |

**Verdict:** build it, but **lead with traceable grounding**: "why did shopper #37 walk past Nutty Crunch?", answered by shelf slot, notice probability, OCEAN trait, the attribute read, a Reddit verbatim and the source. The personas and the 3D are how we deliver that, not the pitch itself.

---

> *"Your product won the room today. Here's why the robot that will shop for those same people in 2027 won't pick it, and the one honest fix that changes that."*

A **3D supermarket** stocked with real UK products. Two kinds of shopper walk the **same shelf**:

1. **Human shoppers**: agents grounded in evidence, each on a mission (meal-deal lunch, big weekly shop, top-up, GLP-1 user, frugal student…). They notice, consider, choose, **reject or walk past** products. The rules come from **10,642 real Reddit comments** coded into behavioural mechanisms and from shelf-effect literature.
2. **AI shopping agents**: ChatGPT, Claude and Gemini style agents, plus a retailer assistant such as the Tesco Clubcard agent. They "shop" the same range as a product feed. They can't taste, can't see eye level and never walk away. They read structured data, penalise "sponsored" tags and pile onto a few modal products.

We measure the **human ↔ agent divergence** for every product. We render the **walk-pasts** (the shoppers EPOS never sees). Then an optimiser **rearranges the shelf and the data** and re-runs, showing which challenger brand goes from *walked past* to *picked up*, by mission and by shopper type.

---

## why this, why now

| | |
|---|---|
| **RGC's own thesis** | EPOS *"says nothing about … the shoppers who walked past without buying"* (David, co-founder). Synthetic shoppers are *"only as credible as the behavioural data underneath them"* (Ege). Challengers face the circular *"need the listing to get the data"* problem (Adam). |
| **The gap** | All 7 of RGC's intelligence dimensions model **human** shoppers. None models the **agent shopper** that is arriving now: Tesco's in-app assistant (2026 rollout), ChatGPT Instant Checkout, Rufus, Google AI Mode. |
| **IGD** | *"It is machine visibility, not shelf visibility, that shapes choice."* |
| **Agents choose differently** | ACES (Allouah et al. 2025, arXiv 2508.02630): strong position bias that **flips between model versions** (GPT-4.1 favours slot 1, GPT-5.1 penalises it), sponsored-tag penalty, demand concentrated on modal products, shares reshuffled by model updates. *Incumbent Advantage*: at equal specs, incumbents are picked 100% of the time, and a +0.075★ edge flips 50% of choices. |
| **Challengers are already invisible** | 71% of new UK launches sat outside the top 100 search results or were missing entirely. About 76% of new lines fail in year 1. |
| **Nobody measures this for food** | No published study pairs LLM-agent choices with human choices on food or front-of-pack cues. |

## the human truths (from 10.6k Reddit comments)

Full write-up: [`research/03-reddit-human-truths.md`](research/03-reddit-human-truths.md)

1. **A hidden change counts as a lie.** Shrinkflation and skimpflation trigger betrayal aversion, and staying unchanged is itself a value proposition (~320 comments).
2. **The weekly shop is a memorised route.** Disruption doesn't create discovery; it creates abandonment (~290). *"It makes me spend less as I can't be bothered to look for it"* (r/britishproblems, 507 upvotes).
3. **Shoppers pick channels to control themselves.** Online and click-and-collect act as precommitment against impulse buying (~200).
4. **Fairness is judged against whatever sits next to the product.** Own-label anchoring; fake anchors still work (~300).
5. **Trust is borrowed** from insiders, negative reviews and named manufacturers, not built by the brand (~280).
6. **Every household has 1–3 "sacred" SKUs** that nobody substitutes (~330).
7. **"Too expensive" is cover** for effort, waste risk and pleasure (~330).
8. **People push back once they see they're being played** (protein-gimmick reactance, forced AI pop-ups).

## the maths (explainable, no black box)

**Human shopper: notice → consider → choose**

- `P(notice_i) = σ(α₀ + α_v·vertical + α_c·centrality + α_f·ln(facings) + α_s·salience + α_e·endcap)`
  - Calibrated to the literature: eye level vs floor gives about **+39% sales**, best vs worst horizontal position about **+15%**, facings elasticity about **0.17**, top shelf about **+17% noticing** (Chandon et al. 2009; Drèze et al. 1994; Eisend 2014; Atalay et al. 2012).
- `P(i | noticed set) = exp(U_i) / (exp(U_0) + Σ exp(U_j))` with
  `U_i = β_p·ln(price) + β_trust·trust + β_h·habit + β_m·mission_fit + β_promo·promo + β_ol·own_label − β_r·gimmick_reactance`
  - Per-persona parameters come from the skeptic-calibrated persona simulation (see below).
  - Out of stock: 31% buy at another store, 26% switch brand, 19% switch to the same brand, 15% delay, 9% don't buy (Gruen, Corsten & Bharadwaj 2002).

**AI-agent shopper: conditional logit, with ACES coefficients per model**

- `U_j = β·x_j + γ·position_j + δ·sponsored_j + η·badge_j`
  - Example (Claude Sonnet 4): ln(price) −1.62, rating +4.91, ln(reviews) +0.42, sponsored −0.14, badge +1.06, row 1 +1.22.
- We also run **real LLM agents** on the same shelf as a JSON or HTML feed, with randomised positions, to check the parametric model against them live.

**Outputs**

- **Divergence** per product: `D_j = log(s^agent_j / s^human_j)`, with bootstrap CIs, plus shelf-level Jensen–Shannon divergence.
- **Attribution**: Shapley decomposition of *why* a product loses with agents (reviews, rating, price, claims, position, tags).
- **Breakthrough threshold**: the smallest *honest* change that lifts agent share to human share, `Δx_k = [logit(s^H) − logit(s^A)] / β_k`.
  - For example: "+31 reviews, *or* add the true 'high fibre' claim to the feed, *or* −£0.18/100g".
- **Shelf optimiser**: simulated annealing over slot swaps. It respects facings and the UK HFSS placement rules, and reports the lift per mission with CIs across seeds.

## the personas (simulated in stages)

We built 13 evidence-grounded personas. Each was run through a 5-stage journey on the *same* test shelf, then **adversarially checked by a skeptic agent** that returned calibrated sim parameters.

- **Shoppers:** Priya (Ocado parent who says she avoids UPF), Jordan (Gen Z, delegates to ChatGPT), Margaret (in-store loyalist, angry about shrinkflation), Sam (GLP-1 user), Dev (frugal own-label student).
- **Founders:** Ellie (Nutty Crunch, range review looming), Marcus (Gutsy Pop: TikTok spike, thin data).
- **Buyers:** Aisha (Ocado digital range), Tom (Tesco buyer in a 2-year rotation), Rachel (retail media).
- **Agents:** Agent-GPT, Agent-Tesco.
- **Internal:** Ege (RGC AI engineer).

Results: [`research/05-personas.md`](research/05-personas.md)

## who pays

| payer | why | anchor |
|---|---|---|
| **Challenger brands** (RGC Club: 400+ brands, 1,000+ on the newsletter) | Agent-readiness audit plus breakthrough threshold per SKU, and evidence for the buyer meeting | Watch Humans Retail Report £999 add-on; digital-shelf tools ~£10–50k a year |
| **Retailers / online grocers** (Ocado, Tesco/dunnhumby, Nectar360) | Range and layout what-ifs by mission; whether agent baskets collapse range diversity; whether sponsored slots lose value | Virtual-store studies ~£20–60k each, taking weeks |
| **RGC** | An **8th dimension, "Agent"**, for Breakthrough, which Aaru, Simile and Electric Twin don't have | New product line |

## honest limitations

- Simulated personas are **hypotheses**, not data. That's why each one is grounded in quoted evidence and checked by a skeptic. Calibration path: real votes from The Shelf, plus an AIPW correction using 50–300 real responses (arXiv 2609.13148 reports 83–94% bias reduction).
- Reddit over-represents label-readers and list-makers. Counts are directional.
- The ACES coefficients come from non-food categories, so food-specific agent behaviour is measured live.
- Only **honest data edits** are allowed: filling in true missing facts, never adversarial prompt text.

---

## repo

- `brief/`: challenge brief
- `research/`
  - `00-rgc-intel.md`: what RGC sells, their blog theses
  - `01-concept-3d-store.md`: the concept
  - `02-issue-discovery.md/.json`: research across 8 angles plus the judge's ranking of 20 candidate issues
  - `03-reddit-human-truths.md`, `03-reddit-coded.json`: behavioural coding of 10.6k comments
  - `04-3d-sim-evidence-and-tech.md`: shelf-effect numbers, ACES agent coefficients, choice model, stack
  - `05-personas.md`: staged persona simulation (in progress)
  - `corpus/`: top comments per theme (inputs for the coding agents)
- `data/reddit/`: raw corpus (133 threads, 10,642 comments; JSONL, CSV, one JSON per thread). See `data/README.md`.
- `scripts/`: data collection (Arctic Shift Reddit archive)
- `design/`: design language (tokens, component references, visual references)
- `.claude/skills/`: superpowers + impeccable skills

## stack (planned)

react-three-fiber + drei (3D store), Kenney Mini Market / Food Kit (CC0) assets, Open Food Facts product data and images (UK), grid A* pathing, a fast utility model in JS for thousands of shoppers, and the Claude API for real agent shoppers and "thought bubbles".

## engine: typesafe jev

The shopper decisions in `sim/` are made by **TypeSafe Jev** (System One, `jev-1.13.0`), the default engine (`python3 sim/run.py --engine jev`). Code owns the walk, the notice model, every price and nutrition comparison, and the budget. Jev only answers narrow, typed questions about one shelf at a time. Full design: [`sim/README.md`](sim/README.md#engine-typesafe-jev-simjevpy).

**What we ask.** One request per (shopper, slot) carries every question for every product the shopper noticed ([speculative fan-out](https://docs.typesafe.ai/patterns/fan-out.md)):

- **Choice `decision`**: which noticed product the shopper takes, or `none` (walks past). Option order is shuffled and recorded, because Jev 1.13 can lean to the first option ([jaggedness #8](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)).
- **Noul `pickup_i`**: does the shopper pick this product up to look closer? This is the 👀 look → 🤚 pick-up step of the funnel. If a shopper who doesn't usually read labels picks something up, a second request re-judges with the back of pack revealed.
- **Score `appeal_i`** (5 levels, from "would actively avoid" to "really wants it"), mapped to sentiment −1..1 in code.
- **Noul per rejection trigger and trust signal** (the persona's top 3 + top 2): "Does `products[i]` show what `shopper.put_offs[k]` describes?". This is the *why*.
- **Choice `mechanism_i`**: habit, betrayal/loss aversion, price anchor, trust, gimmick reactance, social proof, health goal, mission fit, novelty, effort or indifference.

Jev never sees a raw number it would have to do maths on. Prices arrive as "about 2x the cheapest here", nutrition as UK traffic lights ("sugar: red (high)"), additives as "one or two additives" and processing as "ultra-processed (NOVA 4)" ([keep arithmetic in code](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)).

**Why calibrated probabilities make it traceable.** Every answer is a distribution, not prose: P(take) for each option, P(pick up), P(the card shows this put-off), and the appeal-level probabilities with a [confidence](https://docs.typesafe.ai/confidence.md) score. Code samples the take/put-back outcome from that distribution with a seeded, recorded draw. So any single decision can be replayed exactly, and the aggregate pick rate *is* the model's probability mass, not one verbose sample. The "why" is assembled from the evidence that fired, for example *"picked it up, put it back: sees 'Protein/new recipe claim carrying a price premium' (p=0.53)"*, followed by the persona's Reddit verbatim and URL. Each event stores the cache key of the exact state + questions + raw answer (`data/sim/cache/jev/`), so a judge can click from a stat to the question Jev was asked and the full distribution it returned.

**Cost at scale** ($0.042 per 1M input tokens, output free; limits 80 req/s and 100k tok/s):

| run | requests | input tokens | cost | wall |
|---|---|---|---|---|
| 300 shoppers (seed 11, 96 SKUs, 24 slots) | 6,187 | 22.7M | $0.95 uncached ($0.87 actual) | 223 s |
| **per 1,000 shoppers** | ~20.6k | ~76M | **~$3.20** | ~13 min (limited by 100k tok/s) |
| AI-agent arm, per 1,000 feed sessions (24–36 items each) | 1,000 | ~8M | ~$0.34 | ~1 min |

That is about **$0.003 per shopper** for ~20 requests holding ~415 typed judgments, versus ~$0.006 per shopper for one free-text LLM call per slot. Re-runs with unchanged inputs are served from cache for $0.

**Result from the 300-shopper run:** 57% of product passes are noticed. Of noticed products, 38% are picked up, and 56% of pick-ups are taken. Take rate is 20.0% for own-label, 11.0% for incumbents and 8.9% for challengers. In the AI-agent arm, Jev shows **no first-position bias** (2.5% of picks at position 1 vs 3.5% expected by chance). The Gemini Flash and GPT-4.1-mini agents earlier showed a 4–5x bias.

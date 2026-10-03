# same shelf, two shoppers 🛒🤖

**EAT_HACK · Really Good Culture · 3 Oct 2026**: Track 1 *Human Truth*, with a Track 2 *Retail Futures* output

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

# 3D store sim: shelf evidence, agent-choice coefficients, choice model, tech

I've finished the research, but on thinner sourcing than you asked for: the session's web-search budget (200 calls) was already used up, so my first search failed. I worked from about 45 direct fetches of known URLs and arXiv API queries instead. Several primary papers (Chandon 2009, Drèze 1994, Inman 2009, Bell 2011, Eisend 2014) were paywalled (403/404). Every figure is tagged:
- **[V]**: I confirmed it from the fetched source this session.
- **[M]**: from memory of the literature and not re-checked today. Check these before quoting any of them on stage.

---

# 1. Shelf and store behavioural effects

| Effect | Number | Source |
|---|---|---|
| Vertical position, worst vs best shelf height | **+39% sales** | [V] summary in [Wikipedia: Planogram](https://en.wikipedia.org/wiki/Planogram) (field study it cites) |
| Horizontal position, worst vs best | **+15%** | [V] same |
| Height and horizontal combined | **+59%** | [V] same |
| Top shelf vs bottom shelf | **17% more likely noticed, 20% more likely chosen** | [V] same; matches Chandon et al. 2009 |
| Facings elasticity | **average 0.17** (1,268 estimates); doubling facings gives about **+20% sales**, with diminishing returns | [V] Wikipedia Planogram; meta-analysis is Eisend 2014, *J. Retailing* [M] |
| Chandon, Hutchinson, Bradlow & Young 2009, *J. Marketing* 73(6) (eye tracking) | More facings raise attention and evaluation, and the effect runs entirely through attention. It is strongest for low-share brands. Top and middle shelves draw more attention, but only the top-shelf gain carries through to evaluation. Attention matters more than memory. | [M] (PDF blocked) [journal link](https://journals.sagepub.com/doi/10.1509/jmkg.73.6.1) |
| Drèze, Hoch & Purk 1994, *J. Retailing* (60-store test) | Position matters more than number of facings. Facings changes of about ±50% had little effect above a minimum threshold. Eye to waist level is best. | [M] |
| Horizontal centre bias (Atalay, Bodur & Rasolofoarison 2012, *JCR* 39(4)) | The central option gets more attention and is chosen more often. A "central gaze cascade" just before the decision predicts choice; the first-glance centre bias does not. This holds with physical products too. | [V] [OUP](https://academic.oup.com/jcr/article/39/4/848/1798003) |
| Out-of-stock reactions (Gruen, Corsten & Bharadwaj 2002; 72,000 shoppers, 8 categories) | **31% buy at another store, 26% switch brand, 19% switch to the same brand, 15% delay, 9% don't buy**. Average OOS rate **8.3%**. Retailers lose about **40%** of intended sales on the item, manufacturers about **35%**. 70–90% of OOS comes from in-store replenishment. | [V] [Gruen & Corsten OOS guide PDF](https://www.nacds.org/pdfs/membership/out_of_stock.pdf), [Wikipedia: Stockout](https://en.wikipedia.org/wiki/Stockout) |
| What drives OOS reactions (Campo & Gijsbrechts) | High urgency, high switching cost and low effort lead to another store. Low urgency and high switching cost lead to delay. High switching cost and high effort lead to the same brand. Low switching cost and high effort lead to another brand. Ready-made rules for agents. | [V] same PDF, Fig. 5 |
| Purchase decisions made in store | ~70% [V] (Wikipedia Planogram); POPAI 2012: **76%** [M]. Kollat & Willett 1967: ~50% unplanned [M]. Inman, Winer & Ferraro 2009: ~40–60% unplanned depending on category and trip [M]. | |
| Walking distance and unplanned spend (Hui, Inman, Huang & Suher 2013, *JM*) | **+10% walking distance gives about +16% unplanned spend** [M]. This is the core reason to put a destination category at the back of the store. | |
| Paths (Larson, Bradlow & Fader 2005; Hui, Fader & Bradlow 2009) | Shoppers loop the perimeter ("racetrack") and dip briefly into aisles rather than walking them end to end. They get more purposeful as the trip goes on. Most of the store goes unvisited (Sorensen: roughly ¼ to ⅓ covered; about 80% of time spent walking, 20% picking). Most US shoppers move anticlockwise. | [M] |
| Store entrance (Underhill, *Why We Buy*) | A "decompression zone" of the first ~3–5 m where displays are under-noticed, plus a habit of turning right on entry. | [M] |
| Time at the shelf (Dickson & Sawyer 1990; Hoyer 1984) | About **12 s** per category decision; many shoppers look only at the brand they choose; about 1.2 packs handled. | [M] |
| End caps / gondola ends | Uplift is typically **2–5×** baseline when paired with a promotion; much of it comes from the promotion, not the location. | [M] |
| UK regulation (relevant to your checkout/end-cap optimiser) | Food (Promotion and Placement) (England) Regulations 2021, in force Oct 2022: in stores over 2,000 sq ft, HFSS food cannot sit at checkouts, aisle ends or entrances. Have the optimiser enforce this. | [M] |
| Virtual-store validity (InContext Solutions) | Claims **96% correlation with real-world shopper behaviour**. One case study: **+14% from horizontal colour blocking**, ROI 800:1. | [V] [incontextsolutions.com](https://www.incontextsolutions.com/) (vendor claim) |
| Compromise and decoy effects (Simonson 1989; Huber, Payne & Puto 1982) | Shares typically move **5–15 percentage points**, but only when the shopper is close to indifferent between the two main options. | [V] condition from [Wikipedia: Decoy effect](https://en.wikipedia.org/wiki/Decoy_effect); size [M] |
| Price elasticity (Bijmolt, van Heerde & Pieters 2005 meta-analysis) | Mean **−2.62** [M] | |

**UK meal-deal and missions:** I could not fetch IGD/Kantar figures (404). Use mission parameters based on these [M] studies and label them assumptions:
- **Meal deal:** about 3–6 min in store, 3 items (main + snack + drink).
- **Top-up:** about 5–10 min, 5–10 items.
- **Big weekly shop:** about 30–45 min, 40+ items.

# 2. Online shelf and AI-agent shelf

**Allouah, Besbes, Figueroa, Kanoria & Kumar, "What Is Your AI Agent Buying?"** [arXiv 2508.02630](https://arxiv.org/html/2508.02630). Open-source testbed [ACES](https://github.com/mycustomai/ACES) (MIT). [V] conditional-logit coefficients:

| Model | Row 1 | ln(price) | Rating | ln(reviews) | Sponsored | "Overall Pick" badge |
|---|---|---|---|---|---|---|
| Claude Sonnet 4 | +1.22 | −1.62 | +4.91 | +0.42 | −0.14 | +1.06 |
| GPT-4.1 | +1.05 (Col 1 +1.12) | −1.61 | +8.30 | +0.74 | −0.25 | +0.80 |
| Gemini 2.5 Flash | +0.34 | −2.19 | +5.39 | +0.50 | −0.26 | +1.90 |
| Claude Opus 4.5 | +0.47 | −1.89 | +11.15 | +0.98 | −0.34 | +1.87 |
| GPT-5.1 | **−0.70** | −2.80 | +9.25 | +0.80 | −0.37 | +1.34 |
| Gemini 3.0 Pro | **+2.15** | −2.25 | +4.22 | +0.67 | −0.62 | +2.14 |

What this shows:
- **Position bias is large and flips between model versions.** GPT-4.1 favoured slot 1; its successor GPT-5.1 penalises it.
- **Choice concentrates on a few products, and the leader changes with the model.** Fitbit Inspire's share went from 45% to 77% between Claude Sonnet 4 and Opus 4.5, and from 25% to 6% between GPT-4.1 and GPT-5.1.
- **Agents penalise "Sponsored" tags and reward platform endorsements.**
- **A seller agent that rewrites product descriptions gains +3.7 to +14.9 percentage points of share** (significant in 33% of category–model pairs).

Other evidence:
- **Changing the order of answer options changes LLM accuracy by 13–75%.** [V] [2308.11483](https://arxiv.org/abs/2308.11483)
- **Listwise rerankers flip 89.7% of pairwise preferences when the input is reordered.** [V] 2608.03091
- **"Generative engine optimisation" content changes raise visibility by up to 40%.** [V] [2311.09735](https://arxiv.org/abs/2311.09735)
- **A crafted "strategic text sequence" can push a product to the top recommendation.** [V] [2404.07981](https://arxiv.org/abs/2404.07981)
- **AI agents penalise sponsored listings less when told they work for the platform rather than the shopper.** [V] [2609.17989](https://arxiv.org/abs/2609.17989)
- **Under vague goals and costly search, agents fall back on human-like heuristics (charm pricing, promo framing); specific goals largely prevent this.** [V] [2609.28372](https://arxiv.org/abs/2609.28372)
- **Without value guidance, GUI agents take shortest paths, and discounts and ads override user values.** [V] [2601.16356](https://arxiv.org/abs/2601.16356)
- **PAARS builds persona agents mined from shopping logs; LLM agents show brand bias and rating bias.** [V] [2503.24228](https://arxiv.org/abs/2503.24228)

**Online grocery [M], not verified:**
- Re-ordered items ("favourites" / "buy it again") are roughly 40–60% of a UK online basket.
- The first ~3 search slots take the majority of clicks.
- Ursu 2018 (*Marketing Science*, Expedia data): rank changes what gets clicked, not purchase once clicked.

# 3. Explainable two-stage choice model

The model has two stages. First the agent notices a product; then it chooses among what it noticed.

**Stage 1: does the shopper notice it?**
- P(notice_i) = σ(α₀ + α_v·vertical_i + α_c·centrality_i + α_f·ln(facings_i) + α_s·salience_i + α_e·endcap_i − α_d·decompression_i)
- vertical_i: eye level = 1, waist = 0.6, top = 0.5, floor = 0.2.

**Stage 2: which of the noticed products does it choose?**
- P(i | noticed set C) = exp(U_i) / (exp(U_0) + Σ_{j∈C} exp(U_j)), where option 0 is "no purchase" and also covers out-of-stock walk-outs.
- U_i = β_p·ln(price_i) + β_b·brand_trust_i + β_h·habit_i + β_m·mission_fit_i + β_promo·promo_i + β_ol·own_label_i

**Suggested starting values (calibrate so the lifts match section 1):**

| Parameter | Range | Basis |
|---|---|---|
| β_p (ln price) | −1.5 to −2.8 | Matches Allouah's LLM estimates and the −2.6 grocery price-elasticity meta-analysis |
| β_h (habit, bought last time = 1) | 1.5 to 3 | Strong state dependence in panel logit models (Guadagni & Little 1983) [M] |
| β_m (mission fit) | 2 to 4 | Effectively gates the category |
| β_promo | 0.5 to 1 | |
| α_f | ≈ 0.17–0.2 | Gives ~+20% at doubled facings once noticing feeds into choice |

The attention terms are set so that eye level vs floor gives about +39% sales, best vs worst horizontal position gives +15%, and top shelf gives +17% noticing.

**Out-of-stock:** when the chosen product is missing, draw from the 31/26/19/15/9 split above.

**Unplanned buying:**
- Give each item the agent walks past a small impulse probability, rising with its noticing score.
- Scale the agent's impulse budget by mission: meal deal low, weekly shop high.
- Apply the walking-distance rule: +10% distance gives +16% unplanned spend.

**AI-agent shopper:**
- It skips the walking stage and sees a ranked list.
- Use Allouah's row/column and badge coefficients directly.
- Show position bias as a model-specific variable, since it flips between model versions.

Each agent's "thought bubble" is just the largest contributions to its U_i. That keeps it explainable without an LLM call per decision.

# 4. Tech stack for a one-day build

- **Rendering:** react-three-fiber plus drei is fastest for a placement UI (click to pick, drag onto shelves, `<Instances>` for products). Use plain three.js if the team doesn't use React. Babylon is fine but slower to iterate.
- **Assets:**
  - [Kenney Mini Market](https://kenney.nl/assets/mini-market): CC0, 20 files, 2024, includes animation. It looks like a ready store kit, but I couldn't confirm which file formats it ships.
  - [Kenney Food Kit](https://kenney.nl/assets/food-kit): CC0, 200 models, GLTF/GLB/FBX/OBJ.
  - [Quaternius Ultimate Food](https://quaternius.com/packs/ultimatefood.html): CC0, 103 models, but FBX/OBJ/Blend only, so convert to GLB.
  - [Poly Pizza](https://poly.pizza/search/supermarket): supermarket freezer, CC0 shopping cart (Google Poly).
  - Simplest path: build shelves as boxes and put product images on planes.
- **Product images:** Open Food Facts. I tested this call and it returns **930 UK sandwich products**:
  `GET https://world.openfoodfacts.org/api/v2/search?countries_tags_en=united-kingdom&categories_tags_en=sandwiches&fields=code,product_name,brands,image_front_small_url&page_size=50&sort_by=unique_scans_n`
  - Rate limits: **10 searches/min** and **15 product calls/min**. Pre-fetch the catalogue into a JSON file in the morning.
  - Send a custom `User-Agent: App/1.0 (email)` header.
  - Images are CC BY-SA, so show attribution. [docs](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- **Pathing:**
  - A grid with A* is enough. A store with aisles is roughly a 60×40 grid; run A* in JS through the agent's ordered list of target categories.
  - For crowd motion, use [recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js) (`@recast-navigation/three`, WASM, has crowd simulation) or [three-pathfinding](https://github.com/donmccurdy/three-pathfinding) (1.4k stars, needs a pre-baked navmesh).
- **LLM vs utility model:** run the utility model for every choice, so 1,000 agents finish in milliseconds and the optimiser can re-run many times. Use the LLM only for:
  1. generating personas and missions;
  2. writing a few thought bubbles per run;
  3. the real AI-agent shopper, shown a text or JSON shelf (as ACES does).
  - Cost: Claude Haiku 4.5 is **$1 / $5 per million tokens** in/out (Sonnet 5.5 $2/$10) [V] [claude.com/pricing](https://claude.com/pricing). 100 agent calls of ~2k tokens each costs under $0.30.
- **Optimiser:** greedy or simulated annealing over slot swaps (a tabu-search floor-space precedent exists: [arXiv 2011.04422](https://arxiv.org/abs/2011.04422)). Score is simulated revenue or margin, subject to facings and HFSS rules. Re-run the agents and show the lift with a confidence interval across seeds.
- **Existing open-source simulators:** sparse.
  - [Supermarket_MCMC_Simulation](https://github.com/topics/supermarket-simulation): Markov-chain movement between store sections only.
  - COVID supermarket agent-based model: [2010.07868](https://arxiv.org/abs/2010.07868).
  - Supermarket congestion gravity model, which finds popular zones on the perimeter: [1905.13098](https://arxiv.org/abs/1905.13098).
  - RetailBench (LLM store-operations benchmark): 2603.16453.
  - The NetLogo community library was down for maintenance.
  - I found nothing combining behavioural shelf choice with an AI-agent shopper.
- **Datasets:** [SKU-110K](https://github.com/eg4000/SKU110K_CVPR19), dense shelf images, academic/non-commercial licence only. Also RP2K (retail products), and planogram-compliance papers 2212.01004 and 2401.06690. None of these are needed for the demo.

# 5. Commercial landscape and the gap

- **InContext Solutions:** 3D/VR virtual stores for shelf and planogram tests with recruited human shoppers. Clients include Coca-Cola, Kellogg's, Diageo and Albertsons. Claims 96% correlation with real behaviour [V].
- **Trax:** image recognition of real shelves for compliance, out-of-stock and share of shelf. Clients include AB InBev, Unilever and Heineken [V]. It measures shelves after the fact; it doesn't simulate.
- **Blue Yonder, RELEX, Symphony RetailAI** (and the older Nielsen Spaceman / IRI Apollo planogram tools): space optimisation from historical sales and space elasticities [M]. Their pages 404'd today.
- **Simogon:** domain didn't resolve.
- **Kantar:** VR shelf testing [M]; page 404'd.
- **Pricing:** none of these publish prices. My unconfirmed understanding [M] is enterprise SaaS in six figures per year, and a virtual-shelf study at roughly £20–60k with weeks of turnaround.

**The gap:**
1. Existing tools either optimise from past sales (no reasons, no new layouts) or test with paid human panels (slow, costly).
2. Nobody simulates mission-specific shoppers plus AI shopping agents in one store, even though Allouah shows AI-agent "shelf" biases are large, differ by model and flip between versions.
3. An explainable, literature-calibrated model offers instant what-if runs, a "why" for every choice, and a check on how ChatGPT- or Rufus-style agents would rank the same range.
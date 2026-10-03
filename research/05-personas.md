# Staged persona simulation (13 personas × 5 stages + skeptic)

Raw dossiers, journeys, skeptic verdicts and calibrated params: `data/personas/staged_personas_v1.json`

# Same Shelf, Two Shoppers: Strategy Report

*EAT_HACK, for Really Good Culture. Built from 13 persona journeys (5 human shoppers, 2 AI agents, 6 business stakeholders), each checked by a skeptic. The skeptics scored the journeys 5 to 6.5 out of 10 for realism. Every number below is a **calibrated prior to test**, not a measured result, unless it carries a source.*

---

## 0. The test shelf

| | Product | Price | Rating (reviews) | In the meal deal? | Where it sits in the Express | What the online feed is missing |
|---|---|---|---|---|---|---|
| **A** | Gutsy Pop (challenger, prebiotic soda) | £1.85 | 4.6 (31) | No | Chiller, pastel can, 40 stores only | No "high fibre" claim, although it has 6g fibre; no price per litre |
| **B** | Coca-Cola Zero 330ml | £1.25 | 4.7 (12,400) | **Yes** | Eye level, 6 facings | Complete |
| **C** | Tesco Light cola (own-label) | £0.55 | 4.1 (2,100) | No | Bottom shelf | Complete |
| **D** | Grenade-style protein bar | £2.20 | 4.5 (8,900) | **Yes** | Snack bay, "20g PROTEIN" on pack | Complete |
| **E** | Nutty Crunch (challenger, oat and nut bar) | £1.60 | 4.8 (12) | No | Side shelf, 1 facing, kraft paper pack | Has a **Sponsored** tag online; reviews are too few |
| **F** | Tesco protein bar (own-label) | £1.10 | 3.9 (640) | No | Snack bay | Pack shrank from 50g to 40g; the feed has no record of the old size |

---

## 1. The divergence table

### 1a. Who picked what

| | Humans who pick it, by mission | AI agents who pick it | Who walks past, and why |
|---|---|---|---|
| **A Gutsy Pop** | **Taste-test winner.** Priya nearly bought it in the Express chiller, then bought it once outside meal-deal hours ("Honestly lovely"). Dev tried it once on a clearance price. Nobody repeats it. Realistic buy probability in store is about 0.1 on a meal-deal visit, about 0.3 off the meal deal. | **ChatGPT-style agent:** about 14% as the "also consider" mention before the fix (skeptic prior up to about 30%, because the agent may know "prebiotic" means a healthy soda). **Tesco assistant:** **0%**. It isn't stocked at the store that fulfils the order, and its feed has no fibre field. | Jordan and Dev: "no purple sticker, £1.85". Margaret: "looks like a bath bomb", a gimmick for young people. Sam: fizzy drinks are a problem on GLP-1. Tom (buyer): no rate-of-sale figure benchmarked against the category, and not in the meal deal. |
| **B Coke Zero** | Picked by **everyone on a meal-deal mission**: Priya, Jordan, Dev, and Margaret (for her husband). Sam walks past (sweetener plus fizz), with a 0.10 to 0.15 chance of still buying. | **ChatGPT-style agent:** about 50 to 71%. **Tesco assistant:** about 60 to 76% (bought 6 times in Clubcard history, plus its rating). | Only Sam. Coke Zero is the one product where human picks, revealed preference and agent picks agree. |
| **C Tesco Light cola** | Almost nobody: bottom shelf, never seen. Margaret checks the price "out of habit", then rejects it because her husband "would know straight away". | **Tesco assistant:** about 24% when the budget cap forces a cheaper swap. **ChatGPT-style agent:** about 15% on "cheapest decent". | **Jordan deletes it from the agent's basket**: "I'm not drinking own-brand cola, it's a vibe thing." This is the only place a human edit overrides the agent. |
| **D Protein bar** | Jordan and Dev pick it in the meal deal because it's effectively free ("if it's free it's not a gimmick, it's arbitrage"). Priya might pick it for herself in the meal deal. Priya, Sam and Margaret reject it for children or for themselves. | **ChatGPT-style agent:** about 45 to 76% (reads "20g protein" at face value). **Tesco assistant:** about 36%, and it becomes the substitute when F is out of stock. | Sam: "sweetener? no" plus the kcal-to-protein ratio. Margaret: "a biscuit with ideas above its station". Priya: "I'm not putting sweeteners in a seven-year-old." |
| **E Nutty Crunch** | **Margaret's near-choice.** She held it for 15 seconds because "it looks like actual food", then put it back: unknown maker, fear of wasting £1.60 on a one-strike trial. Calibrated chance of her even noticing it: 0.08 to 0.15. Sam discovers it through Mumsnet, saves it, never buys it. | **ChatGPT-style agent:** about 9%. **Tesco assistant:** about 4% (fails the "high protein" filter; 12 reviews; Sponsored tag). Skeptic prior: about 6 to 10%. | Everyone else in store: side shelf, 1 facing, kraft pack blends in, about 0.09 chance of being noticed. Priya: £16 a week for ten bars, and a nut-free school would rule it out anyway. Tom: rejected at the form stage ("shelf life TBC"). |
| **F Tesco protein bar** | Priya's default (an 18-month Favourite, never re-evaluated). Dev buys it off the meal deal, then leaves after spotting the shrinkflation. Sam rejects it (ratio about 12, sucralose). | **Tesco assistant:** about 60%, the modal snack (bought 4 times, cheapest per 100g). **ChatGPT-style agent:** about 15 to 25%, as the "value" pick. | Humans punish the 50g to 40g shrink once they notice it. **The agent can't see it**: "no pack-size history field". |

### 1b. Where the two sides diverge

| Pattern | Products | What drives it |
|---|---|---|
| **Challenger wins with humans, loses with agents** | **A, E** | Taste, pack honesty and weight in the hand don't appear in any feed field. Thin reviews and empty claim fields make both products invisible to agents. |
| **Humans reject it, agents pick it** | **D, F** | Agents take "20g PROTEIN" at face value. They can't see sweetener aftertaste, a gimmick claim or a shrunken pack. Sam: *"the robot hands me a cookie-dough bar full of sucralose."* |
| **Humans and agents agree** | **B** | Eye level, 6 facings, the meal deal, 12,400 reviews and a complete feed. It wins every arm of the test. |
| **The agent picks it, a human overrides** | **C** | Brand feel beats the agent's value logic, but only when a human reviews the agent's basket. |

---

## 2. Top 7 insights

### 1. The challengers lose to what surrounds the decision, not to their products. The only product every arm agrees on is the incumbent.
In Priya's journey the same shelf produced three answers. What she says she values picks A and E. What she actually does picks F and B. Her assistant picks D and B.
- Priya: *"I didn't choose those bars. I chose them once, two years ago, and the app's been choosing them ever since."*
- Margaret's skeptic: *"Human and agent agree on the incumbent. Divergence shows up only in rejection reasons, not in what ends up in the basket."*

A challenger loses three different ways: to meal-deal pricing in store, to Favourites lock-in online, and to review count when an agent shops.

### 2. D and F are the mirror image of A and E: agent winners that humans reject.
Agents read claims, not experience. They pick exactly the product the human put back.
- Sam: the assistant ranked D first for "high protein, no sweeteners". Sam read the back of the pack: maltitol, sucralose, a laxative warning. *"Now I just do the quick math of calories per gram of protein and if its above 10 i put it back lol"* (r/1200isplenty).
- Jordan: *"Tried a protein Mars bar, like chewing on Gandhi's flip flop."*
- On F, the Tesco assistant says: *"The shrinkflation that made human shoppers on r/CasualUK angry never reaches me as betrayal."*

So agent baskets push volume to products humans are quietly abandoning. That shows up in EPOS as stable category value.

### 3. The meal deal decides the Express shelf, and no agent models it.
Inside the deal, Coke Zero's price to the shopper is effectively £0, so every challenger reads as "£1.85 extra".
- Priya: *"I'm not paying more for the drink than for half my lunch."*
- Dev: *"If it's not got the purple meal-deal sticker it basically doesn't exist."*
- Corpus: *"But if I'd pay full price, I wouldn't buy at all"* (meal_deal.md).
- The agents ignore the deal entirely. Agent-GPT: *"It needs a 'main', the user didn't ask for one, so it never becomes part of the problem."* Agent-Tesco: *"the meal deal means nothing to me."*

The strongest in-store lever has no effect on agents. The strongest agent lever (feed data) has no effect on lunchtime humans.

### 4. The Sponsored tag cuts three ways. Endorsement badges are the real lever.
- **For humans online:** the skeptics corrected the journeys here. A top Sponsored tile probably *raises* the chance a human sees the product. The Priya skeptic said the journey "hands her the agent's bias".
- **For third-party agents:** the penalty is small. Research puts it at about 10% falling to 8% (ACES).
- **For the retailer's own assistant:** it may be *boosted*, because the retailer owns the media network.
- **Endorsement badges** lift agent selection from 10% to between 24% and 43%.
- Rachel (retail media lead): *"I sell the top of the page to a shopper who's stopped reading the page, and my own company built the shopper."*

So Nutty Crunch's paid slot is roughly neutral overall. It is not the main problem. The fix to sell is a non-purchasable editorial or verified badge.

### 5. A rejection leaves no data trail. Rendering the walk-past is the product.
- Margaret's near-choice was "picked up then put back", and that *"leaves no data trail."*
- Sam's rejection is logged by neither the till nor the assistant: *"its picture of the mission stays 'success'."*
- Agents "never decline to buy" (arXiv 2608.22697).
- Ege (RGC): *"My synthetic shoppers never walk past anything, and the agents never walk past anything either. Right now the only thing in our stack that can say no is a human we haven't measured."*
- RGC's own line: EPOS *"says nothing about… the shoppers who walked past without buying."*

### 6. Only the first basket can be won, and only if the product is stocked where the order is filled.
- Rachel: *"The ad I'm selling only reaches the first purchase. After that, the favourites list does the buying."*
- Tesco reports that about 80% of shoppers accept substitutions and 9 in 10 keep them.
- Priya liked Gutsy Pop but had no way to buy it again: it isn't on Ocado, so it can't become a Favourite.
- Agent-Tesco: *"Fixing the data unlocks me only where the product actually exists."*

Distribution comes before data. A perfect feed for a product not stocked at the fulfilling store still gets 0%.

### 7. Human fixes and agent fixes don't overlap, and some "honest" fixes backfire.
- Margaret: *"Both fixes are physical and social, not data. None of them would move an AI agent, and the agent fixes would not move Margaret."*
- **Fixes that backfire or carry risk:**
  - **Price per 100g makes E look worse to agents:** about £4.00 per 100g against about £2.75 for F.
  - **"Gut-friendly" is not allowed:** it is an unauthorised health claim under retained Reg 1924/2006. "High fibre" for A only passes on the per-100kcal route, and that needs checking.
  - **E is unsuitable for lunchboxes whatever its data says:** "oat & NUT" is ruled out by nut-free schools.
- Sam's real unmet need is a sweetener-free, under-150kcal, high-fibre single serve. No product on this shelf fills it.

---

## 3. The smallest honest flips

Ranked by how many personas each one moves. Strength is a calibrated prior.

| Rank | Flip | Who it moves | Count | Strength and caveats |
|---|---|---|---|---|
| 1 | **Move E out of the side shelf to the meal-deal snack bay, the till, or next to the protein bars** (or give it 2+ facings) | Margaret (her impulse buy went to Tunnock's at the till), Sam (fibre slot), Jordan, Dev, Priya. **Notice only.** | 5 humans, 0 agents | Raises the chance of being noticed from about 0.09 to about 0.6–0.7 (7.5×). Raises purchase much less, because the "unknown maker" and one-strike fears remain. |
| 2 | **Fill A's true feed fields: "6g fibre / high fibre" (if legal), price per litre, "no sweeteners", accurate stock locations** | Agent-GPT (about 14% → 31%), Jordan's delegated basket, Priya's assistant, Aisha (keeps it on probation instead of cutting), Marcus, Tom (data hygiene) | 6 | Costs nothing. Live in 1 to 3 weeks via Brandbank/GS1, not "three minutes". **Doesn't move Agent-Tesco** unless A is also stocked. |
| 3 | **Make A meal-deal eligible at Express, and physically put it in the meal-deal chiller** | Priya (her exact near-choice), Jordan in store, Dev ("highest-value drink wins the slot"), Tom (removes his main objection) | 4 | Dev: 20–35% try it in week 1, settling to 10–20% repeat. Jordan in store: probably low. A retailer decision. No effect on agents. |
| 4 | **E: give up the Sponsored slot for a non-purchasable editorial or "verified attribute" badge, and add structured fibre and ingredient claims** | Agent-GPT (about 9% → 18%), Aisha, Rachel (reshapes the package), Ellie, Ege (as a de-confounded test) | 5 | The badge is the big effect. Removing Sponsored alone is about −20% relative in odds. Online humans may lose exposure. |
| 5 | **E: grow honest reviews from 12 to 40–50+** (sampling, asking DTC subscribers) | Agent-GPT, Agent-Tesco (shrunk rating rises from about 4.1 to about 4.6), Ellie, Aisha, Priya (social proof as tiebreak) | 5 | Realistic pace: about 30 reviews in 6 weeks, about 40 by the next range review. A slow fix. |
| 6 | **Stock A in dotcom fulfilling stores and on Ocado** (gives a liked trial somewhere to repeat) | Agent-Tesco (removes the hard gate), Priya (a route into Favourites), Jordan's delegated basket | 3 | Prerequisite for flip 2 to work on the retailer's assistant. |
| 7 | **E: low-risk trial format** (£0.99 or 30g single serve, about 120 kcal, "no sweeteners" plus weight printed big on the front) | Margaret, Sam, Priya (lunchbox trial pack at about £1.10 a bar) | 3 | A product change. Sam is still a fibre-slot buyer, not a protein-slot buyer. |
| 8 | **E: complete RangeMe form plus per-store sales benchmarked against category** | Tom | 1 | Without it, nothing else reaches the buyer. |

**Single best flip per arm:**
- **Humans in store:** meal-deal eligibility for A.
- **Agents:** A's fibre field plus stocking it where online orders are filled.
- **The buyer gate:** a one-page sheet with per-store sales benchmarked to the category, with confidence intervals, split by store, dotcom and agent channels.

**Not allowed** (the optimiser must refuse these): hiding the Sponsored label, gut-health claims, fake or incentivised reviews, prompt-injection copy.

---

## 4. Spec for the 3D simulation

### 4a. Agent types

| Type | Instances | How much it counts |
|---|---|---|
| **Human shoppers** | Priya (parent, online plus Express top-up); Jordan-instore; Margaret (in-store loyalist); Sam-high (GLP-1 user who reads labels) **plus a low-vigilance GLP-1 sibling** who does buy protein-branded products; Dev (frugal meal-dealer); **a default office meal-dealer** (calibrated from the Ege and Rachel numbers) | Weight by segment. Jordan is an edge case at **3–5%**. Sam-high is the top 25–35% of GLP-1 shoppers, who are 6.3% of households. |
| **Third-party LLM agents** | GPT, Claude, Gemini (plus an open model), with **no history** and with **memory switched on** | Report each model separately. Keep model versions tagged. |
| **Retailer-owned agent** | Agent-Tesco: Clubcard history seeds the basket; Sponsored effect δ ≥ 0 in one variant; stock and range act as a hard pre-filter | |
| **Two-stage delegated shopper** | Jordan-delegated: ChatGPT writes a generic list, then the Tesco app's search, Favourites and Sponsored tiles choose the actual product | Separates the agent's bias from the app's bias |
| **Decision gates** (not walkers) | Tom (triage: p(evaluated) = 1 for incumbents, low for challengers); Aisha (feed standard, conditional listing) | Their output is "listed or not", which drives distribution in the repeat stage |

### 4b. Missions
- **In store:** Express 12:40 meal deal; 4pm slump with no meal deal; GLP-1 protein top-up; Express top-up (milk, bread, a few cans).
- **Online:** weekly rebuild from Favourites; "lunchbox × 10".
- **Delegated prompts:**
  - "healthy-ish fizzy drink and snack for work under £4"
  - "low-sugar fizzy drink under £2 with my lunch"
  - "healthy lunchbox snack under £2" (D is excluded by the price cap)
  - "post-gym snack"
  - "cheapest decent fizzy drink"
  - "high-protein snack, no sweeteners, small portion"
- **Report every share within a mission. Never report a share across missions.**

### 4c. Per-persona parameters (skeptic-calibrated)

| Persona | Notice: eye level | Notice: bottom or side | Habit lock-in | Price sensitivity | Trust in new brands | Reacts against gimmicks | Reads structured data | Seconds at shelf | Meal-deal pull |
|---|---|---|---|---|---|---|---|---|---|
| Priya | 0.70 | 0.12 | 0.85 | 0.65 | 0.30 | 0.45 | 0.20 | 5 | 0.80 |
| Jordan | 0.80 | 0.07 | 0.80 | 0.45 | 0.20 | 0.25 | 0.08 | 4 | 0.88 |
| Margaret | 0.75 | 0.10 | 0.90 | 0.55 | 0.10 | 0.80 | 0.02 | 6 | 0.05 |
| Sam | 0.55 | 0.10 | 0.80 | 0.30 | 0.25 | 0.70 | 0.45 | 12 | 0.75 |
| Dev | 0.70 | 0.08 | 0.80 | 0.88 | 0.15 | 0.45 | 0.15 | 6 | 0.85 |
| **Human mean** | **0.70** | **0.094** | **0.83** | **0.57** | **0.20** | **0.53** | **0.18** | **6.6** | **0.67** |
| Office default (Rachel, Ege) | 0.72–0.85 | 0.12 | 0.65–0.72 | 0.30 | 0.35–0.45 | 0.50–0.60 | 0.25–0.30 | 5–6 | 0.70–0.75 |
| Agent-GPT | 0.97 | 0.90 | 0.08 (cold) / 0.35 (memory) | 0.35 | 0.40 | 0.15 | 0.95 | n/a | 0.12 |
| Agent-Tesco | 0.85 | 0.80 | 0.85 | 0.60 | 0.08 | 0.05 | 0.95 | n/a | 0.02 |
| Founders (Ellie, Marcus) on a store check | 0.85–0.90 | 0.60–0.75 | 0.2–0.3 | 0.25–0.45 | 0.75–0.80 | 0.55–0.65 | 0.35–0.55 | 20–25 | 0.30–0.35 |
| Buyers (Tom, Aisha) at triage | 0.90–0.95 | 0.30–0.45 | 0.75–0.85 | 0.60–0.70 | 0.15–0.35 | 0.60–0.80 | 0.75–0.85 | 25–60 | 0.03–0.75 |

Founders and buyers are observers and gates, not representative walkers.

Two points the table carries:
- Humans are about **7.5× more likely to notice** an eye-level product than a side or bottom one. For agents the ratio is about 1.1×, consistent with research saying agents' position effects are 4 to 10 times weaker.
- **Reading structured data is the widest gap:** 0.18 for humans against 0.95 for agents.

### 4d. Choice model

**P(buy j) = P(notice j) × P(consider j | noticed) × P(choose j | consideration set C)**

**1. Notice**
- Humans: `logit P_notice = α_zone + β_f·ln(facings) + β_sal·pack_contrast + β_path·on_mission_route`, anchored to the per-persona notice parameters. Out-of-stock means 0.
- Agents: P ≈ 0.85–0.97 **multiplied by** an indicator that the product is stocked at the fulfilling store **and** has the fields the mission needs. A blank field reads as missing evidence.

**2. Consider (hard gates)**
- Mission fit:
  - Meal-deal visit: the product must be eligible, or it competes at full price.
  - The price cap.
  - Diet gates: no sweeteners (Sam), nut-free (lunchbox), no carbonation (Sam).
- Habit short-circuit: with probability `habit_lockin`, take the default and skip choice.
- Gimmick screen: with probability `gimmick_reactance` × gimmick cue, reject on sight. About 60% of Sam's rejections happen before he picks the item up.

**3. Choose (multinomial logit over C)**

```
U_ij = β_p·price_eff_ij + β_val·standalone_price_j·[meal-deal value-maximiser]
     + β_h·history_ij + β_claim·claim_match_jm + β_r·rating_shrunk_j + β_n·ln(1+reviews_j)
     + β_badge·badge_j + δ_k·sponsored_j + β_g·gimmick_j·reactance_i
     + β_taste·BT_j  [humans only, from Shelf votes] + β_sem·semantic_prior_jm [LLMs only] + ε
```

- `price_eff` = 0 inside the meal deal.
- `rating_shrunk = (n·r + k·3.9)/(n+k)`, with k between 30 and 50.
- Sponsored effect δ:
  - about −0.2 log-odds for third-party LLMs;
  - ≥ 0 for the retailer-owned agent;
  - an exposure *boost* for humans online.

**4. Repeat stage (weekly Markov process, 4–26 weeks)**
- Favourites carry-over: about 0.8.
- Substitution: 0.8 accept × 0.9 keep. Substitute choice: same-tier own-label 0.55, D 0.25, E ≤ 0.05.
- One-strike veto on a bad first experience.
- Shrinkflation discovery: 5–10% per month.
- Model-update reshuffle as a random event.
- Rate-of-sale delisting at 26–36 weeks, which removes the product from **both** arms.

**Outputs**
- Divergence per product per mission: **D_j = ln(s^A / s^H)**, with bootstrap 95% confidence intervals and N ≥ 50 runs per cell. Flag a product only when the human and agent intervals separate.
- Pool the Sponsored effect across products, missions and models. At N = 50 a single product can't detect a 1–2 point difference.
- Concentration ratio: agent HHI over human HHI.
- Measure model-to-model stability with per-product share shifts. Kendall's tau is unreliable on only 6 products.

### 4e. What the optimiser rearranges
- **Levers:**
  - Shelf zone and facings (total facings fixed)
  - End-of-aisle and till slots
  - Meal-deal eligibility, plus moving the product into the meal-deal chiller
  - True feed fields (fibre g, £/L, no-sweetener flag, single-serve)
  - Sponsored on or off
  - Non-purchasable editorial badge
  - Review-count path (a realistic ramp, with a lag)
  - Trial pack size and price
  - Stocking breadth (stores, dotcom)
- **Objective:** maximise the challengers' **blended** share, weighted by channel mix (for example store 75 / online 20 / agent 5, with a 2027 scenario at about 15% agent), subject to category value staying flat or rising.
- **Output:** the **lowest-cost set of honest changes that pushes a challenger past a threshold** (for example parity with its human taste share, or clearing the delisting line), each with predicted vs observed change after a live re-run.

### 4f. What the UI shows
1. **Split screen.** Left: the 3D Express at 12:40, with avatars showing gaze cones; noticed products glow. Right: the same shelf as the agent "reads" it. Products with thin data appear as ghosts, badges glow, Sponsored tags dim.
2. **Walk-past bubbles** on every rejection, showing a **real quote from the persona file plus a mechanism tag**. For example, A shows "no purple sticker, £1.85" [meal-deal gate]; D shows "I'm not putting sweeteners in a seven-year-old" [gimmick reactance].
3. **Leaderboard:** human share and agent share per product with confidence intervals, plus the divergence score D_j. A and E are flagged red; D and F are flagged as "agent picks what humans reject".
4. **Toggle panel:** meal-deal eligibility, fibre field, Sponsored ↔ badge, facings, reviews, then **Re-run (N ≥ 50)**, which shows predicted vs observed.
5. **Time scrubber across 4 to 26 weeks:** Favourites lock-in, substitutions, F's shrink being noticed, and the delisting cliff.
6. **Export:** clicking any frame gives an auditable decision-log row (product, persona or model, the attribute that drove the choice, the quote, the run ID). Ege adopts this only if every frame exports.

---

## 5. Commercial

### 5a. Who pays

*Every willingness-to-pay figure is a synthetic persona estimate.*

| Payer | Pain quote | What they'd pay for | WTP (persona estimate; skeptic correction) |
|---|---|---|---|
| **Challenger founders** (Ellie, Marcus) | Ellie: *"I won the blind tasting and lost the robot. The buyer could see the scoreboard and I couldn't."* Marcus: *"…a robot that's never tasted anything just handed my customers a 55p own-label cola, because I forgot to type the word 'fibre'."* | A per-product "Same Shelf" audit: agent share with confidence intervals, divergence from human taste, reasons by field, honest fixes with thresholds, a before/after re-run, and a one-page sheet a buyer will accept | **£999** one-off (RGC Retail Report add-on), up to £1–3k; re-runs at £200–400 a month. Skeptic: they'd buy a £500–999 pilot of *one* fix, and only if the buyer confirms they'll read it. |
| **Retailer buyers** (Tom) | *"I can tell you to the penny what Coke Zero did last Tuesday in Hemel. I can't tell you whether the robot that fills half my dotcom baskets will ever pick the challenger I list. So I don't list it."* | Probability that a product holds its rate of sale past week 12 across store, dotcom and assistant, with confidence intervals and a source trail | No budget of his own. He makes the evidence a **condition of pitching** (suppliers pay £999–2.5k per product), or Tesco/dunnhumby license a dashboard (£30–80k a year, no source for this figure). |
| **Digital range** (Aisha) | *"I'm selling the top slot by position to a shopper that doesn't look at position, and I can't even see that shopper in my own logs. I log it as 'bot/other'."* | Continuous agent-share monitor per category: per-model Sponsored and position effects, model-update alerts, a supplier data standard | **£30–45k a year** pilot across 10 categories. She pushes the £999 per-product audit onto suppliers as a compliance requirement. |
| **Retail media** (Rachel) | *"I sell the top of the page to a shopper who's stopped reading the page, and my own company built the shopper."* | Agent media measurement licence; a "first agent basket" metric; a challenger-prospect view | **£40–80k a year** network licence plus £3–5k per brand per quarter bundled into Joint Business Plans. Skeptic: she'd renew Sponsored *and* upsell, not shrink it. |
| **RGC** (Ege) | *"…the only thing in our stack that can say no is a human we haven't measured."* | An evaluation harness (human vs persona vs agent on the same shelf), a persona trust score with statistical correction, a drift monitor; a candidate **8th dimension** | About 0.5 FTE plus **£1.5–3k a month** in API costs. External ceiling £15–30k a year. **£0 for 3D visuals on their own.** |
| Shoppers (Priya, Jordan, Margaret, Sam, Dev) | Priya: *"…it put sweeteners in my seven-year-old's lunchbox."* | "House rules" memory for assistants, shrinkflation alerts, trial packs | Nothing. They are the source of truth, not payers. |

### 5b. The one-sentence pitch
**"Same Shelf, Two Shoppers shows a challenger brand how real shoppers and AI shopping agents choose differently on the same shelf, why each one walks past it, and which smallest honest change wins both. It plugs into RGC as the eighth dimension, the one that models the shopper who isn't human."**

### 5c. Two-minute demo
- **0:00–0:15 Hook.** "Gutsy Pop won today's blind tasting. Let's watch it get bought." The 3D Express appears at 12:40.
- **0:15–0:45 The human arm.** Avatars walk the meal-deal route; Coke Zero glows at eye level. Bubbles pop over Gutsy Pop: *"no purple sticker, £1.85"*. Over Nutty Crunch: *"never saw it"* (side shelf). One bubble shows Margaret picking it up and putting it back.
- **0:45–1:10 The agent arm.** Same shelf, now read by the agents: Gutsy Pop appears as a ghost (blank fibre field, 31 reviews); Coke Zero glows. Leaderboard: humans give Gutsy Pop about 41%, agents about 9–14% → **D = −1.1, intervals separated**. Then the mirror image: the agent's top snack is the protein bar Sam rejected (*"sweetener? no"*).
- **1:10–1:35 Live fix.** Toggle 1: fill the *true* "6g fibre" field and price per litre → re-run 50 times per model, predicted vs observed bar. Toggle 2: meal-deal eligibility in store → the human bubbles flip. *"Two fixes, one per shopper. Neither moves the other."*
- **1:35–1:50 Time scrubber.** Week 12: Favourites lock-in, F's shrink, the delisting cliff. *"Only the first basket can be won."*
- **1:50–2:00 Close.** Ellie's quote, the £999 add-on, and "RGC's 8th dimension."

---

## 6. Honest limitations of the synthetic personas

1. **Realism is middling.** Skeptics scored the journeys 5–6.5 out of 10. The repeated faults:
   - Personas notice too much: 80-second inspections where the literature says 3–6 seconds.
   - They are too articulate ("transaction utility", "humectant").
   - They act on what they *say* they do, not what they actually do. Margaret reads unit prices; her own file says she doesn't.
2. **Several journeys contain made-up precision.** Agent shares, confidence intervals, "11% agent sessions" and the stock maths are invented. Treat every number as a prior. **Nothing should go on stage without a real run behind it.**
3. **Channel errors.** Tesco own-label can't be in an Ocado basket. ChatGPT has no native UK Tesco checkout. Gutsy Pop is unlikely to be stocked in any particular Express when it's in 40 stores.
4. **Projected bias.** Agent findings, mostly from US and Amazon-style studies, were projected onto humans (Priya's aversion to Sponsored). The retailer-owned assistant's response to Sponsored is unknown and may be positive.
5. **The evidence base is skewed toward the vocal.** Reddit and Mumsnet over-represent label-readers and people who complain about gimmicks, so Sam needs a low-vigilance sibling. There is no corpus quote from a confirmed student or 24-year-old Londoner.
6. **LLM personas don't reject.** By construction they please, compress variance, and miss segments by 10–30 percentage points. Walk-pasts have to come from corpus-grounded rules, not from the persona model's own judgement.
7. **The human ground truth is thin.** About 50 tasters, one room, free samples, forced choice. That gives no walk-past rate, no willingness to pay and no repeat purchase.
8. **Unchecked legal and practical factors:** claim legality, nut-free schools, the 26–36 week delisting cycle.

### How real Shelf votes at the event can calibrate the personas
- **Add a "neither / wouldn't buy at this price" option and the shelf price to each paired vote.** That measures human walk-past rates and willingness to pay directly, and fixes the forced-choice gap.
- **Fit a Bradley-Terry model** to the pairwise votes to estimate the taste term β_taste per product. Hold out 20% of votes and compare predicted with observed share.
- **Use three quick screener questions** (meal-dealer? parent? on GLP-1 or protein-focused?) to map voters onto persona segments. Then re-weight the sim, and apply a doubly robust (AIPW) correction to the LLM-persona predictions. Report only the topline at n ≈ 50; per-segment results need 50–300 people.
- **Run a 2-second shelf-photo test:** "name what you saw." This calibrates the notice parameters for eye level vs side shelf and for kraft vs pastel packs.
- **Pre-register agent predictions** (for example "A rises from X% to Y% after the fibre fix") **before** running the live agent arm on the same products. Report hits and misses.
- **Keep the voters' verbatim reasons** as new walk-past quotes, replacing synthetic monologue with real quotes.
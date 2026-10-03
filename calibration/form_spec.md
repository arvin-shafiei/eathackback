# The Shelf: 60-second calibration form

Paste this into **Tally** or **Google Forms**. Put the `[id]` at the start of every question title exactly as written, because `ingest.py` finds each column by the id in brackets. That way you can change the wording without breaking the parser.

- **Who answers:** the builders at EAT_HACK (about 50) after tasting at The Shelf (25 challenger brands).
- **Time:** about 35 s for the core and about 40 s for the optional TIPI. Put the TIPI on a second page headed "bonus, 40 seconds".
- **Brand list:** paste the 25 Shelf brand names, one per line, into `calibration/brands.txt`. Use **the same spelling** in every brand dropdown and checkbox.
- **Privacy:** no name, email or phone number. The nickname is optional and free text. Voters are told the answers calibrate a simulation and are shown on screen in aggregate only.

---

## Form header (copy)

> **which would you actually buy?** 🛒
> 60 seconds. You just tasted The Shelf. We're checking our synthetic shoppers against real humans: you. No names, aggregate results only, shown live at the demo.

## Page 1: core (about 35 s)

| # | Title (paste exactly) | Type | Options | Required | Why it's here |
|---|---|---|---|---|---|
| 1 | `[tasted] Which did you taste?` | Checkboxes | the 25 brands | yes | Sets the comparison set. Ranks are only compared against brands the voter actually tried (rank-breaking, see README) |
| 2 | `[top1] Your #1: the one you'd actually buy` | Dropdown | the 25 brands | yes | Top-1 share plus Bradley–Terry |
| 3 | `[top2] Your #2` | Dropdown | 25 brands + `none` | no | Implied pairs |
| 4 | `[top3] Your #3` | Dropdown | 25 brands + `none` | no | Implied pairs |
| 5 | `[buy_top1] Would you buy your #1 at its shelf price?` | Multiple choice | `Yes, at shelf price` · `Maybe` · `No, not at that price` | yes | **Positivity check.** Humans hedge even on a favourite; LLM personas rarely do (arXiv 2609.13148) |
| 6 | `[why_top1] Why #1? (pick up to 2)` | Checkboxes, max 2 | why-tags below | yes | Same vocabulary as the sim's `mechanism` |
| 7 | `[walkpast] One you'd walk past in a shop` | Dropdown | 25 brands + `none` | no | Human walk-past rate. Forced choice alone hides it (research/05 §6) |
| 8 | `[why_walkpast] Why walk past it?` | Multiple choice | why-tags below | no | Rejection mechanism |
| 9 | `[mission] You'd most likely buy this on a…` | Multiple choice | `Weekly shop` · `Meal deal` · `Top-up` · `Treat` · `Gym` | yes | CONTRACT `mission` |
| 10 | `[segments] Tick any that fit you` | Checkboxes | segment list below | no | Maps voters onto sim archetypes for per-segment error |

### Why-tags (questions 6 and 8): use these labels exactly

Each label maps 1:1 to a sim `mechanism` id. The map is `WHY_LABELS` in `ingest.py`, and the sim aliases are `MECH_ALIAS` in `compare.py`. CONTRACT.md lists `loss_aversion | habit | trust | price_anchor | gimmick_reactance | …`, and the other ids come from the 8 human truths in `research/03-reddit-human-truths.md`.

| Label shown | id | Source of the mechanism |
|---|---|---|
| Tasted best | `taste` | research/03 truth 6 (sensory detectability, signature taste) |
| I trust it | `trust` | research/03 truth 5 (borrowed trust) |
| Healthier / cleaner ingredients | `health_label` | research/03 truth 7; README OCEAN C → label use |
| Good value vs alternatives | `price_anchor` | research/03 truth 4 (reference-price anchoring) |
| Like what I already buy | `habit` | research/03 truths 2 and 6 |
| New / different, want to try | `novelty` | README: Openness → food neophilia |
| Fits how I'd use it | `mission_fit` | README: mission |
| Heard of it / others rate it | `social_proof` | research/03 truth 5 |
| Pack caught my eye | `salience` | research/04 notice model |
| Claims feel gimmicky | `gimmick_reactance` | research/03 truth 8 (reactance) |
| Risky / might waste money | `loss_aversion` | research/03 truths 1 and 7 |
| Too expensive for what it is | `price_too_high` | research/03 truth 7 ("too expensive" as cover) |

### Segments (question 10): use these labels exactly, each mapped to a CONTRACT archetype

| Label shown | archetype |
|---|---|
| I have kids at home | `upf_avoider_parent` |
| I avoid ultra-processed food / additives | `eco_low_chemical` |
| I'm on GLP-1 / smaller appetite | `glp1_small_appetite` |
| Budget comes first | `frugal_unit_price` |
| I track protein / gym | `protein_gym` |
| Protein claims annoy me | `protein_sceptic_gimmick_reactant` |
| I buy the same things every week | `habit_loyalist_shrinkflation_angry` |
| I buy a meal deal most workdays | `meal_deal_office` |
| Vegan / vegetarian | `vegan_ethical` |
| Allergy / coeliac in household | `allergen_coeliac` |
| I ask ChatGPT/AI what to buy | `ai_delegator` |
| I try new things I see on TikTok | `novelty_seeker_tiktok` |

## Page 2: bonus, the 10-item Big Five (TIPI), about 40 s, all optional

Source: Gosling, S. D., Rentfrow, P. J., & Swann, W. B. Jr. (2003). *A very brief measure of the Big-Five personality domains.* Journal of Research in Personality, 37, 504–528. doi:10.1016/S0092-6566(03)00046-1. The item wording below is the published instrument; the authors make it available for non-commercial research use. Why we ask: so the OCEAN the sim **assigned** to its agents can be compared with the OCEAN of **real** people in the room (`compare.py → ocean`).

Instruction (paste):
> Here are a number of personality traits that may or may not apply to you. Rate the extent to which the pair of traits applies to you, even if one characteristic applies more strongly than the other. **I see myself as:**

Scale for every item (linear scale 1–7): 1 Disagree strongly · 2 Disagree moderately · 3 Disagree a little · 4 Neither agree nor disagree · 5 Agree a little · 6 Agree moderately · 7 Agree strongly

| Title (paste exactly) |
|---|
| `[tipi_1] Extraverted, enthusiastic` |
| `[tipi_2] Critical, quarrelsome` |
| `[tipi_3] Dependable, self-disciplined` |
| `[tipi_4] Anxious, easily upset` |
| `[tipi_5] Open to new experiences, complex` |
| `[tipi_6] Reserved, quiet` |
| `[tipi_7] Sympathetic, warm` |
| `[tipi_8] Disorganized, careless` |
| `[tipi_9] Calm, emotionally stable` |
| `[tipi_10] Conventional, uncreative` |

Scoring, done by `ingest.py` and not shown to voters. "R" means reverse-scored (8 − x).

| Trait | Items |
|---|---|
| Extraversion | 1, 6R |
| Agreeableness | 2R, 7 |
| Conscientiousness | 3, 8R |
| Emotional Stability | 4R, 9 |
| Openness | 5, 10R |

Each trait is the mean of its two items, with N = 8 − Emotional Stability. Every trait is then rescaled to 0–1 with (x − 1)/6, which matches CONTRACT `ocean`.

## Optional last fields

| Title | Type |
|---|---|
| `[voter] Nickname (optional, no real names)` | Short text |
| `[note] Anything else? One line` | Short text |

## Export

- **Tally:** Responses → Export CSV.
- **Google Forms:** Responses → Link to Sheets → File → Download → CSV.

Checkbox answers export as comma-separated values, which `ingest.py` splits on ", ". So **no brand name may contain ", "**. If one does, write it without the comma in `brands.txt` and in the form.

Run:

```bash
python calibration/ingest.py responses.csv --brands calibration/brands.txt
python calibration/compare.py --run data/sim/runs/<run_id>.json
```

## QR card for the table (copy)

> **taste → tap → 60s.** Help us check whether AI shoppers agree with you. 🛒🤖

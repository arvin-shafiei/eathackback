# Build contract (shared by all agents): DO NOT break these shapes

Golden rule: **every number traces to a source**. Any coefficient, weight or score has a `source` field. That source is a paper or URL, a Reddit verbatim (thread URL), an OFF field (barcode + field), or `"assumption: <why>"`.

## Store: `data/store/store.config.json`
4 aisles. Each aisle has a centre divider, giving 2 shelving units per aisle (L and R): **8 units × 3 rows = 24 slots**. The config drives everything, so it can grow.
```json
{ "aisles": 4, "rows_per_unit": 3, "row_names": {"1":"top","2":"eye","3":"bottom"},
  "units": [ {"id":"U1","aisle":1,"side":"L","category":"soft_drinks"}, ... 8 units ],
  "entrance": {"x":0,"z":-2}, "checkout": {"x":0,"z":22} }
```
Slot id = `${unit}-r${row}`, e.g. `U3-r2`. Each slot holds a **set** of 1–4 products (`planogram.json`).

## Planogram: `data/store/planogram.json`
```json
{ "U1-r1": {"category":"soft_drinks","products":["5000112637922", "..."], "facings":{"5000112637922":2}} }
```
Categories (one per unit): `soft_drinks, crisps_savoury, snack_bars, breakfast_cereal, yoghurt, biscuits_chocolate, plant_milk_dairy_alt, ready_meals_soup`.

## Products: `data/products/catalog.json` (curated ~60–90 SKUs; source pool = `data/products/uk_products.parquet` from Open Food Facts)
```json
[{ "code":"barcode","name":"","brand":"","category":"soft_drinks","role":"challenger|incumbent|own_label",
   "price_gbp":1.85, "price_source":"url or assumption:...",
   "pack_copy":"short front-of-pack/description text (true, from OFF or brand site)",
   "nova":4,"nutriscore":"c","ecoscore":"b","additives_n":3,"additives":["en:e330"],"labels":["en:vegan"],
   "allergens":[],"ingredients_n":12,"ingredients_text":"","sugars_100g":0,"fiber_100g":0,"proteins_100g":0,"salt_100g":0,
   "sweeteners":0,"palm_oil_n":0,"recycling":[],"image":"url","off_url":"https://world.openfoodfacts.org/product/<code>",
   "lens_grades": {"eco_low_chemical": {"score":0.0-1.0, "why":["additives_n=3 (OFF)","ecoscore b (OFF)"]}, ...} }]
```

## Personas: `data/personas/personas.json`
```json
[{ "id":"p_eco_parent","name":"Priya","archetype":"eco_low_chemical","mission":"weekly_shop|meal_deal|top_up|treat|gym",
   "budget_gbp":0,"channel":"instore|online|agent",
   "ocean": {"O":0-1,"C":0-1,"E":0-1,"A":0-1,"N":0-1},
   "ocean_effects": [{"trait":"C","effect":"reads labels → +attention to nutrition fields","coef":0.3,"source":"citation"}],
   "lens": [{"attribute":"additives_n","off_field":"additives_n","direction":"lower_better","weight":0.3,"why":"...","source":"reddit url / paper"}],
   "rejection_triggers":[{"trigger":"","source":""}], "trust_signals":[], "habits":[],
   "dossier":"rich first-person backstory grounded in verbatims", "verbatims":[{"quote":"","url":""}] }]
```
Lens archetypes (one persona each, minimum): `eco_low_chemical, upf_avoider_parent, glp1_small_appetite, frugal_unit_price, protein_gym, protein_sceptic_gimmick_reactant, habit_loyalist_shrinkflation_angry, meal_deal_office, vegan_ethical, allergen_coeliac, ai_delegator (uses ChatGPT), novelty_seeker_tiktok`.

## Notice model: `sim/notice.py` (no LLM; literature-calibrated)
`p_notice = σ(α0 + α_row[row] + α_f·ln(facings) + α_c·centrality + α_trait·…)`. Each α has a `source` (e.g. eye level vs floor +39% sales, facings elasticity 0.17: see `research/04-3d-sim-evidence-and-tech.md`). Conscientiousness raises attention to labels, Openness raises noticing of unfamiliar brands, and so on, each sourced.

## Sim run log: `data/sim/runs/<run_id>.json` (the frontend replays this)
```json
{ "run_id":"","created":"","planogram":"planogram.json","models":["..."],
  "agents":[{ "agent_id":"a001","persona_id":"p_eco_parent","model":"google/gemini-2.5-flash","ocean":{},
     "path":["U1-r2","U2-r2"],
     "events":[{ "step":0,"slot":"U1-r2","product":"code","p_notice":0.42,"notice_factors":{"row":"eye","facings":2,"trait_boost":0.05},
        "noticed":true,"decision":"pick|reject|walk_past|not_noticed","reason":"first-person sentence",
        "attributes_cited":["additives_n","ecoscore"],"feeling":"short","sentiment":-1.0,
        "mechanism":"loss_aversion|habit|trust|price_anchor|gimmick_reactance|...","source_refs":["..."] }]}],
  "stats": {"per_product": {"<code>": {"shown":0,"noticed":0,"considered":0,"picked":0,"rejected":0,"walk_past":0,
             "pick_rate":0,"ci95":[0,0],"by_archetype":{},"by_ocean_segment":{},"top_reject_reasons":[],"mean_sentiment":0}}}}
```

Brand uploads (additive, optional): a run simulated with brand-supplied products carries `catalog_inline: [product, ...]`
(same shape as a catalog product, plus `brand_supplied: true`, `source`, `imported_from`, `field_sources`); an AI-arm
run also carries `excluded: [codes]`.

## Agent shopper (AI agent arm): `sim/agent_shopper.py`
Same catalogue rendered as a feed (JSON/HTML list), randomised order, run against N OpenRouter models. Logs the same event shape with `persona_id:"ai_agent"`.

## Optimiser: `sim/optimise.py`
Honest edits only: slot/row move, facings, true claim surfaced in pack_copy, price. Re-run and report Δpick with CI.

## Env
`OPENROUTER_API_KEY` in `.env` (gitignored). Budget cap is **$50 total**. Default to cheap models (e.g. `google/gemini-2.5-flash`, `openai/gpt-4.1-mini`, `anthropic/claude-haiku-4.5`, `meta-llama/llama-3.3-70b-instruct`), `max_tokens` ≤ 300, and cache responses to `data/sim/cache/`.

## Design
`design/design-language.md`: lowercase copy, brand gradient #FF4079→#FE831B, ink #141014 outlines with solid "ledge" shadows, Baloo 2 display + Inter, sticker badges. Use the `impeccable` skill for UI.

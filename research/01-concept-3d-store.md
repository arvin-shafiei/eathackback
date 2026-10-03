# Concept (user's vision, 3 Oct): 3D store sim with AI shoppers + shelf re-arrangement

Working name ideas: **Walk-Past** / **ShelfLife** / **The Unbought**

## Core loop
1. Drop products (real UK SKUs from Open Food Facts) onto shelves of a 3D store (format: Express / superstore / meal-deal chiller).
2. Spawn grounded shopper agents — each = mission (meal deal 90s, big shop, top-up, healthy-intent) + behavioural mechanisms coded from 10.6k Reddit comments (habit lock-in, shrinkflation betrayal, protein reactance, own-label trust...).
3. Agents walk, NOTICE (salience: position, facings, end-cap) -> CONSIDER -> CHOOSE / REJECT. Every walk-past logged with a reason + the real Reddit verbatim behind it.
4. An AI shopping agent (ChatGPT/Rufus-like) shops the same range — ignores eye level, reads structured data. Show divergence human vs agent.
5. Optimiser rearranges shelves -> re-run -> show lift per mission / per format. "Same product, different environment" answer for Track 2.

## Why it wins (vs brief)
- Track 2: "test what happens when a product is launched, removed or moved into a different retail environment"; "store format, location... should change what gets stocked".
- RGC blog: EPOS "says nothing about the shoppers who walked past without buying" -> we literally render the walk-pasts.
- Explainable maths: consideration (attention) x multinomial logit choice, coefficients from literature (Chandon 2009 etc.).
- Grounding (Ege's blog: "grounding matters more than the simulation") -> Reddit-coded mechanisms + literature params.

## Risks
- Eye candy without grounding = dismissed. 3D must serve the insight.
- Planogram tools exist (Blue Yonder, RELEX) — our edge is behaviour + missions + AI-agent shopper.

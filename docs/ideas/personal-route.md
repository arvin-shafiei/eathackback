# idea: personal store route ("your shop today")

*Captured 3 Oct 2026 from the team discussion. Status: pressure-testing.*

## the problem it solves
A smart store keeps re-optimising (layouts move, new products land). But Reddit truth #2 (~290 comments) says the weekly shop is a **memorised route**: "It makes me spend less as I can't be bothered to look for it" (r/britishproblems, 507 upvotes). Every optimisation risks breaking habits, and new products go unseen (EPOS "says nothing about the shoppers who walked past").

## the idea
Every shopper, human or AI agent, has a **memory**: a map of what they found and bought, kept as a habit log.
1. **visit 1 (cold start):** we know nothing. They shop and we log the basket.
2. **identify:** from the first basket(s), infer which persona they are closest to. Jev Choice over archetypes, with the full probability distribution kept; weak evidence is shown as uncertain, not guessed.
3. **predict:** predict the next basket. It combines habit (what they buy again), mission, and **new products** that match their persona lens.
4. **route card:** each time they enter, they get a one-time personalised route ("your shop today"): where their usual items have moved to, plus 1–3 *new things you might like* on the way, as a short **task** ("grab your oat milk, now in aisle 3; try the new high-fibre bar on the way").
5. **learn:** the new basket updates the habit log and the persona estimate, and the loop repeats.

## who it serves (the three surfaces)
- **shopper:** less hunting after a re-layout, and relevant new things.
- **retailer:** can re-optimise without destroying habits, and gets new-product discovery.
- **brand:** a fair first look for new challengers, aimed at the shoppers most likely to repeat.

## what we measure (A/B in the sim, Jev engine, CIs)
Same shoppers over N visits, **with vs without route cards**, after a layout change and new-product introduction:
- basket completion (found what they came for), and walking distance / time;
- new-product **look → pick up → take** rates;
- repeat rate of new products on the next visit;
- persona-identification accuracy vs ground truth (the sim knows the true persona), by visit number;
- next-basket prediction precision@k / recall@k.

## no black box
Every route item carries its reason: "habit: bought 3/3 visits", "new + matches your lens: high fibre (OFF fiber_100g=8.1)", "Jev P(take)=0.62". Persona identification shows its full distribution.

## pressure test results (3 Oct 2026)

Six hostile reviews ran. All six returned **build-with-changes**. Lead decision: **build-with-changes**, reframed as *re-layout insurance* inside the retailer layout surface (no fourth surface). Full spec: [personal-route-spec.md](personal-route-spec.md).

| lens | verdict | key change |
|---|---|---|
| RGC judge panel | build-with-changes | Not original as a consumer app ("Tesco app with a map"). Pitch it as the retailer question the sim answers: what a re-layout costs habitual shoppers, and how much an opt-in card wins back. Contrast human vs agent memory. |
| Behavioural scientist | build-with-changes | Use the habit-discontinuity framing. Card shows at most 1 new item, already on the route. Model reactance and compliance as labelled parameters. Report unplanned £ (Hui et al. 2013), not shortest path. |
| ML/eval methodologist | build-with-changes | Fix the visit-replay bug (visit salt in every draw key). Persona ID uses a held-out train run, plus mission-only and chance baselines, mixtures, leave-one-out, confusion matrix and calibration. Next-basket prediction must beat most-frequent and repeat-last. Paired bootstrap CIs. One pre-registered primary metric. |
| UK GDPR / ICO | build-with-changes | Shopper-brought identity with an on-device log. GLP-1, coeliac and vegan are declared only, never inferred. Show the lens, not the label. Retention limit plus forget-me. No personalised prices. DPIA. Fix the ecom-rerank GLP-1 inference. |
| Build engineer | build-with-changes | Unit category must come from the planogram (72/96 labels go stale after the re-layout). Withhold 1 challenger per category until visit 3. Persona ID in code (Naive Bayes), not Jev. Size the run to about 864 agent-visits (about $2.60). |
| UK retail director | build-with-changes | Money metric: incremental trial-to-repeat against a holdout (76% NPD year-one failure, Nielsen; keep it separate from the other 76% figures). Payment buys eligibility, not rank. Superstore and pre-trip only. Don't claim baskets grow. |

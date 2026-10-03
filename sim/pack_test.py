"""PACK TEST (brand surface): which TRUE front-of-pack copy makes each shopper stop and pick the product up?

1. Code derives the claims a product legally qualifies for from its own Open Food Facts fields, using the
   Annex of Regulation (EC) No 1924/2006 (retained in UK law) and OFF certification labels. Nothing is invented:
   a claim is offered only if the OFF number clears the legal threshold, and each claim carries the exact
   field, value and threshold it relied on.
2. Code builds 3-5 pack-copy variants: the current pack (control), one variant per eligible claim led
   prominently, and one stacking the two strongest claims.
3. For every lens persona x variant, ONE TypeSafe Jev request (speculative fan-out over the same state):
     pickup   Noul   "Would `shopper` stop and pick up `product` based on this pack?"
     appeal   Score  5 ordered levels (same wording as the shelf sim, sim/jev.py APPEAL_LEVELS)
     gimmick  Noul   reads the pack claims as marketing spin
     believe  Noul   finds the lead claim believable and relevant to their priorities
     put_off_k Noul  the persona's own rejection triggers (sourced to verbatims)
     trust_k  Noul   the persona's own trust signals
   One variant per request so Jev judges each pack on its own (no side-by-side comparison effect).
4. Code computes Delta P(pick-up) per variant per persona vs the control and picks the winner with an
   explicit rule (below). No arithmetic is asked of Jev; numbers are pre-bucketed into words by sim/jev.py.

Docs: https://docs.typesafe.ai/primitives/noul.md  /primitives/score.md  /patterns/fan-out.md
      /patterns/composite-scoring.md  /model-jaggedness/jev-1.13.md

CLI:
  python3 sim/pack_test.py                         # default 3 challengers
  python3 sim/pack_test.py --products 5013665115373,5070000126579
  python3 sim/pack_test.py --list-claims           # print eligible claims for every challenger, no API
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import jev  # noqa: E402  (shared TypeSafe plumbing: ask(), disk cache, cost log, words-not-numbers helpers)

CATALOG = os.path.join(ROOT, "data", "products", "catalog.json")
PLANOGRAM = os.path.join(ROOT, "data", "store", "planogram.json")
PERSONA_DIR = os.path.join(ROOT, "data", "personas", "lens")
OUT_DIR = os.path.join(ROOT, "data", "sim", "brand", "pack_test")

REG = "Regulation (EC) No 1924/2006 Annex (nutrition claims), retained UK law: https://www.legislation.gov.uk/eur/2006/1924/annex"
LIQUID_CATS = jev.LIQUID_CATS
DEFAULT_PRODUCTS = ["5070000126579", "5060494810665", "5060430292760"]  # Bio&Me granola, Dalston's soda, BOL soup: true fibre/protein claims NOT on pack today
PROTEIN_FLOOR_G = 3.0
PERSONA_WEIGHT_NOTE = ("assumption: equal weight per lens archetype; population_weight is only given for 2 of 12 "
                       "personas (data/personas/lens/*.json), so it cannot weight the whole panel")

# Sugars added for sweetness (Reg 1924/2006 Annex 'NO ADDED SUGARS': no mono-/disaccharides or any other food used
# for its sweetening properties). Matched on OFF ingredients_text; if the text is missing the claim is NOT offered.
ADDED_SUGAR_RE = re.compile(
    r"\b(sugar|cane sugar|brown sugar|syrup|honey|dextrose|glucose|fructose|sucrose|maltose|lactose added|molasses|"
    r"treacle|agave|nectar|maltodextrin|invert|caramelised sugar|juices?|concentrate|"
    r"date paste|dates?|coconut blossom)\b", re.I)  # conservative: ANY juice or dates excludes the claim


# ---------------------------------------------------------------- 1. claims (code, never Jev)
def _f(p, k):
    v = p.get(k)
    return float(v) if isinstance(v, (int, float)) else None


def eligible_claims(p: dict) -> list[dict]:
    """Every claim the product qualifies for, each with evidence. Ordered strongest-first within type."""
    code = p["code"]
    off = p.get("off_url") or f"https://world.openfoodfacts.org/product/{code}"
    liquid = p.get("category") in LIQUID_CATS
    kcal = _f(p, "energy_kcal_100g")
    fib, prot, sug, salt = _f(p, "fiber_100g"), _f(p, "proteins_100g"), _f(p, "sugars_100g"), _f(p, "salt_100g")
    out = []

    def add(cid, text, kind, evidence, rule, source=REG):
        out.append({"id": cid, "claim": text, "kind": kind, "evidence": evidence, "rule": rule, "source": source,
                    "off_url": off})

    # fibre: HIGH >= 6 g/100g or >= 3 g/100kcal; SOURCE >= 3 g/100g or >= 1.5 g/100kcal
    if fib is not None:
        per_kcal = (fib / kcal * 100) if kcal else None
        ev = f"OFF fiber_100g={fib:g}" + (f", energy_kcal_100g={kcal:g} -> {per_kcal:.1f} g/100kcal" if per_kcal else "")
        if fib >= 6 or (per_kcal is not None and per_kcal >= 3):
            add("high_fibre", "high fibre", "nutrition", ev, "HIGH FIBRE: >= 6 g/100g or >= 3 g/100kcal")
        elif fib >= 3 or (per_kcal is not None and per_kcal >= 1.5):
            add("source_fibre", "source of fibre", "nutrition", ev, "SOURCE OF FIBRE: >= 3 g/100g or >= 1.5 g/100kcal")
    # protein: share of energy, needs kcal (4 kcal/g, Reg 1169/2011 Annex XIV conversion factor)
    # assumption: an absolute floor of 3 g/100g as well, so a technically-true but trivial claim (e.g. 1.1 g
    # protein in a 21 kcal cola = 21% of energy) is never promoted; the regulation itself has no floor.
    if prot is not None and kcal and prot >= PROTEIN_FLOOR_G:
        share = 4 * prot / kcal
        ev = f"OFF proteins_100g={prot:g}, energy_kcal_100g={kcal:g} -> {share:.0%} of energy (4 kcal/g, Reg 1169/2011 Annex XIV)"
        if share >= 0.20:
            add("high_protein", "high protein", "nutrition", ev, "HIGH PROTEIN: >= 20% of energy from protein")
        elif share >= 0.12:
            add("source_protein", "source of protein", "nutrition", ev, "SOURCE OF PROTEIN: >= 12% of energy from protein")
    # sugar
    if sug is not None:
        lim = 2.5 if liquid else 5.0
        ev = f"OFF sugars_100g={sug:g} ({'liquid, per 100ml' if liquid else 'solid, per 100g'})"
        if sug <= 0.5:
            add("sugar_free", "sugar free", "nutrition", ev, "SUGARS-FREE: <= 0.5 g/100g or /100ml")
        elif sug <= lim:
            add("low_sugar", "low sugar", "nutrition", ev, f"LOW SUGARS: <= {lim:g} g/{'100ml' if liquid else '100g'}")
    ing = (p.get("ingredients_text") or "").strip()
    if ing and not ADDED_SUGAR_RE.search(ing):
        txt = "no added sugar" + (" (contains naturally occurring sugars)" if (sug or 0) > 0.5 else "")
        add("no_added_sugar", txt, "nutrition", f"OFF ingredients_text has no added sugar/syrup/honey etc.: '{ing[:90]}...'",
            "NO ADDED SUGARS: no mono-/disaccharides or sweetening food added; must add 'contains naturally occurring "
            "sugars' if sugars are naturally present")
    if salt is not None and salt <= 0.3:
        add("low_salt", "low salt", "nutrition", f"OFF salt_100g={salt:g}", "LOW SODIUM/SALT: <= 0.12 g sodium (0.3 g salt) /100g")
    if kcal is not None and kcal <= (20 if liquid else 40):
        add("low_energy", "low calorie", "nutrition", f"OFF energy_kcal_100g={kcal:g}",
            f"LOW ENERGY: <= {20 if liquid else 40} kcal/{'100ml' if liquid else '100g'}")
    # certifications: only if OFF carries the label (the certification is the brand's, not ours)
    labels = [str(l) for l in (p.get("labels") or [])]
    for lab, cid, text in (("en:organic", "organic", "organic"), ("en:vegan", "vegan", "vegan"),
                           ("en:no-gluten", "gluten_free", "gluten free"), ("en:fair-trade", "fairtrade", "fairtrade"),
                           ("en:certified-b-corporation", "b_corp", "B Corp certified")):
        if lab in labels:
            src = ("Reg (EU) 2018/848 organic logo rules" if cid == "organic" else
                   "Reg (EU) 828/2014 gluten-free (<= 20 mg/kg)" if cid == "gluten_free" else "certification on pack")
            add(cid, text, "certification", f"OFF labels contains {lab}", f"label present on OFF ({src})",
                source=f"OFF labels field: {off}")
    return out


def claim_surfaced(claim: dict, pack_copy: str) -> bool:
    t = (pack_copy or "").lower()
    keys = {"high_fibre": ["high fibre", "high fiber"], "source_fibre": ["source of fibre", "fibre"],
            "high_protein": ["high protein", "high in protein"], "source_protein": ["protein"],
            "low_sugar": ["low sugar", "1g sugar"], "sugar_free": ["sugar free", "no sugar", "zero sugar"],
            "no_added_sugar": ["no added sugar"], "low_salt": ["low salt"], "low_energy": ["low calorie", "no calories"],
            "organic": ["organic"], "vegan": ["vegan"], "gluten_free": ["gluten free", "gluten-free"],
            "fairtrade": ["fairtrade", "fair trade"], "b_corp": ["b corp"]}
    return any(k in t for k in keys.get(claim["id"], [claim["claim"]]))


# strength order for picking variants (assumption: nutrition claims before certifications because the user's
# brief is about health-led alternatives; ties broken by this list order)
CLAIM_ORDER = ["high_fibre", "high_protein", "no_added_sugar", "low_sugar", "sugar_free", "source_fibre",
               "source_protein", "low_salt", "low_energy", "organic", "vegan", "gluten_free", "fairtrade", "b_corp"]


def _strip_claim(copy: str, claim: dict) -> str:
    """Remove an already-present mention of the claim from the base copy so the variant doesn't repeat it."""
    parts = re.split(r"\s*[·,\-–—]\s+", copy or "")
    keep = [s for s in parts if not claim_surfaced(claim, s) or len(s) > 40]
    return " · ".join(s for s in keep if s)


def build_variants(p: dict, max_variants: int = 5) -> list[dict]:
    base = (p.get("pack_copy") or p.get("name") or "").strip()
    claims = sorted(eligible_claims(p), key=lambda c: CLAIM_ORDER.index(c["id"]) if c["id"] in CLAIM_ORDER else 99)
    variants = [{"id": "control", "pack_copy": base, "claims": [], "lead": None,
                 "how": "current pack_copy from catalog.json (" + str(p.get("pack_copy_source", "OFF"))[:160] + ")"}]
    for c in claims:
        if len(variants) >= max_variants - 1:
            break
        copy = f"{c['claim'].upper()} · " + _strip_claim(base, c)
        variants.append({"id": f"lead_{c['id']}", "pack_copy": copy[:220], "claims": [c], "lead": c["id"],
                         "already_on_pack": claim_surfaced(c, base),
                         "how": f"lead with '{c['claim']}' in capitals ahead of the current copy"})
    nut = [c for c in claims if c["kind"] == "nutrition"][:2]
    if len(nut) == 2 and len(variants) < max_variants:
        b = _strip_claim(_strip_claim(base, nut[0]), nut[1])
        variants.append({"id": f"stack_{nut[0]['id']}+{nut[1]['id']}",
                         "pack_copy": f"{nut[0]['claim'].upper()} · {nut[1]['claim'].upper()} · {b}"[:220],
                         "claims": nut, "lead": nut[0]["id"], "already_on_pack": all(claim_surfaced(c, base) for c in nut),
                         "how": "stack the two strongest nutrition claims"})
    return variants


# ---------------------------------------------------------------- 2. Jev fan-out
def load_personas() -> list[dict]:
    return [json.load(open(f)) for f in sorted(glob.glob(os.path.join(PERSONA_DIR, "*.json")))]


def slot_set(code: str, catalog: dict) -> list[dict]:
    try:
        pl = json.load(open(PLANOGRAM))
        for slot, s in pl.items():
            if code in s.get("products", []):
                return [catalog[c] for c in s["products"] if c in catalog], slot
    except Exception:
        pass
    return [catalog[code]], None


def build_questions(persona_state: dict) -> dict:
    q = {
        "pickup": {"type": "noul",
                   "instructions": "Would `shopper` stop and pick up `product` off the shelf based on this pack "
                                   "(the name, `product.pack_copy`, badges and price they can see)?",
                   "criteria": {"true": "the pack makes them stop and take it off the shelf for a closer look",
                                "false": "they glance at it and keep walking"}},
        "appeal": {"type": "score",
                   "instructions": "How does `shopper` feel about `product` on today's trip, judging only by this pack?",
                   "criteria": jev.APPEAL_LEVELS},
        "gimmick": {"type": "noul",
                    "instructions": "Does `shopper` read the claims in `product.pack_copy` as a marketing gimmick or "
                                    "spin rather than a real benefit?",
                    "criteria": {"true": "they would see the claims as hype, a gimmick or a health halo",
                                 "false": "they take the claims at face value, or there is nothing to react against"}},
        "believe": {"type": "noul",
                    "instructions": "Does the first claim in `product.pack_copy` speak to something in `shopper.priorities` "
                                    "or `shopper.mission`?",
                    "criteria": {"true": "the lead claim is relevant to what they care about today",
                                 "false": "the lead claim is irrelevant to them, or there is no lead claim"}},
    }
    for k in range(len(persona_state["put_offs"])):
        q[f"put_off_{k}"] = {"type": "noul",
                             "instructions": f"Does `product` show what `shopper.put_offs[{k}]` describes?",
                             "criteria": {"true": "the pack clearly shows it",
                                          "false": "the pack does not show it, or does not show enough to tell"}}
    for k in range(len(persona_state["trusts"])):
        q[f"trust_{k}"] = {"type": "noul",
                           "instructions": f"Does `product` show what `shopper.trusts[{k}]` describes?",
                           "criteria": {"true": "the pack clearly shows it",
                                        "false": "the pack does not show it, or does not show enough to tell"}}
    return q


def judge(persona: dict, p: dict, variant: dict, set_items: list[dict]) -> dict:
    pv = dict(p, pack_copy=variant["pack_copy"])
    others = [q for q in set_items if q["code"] != p["code"]]
    card = jev.product_state(pv, [pv] + others, reads_labels=False, budget_left=None)  # front of pack only
    shopper = jev.shopper_state(persona, persona.get("ocean") or {}, mission=persona.get("mission", "weekly_shop"),
                                budget_left=None, category=p.get("category", ""), on_mission=True, basket=[])
    state = {"shopper": shopper, "product": card}
    qs = build_questions(shopper)
    res = jev.ask(state, qs, tag=f"pack_test:{p['code']}:{variant['id']}:{persona['id']}")
    A = res["answers"]
    ap = A["appeal"]
    ap_probs = {int(k): round(float(v), 4) for k, v in ap["probabilities"].items()}
    trig = jev.top_triggers(persona)
    trust = jev.top_trust(persona)
    nouls = {}
    for k, t in enumerate(trig):
        nouls[f"put_off_{k}"] = {"text": jev._txt(t, "trigger")[:220], "p": round(float(A[f"put_off_{k}"]["noul"]), 4),
                                 "source": t.get("source", ""), "verbatim": jev.verbatim_for(t, persona)}
    for k, t in enumerate(trust):
        nouls[f"trust_{k}"] = {"text": jev._txt(t, "signal", "trust")[:200], "p": round(float(A[f"trust_{k}"]["noul"]), 4),
                               "source": t.get("source", ""), "verbatim": jev.verbatim_for(t, persona)}
    usage = res.get("usage") or {}
    return {"persona_id": persona["id"], "archetype": persona.get("archetype"), "variant": variant["id"],
            "p_pick_up": round(float(A["pickup"]["noul"]), 4),
            "appeal_score": round(float(ap["score"]), 4), "appeal_probabilities": ap_probs,
            "appeal_confidence": ap.get("confidence"),
            "p_gimmick": round(float(A["gimmick"]["noul"]), 4), "p_lead_claim_relevant": round(float(A["believe"]["noul"]), 4),
            "nouls": nouls,
            "jev": {"model": res.get("model"), "cache_key": res["cache_key"], "cached": res["cached"],
                    "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
                    "cost_usd": round(res["cost"], 8), "cost_if_uncached_usd": round(jev.cost_of(usage.get("input_tokens")), 8),
                    "n_questions": len(qs)},
            "state": state}


# ---------------------------------------------------------------- 3. composition (code)
NOISE = 0.02
WIN_RULE = ("winner = variant with the highest equal-weighted mean P(pick-up) across personas, among variants whose "
            "mean P(gimmick) is no more than 0.10 above the control's (assumption: a pick-up bought with a big rise "
            "in perceived spin is a trust risk). Ties (<0.005) broken by mean appeal score. The control can win.")


def analyse(p: dict, variants: list[dict], results: list[dict]) -> dict:
    by = {}
    for r in results:
        by.setdefault(r["variant"], {})[r["persona_id"]] = r
    ctrl = by["control"]
    summary = []
    for v in variants:
        rs = by[v["id"]]
        pids = sorted(rs)
        deltas = {pid: round(rs[pid]["p_pick_up"] - ctrl[pid]["p_pick_up"], 4) for pid in pids}
        n = len(pids)
        mean = lambda xs: round(sum(xs) / len(xs), 4) if xs else None  # noqa: E731
        trig_fire = {}
        for pid in pids:
            for k, nv in rs[pid]["nouls"].items():
                if k.startswith("put_off") and nv["p"] > jev.NOUL_FIRES:
                    trig_fire.setdefault(nv["text"], []).append({"persona": pid, "p": nv["p"], "source": nv["source"],
                                                                 "verbatim": nv.get("verbatim")})
        summary.append({
            "variant": v["id"], "pack_copy": v["pack_copy"], "claims": v["claims"], "how": v["how"],
            "already_on_pack": v.get("already_on_pack"),
            "mean_p_pick_up": mean([rs[x]["p_pick_up"] for x in pids]),
            "mean_delta_p_pick_up_vs_control": mean(list(deltas.values())),
            "personas_up": sum(1 for d in deltas.values() if d > 0.02),
            "personas_down": sum(1 for d in deltas.values() if d < -0.02),
            "delta_by_persona": deltas,
            "p_pick_up_by_persona": {x: rs[x]["p_pick_up"] for x in pids},
            "mean_appeal_score": mean([rs[x]["appeal_score"] for x in pids]),
            "mean_p_gimmick": mean([rs[x]["p_gimmick"] for x in pids]),
            "mean_p_lead_claim_relevant": mean([rs[x]["p_lead_claim_relevant"] for x in pids]),
            "put_offs_firing": [{"trigger": t, "n_personas": len(v_), "evidence": v_} for t, v_ in
                                sorted(trig_fire.items(), key=lambda kv: -len(kv[1]))][:5],
            "n_personas": n,
            "stats_note": ("Jev returns calibrated probabilities, not samples: no sampling CI. Spread is shown as "
                           "personas_up / personas_down (|delta| > 0.02, assumption: below that is noise-level)."),
        })
    ctrl_g = next(s for s in summary if s["variant"] == "control")["mean_p_gimmick"]
    ok = [s for s in summary if s["mean_p_gimmick"] <= ctrl_g + 0.10]
    best = max(ok, key=lambda s: (round(s["mean_p_pick_up"] / 0.005), s["mean_appeal_score"]))
    d = best["mean_delta_p_pick_up_vs_control"] or 0.0
    verdict = (f"'{best['variant']}' lifts mean P(pick-up) by {d:+.3f} across the panel" if d >= NOISE else
               f"no variant moves the panel mean by {NOISE} or more (best {best['variant']} {d:+.3f}): the claim alone "
               f"won't change pick-up on average; use the per-persona wins below to target the segment")
    seg = []
    for s_ in summary:
        if s_["variant"] == "control":
            continue
        for pid, dd in s_["delta_by_persona"].items():
            seg.append({"persona": pid, "variant": s_["variant"], "delta_p_pick_up": dd,
                        "control_p_pick_up": ctrl[pid]["p_pick_up"]})
    seg.sort(key=lambda x: -x["delta_p_pick_up"])
    return {"variants": summary, "winner": best["variant"], "winner_rule": WIN_RULE, "verdict": verdict,
            "noise_floor": NOISE, "noise_floor_source": "assumption: |delta| < 0.02 in a Noul probability is treated as no change",
            "biggest_persona_wins": seg[:5], "biggest_persona_losses": seg[::-1][:3],
            "winner_delta_p_pick_up": best["mean_delta_p_pick_up_vs_control"],
            "excluded_for_gimmick": [s["variant"] for s in summary if s not in ok]}


def run_product(code: str, catalog: dict, personas: list[dict], workers: int = 12) -> dict:
    p = catalog[code]
    set_items, slot = slot_set(code, catalog)
    variants = build_variants(p)
    jobs = [(per, v) for v in variants for per in personas]
    with ThreadPoolExecutor(workers) as ex:
        results = list(ex.map(lambda pv: judge(pv[0], p, pv[1], set_items), jobs))
    a = analyse(p, variants, results)
    tok = sum(r["jev"]["input_tokens"] or 0 for r in results)
    return {
        "code": code, "name": p.get("name"), "brand": p.get("brand"), "category": p.get("category"),
        "role": p.get("role"), "slot": slot, "off_url": p.get("off_url"),
        "inputs": {"catalog": "data/products/catalog.json", "personas": sorted(x["id"] for x in personas),
                   "persona_weighting": PERSONA_WEIGHT_NOTE, "set_shown_for_price_context": [q["code"] for q in set_items],
                   "card": "front of pack only (sim/jev.py product_state, reads_labels=False): name, brand type, price words, pack_copy, badges"},
        "eligible_claims": eligible_claims(p),
        "variants_built": variants,
        **a,
        "results": results,
        "cost": {"engine": "jev", "requests": len(results), "input_tokens": tok,
                 "usd_if_uncached": round(jev.cost_of(tok), 6), "usd_this_run": round(sum(r["jev"]["cost_usd"] for r in results), 6),
                 "price_source": jev.PRICE_SOURCE},
    }


def to_markdown(r: dict) -> str:
    L = [f"# pack test: {r['brand']} {r['name']}", "",
         f"barcode `{r['code']}` · {r['category']} · {r['role']} · slot {r['slot']} · [OFF]({r['off_url']})", "",
         f"**winner: `{r['winner']}`** (Δ P(pick-up) vs control {r['winner_delta_p_pick_up']:+.3f}, mean of "
         f"{len(r['inputs']['personas'])} personas). rule: {r['winner_rule']}", "",
         f"**verdict:** {r['verdict']}", "",
         "**biggest per-persona lifts:** " + "; ".join(f"{x['persona']} `{x['variant']}` {x['control_p_pick_up']:.2f} -> "
                                                    f"{x['control_p_pick_up'] + x['delta_p_pick_up']:.2f}" for x in r["biggest_persona_wins"][:3]), "",
         "## claims it legally qualifies for (computed from OFF, Reg 1924/2006)", "",
         "| claim | evidence | rule | source |", "|---|---|---|---|"]
    for c in r["eligible_claims"]:
        L.append(f"| {c['claim']} | {c['evidence']} | {c['rule']} | {c['source']} |")
    L += ["", "## variants", "", "| variant | pack copy | mean P(pick-up) | Δ vs control | personas ↑/↓ | appeal (0-4) | P(gimmick) |",
          "|---|---|---|---|---|---|---|"]
    for s in r["variants"]:
        L.append(f"| `{s['variant']}` | {s['pack_copy'][:110]} | {s['mean_p_pick_up']:.3f} | "
                 f"{s['mean_delta_p_pick_up_vs_control']:+.3f} | {s['personas_up']}/{s['personas_down']} | "
                 f"{s['mean_appeal_score']:.2f} | {s['mean_p_gimmick']:.2f} |")
    L += ["", "## Δ P(pick-up) by persona (vs control; Jev Noul probabilities)", ""]
    pids = r["inputs"]["personas"]
    vs = [s for s in r["variants"] if s["variant"] != "control"]
    L.append("| persona | control | " + " | ".join(f"`{s['variant']}`" for s in vs) + " |")
    L.append("|---|---|" + "---|" * len(vs))
    ctrl = next(s for s in r["variants"] if s["variant"] == "control")
    for pid in pids:
        L.append(f"| {pid} | {ctrl['p_pick_up_by_persona'][pid]:.2f} | " +
                 " | ".join(f"{s['delta_by_persona'][pid]:+.2f}" for s in vs) + " |")
    w = next(s for s in r["variants"] if s["variant"] == r["winner"])
    L += ["", "## put-offs still firing on the winner (Noul > 0.5)", ""]
    if not w["put_offs_firing"]:
        L.append("none.")
    for t in w["put_offs_firing"]:
        ev = t["evidence"][0]
        vb = ev.get("verbatim") or {}
        L.append(f"- **{t['trigger']}** — {t['n_personas']} persona(s), e.g. {ev['persona']} p={ev['p']:.2f}"
                 + (f"; \"{vb.get('quote','')[:140]}\" ({vb.get('url','')})" if vb.get("quote") else "")
                 + f"; source: {str(ev['source'])[:160]}")
    c = r["cost"]
    L += ["", f"_jev: {c['requests']} requests, {c['input_tokens']} input tokens, ${c['usd_if_uncached']:.4f} if uncached. "
              f"Every probability above is in data/sim/brand/pack_test/{r['code']}.json with the exact state and questions "
              f"(cache key per request in data/sim/cache/jev/). {r['inputs']['persona_weighting']}._", ""]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--products", default=",".join(DEFAULT_PRODUCTS))
    ap.add_argument("--list-claims", action="store_true")
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--max-usd", type=float, default=1.0)
    a = ap.parse_args()
    catalog = {p["code"]: p for p in json.load(open(CATALOG))}
    if a.list_claims:
        for p in catalog.values():
            if p.get("role") != "challenger":
                continue
            cl = eligible_claims(p)
            new = [c["claim"] for c in cl if not claim_surfaced(c, p.get("pack_copy", ""))]
            print(f"{p['code']} {p['brand']} | {p['name'][:40]} | eligible: {[c['claim'] for c in cl]} | NOT on pack: {new}")
        return
    jev.set_max_usd(a.max_usd)
    personas = load_personas()
    os.makedirs(OUT_DIR, exist_ok=True)
    index = []
    for code in [c.strip() for c in a.products.split(",") if c.strip()]:
        r = run_product(code, catalog, personas, a.workers)
        with open(os.path.join(OUT_DIR, f"{code}.json"), "w") as f:
            json.dump(r, f, indent=1, ensure_ascii=False)
        with open(os.path.join(OUT_DIR, f"{code}.md"), "w") as f:
            f.write(to_markdown(r))
        print(f"{code} {r['brand']} {r['name'][:40]}: winner {r['winner']} "
              f"(Δ pick-up {r['winner_delta_p_pick_up']:+.3f}); {r['cost']['requests']} req, "
              f"{r['cost']['input_tokens']} tok, ${r['cost']['usd_this_run']:.5f} this run")
        index.append({"code": code, "name": r["name"], "brand": r["brand"], "winner": r["winner"],
                      "winner_pack_copy": next(s["pack_copy"] for s in r["variants"] if s["variant"] == r["winner"]),
                      "winner_delta_p_pick_up": r["winner_delta_p_pick_up"], "json": f"data/sim/brand/pack_test/{code}.json"})
    idx_path = os.path.join(OUT_DIR, "index.json")
    old = json.load(open(idx_path)) if os.path.exists(idx_path) else []
    keep = [x for x in old if x["code"] not in {i["code"] for i in index}]
    with open(idx_path, "w") as f:
        json.dump(keep + index, f, indent=1, ensure_ascii=False)
    print("session:", jev.session_cost())


if __name__ == "__main__":
    main()

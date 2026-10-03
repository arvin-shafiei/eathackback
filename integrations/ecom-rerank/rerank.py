"""E-commerce re-rank for a shopper archetype, plus an agent-readiness check of the listing data.

Three steps. Code keeps the arithmetic; Jev answers narrow judgments over words
(docs.typesafe.ai: patterns/composite-scoring, model-jaggedness/jev-1.13 #2 #5 #8).

1. archetype   given (one of the 12 lens archetypes), or inferred from anonymous session signals with ONE
               Jev Choice over the 12 archetypes + "unclear" (options shuffled, seed recorded).
2. rank        one Jev request: per product a Score "how well does this fit the shopper" (5 levels) and a Noul
               "shows one of the shopper's put-offs". Products are shuffled in state (seed recorded) so list
               order cannot leak. Code composes: final = W_LENS*lens + W_FIT*fit - W_PUTOFF*p_putoff.
3. readiness   pure code: which listing fields an AI shopping agent needs are missing or estimated.

Every position carries its inputs, the Jev probabilities and sources.

Usage:
  python3 integrations/ecom-rerank/rerank.py --category breakfast_cereal --archetype glp1_small_appetite
  python3 integrations/ecom-rerank/rerank.py --category snack_bars --signals "searched: high protein low sugar" "viewed: Grenade bar"
  python3 integrations/ecom-rerank/rerank.py --category yoghurt --readiness-only
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "sim"))
sys.path.insert(0, os.path.dirname(HERE))

import jev  # noqa: E402  sim/jev.py: ask(), feed_state_item(), words-not-numbers helpers
from common import load_catalog, load_personas, rel  # noqa: E402

# composite weights: assumptions, exposed so a merchandiser can change them without re-running inference
W_LENS, W_FIT, W_PUTOFF = 0.4, 0.6, 0.3
WEIGHTS_SOURCE = ("assumption: fit (Jev reading the shopper's own priorities) weighted above the code lens grade "
                  "because it sees pack copy and claims; put-off penalty 0.3 so a likely deal-breaker drops "
                  "~one position band. Tune on real click/purchase data.")
FIT_LEVELS = [
    "a poor fit: clashes with what this shopper cares about, they would scroll past",
    "a weak fit: little reason for this shopper to choose it",
    "a neutral fit: neither suits nor clashes with their priorities",
    "a good fit: matches several of this shopper's priorities",
    "an excellent fit: exactly what this shopper is looking for",
]
FIT_SHORT = ["poor", "weak", "neutral", "good", "excellent"]
UNCLEAR = "unclear"


# ---------------------------------------------------------------- 1. archetype from session signals
def archetype_blurb(p: dict) -> str:
    lens = sorted(p.get("lens") or [], key=lambda l: -float(l.get("weight") or 0))[:3]
    pri = "; ".join(f"{str(l.get('attribute','')).replace('_',' ')} ({jev.DIRECTION_WORDS.get(l.get('direction'), l.get('direction',''))})"
                    for l in lens)
    return f"shops for {jev.MISSION_WORDS.get(p.get('mission'), p.get('mission'))}; cares most about: {pri}"


def infer_archetype(signals: list[str], personas: dict, seed: int = 0) -> dict:
    opts = list(personas) + [UNCLEAR]
    rng = random.Random(f"archetype:{seed}")
    rng.shuffle(opts)  # jaggedness #8: option order shuffled, order recorded
    crit = {o: ("the signals are too thin or mixed to tell which kind of shopper this is" if o == UNCLEAR
                else archetype_blurb(personas[o])) for o in opts}
    state = {"session_signals": signals}
    q = {"archetype": {"type": "choice",
                       "instructions": ("Which kind of grocery shopper best explains `session_signals` (what this anonymous "
                                        "visitor searched, viewed, added or removed this session)?"),
                       "criteria": crit}}
    r = jev.ask(state, q, tag="integrations:ecom-rerank:archetype")
    a = r["answers"]["archetype"]
    probs = {k: round(float(v), 4) for k, v in a["probabilities"].items()}
    top = max(probs, key=probs.get)
    return {"archetype": top, "probabilities": dict(sorted(probs.items(), key=lambda kv: -kv[1])),
            "confidence": a.get("confidence"), "option_order": opts, "signals": signals,
            "jev_model": r.get("model"), "input_tokens": (r.get("usage") or {}).get("input_tokens"),
            "cached": r.get("cached"), "cost_usd": r.get("cost"),
            "fallback": ("unclear -> neutral ranking by lens average" if top == UNCLEAR else None)}


# ---------------------------------------------------------------- 2. re-rank
def shopper_card(p: dict) -> dict:
    lens = sorted(p.get("lens") or [], key=lambda l: -float(l.get("weight") or 0))[:4]
    return {
        "mission": jev.MISSION_WORDS.get(p.get("mission"), p.get("mission")),
        "priorities": [f"{str(l.get('attribute','')).replace('_',' ')}: {jev.DIRECTION_WORDS.get(l.get('direction'), l.get('direction',''))}"
                       + (f" ({str(l.get('why'))[:100]})" if l.get("why") else "") for l in lens],
        "put_offs": [jev._txt(t, "trigger")[:200] for t in jev.top_triggers(p, 3)],
        "trusts": [jev._txt(t, "signal", "trust")[:160] for t in jev.top_trust(p, 2)],
    }


def lens_score(prod: dict, archetype: str | None) -> tuple[float, list[str], str]:
    g = (prod.get("lens_grades") or {})
    if archetype and archetype in g:
        return float(g[archetype]["score"]), list(g[archetype].get("why") or []), f"catalog.json lens_grades.{archetype}"
    vals = [float(v["score"]) for v in g.values() if isinstance(v, dict) and "score" in v]
    return (sum(vals) / len(vals) if vals else 0.5), ["mean of all lens grades (no archetype)"], "catalog.json lens_grades (mean)"


def rerank(listing: list[dict], archetype: str | None, personas: dict, seed: int = 0) -> dict:
    """listing: product dicts (catalog.json shape) in the retailer's current order."""
    persona = personas.get(archetype) if archetype else None
    jev_block = None
    fit = {}
    if persona:
        order = list(range(len(listing)))
        random.Random(f"rerank:{seed}").shuffle(order)  # state order shuffled; position cannot leak into fit
        products = [jev.feed_state_item(listing[i], listing) for i in order]
        state = {"shopper": shopper_card(persona), "products": products}
        q = {}
        for j, i in enumerate(order):
            nm = listing[i].get("name", "")
            q[f"fit_{j}"] = {"type": "score",
                             "instructions": f"How well does `products[{j}]` ({nm}) fit what `shopper` cares about on this trip?",
                             "criteria": FIT_LEVELS}
            q[f"putoff_{j}"] = {"type": "noul",
                                "instructions": (f"Does `products[{j}]` ({nm}) clearly show at least one of the things listed in "
                                                 "`shopper.put_offs`?"),
                                "criteria": {"true": "the product data clearly shows one of the put-offs",
                                             "false": "it does not, or the data does not show enough to tell"}}
        t0 = time.time()
        r = jev.ask(state, q, tag=f"integrations:ecom-rerank:{archetype}")
        ans = r["answers"]
        for j, i in enumerate(order):
            a, b = ans[f"fit_{j}"], ans[f"putoff_{j}"]
            probs = {int(k): float(v) for k, v in a["probabilities"].items()}
            fit[i] = {"score_0_4": round(float(a["score"]), 3), "fit_0_1": round(float(a["score"]) / 4, 4),
                      "level": FIT_SHORT[max(probs, key=probs.get)],
                      "probabilities": {FIT_SHORT[k]: round(v, 4) for k, v in sorted(probs.items())},
                      "confidence": a.get("confidence"), "p_putoff": round(float(b["noul"]), 4)}
        jev_block = {"model": r.get("model"), "n_questions": len(q), "input_tokens": (r.get("usage") or {}).get("input_tokens"),
                     "cost_usd": r.get("cost"), "cached": r.get("cached"), "wall_s": round(time.time() - t0, 2),
                     "state_order_seed": f"rerank:{seed}", "state_order": order,
                     "pricing": jev.PRICE_SOURCE}

    rows = []
    for i, prod in enumerate(listing):
        ls, why, lsrc = lens_score(prod, archetype)
        f = fit.get(i)
        if f:
            final = W_LENS * ls + W_FIT * f["fit_0_1"] - W_PUTOFF * f["p_putoff"]
            formula = (f"{W_LENS}*lens {ls:.3f} + {W_FIT}*fit {f['fit_0_1']:.3f} - {W_PUTOFF}*P(put-off) "
                       f"{f['p_putoff']:.3f} = {final:.3f}")
        else:
            final, formula = ls, f"lens {ls:.3f} (no Jev: archetype unclear or not given)"
        rows.append({"code": prod["code"], "name": prod.get("name"), "brand": prod.get("brand"), "role": prod.get("role"),
                     "original_position": i + 1, "final_score": round(final, 4), "formula": formula,
                     "lens": {"score": round(ls, 4), "why": why, "source": lsrc}, "jev_fit": f,
                     "off_url": prod.get("off_url")})
    rows.sort(key=lambda x: (-x["final_score"], x["original_position"]))
    for k, row in enumerate(rows, 1):
        row["new_position"] = k
        row["moved"] = row["original_position"] - k
        row["explanation"] = explain(row, persona)
    return {"archetype": archetype, "persona_file": persona.get("_file") if persona else None,
            "weights": {"lens": W_LENS, "fit": W_FIT, "putoff_penalty": W_PUTOFF, "source": WEIGHTS_SOURCE},
            "results": rows, "jev": jev_block}


def explain(row: dict, persona: dict | None) -> str:
    f = row["jev_fit"]
    mv = row["moved"]
    move = f"up {mv}" if mv > 0 else f"down {-mv}" if mv < 0 else "unchanged"
    parts = [f"#{row['new_position']} ({move} from #{row['original_position']})"]
    if f:
        parts.append(f"Jev reads it as a {f['level']} fit for {persona.get('name', 'this shopper')} "
                     f"(P={f['probabilities'].get(f['level'])}, confidence {f['confidence']:.2f})")
        if f["p_putoff"] >= 0.5:
            parts.append(f"likely shows one of their put-offs (P={f['p_putoff']:.2f})")
    lw = "; ".join(row["lens"]["why"][:3])
    parts.append(f"lens grade {row['lens']['score']:.2f} from {lw}")
    return ". ".join(parts) + "."


# ---------------------------------------------------------------- 3. agent readiness (code only)
READINESS_FIELDS = [
    # field, weight, test, why an AI shopping agent needs it, source
    ("gtin", 2, lambda p: bool(p.get("code")), "exact product identity across retailers and feeds",
     "GS1 GTIN; Google Merchant Center product data spec requires gtin for branded products"),
    ("name", 2, lambda p: bool(p.get("name")), "matching the user's request", "schema.org/Product name"),
    ("brand", 2, lambda p: bool(p.get("brand")), "brand filters, incumbent-vs-challenger comparisons",
     "schema.org/Product brand; Incumbent Advantage effect (ACES, Allouah et al. 2025, arXiv 2508.02630)"),
    ("price", 3, lambda p: bool(p.get("price_gbp")), "agents optimise price; ACES ln(price) coef -1.62",
     "ACES (arXiv 2508.02630) conditional-logit coefficients"),
    ("price_verified", 2, lambda p: bool(p.get("price_gbp")) and not str(p.get("price_source", "")).startswith("assumption"),
     "an estimated price misleads the agent's value comparison", "catalog.json price_source"),
    ("unit_price", 2, lambda p: bool(p.get("price_per_kg_gbp") or p.get("price_per_litre_gbp") or p.get("unit_price_gbp_per_kg")),
     "value-for-money comparisons ('cheapest per kilo')", "UK Price Marking Order 2004 (unit pricing)"),
    ("pack_size", 1, lambda p: bool(p.get("quantity")), "portion and value reasoning", "OFF quantity"),
    ("ingredients", 2, lambda p: bool((p.get("ingredients_text") or "").strip()), "dietary and UPF filters",
     "OFF ingredients_text; FIC Reg. (EU) 1169/2011 as retained in UK law"),
    ("allergens", 3, lambda p: p.get("allergens") is not None and (bool(p.get("allergens")) or bool((p.get("ingredients_text") or "").strip())),
     "safety: an agent must not guess allergens (empty list with no ingredients = unknown, not 'none')",
     "FIC Reg. 1169/2011 Art. 21; Natasha's Law context"),
    ("nutrition", 2, lambda p: all(isinstance(p.get(k), (int, float)) for k in ("sugars_100g", "salt_100g", "proteins_100g", "energy_kcal_100g")),
     "'high protein', 'low sugar' queries; claim eligibility", "OFF nutriments; Reg. (EC) 1924/2006 claim thresholds"),
    ("fibre", 1, lambda p: isinstance(p.get("fiber_100g"), (int, float)), "'high fibre' queries and swaps",
     "OFF fiber_100g; high fibre >= 6 g/100g (Reg. 1924/2006)"),
    ("nutriscore", 1, lambda p: str(p.get("nutriscore") or "").lower() in "abcde" and bool(p.get("nutriscore")),
     "a compact health signal agents can rank on", "OFF nutriscore_grade"),
    ("processing_nova", 1, lambda p: p.get("nova") in (1, 2, 3, 4), "UPF-avoider requests", "OFF nova_group"),
    ("labels", 1, lambda p: bool(p.get("labels")), "vegan / organic / gluten-free filters", "OFF labels_tags"),
    ("image", 1, lambda p: bool(p.get("image")), "multimodal agents read the pack", "OFF image_front_url"),
    ("description", 2, lambda p: len(p.get("pack_copy") or "") >= 40, "semantic match to free-text requests",
     "schema.org/Product description"),
    ("rating_reviews", 3, lambda p: bool(p.get("rating") or p.get("reviews_n")),
     "agents weight ratings heavily (ACES rating coef +4.91, ln(reviews) +0.42); missing = invisible",
     "ACES (arXiv 2508.02630); +0.075 star flips ~50% of choices"),
]


def agent_readiness(prod: dict) -> dict:
    tot = sum(w for _, w, *_ in READINESS_FIELDS)
    got, missing, present = 0, [], []
    for name, w, test, why, src in READINESS_FIELDS:
        ok = bool(test(prod))
        (present if ok else missing).append({"field": name, "weight": w, "why": why, "source": src})
        got += w if ok else 0
    s = got / tot
    band = "agent-ready" if s >= 0.85 else "mostly ready" if s >= 0.7 else "gaps that hide it from agents" if s >= 0.5 else "largely invisible to agents"
    return {"code": prod["code"], "name": prod.get("name"), "brand": prod.get("brand"), "role": prod.get("role"),
            "score": round(s, 3), "band": band, "missing": missing, "present": [x["field"] for x in present],
            "method": f"weighted share of {len(READINESS_FIELDS)} fields present ({tot} weight points); weights are assumptions "
                      "ordered by ACES coefficients and safety. Only honest fixes: fill true missing data, never prompt text.",
            "off_url": prod.get("off_url")}


# ---------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--category", default="breakfast_cereal")
    ap.add_argument("--archetype", help="one of the 12 lens archetypes")
    ap.add_argument("--signals", nargs="*", help="anonymous session signals; inferred to an archetype via Jev Choice")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--readiness-only", action="store_true")
    ap.add_argument("--out", help="write JSON here")
    a = ap.parse_args()

    personas = load_personas()
    listing = [p for p in load_catalog() if p.get("category") == a.category]
    if not listing:
        sys.exit(f"no products in category {a.category}")
    out = {"category": a.category, "listing_source": rel(os.path.join(ROOT, "data/products/catalog.json")),
           "listing_order": "catalog.json order (stand-in for the retailer's current ranking)",
           "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
    if not a.readiness_only:
        arch = a.archetype
        if a.signals:
            inf = infer_archetype(a.signals, personas, a.seed)
            out["archetype_inference"] = inf
            arch = None if inf["archetype"] == UNCLEAR else inf["archetype"]
        if arch and arch not in personas:
            sys.exit(f"unknown archetype {arch}; choose from {sorted(personas)}")
        out["rerank"] = rerank(listing, arch, personas, a.seed)
    rd = sorted((agent_readiness(p) for p in listing), key=lambda x: x["score"])
    out["agent_readiness"] = {"products": rd,
                              "missing_field_counts": {f: sum(1 for x in rd if any(m["field"] == f for m in x["missing"]))
                                                       for f, *_ in READINESS_FIELDS}}
    out["session_cost"] = jev.session_cost()
    js = json.dumps(out, indent=2, ensure_ascii=False)
    if a.out:
        with open(a.out, "w") as f:
            f.write(js)
    # human-readable summary to stderr, JSON to stdout only if no --out
    rr = out.get("rerank")
    if rr:
        print(f"\nre-rank for {rr['archetype'] or 'unknown shopper'} ({a.category}):", file=sys.stderr)
        for row in rr["results"]:
            print(f"  {row['new_position']:>2}. [{row['moved']:+d}] {row['name'][:40]:40} {row['final_score']:.3f}  {row['formula']}",
                  file=sys.stderr)
    print(f"\nagent readiness ({a.category}), lowest first:", file=sys.stderr)
    for x in rd[:6]:
        print(f"  {x['score']:.2f} {x['band']:30} {x['name'][:36]:36} missing: {', '.join(m['field'] for m in x['missing'])}",
              file=sys.stderr)
    print(f"\njev session: {out['session_cost']}", file=sys.stderr)
    if not a.out:
        print(js)


if __name__ == "__main__":
    main()

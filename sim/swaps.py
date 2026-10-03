"""Shopper surface: basket swaps ("you have X in your basket; here's a better-for-you alternative").

Code finds and measures; Jev judges. For a persona + basket:
  1. CODE: for each basket item, find same-category catalogue products that raise the persona's lens grade
     (catalog lens_grades[archetype].score, itself computed from OFF fields with a `why` trail) AND improve at
     least one OFF health field (fibre, sugar, additives, sweeteners, NOVA, salt, protein, organic). Hard gates
     (coeliac gluten, vegan) exclude candidates outright. All deltas (g/100g, £, %) are computed here and
     pre-bucketed into words for Jev (docs: model-jaggedness/jev-1.13 #2 "Math and Numbers").
  2. JEV: one fan-out request per candidate swap (docs: patterns/fan-out):
       accept       Noul  would the shopper accept the swap if suggested at the shelf?
       benefit      Score perceived benefit of the alternative vs the basket item (5 levels)
       alt_trig_k   Noul  per persona rejection trigger: does the ALTERNATIVE show it? (why they'd refuse)
       base_trig_k  Noul  same trigger on the BASKET ITEM (does the swap remove a put-off?)
       price_worth  Noul  is the price difference worth it to them?
  3. CODE: rank = P(accept) x lens improvement (delta lens score). Full trace written to data/sim/swaps/.

Also: claim price-premium analysis (`--claims`): do products MARKETED with a claim cost more than same-category
products without it, and do OFF UK claims meet the Reg (EC) 1924/2006 thresholds?

CLI:
  python3 sim/swaps.py --persona p_glp1_small_appetite --basket 5000112545326,5060088709047 --top 3
  python3 sim/swaps.py --from-run data/sim/runs/<run>.json [--persona p_x | --agent a004] --top 3
  python3 sim/swaps.py --claims          # writes data/sim/swaps/claim_premium.json + .md (no Jev calls)
  add --dry  to build the requests without calling Jev.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

CATALOG = os.path.join(ROOT, "data", "products", "catalog.json")
PERSONA_DIR = os.path.join(ROOT, "data", "personas", "lens")
POOL = os.path.join(ROOT, "data", "products", "uk_products.parquet")
OUT_DIR = os.path.join(ROOT, "data", "sim", "swaps")

try:  # shared Jev plumbing (cache, cost log, spend guard) + the words helpers
    import jev as J
    ask, cost_of, MODEL, PRICE_SOURCE = J.ask, J.cost_of, J.MODEL, J.PRICE_SOURCE
except Exception:  # pragma: no cover - tiny local fallback (task rule 3)
    import hashlib
    J = None
    MODEL = "jev-latest"
    PRICE_SOURCE = "TypeSafe pricing: $0.042 per 1M input tokens, output free"

    def cost_of(t):
        return (t or 0) * 0.042 / 1e6

    def ask(state, questions, *, tag=""):
        from typesafe_sdk import TypeSafeClient
        blob = json.dumps({"model": MODEL, "state": state, "questions": questions}, sort_keys=True)
        key = hashlib.sha256(blob.encode()).hexdigest()
        cd = os.path.join(ROOT, "data", "sim", "cache", "jev")
        os.makedirs(cd, exist_ok=True)
        cp = os.path.join(cd, key + ".json")
        if os.path.exists(cp):
            return {**json.load(open(cp))["response"], "cached": True, "cost": 0.0, "cache_key": key}
        k = [l.split("=", 1)[1].strip() for l in open(os.path.join(ROOT, ".env")) if l.startswith("TYPESAFE_API_KEY=")][0]
        j = TypeSafeClient(api_key=k, model=MODEL).system_one(state, questions).raw_http_response.json()
        it = int((j.get("usage") or {}).get("input_tokens") or 0)
        with open(os.path.join(ROOT, "data", "sim", "cost_log.jsonl"), "a") as f:
            f.write(json.dumps({"ts": time.time(), "model": "jev", "tag": tag, "cost": cost_of(it), "prompt_tokens": it}) + "\n")
        json.dump({"request": json.loads(blob), "response": j}, open(cp, "w"))
        return {**j, "cached": False, "cost": cost_of(it), "cache_key": key}

REG_1924 = ("Regulation (EC) No 1924/2006 Annex (retained in UK law): HIGH FIBRE >=6g/100g or >=3g/100kcal; SOURCE OF "
            "FIBRE >=3g/100g or >=1.5g/100kcal; HIGH PROTEIN >=20% of energy from protein; SOURCE OF PROTEIN >=12%; "
            "LOW SUGARS <=5g/100g (<=2.5g/100ml liquids); NO ADDED SUGARS = no mono/disaccharides or sugar-used-for-"
            "sweetening added. https://www.legislation.gov.uk/eur/2006/1924/annex")
NOUL_FIRES = 0.5  # docs primitives/noul + confidence.md: > 0.5 = more likely yes than no
BENEFIT_LEVELS = [
    "no benefit: the alternative is no better for them, or worse",
    "slight benefit: a small improvement they would barely notice or care about",
    "some benefit: a real improvement on one thing they care about",
    "clear benefit: clearly better on things they care about",
    "big benefit: exactly the kind of product they are trying to switch to",
]
LIQUID = ("soft_drinks", "plant_milk_dairy_alt", "hot_drinks")


# ------------------------------------------------------------------ loading
def load_catalog() -> dict:
    return {p["code"]: p for p in json.load(open(CATALOG))}


def load_persona(pid: str) -> dict:
    name = pid[2:] if pid.startswith("p_") else pid
    path = os.path.join(PERSONA_DIR, name + ".json")
    if not os.path.exists(path):
        raise SystemExit(f"persona not found: {path}")
    return json.load(open(path))


def basket_from_run(path: str, persona: str | None, agent: str | None) -> tuple[str, list[str], dict]:
    r = json.load(open(path))
    for a in r.get("agents", []):
        if (agent and a["agent_id"] == agent) or (not agent and (not persona or a["persona_id"] in (persona, "p_" + persona))):
            codes = [e["product"] for e in a.get("events", []) if e.get("decision") == "pick" and e.get("product")]
            return a["persona_id"], codes, {"run_id": r.get("run_id"), "run_file": os.path.relpath(path, ROOT),
                                            "agent_id": a["agent_id"], "model": a.get("model")}
    raise SystemExit(f"no agent for persona={persona} agent={agent} in {path}")


# ------------------------------------------------------------------ numbers (code owns the arithmetic)
def num(p, *keys):
    for k in keys:
        v = p.get(k)
        if isinstance(v, (int, float)) and v == v:
            return float(v)
    return None


_Q = re.compile(r"(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b", re.I)


def pack_amount(p) -> tuple[float | None, str | None, str]:
    """Net pack amount in g or ml, from OFF `quantity` (e.g. '6 x 25g', '330 ml', '1 l')."""
    for k in ("pack_grams", "pack_g", "pack_size_g"):
        v = num(p, k)
        if v:
            return v, "g", f"catalog {k}"
    m = _Q.search(str(p.get("quantity") or ""))
    if not m:
        return None, None, "no parsable quantity"
    n, v, u = int(m.group(1) or 1), float(m.group(2).replace(",", ".")), m.group(3).lower()
    mult = {"kg": (1000, "g"), "g": (1, "g"), "l": (1000, "ml"), "cl": (10, "ml"), "ml": (1, "ml")}[u]
    return n * v * mult[0], mult[1], f"OFF quantity '{p.get('quantity')}'"


def unit_price_100(p) -> tuple[float | None, str | None, str]:
    """£ per 100 g/ml = price_gbp / pack amount x 100."""
    pr = num(p, "price_gbp")
    amt, u, src = pack_amount(p)
    if not pr or not amt:
        return None, None, src
    return pr / amt * 100, u, f"price_gbp / {src}"


def has_label(p, *tags):
    labs = [str(l).lower() for l in (p.get("labels") or [])]
    return any(t in labs for t in tags)


CLAIMS = {  # claim -> (regex over pack_copy + name, OFF label tags)
    "fibre": (r"\bfib(re|er)\b|prebiotic", ("en:high-fibres", "en:source-of-fibre", "en:high-fibre")),
    "protein": (r"\bprotein\b", ("en:high-proteins", "en:source-of-proteins", "en:high-protein", "en:source-of-protein")),
    "organic": (r"\borganic\b", ("en:organic", "en:eu-organic", "en:soil-association-organic")),
    "gut": (r"\bgut\b|probiotic|prebiotic|live cultures|kefir|kombucha", ()),
    "no_added_sugar": (r"no added sugar|no-added-sugar", ("en:no-added-sugar", "en:no-added-sugars")),
}


def claims_of(p) -> list[str]:
    txt = f"{p.get('pack_copy') or ''} {p.get('name') or ''}".lower()
    return [c for c, (rx, tags) in CLAIMS.items() if re.search(rx, txt) or has_label(p, *tags)]


def organic(p):
    return bool(p.get("organic") is True or has_label(p, *CLAIMS["organic"][1]))


def gluten(p):
    return any("gluten" in str(a).lower() for a in (p.get("allergens") or []))


def vegan(p):
    return bool(p.get("vegan") is True or p.get("vegan") == 1 or has_label(p, "en:vegan")
                or "en:vegan" in str(p.get("analysis") or ""))


# field, better-direction, min meaningful delta, word stem
HEALTH = [("fiber_100g", +1, 1.0, "fibre"), ("sugars_100g", -1, 2.0, "sugar"), ("proteins_100g", +1, 3.0, "protein"),
          ("salt_100g", -1, 0.2, "salt"), ("additives_n", -1, 1, "additives"), ("sweeteners", -1, 1, "sweeteners"),
          ("nova", -1, 1, "processing (NOVA)"), ("palm_oil_n", -1, 1, "palm oil ingredients")]


def health_deltas(a, b) -> list[dict]:
    """b relative to a (b = alternative). 'better' is in the direction the field is better."""
    out = []
    for f, d, thr, stem in HEALTH:
        x, y = num(a, f), num(b, f)
        if x is None or y is None:
            continue
        delta = y - x
        if abs(delta) < thr:
            continue
        better = delta * d > 0
        out.append({"field": f, "basket": x, "alternative": y, "delta": round(delta, 2), "better": better,
                    "words": delta_words(f, delta, y, b), "source": f"OFF {f} ({a['off_url']} vs {b['off_url']})"})
    oa, ob = organic(a), organic(b)
    if oa != ob:
        out.append({"field": "organic", "basket": oa, "alternative": ob, "delta": None, "better": ob,
                    "words": "organic (the basket item is not)" if ob else "not organic (the basket item is)",
                    "source": "OFF labels en:organic / catalog organic"})
    return out


def delta_words(f, d, y, p) -> str:
    a = abs(d)
    liquid = p.get("category") in LIQUID
    if f == "fiber_100g":
        size = "a lot more" if a >= 6 else "noticeably more" if a >= 3 else "a bit more"
        status = "high fibre" if y >= 6 else "a source of fibre" if y >= 3 else "still low fibre"
        return (f"{size} fibre ({status})" if d > 0 else f"{size.replace('more', 'less')} fibre")
    if f == "sugars_100g":
        size = "far" if a >= 15 else "much" if a >= 5 else "a bit"
        low = 2.5 if liquid else 5
        return f"{size} less sugar" + (" (now low sugar)" if y <= low else "") if d < 0 else f"{size} more sugar"
    if f == "proteins_100g":
        return ("much more protein" if a >= 10 else "more protein") if d > 0 else "less protein"
    if f == "salt_100g":
        return ("much less salt" if a >= 0.6 else "less salt") if d < 0 else "more salt"
    if f == "additives_n":
        return ("no additives" if y == 0 else "fewer additives") if d < 0 else "more additives"
    if f == "sweeteners":
        return "no sweeteners" if y == 0 else ("fewer sweeteners" if d < 0 else "contains sweeteners")
    if f == "nova":
        return {1: "unprocessed / minimally processed", 2: "processed culinary ingredient",
                3: "processed but not ultra-processed"}.get(int(y), "less processed") if d < 0 else "more processed (higher NOVA)"
    if f == "palm_oil_n":
        return "no palm oil" if y == 0 else "less palm oil" if d < 0 else "palm oil"
    return f


def price_change(a, b) -> dict:
    pa, pb = num(a, "price_gbp"), num(b, "price_gbp")
    d = pb - pa
    pct = d / pa * 100 if pa else None
    ua, uua, sa = unit_price_100(a)
    ub, uub, sb = unit_price_100(b)
    upct = (ub / ua - 1) * 100 if ua and ub and uua == uub else None
    pen = round(abs(d) * 100)
    money = (f"about {pen}p" if pen < 100 else f"about £{abs(d):.2f}")
    if abs(d) < 0.05:
        shelf = "the same shelf price"
    elif d < 0:
        shelf = f"{money} cheaper per pack"
    else:
        rel = ("a little dearer" if pct < 20 else "noticeably dearer" if pct < 50 else
               "about 1.5x the price" if pct < 85 else "about double the price" if pct < 150 else "several times the price")
        shelf = f"{money} more per pack ({rel})"
    unit = None
    if upct is not None:
        unit = ("about the same value per 100g/ml" if abs(upct) < 7 else
                "better value per 100g/ml" if upct < 0 else
                "a bit worse value per 100g/ml" if upct < 30 else
                "much worse value per 100g/ml" if upct < 100 else "more than double the price per 100g/ml")
    psrc = [a.get("price_source", ""), b.get("price_source", "")]
    return {"basket_price_gbp": pa, "alternative_price_gbp": pb, "delta_gbp": round(d, 2),
            "delta_pct": round(pct, 1) if pct is not None else None,
            "unit_price_100_basket": round(ua, 4) if ua else None, "unit_price_100_alternative": round(ub, 4) if ub else None,
            "unit": uua if uua == uub else None, "unit_delta_pct": round(upct, 1) if upct is not None else None,
            "unit_price_method": [sa, sb],
            "words": shelf + (f"; {unit}" if unit else ""),
            "price_sources": psrc,
            "price_is_assumption": [s.startswith("assumption") for s in psrc]}


def lens_score(p, arch):
    g = (p.get("lens_grades") or {}).get(arch) or {}
    return g.get("score"), g.get("why", [])


def gate_fail(persona, p) -> str | None:
    arch = persona.get("archetype")
    if arch == "allergen_coeliac" and gluten(p):
        return "allergen_coeliac gate: alternative declares gluten (OFF allergens)"
    if arch == "vegan_ethical" and not vegan(p):
        return "vegan_ethical gate: alternative not labelled vegan (OFF labels/analysis)"
    return None


def candidates(persona, item, cat: dict, per_item: int) -> tuple[list[dict], list[dict]]:
    arch = persona["archetype"]
    s0, why0 = lens_score(item, arch)
    kept, dropped = [], []
    for code, p in cat.items():
        if code == item["code"] or p.get("category") != item.get("category"):
            continue
        s1, why1 = lens_score(p, arch)
        rec = {"code": code, "name": p.get("name"), "brand": p.get("brand")}
        if s0 is None or s1 is None:
            dropped.append({**rec, "why": "no lens grade"}); continue
        dl = s1 - s0
        if dl <= 0.02:
            dropped.append({**rec, "why": f"lens not improved (delta {dl:+.3f})"}); continue
        g = gate_fail(persona, p)
        if g:
            dropped.append({**rec, "why": g}); continue
        hd = health_deltas(item, p)
        if not any(h["better"] for h in hd):
            dropped.append({**rec, "why": "no OFF health field improves"}); continue
        kept.append({"alt": p, "lens_basket": s0, "lens_alt": s1, "lens_delta": round(dl, 4),
                     "lens_why_basket": why0, "lens_why_alt": why1, "health": hd})
    kept.sort(key=lambda c: -c["lens_delta"])
    return kept[:per_item], dropped + [{"code": c["alt"]["code"], "name": c["alt"].get("name"),
                                        "why": "outside top-%d lens delta for this item" % per_item} for c in kept[per_item:]]


# ------------------------------------------------------------------ Jev request
def card(p, other):
    if J:
        c = J.product_state(p, [p, other], True, None)
        # state the absence explicitly: an omitted field reads as "can't tell" (jaggedness #1 literal reading)
        if not p.get("sweeteners") and isinstance(p.get("sweeteners"), (int, float)):
            c.setdefault("back_of_pack", {})["sweeteners"] = "no sweeteners or polyols listed"
    else:
        c = {"name": p.get("name"), "brand": p.get("brand"), "pack_copy": (p.get("pack_copy") or "")[:220]}
    cl = claims_of(p)
    if cl:
        c["marketed_as"] = [c_.replace("_", " ") for c_ in cl]
    return c


def shopper(persona, cat_name, basket_names):
    trig = [t if isinstance(t, dict) else {"trigger": str(t)} for t in persona.get("rejection_triggers") or []][:8]
    if J:
        s = J.shopper_state(persona, persona.get("ocean") or {}, mission=persona.get("mission", "weekly_shop"),
                            budget_left=None, category=cat_name, on_mission=True, basket=basket_names)
        s["this_shelf"] = f"{cat_name.replace('_', ' ')} shelf; something from it is already in their basket"
        s.pop("time_at_shelf", None)
    else:
        s = {"who": (persona.get("dossier") or "")[:480], "mission": persona.get("mission")}
    s["put_offs"] = [str(t.get("trigger", ""))[:220] for t in trig]
    return s, trig


def build_request(persona, item, c, basket_names):
    alt = c["alt"]
    sh, trig = shopper(persona, item.get("category", ""), basket_names)
    pc = price_change(item, alt)
    better = [h["words"] for h in c["health"] if h["better"]]
    worse = [h["words"] for h in c["health"] if not h["better"]]
    state = {"shopper": sh, "basket_item": card(item, alt), "alternative": card(alt, item),
             "swap": {"better_on": better or ["nothing measurable"], "worse_on": worse or ["nothing measurable"],
                      "price_change": pc["words"]}}
    q = {
        "accept": {"type": "noul",
                   "instructions": ("`shopper` already has `basket_item` in their basket. A shelf tag or the store app "
                                    "suggests swapping it for `alternative`. Would `shopper` accept: put `basket_item` "
                                    "back and take `alternative` instead?"),
                   "criteria": {"true": "they make the swap on this trip",
                                "false": "they keep `basket_item` and ignore the suggestion"}},
        "benefit": {"type": "score",
                    "instructions": ("Judged against `shopper.priorities` and `shopper.put_offs`, how much real benefit "
                                     "does `shopper` see in `alternative` compared with `basket_item`?"),
                    "criteria": BENEFIT_LEVELS},
        "price_worth": {"type": "noul",
                        "instructions": ("Would `shopper` see `swap.price_change` as worth it for what `alternative` "
                                         "offers over `basket_item`?"),
                        "criteria": {"true": "the price difference feels fair or the swap saves money",
                                     "false": "the price difference feels like too much for what they get"}},
    }
    for k in range(len(trig)):
        for side in ("alternative", "basket_item"):
            q[f"{'alt' if side == 'alternative' else 'base'}_trig_{k}"] = {
                "type": "noul",
                # trigger text inlined, not referenced by path (jaggedness #4 indirection); judged on this product only
                "instructions": {"question": f"Judging only the product card `{side}` (its name, pack copy and "
                                             "back of pack), does this product itself have the put-off below?",
                                 "put_off": sh["put_offs"][k],
                                 **({"how_to_check": str(trig[k]["off_check"])[:200]} if trig[k].get("off_check") else {})},
                "criteria": {"true": f"`{side}` clearly has this put-off, based on what its card says",
                             "false": f"`{side}` does not have it, the put-off is about a different kind of product, "
                                      "or its card does not say enough to tell"}}
    # no Choice questions here, so no option order to shuffle (jaggedness #8); question order is shuffled
    # deterministically anyway so trigger questions don't always trail the headline judgment.
    keys = list(q)
    random.Random(f"{persona['id']}|{item['code']}|{alt['code']}").shuffle(keys)
    return state, {k: q[k] for k in keys}, trig, pc


def judge(persona, item, c, basket_names, dry=False):
    state, q, trig, pc = build_request(persona, item, c, basket_names)
    tag = f"swaps:{persona['id']}:{item['code']}->{c['alt']['code']}"
    if dry:
        return {"state": state, "questions": q, "price": pc, "dry": True}
    res = ask(state, q, tag=tag)
    A = res["answers"]
    usage = res.get("usage") or {}
    ben = A["benefit"]
    nouls = {}
    for k, t in enumerate(trig):
        nouls[f"trigger_{k}"] = {"text": str(t.get("trigger", ""))[:220], "source": t.get("source", ""),
                                 "p_alternative": round(float(A[f"alt_trig_{k}"]["noul"]), 4),
                                 "p_basket_item": round(float(A[f"base_trig_{k}"]["noul"]), 4)}
    p_acc = float(A["accept"]["noul"])
    fired = sorted([(v["p_alternative"], k) for k, v in nouls.items() if v["p_alternative"] > NOUL_FIRES], reverse=True)
    removed = [k for k, v in nouls.items() if v["p_basket_item"] > NOUL_FIRES >= v["p_alternative"]]
    verbs = []
    if J:
        for _, k in fired[:2]:
            v = J.verbatim_for(trig[int(k.split("_")[1])], persona)
            if v:
                verbs.append({"trigger": k, **v})
    return {
        "p_accept": round(p_acc, 4),
        "p_price_worth": round(float(A["price_worth"]["noul"]), 4),
        "benefit": {"score": round(float(ben["score"]), 3), "scale": "0..4", "levels": BENEFIT_LEVELS,
                    "probabilities": {str(k): round(float(v), 4) for k, v in (ben.get("probabilities") or {}).items()},
                    "confidence": ben.get("confidence")},
        "triggers": nouls,
        "refusal_reasons": [{"trigger": k, "p": p, "text": nouls[k]["text"], "source": nouls[k]["source"]} for p, k in fired],
        "triggers_removed_by_swap": [{"trigger": k, "text": nouls[k]["text"],
                                      "p_basket_item": nouls[k]["p_basket_item"], "p_alternative": nouls[k]["p_alternative"]}
                                     for k in removed],
        "verbatims": verbs,
        "request": {"engine": "jev", "jev_model": res.get("model", MODEL), "cache_key": res.get("cache_key"),
                    "cached": res.get("cached"), "input_tokens": usage.get("input_tokens"),
                    "output_tokens": usage.get("output_tokens"), "cost_usd": round(res.get("cost", 0.0), 8),
                    "cost_if_uncached_usd": round(cost_of(usage.get("input_tokens") or 0), 8),
                    "n_questions": len(q), "price_source": PRICE_SOURCE, "tag": tag},
        "state_sent": state,
    }


# ------------------------------------------------------------------ main swap run
def run_swaps(persona_id, codes, *, top=3, per_item=2, run_meta=None, dry=False, out_name=None):
    cat = load_catalog()
    persona = load_persona(persona_id)
    arch = persona["archetype"]
    missing = [c for c in codes if c not in cat]
    basket = [cat[c] for c in dict.fromkeys(codes) if c in cat]
    names = [p.get("name", "") for p in basket]
    premium = load_premium()
    considered, rows = [], []
    for item in basket:
        kept, dropped = candidates(persona, item, cat, per_item)
        considered.append({"basket_item": item["code"], "name": item.get("name"), "category": item.get("category"),
                           "lens_score": lens_score(item, arch)[0], "kept": [c["alt"]["code"] for c in kept],
                           "dropped": dropped})
        for c in kept:
            j = judge(persona, item, c, names, dry=dry)
            alt = c["alt"]
            pc = price_change(item, alt)
            rank = None if dry else round(j["p_accept"] * c["lens_delta"], 5)
            alt_claims = claims_of(alt)
            rows.append({
                "basket_item": {"code": item["code"], "name": item.get("name"), "brand": item.get("brand"),
                                "off_url": item.get("off_url"), "claims": claims_of(item)},
                "alternative": {"code": alt["code"], "name": alt.get("name"), "brand": alt.get("brand"),
                                "off_url": alt.get("off_url"), "role": alt.get("role"), "claims": alt_claims,
                                "image": alt.get("image")},
                "category": item.get("category"),
                "lens": {"archetype": arch, "basket": c["lens_basket"], "alternative": c["lens_alt"],
                         "delta": c["lens_delta"], "why_basket": c["lens_why_basket"], "why_alternative": c["lens_why_alt"],
                         "source": "catalog.json lens_grades[archetype] (computed from OFF fields; see `why`)"},
                "health_deltas": c["health"],
                "price": pc,
                "claim_premium_context": {cl: premium.get("catalog", {}).get(cl, {}).get("unit_price_premium_median_pct")
                                          for cl in alt_claims} if premium else None,
                "jev": j,
                "rank_score": rank,
                "rank_formula": "P(accept) [Jev Noul] x lens delta [code, catalog lens_grades]",
                "headline": headline(item, alt, c, pc, j),
            })
    rows.sort(key=lambda r: -(r["rank_score"] or 0))
    for i, r in enumerate(rows):
        r["rank"] = i + 1
    reqs = [r["jev"]["request"] for r in rows if "request" in r["jev"]]
    out = {
        "surface": "shopper_basket_swaps",
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "persona": {"id": persona["id"], "name": persona.get("name"), "archetype": arch,
                    "lens": persona.get("lens"), "rejection_triggers": persona.get("rejection_triggers")},
        "basket": [{"code": p["code"], "name": p.get("name"), "category": p.get("category"),
                    "price_gbp": p.get("price_gbp"), "lens_score": lens_score(p, arch)[0]} for p in basket],
        "basket_codes_missing_from_catalog": missing,
        "basket_source": run_meta or {"source": "--basket (CLI)"},
        "method": {
            "filter": ("same category; lens_grades[archetype] delta > 0.02; >=1 OFF health field improves by a "
                       "meaningful amount (fibre +1g, sugar -2g, protein +3g, salt -0.2g, additives/sweeteners/NOVA/"
                       f"palm oil -1, or gains organic); persona hard gates; top {per_item} per basket item by lens delta"),
            "thresholds_source": "assumption: minimum deltas a shopper would notice on a label; nutrient claim "
                                 "thresholds from " + REG_1924,
            "jev": "one fan-out request per swap: accept Noul, benefit Score, price_worth Noul, trigger Nouls on both "
                   "products (docs.typesafe.ai/patterns/fan-out.md, primitives/noul.md, primitives/score.md)",
            "numbers_to_words": "all deltas bucketed into words in code (docs model-jaggedness/jev-1.13 #2)",
            "rank": "P(accept) x lens delta",
            "price_caveat": "most catalog prices are curator assumptions (see price_sources per swap)",
        },
        "top": rows[:top],
        "all_swaps": rows,
        "considered": considered,
        "cost": {"jev_requests": len(reqs), "cached": sum(1 for r in reqs if r.get("cached")),
                 "input_tokens": sum(r.get("input_tokens") or 0 for r in reqs),
                 "output_tokens": sum(r.get("output_tokens") or 0 for r in reqs),
                 "usd": round(sum(r.get("cost_usd") or 0 for r in reqs), 8),
                 "usd_if_uncached": round(sum(r.get("cost_if_uncached_usd") or 0 for r in reqs), 8),
                 "price_source": PRICE_SOURCE},
    }
    if not dry:
        os.makedirs(OUT_DIR, exist_ok=True)
        tag = out_name or (run_meta or {}).get("run_id") or "basket"
        path = os.path.join(OUT_DIR, f"{persona['id']}_{tag}.json")
        json.dump(out, open(path, "w"), indent=1, ensure_ascii=False)
        out["_path"] = path
    return out


def headline(item, alt, c, pc, j) -> str:
    better = ", ".join([h["words"] for h in c["health"] if h["better"]][:4])
    s = f"swap {item.get('name')} -> {alt.get('name')}: {better}; {pc['words']}"
    if "p_accept" in j:
        s += f"; P(accept)={j['p_accept']:.2f}, lens +{c['lens_delta']:.2f}"
        if j["refusal_reasons"]:
            s += f"; main refusal risk: {j['refusal_reasons'][0]['text'][:70]} (p={j['refusal_reasons'][0]['p']:.2f})"
    return s


# ------------------------------------------------------------------ claim premium analysis (no Jev)
def load_premium():
    p = os.path.join(OUT_DIR, "claim_premium.json")
    if os.path.exists(p):
        try:
            return json.load(open(p))
        except Exception:
            return None
    return None


def _boot_ci(xs, n=2000, seed=7):
    if len(xs) < 3:
        return None
    r = random.Random(seed)
    meds = sorted(statistics.median(r.choice(xs) for _ in xs) for _ in range(n))
    return [round(meds[int(0.025 * n)], 1), round(meds[int(0.975 * n)], 1)]


def kcal(p):
    return num(p, "energy_kcal_100g", "energy-kcal_100g")


def meets(claim, p):
    """Reg 1924/2006 check on a product's own OFF nutrition. Returns (level, detail) or (None, reason)."""
    if claim == "fibre":
        f, k = num(p, "fiber_100g"), kcal(p)
        if f is None:
            return None, "fiber_100g missing"
        per100k = f / k * 100 if k else None
        hi = f >= 6 or (per100k is not None and per100k >= 3)
        src = f >= 3 or (per100k is not None and per100k >= 1.5)
        return ("high" if hi else "source" if src else "none"), f"fibre {f}g/100g" + (f", {per100k:.1f}g/100kcal" if per100k else "")
    if claim == "protein":
        g, k = num(p, "proteins_100g"), kcal(p)
        if g is None or not k:
            return None, "protein or kcal missing"
        sh = 4 * g / k
        return ("high" if sh >= 0.20 else "source" if sh >= 0.12 else "none"), f"protein {sh*100:.0f}% of energy"
    if claim == "no_added_sugar":
        s = num(p, "sugars_100g")
        if s is None:
            return None, "sugars missing"
        lim = 2.5 if p.get("category") in LIQUID else 5
        return ("low" if s <= lim else "not_low"), f"sugars {s}g/100g (context only: NAS is about ADDED sugar, not total)"
    return None, "no nutrient threshold for this claim"


def claim_premium(write=True):
    cat = list(load_catalog().values())
    res = {"created": time.strftime("%Y-%m-%dT%H:%M:%S"), "regulation": REG_1924,
           "claim_detection": {k: {"pack_copy_or_name_regex": v[0], "off_label_tags": list(v[1])} for k, v in CLAIMS.items()},
           "catalog": {}, "off_uk_pool": {}}
    n_assume = sum(1 for p in cat if str(p.get("price_source", "")).startswith("assumption"))
    res["catalog_price_caveat"] = (f"{n_assume}/{len(cat)} catalog prices are curator assumptions (price_source "
                                   "'assumption: ...'); the rest cite a retailer URL. Premiums inherit that uncertainty.")
    for cl in CLAIMS:
        per, shelf, rows, reality = [], [], [], []
        cats_used = set()
        for c in sorted({p["category"] for p in cat}):
            items = [p for p in cat if p["category"] == c]
            yes = [p for p in items if cl in claims_of(p)]
            no = [p for p in items if cl not in claims_of(p)]
            if not yes or not no:
                continue
            nu = [unit_price_100(p)[0] for p in no if unit_price_100(p)[0]]
            ns = [p["price_gbp"] for p in no if p.get("price_gbp")]
            mu, ms = (statistics.median(nu) if nu else None), statistics.median(ns)
            for p in yes:
                u = unit_price_100(p)[0]
                prem_u = (u / mu - 1) * 100 if u and mu else None
                prem_s = (p["price_gbp"] / ms - 1) * 100
                if prem_u is not None:
                    per.append(prem_u)
                shelf.append(prem_s)
                cats_used.add(c)
                lvl, det = meets(cl, p)
                rows.append({"code": p["code"], "name": p.get("name"), "category": c, "price_gbp": p["price_gbp"],
                             "price_source": p.get("price_source"), "unit_price_per_100": round(u, 4) if u else None,
                             "category_nonclaim_median_unit_price_per_100": round(mu, 4) if mu else None,
                             "unit_premium_pct": round(prem_u, 1) if prem_u is not None else None,
                             "shelf_premium_pct": round(prem_s, 1), "n_nonclaim_in_category": len(no),
                             "reg_1924_check": lvl, "nutrition": det, "off_url": p.get("off_url")})
                if lvl is not None:
                    reality.append(lvl)
        res["catalog"][cl] = {
            "n_claim_products": len(rows), "n_categories": len(cats_used),
            "unit_price_premium_median_pct": round(statistics.median(per), 1) if per else None,
            "unit_price_premium_ci95_bootstrap": _boot_ci(per), "n_unit": len(per),
            "shelf_price_premium_median_pct": round(statistics.median(shelf), 1) if shelf else None,
            "shelf_price_premium_ci95_bootstrap": _boot_ci(shelf),
            "share_claim_products_dearer_per_100": round(sum(1 for x in per if x > 0) / len(per), 3) if per else None,
            "reg_1924_reality": {lvl: reality.count(lvl) for lvl in sorted(set(reality))} if reality else None,
            "method": "per claim product: price / median price of same-category NON-claim products - 1; median over products",
            "products": rows,
        }
    res["off_uk_pool"] = pool_reality()
    if write:
        os.makedirs(OUT_DIR, exist_ok=True)
        json.dump(res, open(os.path.join(OUT_DIR, "claim_premium.json"), "w"), indent=1, ensure_ascii=False)
        open(os.path.join(OUT_DIR, "claim_premium.md"), "w").write(premium_md(res))
    return res


def pool_reality():
    try:
        import pandas as pd
    except Exception:
        return {"error": "pandas not installed"}
    d = pd.read_parquet(POOL)
    labels = d["labels"].fillna("").str.lower()
    name = d["name"].fillna("").str.lower()
    fib, prot, kc, sug = d["fiber_100g"], d["proteins_100g"], d["energy-kcal_100g"], d["sugars_100g"]
    out = {"source": f"Open Food Facts UK pool, {len(d)} products ({os.path.relpath(POOL, ROOT)}); no prices in OFF, "
                     "so the pool answers 'does the claim match the nutrition', not 'does it cost more'"}

    def lab(*tags):
        m = labels.str.contains("|".join(re.escape(t) for t in tags), regex=True)
        return m

    def fibre_lvl(mask):
        sub = d[mask & fib.notna()]
        f, k = sub["fiber_100g"], sub["energy-kcal_100g"]
        per = f / k.where(k > 0) * 100
        hi = (f >= 6) | (per >= 3)
        src = (f >= 3) | (per >= 1.5)
        return int(len(sub)), int(hi.sum()), int(src.sum()), int((f >= 6).sum())

    for key, tags, rx in (("high_fibre", ("en:high-fibres", "en:high-fibre"), r"high[ -]fib(?:re|er)"),
                          ("source_of_fibre", ("en:source-of-fibre",), r"source of fib(?:re|er)")):
        m = lab(*tags) | name.str.contains(rx, regex=True)
        n, hi, src, strict = fibre_lvl(m)
        need = hi if key == "high_fibre" else src
        out[key] = {"n_claim": int(m.sum()), "n_with_fibre_data": n, "n_meet_high_fibre": hi, "n_meet_source": src,
                    "n_meet_6g_per_100g_strict": strict, "share_6g_strict": round(strict / n, 3) if n else None,
                    "share_meeting_own_claim": round(need / n, 3) if n else None,
                    "claim_detection": f"labels {tags} or name ~ /{rx}/",
                    "threshold": "high: >=6g/100g or >=3g/100kcal; source: >=3g/100g or >=1.5g/100kcal (Reg 1924/2006)"}
    nonclaim = ~(lab("fibre", "fiber") | name.str.contains("fib(?:re|er)", regex=True))
    n, hi, src, strict = fibre_lvl(nonclaim)
    out["unclaimed_fibre"] = {"n_no_fibre_claim_with_fibre_data": n, "n_qualify_high_fibre_but_dont_say_so": hi,
                              "n_qualify_on_6g_per_100g_alone": strict,
                              "share": round(hi / n, 3) if n else None,
                              "note": "products that could truthfully carry a 'high fibre' claim but do not: the honest-claim lever sim/optimise.py uses"}
    m = lab("en:high-proteins", "en:high-protein") | name.str.contains(r"\bprotein\b", regex=True)
    sub = d[m & prot.notna() & (kc > 0)]
    sh = 4 * sub["proteins_100g"] / sub["energy-kcal_100g"]
    out["protein"] = {"n_claim": int(m.sum()), "n_with_data": int(len(sub)), "n_meet_high_protein_20pct": int((sh >= 0.2).sum()),
                      "n_meet_source_12pct": int((sh >= 0.12).sum()),
                      "share_meeting_high": round(float((sh >= 0.2).mean()), 3) if len(sub) else None,
                      "claim_detection": "labels en:high-proteins or name contains 'protein'",
                      "threshold": ">=20% energy from protein (high), >=12% (source)"}
    m = lab("en:no-added-sugar") | name.str.contains("no added sugar", regex=False)
    sub = d[m & sug.notna()]
    out["no_added_sugar"] = {"n_claim": int(m.sum()), "n_with_data": int(len(sub)),
                             "median_sugars_100g": round(float(sub["sugars_100g"].median()), 1) if len(sub) else None,
                             "share_low_sugar_5g": round(float((sub["sugars_100g"] <= 5).mean()), 3) if len(sub) else None,
                             "note": "NAS is about ADDED sugar; total sugar (e.g. fruit) can stay high legitimately"}
    m = lab("en:organic")
    out["organic"] = {"n_claim": int(m.sum()), "note": "no nutrient threshold; certification claim"}
    return out


def premium_md(r) -> str:
    L = ["# Do 'better-for-you' claims cost more?", "",
         f"Generated by `sim/swaps.py --claims` on {r['created']}. No LLM calls. Every number is from the code below the data.", "",
         f"**Price caveat:** {r['catalog_price_caveat']}", "",
         "## 1. Price premium in the catalogue (same category, claim vs no claim)", "",
         "Premium = product price / median price of the same-category products *without* the claim − 1, then the median across claim products. "
         "Unit price = price_gbp / OFF pack quantity × 100. CI = bootstrap 95% of the median.", "",
         "| claim | n products | categories | unit-price premium (median) | 95% CI | shelf-price premium | share dearer per 100g/ml | Reg 1924 check |",
         "|---|---|---|---|---|---|---|---|"]
    for cl, v in r["catalog"].items():
        L.append(f"| {cl.replace('_', ' ')} | {v['n_claim_products']} | {v['n_categories']} | "
                 f"{fmt(v['unit_price_premium_median_pct'])} (n={v['n_unit']}) | {v['unit_price_premium_ci95_bootstrap'] or 'n<3'} | "
                 f"{fmt(v['shelf_price_premium_median_pct'])} | {v['share_claim_products_dearer_per_100']} | {v['reg_1924_reality'] or '-'} |")
    L += ["", "## 2. Claim vs nutrition reality, OFF UK pool", "", f"Source: {r['off_uk_pool'].get('source')}", ""]
    p = r["off_uk_pool"]
    if "high_fibre" in p:
        h, s, u, pr, na = p["high_fibre"], p["source_of_fibre"], p["unclaimed_fibre"], p["protein"], p["no_added_sugar"]
        L += [f"- **'High fibre' claims**: {h['n_claim']} products; {h['n_with_fibre_data']} have fibre data; "
              f"{h['n_meet_high_fibre']} ({pct(h['share_meeting_own_claim'])}) meet the Reg 1924 test (≥6 g/100 g or ≥3 g/100 kcal); "
              f"on the strict ≥6 g/100 g test alone, {h['n_meet_6g_per_100g_strict']} ({pct(h['share_6g_strict'])}).",
              f"- **'Source of fibre' claims**: {s['n_claim']} products; {s['n_meet_source']}/{s['n_with_fibre_data']} "
              f"({pct(s['share_meeting_own_claim'])}) meet ≥3 g/100 g (or ≥1.5 g/100 kcal).",
              f"- **Unclaimed high fibre**: {u['n_qualify_high_fibre_but_dont_say_so']} of {u['n_no_fibre_claim_with_fibre_data']} "
              f"products with no fibre claim ({pct(u['share'])}) already qualify for 'high fibre' ({u['n_qualify_on_6g_per_100g_alone']} on ≥6 g/100 g alone; "
              "the rest pass only via the per-100 kcal route, e.g. low-calorie vegetables). These are honest-claim opportunities.",
              f"- **'Protein' claims (label or name)**: {pr['n_claim']} products; {pr['n_meet_high_protein_20pct']}/{pr['n_with_data']} "
              f"({pct(pr['share_meeting_high'])}) get ≥20% of energy from protein.",
              f"- **'No added sugar'**: {na['n_claim']} products; median total sugars {na['median_sugars_100g']} g/100 g; "
              f"{pct(na['share_low_sugar_5g'])} are also 'low sugar' (≤5 g). {na['note']}.",
              f"- **Organic**: {p['organic']['n_claim']} products labelled organic."]
    L += ["", "## 3. What this means for the swap surface", "",
          "- A swap to a *claim-marketed* product usually costs more. The swap card shows the price change in words and asks Jev "
          "whether this shopper thinks it is worth it (`p_price_worth`).",
          "- The cheaper route to better-for-you is often a product that already meets the threshold but doesn't market it. "
          "Code finds these from OFF nutrition, not from the pack copy.",
          "", f"Regulation: {r['regulation']}", "",
          "## Claim products (catalogue)", ""]
    for cl, v in r["catalog"].items():
        if not v["products"]:
            continue
        L.append(f"**{cl.replace('_', ' ')}**")
        for x in v["products"]:
            L.append(f"- {x['name']} ({x['category']}): £{x['price_gbp']:.2f}, unit premium {fmt(x['unit_premium_pct'])}, "
                     f"shelf premium {fmt(x['shelf_premium_pct'])}; {x['nutrition']} → {x['reg_1924_check']}; "
                     f"price: {str(x['price_source'])[:60]}; [OFF]({x['off_url']})")
        L.append("")
    return "\n".join(L) + "\n"


def fmt(x):
    return "n/a" if x is None else f"{x:+.0f}%"


def pct(x):
    return "n/a" if x is None else f"{x*100:.0f}%"


# ------------------------------------------------------------------ CLI
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--persona")
    ap.add_argument("--basket", help="comma-separated product codes")
    ap.add_argument("--from-run", help="run log json; basket = an agent's picks")
    ap.add_argument("--agent", help="agent_id inside --from-run")
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--per-item", type=int, default=2, help="candidates per basket item sent to Jev")
    ap.add_argument("--claims", action="store_true", help="(re)build claim_premium.json/.md")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--name", help="output suffix (default: run_id or 'basket')")
    a = ap.parse_args()
    if a.claims or not load_premium():
        r = claim_premium()
        for cl, v in r["catalog"].items():
            print(f"claim {cl:15s} n={v['n_claim_products']:2d} unit premium median {fmt(v['unit_price_premium_median_pct'])} "
                  f"CI {v['unit_price_premium_ci95_bootstrap']}  reality {v['reg_1924_reality']}")
        print("pool:", json.dumps({k: v for k, v in r["off_uk_pool"].items() if k != "source"})[:900])
        if a.claims and not (a.persona or a.from_run):
            return
    meta = None
    if a.from_run:
        pid, codes, meta = basket_from_run(a.from_run, a.persona, a.agent)
    elif a.persona and a.basket:
        pid, codes = a.persona, [c.strip() for c in a.basket.split(",") if c.strip()]
    else:
        ap.error("need --persona with --basket, or --from-run")
    out = run_swaps(pid, codes, top=a.top, per_item=a.per_item, run_meta=meta, dry=a.dry, out_name=a.name)
    print(f"persona {out['persona']['id']}  basket {len(out['basket'])} items  swaps judged {len(out['all_swaps'])}")
    for r in out["top"]:
        print(f" #{r['rank']} rank={r['rank_score']}  {r['headline']}")
    print("cost:", json.dumps(out["cost"]))
    if out.get("_path"):
        print("wrote", os.path.relpath(out["_path"], ROOT))


if __name__ == "__main__":
    main()

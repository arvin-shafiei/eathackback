"""Customer service: a real new shopper (unknown persona) -> profile -> next-visit route card.

Rule zero (README.md): every number names its source. Here that is an OFF field from data/products/catalog*.json,
a catalog lens_grades score (itself computed from OFF fields, with its `why` trail), a habit count (how many of the
shopper's visits held the item), a routes.py metre figure, or a labelled ASSUMPTION below.

Privacy (docs/data-collection.md:70, docs/ideas/personal-route-spec.md:40): glp1_small_appetite, allergen_coeliac
and vegan_ethical are special-category / belief lenses. They are NEVER inferred from a basket. They switch on only
when the customer declares them (declared.diet / declared.goals), and then they are shown as "declared", not as a
probability.

profile(body) -> persona guess (distribution + evidence), likes / avoids vs the store average, habits, plain-words
                 shopper sentence, a CONTRACT-shaped persona dict, and where each usual item sat (for "moved").
route_card(body) -> usual items with their CURRENT slot, an ordered short route (routes.route) with metres saved
                 vs walking every aisle, and one new item (not bought before, matches likes, gated by declared diet).

Default engine is "code" (free, no model). engine="jev" asks TypeSafe Jev one noul question per archetype and
refuses any non-TypeSafe backend (no OpenRouter fallback here).

    python3 sim/customer.py   # demo on a hand-picked basket
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import layout_optimise as LO  # noqa: E402
import routes  # noqa: E402
import run as simrun  # noqa: E402
import swaps  # noqa: E402

CUSTOMERS_DIR = os.path.join(ROOT, "data", "personas", "customers")
SENSITIVE = set(routes.SENSITIVE)  # declared only, never inferred

ASSUMPTIONS = {
    "temperature": {"value": 0.35, "note": "assumption: softmax temperature over per-archetype z-scores; picked so a "
                    "1-sd lead gives roughly a 2:1 to 3:1 odds ratio, not fitted to data"},
    "like_z": {"value": 0.5, "note": "assumption: a basket mean at least 0.5 store standard deviations from the store "
               "mean counts as a like / avoid"},
    "lens_floor": {"value": 0.3, "note": "assumption: an inferred lens drives the new-item pick only if its share is "
                   ">= 30%; otherwise the pick uses the likes only (spec abstain idea, τ lowered for 9 classes)"},
    "mission": {"value": "weekly_shop if the basket spans >= 4 categories, else top_up",
                "note": "assumption: rule of thumb, not measured"},
}

# OFF field -> (high words, low words, unit). high values become "likes", low values "avoids" (plain words).
FIELDS = [
    ("proteins_100g", "high protein", "low protein", "g/100g"),
    ("fiber_100g", "high fibre", "low fibre", "g/100g"),
    ("sugars_100g", "sugary things", "sugar", "g/100g"),
    ("salt_100g", "salty things", "salt", "g/100g"),
    ("additives_n", "lots of additives", "additives", "additives (OFF additives_n)"),
    ("sweeteners", "sweeteners", "sweeteners", "sweeteners (OFF)"),
    ("palm_oil_n", "palm oil", "palm oil", "palm-oil ingredients (OFF)"),
    ("nova", "ultra-processed food", "ultra-processed food", "NOVA group (OFF)"),
    ("nutri_n", "lower nutri-score", "lower nutri-score", "nutri-score a=1..e=5 (OFF nutriscore)"),
    ("unit_price", "pricier per 100g", "paying more per 100g", "£/100g (catalog price_gbp, an assumption, / OFF quantity)"),
    ("own_label", "own-label", "own-label", "share own-label (catalog role)"),
    ("challenger", "new challenger brands", "challenger brands", "share challenger (catalog role)"),
]
# low value of these is the good thing the shopper is choosing: say "likes low X" rather than "avoids X"? keep simple:
LOW_IS_AVOID = {"sugars_100g", "salt_100g", "additives_n", "sweeteners", "palm_oil_n", "nova", "nutri_n", "unit_price",
                "own_label", "challenger", "proteins_100g", "fiber_100g"}

DECLARE = {  # what a customer can tell us -> the lens it switches on (declared, never inferred)
    "vegan": {"lens": "vegan_ethical", "gate": "vegan"},
    "gluten_free": {"lens": "allergen_coeliac", "gate": "gluten_free"},
    "vegetarian": {"lens": None, "gate": None},
    "high_protein": {"lens": "protein_gym"},
    "save_money": {"lens": "frugal_unit_price"},
    "less_processed": {"lens": "upf_avoider_parent"},
    "eco": {"lens": "eco_low_chemical"},
    "small_portions": {"lens": "glp1_small_appetite"},
    "try_new": {"lens": "novelty_seeker_tiktok"},
}


# ---------------------------------------------------------------- helpers
def _num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except Exception:
        return None


def _grams(q):
    m = re.search(r"([\d.]+)\s*(kg|g|ml|l|cl)\b", str(q or "").lower())
    if not m:
        return None
    v = float(m.group(1))
    return v * {"kg": 1000, "g": 1, "ml": 1, "l": 1000, "cl": 10}[m.group(2)]


def feat(p, field):
    if field == "unit_price":
        g = _grams(p.get("quantity"))
        pr = _num(p.get("price_gbp"))
        return round(pr / g * 100, 4) if g and pr else None
    if field == "nutri_n":
        s = str(p.get("nutriscore") or "").lower()
        return "abcde".index(s) + 1 if s in ("a", "b", "c", "d", "e") else None
    if field == "own_label":
        return 1.0 if p.get("role") == "own_label" else 0.0
    if field == "challenger":
        return 1.0 if p.get("role") == "challenger" else 0.0
    return _num(p.get(field))


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def _sd(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def _name(p):
    return f"{p.get('brand') or ''} {p.get('name') or ''}".strip()


def env(body):
    """store + current planogram + catalog. Holds no lock: read-only."""
    store, store_src = simrun.load_store()
    plan, plan_src = simrun.load_planogram(body.get("planogram"))
    cat, cat_src = simrun.load_catalog(plan)
    for p in body.get("products") or []:  # brand uploads shown in the UI
        if isinstance(p, dict) and p.get("code"):
            cat.setdefault(str(p["code"]), p)
    on_shelf = [c for s in plan.values() for c in s.get("products", []) if c in cat]
    return {"store": store, "plan": plan, "catalog": cat, "on_shelf": list(dict.fromkeys(on_shelf)),
            "sources": {"store": store_src, "planogram": plan_src, "catalog": cat_src}}


def where_is(store, plan, code):
    pos = LO.positions(plan).get(code)
    if not pos:
        return None
    u = routes.units_by_id(store).get(pos["unit"]) or {}
    rn = (store.get("row_names") or {}).get(str(pos["row"]), str(pos["row"]))
    return {"slot": pos["slot"], "unit": pos["unit"], "aisle": u.get("aisle"), "side": u.get("side"),
            "row": pos["row"], "row_name": rn, "pos": pos["pos"]}


def _declared(body):
    d = body.get("declared") or {}
    keys = [str(x).strip().lower().replace("-", "_").replace(" ", "_") for x in (d.get("diet") or []) + (d.get("goals") or [])]
    return [k for k in dict.fromkeys(keys) if k in DECLARE]


# ---------------------------------------------------------------- 1. persona guess
def inferable_archetypes(cat_codes, catalog, declared_lenses):
    personas, _ = simrun.load_personas()
    have = set()
    for c in cat_codes:
        have |= set((catalog[c].get("lens_grades") or {}).keys())
    arch = sorted({p["archetype"] for p in personas if not p.get("custom")} & have)
    return [a for a in arch if a not in SENSITIVE], sorted(set(declared_lenses) & SENSITIVE), personas


def guess_code(basket, E, archetypes):
    """score_a = (basket mean lens_grades[a].score - store mean) / store sd, all over products on the current shelves;
    P(a) = softmax(score_a / T). T is a labelled assumption."""
    cat, shelf = E["catalog"], E["on_shelf"]
    T = ASSUMPTIONS["temperature"]["value"]
    rows = []
    for a in archetypes:
        g = lambda c: _num(((cat[c].get("lens_grades") or {}).get(a) or {}).get("score"))
        bs = [g(c) for c in basket]
        ss = [g(c) for c in shelf]
        bm, sm, sd = _mean(bs), _mean(ss), _sd(ss)
        if bm is None or sm is None or not sd:
            continue
        z = (bm - sm) / sd
        top = sorted([c for c in basket if g(c) is not None], key=lambda c: -g(c))[:2]
        rows.append({"archetype": a, "z": round(z, 3), "basket_mean": round(bm, 3), "store_mean": round(sm, 3),
                     "store_sd": round(sd, 3), "n_basket": len([x for x in bs if x is not None]),
                     "lens_words": routes.LENS_WORDS.get(a, a.replace("_", " ")),
                     "evidence": [{"code": c, "name": _name(cat[c]), "score": g(c),
                                   "why": (cat[c]["lens_grades"][a].get("why") or [])[:3]} for c in top]})
    mx = max((r["z"] for r in rows), default=0)
    ex = [math.exp((r["z"] - mx) / T) for r in rows]
    tot = sum(ex) or 1
    for r, e in zip(rows, ex):
        r["p"] = round(e / tot, 4)
    rows.sort(key=lambda r: -r["p"])
    return rows, {"engine": "code", "formula": "z_a = (mean basket lens_grades[a].score - mean store score) / store sd; "
                  "p_a = softmax(z_a / T)", "T": ASSUMPTIONS["temperature"],
                  "score_source": "catalog lens_grades[archetype].score (computed from OFF fields; each has a `why`)",
                  "store": f"{len(shelf)} products on the current planogram ({E['sources']['planogram']})",
                  "cost_usd": 0.0}


JEV_Q = {"type": "noul",
         "instructions": ("`basket` is everything one real shopper bought on their visits (product name, brand and Open "
                          "Food Facts fields). Does this basket look like it was chosen by someone who mainly shops for "
                          "`lens`?"),
         "criteria": {"true": "yes, the basket mostly fits that way of shopping", "false": "no, it does not"}}


def guess_jev(basket, E, archetypes):
    """One TypeSafe Jev noul per archetype; p normalised over archetypes. Refuses non-TypeSafe backends."""
    import jev
    if hasattr(jev, "_backend"):
        jev._backend["active"] = "typesafe"
    cat = E["catalog"]
    items = [{"name": _name(cat[c]), "category": cat[c].get("category"), "nova": cat[c].get("nova"),
              "additives_n": cat[c].get("additives_n"), "sugars_100g": cat[c].get("sugars_100g"),
              "proteins_100g": cat[c].get("proteins_100g"), "fiber_100g": cat[c].get("fiber_100g"),
              "role": cat[c].get("role"), "price_gbp": cat[c].get("price_gbp")} for c in basket]
    rows, cost = [], 0.0
    for a in archetypes:
        lens = routes.LENS_WORDS.get(a, a.replace("_", " "))
        r = jev.ask({"basket": items, "lens": lens}, {"fit": JEV_Q}, tag=f"customer:{a}")
        if r.get("backend", "typesafe") != "typesafe" or r.get("calibrated") is False:
            raise RuntimeError("non-TypeSafe backend answered; refused")
        p = float(r["answers"]["fit"]["noul"])
        cost += float(r.get("cost") or 0)
        rows.append({"archetype": a, "jev_p_fit": round(p, 4), "lens_words": lens, "cache_key": r.get("cache_key"),
                     "question": JEV_Q["instructions"], "evidence": []})
    tot = sum(r["jev_p_fit"] for r in rows) or 1
    for r in rows:
        r["p"] = round(r["jev_p_fit"] / tot, 4)
    rows.sort(key=lambda r: -r["p"])
    return rows, {"engine": "jev", "formula": "p_a = Jev P(fit | basket, lens_a) / sum over archetypes",
                  "question": JEV_Q, "cost_usd": round(cost, 5)}


# ---------------------------------------------------------------- likes / avoids
def likes_avoids(basket, E):
    cat, shelf = E["catalog"], E["on_shelf"]
    zmin = ASSUMPTIONS["like_z"]["value"]
    likes, avoids = [], []
    for f, hi, lo, unit in FIELDS:
        bv = [feat(cat[c], f) for c in basket]
        sv = [feat(cat[c], f) for c in shelf]
        bm, sm, sd = _mean(bv), _mean(sv), _sd(sv)
        if bm is None or sm is None or not sd:
            continue
        z = (bm - sm) / sd
        if abs(z) < zmin:
            continue
        fmt = (lambda x: f"{x * 100:.0f}%") if f in ("own_label", "challenger") else (lambda x: f"{x:.2f}" if f == "unit_price" else f"{x:.1f}")
        rec = {"field": f, "z": round(z, 2), "basket_mean": round(bm, 3), "store_mean": round(sm, 3),
               "n_basket": len([x for x in bv if x is not None]), "n_store": len([x for x in sv if x is not None]),
               "source": f"OFF/catalog field {f}; store = products on the current planogram; threshold {zmin} sd (assumption)"}
        if z > 0:
            rec["text"] = f"{hi} ({unit}: basket {fmt(bm)} vs store {fmt(sm)})"
            likes.append(rec)
        else:
            rec["text"] = f"{'low ' + lo if f not in ('own_label', 'challenger', 'sweeteners', 'palm_oil_n') else 'skips ' + lo} " \
                          f"({unit}: basket {fmt(bm)} vs store {fmt(sm)})"
            (avoids if f in LOW_IS_AVOID else likes).append(rec)
    likes.sort(key=lambda r: -abs(r["z"]))
    avoids.sort(key=lambda r: -abs(r["z"]))
    return likes, avoids


def habits_of(visits, catalog):
    n = len(visits)
    cnt = Counter(c for v in visits for c in set(v))
    return [{"code": c, "name": _name(catalog.get(c, {})), "visits": k, "of": n,
             "source": f"habit-log count: in {k} of {n} visits"} for c, k in cnt.most_common() if k >= 2 and c in catalog]


def mission_of(basket, catalog):
    cats = {catalog[c].get("category") for c in basket}
    return ("weekly_shop" if len(cats) >= 4 else "top_up"), sorted(c for c in cats if c)


def sentence(dist, likes, avoids, declared, habits, mission):
    bits = []
    top = [r for r in dist if r["p"] >= 0.15][:2]
    if top:
        bits.append("shops for " + " and ".join(r["lens_words"] for r in top))
    if likes:
        bits.append("leans to " + ", ".join(r["text"].split(" (")[0] for r in likes[:2]))
    if avoids:
        bits.append("goes light on " + ", ".join(r["text"].split(" (")[0].replace("low ", "").replace("skips ", "") for r in avoids[:2]))
    s = "; ".join(bits) or "not enough in the basket to say much yet"
    s = f"{'does a weekly shop' if mission == 'weekly_shop' else 'pops in for a top-up'}; {s}."
    if declared:
        s += f" told us: {', '.join(d.replace('_', ' ') for d in declared)}."
    if habits:
        s += f" buys {len(habits)} thing{'s' if len(habits) != 1 else ''} every time or most times."
    return s


def profile(body: dict) -> dict:
    E = env(body)
    cat = E["catalog"]
    basket = [str(c) for c in body.get("basket") or [] if str(c) in cat]
    unknown = [str(c) for c in body.get("basket") or [] if str(c) not in cat]
    visits = [[str(c) for c in v if str(c) in cat] for v in (body.get("visits") or []) if isinstance(v, list)]
    if not basket and visits:
        basket = visits[-1]
        visits = visits[:-1]
    if not basket:
        raise ValueError("basket is empty (or none of its codes are in the catalog)")
    all_visits = visits + [basket]
    seen = list(dict.fromkeys(c for v in all_visits for c in v))
    declared = _declared(body)
    declared_lenses = [DECLARE[d].get("lens") for d in declared if DECLARE[d].get("lens")]
    archs, sens_declared, personas = inferable_archetypes(E["on_shelf"] or list(cat), cat, declared_lenses)
    engine = body.get("engine") or "code"
    note = None
    if engine == "jev":
        try:
            dist, method = guess_jev(seen, E, archs)
        except Exception as e:  # noqa: BLE001
            note = f"jev unavailable ({str(e)[:140]}); used the free code path instead"
            dist, method = guess_code(seen, E, archs)
    else:
        dist, method = guess_code(seen, E, archs)
    if note:
        method["note"] = note
    method["inference_set"] = archs
    method["never_inferred"] = sorted(SENSITIVE)
    method["privacy"] = ("glp1, coeliac and vegan are special-category / belief lenses (UK GDPR Art. 9): never inferred "
                         "from a basket, only switched on when the customer declares them (docs/data-collection.md:70)")
    likes, avoids = likes_avoids(seen, E)
    habits = habits_of(all_visits, cat)
    mission, cats = mission_of(seen, cat)
    pmap = {p["archetype"]: p for p in personas if not p.get("custom")}
    top = dist[0] if dist else None
    base = pmap.get(top["archetype"]) if top else None
    spend = round(sum(_num(cat[c].get("price_gbp")) or 0 for c in basket), 2)
    cid = re.sub(r"[^a-z0-9_]+", "", str(body.get("id") or "")) or f"c_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}"
    lens = []
    tw = sum(abs(r["z"]) for r in (likes + avoids)[:5]) or 1
    for r in (likes + avoids)[:5]:
        lens.append({"attribute": r["text"].split(" (")[0], "off_field": r["field"],
                     "direction": "higher_better" if r["z"] > 0 else "lower_better",
                     "weight": round(abs(r["z"]) / tw, 4), "why": r["text"],
                     "source": f"basket inference: {r['n_basket']} basket items vs {r['n_store']} on shelf (z {r['z']})"})
    persona = {
        "id": f"p_customer_{cid}", "name": body.get("name") or "new customer",
        "archetype": top["archetype"] if top and top["p"] >= ASSUMPTIONS["lens_floor"]["value"] else "mixed",
        "archetype_source": f"basket inference ({method['engine']}): top share {top['p'] if top else 0}",
        "archetype_mix": {r["archetype"]: r["p"] for r in dist},
        "declared": declared, "declared_source": "the customer told us (explicit opt-in)",
        "mission": mission, "mission_source": f"basket inference: {len(cats)} categories ({ASSUMPTIONS['mission']['note']})",
        "budget_gbp": spend or None,
        "budget_source": f"basket inference: sum of catalog price_gbp over {len(basket)} items (prices are curator assumptions)",
        "channel": "instore",
        "ocean": (base or {}).get("ocean") or {k: 0.5 for k in "OCEAN"},
        "ocean_source": (f"borrowed from nearest archetype persona {base['id']} (assumption: a basket says nothing direct "
                         "about personality)") if base else "assumption: neutral 0.5",
        "lens": lens, "lens_note": "weights = |z| normalised over the top 5 likes/avoids (sim/customer.py)",
        "rejection_triggers": [{"trigger": r["text"].split(" (")[0], "source": "basket inference"} for r in avoids[:3]],
        "trust_signals": (base or {}).get("trust_signals") or [],
        "habits": [{"habit": f"buys {h['name']}", "code": h["code"], "source": h["source"]} for h in habits],
        "sim_params": (base or {}).get("sim_parameters") or {},
        "sim_params_sources": {"all": f"borrowed from {base['id']}" if base else "none"},
        "custom": True, "kind": "customer", "created": dt.datetime.now().isoformat(timespec="seconds"),
        "counts": {"visits": len(all_visits), "items_latest": len(basket), "distinct_items": len(seen)},
    }
    return {
        "id": cid,
        "persona_guess": {"distribution": dist, "method": method,
                          "declared_lenses": [{"lens": l, "words": routes.LENS_WORDS.get(l, l), "source": "declared by the customer"}
                                              for l in declared_lenses],
                          "sensitive_declared": sens_declared},
        "likes": likes, "avoids": avoids, "habits": habits, "declared": declared,
        "shopper_type": sentence(dist, likes, avoids, declared, habits, mission),
        "persona": persona,
        "basket": basket, "visits": all_visits, "unknown_codes": unknown,
        "seen_at": {c: where_is(E["store"], E["plan"], c) for c in seen},
        "seen_at_source": E["sources"]["planogram"],
        "sources": E["sources"], "assumptions": ASSUMPTIONS,
    }


def save(body: dict) -> dict:
    prof = body.get("profile") or profile(body)
    os.makedirs(CUSTOMERS_DIR, exist_ok=True)
    cid = re.sub(r"[^a-z0-9_]+", "", str(prof.get("id") or "")) or "customer"
    fp = os.path.join(CUSTOMERS_DIR, cid + ".json")
    with open(fp, "w") as f:
        json.dump(prof, f, indent=1, ensure_ascii=False)
    return {"ok": True, "file": os.path.relpath(fp, ROOT), "id": cid}


# ---------------------------------------------------------------- 2. next-visit card
def _gate(p, declared):
    for d in declared:
        g = DECLARE.get(d, {}).get("gate")
        if g == "vegan" and not swaps.vegan(p):
            return "declared vegan: not labelled vegan (OFF labels/analysis)"
        if g == "gluten_free" and swaps.gluten(p):
            return "declared gluten-free: declares gluten (OFF allergens)"
    return None


def _like_match(p, likes, avoids, E):
    """+1 per like the item sits on the same side of the store mean as the basket; same for avoids."""
    hits = []
    for r in likes + avoids:
        v = feat(p, r["field"])
        if v is None:
            continue
        if (r["z"] > 0 and v > r["store_mean"]) or (r["z"] < 0 and v < r["store_mean"]):
            hits.append(f"{r['text'].split(' (')[0]}: {r['field']}={round(v, 2)} vs store {round(r['store_mean'], 2)}")
    return hits


def route_card(body: dict) -> dict:
    prof = body.get("profile") or profile(body)
    E = env(body)
    store, plan, cat = E["store"], E["plan"], E["catalog"]
    declared = prof.get("declared") or []
    habits = prof.get("habits") or []
    usual_codes = [h["code"] for h in habits] or list(prof.get("basket") or [])
    usual_src = "habit-log (bought in >= 2 visits)" if habits else "only one visit so far: the latest basket"
    seen_at = prof.get("seen_at") or {}
    prev = body.get("prev_planogram")
    if prev:
        seen_at = {c: where_is(store, prev, c) for c in usual_codes}
    items = []
    for c in usual_codes:
        now = where_is(store, plan, c)
        was = seen_at.get(c)
        it = {"code": c, "name": _name(cat.get(c, {})), "now": now, "was": was}
        if not now:
            it["note"] = "not on the shelves in this layout"
        elif was and was.get("unit") != now["unit"]:
            it["note"] = (f"moved from aisle {was.get('aisle')} ({was['slot']}) to aisle {now['aisle']} ({now['slot']})"
                          if was.get("aisle") != now["aisle"] else
                          f"moved across aisle {now['aisle']}: {was['slot']} -> {now['slot']}")
        elif was and was.get("slot") != now["slot"]:
            it["note"] = f"same aisle, moved shelf: {was['slot']} -> {now['slot']}"
        items.append(it)
    units = sorted({i["now"]["unit"] for i in items if i["now"]})
    # new item: not bought before, on shelf, passes declared gates, non-HFSS where known, best lens/likes match
    seen = set(c for v in prof.get("visits") or [prof.get("basket") or []] for c in v)
    dist = (prof.get("persona_guess") or {}).get("distribution") or []
    lenses = [d["lens"] for d in (prof.get("persona_guess") or {}).get("declared_lenses") or []]
    src_lens = "declared"
    if not lenses and dist and dist[0]["p"] >= ASSUMPTIONS["lens_floor"]["value"]:
        lenses, src_lens = [dist[0]["archetype"]], f"inferred (share {dist[0]['p']})"
    likes, avoids = prof.get("likes") or [], prof.get("avoids") or []
    try:
        nut = LO.nutrition([c for c in E["on_shelf"] if c not in seen])
    except Exception:  # noqa: BLE001
        nut = {}
    cands, dropped = [], Counter()
    for c in E["on_shelf"]:
        if c in seen:
            continue
        p = cat[c]
        g = _gate(p, declared)
        if g:
            dropped[g] += 1
            continue
        try:
            hf = LO.hfss(p, nut.get(c))
            if hf.get("hfss"):
                dropped["HFSS (layout_optimise.hfss)"] += 1
                continue
        except Exception:  # noqa: BLE001
            hf = None
        hits = _like_match(p, likes, avoids, E)
        ls = [_num(((p.get("lens_grades") or {}).get(l) or {}).get("score")) for l in lenses]
        ls = [x for x in ls if x is not None]
        lens_score = sum(ls) / len(ls) if ls else 0.0
        pos = where_is(store, plan, c)
        on_route = bool(pos and pos["unit"] in units)
        score = lens_score + 0.1 * len(hits) + (0.05 if on_route else 0)
        cands.append((score, c, hits, lens_score, on_route, pos))
    cands.sort(key=lambda x: -x[0])
    new = None
    if cands and (lenses or cands[0][2]):
        score, c, hits, lscore, on_route, pos = cands[0]
        p = cat[c]
        why = []
        for l in lenses:
            g = (p.get("lens_grades") or {}).get(l) or {}
            why.append({"lens": l, "words": routes.LENS_WORDS.get(l, l), "score": g.get("score"), "why": g.get("why"),
                        "from": src_lens})
        new = {"code": c, "name": _name(p), "brand": p.get("brand"), "category": p.get("category"),
               "price_gbp": p.get("price_gbp"), "price_source": p.get("price_source"), "where": pos,
               "on_route": on_route, "detour": not on_route,
               "reason": "; ".join(([f"fits '{why[0]['words']}' ({why[0]['from']}; lens score {round(lscore, 2)}: {', '.join((why[0]['why'] or [])[:2])})"] if why else [])
                                + ([f"matches {', '.join(h.split(':')[0] for h in hits[:3])}"] if hits else [])),
               "lens": why, "matches_likes": hits,
               "gates_passed": [f"declared: {', '.join(declared)}" if declared else "no declared diet",
                                "not HFSS (layout_optimise.hfss)", "never bought before"],
               "rank": "score = mean lens_grades[lens].score + 0.1 per like matched + 0.05 if on the route (assumption weights)",
               "candidates": len(cands), "dropped": dict(dropped), "off_url": p.get("off_url")}
    route_units = sorted(set(units) | ({new["where"]["unit"]} if new and new.get("where") else set()))
    r = routes.route(store, route_units)
    all_units = [u["id"] for u in store["units"]]
    every = routes.metres_for_units(store, all_units)
    order = {s["unit"]: i for i, s in enumerate(r["stops"])}
    slots = []
    for s in r["stops"]:
        for i in items:
            if i["now"] and i["now"]["unit"] == s["unit"] and i["now"]["slot"] not in slots:
                slots.append(i["now"]["slot"])
        if new and new.get("where") and new["where"]["unit"] == s["unit"] and new["where"]["slot"] not in slots:
            slots.append(new["where"]["slot"])
    items.sort(key=lambda i: (order.get((i["now"] or {}).get("unit"), 99), (i["now"] or {}).get("slot", "")))
    ub = routes.units_by_id(store)
    stops = [{**s, "aisle": ub[s["unit"]]["aisle"], "category": routes.unit_majority(store, plan).get(s["unit"]),
              "items": [i["name"] for i in items if (i["now"] or {}).get("unit") == s["unit"]]
              + ([f"new: {new['name']}"] if new and (new.get("where") or {}).get("unit") == s["unit"] else [])}
             for s in r["stops"]]
    return {
        "usual": items, "usual_source": usual_src,
        "moved": [i for i in items if "moved" in (i.get("note") or "")],
        "route": {**r, "stops": stops, "every_aisle_metres": every,
                  "saved_metres": round(every - r["metres"], 2),
                  "saved_seconds": round((every - r["metres"]) / routes.WALK_SPEED, 1),
                  "every_aisle_source": f"routes.metres_for_units over all {len(all_units)} units"},
        "slots": slots,
        "new_item": new,
        "new_item_note": None if new else "no suggestion: no declared lens, no inferred lens above the floor and no like matched (abstain)",
        "sources": E["sources"], "assumptions": ASSUMPTIONS,
    }


def main():
    cat, _ = simrun.load_catalog()
    codes = list(cat)
    body = {"basket": codes[:2] + codes[20:22] + codes[40:42], "visits": [codes[:2] + codes[60:61]],
            "declared": {"diet": [], "goals": ["high_protein"]}}
    prof = profile(body)
    print(json.dumps({k: prof[k] for k in ("shopper_type", "likes", "avoids", "habits")}, indent=1)[:3000])
    print([(r["archetype"], r["p"]) for r in prof["persona_guess"]["distribution"]])
    card = route_card({"profile": prof, "planogram": "data/sim/layout/planogram_retailer.json"})
    print(json.dumps({k: card[k] for k in ("moved", "slots", "new_item")}, indent=1)[:3000])
    print(card["route"]["metres"], card["route"]["every_aisle_metres"])


if __name__ == "__main__":
    main()

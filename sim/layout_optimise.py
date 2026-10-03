"""Retailer surface: whole-store layout optimisation on a cheap, explainable surrogate.

Three stages per (shopper, product), the same funnel a brand sees on a real shelf:
    look      P(look | slot)          no LLM: sim/notice.py (literature-calibrated) x P(visit unit | route)
    pick up   P(pick_up | looked)     TypeSafe Jev Noul, asked ONCE per (persona, product), cached
    take      P(take | picked_up)     TypeSafe Jev Noul (speculative premise: "assume they picked it up")

E[value of layout] = sum_personas w_k * sum_products P(visit) * P(look|slot) * P(pick_up) * P(take) * price

Objectives (all normalised to the as-is store = 1.0):
    retailer : revenue/shopper  +  w_ch * challenger looks/shopper            (w_ch default 0.25, assumption)
    ease     : (1-w_f) * walk0/walk  +  w_f * found/found0                    (w_f default 0.3, assumption)
               walk  = expected metres to cover the persona's mission categories (entrance -> checkout)
               found = P(look) on the products that persona actually wants (want = P(pick_up)*P(take))
    blended  : (1-w) * retailer + w * ease                                    (--w-ease, default 0.5)

Constraints: category integrity per unit (unless --cross-merch), chilled categories stay in fridge units,
UK HFSS placement (Food (Promotion and Placement) (England) Regulations 2021, SI 2021/1368): no
"less healthy" in-scope product at store entrance, aisle ends (end-caps) or within 2 m of checkout in
stores >= 2,000 sq ft. HFSS status = UK 2004/05 Nutrient Profiling Model on OFF nutrition (APPROXIMATION).

Search: simulated annealing (seeded). CIs: persona-sampling bootstrap (paired before/after).

All arithmetic is in code; Jev only sees words (docs.typesafe.ai model-jaggedness: keep maths in code,
pre-bucket numbers, small focused state).

CLI:
    python3 sim/layout_optimise.py --surrogate-only               # build/refresh the Jev surrogate (cached)
    python3 sim/layout_optimise.py --objective all --iters 20000 --seed 1
    python3 sim/layout_optimise.py --objective blended --w-ease 0.7 --cross-merch
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import notice  # noqa: E402
import run as simrun  # noqa: E402  (loaders + MISSION_CATEGORIES; import only, never edited)

OUT_DIR = os.path.join(ROOT, "data", "sim", "layout")
SURROGATE_PATH = os.path.join(OUT_DIR, "surrogate.json")
NUTRITION_PATH = os.path.join(OUT_DIR, "nutrition_off.json")

# ---------------------------------------------------------------- assumptions (every one carries a source)
PARAMS = {
    "p_visit_mission": {"value": 1.0, "source": "assumption: a shopper walks every unit holding a category on their mission (same rule as sim/run.py)"},
    "p_visit_passby": {"value": 0.5, "source": "assumption: off-mission units that face a walkway the shopper is already walking get scanned more than units needing a detour; midpoint between browse (0.25) and mission (1.0). Direction: Sorensen 2009 'Inside the Mind of the Shopper' path tracking (shoppers cover a minority of the store, mostly along their route)"},
    "p_visit_detour": {"value": None, "source": "sim/coefficients.json browse_prob (filled at load)"},
    "endcap_notice_ratio": {"value": 1.5, "source": "assumption: end-cap location-only noticing uplift. research/04 section 1: end caps 2-5x baseline WITH a promotion, much of it from the promotion, so we take a location-only ratio below the low end"},
    "walk_speed_mps": {"value": 1.3, "source": "web/src/layout.ts G.walkSpeed (assumption: in-store walking slower than ~1.4 m/s street pace)"},
    "w_challenger": {"value": 0.25, "source": "assumption: retailer weight on challenger exposure relative to revenue (user-tunable --w-challenger)"},
    "w_found": {"value": 0.3, "source": "assumption: weight of 'wanted products are where they look' vs walking distance in the shopper-ease objective (--w-found)"},
    "persona_weight": {"value": "equal", "source": "assumption: each of the 12 lens archetypes weighs the same; only 2 personas carry a population_weight, so we do not mix weighted and unweighted"},
    "chilled_categories": {"value": ["yoghurt", "plant_milk_dairy_alt", "ready_meals_soup"], "source": "assumption: yoghurt and chilled ready meals/soup are chilled lines; plant milk treated as chilled (fresh oat/soy) although UHT versions exist"},
    "reset_tolerance": {"value": 0.0005, "source": "assumption: a move must lift the normalised objective by more than 0.05% to be worth the labour of a shelf reset; smaller changes are reverted after annealing"},
    "fridge_units": {"value": None, "source": "store.config.json units[].fridge if present, else assumption: the units that hold chilled categories in the as-built planogram are the fridges"},
}

GEOM = {  # web/src/layout.ts G (metres); kept identical so the 3D store and this optimiser agree
    "spacing": 5.0, "depth": 1.0, "unitLen": 6.4, "zCentre": 10.0, "crossGap": 2.4, "endcapDepth": 0.7,
    "source": "web/src/layout.ts G (gondola spacing 5 m, unit length 6.4 m, cross-aisle gap 2.4 m)",
}

REGS = {
    "name": "The Food (Promotion and Placement) (England) Regulations 2021 (SI 2021/1368), placement in force 1 Oct 2022",
    "url": "https://www.legislation.gov.uk/uksi/2021/1368/contents/made",
    "guidance": "https://www.gov.uk/government/publications/restricting-promotions-of-products-high-in-fat-sugar-or-salt-by-location-and-by-volume-price",
    "rule": "in-scope 'less healthy' (HFSS) food/drink may not be placed at store entrances, aisle ends (end-caps) or within 2 m of a checkout/queue, for stores >= 2,000 sq ft (185.8 m2) run by businesses with 50+ employees",
    "employees_assumption": "assumption: operator has 50+ employees (a supermarket chain)",
}
NPM = {
    "name": "UK Nutrient Profiling Model 2004/05 (DH technical guidance 2011)",
    "url": "https://www.gov.uk/government/publications/the-nutrient-profiling-model",
    "less_healthy": "food score >= 4, drink score >= 1",
    "approximation": ("APPROXIMATION: fruit/veg/nut % unknown in OFF -> 0 points (conservative, makes more products HFSS); "
                      "missing fibre -> 0 points; drinks per 100 ml treated as per 100 g; sodium = salt/2.5"),
}
# Schedule 1 category mapping of our 8 store categories (approximation, flagged)
SCOPE = {
    "soft_drinks": ("added_sugar", "Sch.1 cat 1: soft drinks with added sugar"),
    "crisps_savoury": ("yes", "Sch.1 cat 2: savoury snacks"),
    "breakfast_cereal": ("yes", "Sch.1 cat 3: breakfast cereals"),
    "biscuits_chocolate": ("yes", "Sch.1 cat 4 confectionery / cat 8 sweet biscuits"),
    "snack_bars": ("yes", "Sch.1 cat 8: sweet biscuits and bars based on cereals (approximation: protein/nut bars treated as in scope)"),
    "yoghurt": ("added_sugar", "Sch.1 cat 11: yoghurts and fromage frais with added sugar"),
    "plant_milk_dairy_alt": ("added_sugar", "approximation: scope of milk-substitute drinks under cat 1 unclear; treated as in scope only with added sugar (conservative)"),
    "ready_meals_soup": ("not_soup", "Sch.1 cat 13: ready meals; soups not listed (approximation: name contains 'soup' -> out of scope)"),
}
LIQUIDS = {"soft_drinks", "plant_milk_dairy_alt"}
SUGAR_WORDS = ("sugar", "syrup", "dextrose", "glucose", "fructose", "sucrose", "honey", "agave", "molasses", "maltose", "treacle",
               "sukker", "sucre", "zucker", "azucar", "azúcar", "zucchero", "suiker", "socker")  # OFF text is sometimes non-English


def rel(p):
    return os.path.relpath(p, ROOT)


# ---------------------------------------------------------------- loading
def load_all(planogram_path=None):
    store, store_src = simrun.load_store()
    pp = planogram_path or os.path.join(ROOT, "data/store/planogram.json")
    plan = json.load(open(pp))
    catalog = {str(p["code"]): p for p in json.load(open(os.path.join(ROOT, "data/products/catalog.json")))}
    personas, psrc = simrun.load_personas()
    PARAMS["p_visit_detour"]["value"] = notice.coefficients()["browse_prob"]["value"]
    return store, plan, catalog, personas, {"store": store_src, "planogram": rel(pp), "catalog": "data/products/catalog.json",
                                            "personas": psrc}


def mission_cats(p):
    return list(p.get("mission_categories") or simrun.MISSION_CATEGORIES.get(p.get("mission", "weekly_shop"), []))


# ---------------------------------------------------------------- nutrition + HFSS (NPM 2004/05 approximation)
def nutrition(codes):
    cache = {}
    if os.path.exists(NUTRITION_PATH):
        cache = json.load(open(NUTRITION_PATH))
    missing = [c for c in codes if c not in cache]
    if missing:
        import pyarrow.compute as pc
        import pyarrow.parquet as pq
        t = pq.read_table(os.path.join(ROOT, "data/products/uk_products.parquet"),
                          columns=["code", "energy-kcal_100g", "fat_100g", "saturated-fat_100g", "sugars_100g",
                                   "salt_100g", "fiber_100g", "proteins_100g"])
        t = t.filter(pc.is_in(t["code"], value_set=__import__("pyarrow").array(missing)))
        for r in t.to_pylist():
            cache[str(r["code"])] = {k: r[k] for k in r if k != "code"}
        os.makedirs(OUT_DIR, exist_ok=True)
        json.dump(cache, open(NUTRITION_PATH, "w"), indent=1)
    return cache


def _pts(v, cuts):
    return sum(1 for c in cuts if v is not None and v > c)


def hfss(p, nut):
    """Returns dict with in_scope, npm score, components and sources."""
    n = dict(nut or {})
    def g(k, alt=None):
        v = n.get(k)
        if v is None and alt:
            v = p.get(alt)
        return float(v) if isinstance(v, (int, float)) else None
    kcal = g("energy-kcal_100g", "energy_kcal_100g")
    kj = kcal * 4.184 if kcal is not None else None
    sat, sug = g("saturated-fat_100g"), g("sugars_100g", "sugars_100g")
    salt, fib, pro = g("salt_100g", "salt_100g"), g("fiber_100g", "fiber_100g"), g("proteins_100g", "proteins_100g")
    na = salt / 2.5 * 1000 if salt is not None else None
    A = {"energy": _pts(kj, [335 * i for i in range(1, 11)]),
         "sat_fat": _pts(sat, list(range(1, 11))),
         "sugars": _pts(sug, [4.5, 9, 13.5, 18, 22.5, 27, 31, 36, 40, 45]),
         "sodium": _pts(na, [90 * i for i in range(1, 11)])}
    C = {"fvn": 0, "fibre": _pts(fib, [0.9, 1.9, 2.8, 3.7, 4.7]), "protein": _pts(pro, [1.6, 3.2, 4.8, 6.4, 8.0])}
    a, c = sum(A.values()), sum(C.values())
    score = a - c if a < 11 or C["fvn"] >= 5 else a - (C["fibre"] + C["fvn"])
    cat = p.get("category", "")
    liquid = cat in LIQUIDS
    less_healthy = score >= (1 if liquid else 4)
    rule, why = SCOPE.get(cat, ("no", "not a Schedule 1 category"))
    ing = (p.get("ingredients_text") or "").lower()
    added_sugar = any(w in ing for w in SUGAR_WORDS)
    in_scope = {"yes": True, "no": False, "added_sugar": added_sugar,
                "not_soup": "soup" not in (p.get("name") or "").lower()}[rule]
    missing = [k for k, v in {"energy": kj, "sat_fat": sat, "sugars": sug, "salt": salt}.items() if v is None]
    doubts = [f"missing {m}" for m in missing]
    if cat in ("crisps_savoury",) and salt is not None and salt < 0.05:
        doubts.append(f"implausible OFF salt_100g={salt} for a savoury snack (likely a data-entry error)")
    if rule == "added_sugar" and not ing.strip():
        doubts.append("no ingredients text to check for added sugar")
    # compliance is conservative: an in-scope product whose HFSS status we cannot trust is barred too
    barred = bool(in_scope and (less_healthy or doubts)) or (rule == "added_sugar" and not ing.strip() and less_healthy)
    return {"hfss": bool(in_scope and less_healthy), "uncertain": doubts, "barred_from_restricted": barred,
            "in_scope": in_scope, "scope_rule": why,
            "added_sugar_in_ingredients": added_sugar if rule == "added_sugar" else None,
            "npm_score": score, "threshold": 1 if liquid else 4, "A": A, "C": C,
            "inputs": {"kJ": round(kj, 1) if kj else kj, "sat_fat_g": sat, "sugars_g": sug, "sodium_mg": round(na, 1) if na else na,
                       "fibre_g": fib, "protein_g": pro},
            "missing_fields": missing,
            "source": f"OFF nutriments for {p.get('off_url', p.get('code'))} (data/products/uk_products.parquet); {NPM['name']}; {NPM['approximation']}"}


# ---------------------------------------------------------------- geometry
def gondola_x(store, aisle):
    return (aisle - (store["aisles"] + 1) / 2) * GEOM["spacing"]


def walkway_of(u):
    return u["aisle"] - 1 if u["side"] == "L" else u["aisle"]


def walkway_x(store, w):
    return gondola_x(store, 1) - GEOM["spacing"] / 2 + w * GEOM["spacing"]


def store_area_sqft(store):
    """Mirrors web/src/layout.ts storeBounds() (walls derived from the config)."""
    gx = abs(gondola_x(store, store["aisles"])) + GEOM["depth"] / 2
    n = max(3, min(8, store["aisles"]))
    pitch = 3.2
    co_half = abs(((0 - (n - 1) / 2) * pitch))
    half_x = max(gx + GEOM["spacing"] * 0.9, co_half + 3, 10)
    z0 = GEOM["zCentre"] - GEOM["unitLen"] / 2
    z1 = GEOM["zCentre"] + GEOM["unitLen"] / 2
    zmin = min(store["entrance"]["z"] - 1.4, z0 - GEOM["crossGap"] - 5)
    zmax = max(store["checkout"]["z"] + 3.6, z1 + GEOM["crossGap"] + 4)
    m2 = (2 * half_x) * (zmax - zmin)
    return m2 * 10.7639, {"w_m": 2 * half_x, "d_m": zmax - zmin, "m2": round(m2, 1),
                          "source": "store walls derived as in web/src/layout.ts storeBounds(); 1 m2 = 10.7639 sq ft"}


def walk_metres(store, walkways):
    """Entrance -> cover every walkway in the set -> checkout. A walkway costs its full length either way
    (traverse = out-and-back to the unit centre = unitLen + 2*crossGap), so the shopper can always end on
    the checkout side; lateral cost is the x-span including the entrance/checkout x."""
    if not walkways:
        return 0.0
    xs = [walkway_x(store, w) for w in walkways]
    ex = store["entrance"]["x"]
    z0 = GEOM["zCentre"] - GEOM["unitLen"] / 2 - GEOM["crossGap"]
    z1 = GEOM["zCentre"] + GEOM["unitLen"] / 2 + GEOM["crossGap"]
    in_out = (z0 - store["entrance"]["z"]) + (store["checkout"]["z"] - z1)
    per = GEOM["unitLen"] + 2 * GEOM["crossGap"]
    lateral = 2 * (max(max(xs), ex) - min(min(xs), ex))
    return in_out + per * len(set(walkways)) + lateral


def endcap_sites(store):
    sites = []
    for a in range(1, store["aisles"] + 1):
        for end in ("front", "back"):
            sites.append({"id": f"E{a}{'F' if end == 'front' else 'B'}", "aisle": a, "end": end, "x": gondola_x(store, a)})
    return sites


def restricted_slots(store, plan):
    """Slots within 2 m of entrance or checkout (none in this store: gondolas start 8.8 m from the entrance)."""
    out = {}
    z0 = GEOM["zCentre"] - GEOM["unitLen"] / 2
    z1 = GEOM["zCentre"] + GEOM["unitLen"] / 2
    for u in store["units"]:
        x = gondola_x(store, u["aisle"])
        d_ent = math.hypot(x - store["entrance"]["x"], max(0, z0 - store["entrance"]["z"]))
        d_co = math.hypot(x - store["checkout"]["x"], max(0, store["checkout"]["z"] - z1))
        if d_ent <= 2 or d_co <= 2:
            out[u["id"]] = {"d_entrance_m": round(d_ent, 1), "d_checkout_m": round(d_co, 1)}
    return out


# ---------------------------------------------------------------- Jev surrogate
PICKUP_Q = {"type": "noul",
            "instructions": ("`shopper` has just noticed `product` on the shelf, during `shopper.time_at_shelf`. "
                             "Do they reach out and pick it up off the shelf (to look closer or to buy it)?"),
            "criteria": {"true": "they pick it up", "false": "they glance at it and leave it on the shelf"}}
TAKE_Q = {"type": "noul",
          "instructions": ("Assume `shopper` has already picked `product` up and is holding it. Do they keep it and put "
                           "it in their basket, rather than putting it back on the shelf?"),
          "criteria": {"true": "it goes in the basket", "false": "they put it back on the shelf"}}


def surrogate_request(persona, prod, set_items, reads_labels):
    import jev
    mcats = mission_cats(persona)
    cat = prod["category"]
    shopper = jev.shopper_state(persona, persona["ocean"], mission=persona.get("mission", "weekly_shop"),
                                budget_left=persona.get("budget_gbp"), category=cat, on_mission=cat in mcats, basket=[])
    card = jev.product_state(prod, set_items, reads_labels, persona.get("budget_gbp"))
    state = {"shopper": shopper, "product": card}
    qs = {"pick_up": PICKUP_Q, "take": TAKE_Q}
    res = jev.ask(state, qs, tag=f"layout_surrogate:{persona['id']}:{prod['code']}:{'read' if reads_labels else 'front'}")
    A = res["answers"]
    u = res.get("usage", {}) or {}
    return {"p_pick_up": round(float(A["pick_up"]["noul"]), 4), "p_take": round(float(A["take"]["noul"]), 4),
            "jev_model": res.get("model"), "cache_key": res["cache_key"], "cached": res["cached"],
            "input_tokens": u.get("input_tokens"), "cost_usd": res["cost"]}


def build_surrogate(personas, catalog, workers=16, force=False):
    import jev
    old = {}
    if os.path.exists(SURROGATE_PATH) and not force:
        old = json.load(open(SURROGATE_PATH)).get("entries", {})
    by_cat = {}
    for p in catalog.values():
        by_cat.setdefault(p["category"], []).append(p)
    jobs = []
    for per in personas:
        for code, p in catalog.items():
            for rl in (False, True):
                k = f"{per['id']}|{code}|{'read' if rl else 'front'}"
                if k not in old:
                    jobs.append((k, per, p, rl))
    t0 = time.time()
    out = dict(old)
    errs = []
    def work(j):
        k, per, p, rl = j
        try:
            return k, surrogate_request(per, p, by_cat[p["category"]], rl)
        except Exception as e:  # noqa: BLE001
            return k, {"error": repr(e)[:200]}
    with ThreadPoolExecutor(workers) as ex:
        for k, r in ex.map(work, jobs):
            if "error" in r:
                errs.append((k, r["error"]))
            else:
                out[k] = r
    sc = jev.session_cost()
    doc = {"_doc": ("Per (persona, product, label-reading variant): Jev Noul P(pick_up | looked) and P(take | picked_up). "
                    "State = sim/jev.py shopper_state + product_state (numbers pre-bucketed into words). The mixture "
                    "P = p_read*P[read] + (1-p_read)*P[front] uses notice.p_reads_labels (Grunert et al. 2010 base 0.27)."),
           "questions": {"pick_up": PICKUP_Q, "take": TAKE_Q},
           "model": "jev-latest", "built": dt.datetime.now().isoformat(timespec="seconds"),
           "this_build": {"new_requests": len(jobs), "errors": errs[:20], "wall_s": round(time.time() - t0, 1), "session": sc},
           "entries": out}
    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(doc, open(SURROGATE_PATH, "w"), indent=0)
    return doc


def surrogate_table(personas, catalog, sur):
    """S[pid][code] = {pu, take, p_read, trace}"""
    S = {}
    for per in personas:
        pr = notice.p_reads_labels(per["ocean"], per.get("sim_parameters"))
        S[per["id"]] = {}
        for code in catalog:
            f = sur.get(f"{per['id']}|{code}|front")
            r = sur.get(f"{per['id']}|{code}|read")
            if not f or not r:
                continue
            pu = pr * r["p_pick_up"] + (1 - pr) * f["p_pick_up"]
            tk = pr * r["p_take"] + (1 - pr) * f["p_take"]
            S[per["id"]][code] = {"pu": pu, "take": tk, "p_read": pr,
                                  "trace": {"p_reads_labels": round(pr, 3),
                                            "front_of_pack": {"p_pick_up": f["p_pick_up"], "p_take": f["p_take"], "jev_cache": f["cache_key"][:16]},
                                            "with_back_of_pack": {"p_pick_up": r["p_pick_up"], "p_take": r["p_take"], "jev_cache": r["cache_key"][:16]},
                                            "jev_model": f.get("jev_model")}}
    return S


# ---------------------------------------------------------------- layout model
class Model:
    def __init__(self, store, catalog, personas, S, hf):
        self.store, self.catalog, self.personas, self.S, self.hf = store, catalog, personas, S, hf
        self.units = {u["id"]: u for u in store["units"]}
        self.walkway = {u["id"]: walkway_of(u) for u in store["units"]}
        self.rows = int(store.get("rows_per_unit", 3))
        self.pv = {k: PARAMS[k]["value"] for k in ("p_visit_mission", "p_visit_passby", "p_visit_detour")}
        self.mcats = {p["id"]: set(mission_cats(p)) for p in personas}
        self._pn = {}
        self.ec_sites = endcap_sites(store)

    def p_look(self, per, code, row, pos, n, facings):
        k = (per["id"], code, row, pos, n, facings)
        v = self._pn.get(k)
        if v is None:
            p = self.catalog[code]
            v, _ = notice.p_notice(row=row, facings=facings, pos=pos, n_in_set=n,
                                   on_mission=p["category"] in self.mcats[per["id"]], ocean=per["ocean"],
                                   role=p.get("role", ""), persona_params=per.get("sim_parameters"),
                                   nutriscore=p.get("nutriscore", ""), category=p["category"])
            self._pn[k] = v
        return v

    def notice_factors(self, per, code, row, pos, n, facings):
        p = self.catalog[code]
        return notice.p_notice(row=row, facings=facings, pos=pos, n_in_set=n,
                               on_mission=p["category"] in self.mcats[per["id"]], ocean=per["ocean"],
                               role=p.get("role", ""), persona_params=per.get("sim_parameters"),
                               nutriscore=p.get("nutriscore", ""), category=p["category"])[1]

    def unit_cats(self, plan):
        uc = {}
        for sid, s in plan.items():
            u = sid.split("-")[0]
            for c in s["products"]:
                uc.setdefault(u, set()).add(self.catalog[c]["category"])
        return uc

    def route(self, per, uc):
        m = self.mcats[per["id"]]
        mission_units = {u for u, cs in uc.items() if cs & m}
        ws = {self.walkway[u] for u in mission_units}
        visit = {}
        for u in self.units:
            if u in mission_units:
                visit[u] = (self.pv["p_visit_mission"], "mission")
            elif self.walkway[u] in ws:
                visit[u] = (self.pv["p_visit_passby"], "passby")
            else:
                visit[u] = (self.pv["p_visit_detour"], "detour")
        xs = [walkway_x(self.store, w) for w in ws] + [self.store["entrance"]["x"]]
        return {"mission_units": sorted(mission_units), "walkways": sorted(ws), "visit": visit,
                "walk_m": walk_metres(self.store, ws), "span": (min(xs), max(xs))}

    def evaluate(self, plan, endcaps=None, detail=False):
        """Per-persona metrics (+ per product/persona breakdown when detail)."""
        uc = self.unit_cats(plan)
        endcaps = endcaps or {}
        ec_by_code = {}
        for sid, code in endcaps.items():
            if code:
                ec_by_code.setdefault(code, []).append(sid)
        site = {s["id"]: s for s in self.ec_sites}
        res = {}
        prod_detail = {}
        for per in self.personas:
            pid = per["id"]
            Sp = self.S[pid]
            rt = self.route(per, uc)
            rev = takes = chal = 0.0
            want_look = want_tot = 0.0
            for sid, s in plan.items():
                u, r = sid.split("-")
                row = int(r[1:])
                v, vkind = rt["visit"][u]
                prods = s["products"]
                n = len(prods)
                for pos, code in enumerate(prods):
                    if code not in Sp:
                        continue
                    f = int((s.get("facings") or {}).get(code, 1))
                    pl = v * self.p_look(per, code, row, pos, n, f)
                    pe_parts = []
                    for eid in ec_by_code.get(code, ()):
                        e = site[eid]
                        ve = self.pv["p_visit_passby"] if rt["span"][0] <= e["x"] <= rt["span"][1] else self.pv["p_visit_detour"]
                        pe = min(0.95, PARAMS["endcap_notice_ratio"]["value"] * self.p_look(per, code, 2, 0, 1, f))
                        pe_parts.append(ve * pe)
                    pl_any = 1 - (1 - pl) * math.prod(1 - x for x in pe_parts)
                    sv = Sp[code]
                    t = pl_any * sv["pu"] * sv["take"]
                    price = float(self.catalog[code].get("price_gbp") or 0)
                    takes += t
                    rev += t * price
                    if self.catalog[code].get("role") == "challenger":
                        chal += pl_any
                    if self.catalog[code]["category"] in self.mcats[pid]:
                        w = sv["pu"] * sv["take"]
                        want_look += w * pl_any
                        want_tot += w
                    if detail:
                        d = prod_detail.setdefault(code, {})
                        d[pid] = {"p_visit": v, "visit_kind": vkind, "p_look_home": round(pl / v if v else 0, 4),
                                  "p_look_any": round(pl_any, 4), "p_pick_up": round(sv["pu"], 4), "p_take": round(sv["take"], 4),
                                  "e_take": round(t, 5), "e_rev": round(t * price, 5)}
            res[pid] = {"revenue": rev, "takes": takes, "challenger_looks": chal, "walk_m": rt["walk_m"],
                        "found": want_look / want_tot if want_tot else 0.0, "route": rt}
        return (res, prod_detail) if detail else res


def agg(res, pids):
    n = len(pids)
    m = {k: sum(res[p][k] for p in pids) / n for k in ("revenue", "takes", "challenger_looks", "walk_m", "found")}
    m["walk_s"] = m["walk_m"] / PARAMS["walk_speed_mps"]["value"]
    return m


def objective(m, base, name, w_ease, w_ch, w_found):
    retail = (m["revenue"] / base["revenue"] + w_ch * m["challenger_looks"] / base["challenger_looks"]) / (1 + w_ch)
    ease = (1 - w_found) * base["walk_m"] / m["walk_m"] + w_found * m["found"] / base["found"]
    if name == "retailer":
        return retail
    if name == "ease":
        return ease
    return (1 - w_ease) * retail + w_ease * ease


# ---------------------------------------------------------------- simulated annealing
def chilled_class(model, cat):
    return "chilled" if cat in PARAMS["chilled_categories"]["value"] else "ambient"


def unit_temp(store, plan, catalog):
    """fridge units: config flag if present, else where chilled categories sit now."""
    if any("fridge" in u for u in store["units"]):
        return {u["id"]: ("chilled" if u.get("fridge") else "ambient") for u in store["units"]}, "store.config.json units[].fridge"
    t = {}
    for u in store["units"]:
        cats = {catalog[c]["category"] for sid, s in plan.items() if sid.startswith(u["id"] + "-") for c in s["products"]}
        t[u["id"]] = "chilled" if cats & set(PARAMS["chilled_categories"]["value"]) else "ambient"
    return t, PARAMS["fridge_units"]["source"]


def anneal(model, plan0, temp, *, objective_name, iters, seed, w_ease, w_ch, w_found, cross_merch, n_endcaps,
           base_metrics, pids):
    tol = PARAMS["reset_tolerance"]["value"]
    rng = random.Random(f"layout|{objective_name}|{seed}")
    units = [u["id"] for u in model.store["units"]]
    rows = model.rows
    plan = json.loads(json.dumps(plan0))
    eligible = sorted(c for c in model.catalog if not model.hf[c]["barred_from_restricted"] and c in model.S[pids[0]])
    sites = [s["id"] for s in model.ec_sites][:n_endcaps]
    endcaps = {s: None for s in sites}

    def score(p, e):
        return objective(agg(model.evaluate(p, e), pids), base_metrics, objective_name, w_ease, w_ch, w_found)

    cur = score(plan, endcaps)
    best, best_plan, best_ec = cur, json.loads(json.dumps(plan)), dict(endcaps)
    T0, T1 = 0.02, 2e-5
    accepted = 0
    moves = ["unit_swap", "row_swap", "prod_swap"] + (["endcap"] if sites else []) + (["cross"] if cross_merch else [])
    for it in range(iters):
        T = T0 * (T1 / T0) ** (it / max(1, iters - 1))
        mv = rng.choice(moves)
        new = plan
        ne = endcaps
        if mv == "unit_swap":
            a, b = rng.sample(units, 2)
            if temp[a] != temp[b]:
                continue
            new = dict(plan)
            for r in range(1, rows + 1):
                new[f"{a}-r{r}"], new[f"{b}-r{r}"] = plan[f"{b}-r{r}"], plan[f"{a}-r{r}"]
        elif mv == "row_swap":
            u = rng.choice(units)
            r1, r2 = rng.sample(range(1, rows + 1), 2)
            new = dict(plan)
            new[f"{u}-r{r1}"], new[f"{u}-r{r2}"] = plan[f"{u}-r{r2}"], plan[f"{u}-r{r1}"]
        elif mv in ("prod_swap", "cross"):
            if mv == "prod_swap":
                u = rng.choice(units)
                s1, s2 = f"{u}-r{rng.randint(1, rows)}", f"{u}-r{rng.randint(1, rows)}"
            else:
                a, b = rng.sample(units, 2)
                if temp[a] != temp[b]:
                    continue
                s1, s2 = f"{a}-r{rng.randint(1, rows)}", f"{b}-r{rng.randint(1, rows)}"
            A, B = plan[s1], plan[s2]
            if not A["products"] or not B["products"]:
                continue
            i, j = rng.randrange(len(A["products"])), rng.randrange(len(B["products"]))
            if s1 == s2 and i == j:
                continue
            new = dict(plan)
            A2 = {"category": A["category"], "products": list(A["products"]), "facings": dict(A.get("facings") or {})}
            B2 = A2 if s1 == s2 else {"category": B["category"], "products": list(B["products"]), "facings": dict(B.get("facings") or {})}
            ca, cb = A2["products"][i], B2["products"][j]
            fa, fb = A2["facings"].get(ca, 1), B2["facings"].get(cb, 1)
            A2["products"][i], B2["products"][j] = cb, ca
            if s1 != s2:
                A2["facings"].pop(ca, None); B2["facings"].pop(cb, None)
                A2["facings"][cb] = fb; B2["facings"][ca] = fa
            new[s1], new[s2] = A2, B2
        elif mv == "endcap":
            s = rng.choice(sites)
            ne = dict(endcaps)
            on = set(v for v in endcaps.values() if v)
            choices = [c for c in eligible if c not in on] + [None]
            ne[s] = rng.choice(choices)
        sc = score(new, ne)
        if sc >= cur or rng.random() < math.exp((sc - cur) / T):
            plan, endcaps, cur = new, ne, sc
            accepted += 1
            if cur > best:
                best, best_plan, best_ec = cur, json.loads(json.dumps(plan)), dict(endcaps)
    best_plan, best_ec, n_rev = simplify(model, plan0, best_plan, best_ec, score, temp, tol)
    best = score(best_plan, best_ec)
    # slot category label = majority category (matters only with cross-merch)
    for sid, s in best_plan.items():
        cs = [model.catalog[c]["category"] for c in s["products"]]
        if cs:
            s["category"] = max(set(cs), key=cs.count)
    return best_plan, best_ec, {"iters": iters, "accepted": accepted, "best_objective": best, "seed": seed,
                                "simplify": {"reverted_changes": n_rev, "tolerance": tol, "source": PARAMS["reset_tolerance"]["source"]},
                                "schedule": f"geometric T {T0} -> {T1}", "moves": moves}


def simplify(model, plan0, plan, ec, score, temp, tol):
    """Undo every change that is not worth a shelf reset: try putting each unit / product back where it was
    in the as-is store; keep the revert if the objective drops by <= tol. Fewer moves = less reset labour."""
    plan = json.loads(json.dumps(plan))
    cur = score(plan, ec)
    reverted = 0
    rows = model.rows
    units = [u["id"] for u in model.store["units"]]
    def sig(p, u):
        return tuple(tuple(sorted(p[f"{u}-r{r}"]["products"])) for r in range(1, rows + 1))
    changed = True
    while changed:
        changed = False
        # whole units: find where each unit's original contents went and swap back
        orig_home = {}
        for u in units:
            cats0 = {model.catalog[c]["category"] for r in range(1, rows + 1) for c in plan0[f"{u}-r{r}"]["products"]}
            orig_home[u] = cats0
        for u in units:
            uc = model.unit_cats(plan)
            if uc.get(u) == orig_home[u]:
                continue
            v = next((w for w in units if uc.get(w) == orig_home[u]), None)
            if not v or temp[u] != temp[v]:
                continue
            new = dict(plan)
            for r in range(1, rows + 1):
                new[f"{u}-r{r}"], new[f"{v}-r{r}"] = plan[f"{v}-r{r}"], plan[f"{u}-r{r}"]
            sc = score(new, ec)
            if sc >= cur - tol:
                plan, cur, changed = new, sc, True
                reverted += 1
        # single products: swap each moved product with whatever now sits in its original place
        p0 = positions(plan0)
        for code, a in p0.items():
            b = positions(plan).get(code)
            if not b or (b["slot"].split("-")[1] == a["slot"].split("-")[1] and b["pos"] == a["pos"]
                         and model.unit_cats(plan).get(b["unit"]) == model.unit_cats(plan0).get(a["unit"])):
                continue
            # original (row, pos) inside the unit that now holds this category
            tgt_slot = f"{b['unit']}-{a['slot'].split('-')[1]}"
            if tgt_slot not in plan or a["pos"] >= len(plan[tgt_slot]["products"]):
                continue
            other = plan[tgt_slot]["products"][a["pos"]]
            if other == code:
                continue
            new = dict(plan)
            S1, S2 = b["slot"], tgt_slot
            A2 = {"category": plan[S1]["category"], "products": list(plan[S1]["products"]), "facings": dict(plan[S1].get("facings") or {})}
            B2 = A2 if S1 == S2 else {"category": plan[S2]["category"], "products": list(plan[S2]["products"]), "facings": dict(plan[S2].get("facings") or {})}
            i, j = b["pos"], a["pos"]
            fa, fb = A2["facings"].get(code, 1), B2["facings"].get(other, 1)
            A2["products"][i], B2["products"][j] = other, code
            if S1 != S2:
                A2["facings"].pop(code, None); B2["facings"].pop(other, None)
                A2["facings"][other] = fb; B2["facings"][code] = fa
            new[S1], new[S2] = A2, B2
            sc = score(new, ec)
            if sc >= cur - tol:
                plan, cur, changed = new, sc, True
                reverted += 1
    return plan, ec, reverted


# ---------------------------------------------------------------- bootstrap
def bootstrap(model, before, after, B=1000, seed=0):
    rng = random.Random(f"boot|{seed}")
    pids = list(before)
    keys = ("revenue", "takes", "challenger_looks", "walk_m", "found")
    draws = {k: {"before": [], "after": [], "delta": [], "rel": []} for k in keys}
    for _ in range(B):
        s = [rng.choice(pids) for _ in pids]
        for k in keys:
            b = sum(before[p][k] for p in s) / len(s)
            a = sum(after[p][k] for p in s) / len(s)
            draws[k]["before"].append(b); draws[k]["after"].append(a); draws[k]["delta"].append(a - b)
            draws[k]["rel"].append((a - b) / b if b else 0.0)
    def ci(xs):
        xs = sorted(xs)
        return [round(xs[int(0.025 * len(xs))], 5), round(xs[int(0.975 * len(xs)) - 1], 5)]
    out = {}
    for k in keys:
        b = sum(before[p][k] for p in pids) / len(pids)
        a = sum(after[p][k] for p in pids) / len(pids)
        out[k] = {"before": round(b, 5), "after": round(a, 5), "delta": round(a - b, 5),
                  "rel_change": round((a - b) / b, 4) if b else None,
                  "before_ci95": ci(draws[k]["before"]), "after_ci95": ci(draws[k]["after"]),
                  "delta_ci95": ci(draws[k]["delta"]), "rel_change_ci95": ci(draws[k]["rel"])}
    out["_method"] = (f"persona-sampling bootstrap: {B} resamples of the {len(pids)} archetypes with replacement, paired "
                      "(same resample scores both layouts); percentile 95% CI. Captures which shoppers walk in, not Jev sampling noise.")
    return out


# ---------------------------------------------------------------- diff + traces
ROWW = {1: "top", 2: "eye", 3: "bottom"}


def positions(plan):
    pos = {}
    for sid, s in plan.items():
        u, r = sid.split("-")
        n = len(s["products"])
        for i, c in enumerate(s["products"]):
            pos[c] = {"slot": sid, "unit": u, "row": int(r[1:]), "pos": i, "n": n,
                      "centrality": round(notice.centrality(i, n), 2), "facings": int((s.get("facings") or {}).get(c, 1))}
    return pos


def where(p):
    return f"{p['slot']} ({ROWW.get(p['row'], p['row'])}, {'centre' if p['centrality'] >= 0.5 else 'edge'})"


def build_diff(model, plan0, plan1, ec1, res0, det0, res1, det1, pids):
    out = []
    uc0, uc1 = model.unit_cats(plan0), model.unit_cats(plan1)
    n = len(pids)
    # category moves
    cat_unit0 = {c: u for u, cs in uc0.items() for c in cs}
    cat_unit1 = {}
    for u, cs in uc1.items():
        for c in cs:
            cat_unit1.setdefault(c, []).append(u)
    for cat, u0 in sorted(cat_unit0.items()):
        u1s = cat_unit1.get(cat, [])
        if u0 in u1s and len(u1s) == 1:
            continue
        aff = [p for p in model.personas if cat in model.mcats[p["id"]]]
        w0, w1 = model.walkway[u0], sorted({model.walkway[u] for u in u1s})
        shares = sorted({c for u in u1s for c in uc1[u] if c != cat} |
                        {c for u, cs in uc1.items() if model.walkway[u] in w1 and u not in u1s for c in cs})
        # leave-one-out: swap this category's unit back with whatever now sits in its old unit
        loo = None
        if len(u1s) == 1 and u1s[0] != u0:
            back = dict(plan1)
            for r in range(1, model.rows + 1):
                back[f"{u0}-r{r}"], back[f"{u1s[0]}-r{r}"] = plan1[f"{u1s[0]}-r{r}"], plan1[f"{u0}-r{r}"]
            mb, m1 = agg(model.evaluate(back, ec1), pids), agg(model.evaluate(plan1, ec1), pids)
            rb, r1 = model.evaluate(back, ec1), model.evaluate(plan1, ec1)
            loo = {"vs_swap_back": f"{cat} back in {u0} (swapping with {sorted(uc1[u0])})",
                   "d_revenue_per_shopper": round(m1["revenue"] - mb["revenue"], 4),
                   "d_challenger_looks": round(m1["challenger_looks"] - mb["challenger_looks"], 4),
                   "d_walk_m": round(m1["walk_m"] - mb["walk_m"], 2),
                   "d_found": round(m1["found"] - mb["found"], 4),
                   "per_persona_walk_delta_m": {p["id"]: round(r1[p["id"]]["walk_m"] - rb[p["id"]]["walk_m"], 1) for p in aff}}
        dw = [(p["id"], round(res1[p["id"]]["walk_m"] - res0[p["id"]]["walk_m"], 1)) for p in aff]
        if loo:
            why = (f"vs swapping it back: revenue {loo['d_revenue_per_shopper']*100:+.1f}p/shopper, challenger looks "
                   f"{loo['d_challenger_looks']:+.3f}, walk {loo['d_walk_m']:+.1f} m, wanted-products-seen {loo['d_found']*100:+.1f} pts "
                   f"({len(aff)} personas have {cat} on their mission)")
        else:
            why = f"{len(aff)} personas have {cat} on their mission"
        out.append({
            "kind": "category_move", "category": cat, "from": u0, "to": u1s,
            "text": (f"move {cat} from {u0} to {'/'.join(u1s)}: now faces walkway {w1} with {', '.join(shares) or 'nothing'}; " + why),
            "trace": {"walkway_before": w0, "walkways_after": w1, "leave_one_out": loo,
                      "per_persona_walk_delta_whole_layout_m": dw,
                      "missions": {p["id"]: sorted(model.mcats[p["id"]]) for p in aff},
                      "walk_model": "walk_metres(): entrance->each mission walkway (unitLen+2*crossGap each)->checkout, lateral span x2 (web/src/layout.ts geometry)",
                      "visit_model": {k: PARAMS[k] for k in ("p_visit_mission", "p_visit_passby", "p_visit_detour")},
                      "mission_source": simrun.MISSION_CATEGORIES.get("_source")}})
    # product moves
    p0, p1 = positions(plan0), positions(plan1)
    for code in sorted(p0, key=lambda c: c):
        a, b = p0[code], p1.get(code)
        if not b or (a["slot"] == b["slot"] and a["pos"] == b["pos"]):
            continue
        if a["row"] == b["row"] and a["pos"] == b["pos"] and a["n"] == b["n"] and \
                any(d.get("category") == model.catalog[code]["category"] for d in out):
            continue  # moved only because its whole category moved (covered by the category_move entry)
        prod = model.catalog[code]
        price = float(prod.get("price_gbp") or 0)
        d0, d1 = det0.get(code, {}), det1.get(code, {})
        er0 = sum(v["e_rev"] for v in d0.values()) / n
        er1 = sum(v["e_rev"] for v in d1.values()) / n
        et0 = sum(v["e_take"] for v in d0.values()) / n
        et1 = sum(v["e_take"] for v in d1.values()) / n
        lk0 = sum(v["p_look_any"] for v in d0.values()) / n
        lk1 = sum(v["p_look_any"] for v in d1.values()) / n
        top = sorted(d1, key=lambda pid: -(d1[pid]["e_take"] - d0.get(pid, {}).get("e_take", 0)))[:3]
        per_by_id = {p["id"]: p for p in model.personas}
        reasons = []
        if a["unit"] != b["unit"]:
            reasons.append(f"{prod['category']} sits in {b['unit']} now")
        if a["row"] != b["row"]:
            reasons.append(f"{ROWW[a['row']]} -> {ROWW[b['row']]} shelf")
        if a["centrality"] != b["centrality"]:
            reasons.append(f"{'edge' if a['centrality'] < 0.5 else 'centre'} -> {'edge' if b['centrality'] < 0.5 else 'centre'} of the set")
        tp = top[0] if top else None
        text = (f"move {prod['name']} ({prod.get('brand','')}, {prod.get('role','')}, £{price:.2f}) from {where(a)} to {where(b)} "
                f"because {', '.join(reasons) or 'set reordered'}: P(look) {lk0:.3f} -> {lk1:.3f} per shopper, "
                f"E[takes] {et0*100:.2f} -> {et1*100:.2f} per 100 shoppers (£{(er1-er0)*100:+.2f}/100 shoppers)")
        if tp:
            text += (f"; biggest gainer {tp}: P(pick up|look)={d1[tp]['p_pick_up']:.2f}, P(take|pick up)={d1[tp]['p_take']:.2f} (Jev)")
        out.append({
            "kind": "product_move", "code": code, "name": prod["name"], "from": a, "to": b, "text": text,
            "delta_rev_per_100": round((er1 - er0) * 100, 4), "delta_takes_per_100": round((et1 - et0) * 100, 4),
            "trace": {"price_gbp": price, "price_source": prod.get("price_source"), "off_url": prod.get("off_url"),
                      "per_persona_before": d0, "per_persona_after": d1,
                      "notice_factors_after_top": (model.notice_factors(per_by_id[tp], code, b["row"], b["pos"], b["n"], b["facings"])
                                                   if tp else None),
                      "jev_surrogate": {pid: model.S[pid][code]["trace"] for pid in top},
                      "formula": "E[take] = P(visit unit) * P(look|slot) * P(pick_up|look) * P(take|pick_up); E[rev] = E[take] * price"}})
    prod_moves = sorted([d for d in out if d["kind"] == "product_move"], key=lambda d: -abs(d["delta_rev_per_100"]))
    return [d for d in out if d["kind"] == "category_move"] + prod_moves


def endcap_report(model, plan, ec, pids):
    """Marginal value of putting each product on one front end-cap; shows which HFSS lines the regs hold back."""
    if not ec:
        return {}
    base = agg(model.evaluate(plan, {}), pids)
    site = next(iter(ec))
    vals = []
    for code in model.catalog:
        if code not in model.S[pids[0]]:
            continue
        m = agg(model.evaluate(plan, {site: code}), pids)
        vals.append((m["revenue"] - base["revenue"], code))
    vals.sort(reverse=True)
    top = []
    for v, c in vals[:12]:
        h = model.hf[c]
        top.append({"code": c, "name": model.catalog[c]["name"], "category": model.catalog[c]["category"],
                    "rev_gain_per_100_shoppers": round(v * 100, 3), "hfss": h["hfss"], "npm_score": h["npm_score"],
                    "allowed_on_endcap": not h["barred_from_restricted"],
                    "why": (f"HFSS (NPM {h['npm_score']} >= {h['threshold']}, {h['scope_rule']}) -> barred from aisle ends by SI 2021/1368"
                            if h["hfss"] else
                            f"in scope, NPM {h['npm_score']} but data doubtful ({'; '.join(h['uncertain'])}) -> barred conservatively"
                            if h["barred_from_restricted"] else
                            f"not HFSS (NPM {h['npm_score']} vs threshold {h['threshold']}; in_scope={h['in_scope']})")})
    return {"chosen": {s: (c and {"code": c, "name": model.catalog[c]["name"], "hfss": model.hf[c]["hfss"]}) for s, c in ec.items()},
            "top_candidates_single_endcap": top,
            "held_back_by_regs": [t for t in top if not t["allowed_on_endcap"]],
            "note": "end-caps are secondary feature locations (product also stays in its home slot); not part of the CONTRACT planogram, rendered separately"}


# ---------------------------------------------------------------- calibration cross-check vs run logs
def runlog_check(model):
    import glob
    emp = {}
    for f in glob.glob(os.path.join(ROOT, "data/sim/runs/run_*jev*.json")):
        r = json.load(open(f))
        for a in r.get("agents", []):
            pid = a.get("persona_id")
            for e in a.get("events", []):
                if e.get("noticed") and not e.get("secondary"):
                    d = emp.setdefault(pid, {"noticed": 0, "picked": 0, "sur": 0.0, "files": set()})
                    d["noticed"] += 1
                    d["picked"] += e.get("decision") == "pick"
                    sv = model.S.get(pid, {}).get(e.get("product"))
                    if sv:
                        d["sur"] += sv["pu"] * sv["take"]
                    d["files"].add(rel(f))
    out = {}
    for pid, d in emp.items():
        lo, hi = simrun.wilson(d["picked"], d["noticed"])
        out[pid] = {"runlog_pick_given_noticed": round(d["picked"] / d["noticed"], 3), "ci95": [lo, hi], "n": d["noticed"],
                    "surrogate_mean_pu_x_take": round(d["sur"] / d["noticed"], 3), "files": sorted(d["files"])}
    return {"_doc": ("Run logs hold slot-level Jev decisions (one Choice across the noticed set), not per-product P(pick_up), "
                     "so they cannot be reused directly; this compares their empirical pick|noticed rate with the surrogate's "
                     "P(pick_up)*P(take) on the same events. Surrogate > run log is expected: the slot Choice makes products "
                     "compete and allows 'walk past the whole shelf'."), "by_persona": out}


# ---------------------------------------------------------------- main
def run(args):
    t0 = time.time()
    store, plan0, catalog, personas, srcs = load_all(args.planogram)
    if args.personas:
        keep = set(args.personas.split(","))
        personas = [p for p in personas if p["id"] in keep or p["archetype"] in keep]
    import jev
    jev.set_max_usd(args.max_usd)
    sur = build_surrogate(personas, catalog, workers=args.workers)
    print(f"[surrogate] {len(sur['entries'])} entries; build: {json.dumps(sur['this_build'])}")
    if args.surrogate_only:
        return
    S = surrogate_table(personas, catalog, sur["entries"])
    nut = nutrition(list(catalog))
    hf = {c: hfss(p, nut.get(c)) for c, p in catalog.items()}
    sqft, area = store_area_sqft(store)
    regs_apply = sqft >= 2000
    model = Model(store, catalog, personas, S, hf)
    temp, temp_src = unit_temp(store, plan0, catalog)
    pids = [p["id"] for p in personas]
    n_ec = args.endcaps if regs_apply or args.endcaps else 0
    res0, det0 = model.evaluate(plan0, {}, detail=True)
    base = agg(res0, pids)
    objs = ["retailer", "ease", "blended"] if args.objective == "all" else [args.objective]
    os.makedirs(OUT_DIR, exist_ok=True)
    summary = {}
    for obj in objs:
        t1 = time.time()
        plan1, ec1, sa = anneal(model, plan0, temp, objective_name=obj, iters=args.iters, seed=args.seed,
                                w_ease=args.w_ease, w_ch=args.w_challenger, w_found=args.w_found,
                                cross_merch=args.cross_merch, n_endcaps=n_ec, base_metrics=base, pids=pids)
        res1, det1 = model.evaluate(plan1, ec1, detail=True)
        res1_noec = model.evaluate(plan1, {})
        m1 = agg(res1, pids)
        # compliance check on the final layout
        violations = [{"endcap": s, "code": c, "name": catalog[c]["name"]} for s, c in ec1.items() if c and hf[c]["barred_from_restricted"]]
        rs = restricted_slots(store, plan1)
        for u in rs:
            for sid, s in plan1.items():
                if sid.startswith(u + "-"):
                    violations += [{"slot": sid, "code": c} for c in s["products"] if hf[c]["barred_from_restricted"]]
        cat_ok = all(len({catalog[c]["category"] for c in s["products"]}) <= 1 for s in plan1.values())
        unit_ok = all(len(cs) == 1 for cs in model.unit_cats(plan1).values())
        fridge_ok = all((chilled_class(model, catalog[c]["category"]) == temp[sid.split("-")[0]])
                        for sid, s in plan1.items() for c in s["products"])
        diff = build_diff(model, plan0, plan1, ec1, res0, det0, res1, det1, pids)
        report = {
            "objective": obj, "created": dt.datetime.now().isoformat(timespec="seconds"),
            "objective_definition": {
                "retailer": "(rev/rev0 + w_ch * challenger_looks/challenger_looks0) / (1 + w_ch)",
                "ease": "(1-w_f) * walk0/walk + w_f * found/found0",
                "blended": "(1-w) * retailer + w * ease",
                "weights": {"w_ease": args.w_ease, "w_challenger": args.w_challenger, "w_found": args.w_found},
                "weight_sources": {k: PARAMS[k]["source"] for k in ("w_challenger", "w_found")} | {"w_ease": "user (--w-ease)"},
                "value_before": 1.0, "value_after": round(objective(m1, base, obj, args.w_ease, args.w_challenger, args.w_found), 5)},
            "metrics_units": {"revenue": "£ expected per shopper", "takes": "expected items per shopper",
                              "challenger_looks": "expected challenger products looked at per shopper",
                              "walk_m": "metres per shopper to cover mission categories", "found": "want-weighted P(look) on mission products (0-1)"},
            "metrics": bootstrap(model, res0, res1, B=args.boot, seed=args.seed),
            "metrics_layout_only_no_endcaps": bootstrap(model, res0, res1_noec, B=args.boot, seed=args.seed),
            "per_persona": {pid: {"before": {k: round(res0[pid][k], 4) for k in ("revenue", "takes", "challenger_looks", "walk_m", "found")}
                                  | {"route": {k: res0[pid]["route"][k] for k in ("mission_units", "walkways")}},
                                  "after": {k: round(res1[pid][k], 4) for k in ("revenue", "takes", "challenger_looks", "walk_m", "found")}
                                  | {"route": {k: res1[pid]["route"][k] for k in ("mission_units", "walkways")}},
                                  "mission": sorted(model.mcats[pid])} for pid in pids},
            "diff": diff,
            "endcaps": endcap_report(model, plan1, ec1, pids),
            "constraints": {
                "category_integrity_per_slot": cat_ok, "category_integrity_per_unit": unit_ok or args.cross_merch,
                "cross_merch_allowed": args.cross_merch,
                "chilled_in_fridge": fridge_ok, "fridge_units": [u for u, t in temp.items() if t == "chilled"], "fridge_source": temp_src,
                "hfss": {"regs": REGS, "store_area_sqft": round(sqft), "store_area": area, "applies": regs_apply,
                         "restricted_locations": {"endcaps": [s["id"] for s in model.ec_sites][:n_ec],
                                                  "slots_within_2m_of_entrance_or_checkout": rs},
                         "violations": violations, "compliant": not violations,
                         "hfss_products_in_catalog": sum(1 for h in hf.values() if h["hfss"]),
                         "barred_products_in_catalog": sum(1 for h in hf.values() if h["barred_from_restricted"]),
                         "method": NPM}},
            "search": sa | {"wall_s": round(time.time() - t1, 1)},
            "model": {"formula": "E[value] = sum_k w_k sum_i P(visit unit(i) | route_k) * P(look | slot) * P(pick_up) * P(take) * price_i",
                      "params": PARAMS, "geometry": GEOM, "notice": "sim/notice.py p_notice() with sim/coefficients.json",
                      "surrogate": rel(SURROGATE_PATH), "surrogate_questions": {"pick_up": PICKUP_Q, "take": TAKE_Q},
                      "inputs": srcs, "mission_categories": simrun.MISSION_CATEGORIES},
            "planogram": f"data/sim/layout/planogram_{obj}.json",
        }
        json.dump(plan1, open(os.path.join(OUT_DIR, f"planogram_{obj}.json"), "w"), indent=1)
        json.dump(report, open(os.path.join(OUT_DIR, f"report_{obj}.json"), "w"), indent=1)
        mm = report["metrics"]
        summary[obj] = {k: {"before": mm[k]["before"], "after": mm[k]["after"], "rel": mm[k]["rel_change"],
                            "rel_ci95": mm[k]["rel_change_ci95"]} for k in ("revenue", "challenger_looks", "walk_m", "found")}
        print(f"\n=== {obj}  objective 1.000 -> {report['objective_definition']['value_after']:.4f}  "
              f"({sa['iters']} iters, {report['search']['wall_s']} s)  compliant={not violations}")
        for k in ("revenue", "takes", "challenger_looks", "walk_m", "found"):
            x = mm[k]
            print(f"  {k:17s} {x['before']:.4f} -> {x['after']:.4f}  ({x['rel_change']*100:+.1f}%, 95% CI {x['rel_change_ci95'][0]*100:+.1f}..{x['rel_change_ci95'][1]*100:+.1f}%)")
        for d in diff[:6]:
            print("  -", d["text"][:260])
        print(f"  ({len(diff)} changes) -> data/sim/layout/planogram_{obj}.json, report_{obj}.json")
    chk = runlog_check(model)
    sc = jev.session_cost()
    meta = {"created": dt.datetime.now().isoformat(timespec="seconds"), "summary": summary, "runlog_check": chk,
            "jev_session": sc, "wall_s": round(time.time() - t0, 1),
            "cli": " ".join(sys.argv),
            "hfss_table": {c: {"name": catalog[c]["name"], **{k: hf[c][k] for k in ("hfss", "barred_from_restricted", "uncertain", "in_scope", "npm_score", "threshold", "A", "C", "inputs")}}
                           for c in catalog}}
    json.dump(meta, open(os.path.join(OUT_DIR, "summary.json"), "w"), indent=1)
    print(f"\njev session: {json.dumps(sc)}; wall {meta['wall_s']} s")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--objective", default="all", choices=["all", "retailer", "ease", "blended"])
    ap.add_argument("--planogram", default=None)
    ap.add_argument("--iters", type=int, default=6000)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--w-ease", type=float, default=0.5)
    ap.add_argument("--w-challenger", type=float, default=PARAMS["w_challenger"]["value"])
    ap.add_argument("--w-found", type=float, default=PARAMS["w_found"]["value"])
    ap.add_argument("--cross-merch", action="store_true", help="allow products to move between units of the same temperature")
    ap.add_argument("--endcaps", type=int, default=8, help="number of end-cap feature sites (max 2 per gondola)")
    ap.add_argument("--boot", type=int, default=1000)
    ap.add_argument("--personas", default="", help="comma list of persona ids/archetypes (default all)")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--max-usd", type=float, default=1.0, help="Jev session spend guard")
    ap.add_argument("--surrogate-only", action="store_true")
    run(ap.parse_args())


if __name__ == "__main__":
    main()

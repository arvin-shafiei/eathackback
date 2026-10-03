"""Aisle graph, shopper routes and the route card, all in code (no model calls).

Spec: docs/ideas/personal-route-spec.md sections 3 and 4.3-4.4.

Geometry is the layout optimiser's (sim/layout_optimise.py GEOM / walkway_of / walkway_x / walk_metres),
which mirrors the 3D scene (web/src/layout.ts), so a route here measures the same metres as the store view.

    python3 sim/routes.py --planogram data/sim/layout/planogram_retailer.json --units U2,U5,U7
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import layout_optimise as LO  # noqa: E402  (geometry + HFSS + diff helpers; import only)
import run as simrun  # noqa: E402  (loaders; import only)

SENSITIVE = ("glp1_small_appetite", "allergen_coeliac", "vegan_ethical")  # UK GDPR Art. 9: declared only
LENS_WORDS = {  # what the card says: the lens, never the label (spec section 1)
    "ai_delegator": "complete product info, familiar brands",
    "eco_low_chemical": "fewer additives, no palm oil",
    "frugal_unit_price": "best value per 100g",
    "habit_loyalist_shrinkflation_angry": "the brands you know, honest packs",
    "meal_deal_office": "quick grab, filling",
    "novelty_seeker_tiktok": "new and different",
    "protein_gym": "high protein",
    "protein_sceptic_gimmick_reactant": "no gimmick claims, fewer sweeteners",
    "upf_avoider_parent": "family shop: short ingredient lists",
    "glp1_small_appetite": "high fibre, small portions",
    "allergen_coeliac": "gluten free",
    "vegan_ethical": "vegan",
}
WALK_SPEED = LO.PARAMS["walk_speed_mps"]["value"]


# ---------------------------------------------------------------- store graph
def units_by_id(store):
    return {u["id"]: u for u in store["units"]}


def unit_categories(store, plan) -> dict:
    """unit -> set of categories its slots hold in THIS planogram (spec 2.2); store.config only as fallback."""
    out = {}
    rows = int(store.get("rows_per_unit", 3))
    for u in store["units"]:
        cats = set()
        for r in range(1, rows + 1):
            s = plan.get(f"{u['id']}-r{r}")
            if s and s.get("products"):
                cats.add(s.get("category") or u["category"])
        out[u["id"]] = cats or {u["category"]}
    return out


def unit_majority(store, plan) -> dict:
    """unit -> majority slot category (ties: alphabetical)."""
    out = {}
    rows = int(store.get("rows_per_unit", 3))
    for u in store["units"]:
        c = Counter((plan.get(f"{u['id']}-r{r}") or {}).get("category") or u["category"] for r in range(1, rows + 1))
        out[u["id"]] = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
    return out


def category_units(store, plan) -> dict:
    """category -> sorted units whose majority slot category it is."""
    out = {}
    for u, c in unit_majority(store, plan).items():
        out.setdefault(c, []).append(u)
    return {c: sorted(v) for c, v in out.items()}


def required_units(memory, plan, mission_cats, new_item=None, *, store=None, detour=False) -> list:
    """Units that CURRENTLY hold each mission category, plus the new item's unit only if it is already on the
    route (or, with detour=True, as the one allowed off-route unit). memory is unused for the units themselves
    (the card route is the correct one by construction); kept in the signature for the trace."""
    store = store or simrun.load_store()[0]
    cu = category_units(store, plan)
    units = sorted({u for c in mission_cats for u in cu.get(c, [])})
    if new_item:
        pos = LO.positions(plan).get(new_item)
        if pos and (pos["unit"] in units or detour):
            units = sorted(set(units) | {pos["unit"]})
    return units


def route(store, units) -> dict:
    """Entrance -> the walkways the units face -> checkout.

    Exact search over sweep direction x entry end (2 x 2 cases for up to 5 walkways). The cost is
    layout_optimise.walk_metres, which charges each walkway its full length and the lateral span twice, so it
    is order-independent: every case costs the same and the search only fixes the stop ORDER (start at the end
    nearest the entrance; ascending x on ties). Metres are reported, never minimised against impulse spend
    (Hui et al. 2013)."""
    ub = units_by_id(store)
    units = [u for u in units if u in ub]
    walkways = sorted({LO.walkway_of(ub[u]) for u in units})
    if not walkways:
        return {"stops": [], "walkways": [], "metres": 0.0, "seconds": 0.0, "cases": 0}
    ex = store["entrance"]["x"]
    best = None
    cases = 0
    for direction, entry in itertools.product(("asc", "desc"), ("front", "back")):
        cases += 1
        order = walkways if direction == "asc" else walkways[::-1]
        m = LO.walk_metres(store, order)
        first_gap = abs(LO.walkway_x(store, order[0]) - ex)
        key = (round(m, 6), round(first_gap, 6), direction != "asc", entry != "front")
        if best is None or key < best[0]:
            best = (key, order, direction, entry, m)
    _, order, direction, entry, m = best
    z = LO.GEOM["zCentre"]  # every gondola is centred on the same z, so within a walkway units order by id
    stops = []
    for w in order:
        for u in sorted([u for u in units if LO.walkway_of(ub[u]) == w], key=lambda u: (z, u)):
            stops.append({"unit": u, "walkway": w, "x": round(LO.walkway_x(store, w), 2)})
    return {"stops": stops, "walkways": list(order), "metres": round(m, 2), "seconds": round(m / WALK_SPEED, 1),
            "sweep": direction, "entry": entry, "cases": cases,
            "source": "sim/layout_optimise.walk_metres (GEOM = web/src/layout.ts); seconds = metres / walk_speed_mps "
                      f"{WALK_SPEED} (layout_optimise.PARAMS)"}


def metres_for_units(store, units) -> float:
    ub = units_by_id(store)
    return round(LO.walk_metres(store, sorted({LO.walkway_of(ub[u]) for u in units if u in ub})), 2)


def moved(memory, plan, *, store=None, prev_plan=None) -> list:
    """Categories whose remembered unit (memory['cat_unit']) no longer holds them in `plan`."""
    store = store or simrun.load_store()[0]
    cu = category_units(store, plan)
    p0 = LO.positions(prev_plan) if prev_plan else {}
    p1 = LO.positions(plan)
    out = []
    for cat, u0 in sorted((memory.get("cat_unit") or {}).items()):
        now = cu.get(cat, [])
        if u0 in now or not now:
            continue
        rec = {"category": cat, "from_unit": u0, "to_unit": now[0], "to_units": now}
        codes = [c for c, v in p1.items() if v["unit"] in now]
        rec["slots"] = {c: {"from_slot": p0.get(c, {}).get("slot"), "to_slot": p1[c]["slot"]} for c in codes}
        out.append(rec)
    return out


# ---------------------------------------------------------------- card (spec 4.3 / 4.4)
def _off_field(why):
    for w in why or []:
        if "(OFF" in w and "=" in w:
            f, v = w.split("=", 1)
            v = v.split(" (")[0]
            try:
                v = float(v)
            except ValueError:
                pass
            return f.strip(), v
    return None, None


def diff_ref_for(report, category):
    for i, d in enumerate((report or {}).get("diff", [])):
        if d.get("kind") == "category_move" and d.get("category") == category:
            return f"report_retailer.json#diff[{i}]"
    return None


def card(agent_view, plan, posterior, new_skus, *, ctx) -> dict:
    """Build one route card in code.

    agent_view: {persona, memory, mission_cats, visit, declared_lens|None, declared_gates: bool, tau, detour}
    posterior: {lens: p} over the inference set (non-sensitive lenses + 'none') or None
    new_skus: [code] listed new SKUs
    ctx: {store, catalog, hfss, surrogate (S[pid][code]), report, prev_plan, persona_ids (archetype->id),
          route_card_logit, compliance, report_src}
    Returns the card with traced lines and the carded SKU (or None)."""
    store, catalog = ctx["store"], ctx["catalog"]
    per = agent_view["persona"]
    mem = agent_view["memory"]
    mcats = agent_view["mission_cats"]
    tau = agent_view.get("tau", 0.5)
    detour = bool(agent_view.get("detour"))
    nvis = len(mem.get("baskets", []))
    pos1 = LO.positions(plan)
    base_units = required_units(mem, plan, mcats, store=store)
    base_route = route(store, base_units)
    assumptions = [f"route_card_logit={ctx['route_card_logit']} (design.assumptions)",
                   f"compliance c={ctx.get('compliance', 0.2)} x reactance_k (post-processed)",
                   f"tau={tau} abstain threshold (assumption)"]
    lines = []
    # 1. usual items moved
    hab_visits = {c: v for c, v in mem.get("bought", {}).items() if any(x <= 2 for x in v)}
    for mv in moved(mem, plan, store=store, prev_plan=ctx.get("prev_plan")):
        if mv["category"] not in mcats:
            continue
        codes = sorted([c for c in hab_visits if catalog.get(c, {}).get("category") == mv["category"]],
                       key=lambda c: (-len(hab_visits[c]), c))
        if not codes:
            continue
        top = codes[0]
        sl = mv["slots"].get(top, {})
        tv = sorted(x for x in hab_visits[top] if x <= 2)
        lines.append({
            "kind": "moved", "code": top, "name": catalog[top].get("name"), "category": mv["category"],
            "from": {"unit": mv["from_unit"], "slot": sl.get("from_slot")},
            "to": {"unit": mv["to_unit"], "slot": sl.get("to_slot")},
            "also_usual": codes[1:],
            "reason": f"habit: taken {len(tv)}/{min(nvis, 2)} visits; moved {sl.get('from_slot')} -> {sl.get('to_slot')} "
                      f"in the retailer layout",
            "evidence": {"habit": {"taken_visits": tv, "of": min(nvis, 2)},
                         "layout_diff": {"source": ctx.get("report_src"), "diff_ref": diff_ref_for(ctx.get("report"), mv["category"])},
                         "route": {"walkways": base_route["walkways"], "metres": base_route["metres"], "detour_metres": 0.0}},
            "funded": False, "dismissable": True, "assumptions": assumptions,
            "_bought_n": len(hab_visits[top])})
    lines.sort(key=lambda l: (-l.pop("_bought_n"), l["category"]))
    # 2. at most one new item on the way
    declared = agent_view.get("declared_lens")
    post = dict(posterior or {})
    lens_src = "declared" if declared else "posterior"
    if declared:
        top_lens, top_p = declared, 1.0
        mix = {declared: 1.0}
    else:
        inf = {k: v for k, v in post.items() if k != "none"}
        top_lens, top_p = (max(inf.items(), key=lambda kv: kv[1]) if inf else (None, 0.0))
        mix = inf
    new_line, candidates, rejected = None, [], []
    abstain = (not declared) and (top_p < tau)
    if not abstain:
        on_route = set(base_units)
        for code in new_skus:
            p = catalog.get(code)
            ps = pos1.get(code)
            if not p or not ps:
                continue
            why_not = None
            detour_m = 0.0
            if ps["unit"] not in on_route:
                if detour:
                    detour_m = round(metres_for_units(store, sorted(on_route | {ps["unit"]})) - base_route["metres"], 2)
                else:
                    why_not = f"off route ({ps['unit']})"
            if not why_not and agent_view.get("declared_gates"):
                import swaps
                g = swaps.gate_fail(per, p)
                if g:
                    why_not = g
            hf = ctx["hfss"].get(code, {})
            if not why_not and (hf.get("hfss") or hf.get("barred_from_restricted")):
                why_not = "HFSS or HFSS-uncertain (layout_optimise.hfss, conservative)"
            g_score = ((p.get("lens_grades") or {}).get(top_lens) or {}).get("score")
            if not why_not and not (g_score and g_score > 0):
                why_not = f"lens_score({top_lens}) not > 0"
            if why_not:
                rejected.append({"code": code, "why": why_not})
                continue
            rank, pm = 0.0, {}
            for k, w in mix.items():
                pid = ctx["persona_ids"].get(k)
                s = (ctx["surrogate"].get(pid) or {}).get(code)
                if s is None:
                    continue
                pt = s["pu"] * s["take"]
                rank += w * pt
                pm[k] = round(w, 4)
            candidates.append({"code": code, "rank": round(rank, 5), "persona_mix": pm, "detour_m": detour_m,
                               "lens_score": g_score})
        candidates.sort(key=lambda c: (-c["rank"], c["code"]))
        if candidates:
            best = candidates[0]
            code = best["code"]
            p = catalog[code]
            why = ((p.get("lens_grades") or {}).get(top_lens) or {}).get("why", [])
            f, v = _off_field(why)
            sur = (ctx["surrogate"].get(ctx["persona_ids"].get(top_lens)) or {}).get(code) or {}
            r_units = sorted(set(base_units) | {pos1[code]["unit"]})
            rt = route(store, r_units)
            new_line = {
                "kind": "new", "code": code, "name": p.get("name"), "category": p.get("category"),
                "from": None, "to": {"unit": pos1[code]["unit"], "slot": pos1[code]["slot"]},
                "reason": f"new on your way: matches your picks ({LENS_WORDS.get(top_lens, top_lens)})"
                          + (f"; OFF {f}={v}" if f else "") + f"; P(take)={best['rank']:.2f} (sim estimate)",
                "evidence": {
                    "lens": {"lens": top_lens, "lens_words": LENS_WORDS.get(top_lens), "from": lens_src,
                             "posterior_p": round(top_p, 4), "lens_score": best["lens_score"],
                             "off_field": f, "off_value": v, "off_url": p.get("off_url")},
                    "p_take": {"value": best["rank"], "definition": "sum_k posterior(k) * P(pick_up|looked) * P(take|picked_up)",
                               "source": "data/sim/layout/surrogate.json",
                               "jev_cache_key": (sur.get("trace") or {}).get("front_of_pack", {}).get("jev_cache"),
                               "persona_mix": best["persona_mix"]},
                    "gates_passed": (["declared gates (sim/swaps.gate_fail)"] if agent_view.get("declared_gates") else [])
                                    + ["non-HFSS (layout_optimise.hfss, conservative)", f"lens_score({top_lens}) > 0"],
                    "route": {"walkways": rt["walkways"], "metres": rt["metres"], "detour_metres": best["detour_m"]},
                    "candidates_ranked": [{"code": c["code"], "rank": c["rank"]} for c in candidates[:5]],
                    "rejected": rejected},
                "funded": False, "dismissable": True, "assumptions": assumptions}
    view_post = {k: round(v, 4) for k, v in post.items()}
    return {"visit": agent_view.get("visit"), "lines": lines + ([new_line] if new_line else []),
            "carded_sku": new_line["code"] if new_line else None,
            "abstained_new_item": bool(abstain),
            "abstain_reason": (f"max posterior {top_p:.2f} < tau {tau} and no declared lens" if abstain else None),
            "no_candidate": (not abstain and new_line is None),
            "route": route(store, sorted(set(base_units) | ({pos1[new_line['code']]['unit']} if new_line else set()))),
            "posterior": {"distribution": view_post, "lens_from": lens_src, "declared_lens": declared,
                          "declared_only_greyed": list(SENSITIVE)},
            "framing": "an offer, never a task; skip is one tap; no price field; funded: false",
            "price_field": None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--planogram", default="data/store/planogram.json")
    ap.add_argument("--units", required=True)
    a = ap.parse_args()
    store, _ = simrun.load_store()
    plan = json.load(open(os.path.join(ROOT, a.planogram)))
    units = [u.strip() for u in a.units.split(",") if u.strip()]
    r = route(store, units)
    r["unit_categories"] = {u: sorted(c) for u, c in unit_categories(store, plan).items() if u in units}
    print(json.dumps(r, indent=1))


if __name__ == "__main__":
    main()

"""Shelf rearrangement: give every product in a unit the spot where it earns the most.

python3 sim/rearrange.py --runs <run_id>[,<run_id>...] [--objective picks|revenue] [--validate] [--mock]

Two inputs, multiplied:
  conversion   what shoppers did in the runs you name: of the shoppers who noticed product i, the share who
               bought it. Thin products are pulled toward their unit's average (PRIOR_NOTICES below).
  exposure     what the shelf does: the chance product i is noticed in spot j, from sim/notice.py (row, position
               in the set, the product's own facings, mission, shopper traits). No model call.

q[i] = exposure[i][spot] x conversion[i]      chance a passing shopper would buy i from that spot, on its own

A shopper makes one decision per shelf (sim/run.py asks once per slot), so products on the same shelf compete:
    P(shopper buys something from a shelf) = 1 - prod(1 - q[i])   over the products on it
    unit value = sum over its shelves   (revenue: weighted by the price of what is bought, share q[i] / sum q)
Stacking every strong product on the eye-level shelf therefore wastes them. The search swaps pairs of products
and keeps a swap only when the unit's value rises, until no swap helps (steepest ascent from the current layout,
so it also moves as little as it can). Products stay in their own unit, so category integrity holds and nothing
moves in or out of a restricted area.

What this does NOT decide: which unit a category lives in (entrance, end-caps, HFSS rules). In sim/run.py a
shopper visits a unit because its category is on their mission, not because of where the unit stands, so a
cross-unit move cannot be measured here. sim/layout_optimise.py models walkways and covers that.

`validate` re-runs the store before and after on the same seed and reports the measured change, so the
prediction is checked against shoppers before anyone applies it.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import notice  # noqa: E402
import optimise  # noqa: E402
import placement  # noqa: E402
import run as simrun  # noqa: E402
import uploads  # noqa: E402

PRIOR_NOTICES = 10
PRIOR_SOURCE = ("assumption: a product's conversion is blended with its unit's average as if the unit average had "
                "been seen 10 more times; with few notices the estimate leans on the unit, with many on the product")
MIN_LIFT = 0.01
MIN_LIFT_SOURCE = "assumption: a unit is left alone when the predicted gain is under 1% of its current value"
MIN_SWAP_GAIN = 1e-7  # numerical floor: a swap must raise the unit value by more than rounding noise


def _shelf_events(agent) -> list:
    """A shopper's shelf events (no ai feed views), minus every slot where a model call failed: run.py marks only
    the focal product of a failed call as an error, so the whole slot is dropped."""
    shelf = [e for e in agent.get("events", []) if not str(e.get("slot", "")).startswith("feed:")]
    failed = {e["slot"] for e in shelf if e.get("mechanism") == "error"}
    return [e for e in shelf if e["slot"] not in failed]


def observed(run_ids) -> tuple[dict, dict]:
    """Per product: shelf passes, notices and buys by human shoppers across the named runs."""
    per, meta = {}, {"runs": [], "missing": [], "shoppers": 0, "engines": set(), "stores": set()}
    for rid in run_ids or []:
        fp = os.path.join(simrun.RUNS_DIR, os.path.basename(str(rid)) + ".json")
        if not os.path.exists(fp):
            meta["missing"].append(str(rid))
            continue
        run = simrun.load_json(fp)
        meta["runs"].append(run["run_id"])
        meta["stores"].add((run.get("inputs") or {}).get("store") or "")
        meta["engines"].add(run.get("engine") or ("mock" if run.get("mock") else "llm"))
        for a in run.get("agents", []):
            shelf = _shelf_events(a)
            if not shelf:
                continue
            meta["shoppers"] += 1
            for e in shelf:
                s = per.setdefault(str(e["product"]), {"shown": 0, "noticed": 0, "picked": 0})
                s["shown"] += 1
                s["noticed"] += int(bool(e.get("noticed")))
                s["picked"] += int(e.get("decision") == "pick")
    meta["engines"] = sorted(meta["engines"])
    meta["stores"] = sorted(x for x in meta["stores"] if x)
    return per, meta


_SHOPPER_CACHE: dict = {}


def _shoppers(category: str, agents: int, seed: int):
    """Shopper groups for one category: (weight, on_mission, ocean, sim_params).
    speed: the `agents` synthetic shoppers are grouped by persona and evaluated at the group's MEAN OCEAN with the
    group's summed weight (assumption: the per-shopper OCEAN jitter is sd 0.08, so p_notice at the mean is within a
    fraction of a point of the mean p_notice; this makes the superstore plan ~25x faster). Cached per (category, n, seed)."""
    key = (category, int(agents), seed)
    if key in _SHOPPER_CACHE:
        return _SHOPPER_CACHE[key]
    personas, _ = simrun.load_personas()
    browse_p = notice.coefficients()["browse_prob"]["value"]
    groups = {}
    for a in simrun.spawn_agents(personas, int(agents), [simrun.DEFAULT_MODEL], seed):
        per = a["persona"]
        mcats = per.get("mission_categories") or simrun.MISSION_CATEGORIES.get(per.get("mission", "weekly_shop"), [])
        on = category in mcats
        g = groups.setdefault(per["id"], {"w": 0.0, "n": 0, "on": on, "ocean": {}, "sp": per.get("sim_parameters", {}) or {}})
        g["w"] += 1.0 if on else browse_p
        g["n"] += 1
        for t, v in (a["ocean"] or {}).items():
            g["ocean"][t] = g["ocean"].get(t, 0.0) + float(v)
    out = [(g["w"], g["on"], {t: v / g["n"] for t, v in g["ocean"].items()}, g["sp"]) for g in groups.values()]
    _SHOPPER_CACHE[key] = out
    return out


def _unit_plan(store, plan, catalog, unit, obs, objective, agents, seed, max_swaps=None, store_mu=0.0):
    rows = range(1, int(store.get("rows_per_unit", 3)) + 1)
    row_names = store.get("row_names") or {}
    spots, items = [], []
    for r in rows:
        sid = f"{unit['id']}-r{r}"
        prods = [c for c in (plan.get(sid) or {}).get("products", []) if c in catalog]
        for pos, code in enumerate(prods):
            spots.append({"slot": sid, "row": r, "row_name": row_names.get(str(r)) or notice.ROW_NAMES.get(r, str(r)),
                          "pos": pos, "n": len(prods)})
            items.append({"code": code, "facings": int(((plan[sid].get("facings") or {}).get(code, 1)))})
    n = len(items)
    if n < 2:
        return None
    shoppers = _shoppers(unit["category"], agents, seed)
    total_w = sum(w for w, *_ in shoppers) or 1.0
    # sim/run.py sends each shopper to ONE of the units that share a category, picked uniformly
    twins = sum(1 for x in store["units"] if x["category"] == unit["category"]) or 1
    reach = sum(w for w, *_ in shoppers) / max(1, len(shoppers)) / twins

    cache = {}

    def exposure(prod, facings, spot):
        # p_notice reads only these product fields, so products that share them share the answer
        key = (prod.get("role", ""), str(prod.get("nutriscore", "")).lower(), facings, spot["row"], spot["pos"], spot["n"])
        if key not in cache:
            s = 0.0
            for w, on, ocean, sp in shoppers:
                p, _ = notice.p_notice(row=simrun.notice_row(store, spot["row"]), facings=facings, pos=spot["pos"],
                                       n_in_set=spot["n"], on_mission=on, ocean=ocean, role=prod.get("role", ""),
                                       persona_params=sp, nutriscore=prod.get("nutriscore", ""),
                                       category=unit["category"])
                s += w * p
            cache[key] = s / total_w
        return cache[key]

    unit_k = sum(obs.get(it["code"], {}).get("picked", 0) for it in items)
    unit_m = sum(obs.get(it["code"], {}).get("noticed", 0) for it in items)
    if unit_m == 0:
        return {"unit": unit["id"], "category": unit["category"], "no_data": True}
    # the unit's own average, itself leaning on the store-wide one while the unit has few notices
    mu = (unit_k + store_mu * PRIOR_NOTICES) / (unit_m + PRIOR_NOTICES)
    for it in items:
        o = obs.get(it["code"], {"shown": 0, "noticed": 0, "picked": 0})
        prod = catalog[it["code"]]
        it.update(obs=o, conversion=(o["picked"] + mu * PRIOR_NOTICES) / (o["noticed"] + PRIOR_NOTICES),
                  price=float(prod.get("price_gbp") or 0), name=prod.get("name", ""), brand=prod.get("brand", ""),
                  brand_supplied=bool(prod.get("brand_supplied")))
        it["weight"] = it["conversion"] * (it["price"] if objective == "revenue" else 1.0)
        it["exposure"] = [exposure(prod, it["facings"], sp) for sp in spots]
    price = [it["price"] if objective == "revenue" else 1.0 for it in items]
    slot_of = [sp["slot"] for sp in spots]

    def unit_value(assign):
        """assign[i] = spot index of product i. Sum over shelves of P(buy something) x mean weight of what is bought."""
        miss, num, den = {}, {}, {}
        for i, j in enumerate(assign):
            q = items[i]["exposure"][j] * items[i]["conversion"]
            sid = slot_of[j]
            miss[sid] = miss.get(sid, 1.0) * (1.0 - q)
            num[sid] = num.get(sid, 0.0) + q * price[i]
            den[sid] = den.get(sid, 0.0) + q
        return sum((1.0 - miss[sid]) * (num[sid] / den[sid] if den[sid] > 0 else 0.0) for sid in miss)

    assign = list(range(n))
    before = unit_value(assign)
    after = before
    swaps = 0
    for _ in range(int(max_swaps) if max_swaps else 4 * n):  # each round takes the single best swap
        best, best_v = None, after + MIN_SWAP_GAIN
        for a in range(n):
            for b in range(a + 1, n):
                assign[a], assign[b] = assign[b], assign[a]
                v = unit_value(assign)
                assign[a], assign[b] = assign[b], assign[a]
                if v > best_v:
                    best, best_v = (a, b), v
        if not best:
            break
        a, b = best
        assign[a], assign[b] = assign[b], assign[a]
        after = best_v
        swaps += 1
    if before > 0 and (after - before) / before < MIN_LIFT:
        assign, after, swaps = list(range(n)), before, 0
    moves = []
    for i, j in enumerate(assign):
        if i == j:
            continue
        it, a, b = items[i], spots[i], spots[j]
        o = it["obs"]
        thin = o["noticed"] < PRIOR_NOTICES
        up = it["exposure"][j] > it["exposure"][i]
        why = (f"bought by {it['conversion']:.0%} of shoppers who notice it ({o['picked']} of {o['noticed']} seen"
               f"{', so the estimate leans on the unit average of ' + format(mu, '.0%') if thin else ''}); "
               + (f"the unit average is {mu:.0%}. it moves to a spot more shoppers see"
                  if up else f"the unit average is {mu:.0%}. it gives its spot to a product that earns more there")
               + ("" if a["slot"] == b["slot"] else ", on another shelf"))
        moves.append({"code": it["code"], "name": it["name"], "brand": it["brand"], "brand_supplied": it["brand_supplied"],
                      "from": {k: a[k] for k in ("slot", "row", "row_name", "pos")},
                      "to": {k: b[k] for k in ("slot", "row", "row_name", "pos")},
                      "notice_before": round(it["exposure"][i], 4), "notice_after": round(it["exposure"][j], 4),
                      "conversion": round(it["conversion"], 4), "noticed": o["noticed"], "picked": o["picked"],
                      "thin": thin, "why": why})
    moves.sort(key=lambda m: -(m["notice_after"] - m["notice_before"]) * m["conversion"])
    unit_label = "£ per 100 shoppers passing the unit" if objective == "revenue" else "buys per 100 shoppers passing the unit"
    scale = 100.0
    return {"unit": unit["id"], "category": unit["category"], "reach": round(reach, 4), "products": n,
            "unit_conversion": round(mu, 4), "noticed": unit_m, "picked": unit_k,
            "before": round(before * scale, 3), "after": round(after * scale, 3),
            "lift": round((after - before) * scale, 3),
            "lift_pct": round((after - before) / before, 4) if before > 0 else 0.0,
            "value_unit": unit_label, "swaps": swaps, "moves": moves,
            "_assign": [(items[i]["code"], spots[j]["slot"], spots[j]["pos"]) for i, j in enumerate(assign)]}


def suggest(planogram=None, extra_products=None, run_ids=None, objective="picks", agents=300, seed=1, units=None,
            max_swaps=None):
    """max_swaps: cap on swaps per unit. The search takes the most valuable swap first, so a small cap keeps the
    biggest wins and moves the fewest products."""
    if objective not in ("picks", "revenue"):
        raise ValueError("objective must be 'picks' or 'revenue'")
    store, store_src = simrun.load_store()
    plan, _ = simrun.load_planogram(planogram)
    catalog, _ = simrun.load_catalog(plan)
    catalog, _ = uploads.merge(catalog, extra_products, store)
    obs, meta = observed(run_ids)
    on_shelf = {c for s in plan.values() for c in s.get("products", [])}
    seen_k = sum(o["picked"] for c, o in obs.items() if c in on_shelf)
    seen_m = sum(o["noticed"] for c, o in obs.items() if c in on_shelf)
    store_mu = seen_k / seen_m if seen_m else 0.0
    if not meta["runs"]:
        raise ValueError("no run to learn from. run the store at least once, then ask for a rearrangement "
                         f"(not found on this server: {', '.join(meta['missing']) or 'no run named'})")
    if not seen_m:
        raise ValueError("the run(s) named hold no shopper who noticed a product on this shelf plan, so there is "
                         "nothing to learn from. run this store first, then ask for a rearrangement")
    new = copy.deepcopy(plan)
    out_units, no_data = [], []
    for unit in simrun.unit_order(store):
        if units and unit["id"] not in units:
            continue
        res = _unit_plan(store, plan, catalog, unit, obs, objective, agents, seed, max_swaps, store_mu)
        if not res:
            continue
        if res.get("no_data"):
            no_data.append({"unit": res["unit"], "category": res["category"]})
            continue
        by_slot = {}
        for code, sid, pos in res.pop("_assign"):
            by_slot.setdefault(sid, {})[pos] = code
        facings = {}
        for r in range(1, int(store.get("rows_per_unit", 3)) + 1):
            facings.update((plan.get(f"{unit['id']}-r{r}") or {}).get("facings") or {})
        for sid, placed in by_slot.items():
            moved_in = iter(placed[k] for k in sorted(placed))
            # a code the catalogue does not know was never part of the search: it keeps its place and facings
            codes = [next(moved_in) if c in catalog else c for c in plan[sid].get("products", [])]
            new[sid] = {**plan[sid], "products": codes, "facings": {c: facings[c] for c in codes if c in facings}}
        out_units.append(res)
    tot_b = sum(u["reach"] * u["before"] for u in out_units)
    tot_a = sum(u["reach"] * u["after"] for u in out_units)
    out_units.sort(key=lambda u: -u["lift"])
    return {
        "objective": objective, "max_swaps": max_swaps, "units": out_units, "no_data_units": no_data,
        "planogram": new,
        "moves": sum(len(u["moves"]) for u in out_units),
        "total": {"before": round(tot_b, 3), "after": round(tot_a, 3), "lift": round(tot_a - tot_b, 3),
                  "lift_pct": round((tot_a - tot_b) / tot_b, 4) if tot_b > 0 else 0.0,
                  "value_unit": "£ per 100 store visits" if objective == "revenue" else "buys per 100 store visits"},
        "learned_from": {"runs": meta["runs"], "missing": meta["missing"], "shoppers": meta["shoppers"],
                         "engines": meta["engines"],
                         # true when a run was made on another store's layout: only shared products carry data
                         "other_store": bool(meta["stores"]) and any(x != store_src for x in meta["stores"])},
        "units_total": len(simrun.unit_order(store)),
        "method": ("for each product and spot: the chance it is noticed there (sim/notice.py: row, position, its facings, "
                   "mission, shopper traits) x the share of shoppers who bought it once they noticed it in the runs learned "
                   "from. a shopper buys at most one product per shelf, so the value of a shelf is the chance they buy "
                   "anything from it, and strong products placed together compete. starting from the current layout, the "
                   "search keeps swapping the pair of products that raises the unit's value most, until no swap helps. "
                   "products never leave their unit. this is a prediction: test it with shoppers before applying it."),
        "assumptions": [f"PRIOR_NOTICES={PRIOR_NOTICES}: {PRIOR_SOURCE}",
                        "a unit no shopper noticed anything in is left alone and listed under no_data_units; a unit's "
                        "average leans on the store-wide average the same way a product leans on its unit", f"MIN_LIFT={MIN_LIFT}: {MIN_LIFT_SOURCE}",
                        "a product's conversion is taken from where it sat in the runs learned from, so it already "
                        "includes the competition it had there; the shopper test is what checks the new layout",
                        "which unit a category lives in is not decided here (sim/run.py visits units by mission, not by "
                        "distance from the entrance); sim/layout_optimise.py covers entrance, end-caps and the hfss rules"],
        "sources": placement._sources(),
    }


def _human_totals(run, units):
    tot = {"shown": 0, "picked": 0, "noticed": 0}
    per = {u: {"shown": 0, "picked": 0, "noticed": 0} for u in units}
    shoppers = 0
    for a in run["agents"]:
        shelf = _shelf_events(a)
        shoppers += int(bool(shelf))
        for e in shelf:
            for t in (tot, per.get(e["slot"].split("-r")[0])):
                if t is not None:
                    t["shown"] += 1
                    t["noticed"] += int(bool(e.get("noticed")))
                    t["picked"] += int(e.get("decision") == "pick")
    return tot, per, shoppers


def validate(planogram_before, planogram_after, extra_products=None, agents=150, seeds=(1,), models=None, mock=False,
             engine=None, max_tokens=250):
    """Measure the change with shoppers: the same seed walks both layouts."""
    engine = "mock" if mock else (engine or simrun.DEFAULT_ENGINE)
    if engine != "llm":
        models = None
    if not isinstance(planogram_before, dict) or not isinstance(planogram_after, dict):
        raise ValueError("validate needs both planograms inline")
    changed = sorted({s.split("-r")[0] for s in planogram_after
                      if (planogram_after[s] or {}).get("products") != (planogram_before.get(s) or {}).get("products")})
    acc = {"before": {"shown": 0, "picked": 0, "noticed": 0}, "after": {"shown": 0, "picked": 0, "noticed": 0}}
    per = {"before": {u: {"shown": 0, "picked": 0, "noticed": 0} for u in changed},
           "after": {u: {"shown": 0, "picked": 0, "noticed": 0} for u in changed}}
    shoppers, cost = 0, 0.0
    for seed in [int(s) for s in (seeds or [1])]:
        for arm, plan in (("before", planogram_before), ("after", planogram_after)):
            run = simrun.run_simulation(planogram=plan, agents=agents, models=models, seed=seed, engine=engine,
                                        max_tokens=max_tokens, save=False, extra_products=extra_products,
                                        label=f"rearrange {arm}")
            tot, by_unit, n = _human_totals(run, changed)
            cost += run["cost"]["usd"]
            shoppers = max(shoppers, n)
            for k in acc[arm]:
                acc[arm][k] += tot[k]
                for u in changed:
                    per[arm][u][k] += by_unit[u][k]

    def diff(b, a):
        d, ci = optimise.newcomb_diff_ci(a["picked"], a["shown"], b["picked"], b["shown"])
        return {"picks_before": b["picked"], "picks_after": a["picked"], "shown_before": b["shown"], "shown_after": a["shown"],
                "rate_before": round(b["picked"] / b["shown"], 4) if b["shown"] else 0.0,
                "rate_after": round(a["picked"] / a["shown"], 4) if a["shown"] else 0.0,
                "noticed_before": b["noticed"], "noticed_after": a["noticed"],
                "delta_rate": d, "delta_ci95": ci, "significant": ci[0] > 0 or ci[1] < 0}
    return {"engine": engine, "mock": engine == "mock", "agents": agents, "seeds": list(seeds or [1]), "shoppers": shoppers,
            "cost_usd": round(cost, 5), "store": diff(acc["before"], acc["after"]),
            "units": [{"unit": u, **diff(per["before"][u], per["after"][u])} for u in changed],
            "method": ("the same shoppers (same seed, same notice draws) walk the store before and after. rate = buys / "
                       "products passed, counted over the whole store and over each changed unit. interval: newcombe "
                       "hybrid wilson on the two rates, which treats the arms as independent and so is conservative.")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", required=True)
    ap.add_argument("--objective", default="picks", choices=("picks", "revenue"))
    ap.add_argument("--planogram", default=None)
    ap.add_argument("--validate", action="store_true")
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--agents", type=int, default=150)
    a = ap.parse_args()
    out = suggest(a.planogram, None, a.runs.split(","), a.objective)
    print(f"{out['moves']} moves, {out['total']['before']} -> {out['total']['after']} {out['total']['value_unit']}")
    for u in out["units"][:6]:
        print(f"  {u['unit']} {u['category']}: {u['before']} -> {u['after']} ({u['lift_pct']:+.1%}), {len(u['moves'])} moves")
        for m in u["moves"][:2]:
            print(f"    {m['brand']} {m['name'][:30]}: {m['from']['row_name']} {m['from']['pos'] + 1} -> "
                  f"{m['to']['row_name']} {m['to']['pos'] + 1}")
    if a.validate:
        base, _ = simrun.load_planogram(a.planogram)
        v = validate(base, out["planogram"], agents=a.agents, mock=a.mock)
        print(json.dumps(v["store"]))


if __name__ == "__main__":
    main()

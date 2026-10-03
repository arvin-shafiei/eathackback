"""Best shelf placement for one product.

python3 sim/placement.py --product <code> [--experiment] [--mock] [--agents N] [--seed S]

scan        every slot x position x facings in the product's own unit, scored by the notice model
            (sim/notice.py). No LLM and no random draw, so it is free and exact for the spawned shoppers.
experiment  the placements worth testing, re-run with real shoppers: pick rate before vs after with a
            95% CI, same seeds and same shoppers in both arms (as sim/optimise.py does for its edits).

A placement is a swap: our product trades places with whatever sits at the target slot + position.
Nothing is added to or removed from the shelf.
"""
from __future__ import annotations

import argparse
import copy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import notice  # noqa: E402
import optimise  # noqa: E402
import run as simrun  # noqa: E402
import uploads  # noqa: E402

FACINGS_OPTIONS = (1, 2, 3)
FACINGS_SOURCE = ("assumption: the scan tries 1 to 3 facings. The range is a choice of this scan, not a "
                  "measurement; the notice model itself caps the facings effect at facings_cap.")
SCAN_INPUTS = ("p_ref_eye_centre_1facing", "eye_vs_bottom_sales_ratio", "top_vs_bottom_notice_ratio",
               "facings_elasticity", "facings_cap", "centre_vs_edge_ratio", "mission_relevance_logit",
               "seconds_at_shelf_logit_per_ln", "persona_eye_override", "browse_prob", "ocean_jitter_sd")


def _unit_of(sid: str) -> str:
    return sid.split("-r")[0]


def _load(planogram, extra_products):
    store, _ = simrun.load_store()
    plan, _ = simrun.load_planogram(planogram)
    catalog, _ = simrun.load_catalog(plan)
    catalog, _ = uploads.merge(catalog, extra_products, store)
    return store, plan, catalog


def _locate(plan, catalog, code):
    """(slot id, index in the slot's list, index among the products shoppers are shown, set size, facings)."""
    sid = optimise.find_slot(plan, code)
    slot = plan[sid]
    # run.py drops codes missing from the catalog before it counts positions, so centrality must too
    shown = [c for c in slot["products"] if c in catalog]
    if code not in shown:
        raise ValueError(f"{code} is on the planogram but not in the catalog, so no shopper is ever shown it")
    return (sid, slot["products"].index(code), shown.index(code), len(shown),
            int((slot.get("facings") or {}).get(code, 1)))


def apply_placement(plan: dict, code: str, slot: str, pos: int, facings: int, names: dict | None = None):
    """Return (new planogram, what_changed, displaced code or None). The input planogram is not modified.
    names maps a code to the label used in what_changed (the code itself when missing)."""
    label = lambda c: (names or {}).get(c) or c  # noqa: E731
    sid = optimise.find_slot(plan, code)
    slot, pos, facings = str(slot), int(pos), int(facings)
    if slot not in plan or _unit_of(slot) != _unit_of(sid):
        raise ValueError(f"slot {slot} is not in unit {_unit_of(sid)}, where {code} sits; "
                         "a placement can only move a product within its own unit")
    n = len(plan[slot].get("products", []))
    if not 0 <= pos < n:
        raise ValueError(f"pos {pos} is outside the {n}-product set of {slot} (valid: 0..{n - 1})")
    if facings < 1:
        raise ValueError(f"facings must be 1 or more, got {facings}")
    new = copy.deepcopy(plan)
    src, dst = new[sid], new[slot]
    i = src["products"].index(code)
    other = dst["products"][pos]
    src_f, dst_f = src.setdefault("facings", {}), dst.setdefault("facings", {})
    was = int(src_f.get(code, 1))
    parts = []
    if other != code:
        other_f = int(dst_f.get(other, 1))
        src["products"][i], dst["products"][pos] = other, code
        if sid != slot:
            src_f.pop(code, None)
            dst_f.pop(other, None)
            src_f[other] = other_f
        parts.append(f"swapped {label(code)} ({sid}, position {i + 1} of {len(src['products'])}) with {label(other)} "
                     f"({slot}, position {pos + 1} of {n}); {label(other)} keeps its {other_f} facing(s)")
    dst_f[code] = facings
    if facings != was:
        parts.append(f"{label(code)} facings {was} -> {facings}; no neighbour gave up a facing, so shelf space "
                     f"{'grew' if facings > was else 'shrank'} by {abs(facings - was)}")
    else:
        parts.append(f"{label(code)} facings unchanged at {was}")
    if other == code and facings == was:
        parts = [f"nothing moved: {label(code)} is already at {slot}, position {pos + 1} of {n}, with {was} facing(s)"]
    return new, "; ".join(parts), (None if other == code else other)


def _sources() -> list[str]:
    ex = notice.explain()
    out = [f"{k}: {ex['inputs'][k]['source']}" for k in SCAN_INPUTS if k in ex["inputs"]]
    seen = set()
    for e in ex["ocean_effects"]:
        key = (e["trait"], e.get("id", ""))
        if e["applies"] == "label" or key in seen:
            continue
        seen.add(key)
        out.append(f"ocean {e['trait']} {e.get('id', '')} ({e['file']}): {e['source']}")
    out.append(f"mission_categories (sim/run.py): {simrun.MISSION_CATEGORIES['_source']}")
    out.append(f"facings range (sim/placement.py): {FACINGS_SOURCE}")
    return out


def scan(product, planogram=None, extra_products=None, agents=200, seed=1):
    store, plan, catalog = _load(planogram, extra_products)
    product = str(product)
    cur_sid, cur_idx, _, _, cur_fac = _locate(plan, catalog, product)
    unit = next(u for u in simrun.unit_order(store) if u["id"] == _unit_of(cur_sid))
    category = unit["category"]
    prod = catalog[product]
    personas, _ = simrun.load_personas()
    if not personas:
        raise RuntimeError("no personas found")
    browse_p = notice.coefficients()["browse_prob"]["value"]
    shoppers = []
    for a in simrun.spawn_agents(personas, int(agents), [simrun.DEFAULT_MODEL], seed):
        persona = a["persona"]
        mcats = persona.get("mission_categories") or simrun.MISSION_CATEGORIES.get(
            persona.get("mission", "weekly_shop"), [])
        on_mission = category in mcats
        shoppers.append((1.0 if on_mission else browse_p, on_mission, a["ocean"],
                         persona.get("sim_parameters", {}) or {}))
    total_w = sum(w for w, *_ in shoppers)
    reach = round(total_w / len(shoppers), 4) if shoppers else 0.0

    def notice_rate(row, facings, pos, n):
        if not total_w:
            return 0.0
        s = 0.0
        for w, on_mission, ocean, sp in shoppers:
            p, _ = notice.p_notice(row=simrun.notice_row(store, row), facings=facings, pos=pos, n_in_set=n, on_mission=on_mission,
                                   ocean=ocean, role=prod.get("role", ""), persona_params=sp,
                                   nutriscore=prod.get("nutriscore", ""), category=category)
            s += w * p
        return round(s / total_w, 4)

    candidates = []
    for row in range(1, int(store.get("rows_per_unit", 3)) + 1):
        sid = f"{unit['id']}-r{row}"
        for idx in range(len((plan.get(sid) or {}).get("products", []))):
            here = sid == cur_sid and idx == cur_idx
            options = sorted(set(FACINGS_OPTIONS) | {cur_fac}) if here else FACINGS_OPTIONS
            for fac in options:
                new, _, displaced = apply_placement(plan, product, sid, idx, fac)
                _, _, shown_pos, n, _ = _locate(new, catalog, product)
                candidates.append({"slot": sid, "row": row, "row_name": (store.get("row_names") or {}).get(str(row)) or notice.ROW_NAMES.get(row, str(row)),
                                   "pos": idx, "facings": fac, "displaces": displaced,
                                   "notice_rate": notice_rate(row, fac, shown_pos, n), "reach": reach,
                                   "is_current": here and fac == cur_fac})
    current = next(c for c in candidates if c["is_current"])
    for c in candidates:
        c["lift_vs_current"] = round(c["notice_rate"] - current["notice_rate"], 4)
    candidates.sort(key=lambda c: -c["notice_rate"])
    n_on = sum(1 for w, on, *_ in shoppers if on)
    method = (
        f"Exact scan, no LLM and no sampling of noticing. We spawned the same {len(shoppers)} shoppers a "
        f"simulation with seed {seed} would spawn (personas cycled so every archetype appears, each with "
        f"jittered OCEAN). {n_on} of them have {category} on their mission and always walk unit "
        f"{unit['id']}; the other {len(shoppers) - n_on} walk it with probability {browse_p} (browse_prob, an "
        f"assumption), counted as that probability instead of a coin flip. reach is the expected share of "
        f"all {len(shoppers)} shoppers who pass the unit. For each of the {len(candidates)} candidate "
        f"placements (every row of the unit x every position in that row's set x {FACINGS_OPTIONS[0]} to "
        f"{FACINGS_OPTIONS[-1]} facings, a range chosen for this scan) notice_rate is the mean of the notice "
        f"model's p_notice (sim/notice.py: row, facings, centrality, mission, seconds at shelf, OCEAN) over "
        f"the shoppers who pass, each weighted by their chance of passing. Moving to a position swaps our "
        f"product with the one already there ('displaces'). Adding facings takes no space from a neighbour, "
        f"so the shelf grows. This is the chance of being noticed, not of being bought: run the experiment "
        f"to measure pick rate.")
    return {"product": product, "unit": unit["id"], "category": category, "n_agents": len(shoppers),
            "seed": seed, "current": current, "candidates": candidates, "method": method,
            "sources": _sources()}


def experiment(product, planogram=None, extra_products=None, placements=None, agents=60, seeds=(1,),
               models=None, mock=False, max_tokens=250, engine=None):
    engine = "mock" if mock else (engine or simrun.DEFAULT_ENGINE)
    mock = engine == "mock"
    if engine != "llm":
        models = None
    store, base_plan, catalog = _load(planogram, extra_products)
    product = str(product)
    cur_sid = _locate(base_plan, catalog, product)[0]
    unit = _unit_of(cur_sid)
    seeds = [int(s) for s in (seeds or [1])]
    # every placement is validated before the first shopper runs, so a bad one cannot waste LLM spend
    arms = []
    for pl in placements or []:
        names = {c: (p.get("brand") or p.get("name") or c) for c, p in catalog.items()}
        new, desc, _ = apply_placement(base_plan, product, pl["slot"], pl["pos"], pl["facings"], names)
        arms.append({"placement": {"slot": str(pl["slot"]), "pos": int(pl["pos"]), "facings": int(pl["facings"])},
                     "what_changed": desc, "planogram": new, "k": 0, "n": 0, "noticed": 0, "cost": 0.0})
    base_k = base_n = base_noticed = 0
    run_ids = []
    for seed in seeds:
        base = simrun.run_simulation(planogram=base_plan, agents=agents, models=models, seed=seed, engine=engine,
                                     max_tokens=max_tokens, label=f"placement baseline {product}",
                                     extra_products=extra_products)
        run_ids.append(base["run_id"])
        s = base["stats"]["per_product"].get(product, {})
        base_k += s.get("picked", 0)
        base_n += s.get("shown", 0)
        base_noticed += s.get("noticed", 0)
        affected = [a["agent_id"] for a in base["agents"] if any(_unit_of(p) == unit for p in a["path"])]
        for arm in arms:
            rerun = simrun.run_simulation(planogram=arm["planogram"], agents=agents, models=models, seed=seed,
                                          engine=engine, max_tokens=max_tokens, only_agents=affected, save=False,
                                          extra_products=extra_products) if affected else {"agents": [], "cost": {"usd": 0}}
            by_id = {a["agent_id"]: a for a in rerun["agents"]}
            merged = [by_id.get(a["agent_id"], a) for a in base["agents"]]
            st = simrun.compute_stats(merged, catalog)["per_product"].get(product, {})
            arm["k"] += st.get("picked", 0)
            arm["n"] += st.get("shown", 0)
            arm["noticed"] += st.get("noticed", 0)
            arm["cost"] += rerun["cost"]["usd"]
    pick_base = round(base_k / base_n, 4) if base_n else 0
    notice_base = round(base_noticed / base_n, 4) if base_n else 0
    results = []
    for arm in arms:
        d, ci = optimise.newcomb_diff_ci(arm["k"], arm["n"], base_k, base_n)
        results.append({"placement": arm["placement"], "what_changed": arm["what_changed"],
                        "pick_base": pick_base, "pick_new": round(arm["k"] / arm["n"], 4) if arm["n"] else 0,
                        "delta_pick": d, "delta_ci95": ci, "notice_base": notice_base,
                        "notice_new": round(arm["noticed"] / arm["n"], 4) if arm["n"] else 0,
                        "n_base": base_n, "n_new": arm["n"], "significant": ci[0] > 0 or ci[1] < 0,
                        "cost_usd": round(arm["cost"], 5), "planogram": arm["planogram"]})
    method = (
        f"Each placement swaps our product with the one at the target slot and position, inside unit {unit} "
        f"only, and sets our facings. For each of {len(seeds)} seed(s) we ran {agents} shoppers on the "
        f"current shelf (the baseline), then re-ran only the shoppers whose path enters unit {unit} on the "
        f"new shelf and kept everyone else's baseline trip unchanged. pick rate = picks of our product / "
        f"shopper trips that passed its slot (n_base, n_new), summed over seeds; notice rate = noticed / the "
        f"same trips. Both arms use the same seed, shoppers and OCEAN. The notice draw is hashed on (seed, "
        f"shopper, product code), not on the slot, so the same shopper gets the same uniform draw for our "
        f"product in both arms and only p_notice moves: a shopper who noticed it at the worse placement "
        f"still notices it at a better one. The interval on the difference is Newcomb's hybrid Wilson 95% "
        f"CI, which treats the arms as independent and is therefore conservative for paired arms; "
        f"'significant' means it excludes 0. The displaced product moves too, so the choice set in both "
        f"slots changes, not only our position."
        + (" Decisions here come from the mock heuristic (sim/run.py mock_decide), not an LLM." if mock else ""))
    return {"product": product, "agents": agents, "seeds": seeds,
            "models": ["mock"] if mock else (models or [simrun.DEFAULT_MODEL]), "mock": mock, "method": method,
            "baseline": {"pick_rate": pick_base, "notice_rate": notice_base, "n": base_n, "run_ids": run_ids},
            "results": sorted(results, key=lambda r: -r["delta_pick"])}


def _fmt(c):
    return (f"{c['slot']} ({c['row_name']:6}) pos {c['pos']} facings {c['facings']}  notice {c['notice_rate']:.4f}  "
            f"lift {c['lift_vs_current']:+.4f}  displaces {c['displaces'] or '-'}{'  <- current' if c['is_current'] else ''}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--product", required=True)
    ap.add_argument("--experiment", action="store_true", help="also measure pick rate for the top 3 placements")
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--agents", type=int, default=None)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--models", default=simrun.DEFAULT_MODEL)
    ap.add_argument("--planogram", default=None)
    a = ap.parse_args()
    sc = scan(a.product, planogram=a.planogram, agents=a.agents or 200, seed=a.seed)
    print(f"{sc['product']} in {sc['unit']} ({sc['category']}): mean p_notice over {sc['n_agents']} spawned "
          f"shoppers (seed {sc['seed']}), weighted by their chance of passing the unit; reach {sc['current']['reach']}")
    print("current  " + _fmt(sc["current"]))
    for c in sc["candidates"][:5]:
        print("         " + _fmt(c))
    if a.experiment:
        top = [c for c in sc["candidates"] if not c["is_current"]][:3]
        ex = experiment(a.product, planogram=a.planogram, agents=a.agents or 60, seeds=[a.seed],
                        placements=[{k: c[k] for k in ("slot", "pos", "facings")} for c in top],
                        models=a.models.split(","), mock=a.mock)
        b = ex["baseline"]
        print(f"baseline pick {b['pick_rate']} notice {b['notice_rate']} over n={b['n']} shopper trips past "
              f"the slot ({ex['agents']} shoppers x {len(ex['seeds'])} seed(s), models {ex['models']}); runs {b['run_ids']}")
        for r in ex["results"]:
            print(f"  {r['placement']}  pick {r['pick_base']} -> {r['pick_new']} (n={r['n_new']})  "
                  f"delta {r['delta_pick']:+.4f} ci95 {r['delta_ci95']}  notice {r['notice_base']} -> "
                  f"{r['notice_new']}  significant={r['significant']}\n    {r['what_changed']}")


if __name__ == "__main__":
    main()

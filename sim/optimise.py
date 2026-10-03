"""Honest-edit optimiser. Applies one real-world change at a time, re-runs only the agents whose path
touches the edited unit (same seed, same agents, same notice draws = common random numbers), and reports
Δpick with a 95% CI.

python3 sim/optimise.py --product FX0005 --agents 40 --seeds 1,2 [--mock] [--edits eye,facings,claim,price] [--price 1.40]

Edits (only things a brand/buyer can actually do; nothing invents product facts):
  eye      swap the product's slot set with the eye-level slot set of the same unit (a re-merchandise)
  facings  +1 facing for the product, taken from the widest neighbour in the same slot (net space unchanged)
  claim    surface a TRUE claim derived from the product's own OFF fields into pack_copy, using the
           thresholds in Regulation (EC) No 1924/2006 Annex (retained in UK law)
  price    set a new shelf price (--price)
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import run as simrun  # noqa: E402
import uploads  # noqa: E402

REG = "Regulation (EC) No 1924/2006 Annex, retained in UK law: https://www.legislation.gov.uk/eur/2006/1924/annex"


def true_claims(p: dict) -> list[dict]:
    """Nutrition claims the product legally qualifies for, from its own OFF fields."""
    out = []
    liquid = p.get("category") in ("soft_drinks", "plant_milk_dairy_alt")
    f = p.get("fiber_100g")
    if f is not None:
        if f >= 6:
            out.append({"claim": "high fibre", "why": f"fiber_100g={f} >= 6 (OFF)", "source": REG})
        elif f >= 3:
            out.append({"claim": "source of fibre", "why": f"fiber_100g={f} >= 3 (OFF)", "source": REG})
    kcal = p.get("energy_kcal_100g") or p.get("energy-kcal_100g")
    pr = p.get("proteins_100g")
    if kcal and pr is not None and kcal > 0:
        share = 4 * pr / kcal
        if share >= 0.20:
            out.append({"claim": "high protein", "why": f"4*proteins_100g/kcal = {share:.2f} >= 0.20 (OFF)", "source": REG})
        elif share >= 0.12:
            out.append({"claim": "source of protein", "why": f"protein energy share {share:.2f} >= 0.12 (OFF)", "source": REG})
    s = p.get("sugars_100g")
    if s is not None:
        if s <= 0.5:
            out.append({"claim": "sugar free", "why": f"sugars_100g={s} <= 0.5 (OFF)", "source": REG})
        elif s <= (2.5 if liquid else 5):
            out.append({"claim": "low sugar", "why": f"sugars_100g={s} <= {2.5 if liquid else 5} (OFF)", "source": REG})
    salt = p.get("salt_100g")
    if salt is not None and salt <= 0.3:
        out.append({"claim": "low salt", "why": f"salt_100g={salt} <= 0.3 (sodium 0.12g) (OFF)", "source": REG})
    for lab in p.get("labels") or []:
        if lab in ("en:vegan", "en:organic", "en:fair-trade", "en:gluten-free"):
            out.append({"claim": lab.replace("en:", "").replace("-", " "), "why": f"labels contains {lab} (OFF)",
                        "source": f"OFF labels field, {p.get('off_url') or p['code']}"})
    if p.get("brand_supplied"):
        # the figures were typed in by the brand, so the claim is only as true as they are
        for c in out:
            c["why"] = c["why"].replace("(OFF)", f"({uploads.SOURCE})")
    copy_l = (p.get("pack_copy") or "").lower()
    return [c for c in out if c["claim"] not in copy_l]


def find_slot(plan, code):
    for sid, s in plan.items():
        if code in s.get("products", []):
            return sid
    raise ValueError(f"{code} not on the planogram")


def make_edit(kind, plan, catalog, code, price=None):
    plan = copy.deepcopy(plan)
    patch = {}
    sid = find_slot(plan, code)
    unit, row = sid.split("-r")
    touched = {unit}
    desc = ""
    if kind == "eye":
        eye = f"{unit}-r2"
        if sid == eye:
            return None
        plan[sid], plan[eye] = plan.get(eye, {"category": plan[sid]["category"], "products": [], "facings": {}}), plan[sid]
        desc = f"moved the {sid} set to eye level ({eye}); the eye-level set moved to {sid}"
    elif kind == "facings":
        fac = plan[sid].setdefault("facings", {})
        others = [c for c in plan[sid]["products"] if c != code and fac.get(c, 1) > 1]
        fac[code] = fac.get(code, 1) + 1
        if others:
            donor = max(others, key=lambda c: fac.get(c, 1))
            fac[donor] -= 1
            desc = f"+1 facing for {code} (now {fac[code]}), taken from {donor} (now {fac[donor]})"
        else:
            desc = f"+1 facing for {code} (now {fac[code]}); no neighbour had a spare facing, so shelf space grew"
    elif kind == "claim":
        claims = true_claims(catalog[code])
        if not claims:
            return None
        c = claims[0]
        patch[code] = {"pack_copy": (catalog[code].get("pack_copy", "").rstrip(". ") + f". {c['claim']}").strip(". ")}
        kind_of = "claim the brand's own figures qualify for" if catalog[code].get("brand_supplied") else "true claim"
        desc = f"surfaced {kind_of} '{c['claim']}' in pack_copy ({c['why']}; {c['source']})"
    elif kind == "price":
        if price is None:
            return None
        patch[code] = {"price_gbp": float(price), "price_source": "optimiser what-if"}
        desc = f"price {catalog[code].get('price_gbp')} -> {price}"
    return {"kind": kind, "planogram": plan, "catalog_patch": patch, "touched_units": touched, "desc": desc}


def newcomb_diff_ci(k1, n1, k0, n0):
    """95% CI for p1 - p0 (Newcomb 1998 hybrid Wilson method). Treats arms as independent, which is
    conservative here because both arms share agents and notice draws."""
    p1 = k1 / n1 if n1 else 0
    p0 = k0 / n0 if n0 else 0
    l1, u1 = simrun.wilson(k1, n1)
    l0, u0 = simrun.wilson(k0, n0)
    d = p1 - p0
    return round(d, 4), [round(d - math.sqrt((p1 - l1) ** 2 + (u0 - p0) ** 2), 4),
                         round(d + math.sqrt((u1 - p1) ** 2 + (p0 - l0) ** 2), 4)]


def optimise(product, agents=40, seeds=(1,), models=None, mock=False, edits=("eye", "facings", "claim"),
             price=None, planogram=None, max_tokens=250, extra_products=None):
    base_plan, plan_src = simrun.load_planogram(planogram)
    catalog, _ = simrun.load_catalog(base_plan)
    catalog, _ = uploads.merge(catalog, extra_products, simrun.load_store()[0])
    results = []
    totals = {}
    base_k = base_n = 0
    base_runs = []
    for seed in seeds:
        base = simrun.run_simulation(planogram=base_plan, agents=agents, models=models, seed=seed, mock=mock,
                                     max_tokens=max_tokens, label=f"optimise baseline {product}",
                                     extra_products=extra_products)
        base_runs.append(base["run_id"])
        s = base["stats"]["per_product"].get(product, {"picked": 0, "shown": 0})
        base_k += s["picked"]
        base_n += s["shown"]
        for kind in edits:
            e = make_edit(kind, base_plan, catalog, product, price)
            if e is None:
                totals.setdefault(kind, {"skipped": True})
                continue
            affected = [a["agent_id"] for a in base["agents"]
                        if any(p.split("-r")[0] in e["touched_units"] for p in a["path"])]
            # agents whose path never enters the edited unit are copied unchanged
            rerun = simrun.run_simulation(planogram=e["planogram"], agents=agents, models=models, seed=seed,
                                          mock=mock, max_tokens=max_tokens, only_agents=affected, save=False,
                                          catalog_patch=e["catalog_patch"],
                                          extra_products=extra_products) if affected else {"agents": [], "cost": {"usd": 0}}
            by_id = {a["agent_id"]: a for a in rerun["agents"]}
            merged = [by_id.get(a["agent_id"], a) for a in base["agents"]]
            cat2 = dict(catalog)
            for c, upd in e["catalog_patch"].items():
                cat2[c] = {**cat2.get(c, {}), **upd}
            st = simrun.compute_stats(merged, cat2)["per_product"].get(product, {"picked": 0, "shown": 0})
            t = totals.setdefault(kind, {"k": 0, "n": 0, "desc": e["desc"], "affected_agents": 0, "cost": 0.0,
                                         "notice_k": 0})
            t["k"] += st["picked"]
            t["n"] += st["shown"]
            t["notice_k"] += st.get("noticed", 0)
            t["affected_agents"] += len(affected)
            t["cost"] += rerun["cost"]["usd"]
    for kind, t in totals.items():
        if t.get("skipped"):
            results.append({"edit": kind, "skipped": True, "why": "not applicable (already at eye level / no true claim available / no price given)"})
            continue
        d, ci = newcomb_diff_ci(t["k"], t["n"], base_k, base_n)
        results.append({"edit": kind, "what_changed": t["desc"], "pick_base": round(base_k / base_n, 4) if base_n else 0,
                        "pick_new": round(t["k"] / t["n"], 4) if t["n"] else 0, "delta_pick": d, "delta_ci95": ci,
                        "n_base": base_n, "n_new": t["n"], "affected_agent_runs": t["affected_agents"],
                        "cost_usd": round(t["cost"], 5),
                        "significant": ci[0] > 0 or ci[1] < 0})
    out = {"product": product, "name": catalog[product].get("name"), "seeds": list(seeds), "agents": agents,
           "models": ["mock"] if mock else (models or [simrun.DEFAULT_MODEL]), "baseline_runs": base_runs,
           "true_claims_available": true_claims(catalog[product]),
           "method": "Common random numbers: same seed, agents, OCEAN and notice draws in both arms; only agents "
                     "whose path enters the edited unit are re-simulated. Δ CI: Newcomb hybrid Wilson (independent-arm, conservative).",
           "results": sorted(results, key=lambda r: -(r.get("delta_pick") or -9))}
    os.makedirs(os.path.join(simrun.ROOT, "data/sim/optimise"), exist_ok=True)
    fp = os.path.join(simrun.ROOT, "data/sim/optimise", f"opt_{product}_{base_runs[0]}.json")
    with open(fp, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    out["_path"] = os.path.relpath(fp, simrun.ROOT)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--product", required=True)
    ap.add_argument("--agents", type=int, default=40)
    ap.add_argument("--seeds", default="1")
    ap.add_argument("--models", default=simrun.DEFAULT_MODEL)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--edits", default="eye,facings,claim")
    ap.add_argument("--price", type=float, default=None)
    ap.add_argument("--planogram", default=None)
    a = ap.parse_args()
    edits = a.edits.split(",") + (["price"] if a.price is not None and "price" not in a.edits else [])
    out = optimise(a.product, a.agents, [int(s) for s in a.seeds.split(",")], a.models.split(","), a.mock,
                   edits, a.price, a.planogram)
    for r in out["results"]:
        print(json.dumps(r))
    print("wrote", out["_path"])


if __name__ == "__main__":
    main()

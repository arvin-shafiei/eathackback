"""Shopper simulation CLI.

python3 sim/run.py --agents 20 --models google/gemini-2.5-flash --planogram data/store/planogram.json --seed 1
python3 sim/run.py --agents 20 --mock          # no API, deterministic heuristic decisions

Each agent: sampled persona (+ OCEAN jitter) -> path through units relevant to its mission plus random
browsing -> per product a notice gate (sim/notice.py, no LLM) -> one LLM call per slot for the products
it noticed -> events in CONTRACT shape. Stats carry Wilson 95% CIs.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import math
import os
import random
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import notice  # noqa: E402
import prompts  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
RUNS_DIR = os.path.join(ROOT, "data", "sim", "runs")
DEFAULT_MODEL = "google/gemini-2.5-flash"

MISSION_CATEGORIES = {
    "_source": "assumption: which store units each mission sends a shopper to; built from the mission descriptions in data/personas/staged_personas_v1.json (e.g. meal deal = main+snack+drink). A persona can override with mission_categories.",
    "weekly_shop": ["breakfast_cereal", "yoghurt", "plant_milk_dairy_alt", "biscuits_chocolate",
                    "ready_meals_soup", "crisps_savoury"],
    "meal_deal": ["soft_drinks", "crisps_savoury", "snack_bars"],
    "top_up": ["plant_milk_dairy_alt", "yoghurt", "ready_meals_soup"],
    "treat": ["biscuits_chocolate", "crisps_savoury", "soft_drinks"],
    "gym": ["snack_bars", "yoghurt", "soft_drinks"],
}


# ---------------------------------------------------------------- loading
def _first_existing(*paths):
    for p in paths:
        if p and os.path.exists(p):
            return p
    return None


def load_json(path):
    with open(path) as f:
        return json.load(f)


def load_store():
    p = _first_existing(os.path.join(ROOT, "data/store/store.config.json"), os.path.join(FIX, "store.config.json"))
    return load_json(p), os.path.relpath(p, ROOT)


def load_planogram(planogram):
    if isinstance(planogram, dict):
        return planogram, "inline"
    p = _first_existing(planogram and os.path.join(ROOT, planogram) if planogram and not os.path.isabs(planogram) else planogram,
                        os.path.join(ROOT, "data/store/planogram.json"), os.path.join(FIX, "planogram.json"))
    return load_json(p), os.path.relpath(p, ROOT)


def load_catalog(planogram: dict | None = None):
    real = os.path.join(ROOT, "data/products/catalog.json")
    paths = [real, os.path.join(FIX, "catalog.json")]
    cat = {}
    used = []
    for p in paths:
        if os.path.exists(p):
            for x in load_json(p):
                cat.setdefault(str(x["code"]), x)
            used.append(os.path.relpath(p, ROOT))
            # stop after the real catalog unless the planogram references fixture codes
            if p == real and (planogram is None or all(c in cat for s in planogram.values() for c in s.get("products", []))):
                break
    return cat, used


def load_personas():
    out = []
    files = sorted(glob.glob(os.path.join(ROOT, "data/personas/lens/*.json")))
    src = "data/personas/lens/*.json"
    if not files and os.path.exists(os.path.join(ROOT, "data/personas/personas.json")):
        files = [os.path.join(ROOT, "data/personas/personas.json")]
        src = "data/personas/personas.json"
    if not files:
        files = sorted(glob.glob(os.path.join(FIX, "personas/*.json")))
        src = "sim/fixtures/personas/*.json"
    for fp in files:
        d = load_json(fp)
        items = d if isinstance(d, list) else d.get("personas", [d]) if isinstance(d, dict) else []
        for p in items:
            if isinstance(p, dict) and p.get("id"):
                out.append(normalise_persona(p, fp))
    return out, src


def normalise_persona(p, fp):
    p = dict(p)
    p.setdefault("archetype", p["id"])
    p["ocean"] = {k: float(v) for k, v in (p.get("ocean") or {}).items() if k in "OCEAN"}
    p.setdefault("mission", "weekly_shop")
    p["sim_parameters"] = p.get("sim_parameters") or p.get("sim_params") or {}
    try:
        p["budget_gbp"] = float(p.get("budget_gbp") or 0) or None
    except Exception:
        p["budget_gbp"] = None
    p["_file"] = os.path.relpath(fp, ROOT)
    return p


# ---------------------------------------------------------------- helpers
def hu(*parts) -> float:
    """Deterministic uniform(0,1) from a key: common random numbers across runs/edits."""
    h = hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()
    return int(h[:13], 16) / float(16 ** 13)


def wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return [0.0, 0.0]
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


def jitter_ocean(base: dict, rng: random.Random) -> dict:
    sd = notice.coefficients()["ocean_jitter_sd"]["value"]
    return {t: round(min(1.0, max(0.0, float(base.get(t, 0.5)) + rng.gauss(0, sd))), 3) for t in "OCEAN"}


def spawn_agents(personas, n, models, seed):
    rng = random.Random(f"spawn-{seed}")
    agents = []
    # stratified: cycle through personas in shuffled order so every archetype appears
    order = []
    while len(order) < n:
        block = personas[:]
        rng.shuffle(block)
        order += block
    for i in range(n):
        p = order[i]
        arng = random.Random(f"{seed}-a{i}")
        agents.append({"agent_id": f"a{i+1:03d}", "persona": p, "model": models[i % len(models)],
                       "ocean": jitter_ocean(p.get("ocean", {}), arng)})
    return agents


def unit_order(store):
    return sorted(store["units"], key=lambda u: (u.get("aisle", 0), u.get("side", "")))


# ---------------------------------------------------------------- mock decisions
GIMMICK_WORDS = ("protein", "prebiotic", "now ", "new", "zero")
TRIGGER_WORDS = ("sucralose", "aspartame", "acesulfame", "emulsifier", "isolate", "palm", "flavouring")


def mock_decide(persona, ocean, cards, budget_left, rng_key):
    sp = persona.get("sim_parameters", {}) or {}
    price_s = float(sp.get("price_sensitivity_0_1", 0.5))
    trust_new = float(sp.get("trust_new_brand_0_1", 0.3))
    react = float(sp.get("gimmick_reactance_0_1", 0.4))
    best, best_s = None, -9
    worst, worst_s, worst_why = None, 9, ""
    for c in cards:
        s = -price_s * (c.get("price_gbp") or 2) / 2 + (0.3 if "challenger" not in c.get("_role", "") else trust_new - 0.3)
        why = ""
        ing = (c.get("back_of_pack", {}) or {}).get("ingredients", "").lower()
        hits = [w for w in TRIGGER_WORDS if w in ing]
        if hits:
            s -= 0.6
            why = f"it's got {hits[0]} in it, no thanks"
        if any(w in (c.get("pack_copy") or "").lower() for w in GIMMICK_WORDS):
            s -= react * 0.5
            why = why or "feels like a gimmick for the price"
        s += (hu(rng_key, c["code"]) - 0.5) * 0.8
        if s > best_s:
            best, best_s = c, s
        if s < worst_s:
            worst, worst_s, worst_why = c, s, why or "too dear for what it is"
    if best and best_s > 0.05 and (budget_left is None or (best.get("price_gbp") or 0) <= budget_left):
        return {"decision": "pick", "product": best["code"], "reason": "[mock] fine, that'll do, it's what I'd usually grab",
                "attributes_cited": ["price_gbp", "brand"], "feeling": "fine", "sentiment": 0.3,
                "mechanism": "habit" if "challenger" not in best.get("_role", "") else "novelty", "others": {}}
    if worst and worst_s < -0.6:
        return {"decision": "reject", "product": worst["code"], "reason": f"[mock] {worst_why}",
                "attributes_cited": ["ingredients_text" if "in it" in worst_why else "price_gbp"],
                "feeling": "meh", "sentiment": -0.4, "mechanism": "gimmick_reactance" if "gimmick" in worst_why else "price_anchor",
                "others": {}}
    return {"decision": "walk_past", "product": cards[0]["code"], "reason": "[mock] don't need any of that today",
            "attributes_cited": [], "feeling": "indifferent", "sentiment": 0.0, "mechanism": "indifference", "others": {}}


# ---------------------------------------------------------------- one agent
def simulate_agent(a, ctx):
    persona, ocean, model = a["persona"], a["ocean"], a["model"]
    pid, aid, seed = persona["id"], a["agent_id"], ctx["seed"]
    sp = persona.get("sim_parameters", {}) or {}
    mission = persona.get("mission", "weekly_shop")
    mcats = persona.get("mission_categories") or MISSION_CATEGORIES.get(mission, [])
    budget = persona.get("budget_gbp")
    budget_left = float(budget) if budget else None
    reads_labels = hu(seed, aid, "labels") < notice.p_reads_labels(ocean, sp)
    browse_p = notice.coefficients()["browse_prob"]["value"]
    plan, catalog, store = ctx["planogram"], ctx["catalog"], ctx["store"]
    path, events, basket = [], [], []
    calls = {"llm": 0, "cached": 0, "cost": 0.0, "errors": []}
    step = 0
    for u in unit_order(store):
        on_mission = u["category"] in mcats
        if not on_mission and hu(seed, aid, "browse", u["id"]) >= browse_p:
            continue
        for r in range(1, int(store.get("rows_per_unit", 3)) + 1):
            sid = f"{u['id']}-r{r}"
            slot = plan.get(sid)
            if not slot or not slot.get("products"):
                continue
            path.append(sid)
            prods = [c for c in slot["products"] if c in catalog]
            n = len(prods)
            noticed, slot_events = [], {}
            for pos, code in enumerate(prods):
                prod = catalog[code]
                fac = int((slot.get("facings") or {}).get(code, 1))
                p, factors = notice.p_notice(row=r, facings=fac, pos=pos, n_in_set=n, on_mission=on_mission,
                                             ocean=ocean, role=prod.get("role", ""), persona_params=sp,
                                             nutriscore=prod.get("nutriscore", ""), category=u["category"])
                is_noticed = hu(seed, aid, "notice", code) < p
                ev = {"step": step, "slot": sid, "product": code, "p_notice": round(p, 4),
                      "notice_factors": factors, "noticed": is_noticed,
                      "decision": "not_noticed", "reason": "", "attributes_cited": [], "feeling": "",
                      "sentiment": None, "mechanism": "", "source_refs": ["sim/coefficients.json"]}
                slot_events[code] = ev
                step += 1
                if is_noticed:
                    noticed.append((code, prod, fac))
            if noticed:
                cards = [prompts.product_card(prod, reads_labels=reads_labels, row_name=notice.ROW_NAMES[r],
                                              facings=fac) for code, prod, fac in noticed]
                if ctx["mock"]:
                    for c, (_, prod, _) in zip(cards, noticed):
                        c["_role"] = prod.get("role", "")
                    out = mock_decide(persona, ocean, cards, budget_left, f"{seed}-{aid}-{sid}")
                    src = "mock heuristic (sim/run.py mock_decide), not an LLM"
                else:
                    import llm
                    sysp = prompts.system_prompt(persona, ocean, budget_left)
                    userp = prompts.user_prompt(cards, u["category"], reads_labels, basket, on_mission)
                    try:
                        res = llm.chat_json(model, sysp, userp, max_tokens=ctx["max_tokens"], tag=f"{pid}:{sid}")
                        out = res["data"]
                        calls["llm"] += 1
                        calls["cached"] += int(res["cached"])
                        calls["cost"] += res["cost"]
                        src = f"LLM {model} (persona prompt sim/prompts.py)"
                    except llm.SpendGuardTripped:
                        raise
                    except Exception as e:
                        calls["errors"].append(str(e)[:200])
                        out = {"decision": "walk_past", "product": noticed[0][0], "reason": "(llm error)",
                               "mechanism": "error", "others": {}}
                        src = "llm error"
                apply_decision(out, noticed, slot_events, catalog, src, reads_labels)
                # budget enforcement (honest override, flagged)
                for code, ev in slot_events.items():
                    if ev["decision"] == "pick":
                        price = float(catalog[code].get("price_gbp") or 0)
                        if budget_left is not None and price > budget_left + 1e-9:
                            ev["decision"] = "reject"
                            ev["llm_decision"] = "pick"
                            ev["budget_override"] = True
                            ev["mechanism"] = "budget"
                        else:
                            if budget_left is not None:
                                budget_left -= price
                            basket.append(catalog[code].get("name", code))
            events.extend(slot_events[c] for c in prods)
    return {"agent_id": aid, "persona_id": pid, "archetype": persona.get("archetype"),
            "model": "mock" if ctx["mock"] else model, "ocean": ocean, "mission": mission,
            "reads_labels": reads_labels, "budget_gbp": budget,
            "budget_left": round(budget_left, 2) if budget_left is not None else None,
            "path": path, "events": events, "calls": calls}


def apply_decision(out, noticed, slot_events, catalog, src, reads_labels):
    codes = [c for c, _, _ in noticed]
    dec = str(out.get("decision", "walk_past")).lower().strip()
    if dec not in prompts.DECISIONS:
        dec = "walk_past"
    focal = str(out.get("product", "")).strip()
    if focal not in codes:
        # tolerate name instead of code
        focal = next((c for c in codes if catalog[c].get("name", "").lower() == focal.lower()), None)
    others = out.get("others") or {}
    try:
        sent = max(-1.0, min(1.0, float(out.get("sentiment", 0))))
    except Exception:
        sent = 0.0
    for c in codes:
        ev = slot_events[c]
        ev["source_refs"] = ev["source_refs"] + [src]
        ev["label_read"] = reads_labels
        if focal is None and dec != "pick":
            d = dec
        elif c == focal:
            d = dec
        else:
            d = str(others.get(c, "walk_past")).lower()
            d = d if d in ("reject", "walk_past") else "walk_past"
        ev["decision"] = d
        if c == focal or focal is None:
            ev["reason"] = str(out.get("reason", ""))[:300]
            ev["attributes_cited"] = out.get("attributes_cited", []) or []
            ev["feeling"] = str(out.get("feeling", ""))[:40]
            ev["sentiment"] = sent
            ev["mechanism"] = str(out.get("mechanism", ""))[:40]
        else:
            fn = catalog[focal].get("name", focal) if focal else ""
            ev["reason"] = f"(secondary: attention went to {fn}, decision on that was '{dec}')"
            ev["secondary"] = True
            ev["mechanism"] = "secondary"


# ---------------------------------------------------------------- stats
def compute_stats(agents, catalog):
    per = {}
    for a in agents:
        o = a["ocean"]
        segs = [f"{t}_{'high' if float(o.get(t, 0.5)) >= 0.5 else 'low'}" for t in "OCEAN"]
        for ev in a["events"]:
            s = per.setdefault(ev["product"], {"shown": 0, "noticed": 0, "considered": 0, "picked": 0, "rejected": 0,
                                               "walk_past": 0, "_sent": [], "_rej": [], "by_archetype": {},
                                               "by_ocean_segment": {}})
            s["shown"] += 1
            d = ev["decision"]
            if ev["noticed"]:
                s["noticed"] += 1
            if d in ("pick", "reject"):
                s["considered"] += 1
            if d == "pick":
                s["picked"] += 1
            elif d == "reject":
                s["rejected"] += 1
                if not ev.get("secondary"):
                    s["_rej"].append({"reason": ev["reason"], "mechanism": ev["mechanism"],
                                      "persona_id": a["persona_id"], "agent_id": a["agent_id"]})
            elif d == "walk_past":
                s["walk_past"] += 1
            if ev.get("sentiment") is not None and not ev.get("secondary"):
                s["_sent"].append(ev["sentiment"])
            for bucket, key in [("by_archetype", a.get("archetype") or a["persona_id"])] + \
                               [("by_ocean_segment", sg) for sg in segs]:
                b = s[bucket].setdefault(key, {"shown": 0, "noticed": 0, "picked": 0, "rejected": 0})
                b["shown"] += 1
                b["noticed"] += int(ev["noticed"])
                b["picked"] += int(d == "pick")
                b["rejected"] += int(d == "reject")
    for code, s in per.items():
        s["pick_rate"] = round(s["picked"] / s["shown"], 4) if s["shown"] else 0
        s["ci95"] = wilson(s["picked"], s["shown"])
        s["notice_rate"] = round(s["noticed"] / s["shown"], 4) if s["shown"] else 0
        s["pick_rate_given_noticed"] = round(s["picked"] / s["noticed"], 4) if s["noticed"] else 0
        s["ci95_given_noticed"] = wilson(s["picked"], s["noticed"])
        for bucket in ("by_archetype", "by_ocean_segment"):
            for b in s[bucket].values():
                b["pick_rate"] = round(b["picked"] / b["shown"], 4) if b["shown"] else 0
                b["ci95"] = wilson(b["picked"], b["shown"])
        groups = {}
        for r in s["_rej"]:
            g = groups.setdefault(r["mechanism"] or "other", {"mechanism": r["mechanism"] or "other", "count": 0, "examples": []})
            g["count"] += 1
            if len(g["examples"]) < 3:
                g["examples"].append(r)
        s["top_reject_reasons"] = sorted(groups.values(), key=lambda g: -g["count"])[:5]
        s["mean_sentiment"] = round(sum(s["_sent"]) / len(s["_sent"]), 3) if s["_sent"] else None
        s["name"] = catalog.get(code, {}).get("name", "")
        s["role"] = catalog.get(code, {}).get("role", "")
        del s["_sent"], s["_rej"]
    return {"per_product": per,
            "method": {"pick_rate": "picked / shown (shown = agent passed the slot)",
                       "ci95": "Wilson score interval, z=1.96",
                       "by_ocean_segment": "trait >= 0.5 is high, else low (agent's jittered OCEAN)"}}


# ---------------------------------------------------------------- driver
def run_simulation(*, planogram=None, agents=10, models=None, seed=1, mock=False, max_tokens=250,
                   workers=8, only_agents=None, save=True, run_id=None, label="", catalog_patch=None):
    models = models or [DEFAULT_MODEL]
    store, store_src = load_store()
    plan, plan_src = load_planogram(planogram)
    catalog, cat_src = load_catalog(plan)
    if catalog_patch:
        catalog = dict(catalog)
        for code, upd in catalog_patch.items():
            catalog[code] = {**catalog[code], **upd}
    personas, pers_src = load_personas()
    if not personas:
        raise RuntimeError("no personas found")
    specs = spawn_agents(personas, int(agents), models, seed)
    if only_agents is not None:
        specs = [s for s in specs if s["agent_id"] in set(only_agents)]
    ctx = {"seed": seed, "mock": mock, "max_tokens": max_tokens, "planogram": plan, "catalog": catalog, "store": store}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        results = list(ex.map(lambda a: simulate_agent(a, ctx), specs))
    cost = sum(a["calls"]["cost"] for a in results)
    run_id = run_id or f"run_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}_s{seed}{'_mock' if mock else ''}_{os.urandom(2).hex()}"
    run = {"run_id": run_id, "created": dt.datetime.now().isoformat(timespec="seconds"), "label": label,
           "planogram": plan_src, "models": ["mock"] if mock else models, "seed": seed, "mock": mock,
           "inputs": {"store": store_src, "catalog": cat_src, "personas": pers_src,
                      "coefficients": "sim/coefficients.json", "max_tokens": max_tokens},
           "agents": results,
           "stats": compute_stats(results, catalog),
           "notice_model": notice.explain(),
           "mission_categories": MISSION_CATEGORIES,
           "cost": {"usd": round(cost, 5), "llm_calls": sum(a["calls"]["llm"] for a in results),
                    "cached": sum(a["calls"]["cached"] for a in results),
                    "errors": sum(len(a["calls"]["errors"]) for a in results)}}
    if isinstance(planogram, dict):
        run["planogram_inline"] = plan
    if save:
        os.makedirs(RUNS_DIR, exist_ok=True)
        with open(os.path.join(RUNS_DIR, run_id + ".json"), "w") as f:
            json.dump(run, f, indent=1, ensure_ascii=False)
    return run


def summarise(run, top=8):
    lines = [f"run {run['run_id']}  agents={len(run['agents'])}  models={run['models']}  cost=${run['cost']['usd']}"
             f"  calls={run['cost']['llm_calls']} cached={run['cost']['cached']} errors={run['cost']['errors']}"]
    pp = sorted(run["stats"]["per_product"].items(), key=lambda kv: -kv[1]["pick_rate"])
    for code, s in pp[:top]:
        lines.append(f"  {code:>14} {s['name'][:34]:34} shown={s['shown']:3} noticed={s['noticed']:3} "
                     f"picked={s['picked']:3} rej={s['rejected']:3} pick={s['pick_rate']:.2f} ci={s['ci95']}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--agents", type=int, default=10)
    ap.add_argument("--models", default=DEFAULT_MODEL)
    ap.add_argument("--planogram", default=None)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--max-tokens", type=int, default=250)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--label", default="")
    a = ap.parse_args()
    run = run_simulation(planogram=a.planogram, agents=a.agents, models=a.models.split(","), seed=a.seed,
                         mock=a.mock, max_tokens=min(a.max_tokens, 300), workers=a.workers, label=a.label)
    print(summarise(run))
    print("wrote", os.path.join("data/sim/runs", run["run_id"] + ".json"))


if __name__ == "__main__":
    main()

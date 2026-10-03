"""Multi-visit loop: re-layout insurance (the personal route, after pressure testing).

Spec: docs/ideas/personal-route-spec.md. Engine: TypeSafe Jev only (sim/jev.py), or `--engine mock` for a $0
dry run. No OpenRouter / LLM calls anywhere in this file.

What it answers (in simulation only): "If I re-lay out the store and list new challengers, what does it cost
the shoppers who know the route, and how much of that does an opt-in route card win back, without making me
lose impulse spend?"

Engine changes of spec section 2 are implemented HERE as a visit-aware port of sim/run.simulate_agent
(`simulate_agent_v`), not as edits to run.py (this build may only create sim/visits.py, sim/routes.py and
data/sim/visits/**). With visit=None and no overrides the port reproduces run.simulate_agent exactly; that
is asserted (assertions.port_equals_run_py and assertions.visit_none_reproduces_s11).

    python3 sim/visits.py run --engine mock --agents-per-persona 1 --seeds 21
    python3 sim/visits.py run --agents-per-persona 4 --seeds 21,22,23 --visits 4 --relayout-at 3 \
        --relayout data/sim/layout/planogram_retailer.json --new-skus auto --p-search-moved 0.5 --route-card-logit 0
    python3 sim/visits.py sweep --base <run_id> --seeds 21 --p-search-moved 0.25,0.75,1.0 --route-card-logit 0.5,1.0
    python3 sim/visits.py eval --run <run_id> --train-run run_20261003_120823_s11_jev_4482 --compliance 0.2,0.5,0.8 --tau 0.5
    python3 sim/visits.py card --run <run_id> --agent s21:a007 --visit 3
    python3 sim/visits.py assert --run <run_id>          # reproducibility assertions (Jev from cache)
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import math
import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import notice  # noqa: E402
import prompts  # noqa: E402
import run as simrun  # noqa: E402  (import only, never edited)
import routes  # noqa: E402
import layout_optimise as LO  # noqa: E402

from run import hu, unit_order, mock_decide, apply_decision, stage_of, wilson  # noqa: E402

OUT_DIR = os.path.join(ROOT, "data", "sim", "visits")
RUNS_DIR = os.path.join(ROOT, "data", "sim", "runs")
AS_BUILT = "data/store/planogram.json"
RELAYOUT = "data/sim/layout/planogram_retailer.json"
REPORT = "data/sim/layout/report_retailer.json"
TRAIN_RUN = "run_20261003_120823_s11_jev_4482"

SENSITIVE = routes.SENSITIVE
REACTANCE_LOW = ("protein_sceptic_gimmick_reactant", "habit_loyalist_shrinkflation_angry", "frugal_unit_price")

ASSUMPTIONS = {
    "p_search_moved": {"value": 0.5, "sweep": [0.25, 0.75, 1.0],
                       "source": "assumption; direction from research/03 Truth 2 'can't be bothered to look' (r/britishproblems 1uosc29, 507 pts). 1.0 is the decomposition reference (always finds a moved category)"},
    "compliance_c": {"value": 0.2, "sweep": [0.2, 0.5, 0.8],
                     "source": "assumption; there is no grounded card-follow rate. Headline at the conservative end"},
    "reactance_k": {"value": {"default": 1.0, **{k: 0.25 for k in REACTANCE_LOW}},
                    "source": "assumption; Brehm 1966; White et al. 2008; research/03:57"},
    "route_card_logit": {"value": 0.0, "sweep": [0.5, 1.0],
                         "source": "assumption; nothing in sim/notice.py models 'told to look'. Spec asks for it in coefficients.json; kept here because this build may not edit coefficients.json"},
    "tau": {"value": 0.5, "source": "assumption: abstain threshold on max posterior"},
    "lambda": {"value": 0.5, "sweep": [0.25, 0.5, 0.75], "source": "assumption: next-basket mix weight"},
    "visit1_route": {"value": "units holding mission categories (as built)",
                     "source": "assumption: shoppers know the as-built store (research/03 Truth 2, memorised route)"},
    "habit_formation": {"value": "not modelled beyond the injected memory line",
                        "source": "Lally et al. 2010 (median ~66 days): one trial is not a habit; 'repeat' means v3 -> v4 only"},
    "browse_prob": {"value": notice.coefficients()["browse_prob"]["value"], "source": "sim/coefficients.json browse_prob (existing)"},
    "walk_speed_mps": {"value": LO.PARAMS["walk_speed_mps"]["value"], "source": "sim/layout_optimise.PARAMS (existing)"},
    "compliance_draw": {"value": "hu(seed, agent, 'comply', 3) < c * reactance_k, drawn once at the first card (visit 3) and kept for visit 4",
                        "source": "deviation from spec 4.2 (which keys the draw by visit): a per-visit draw would need 4 visit-4 histories per shopper; the opt-in is modelled as a shopper-level decision so each shopper has exactly two potential paths (card path, control path)"},
    "memory_line": {"value": "visits >= 2: third `habits` entry in the Jev shopper state, 'usually buys: <name> (n/v visits), ...' (top 4 by count)",
                    "source": "labelled injection, memory_injected_by: sim/visits.py; off with --no-memory-state"},
    "hfss_rule": {"value": "exclude hfss OR barred_from_restricted (in scope with uncertain data)",
                  "source": "sim/layout_optimise.hfss, conservative reading of 'never offers an HFSS product'"},
    "p_take_card": {"value": "P(pick_up|looked) * P(take|picked_up) from the surrogate, mixed by posterior",
                    "source": "data/sim/layout/surrogate.json (cached Jev Nouls, no new calls)"},
}

_tl = threading.local()


# ---------------------------------------------------------------- memory line injection (spec 2.5)
def _install_memory_hook():
    import jev
    if getattr(jev, "_visits_hooked", False):
        return
    orig = jev.shopper_state

    def shopper_state(*a, **k):
        s = orig(*a, **k)
        ml = getattr(_tl, "memory_line", None)
        if ml:
            s = {**s, "habits": list(s["habits"]) + [ml[:160]]}
        return s
    jev.shopper_state = shopper_state
    jev._visits_hooked = True


# ---------------------------------------------------------------- the visit-aware engine (spec 2.1-2.5)
def simulate_agent_v(a, ctx):
    """run.simulate_agent + visit salt, planogram unit categories, route override, carded-SKU notice term and
    memory line. With ctx visit=None and no route_units/extra_logit/memory_line it is run.simulate_agent."""
    persona, ocean, model = a["persona"], a["ocean"], a["model"]
    pid, aid, seed = persona["id"], a["agent_id"], ctx["seed"]
    visit = ctx.get("visit")
    dk = aid if visit is None else f"{aid}#v{visit}"
    sp = persona.get("sim_parameters", {}) or {}
    mission = persona.get("mission", "weekly_shop")
    mcats = persona.get("mission_categories") or simrun.MISSION_CATEGORIES.get(mission, [])
    budget = persona.get("budget_gbp")
    budget_left = float(budget) if budget else None
    reads_labels = hu(seed, dk, "labels") < notice.p_reads_labels(ocean, sp)
    browse_p = notice.coefficients()["browse_prob"]["value"]
    plan, catalog, store = ctx["planogram"], ctx["catalog"], ctx["store"]
    ucats = routes.unit_categories(store, plan)
    route_units = ctx.get("route_units")
    route_units = set(route_units) if route_units is not None else None
    extra = ctx.get("extra_logit") or {}
    path, events, basket = [], [], []
    visited = {}
    engine = ctx["engine"]
    calls = {"llm": 0, "cached": 0, "cost": 0.0, "errors": [], "input_tokens": 0, "cost_if_uncached": 0.0}
    jev_model = None
    step = 0
    _tl.memory_line = ctx.get("memory_line")
    try:
        for u in unit_order(store):
            on_mission = bool(ucats[u["id"]] & set(mcats))
            if route_units is not None:
                if u["id"] in route_units:
                    how = "route"
                elif hu(seed, dk, "browse", u["id"]) < browse_p:
                    how = "browse"
                else:
                    continue
            else:
                if not on_mission and hu(seed, dk, "browse", u["id"]) >= browse_p:
                    continue
                how = "mission" if on_mission else "browse"
            visited[u["id"]] = how
            for r in range(1, int(store.get("rows_per_unit", 3)) + 1):
                sid = f"{u['id']}-r{r}"
                slot = plan.get(sid)
                if not slot or not slot.get("products"):
                    continue
                shelf_cat = slot.get("category") or u["category"]
                path.append(sid)
                prods = [c for c in slot["products"] if c in catalog]
                n = len(prods)
                noticed, slot_events = [], {}
                for pos, code in enumerate(prods):
                    prod = catalog[code]
                    fac = int((slot.get("facings") or {}).get(code, 1))
                    p, factors = notice.p_notice(row=r, facings=fac, pos=pos, n_in_set=n, on_mission=on_mission,
                                                 ocean=ocean, role=prod.get("role", ""), persona_params=sp,
                                                 nutriscore=prod.get("nutriscore", ""), category=shelf_cat)
                    if code in extra:
                        x = float(extra[code])
                        factors["logit_terms"]["route_card"] = x
                        factors["route_card_source"] = "route card (sim/visits.py); route_card_logit assumption"
                        if x != 0.0:
                            p = notice.sigmoid(notice.logit(p) + x)
                    is_noticed = hu(seed, dk, "notice", code) < p
                    ev = {"step": step, "slot": sid, "product": code, "p_notice": round(p, 4),
                          "notice_factors": factors, "noticed": is_noticed,
                          "decision": "not_noticed", "reason": "", "attributes_cited": [], "feeling": "",
                          "sentiment": None, "mechanism": "", "source_refs": ["sim/coefficients.json"]}
                    slot_events[code] = ev
                    step += 1
                    if is_noticed:
                        noticed.append((code, prod, fac))
                if noticed and engine == "jev":
                    import jev
                    try:
                        res = jev.decide_slot(persona=persona, ocean=ocean, mission=mission, budget_left=budget_left,
                                              category=shelf_cat, on_mission=on_mission, basket=basket,
                                              noticed=noticed, reads_labels=reads_labels,
                                              draw_u=hu(seed, dk, "jev_decide", sid),
                                              pickup_draws=[hu(seed, dk, "pickup", c) for c, _, _ in noticed],
                                              rng_key=f"jev-order-{seed}-{aid}-{sid}", tag=f"{pid}:{sid}")
                        for rq in res["requests"]:
                            jev_model = rq["jev_model"]
                            calls["llm"] += 1
                            calls["cached"] += int(rq["cached"])
                            calls["cost"] += rq["cost_usd"]
                            calls["input_tokens"] += int(rq["input_tokens"] or 0)
                            calls["cost_if_uncached"] += rq["cost_if_uncached_usd"]
                        for code, upd in res["per_product"].items():
                            ev = slot_events[code]
                            refs = ev["source_refs"] + upd.pop("source_refs")
                            ev.update(upd)
                            ev["source_refs"] = refs
                            ev["label_read"] = reads_labels
                    except jev.JevSpendGuard:
                        raise
                    except Exception as e:
                        calls["errors"].append(f"jev: {e!r}"[:200])
                        for code, _, _ in noticed:
                            slot_events[code].update(decision="walk_past", stage_reached="looked", reason="(jev error)",
                                                     mechanism="error", engine="jev", label_read=reads_labels)
                elif noticed:
                    cards = [prompts.product_card(prod, reads_labels=reads_labels, row_name=notice.ROW_NAMES[r],
                                                  facings=fac) for code, prod, fac in noticed]
                    if engine == "mock":
                        for c, (_, prod, _) in zip(cards, noticed):
                            c["_role"] = prod.get("role", "")
                        out = mock_decide(persona, ocean, cards, budget_left, f"{seed}-{dk}-{sid}")
                        src = "mock heuristic (sim/run.py mock_decide), not an LLM"
                    else:
                        raise ValueError(f"engine {engine!r} not allowed here (jev or mock only)")
                    apply_decision(out, noticed, slot_events, catalog, src, reads_labels)
                    for code, ev in slot_events.items():
                        if ev["decision"] == "pick":
                            price = float(catalog[code].get("price_gbp") or 0)
                            if budget_left is not None and price > budget_left + 1e-9:
                                ev["decision"] = "reject"
                                ev["llm_decision"] = "pick"
                                ev["engine_decision"] = "pick"
                                ev["stage_reached"] = "put_back"
                                ev["picked_up"] = True
                                ev["reason"] = (ev.get("reason") or "") + f" -> over budget (£{price:.2f} > £{budget_left:.2f} left), put back"
                                ev["budget_override"] = True
                                ev["mechanism"] = "budget"
                            else:
                                if budget_left is not None:
                                    budget_left -= price
                                basket.append(catalog[code].get("name", code))
                for c in prods:
                    ev = slot_events[c]
                    ev.setdefault("stage_reached", stage_of(ev))
                    ev.setdefault("p_pick_up", None)
                events.extend(slot_events[c] for c in prods)
    finally:
        _tl.memory_line = None
    out = {"agent_id": aid, "persona_id": pid, "archetype": persona.get("archetype"),
           "model": "mock" if engine == "mock" else (jev_model or "jev-latest"),
           "engine": engine, "ocean": ocean, "mission": mission,
           "reads_labels": reads_labels, "budget_gbp": budget,
           "budget_left": round(budget_left, 2) if budget_left is not None else None,
           "path": path, "events": events, "calls": calls}
    if visit is not None or route_units is not None:
        out["visit"] = visit
        out["visited_units"] = visited
    return out


# ---------------------------------------------------------------- environment
def load_env(relayout=RELAYOUT, new_skus="auto"):
    store, _ = simrun.load_store()
    built = json.load(open(os.path.join(ROOT, AS_BUILT)))
    relay = json.load(open(os.path.join(ROOT, relayout)))
    catalog, _ = simrun.load_catalog(built)
    personas, psrc = simrun.load_personas()
    report = json.load(open(os.path.join(ROOT, REPORT))) if os.path.exists(os.path.join(ROOT, REPORT)) else None
    if new_skus == "auto":
        new, rule_rows = pick_new_skus(catalog, relay)
    else:
        new = [c.strip() for c in new_skus.split(",") if c.strip()]
        rule_rows = [{"code": c, "rule": "given on the command line"} for c in new]
    plan12 = withhold(built, new)
    nut = LO.nutrition(list(catalog))
    hf = {c: LO.hfss(p, nut.get(c)) for c, p in catalog.items()}
    sur = json.load(open(LO.SURROGATE_PATH))["entries"]
    S = LO.surrogate_table(personas, catalog, sur)
    return {"store": store, "catalog": catalog, "personas": personas, "personas_src": psrc,
            "plan_built": built, "plan_v12": plan12, "plan_relayout": relay, "relayout_src": relayout,
            "report": report, "new_skus": new, "new_sku_rule": rule_rows, "hfss": hf, "surrogate": S,
            "persona_ids": {p["archetype"]: p["id"] for p in personas}}


def pick_new_skus(catalog, relay):
    """Per category, withhold the challenger with the fewest facings in the re-layout; lowest barcode
    (numeric value, then string) breaks ties."""
    pos = LO.positions(relay)
    out, rows = [], []
    for cat in sorted({p["category"] for p in catalog.values()}):
        ch = [c for c, p in catalog.items() if p["category"] == cat and p.get("role") == "challenger" and c in pos]
        if not ch:
            continue
        ch.sort(key=lambda c: (pos[c]["facings"], int(c), c))
        out.append(ch[0])
        rows.append({"category": cat, "code": ch[0], "name": catalog[ch[0]].get("name"),
                     "facings_in_relayout": pos[ch[0]]["facings"], "relayout_slot": pos[ch[0]]["slot"],
                     "n_challengers": len(ch),
                     "rule": "challenger with the fewest facings in planogram_retailer.json; lowest barcode breaks ties"})
    return out, rows


def withhold(plan, codes):
    p = copy.deepcopy(plan)
    s = set(codes)
    for sid, slot in p.items():
        slot["products"] = [c for c in slot["products"] if c not in s]
        slot["facings"] = {c: f for c, f in (slot.get("facings") or {}).items() if c not in s}
    return p


def mission_cats(per):
    return list(per.get("mission_categories") or simrun.MISSION_CATEGORIES.get(per.get("mission", "weekly_shop"), []))


# ---------------------------------------------------------------- persona identifiability model (spec 5.1)
def size_bucket(n):
    return "size:0" if n == 0 else "size:1-3" if n <= 3 else "size:4-7" if n <= 7 else "size:8-11" if n <= 11 else "size:12+"


def tokens_sku(basket, catalog=None):
    return list(basket) + [size_bucket(len(basket))]


def tokens_mission(basket, catalog):
    return sorted({"cat:" + catalog[c]["category"] for c in basket if c in catalog}) + [size_bucket(len(basket))]


class NB:
    """Multinomial Naive Bayes, Laplace alpha=1, uniform prior. Visits multiply (independent given lens)."""

    def __init__(self, data, classes, featurise, catalog, alpha=1.0):
        self.classes = list(classes)
        self.featurise = featurise
        self.catalog = catalog
        self.alpha = alpha
        cnt = {k: {} for k in self.classes}
        vocab = set()
        for lens, basket in data:
            if lens not in cnt:
                continue
            for t in featurise(basket, catalog):
                cnt[lens][t] = cnt[lens].get(t, 0) + 1
                vocab.add(t)
        for c in catalog:  # every SKU is in the vocabulary even if never taken in training
            if featurise is tokens_sku:
                vocab.add(c)
        self.vocab = vocab
        self.V = len(vocab)
        self.tot = {k: sum(v.values()) for k, v in cnt.items()}
        self.cnt = cnt
        self.n_train = {k: sum(1 for l, _ in data if l == k) for k in self.classes}

    def logp(self, k, t):
        return math.log((self.cnt[k].get(t, 0) + self.alpha) / (self.tot[k] + self.alpha * self.V))

    def posterior(self, baskets):
        ll = {k: 0.0 for k in self.classes}
        for b in baskets:
            for t in self.featurise(b, self.catalog):
                for k in self.classes:
                    ll[k] += self.logp(k, t)
        m = max(ll.values())
        z = sum(math.exp(v - m) for v in ll.values())
        return {k: math.exp(ll[k] - m) / z for k in self.classes}

    def p_sku(self, k, universe):
        """P(sku | lens) over the available SKUs (renormalised), for posterior popularity."""
        w = {c: math.exp(self.logp(k, c)) for c in universe}
        z = sum(w.values())
        return {c: v / z for c, v in w.items()}


def load_train(train_run):
    r = json.load(open(os.path.join(RUNS_DIR, train_run + ".json")))
    data = []
    for a in r["agents"]:
        data.append((a.get("archetype"), [e["product"] for e in a["events"] if e["decision"] == "pick"]))
    return data, r


def inferable(personas):
    return sorted(p["archetype"] for p in personas if p["archetype"] not in SENSITIVE)


# ---------------------------------------------------------------- one shopper, all visits
def taken(rec):
    return [e["product"] for e in rec["events"] if e["decision"] == "pick"]


def found_cats(rec, ucats):
    out = {}
    for u in rec.get("visited_units", {}):
        for c in sorted(ucats[u]):
            out.setdefault(c, u)
    return out


def memory_line(mem, catalog):
    v = len(mem["baskets"])
    if v == 0 or not mem["bought"]:
        return None
    top = sorted(mem["bought"].items(), key=lambda kv: (-len(kv[1]), -max(kv[1]), kv[0]))[:4]
    parts = []
    for code, vs in top:
        nm = (catalog[code].get("name") or code)[:36]
        parts.append(f"{nm} ({len(vs)}/{v} visits)")
    line = "usually buys: " + ", ".join(parts)
    while len(line) > 160 and len(parts) > 1:
        parts.pop()
        line = "usually buys: " + ", ".join(parts)
    return line[:160]


def update_memory(mem, rec, visit, ucats, nb, catalog):
    mem = copy.deepcopy(mem)
    for c, u in found_cats(rec, ucats).items():
        mem["cat_unit"][c] = u
    b = taken(rec)
    for c in b:
        mem["bought"].setdefault(c, [])
        if visit not in mem["bought"][c]:
            mem["bought"][c].append(visit)
    mem["baskets"].append(b)
    mem["posterior"].append({k: round(v, 6) for k, v in nb.posterior(mem["baskets"]).items()})
    return mem


def compact_event(ev):
    k = {f: ev.get(f) for f in ("step", "slot", "product", "p_notice", "noticed", "decision", "stage_reached", "reason",
                                "mechanism", "p_pick_up", "picked_up", "label_read", "feeling", "sentiment")}
    nf = ev.get("notice_factors") or {}
    k["notice_logit_terms"] = nf.get("logit_terms")
    if nf.get("route_card_source"):
        k["route_card_source"] = nf["route_card_source"]
    j = ev.get("jev")
    if j:
        d = j.get("decision", {})
        k["jev"] = {"p_take": d.get("probabilities", {}).get(j.get("self")), "draw_u": d.get("draw_u"),
                    "sampled": d.get("sampled"), "appeal_score": (j.get("appeal") or {}).get("score"),
                    "cache_keys": [r["cache_key"] for r in j.get("requests", [])]}
    k["source_refs"] = (ev.get("source_refs") or [])[:3]
    return k


def pack(rec, *, arm, potential_outcome, visit, plan_name, route_plan, memory_before, card=None, memory_line_txt=None,
         card_undeclared=None, search_log=None):
    return {"visit": visit, "arm": arm, "potential_outcome": potential_outcome, "layout": plan_name,
            "planned_route": sorted(route_plan), "visited_units": rec.get("visited_units", {}),
            "search": search_log or [], "basket": taken(rec), "reads_labels": rec["reads_labels"],
            "memory_line": memory_line_txt,
            "memory_injected_by": "sim/visits.py" if memory_line_txt else None,
            "memory_before": memory_before, "card": card, "card_undeclared": card_undeclared,
            "calls": rec["calls"], "path": rec["path"],
            "events": [compact_event(e) for e in rec["events"]]}


def control_route(mem, plan, mcats, seed, dk, p_search, store):
    cu = routes.category_units(store, plan)
    planned = {mem["cat_unit"][c] for c in mcats if c in mem["cat_unit"]}
    extra, log = set(), []
    for c in mcats:
        now = cu.get(c, [])
        if not now or mem["cat_unit"].get(c) in now:
            continue
        if any(u in planned for u in now):
            log.append({"category": c, "remembered": mem["cat_unit"].get(c), "now": now,
                        "found_by": "already on the remembered route"})
            continue
        u = hu(seed, dk, "search", c)
        ok = u < p_search
        log.append({"category": c, "remembered": mem["cat_unit"].get(c), "now": now, "search_draw": round(u, 6),
                    "p_search_moved": p_search, "found_by": "search" if ok else "not found (browse draw only)"})
        if ok:
            extra |= set(now)
    return planned, extra, log


def shopper_paths(a, E, opt, nb):
    """All visits for one shopper: v1-v2 shared, v3-v4 both potential outcomes (control path, card path)."""
    per = a["persona"]
    arch = per["archetype"]
    seed = opt["seed"]
    aid = a["agent_id"]
    mcats = mission_cats(per)
    store, catalog = E["store"], E["catalog"]
    plans = {"v12": E["plan_v12"], "relayout": E["plan_relayout"]}
    ucats = {k: routes.unit_categories(store, p) for k, p in plans.items()}
    base_ctx = {"seed": seed, "engine": opt["engine"], "catalog": catalog, "store": store, "max_tokens": 250}
    mem0 = {"cat_unit": {}, "bought": {}, "baskets": [], "posterior": []}
    out = {"agent_id": aid, "seed": seed, "key": f"s{seed}:{aid}", "persona_id": per["id"], "archetype": arch,
           "mission": per.get("mission"), "mission_cats": mcats, "ocean": a["ocean"],
           "sensitive": arch in SENSITIVE, "visits": []}

    def sim(visit, plan_key, route_units, extra=None, ml=None):
        ctx = dict(base_ctx, visit=visit, planogram=plans[plan_key], route_units=route_units, extra_logit=extra or {},
                   memory_line=None if opt["no_memory_state"] else ml)
        return simulate_agent_v(a, ctx)

    # v1, v2 (shared)
    mem = mem0
    for v in (1, 2):
        if v == 1:
            planned = set(u for c in mcats for u in routes.category_units(store, plans["v12"]).get(c, []))
        else:
            planned = {mem["cat_unit"][c] for c in mcats if c in mem["cat_unit"]}
        ml = memory_line(mem, catalog) if v >= 2 else None
        rec = sim(v, "v12", planned, ml=ml)
        out["visits"].append(pack(rec, arm="shared", potential_outcome="shared", visit=v, plan_name="as_built_minus_new",
                                  route_plan=planned, memory_before=mem, memory_line_txt=None if opt["no_memory_state"] else ml))
        mem = update_memory(mem, rec, v, ucats["v12"], nb, catalog)
    mem_after_v2 = mem
    card_ctx = {"store": store, "catalog": catalog, "hfss": E["hfss"], "surrogate": E["surrogate"],
                "report": E["report"], "report_src": REPORT, "prev_plan": E["plan_built"],
                "persona_ids": E["persona_ids"], "route_card_logit": opt["route_card_logit"], "compliance": 0.2}
    for arm in ("control", "card"):
        mem = mem_after_v2
        for v in (3, 4):
            dk = f"{aid}#v{v}"
            ml = memory_line(mem, catalog)
            plan = plans["relayout"]
            card = card_und = None
            extra = {}
            search_log = []
            if arm == "control":
                planned, found_extra, search_log = control_route(mem, plan, mcats, seed, dk, opt["p_search_moved"], store)
                route_units = planned | found_extra
            else:
                post = mem["posterior"][-1] if mem["posterior"] else None
                view = {"persona": per, "memory": mem, "mission_cats": mcats, "visit": v, "tau": opt["tau"],
                        "detour": opt["detour"],
                        "declared_lens": arch if arch in SENSITIVE else None,
                        "declared_gates": arch in SENSITIVE}
                card = routes.card(view, plan, post, E["new_skus"], ctx=card_ctx)
                if arch in SENSITIVE:  # undeclared condition, code only (safety count, spec 5.1 d)
                    card_und = routes.card(dict(view, declared_lens=None, declared_gates=False), plan, post,
                                           E["new_skus"], ctx=card_ctx)
                    card_und = {"carded_sku": card_und["carded_sku"], "abstained_new_item": card_und["abstained_new_item"],
                                "gate_fail_true_persona": (__import__("swaps").gate_fail(per, catalog[card_und["carded_sku"]])
                                                           if card_und["carded_sku"] else None),
                                "hfss": bool(card_und["carded_sku"] and E["hfss"][card_und["carded_sku"]]["hfss"])}
                planned = set(routes.required_units(mem, plan, mcats, card["carded_sku"], store=store, detour=opt["detour"]))
                route_units = planned
                if card["carded_sku"]:
                    extra = {card["carded_sku"]: opt["route_card_logit"]}
            rec = sim(v, "relayout", route_units, extra=extra, ml=ml)
            out["visits"].append(pack(rec, arm=arm, potential_outcome=arm, visit=v, plan_name="retailer_relayout",
                                      route_plan=planned, memory_before=mem, card=card,
                                      memory_line_txt=None if opt["no_memory_state"] else ml,
                                      card_undeclared=card_und, search_log=search_log))
            mem = update_memory(mem, rec, v, ucats["relayout"], nb, catalog)
    return out


# ---------------------------------------------------------------- run
def do_run(opt):
    E = load_env(opt["relayout"], opt["new_skus"])
    if opt["engine"] == "jev":
        import jev
        jev.set_max_usd(opt["jev_max_usd"])
        _install_memory_hook()
    elif opt["engine"] != "mock":
        raise SystemExit("engine must be jev or mock")
    train, _ = load_train(opt["train_run"])
    nb = NB(train, inferable(E["personas"]), tokens_sku, E["catalog"])
    agents = []
    t0 = time.time()
    for seed in opt["seeds"]:
        specs = simrun.spawn_agents(E["personas"], opt["agents_per_persona"] * len(E["personas"]),
                                    ["jev-latest" if opt["engine"] == "jev" else "mock"], seed)
        if opt.get("only"):
            specs = [s for s in specs if s["persona"]["archetype"] in opt["only"]]
        o = dict(opt, seed=seed)
        with ThreadPoolExecutor(max_workers=opt["workers"]) as ex:
            agents += list(ex.map(lambda a: shopper_paths(a, E, o, nb), specs))
    wall = time.time() - t0
    calls = [v["calls"] for a in agents for v in a["visits"]]
    cost = {"usd": round(sum(c["cost"] for c in calls), 6), "jev_requests": sum(c["llm"] for c in calls),
            "cached": sum(c["cached"] for c in calls), "errors": sum(len(c["errors"]) for c in calls),
            "input_tokens": sum(c["input_tokens"] for c in calls),
            "usd_if_uncached": round(sum(c["cost_if_uncached"] for c in calls), 6),
            "agent_visits": len(calls), "wall_s": round(wall, 1), "engine": opt["engine"],
            "pricing": "TypeSafe Jev: $0.042 per 1M input tokens, output free (sim/jev.py)"}
    if opt["engine"] == "jev":
        import jev
        cost["jev_session"] = jev.session_cost()
        # input_tokens above counts tokens of every request incl. cache hits; new_input_tokens = billed ones
        cost["new_input_tokens"] = jev.session_cost()["input_tokens"]
        cost["new_output_tokens"] = jev.session_cost()["output_tokens"]
    tag = opt.get("label") or ""
    run_id = opt.get("run_id") or f"visits_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}_{opt['engine']}_s{'-'.join(map(str, opt['seeds']))}{('_' + tag) if tag else ''}"
    assm = copy.deepcopy(ASSUMPTIONS)
    assm["p_search_moved"]["value"] = opt["p_search_moved"]
    assm["route_card_logit"]["value"] = opt["route_card_logit"]
    assm["tau"]["value"] = opt["tau"]
    design = {"arms": ["control", "card"], "visits": 4, "relayout_at": 3,
              "relayout_source": opt["relayout"], "as_built_source": AS_BUILT,
              "new_skus": E["new_skus"], "new_sku_rule": E["new_sku_rule"],
              "seeds": opt["seeds"], "agents_per_persona": opt["agents_per_persona"], "engine": opt["engine"],
              "detour": opt["detour"], "no_memory_state": opt["no_memory_state"],
              "train_run": opt["train_run"], "inference_set": inferable(E["personas"]) + ["none"],
              "sensitive_declared_only": list(SENSITIVE),
              "sensitive_condition_in_arms": "declared (lens + gates given, nothing inferred); the undeclared card is built in code alongside for the safety count",
              "assumptions": assm,
              "preregistered_primary": {
                  "metric": "basket completion at visit 3",
                  "definition": "share of a shopper's habit items (taken in >= 1 of visits 1-2) taken again at visit 3",
                  "contrast": "card world - control world, paired within shopper, at c=0.2, route_card_logit=0, p_search_moved=0.5",
                  "ci": "paired bootstrap over shoppers, B=2000",
                  "written": "docs/ideas/personal-route-spec.md section 5.3, before the run"},
              "personas": E["personas_src"], "catalog": "data/products/catalog.json",
              "store": "data/store/store.config.json"}
    run = {"run_id": run_id, "created": dt.datetime.now().isoformat(timespec="seconds"), "design": design,
           "agents": agents, "cost": cost}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, run_id + ".json"), "w") as f:
        json.dump(run, f, ensure_ascii=False, separators=(",", ":"))
    cards = [{"key": a["key"], "archetype": a["archetype"], "visit": v["visit"], "card": v["card"],
              "card_undeclared": v["card_undeclared"]}
             for a in agents for v in a["visits"] if v["card"]]
    with open(os.path.join(OUT_DIR, run_id + ".cards.json"), "w") as f:
        json.dump({"run_id": run_id, "cards": cards}, f, ensure_ascii=False, indent=1)
    print(f"wrote data/sim/visits/{run_id}.json  agents={len(agents)} agent_visits={len(calls)} cost=${cost['usd']} "
          f"requests={cost['jev_requests']} cached={cost['cached']} errors={cost['errors']} wall={cost['wall_s']}s")
    return run


# ---------------------------------------------------------------- evaluation helpers
def boot_mean(xs, B=2000, seed=0):
    xs = [x for x in xs if x is not None]
    n = len(xs)
    if n == 0:
        return {"mean": None, "ci95": [None, None], "n": 0}
    rng = random.Random(seed)
    ms = sorted(sum(xs[rng.randrange(n)] for _ in range(n)) / n for _ in range(B))
    return {"mean": round(sum(xs) / n, 4), "ci95": [round(ms[int(0.025 * B)], 4), round(ms[int(0.975 * B) - 1], 4)], "n": n}


def price(catalog, c):
    return float(catalog.get(c, {}).get("price_gbp") or 0)


def visit_rec(a, v, arm):
    for r in a["visits"]:
        if r["visit"] == v and (r["arm"] == arm or r["arm"] == "shared"):
            return r
    return None


def reactance_k(arch):
    return 0.25 if arch in REACTANCE_LOW else 1.0


def complies(a, c):
    return hu(a["seed"], a["agent_id"], "comply", 3) < c * reactance_k(a["archetype"])


def habit_items(a):
    s = set()
    for v in (1, 2):
        s |= set(visit_rec(a, v, "control")["basket"])
    return s


def outcomes(a, v, arm, catalog, new_skus, store, relay_ucats):
    r = visit_rec(a, v, arm)
    b = r["basket"]
    H = habit_items(a)
    mc = set(a["mission_cats"])
    hcats = {catalog[c]["category"] for c in H}
    found = set()
    for u in r["visited_units"]:
        found |= set(relay_ucats[u])
    planned = set(r["planned_route"])
    unplanned_route = sum(price(catalog, e["product"]) for e in r["events"]
                          if e["decision"] == "pick" and e["slot"].split("-")[0] not in planned)
    offm = sum(price(catalog, c) for c in b if catalog[c]["category"] not in mc)
    carded = (r.get("card") or {}).get("carded_sku")
    nf = {"shown": 0, "looked": 0, "picked_up": 0, "taken": 0}
    for e in r["events"]:
        if e["product"] in new_skus:
            nf["shown"] += 1
            st = e["stage_reached"]
            nf["looked"] += int(st != "not_noticed")
            nf["picked_up"] += int(st in ("put_back", "taken"))
            nf["taken"] += int(st == "taken")
    return {"completion": (len(H & set(b)) / len(H)) if H else None,
            "habit_cat_found": (len(hcats & found) / len(hcats)) if hcats else None,
            "basket_gbp": round(sum(price(catalog, c) for c in b), 4), "items": len(b),
            "unplanned_gbp_route": round(unplanned_route, 4), "off_mission_gbp": round(offm, 4),
            "metres": routes.metres_for_units(store, list(r["visited_units"])),
            "non_carded_takes": sum(1 for c in b if c != carded and c not in new_skus),
            "new_taken": sorted(set(b) & set(new_skus)), "new_funnel": nf, "carded": carded}


# ---------------------------------------------------------------- evaluation: A/B (spec 5.3)
def eval_ab(run, catalog, store, compliance_levels, B=2000):
    design = run["design"]
    new = set(design["new_skus"])
    relay = json.load(open(os.path.join(ROOT, design["relayout_source"])))
    ru = routes.unit_categories(store, relay)
    agents = run["agents"]
    O = {}
    for a in agents:
        for v in (3, 4):
            for arm in ("control", "card"):
                O[(a["key"], v, arm)] = outcomes(a, v, arm, catalog, new, store, ru)
    metrics = ["completion", "habit_cat_found", "basket_gbp", "items", "unplanned_gbp_route", "off_mission_gbp",
               "metres", "non_carded_takes"]
    res = {"by_compliance": {}, "n_shoppers": len(agents)}
    for c in compliance_levels:
        comp = {a["key"]: complies(a, c) for a in agents}
        lv = {"c": c, "n_compliers": sum(comp.values()),
              "complier_share": round(sum(comp.values()) / len(agents), 4) if agents else None, "metrics": {}}
        for v in (3, 4):
            for m in metrics:
                ctrl = [O[(a["key"], v, "control")][m] for a in agents]
                world = [O[(a["key"], v, "card" if comp[a["key"]] else "control")][m] for a in agents]
                diffs = [None if (x is None or y is None) else y - x for x, y in zip(ctrl, world)]
                lv["metrics"][f"v{v}.{m}"] = {"control": boot_mean(ctrl, B, 1), "card_world": boot_mean(world, B, 2),
                                              "diff_paired": boot_mean(diffs, B, 3)}
        # trial-to-repeat: same new SKU taken at v3 and v4
        def ttr(a, world_arm):
            o3, o4 = O[(a["key"], 3, world_arm)], O[(a["key"], 4, world_arm)]
            return 1.0 if set(o3["new_taken"]) & set(o4["new_taken"]) else 0.0
        ctrl = [ttr(a, "control") for a in agents]
        world = [ttr(a, "card" if comp[a["key"]] else "control") for a in agents]
        lv["metrics"]["trial_to_repeat"] = {"control": boot_mean(ctrl, B, 4), "card_world": boot_mean(world, B, 5),
                                            "diff_paired": boot_mean([y - x for x, y in zip(ctrl, world)], B, 6),
                                            "control_count": int(sum(ctrl)), "card_world_count": int(sum(world))}
        # new-SKU funnel per arm (pooled events, Wilson)
        for v in (3, 4):
            for nm, arm_of in (("control", lambda a: "control"), ("card_world", lambda a: "card" if comp[a["key"]] else "control")):
                f = {"shown": 0, "looked": 0, "picked_up": 0, "taken": 0}
                for a in agents:
                    for k in f:
                        f[k] += O[(a["key"], v, arm_of(a))]["new_funnel"][k]
                for k in ("looked", "picked_up", "taken"):
                    f[f"{k}_rate"] = round(f[k] / f["shown"], 4) if f["shown"] else None
                    f[f"{k}_ci95"] = wilson(f[k], f["shown"])
                lv["metrics"][f"v{v}.new_sku_funnel.{nm}"] = f
        # complier average effect (the potential-outcome difference among compliers)
        cace = [O[(a["key"], 3, "card")]["completion"] - O[(a["key"], 3, "control")]["completion"]
                for a in agents if comp[a["key"]] and O[(a["key"], 3, "control")]["completion"] is not None]
        lv["metrics"]["v3.completion.complier_effect"] = boot_mean(cace, B, 7)
        res["by_compliance"][str(c)] = lv
    # everyone follows (c=1 ignoring reactance): pure potential-outcome contrast
    full = {}
    for v in (3, 4):
        for m in metrics:
            d = [None if O[(a["key"], v, "control")][m] is None else O[(a["key"], v, "card")][m] - O[(a["key"], v, "control")][m]
                 for a in agents]
            full[f"v{v}.{m}"] = boot_mean(d, B, 8)
    res["all_follow_potential_outcome_diff"] = full
    # baseline: v1/v2 completion reference (habit items re-taken at v2 from v1)
    rep = []
    for a in agents:
        b1, b2 = set(visit_rec(a, 1, "control")["basket"]), set(visit_rec(a, 2, "control")["basket"])
        rep.append(len(b1 & b2) / len(b1) if b1 else None)
    res["reference_v2_retake_of_v1"] = boot_mean(rep, B, 9)
    # completion by visit for the chart: v2 (share of v1 items retaken), v3, v4 per arm (all-follow and c=0.2)
    # per-persona primary at all-follow
    per = {}
    for a in agents:
        x = O[(a["key"], 3, "control")]["completion"]
        if x is None:
            continue
        per.setdefault(a["archetype"], []).append(O[(a["key"], 3, "card")]["completion"] - x)
    res["v3_completion_all_follow_by_persona"] = {k: boot_mean(v, B, 10) for k, v in sorted(per.items())}
    # decomposition at v3: are differences only where the routes differ?
    same_slot_diff, units_only_card, units_only_ctrl = 0, 0, 0
    route_hits = []
    for a in agents:
        rc, rk = visit_rec(a, 3, "control"), visit_rec(a, 3, "card")
        ec = {(e["slot"], e["product"]): (e["decision"], e["stage_reached"]) for e in rc["events"]}
        ek = {(e["slot"], e["product"]): (e["decision"], e["stage_reached"]) for e in rk["events"]}
        for k in set(ec) & set(ek):
            if ec[k] != ek[k]:
                same_slot_diff += 1
        uc, uk = set(rc["visited_units"]), set(rk["visited_units"])
        units_only_card += len(uk - uc)
        units_only_ctrl += len(uc - uk)
        H = habit_items(a)
        if H:
            gained = {c for c in H & set(rk["basket"]) if c not in rc["basket"]}
            lost = {c for c in H & set(rc["basket"]) if c not in rk["basket"]}
            route_hits.append({"gained_from_units_only_in_card": sum(1 for c in gained if LO.positions(relay)[c]["unit"] not in uc),
                               "gained": len(gained), "lost": len(lost)})
    res["decomposition_v3"] = {
        "events_differing_on_slots_visited_in_both_arms": same_slot_diff,
        "unit_visits_only_in_card": units_only_card, "unit_visits_only_in_control": units_only_ctrl,
        "habit_items_gained_by_card": sum(r["gained"] for r in route_hits),
        "of_which_on_units_control_never_visited": sum(r["gained_from_units_only_in_card"] for r in route_hits),
        "habit_items_lost_by_card": sum(r["lost"] for r in route_hits),
        "reading": "At visit 3 both arms share memory and every draw, and Jev's state does not depend on the route "
                   "(basket_so_far stays empty on the jev path of run.py), so with route_card_logit=0 any v3 difference "
                   "can only come from WHICH units are walked: the lift is the routing assumption (p_search_moved). "
                   "Visit 4 also differs through memory (memory line + repaired route)."}
    return res


# ---------------------------------------------------------------- evaluation: persona ID (spec 5.1)
def _metrics(rows, classes, tau):
    """rows: [(true_lens, posterior dict)] true_lens in classes."""
    n = len(rows)
    if n == 0:
        return None
    top1 = top3 = 0
    ll = br = 0.0
    bins = [[0, 0.0, 0] for _ in range(10)]
    labels = classes + ["none"]
    conf = {t: {p: 0 for p in labels} for t in classes}
    abstain = 0
    for t, post in rows:
        order = sorted(post, key=lambda k: -post[k])
        pmax = post[order[0]]
        pred = order[0] if pmax >= tau else "none"
        abstain += pred == "none"
        top1 += pred == t
        top3 += t in order[:3]
        ll += -math.log(max(post.get(t, 0.0), 1e-12))
        br += sum((post.get(k, 0.0) - (1.0 if k == t else 0.0)) ** 2 for k in classes)
        b = min(9, int(pmax * 10))
        bins[b][0] += 1
        bins[b][1] += pmax
        bins[b][2] += int(order[0] == t)
        conf[t][pred] += 1
    ece = sum(abs(b[1] / b[0] - b[2] / b[0]) * b[0] / n for b in bins if b[0])
    return {"n": n, "top1_tau": round(top1 / n, 4), "top1_tau_ci95": wilson(top1, n),
            "top3": round(top3 / n, 4), "top3_ci95": wilson(top3, n),
            "abstain_rate": round(abstain / n, 4),
            "log_loss": round(ll / n, 4), "brier": round(br / n, 4), "ece_10bin": round(ece, 4),
            "reliability": [{"bin": f"{i/10:.1f}-{(i+1)/10:.1f}", "n": b[0],
                             "mean_conf": round(b[1] / b[0], 4) if b[0] else None,
                             "acc": round(b[2] / b[0], 4) if b[0] else None} for i, b in enumerate(bins)],
            "confusion": conf}


def eval_persona(run, train, personas, catalog, tau, control_path=True):
    classes = inferable(personas)
    nb = NB(train, classes, tokens_sku, catalog)
    nbm = NB(train, classes, tokens_mission, catalog)
    agents = run["agents"]

    def baskets(a, upto):
        return [visit_rec(a, v, "control")["basket"] for v in range(1, upto + 1)]
    out = {"classes": classes, "chance_top1": round(1 / len(classes), 4), "tau": tau,
           "framing": "identifiability within the sim (an upper bound), never accuracy on real shoppers",
           "by_visit": {}, "mission_only_baseline": {}, "within_weekly_shop": {}}
    ns = [a for a in agents if a["archetype"] in classes]
    for v in (1, 2, 3, 4):
        rows = [(a["archetype"], nb.posterior(baskets(a, v))) for a in ns]
        rows_m = [(a["archetype"], nbm.posterior(baskets(a, v))) for a in ns]
        out["by_visit"][str(v)] = _metrics(rows, classes, tau)
        out["mission_only_baseline"][str(v)] = _metrics(rows_m, classes, tau)
        ws = [(t, p) for (t, p), a in zip(rows, ns) if a["mission"] == "weekly_shop"]
        wsm = [(t, p) for (t, p), a in zip(rows_m, ns) if a["mission"] == "weekly_shop"]
        out["within_weekly_shop"][str(v)] = {"sku_nb": _metrics(ws, classes, tau), "mission_only": _metrics(wsm, classes, tau)}
        # top-1 lift over mission-only, paired bootstrap over shoppers
        def hit(post, t):
            k = max(post, key=post.get)
            return 1.0 if (post[k] >= tau and k == t) else 0.0
        d = [hit(p, t) - hit(pm, tm) for (t, p), (tm, pm) in zip(rows, rows_m)]
        out["by_visit"][str(v)]["lift_top1_over_mission_only"] = boot_mean(d, 2000, 11)
    # (b) leave-one-archetype-out
    loo = {}
    for k in classes:
        rest = [c for c in classes if c != k]
        m = NB([(l, b) for l, b in train if l != k], rest, tokens_sku, catalog)
        rows = [m.posterior(baskets(a, 4)) for a in agents if a["archetype"] == k]
        if not rows:
            continue
        mx = [max(p.values()) for p in rows]
        loo[k] = {"n": len(rows), "share_none_at_tau": round(sum(x < tau for x in mx) / len(rows), 4),
                  "mean_max_p": round(sum(mx) / len(rows), 4),
                  "labelled_as": sorted({max(p, key=p.get) for p, x in zip(rows, mx) if x >= tau})}
    out["stress_leave_one_out_v4"] = loo
    # (d) undeclared sensitive shoppers
    sens = [a for a in agents if a["archetype"] in SENSITIVE]
    d = {}
    for v in (1, 2, 4):
        rows = [nb.posterior(baskets(a, v)) for a in sens]
        mx = [max(p.values()) for p in rows]
        d[str(v)] = {"n": len(rows), "abstain_rate": round(sum(x < tau for x in mx) / len(rows), 4) if rows else None,
                     "confidently_labelled_wrong_lens": round(sum(x >= tau for x in mx) / len(rows), 4) if rows else None}
    unsafe, offered = 0, 0
    for a in sens:
        for r in a["visits"]:
            cu = r.get("card_undeclared")
            if cu and cu.get("carded_sku"):
                offered += 1
                unsafe += bool(cu.get("gate_fail_true_persona"))
    d["undeclared_cards_offering_item"] = offered
    d["undeclared_cards_failing_true_hard_gate"] = unsafe
    declared_unsafe = 0
    for a in sens:
        per = next(p for p in personas if p["archetype"] == a["archetype"])
        for r in a["visits"]:
            c = (r.get("card") or {}).get("carded_sku")
            if c and __import__("swaps").gate_fail(per, catalog[c]):
                declared_unsafe += 1
    d["declared_cards_failing_true_hard_gate"] = declared_unsafe
    out["stress_undeclared_sensitive"] = d
    # (e) cost of refusing health inference: unrestricted 12-way, offline, synthetic only
    all_cls = sorted(p["archetype"] for p in personas)
    nb12 = NB(train, all_cls, tokens_sku, catalog)
    e = {}
    for v in (1, 2, 4):
        h12, h9 = [], []
        for a in agents:
            p12 = nb12.posterior(baskets(a, v))
            k12 = max(p12, key=p12.get)
            h12.append(1.0 if (p12[k12] >= tau and k12 == a["archetype"]) else 0.0)
            p9 = nb.posterior(baskets(a, v))
            k9 = max(p9, key=p9.get)
            h9.append(1.0 if (p9[k9] >= tau and k9 == a["archetype"]) else 0.0)
        e[str(v)] = {"top1_12way": boot_mean(h12, 2000, 12), "top1_restricted": boot_mean(h9, 2000, 13),
                     "points_lost": boot_mean([x - y for x, y in zip(h12, h9)], 2000, 14),
                     "note": "all 144 shoppers; restricted model cannot name glp1/coeliac/vegan, by design"}
    out["stress_cost_of_refusing_health_inference"] = e
    out["stress_not_run"] = {"a_mixed_households": "not run (needs new Jev visits; cut for the 17:30 deadline)",
                             "c_ocean_jitter": "not run (needs new Jev visits; cut for the 17:30 deadline)"}
    return out, nb, nb12


# ---------------------------------------------------------------- evaluation: next basket (spec 5.2)
def eval_next_basket(run, train, personas, catalog, store, nb, nb12, lam_list=(0.25, 0.5, 0.75), B=2000):
    built = json.load(open(os.path.join(ROOT, AS_BUILT)))
    new = set(run["design"]["new_skus"])
    relay = json.load(open(os.path.join(ROOT, run["design"]["relayout_source"])))
    uni = {2: [c for c in LO.positions(withhold(built, new))], 3: list(LO.positions(relay)), 4: list(LO.positions(relay))}
    plans = {2: withhold(built, new), 3: relay, 4: relay}
    posn = {tv: LO.positions(p) for tv, p in plans.items()}
    ucat = {tv: routes.unit_categories(store, p) for tv, p in plans.items()}
    gpop = {}
    for _, b in train:
        for c in b:
            gpop[c] = gpop.get(c, 0) + 1
    cls12 = sorted(p["archetype"] for p in personas)
    psku12 = {k: nb12.p_sku(k, list(catalog)) for k in cls12}
    psku9 = {k: psku12[k] for k in nb.classes}
    K = (3, 5, 10)
    methods = ["random", "global_popularity", "repeat_last", "most_frequent", "posterior_popularity"] + \
              [f"ours_lambda_{l}" for l in lam_list] + ["oracle"]
    per_shopper = {m: {f"{s}@{k}": {} for k in K for s in ("P", "R", "P_repeat", "P_explore")} for m in methods}
    for a in run["agents"]:
        mc = set(a["mission_cats"])
        for tv in (2, 3, 4):
            hist = [visit_rec(a, v, "control")["basket"] for v in range(1, tv)]
            target = set(visit_rec(a, tv, "control")["basket"])
            if not target:
                continue
            U = uni[tv]
            seen = set(c for b in hist for c in b)
            if a["archetype"] in SENSITIVE:
                post = {a["archetype"]: 1.0}
                ps = psku12
            else:
                post = nb.posterior(hist)
                ps = psku9
            pp = {c: sum(w * ps[k].get(c, 0.0) for k, w in post.items()) for c in U}
            mx = max(pp.values()) or 1.0
            freq = {c: sum(c in b for b in hist) / len(hist) for c in U}
            order_pp = sorted(U, key=lambda c: (-pp[c], c))
            ranks = {
                "global_popularity": sorted(U, key=lambda c: (-gpop.get(c, 0), c)),
                "repeat_last": [c for c in order_pp if c in set(hist[-1])] + [c for c in order_pp if c not in set(hist[-1])],
                "most_frequent": sorted(U, key=lambda c: (-freq[c], -pp[c], c)),
                "posterior_popularity": order_pp,
                "oracle": sorted(U, key=lambda c: (-psku12[a["archetype"]].get(c, 0.0), c)),
            }
            for l in lam_list:
                ranks[f"ours_lambda_{l}"] = sorted(U, key=lambda c: (-(l * freq[c] + (1 - l) * pp[c] / mx), c))
            M = [c for c in U if posn[tv][c]["unit"] in {u for u, cs in ucat[tv].items() if cs & mc}]
            for m in methods:
                for k in K:
                    if m == "random":
                        hits = len(target & set(M)) * min(k, len(M)) / len(M) if M else 0.0
                        hr = len(target & set(M) & seen) * min(k, len(M)) / len(M) if M else 0.0
                    else:
                        top = ranks[m][:k]
                        hits = len(target & set(top))
                        hr = len(target & set(top) & seen)
                    d = per_shopper[m]
                    for nm, val in ((f"P@{k}", hits / k), (f"R@{k}", hits / len(target)),
                                    (f"P_repeat@{k}", hr / k), (f"P_explore@{k}", (hits - hr) / k)):
                        d[nm].setdefault(a["key"], {})[tv] = val
    out = {"targets": "visit v+1 basket from visits 1..v (control path for v3, v4); shoppers with an empty target basket are skipped",
           "universe": "SKUs on the shelf at the target visit (new SKUs only from v3)",
           "posterior": "non-sensitive shoppers: 9-lens NB posterior from baskets; sensitive shoppers: declared lens",
           "ours_definition": "lambda * personal frequency + (1-lambda) * posterior popularity / max(posterior popularity)",
           "overall": {}, "visit4": {}, "claims": {}}
    for m in methods:
        out["overall"][m], out["visit4"][m] = {}, {}
        for nm, d in per_shopper[m].items():
            out["overall"][m][nm] = boot_mean([sum(x.values()) / len(x) for x in d.values()], B, 20)
            out["visit4"][m][nm] = boot_mean([x[4] for x in d.values() if 4 in x], B, 21)
    for l in lam_list:
        o = f"ours_lambda_{l}"
        for base in ("most_frequent", "repeat_last"):
            for scope in ("overall", "visit4"):
                for k in K:
                    nm = f"P@{k}"
                    keys = [s for s in per_shopper[o][nm] if (scope == "overall" or 4 in per_shopper[o][nm][s])]
                    def val(m, s):
                        x = per_shopper[m][nm][s]
                        return sum(x.values()) / len(x) if scope == "overall" else x[4]
                    out["claims"][f"{o}-{base}.{scope}.{nm}"] = boot_mean([val(o, s) - val(base, s) for s in keys], B, 22)
    return out


# ---------------------------------------------------------------- assertions (spec 5.3)
def assertions(run, E, check_s11=True, s11_agents=300):
    out = {}
    agents = run["agents"]
    js = []
    differ = 0
    for a in agents:
        b1, b2 = set(visit_rec(a, 1, "control")["basket"]), set(visit_rec(a, 2, "control")["basket"])
        u = b1 | b2
        js.append(len(b1 & b2) / len(u) if u else 1.0)
        differ += b1 != b2 or [e["noticed"] for e in visit_rec(a, 1, "control")["events"]] != [e["noticed"] for e in visit_rec(a, 2, "control")["events"]]
    out["v1_v2_differ"] = {"pass": differ > 0.5 * len(agents), "shoppers_with_different_v1_v2_draws_or_baskets": differ,
                           "n": len(agents), "mean_jaccard_v1_v2_baskets": round(sum(js) / len(js), 4) if js else None}
    # non-compliers: realised world record IS the control record, byte for byte
    bad = 0
    for c in (0.2, 0.5, 0.8):
        for a in agents:
            if not complies(a, c):
                for v in (3, 4):
                    if json.dumps(visit_rec(a, v, "control"), sort_keys=True) != json.dumps(
                            [r for r in a["visits"] if r["visit"] == v and r["arm"] == "control"][0], sort_keys=True):
                        bad += 1
    out["control_equals_card_world_for_noncompliers"] = {"pass": bad == 0, "mismatches": bad,
                                                         "how": "the realised card world takes the control potential outcome for non-compliers"}
    # v3: same slot visited in both arms -> same decisions (logit 0 only)
    if run["design"]["assumptions"]["route_card_logit"]["value"] == 0:
        diff = 0
        for a in agents:
            rc, rk = visit_rec(a, 3, "control"), visit_rec(a, 3, "card")
            ec = {(e["slot"], e["product"]): (e["noticed"], e["decision"], e["stage_reached"]) for e in rc["events"]}
            for e in rk["events"]:
                k = (e["slot"], e["product"])
                if k in ec and ec[k] != (e["noticed"], e["decision"], e["stage_reached"]):
                    diff += 1
        eng = run["design"]["engine"]
        out["v3_shared_slots_identical_across_arms"] = {
            "pass": diff == 0 if eng == "jev" else None, "differing_events": diff, "engine": eng,
            "why": "common random numbers: draw keys never include the arm",
            "note": None if eng == "jev" else "mock engine: mock_decide reads budget_left, which depends on what was taken earlier on the route, so differences are expected and this check only binds for jev"}
    # the port equals run.simulate_agent (mock, every persona, visit=None, as-built)
    store, catalog = E["store"], E["catalog"]
    specs = simrun.spawn_agents(E["personas"], 24, ["mock"], 21)
    ctx = {"seed": 21, "engine": "mock", "mock": True, "max_tokens": 250, "planogram": E["plan_built"], "catalog": catalog, "store": store}
    mism = sum(json.dumps(simrun.simulate_agent(a, ctx), sort_keys=True) != json.dumps(simulate_agent_v(a, ctx), sort_keys=True)
               for a in specs)
    out["port_equals_run_py_mock"] = {"pass": mism == 0, "agents": len(specs), "mismatches": mism}
    if check_s11:
        import jev
        jev.set_max_usd(0.0)  # cache only: any uncached request trips the guard instead of spending
        r = json.load(open(os.path.join(RUNS_DIR, TRAIN_RUN + ".json")))
        specs = simrun.spawn_agents(E["personas"], len(r["agents"]), ["jev-latest"], r["seed"])
        ctx = {"seed": r["seed"], "engine": "jev", "mock": False, "max_tokens": 250, "planogram": E["plan_built"],
               "catalog": catalog, "store": store}
        mism, guard, checked = 0, 0, 0
        first = None
        for a, ref in list(zip(specs, r["agents"]))[:s11_agents]:
            try:
                got = simulate_agent_v(a, ctx)
            except jev.JevSpendGuard:
                guard += 1
                continue
            checked += 1
            if json.dumps(got["events"], sort_keys=True) != json.dumps(ref["events"], sort_keys=True):
                mism += 1
                first = first or a["agent_id"]
        out["visit_none_reproduces_s11"] = {"pass": mism == 0 and guard == 0, "agents_checked": checked,
                                            "event_mismatches": mism, "uncached_would_cost": guard,
                                            "first_mismatch": first, "run": TRAIN_RUN}
    return out


# ---------------------------------------------------------------- CLI
def cmd_eval(a):
    run = json.load(open(os.path.join(OUT_DIR, a.run + ".json")))
    E = load_env(run["design"]["relayout_source"], ",".join(run["design"]["new_skus"]))
    train, _ = load_train(a.train_run)
    comp = [float(x) for x in a.compliance.split(",")]
    t0 = time.time()
    ab = eval_ab(run, E["catalog"], E["store"], comp)
    pid, nb, nb12 = eval_persona(run, train, E["personas"], E["catalog"], a.tau)
    nbk = eval_next_basket(run, train, E["personas"], E["catalog"], E["store"], nb, nb12)
    asr = assertions(run, E, check_s11=not a.skip_s11 and run["design"]["engine"] == "jev")
    sens = {}
    for sid in (a.sensitivity or "").split(","):
        sid = sid.strip()
        if not sid:
            continue
        sr = json.load(open(os.path.join(OUT_DIR, sid + ".json")))
        base_keys = {x["key"] for x in sr["agents"]}
        sub = dict(run, agents=[x for x in run["agents"] if x["key"] in base_keys])
        sens[sid] = {"p_search_moved": sr["design"]["assumptions"]["p_search_moved"]["value"],
                     "route_card_logit": sr["design"]["assumptions"]["route_card_logit"]["value"],
                     "seeds": sr["design"]["seeds"], "cost": sr["cost"],
                     "ab": eval_ab(sr, E["catalog"], E["store"], comp, B=1000),
                     "base_same_shoppers": eval_ab(sub, E["catalog"], E["store"], comp, B=1000)}
    ev = {"run_id": run["run_id"], "created": dt.datetime.now().isoformat(timespec="seconds"),
          "framing": "in simulation, N synthetic shoppers per archetype, under the labelled assumptions in design.assumptions",
          "ab": ab, "persona_id": pid, "next_basket": nbk, "sensitivity": sens, "assertions": asr,
          "eval_wall_s": round(time.time() - t0, 1)}
    with open(os.path.join(OUT_DIR, run["run_id"] + ".eval.json"), "w") as f:
        json.dump(ev, f, ensure_ascii=False, indent=1)
    print(f"wrote data/sim/visits/{run['run_id']}.eval.json")
    print(json.dumps({"primary_c0.2": ab["by_compliance"].get("0.2", {}).get("metrics", {}).get("v3.completion"),
                      "assertions": {k: v["pass"] for k, v in asr.items()}}, indent=1))


def cmd_card(a):
    cards = json.load(open(os.path.join(OUT_DIR, a.run + ".cards.json")))["cards"]
    for c in cards:
        if (c["key"] == a.agent or c["key"].endswith(":" + a.agent)) and c["visit"] == a.visit:
            print(json.dumps(c, indent=1, ensure_ascii=False))
            return
    raise SystemExit("no card for that agent/visit")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--engine", choices=("jev", "mock"), default="jev")
    r.add_argument("--agents-per-persona", type=int, default=4)
    r.add_argument("--seeds", default="21,22,23")
    r.add_argument("--visits", type=int, default=4, choices=(4,))
    r.add_argument("--relayout-at", type=int, default=3, choices=(3,))
    r.add_argument("--relayout", default=RELAYOUT)
    r.add_argument("--new-skus", default="auto")
    r.add_argument("--p-search-moved", type=float, default=0.5)
    r.add_argument("--route-card-logit", type=float, default=0.0)
    r.add_argument("--tau", type=float, default=0.5)
    r.add_argument("--detour", type=int, default=0, choices=(0, 1))
    r.add_argument("--no-memory-state", action="store_true")
    r.add_argument("--jev-max-usd", type=float, default=5.0)
    r.add_argument("--workers", type=int, default=40)
    r.add_argument("--train-run", default=TRAIN_RUN)
    r.add_argument("--label", default="")
    r.add_argument("--only", default="", help="comma list of archetypes (dry runs)")
    s = sub.add_parser("sweep")
    s.add_argument("--base", required=True)
    s.add_argument("--seeds", default="21")
    s.add_argument("--p-search-moved", default="0.25,0.75,1.0")
    s.add_argument("--route-card-logit", default="0.5,1.0")
    s.add_argument("--jev-max-usd", type=float, default=5.0)
    s.add_argument("--workers", type=int, default=40)
    e = sub.add_parser("eval")
    e.add_argument("--run", required=True)
    e.add_argument("--train-run", default=TRAIN_RUN)
    e.add_argument("--compliance", default="0.2,0.5,0.8")
    e.add_argument("--tau", type=float, default=0.5)
    e.add_argument("--sensitivity", default="", help="comma list of sweep run ids")
    e.add_argument("--skip-s11", action="store_true")
    c = sub.add_parser("card")
    c.add_argument("--run", required=True)
    c.add_argument("--agent", required=True)
    c.add_argument("--visit", type=int, required=True)
    a = ap.parse_args()
    if a.cmd == "run":
        do_run({"engine": a.engine, "agents_per_persona": a.agents_per_persona,
                "seeds": [int(x) for x in a.seeds.split(",")], "relayout": a.relayout, "new_skus": a.new_skus,
                "p_search_moved": a.p_search_moved, "route_card_logit": a.route_card_logit, "tau": a.tau,
                "detour": bool(a.detour), "no_memory_state": a.no_memory_state, "jev_max_usd": a.jev_max_usd,
                "workers": a.workers, "train_run": a.train_run, "label": a.label,
                "only": [x for x in a.only.split(",") if x]})
    elif a.cmd == "sweep":
        base = json.load(open(os.path.join(OUT_DIR, a.base + ".json")))["design"]
        common = {"engine": base["engine"], "agents_per_persona": base["agents_per_persona"],
                  "seeds": [int(x) for x in a.seeds.split(",")], "relayout": base["relayout_source"],
                  "new_skus": ",".join(base["new_skus"]), "tau": base["assumptions"]["tau"]["value"],
                  "detour": base["detour"], "no_memory_state": base["no_memory_state"], "jev_max_usd": a.jev_max_usd,
                  "workers": a.workers, "train_run": base["train_run"], "only": []}
        b_ps = base["assumptions"]["p_search_moved"]["value"]
        b_lg = base["assumptions"]["route_card_logit"]["value"]
        for ps in [float(x) for x in a.p_search_moved.split(",") if x]:
            do_run(dict(common, p_search_moved=ps, route_card_logit=b_lg, label=f"sweep_ps{ps}"))
        for lg in [float(x) for x in a.route_card_logit.split(",") if x]:
            do_run(dict(common, p_search_moved=b_ps, route_card_logit=lg, label=f"sweep_logit{lg}"))
    elif a.cmd == "eval":
        cmd_eval(a)
    elif a.cmd == "card":
        cmd_card(a)


if __name__ == "__main__":
    main()

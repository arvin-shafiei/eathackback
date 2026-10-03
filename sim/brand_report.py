"""BRAND REPORT (brand surface): the shelf funnel for one product, buyer-ready, every number traced.

    SHOWN -> LOOK -> PICK_UP -> TAKE        (PUT_BACK = picked up, not taken)

Reads the shelf-sim run logs (data/sim/runs/run_*.json) and, separately, the AI-agent arm
(data/sim/runs/agent_*.json). No model is called here: every number is a count over logged events, a Wilson
95% CI, or a mean of logged TypeSafe Jev probabilities. Each event already carries its inputs and Jev answers.

Stage per event:
  * new funnel logs (sim/jev.py decide_slot): `stage_reached` in {not_noticed, looked, put_back, taken} and
    `picked_up` (pick-up Noul sampled with a common-random-number draw) + `p_pick_up`.
  * older logs (fallback): noticed & walk_past -> looked; reject -> put_back; pick -> taken.

Leakage diagnosis: each stage's conversion is compared with the pooled category average from the SAME runs;
the stage with the lowest product/category ratio is where the brand leaks. Evidence for that stage is pulled
from the events (notice-model terms for LOOK, Jev appeal + P(pick-up) for PICK_UP, fired put-off Nouls with the
persona's sourced verbatims for PUT_BACK). Real-world benchmark: NielsenIQ / The Grocer rank from
data/sales/uk_bestsellers.csv when the brand appears there.

CLI:
  python3 sim/brand_report.py                          # every product seen in the Jev runs
  python3 sim/brand_report.py --product 5070000126579  # one product
  python3 sim/brand_report.py --runs data/sim/runs/run_X.json,data/sim/runs/run_Y.json
  python3 sim/brand_report.py --engine any             # include older OpenRouter-run logs (default: jev only)
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
import math
import os
import re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RUNS = os.path.join(ROOT, "data", "sim", "runs")
CATALOG = os.path.join(ROOT, "data", "products", "catalog.json")
SALES = os.path.join(ROOT, "data", "sales", "uk_bestsellers.csv")
OUT = os.path.join(ROOT, "data", "sim", "brand")

WILSON_SRC = "Wilson score interval, z=1.96 (Wilson 1927, JASA 22:209)"
MIN_N = 3  # assumption: a stage with fewer than 3 shoppers entering it is too thin to diagnose
NOUL_FIRES = 0.5  # same threshold as sim/jev.py (docs.typesafe.ai/primitives/noul: >0.5 = more likely yes)
STAGES = ["look", "pick_up", "keep"]
STAGE_TEXT = {
    "look": ("LOOK", "loses people at LOOK: shelf position / salience. Shoppers walk the aisle and never register it."),
    "pick_up": ("PICK_UP", "loses people at PICK-UP: the pack doesn't earn a closer look. They see it and keep walking."),
    "keep": ("PUT_BACK", "loses people at PUT-BACK: label / price / a trigger kills it once they hold it."),
}
STAGE_FIX = {
    "look": "test an eye-level move or +1 facing (sim/optimise.py --edits eye,facings)",
    "pick_up": "test pack copy: lead with a true claim it qualifies for (sim/pack_test.py)",
    "keep": "fix what the back of pack / price shows: see the put-off triggers below; test price (sim/optimise.py --price)",
}


def wilson(k: int, n: int, z: float = 1.96):
    if n <= 0:
        return [0.0, 1.0]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]


def rate(k, n):
    return {"k": k, "n": n, "rate": round(k / n, 4) if n else None, "ci95": wilson(k, n)}


# ---------------------------------------------------------------- load
def is_mock(d):
    return bool(d.get("mock")) or "mock" in (d.get("models") or []) or "_mock_" in d.get("run_id", "")


def load_runs(paths, prefix, engine):
    out = []
    for f in paths or sorted(glob.glob(os.path.join(RUNS, f"{prefix}_*.json"))):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        if is_mock(d):
            continue
        if engine == "jev" and d.get("engine") != "jev":
            continue
        d["_file"] = os.path.relpath(f, ROOT)
        out.append(d)
    return out


def stage_of(e):
    """-> (stage, picked_up, method)"""
    if e.get("stage_reached"):
        st = e["stage_reached"]
        pu = bool(e.get("picked_up", st in ("put_back", "taken")))
        return st, pu, "stage_reached"
    if not e.get("noticed") or e.get("decision") == "not_noticed":
        return "not_noticed", False, "fallback"
    d = e.get("decision")
    st = {"pick": "taken", "reject": "put_back"}.get(d, "looked")
    return st, st in ("put_back", "taken"), "fallback: noticed&walk_past->looked, reject->put_back, pick->taken"


def segs(agent):
    s = [f"arch:{agent.get('archetype') or agent.get('persona_id')}"]
    for t, v in (agent.get("ocean") or {}).items():
        s.append(f"ocean:{t}_{'high' if float(v) >= 0.5 else 'low'}")
    return s


def collect(runs):
    """rows: one per (agent, product) shelf event."""
    rows = []
    for d in runs:
        for a in d["agents"]:
            for e in a["events"]:
                if not e.get("product"):
                    continue
                st, pu, method = stage_of(e)
                rows.append({"run": d["run_id"], "file": d["_file"], "agent": a.get("agent_id"), "persona": a.get("persona_id"),
                             "archetype": a.get("archetype") or a.get("persona_id"), "segs": segs(a), "model": a.get("model"),
                             "product": e["product"], "slot": e.get("slot"), "stage": st, "looked": st != "not_noticed",
                             "picked_up": pu, "taken": st == "taken", "method": method, "e": e})
    return rows


def funnel(rs):
    shown = len(rs)
    looked = sum(r["looked"] for r in rs)
    pu = sum(r["picked_up"] for r in rs)
    tk = sum(r["taken"] for r in rs)
    return {"shown": shown, "looked": looked, "picked_up": pu, "put_back": pu - tk, "taken": tk,
            "look": rate(looked, shown), "pick_up": rate(pu, looked), "keep": rate(tk, pu), "take": rate(tk, shown)}


def _mean(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return round(sum(xs) / len(xs), 4) if xs else None


# ---------------------------------------------------------------- evidence per stage
def look_evidence(rs, cat_rs):
    rows = Counter((r["e"].get("notice_factors") or {}).get("row") for r in rs)
    fac = _mean([(r["e"].get("notice_factors") or {}).get("facings") for r in rs])
    terms = defaultdict(list)
    for r in rs:
        for k, v in ((r["e"].get("notice_factors") or {}).get("logit_terms") or {}).items():
            terms[k].append(v)
    return {"mean_p_notice": _mean([r["e"].get("p_notice") for r in rs]),
            "category_mean_p_notice": _mean([r["e"].get("p_notice") for r in cat_rs]),
            "shelf_rows_seen": dict(rows), "mean_facings": fac,
            "mean_logit_terms": {k: _mean(v) for k, v in terms.items()},
            "source": "event.p_notice and notice_factors.logit_terms (sim/notice.py; coefficients + sources in sim/coefficients.json)"}


def pickup_evidence(rs, cat_rs):
    looked = [r for r in rs if r["looked"]]
    lnp = [r for r in looked if not r["picked_up"]]
    feel = Counter(r["e"].get("feeling") for r in lnp if r["e"].get("feeling"))
    return {"mean_jev_p_pick_up": _mean([r["e"].get("p_pick_up") for r in looked]),
            "category_mean_jev_p_pick_up": _mean([r["e"].get("p_pick_up") for r in cat_rs if r["looked"]]),
            "mean_jev_appeal_score_0_4": _mean([((r["e"].get("jev") or {}).get("appeal") or {}).get("score") for r in looked]),
            "category_mean_jev_appeal_score_0_4": _mean([((r["e"].get("jev") or {}).get("appeal") or {}).get("score")
                                                         for r in cat_rs if r["looked"]]),
            "feeling_of_those_who_walked_on": dict(feel.most_common(5)),
            "source": "event.p_pick_up (Jev Noul 'Does shopper pick up products[i] to look at it more closely?') and "
                      "event.jev.appeal.score (Jev Score, 5 levels), sim/jev.py"}


def trigger_evidence(rs):
    """Fired put-off Nouls (p > 0.5) across the given events, with source + verbatim."""
    agg = {}
    for r in rs:
        e = r["e"]
        for k, v in ((e.get("jev") or {}).get("nouls") or {}).items():
            if not k.startswith("trigger") or float(v.get("p", 0)) <= NOUL_FIRES:
                continue
            a = agg.setdefault(v["text"], {"trigger": v["text"], "n_events": 0, "ps": [], "personas": set(),
                                           "source": v.get("source", ""), "verbatims": []})
            a["n_events"] += 1
            a["ps"].append(float(v["p"]))
            a["personas"].add(r["persona"])
            vb = e.get("verbatim")
            if vb and vb.get("quote") and vb not in a["verbatims"] and len(a["verbatims"]) < 2:
                a["verbatims"].append(vb)
    out = []
    for a in sorted(agg.values(), key=lambda a: (-a["n_events"], -sum(a["ps"]))):
        out.append({"trigger": a["trigger"], "n_events": a["n_events"], "mean_jev_p": round(sum(a["ps"]) / len(a["ps"]), 3),
                    "personas": sorted(a["personas"]), "source": a["source"], "verbatims": a["verbatims"]})
    return out[:5]


def putback_evidence(rs):
    pb = [r for r in rs if r["stage"] == "put_back"]
    mech = Counter(r["e"].get("mechanism") for r in pb if r["e"].get("mechanism"))
    return {"n_put_back": len(pb), "mechanisms": dict(mech.most_common(5)),
            "top_triggers": trigger_evidence(pb),
            "glance_triggers_on_lookers": trigger_evidence([r for r in rs if r["stage"] == "looked"])[:3],
            "example_reasons": [{"persona": r["persona"], "reason": r["e"].get("reason", "")[:300], "run": r["run"],
                                 "agent": r["agent"]} for r in pb[:3]],
            "budget_overrides": sum(1 for r in pb if r["e"].get("budget_override")),
            "source": "event.jev.nouls (Jev Noul per persona put-off, each with its own source), event.verbatim "
                      "(persona Reddit quote + URL, sim/jev.py verbatim_for), event.mechanism (Jev Choice)"}


# ---------------------------------------------------------------- real-world benchmark
def _norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower().replace("’", "'").replace("&", " and ")).strip()


def load_sales():
    try:
        return list(csv.DictReader(open(SALES)))
    except Exception:
        return []


def niq_match(p, sales):
    b = _norm(p.get("brand"))
    if not b or len(b) < 3:
        return []
    hits = []
    for r in sales:
        if not str(r.get("rank", "")).strip().isdigit():
            continue
        hay = f" {_norm(r.get('brand'))} {_norm(r.get('product_or_range'))} "
        if f" {b} " in hay:
            hits.append({"category": r["category"], "rank": int(r["rank"]), "brand": r["brand"],
                         "product_or_range": r["product_or_range"], "sales_value_gbp_m": r.get("sales_value_gbp_m"),
                         "yoy_change": r.get("yoy_change"), "period": r.get("period"), "channel": r.get("channel"),
                         "table": r.get("table"), "source_name": r.get("source_name"), "source_url": r.get("source_url"),
                         "same_category": r["category"] == p.get("category")})
    # rank only means something inside its own category list; other-category hits (e.g. the cross-category
    # brand-umbrella table) are kept but flagged, and a short brand only matches in its own category
    hits = [h for h in hits if h["same_category"] or (len(b) >= 5 and h["table"].startswith("bbb"))]
    name_tok = set(_norm(p.get("name")).split()) - set(b.split()) - {"the", "and", "original", "with", "of"}
    for h in hits:
        ov = name_tok & (set(_norm(h["product_or_range"]).split()) - set(b.split()))
        h["match_level"] = "product (shares: " + ", ".join(sorted(ov)) + ")" if ov else "brand only"
        h["_ov"] = len(ov)
    hits.sort(key=lambda h: (not h["same_category"], -h["_ov"], h["rank"]))
    for h in hits:
        h.pop("_ov")
    return hits[:3]


def table_size(sales, table):
    return sum(1 for r in sales if r.get("table") == table and str(r.get("rank", "")).strip().isdigit())


# ---------------------------------------------------------------- AI-agent arm
def agent_arm(agent_runs):
    by = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for d in agent_runs:
        for a in d["agents"]:
            for e in a["events"]:
                c = e.get("product")
                if not c:
                    continue
                for key in ("all", a.get("model") or "?"):
                    by[c][key][1] += 1
                    by[c][key][0] += e.get("decision") == "pick"
    return {c: {m: rate(k, n) for m, (k, n) in v.items()} for c, v in by.items()}


# ---------------------------------------------------------------- report
def diagnose(f, cf):
    ratios = {}
    for s in STAGES:
        pr, cr, n = f[s]["rate"], cf[s]["rate"], f[s]["n"]
        if pr is None or cr is None or n < MIN_N:
            ratios[s] = None
            continue
        ratios[s] = round(pr / cr, 3) if cr > 0 else (None if pr == 0 else 9.99)
    valid = {s: r for s, r in ratios.items() if r is not None}
    if not valid:
        return {"stage": None, "ratios_vs_category": ratios, "text": f"not enough shoppers reached any stage (n < {MIN_N}); run more agents",
                "rule": f"lowest product/category conversion ratio among stages with n >= {MIN_N} (assumption)"}
    worst = min(valid, key=lambda s: valid[s])
    ok = valid[worst] >= 1.0
    # strength: does the product's 95% CI sit wholly below the category rate?
    clear = (not ok) and f[worst]["ci95"][1] < cf[worst]["rate"]
    strength = None if ok else ("clear (product 95% CI upper bound below the category rate)" if clear else
                                "directional (product 95% CI overlaps the category rate; run more agents to confirm)")
    return {"stage": None if ok else worst, "ratios_vs_category": ratios, "strength": strength,
            "text": ("converts at or above the category average at every measurable stage" if ok else
                     STAGE_TEXT[worst][1] + ("" if clear else " (directional)")),
            "next_test": None if ok else STAGE_FIX[worst],
            "rule": f"lowest product/category conversion ratio among stages with n >= {MIN_N} (assumption: MIN_N=3)"}


def report(code, catalog, rows, sales, agents, runs):
    p = catalog.get(code, {"code": code})
    cat = p.get("category")
    rs = [r for r in rows if r["product"] == code]
    cat_rs = [r for r in rows if catalog.get(r["product"], {}).get("category") == cat]
    f, cf = funnel(rs), funnel(cat_rs)
    seg = defaultdict(list)
    for r in rs:
        for s in r["segs"]:
            seg[s].append(r)
    # rank within category by sim take rate (only products shown >= MIN_N)
    cat_codes = sorted({r["product"] for r in cat_rs})
    tr = []
    for c in cat_codes:
        ff = funnel([r for r in cat_rs if r["product"] == c])
        if ff["shown"] >= MIN_N:
            tr.append((ff["take"]["rate"], c))
    tr.sort(reverse=True)
    sim_rank = next((i + 1 for i, (_, c) in enumerate(tr) if c == code), None)
    niq = niq_match(p, sales)
    for h in niq:
        h["table_size"] = table_size(sales, h["table"])
    diag = diagnose(f, cf)
    methods = Counter(r["method"] for r in rs)
    return {
        "code": code, "name": p.get("name"), "brand": p.get("brand"), "category": cat, "role": p.get("role"),
        "price_gbp": p.get("price_gbp"), "price_source": p.get("price_source"), "off_url": p.get("off_url"),
        "pack_copy": p.get("pack_copy"),
        "funnel": f, "category_funnel": cf, "n_products_in_category": len(cat_codes),
        "diagnosis": diag,
        "evidence": {"look": look_evidence(rs, cat_rs), "pick_up": pickup_evidence(rs, cat_rs), "put_back": putback_evidence(rs)},
        "by_archetype": {k.split(":", 1)[1]: funnel(v) for k, v in sorted(seg.items()) if k.startswith("arch:")},
        "by_ocean_segment": {k.split(":", 1)[1]: funnel(v) for k, v in sorted(seg.items()) if k.startswith("ocean:")},
        "benchmark": {
            "sim_take_rank_in_category": sim_rank, "sim_ranked_products": len(tr),
            "sim_rank_rule": f"rank by take rate among category products shown >= {MIN_N} times in these runs",
            "nielseniq": niq,
            "nielseniq_note": (None if niq else
                               f"brand '{p.get('brand')}' not found in data/sales/uk_bestsellers.csv (NielsenIQ / The Grocer "
                               f"top-N lists). For a challenger that means below the published cut-off, not zero sales."),
        },
        "ai_agent_arm": agents.get(code),
        "ai_agent_arm_note": "share of Jev AI-agent feed runs (data/sim/runs/agent_*.json) that picked it; position-shuffled feed",
        "trace": {"runs": sorted({r["file"] for r in rs}), "all_runs_read": [d["_file"] for d in runs],
                  "stage_method": dict(methods), "ci": WILSON_SRC,
                  "definitions": {"look": "looked / shown (notice gate, sim/notice.py)",
                                  "pick_up": "picked_up / looked (Jev pick-up Noul sampled with a CRN draw)",
                                  "keep": "taken / picked_up (1 - put-back rate)", "take": "taken / shown",
                                  "ocean_segment": "trait >= 0.5 = high (sim/README.md convention)"},
                  "category_average": "pooled events of every product in the same category in the same runs"},
    }


def pct(r):
    return "n/a" if r["rate"] is None else f"{r['rate']:.0%} [{r['ci95'][0]:.0%}–{r['ci95'][1]:.0%}] ({r['k']}/{r['n']})"


def to_md(R):
    f, cf, d = R["funnel"], R["category_funnel"], R["diagnosis"]
    L = [f"# {R['brand']} · {R['name']}", "",
         f"`{R['code']}` · {R['category']} · {R['role']} · £{R['price_gbp']} · [OFF]({R['off_url']})", "",
         f"> **{d['text']}**" + (f"  \n> next test: {d['next_test']}" if d.get("next_test") else ""), "",
         "## the funnel (synthetic shoppers, TypeSafe Jev)", "",
         "| stage | this product | category avg | ratio |", "|---|---|---|---|"]
    for s, lab in (("look", "LOOK (noticed / shown)"), ("pick_up", "PICK UP (picked up / looked)"),
                   ("keep", "TAKE (taken / picked up)"), ("take", "overall (taken / shown)")):
        ratio = d["ratios_vs_category"].get(s)
        L.append(f"| {lab} | {pct(f[s])} | {pct(cf[s])} | {'' if ratio is None else f'{ratio:.2f}x'} |")
    L += ["", f"shown {f['shown']} · looked {f['looked']} · picked up {f['picked_up']} · put back {f['put_back']} · taken {f['taken']}", ""]
    ev = R["evidence"]
    lk, pu, pb = ev["look"], ev["pick_up"], ev["put_back"]
    L += ["## why", "",
          f"- **look:** mean P(notice) {lk['mean_p_notice']} vs category {lk['category_mean_p_notice']}; rows {lk['shelf_rows_seen']}, "
          f"mean facings {lk['mean_facings']}. ({lk['source']})",
          f"- **pick up:** mean Jev P(pick up) {pu['mean_jev_p_pick_up']} vs category {pu['category_mean_jev_p_pick_up']}; "
          f"appeal {pu['mean_jev_appeal_score_0_4']}/4 vs {pu['category_mean_jev_appeal_score_0_4']}/4; "
          f"those who walked on felt {pu['feeling_of_those_who_walked_on']}.",
          f"- **put back:** {pb['n_put_back']} put back; mechanisms {pb['mechanisms']}" +
          (f"; {pb['budget_overrides']} over budget" if pb["budget_overrides"] else "") + ".", ""]
    trig = pb["top_triggers"] or pb["glance_triggers_on_lookers"]
    if trig:
        L += ["### what kills it (Jev put-off Nouls that fired, p > 0.5)", ""]
        for t in trig:
            L.append(f"- **{t['trigger']}** — {t['n_events']} event(s), mean p={t['mean_jev_p']}, personas {', '.join(t['personas'])}")
            for v in t["verbatims"]:
                L.append(f"  - \"{v.get('quote','')[:160]}\" ([source]({v.get('url','')}))")
            if not t["verbatims"] and t["source"]:
                L.append(f"  - source: {t['source'][:200]}")
        L.append("")
    if pb["example_reasons"]:
        L += ["### in their words (logged reason strings)", ""] + [f"- {x['persona']}: {x['reason']}" for x in pb["example_reasons"]] + [""]
    L += ["## who it works for", "", "| archetype | shown | look | pick up | take |", "|---|---|---|---|---|"]
    for k, v in sorted(R["by_archetype"].items(), key=lambda kv: -(kv[1]["take"]["rate"] or 0)):
        fm = lambda r: "-" if r is None else f"{r:.0%}"  # noqa: E731
        L.append(f"| {k} | {v['shown']} | {fm(v['look']['rate'])} | {fm(v['pick_up']['rate'])} | {pct(v['take'])} |")
    L += ["", "| OCEAN segment | shown | take |", "|---|---|---|"]
    for k, v in R["by_ocean_segment"].items():
        L.append(f"| {k} | {v['shown']} | {pct(v['take'])} |")
    b = R["benchmark"]
    L += ["", "## benchmark", "",
          f"- sim: #{b['sim_take_rank_in_category']} of {b['sim_ranked_products']} by take rate in {R['category']} ({b['sim_rank_rule']})."]
    for h in b["nielseniq"]:
        L.append(f"- real ({h['match_level']}): #{h['rank']} of {h['table_size']} in `{h['table']}` — {h['product_or_range']}, £{h['sales_value_gbp_m']}m, "
                 f"{h['yoy_change']} ({h['period']}, {h['channel']}) — [{h['source_name']}]({h['source_url']})")
    if b["nielseniq_note"]:
        L.append(f"- real: {b['nielseniq_note']}")
    if R.get("ai_agent_arm"):
        a = R["ai_agent_arm"]
        L.append(f"- AI-agent arm (Jev agent picking from a shuffled feed): picked in {pct(a['all'])}.")
    pt = os.path.join(OUT, "pack_test", f"{R['code']}.json")
    if os.path.exists(pt):
        try:
            P = json.load(open(pt))
            w = next(v for v in P["variants"] if v["variant"] == P["winner"])
            L += ["", "## pack test (sim/pack_test.py)", "",
                  f"- winning honest variant `{P['winner']}`: \"{w['pack_copy'][:140]}\" — mean Jev P(pick up) "
                  f"{w['mean_p_pick_up']:.3f} ({w['mean_delta_p_pick_up_vs_control']:+.3f} vs current pack).",
                  f"- {P.get('verdict', '')}", f"- full table: data/sim/brand/pack_test/{R['code']}.md"]
        except Exception:
            pass
    t = R["trace"]
    L += ["", f"_trace: runs {', '.join(t['runs'])}; stage method {t['stage_method']}; CIs {t['ci']}. "
              f"All definitions and per-event inputs: data/sim/brand/{R['code']}.json._", ""]
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--product", default="")
    ap.add_argument("--runs", default="", help="comma-separated run_*.json paths (default: all non-mock)")
    ap.add_argument("--engine", default="jev", choices=["jev", "any"])
    a = ap.parse_args()
    catalog = {p["code"]: p for p in json.load(open(CATALOG))}
    runs = load_runs([x for x in a.runs.split(",") if x], "run", a.engine)
    if not runs:
        raise SystemExit("no non-mock shelf runs found (python3 sim/run.py ... first)")
    agent_runs = load_runs([], "agent", a.engine)
    rows = collect(runs)
    sales = load_sales()
    agents = agent_arm(agent_runs)
    codes = [a.product] if a.product else sorted({r["product"] for r in rows})
    os.makedirs(OUT, exist_ok=True)
    index = []
    for c in codes:
        R = report(c, catalog, rows, sales, agents, runs)
        json.dump(R, open(os.path.join(OUT, f"{c}.json"), "w"), indent=1, ensure_ascii=False, default=list)
        open(os.path.join(OUT, f"{c}.md"), "w").write(to_md(R))
        index.append({"code": c, "brand": R["brand"], "name": R["name"], "category": R["category"], "role": R["role"],
                      "shown": R["funnel"]["shown"], "look": R["funnel"]["look"]["rate"], "pick_up": R["funnel"]["pick_up"]["rate"],
                      "keep": R["funnel"]["keep"]["rate"], "take": R["funnel"]["take"]["rate"],
                      "leak_stage": R["diagnosis"]["stage"], "diagnosis": R["diagnosis"]["text"],
                      "leak_strength": R["diagnosis"].get("strength"),
                      "niq_rank": next((h["rank"] for h in R["benchmark"]["nielseniq"] if h["same_category"]), None),
                      "niq_table": next((h["table"] for h in R["benchmark"]["nielseniq"] if h["same_category"]), None),
                      "json": f"data/sim/brand/{c}.json", "md": f"data/sim/brand/{c}.md"})
    if not a.product:
        json.dump({"runs": [d["_file"] for d in runs], "agent_runs": [d["_file"] for d in agent_runs],
                   "products": index}, open(os.path.join(OUT, "index.json"), "w"), indent=1, ensure_ascii=False)
    leaks = Counter(x["leak_stage"] for x in index)
    print(f"{len(index)} product reports from {len(runs)} run(s), {len(rows)} shelf events -> data/sim/brand/ ; leak stages {dict(leaks)}")


if __name__ == "__main__":
    main()

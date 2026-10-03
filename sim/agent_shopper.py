"""AI-agent arm: the same catalogue rendered as a randomised product feed, sent to N OpenRouter models.

python3 sim/agent_shopper.py --models google/gemini-2.5-flash,openai/gpt-4.1-mini --runs 5 --seed 1 [--mock]

Each run shuffles the feed (seeded), so the position of every product is recorded and position bias can be
measured (LLM option-order sensitivity, arXiv 2308.11483; ACES position effects, arXiv 2508.02630).
Writes data/sim/runs/<run_id>.json with the same event shape as the shopper sim, persona_id "ai_agent".
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import prompts  # noqa: E402
import run as simrun  # noqa: E402
import uploads  # noqa: E402

MISSIONS = [
    {"id": "work_drink_snack", "categories": ["soft_drinks", "snack_bars"],
     "text": "Get me a healthy-ish fizzy drink or a snack for work, under £4.",
     "source": "Agent-GPT seed mission, data/personas/staged_personas_v1.json (dossier.missions[0])"},
    {"id": "kids_lunchbox", "categories": ["snack_bars", "yoghurt", "crisps_savoury"],
     "text": "Something healthy for my kids' lunchboxes this week, not ultra-processed, nothing with sweeteners.",
     "source": "Priya 'healthy lunchbox x 10' mission, data/personas/staged_personas_v1.json"},
    {"id": "cheap_breakfast", "categories": ["breakfast_cereal", "plant_milk_dairy_alt", "yoghurt"],
     "text": "Cheapest decent breakfast for the week, I'm on a student budget.",
     "source": "Dev frugal mission, data/personas/staged_personas_v1.json"},
    {"id": "high_protein_snack", "categories": ["snack_bars", "yoghurt"],
     "text": "A high protein snack, at least 20g protein, low sugar.",
     "source": "protein_gym lens persona, data/personas/lens/protein_gym.json"},
]

FEED_FIELDS = ["code", "name", "brand", "price_gbp", "pack_copy", "labels", "nutriscore", "nova",
               "sugars_100g", "proteins_100g", "fiber_100g", "salt_100g", "additives_n", "allergens",
               "ingredients_text"]


def feed_item(p):
    d = {k: p.get(k) for k in FEED_FIELDS if p.get(k) not in (None, "", [])}
    if "ingredients_text" in d:
        d["ingredients_text"] = d["ingredients_text"][:300]
    return d


def one_run(model, mission, rep, catalog, seed, mock, max_tokens):
    prods = [p for p in catalog.values() if p.get("category") in mission["categories"]]
    rng = random.Random(f"{seed}-{model}-{mission['id']}-{rep}")
    rng.shuffle(prods)
    feed = [feed_item(p) for p in prods]
    aid = f"ai_{model.split('/')[-1]}_{mission['id']}_{rep}"
    calls = {"llm": 0, "cached": 0, "cost": 0.0, "errors": []}
    if mock:
        # mock: cheapest item that meets a price cap, with a first-position nudge (labelled)
        ok = [f for f in feed if (f.get("price_gbp") or 9) <= 4]
        pick = (ok[0] if ok and rng.random() < 0.4 else min(ok, key=lambda f: f["price_gbp"])) if ok else None
        out = {"decision": "pick" if pick else "walk_past", "product": pick["code"] if pick else "",
               "reason": "[mock] meets the cap" if pick else "[mock] nothing fits", "attributes_cited": ["price_gbp"],
               "mechanism": "constraint_fit"}
        src = "mock heuristic (sim/agent_shopper.py), not an LLM"
    else:
        import llm
        # user prompt includes the rep index so repeated runs are distinct calls, not cache hits
        up = prompts.agent_user_prompt(mission["text"], feed) + f"\n(session {rep})"
        try:
            res = llm.chat_json(model, prompts.agent_system_prompt(), up, max_tokens=max_tokens,
                                temperature=0.7, tag=f"ai_agent:{mission['id']}")
            out = res["data"]
            calls.update(llm=1, cached=int(res["cached"]), cost=res["cost"])
            src = f"LLM {model} (agent prompt sim/prompts.py)"
        except llm.SpendGuardTripped:
            raise
        except Exception as e:
            calls["errors"].append(str(e)[:200])
            out = {"decision": "walk_past", "product": "", "reason": "(llm error)", "mechanism": "error"}
            src = "llm error"
    if isinstance(out, list):  # some models wrap the JSON object in a list
        out = next((o for o in out if isinstance(o, dict)), {})
    if not isinstance(out, dict):
        out = {}
    chosen = str(out.get("product") or "")
    dec = str(out.get("decision", "pick")).lower()
    events = []
    for pos, f in enumerate(feed):
        is_pick = f["code"] == chosen and dec == "pick"
        events.append({
            "step": pos, "slot": f"feed:{mission['id']}", "product": f["code"], "p_notice": 1.0,
            "notice_factors": {"position": pos + 1, "feed_len": len(feed)},
            "noticed": True, "position": pos + 1,
            "decision": "pick" if is_pick else "walk_past",
            "reason": str(out.get("reason", ""))[:300] if is_pick else "",
            "attributes_cited": (out.get("attributes_cited") or []) if is_pick else [],
            "feeling": "", "sentiment": None,
            "mechanism": str(out.get("mechanism", ""))[:40] if is_pick else "",
            "source_refs": [src, mission["source"]],
        })
    if dec != "pick" or not any(e["decision"] == "pick" for e in events):
        for e in events[:1]:
            e["reason"] = str(out.get("reason", ""))[:300]
            e["mechanism"] = str(out.get("mechanism", ""))[:40]
    return {"agent_id": aid, "persona_id": "ai_agent", "archetype": "ai_agent", "model": "mock" if mock else model,
            "ocean": {}, "mission": mission["id"], "mission_text": mission["text"],
            "path": [f"feed:{mission['id']}"], "events": events, "calls": calls,
            "picked_position": next((e["position"] for e in events if e["decision"] == "pick"), None),
            "feed_len": len(feed)}


def position_bias(agents):
    """Share of picks at position 1, vs the 1/n expected if order did not matter."""
    out = {}
    for a in agents:
        m = out.setdefault(a["model"], {"runs": 0, "picks": 0, "pick_at_1": 0, "expected_at_1": 0.0, "positions": []})
        m["runs"] += 1
        if a["picked_position"]:
            m["picks"] += 1
            m["pick_at_1"] += int(a["picked_position"] == 1)
            m["expected_at_1"] += 1.0 / a["feed_len"]
            m["positions"].append(a["picked_position"])
    for m in out.values():
        m["share_at_1"] = round(m["pick_at_1"] / m["picks"], 3) if m["picks"] else None
        m["ci95"] = simrun.wilson(m["pick_at_1"], m["picks"])
        m["expected_share_at_1"] = round(m["expected_at_1"] / m["picks"], 3) if m["picks"] else None
        del m["expected_at_1"]
    return out


def run_agents(models, runs=5, seed=1, mock=False, max_tokens=250, missions=None, workers=8, save=True,
               extra_products=None, exclude=None):
    """extra_products: brand uploads added to the feed. exclude: codes they replaced on the shelf, dropped
    from the feed so both arms shop the same range."""
    catalog, cat_src = simrun.load_catalog()
    catalog, uploaded = uploads.merge(catalog, extra_products, simrun.load_store()[0])
    for code in exclude or []:
        catalog.pop(str(code), None)
    ms = [m for m in MISSIONS if not missions or m["id"] in missions]
    jobs = [(mo, m, r) for mo in models for m in ms for r in range(runs)]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        agents = list(ex.map(lambda j: one_run(j[0], j[1], j[2], catalog, seed, mock, max_tokens), jobs))
    run_id = f"agent_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}_s{seed}{'_mock' if mock else ''}_{os.urandom(2).hex()}"
    stats = simrun.compute_stats(agents, catalog)
    by_model = {}
    for a in agents:
        for e in a["events"]:
            bm = stats["per_product"][e["product"]].setdefault("by_model", {})
            b = bm.setdefault(a["model"], {"shown": 0, "picked": 0})
            b["shown"] += 1
            b["picked"] += int(e["decision"] == "pick")
    for s in stats["per_product"].values():
        for b in s.get("by_model", {}).values():
            b["pick_rate"] = round(b["picked"] / b["shown"], 4) if b["shown"] else 0
            b["ci95"] = simrun.wilson(b["picked"], b["shown"])
    run = {"run_id": run_id, "created": dt.datetime.now().isoformat(timespec="seconds"), "arm": "ai_agent",
           "planogram": "feed (randomised order)", "models": ["mock"] if mock else models, "seed": seed,
           "missions": ms, "inputs": {"catalog": cat_src},
           "agents": agents, "stats": stats, "position_bias": position_bias(agents),
           "cost": {"usd": round(sum(a["calls"]["cost"] for a in agents), 5),
                    "llm_calls": sum(a["calls"]["llm"] for a in agents),
                    "cached": sum(a["calls"]["cached"] for a in agents),
                    "errors": sum(len(a["calls"]["errors"]) for a in agents)}}
    if uploaded:
        run["catalog_inline"] = uploaded
        run["excluded"] = [str(c) for c in exclude or []]
    if save:
        os.makedirs(simrun.RUNS_DIR, exist_ok=True)
        with open(os.path.join(simrun.RUNS_DIR, run_id + ".json"), "w") as f:
            json.dump(run, f, indent=1, ensure_ascii=False)
    return run


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=simrun.DEFAULT_MODEL)
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--missions", default="")
    ap.add_argument("--max-tokens", type=int, default=250)
    a = ap.parse_args()
    run = run_agents(a.models.split(","), a.runs, a.seed, a.mock, min(a.max_tokens, 300),
                     [m for m in a.missions.split(",") if m])
    print(simrun.summarise(run))
    print("position bias:", json.dumps(run["position_bias"]))
    print("wrote", os.path.join("data/sim/runs", run["run_id"] + ".json"))


if __name__ == "__main__":
    main()

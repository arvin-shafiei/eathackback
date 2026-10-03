"""AI-agent arm: the same catalogue rendered as a randomised product feed, judged by an AI shopping agent.

python3 sim/agent_shopper.py --runs 5 --seed 1                 # default: TypeSafe Jev (Choice over the feed)
python3 sim/agent_shopper.py --mock
python3 sim/agent_shopper.py --archetypes p_ai_price_bot --runs 1   # one archetype only
python3 sim/agent_shopper.py --models google/gemini-2.5-flash  # OpenRouter models only when named explicitly

Jev: one Choice whose options are the feed items in feed order (+ "none"); per-category then final Choice if
the feed exceeds the 255-option limit. The pick is sampled from the calibrated distribution with a seeded
draw, and the probability mass Jev puts on position 1 is recorded as a direct position-bias measure.

Each run shuffles the feed (seeded), so the position of every product is recorded and position bias can be
measured (LLM option-order sensitivity, arXiv 2308.11483; ACES position effects, arXiv 2508.02630).
AI agents are ARCHETYPES like the human personas: data/personas/lens/ai_*.json with "kind": "ai_agent"
(p_ai_assistant_general, p_ai_retailer_assistant, p_ai_price_bot). Each archetype has its own missions and an
agent_brief (condensed from its lens) that is put in front of the user's request in the prompt state; the retailer
assistant also gets a synthesised household purchase history (assumption, seeded). Every agent record carries
persona_id + archetype (who is shopping) and `model` (what decided: jev-1.13.0, the OpenRouter jev-router, an
OpenRouter id, or "mock") as separate fields.
Writes data/sim/runs/<run_id>.json with the same event shape as the shopper sim.

python3 sim/agent_shopper.py --migrate   # stamps old agent_*.json runs (persona_id "ai_agent") with the general archetype
"""
from __future__ import annotations

import argparse
import glob
import re
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
for _m in MISSIONS:
    _m["archetype_id"] = "p_ai_assistant_general"
MISSIONS += [
    {"id": "usual_snacks", "archetype_id": "p_ai_retailer_assistant", "categories": ["snack_bars", "crisps_savoury"],
     "text": "Add my usual snacks for the week, keep it cheap.",
     "source": "Agent-Tesco 'weekly replenishment' mission, data/personas/staged_personas_v1.json[11] dossier.missions[0]"},
    {"id": "lunchbox_repeat", "archetype_id": "p_ai_retailer_assistant", "categories": ["snack_bars", "yoghurt", "crisps_savoury"],
     "text": "Kids' lunchbox snacks for the week. The ones they already eat are fine.",
     "source": "Agent-Tesco 'kids' lunchbox snacks for the week' mission, data/personas/staged_personas_v1.json[11] dossier.missions[3]"},
    {"id": "breakfast_under_cap", "archetype_id": "p_ai_retailer_assistant", "categories": ["breakfast_cereal", "plant_milk_dairy_alt", "yoghurt"],
     "text": "Breakfast for the week, keep it under £3. Swap to cheaper where it doesn't matter.",
     "source": "Agent-Tesco 'keep this week's shop under £X' mission, data/personas/staged_personas_v1.json[11] dossier.missions[5]; £3 cap = assumption"},
    {"id": "cheapest_fizzy", "archetype_id": "p_ai_price_bot", "categories": ["soft_drinks"],
     "text": "Cheapest decent fizzy drink, lowest price per litre.",
     "source": "'cheapest decent fizzy drink' harness variant, data/personas/staged_personas_v1.json[10] dossier.missions[3]"},
    {"id": "cheapest_breakfast", "archetype_id": "p_ai_price_bot", "categories": ["breakfast_cereal", "yoghurt"],
     "text": "Cheapest breakfast for the week by price per 100 g.",
     "source": "Dev frugal mission, data/personas/staged_personas_v1.json[4]; per-100 g framing = archetype lens (data/personas/lens/ai_price_bot.json)"},
    {"id": "cheapest_protein", "archetype_id": "p_ai_price_bot", "categories": ["snack_bars", "yoghurt"],
     "text": "Cheapest high protein snack with at least 20 g protein per 100 g.",
     "source": "protein mission (data/personas/lens/protein_gym.json) with the price-bot objective (data/personas/lens/ai_price_bot.json)"},
]

PERSONA_DIR = os.path.join(simrun.ROOT, "data", "personas", "lens")
HISTORY_SOURCE = ("assumption: synthesised household purchase history (the sim has no Clubcard data). Seeded per "
                  "mission+rep: 1 incumbent or own-label SKU per mission category, because a cold-start challenger has "
                  "no history (data/personas/staged_personas_v1.json[11] dossier.rejection_triggers[0])")


def load_archetypes():
    """AI-agent archetypes: data/personas/lens/*.json with kind == ai_agent, keyed by id."""
    out = {}
    for fp in sorted(glob.glob(os.path.join(PERSONA_DIR, "*.json"))):
        try:
            d = json.load(open(fp))
        except Exception:
            continue
        if isinstance(d, dict) and d.get("kind") == "ai_agent":
            d["_file"] = os.path.relpath(fp, simrun.ROOT)
            out[d["id"]] = d
    return out


_QTY = re.compile(r"(\d+(?:[.,]\d+)?)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)\s*(g|gram|grams|ml|cl|l|litre|litres)\b|"
                  r"(\d+(?:[.,]\d+)?)\s*(kg|g|gram|grams|ml|cl|l|litre|litres)\b", re.I)
_UNIT = {"kg": 1000, "g": 1, "gram": 1, "grams": 1, "ml": 1, "cl": 10, "l": 1000, "litre": 1000, "litres": 1000}


def price_per_100(p):
    """£ per 100 g / 100 ml from catalog price_gbp + quantity (derived; None when quantity is not parseable)."""
    pr, q = p.get("price_gbp"), str(p.get("quantity") or "")
    if not pr or not q:
        return None
    m = _QTY.search(q)
    if not m:
        return None
    if m.group(1):
        amount = float(m.group(1).replace(",", ".")) * float(m.group(2).replace(",", ".")) * _UNIT[m.group(3).lower()]
    else:
        amount = float(m.group(4).replace(",", ".")) * _UNIT[m.group(5).lower()]
    return round(float(pr) / amount * 100, 3) if amount else None


def synth_history(prods, mission, seed, rep):
    """1 incumbent/own-label SKU per mission category (seeded). See HISTORY_SOURCE."""
    rng = random.Random(f"{seed}-history-{mission['id']}-{rep}")
    hist = []
    for c in mission["categories"]:
        pool = sorted((p for p in prods if p.get("category") == c and p.get("role") in ("incumbent", "own_label")),
                      key=lambda p: p["code"])
        if pool:
            hist.append(rng.choice(pool)["code"])
    return hist


def prompt_state(arch, mission, prods, history):
    """The text the deciding model sees in front of the feed: archetype brief + (history) + the user's request."""
    parts = [f"You are a {arch.get('label', arch['archetype'])} (AI shopping agent). {arch.get('agent_brief', '')}".strip()]
    if history:
        names = [f"{p.get('brand', '')} {p.get('name', '')}".strip() for p in prods if p["code"] in history]
        parts.append("Household purchase history (bought before): " + "; ".join(names) + ".")
    parts.append(f'User request: "{mission["text"]}"')
    return "\n".join(parts)

FEED_FIELDS = ["code", "name", "brand", "price_gbp", "pack_copy", "labels", "nutriscore", "nova",
               "sugars_100g", "proteins_100g", "fiber_100g", "salt_100g", "additives_n", "allergens",
               "ingredients_text"]


def feed_item(p, arch_id="", history=()):
    d = {k: p.get(k) for k in FEED_FIELDS if p.get(k) not in (None, "", [])}
    if "ingredients_text" in d:
        d["ingredients_text"] = d["ingredients_text"][:300]
    if arch_id in ("p_ai_price_bot", "p_ai_retailer_assistant"):
        d["quantity"] = p.get("quantity")
        d["price_per_100g_or_ml"] = price_per_100(p)
    if arch_id == "p_ai_retailer_assistant":
        d["own_label"] = p.get("role") == "own_label"  # the retailer knows its own brands
        d["in_purchase_history"] = p["code"] in history
    return d


def one_run(model, mission, rep, catalog, seed, mock, max_tokens, arch=None):
    arch = arch or load_archetypes().get(mission.get("archetype_id", "p_ai_assistant_general")) or {
        "id": "p_ai_assistant_general", "archetype": "ai_assistant_general", "label": "general shopping assistant"}
    prods = [p for p in catalog.values() if p.get("category") in mission["categories"]]
    rng = random.Random(f"{seed}-{model}-{mission['id']}-{rep}")
    rng.shuffle(prods)
    history = synth_history(prods, mission, seed, rep) if arch["id"] == "p_ai_retailer_assistant" else []
    feed = [feed_item(p, arch["id"], history) for p in prods]
    state_text = prompt_state(arch, mission, prods, history)
    aid = f"ai_{arch['archetype'].replace('ai_', '')}_{model.split('/')[-1]}_{mission['id']}_{rep}"
    model_label = "mock" if mock else model
    calls = {"llm": 0, "cached": 0, "cost": 0.0, "errors": []}
    if model == "jev" and not mock:
        import jev
        try:
            res = jev.agent_pick(state_text, prods, draw_u=simrun.hu(seed, "jev-agent", mission["id"], rep),
                                 tag=f"{arch['id']}:{mission['id']}")
            calls.update(llm=res["n_requests"], cached=int(res["cached"]), cost=res["cost"],
                         input_tokens=res["input_tokens"])
            k = res["sampled"]
            pick_code = prods[k]["code"] if k is not None else ""
            p_take = res["probabilities"].get(k, 0.0) if k is not None else res["probabilities"].get(None, 0.0)
            jev_rec = {"probabilities_by_position": {str(i + 1): round(v, 4) for i, v in res["probabilities"].items() if i is not None},
                       "p_none": round(res["probabilities"].get(None, 0.0), 4), "confidence": res["confidence"],
                       "sampled_position": (k + 1) if k is not None else None,
                       "argmax_position": (res["argmax"] + 1) if res["argmax"] is not None else None,
                       "sampled_is_argmax": k == res["argmax"], "jev_model": res["jev_model"],
                       "n_requests": res["n_requests"], "input_tokens": res["input_tokens"],
                       "cost_usd": round(res["cost"], 8), "cache_keys": res["cache_keys"],
                       "option_order": res["option_order_note"]}
            out = {"decision": "pick" if pick_code else "walk_past", "product": pick_code,
                   "reason": (f"[jev] agent chose position {k + 1} of {len(prods)} (P={p_take:.2f}, "
                              f"confidence {res['confidence']})" if pick_code else
                              f"[jev] agent bought nothing (P(none)={p_take:.2f})"),
                   "attributes_cited": [], "mechanism": "constraint_fit", "jev": jev_rec}
            src = f"TypeSafe {res['jev_model']} Choice over the feed (sim/jev.py agent_pick)"
            model_label = res["jev_model"]  # e.g. jev-1.13.0, or openrouter:typesafe/jev-router after the 402 fallback
        except jev.JevSpendGuard:
            raise
        except Exception as e:
            calls["errors"].append(f"jev: {e!r}"[:200])
            out = {"decision": "walk_past", "product": "", "reason": "(jev error)", "mechanism": "error"}
            src = "jev error"
            model_label = "jev"
    elif mock:
        # mock heuristics per archetype (labelled, not an LLM):
        #   general: cheapest item under £4, with a first-position nudge; retailer: history item, else cheapest own-label;
        #   price bot: lowest price per 100 g/ml among items with a parseable quantity
        ok = [f for f in feed if (f.get("price_gbp") or 9) <= 4]
        cited, why = ["price_gbp"], "meets the cap"
        if arch["id"] == "p_ai_price_bot":
            ok = [f for f in feed if f.get("price_per_100g_or_ml")] or ok
            pick = min(ok, key=lambda f: f.get("price_per_100g_or_ml") or f.get("price_gbp") or 9) if ok else None
            cited, why = ["price_per_100g_or_ml"], "lowest price per unit"
        elif arch["id"] == "p_ai_retailer_assistant":
            hist = [f for f in feed if f.get("in_purchase_history")]
            own = [f for f in ok if f.get("own_label")]
            pick = hist[0] if hist and rng.random() < 0.8 else (min(own or ok, key=lambda f: f["price_gbp"]) if (own or ok) else None)
            cited, why = (["in_purchase_history"], "bought before") if pick in hist else (["own_label", "price_gbp"], "own-label default")
        else:
            pick = (ok[0] if ok and rng.random() < 0.4 else min(ok, key=lambda f: f["price_gbp"])) if ok else None
        out = {"decision": "pick" if pick else "walk_past", "product": pick["code"] if pick else "",
               "reason": f"[mock] {why}" if pick else "[mock] nothing fits", "attributes_cited": cited,
               "mechanism": "habit" if why == "bought before" else "price_anchor" if arch["id"] == "p_ai_price_bot" else "constraint_fit"}
        src = "mock heuristic (sim/agent_shopper.py), not an LLM"
    else:  # explicit OpenRouter model id only; never a fallback
        import llm
        # user prompt includes the rep index so repeated runs are distinct calls, not cache hits
        up = prompts.agent_user_prompt(mission["text"], feed) + f"\n(session {rep})"
        sp = prompts.agent_system_prompt() + "\n\n" + state_text.rsplit("\nUser request:", 1)[0]
        try:
            res = llm.chat_json(model, sp, up, max_tokens=max_tokens,
                                temperature=0.7, tag=f"{arch['id']}:{mission['id']}")
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
            "stage_reached": "taken" if is_pick else "looked", "p_pick_up": None,
            "reason": str(out.get("reason", ""))[:300] if is_pick else "",
            "attributes_cited": (out.get("attributes_cited") or []) if is_pick else [],
            "feeling": "", "sentiment": None,
            "mechanism": str(out.get("mechanism", ""))[:40] if is_pick else "",
            "source_refs": [src, mission["source"], f"archetype {arch['id']} ({arch.get('_file', 'data/personas/lens')})"],
            **({"engine": "jev", "jev_model": out["jev"]["jev_model"],
                "jev": {**out["jev"], "p_this_position": out["jev"]["probabilities_by_position"].get(str(pos + 1))}}
               if is_pick and out.get("jev") else {}),
        })
    if dec != "pick" or not any(e["decision"] == "pick" for e in events):
        for e in events[:1]:
            e["reason"] = str(out.get("reason", ""))[:300]
            e["mechanism"] = str(out.get("mechanism", ""))[:40]
    return {"agent_id": aid, "persona_id": arch["id"], "archetype": arch["archetype"], "kind": "ai_agent",
            "archetype_label": arch.get("label", arch["archetype"]), "model": model_label,
            "prompt_state": state_text, "purchase_history": history,
            **({"purchase_history_source": HISTORY_SOURCE} if history else {}),
            "engine": "jev" if model == "jev" and not mock else "mock" if mock else "llm",
            "jev": out.get("jev"),
            "ocean": {}, "mission": mission["id"], "mission_text": mission["text"],
            "path": [f"feed:{mission['id']}"], "events": events, "calls": calls,
            "picked_position": next((e["position"] for e in events if e["decision"] == "pick"), None),
            "feed_len": len(feed)}


def position_bias(agents, key="model"):
    """Share of picks at position 1, vs the 1/n expected if order did not matter (grouped by `key`)."""
    out = {}
    for a in agents:
        m = out.setdefault(a.get(key) or "?", {"runs": 0, "picks": 0, "pick_at_1": 0, "expected_at_1": 0.0, "positions": []})
        m["runs"] += 1
        if a.get("jev"):
            pb = a["jev"]["probabilities_by_position"]
            m.setdefault("_p1", []).append(pb.get("1", 0.0))
            m.setdefault("_unif", []).append(1.0 / max(1, a["feed_len"]))
            m.setdefault("_argmax1", []).append(int(a["jev"]["argmax_position"] == 1))
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
        if "_p1" in m:  # calibrated measure: probability Jev puts on whichever item is shown first
            m["mean_prob_at_1"] = round(sum(m["_p1"]) / len(m["_p1"]), 4)
            m["uniform_prob_at_1"] = round(sum(m["_unif"]) / len(m["_unif"]), 4)
            m["argmax_at_1"] = sum(m["_argmax1"])
            m["argmax_at_1_ci95"] = simrun.wilson(sum(m["_argmax1"]), len(m["_argmax1"]))
            del m["_p1"], m["_unif"], m["_argmax1"]
    return out


def run_agents(models=None, runs=5, seed=1, mock=False, max_tokens=250, missions=None, workers=16, save=True,
               archetypes=None, extra_products=None, exclude=None):
    """extra_products: brand uploads added to the feed. exclude: codes they replaced on the shelf, dropped
    from the feed so both arms shop the same range."""
    models = models or ["jev"]
    catalog, cat_src = simrun.load_catalog()
    catalog, uploaded = uploads.merge(catalog, extra_products, simrun.load_store()[0])
    for code in exclude or []:
        catalog.pop(str(code), None)
    archs = load_archetypes()
    want = [a for a in (archetypes or archs.keys()) if a in archs]
    ms = [m for m in MISSIONS if m["archetype_id"] in want and (not missions or m["id"] in missions)]
    # stratified sampling: every chosen archetype x each of its missions x runs (population_weight is reported, not used
    # to subsample, so small archetypes still get enough runs for a CI)
    jobs = [(mo, m, r) for mo in models for m in ms for r in range(runs)]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        agents = list(ex.map(lambda j: one_run(j[0], j[1], j[2], catalog, seed, mock, max_tokens,
                                               archs[j[1]["archetype_id"]]), jobs))
    run_id = f"agent_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}_s{seed}{'_mock' if mock else '_jev' if models == ['jev'] else ''}_{os.urandom(2).hex()}"
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
           "planogram": "feed (randomised order)", "models": ["mock"] if mock else sorted({a["model"] for a in agents}),
           "engine": "mock" if mock else ("jev" if models == ["jev"] else "mixed" if "jev" in models else "llm"), "seed": seed,
           "missions": ms, "inputs": {"catalog": cat_src, "archetypes": {a: archs[a]["_file"] for a in want}},
           "archetypes": [{"id": a, "archetype": archs[a]["archetype"], "label": archs[a].get("label"),
                           "population_weight": archs[a].get("population_weight")} for a in want],
           "agents": agents, "stats": stats, "position_bias": position_bias(agents),
           "position_bias_by_archetype": position_bias(agents, "archetype"),
           "cost": {"usd": round(sum(a["calls"]["cost"] for a in agents), 5),
                    "llm_calls": sum(a["calls"]["llm"] for a in agents),
                    "cached": sum(a["calls"]["cached"] for a in agents),
                    "errors": sum(len(a["calls"]["errors"]) for a in agents),
                    "input_tokens": sum(a["calls"].get("input_tokens", 0) for a in agents)}}
    if uploaded:
        run["catalog_inline"] = uploaded
        run["excluded"] = [str(c) for c in exclude or []]
    if save:
        os.makedirs(simrun.RUNS_DIR, exist_ok=True)
        with open(os.path.join(simrun.RUNS_DIR, run_id + ".json"), "w") as f:
            json.dump(run, f, indent=1, ensure_ascii=False)
    return run


MIGRATED_NOTE = ("migrated 2026-10-03: this run predates AI-agent archetypes; every agent here was given one of the "
                 "4 generic assistant missions (work drink+snack, kids lunchbox, cheap breakfast, high-protein snack), so "
                 "persona_id was set to p_ai_assistant_general (data/personas/lens/ai_assistant_general.json). "
                 "The decision itself is unchanged; `model` is what decided.")


def migrate(paths=None):
    """Stamp old agent runs (persona_id "ai_agent") with the general-assistant archetype. Idempotent."""
    archs = load_archetypes()
    g = archs.get("p_ai_assistant_general", {"archetype": "ai_assistant_general", "label": "general shopping assistant"})
    done = []
    for fp in paths or sorted(glob.glob(os.path.join(simrun.RUNS_DIR, "agent_*.json"))):
        run = json.load(open(fp))
        n = 0
        for a in run.get("agents", []):
            if a.get("persona_id") == "ai_agent":
                a.update(persona_id="p_ai_assistant_general", archetype=g["archetype"], kind="ai_agent",
                         archetype_label=g.get("label"), migrated=True)
                n += 1
        if not n:
            continue
        for s in (run.get("stats") or {}).get("per_product", {}).values():
            for k in ("by_archetype", "funnel_by_archetype"):
                if isinstance(s.get(k), dict) and "ai_agent" in s[k]:
                    s[k][g["archetype"]] = s[k].pop("ai_agent")
        run["migrated_note"] = MIGRATED_NOTE
        run["archetypes"] = [{"id": "p_ai_assistant_general", "archetype": g["archetype"], "label": g.get("label")}]
        with open(fp, "w") as f:
            json.dump(run, f, indent=1, ensure_ascii=False)
        done.append((os.path.relpath(fp, simrun.ROOT), n))
    return done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="jev", help="jev (default); OpenRouter ids only when named explicitly")
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--missions", default="")
    ap.add_argument("--max-tokens", type=int, default=250)
    ap.add_argument("--archetypes", default="", help="comma list of AI archetype ids (default: all kind=ai_agent personas)")
    ap.add_argument("--migrate", action="store_true", help="stamp old agent_*.json runs with the general archetype and exit")
    a = ap.parse_args()
    if a.migrate:
        for f, n in migrate():
            print(f"migrated {n} agents in {f}")
        return
    run = run_agents(a.models.split(","), a.runs, a.seed, a.mock, min(a.max_tokens, 300),
                     [m for m in a.missions.split(",") if m], archetypes=[x for x in a.archetypes.split(",") if x] or None)
    print(simrun.summarise(run))
    print("position bias:", json.dumps(run["position_bias"]))
    print("position bias by archetype:", json.dumps(run["position_bias_by_archetype"]))
    print("wrote", os.path.join("data/sim/runs", run["run_id"] + ".json"))


if __name__ == "__main__":
    main()

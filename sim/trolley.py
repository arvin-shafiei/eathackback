"""Smart trolley view of a sim run: what a real store's tracked trolleys / baskets would RECORD.

Spec: docs/ideas/smart-trolleys.md (+ docs/data-collection.md). Rule zero: every derived number states how it was
computed, and everything here is SIMULATED (derived from a sim run), never measured in a store.

Mapping, sim -> trolley signal (also written to data/sim/trolley/README.md):
  agent path (slots)                  -> bay visits (bay = shelf unit, e.g. U3), in walking order
  seconds at a bay                    -> dwell_s, from the event list + PACING assumptions below
  stage taken                         -> scan_in   (item scanned into the trolley)
  stage put_back                      -> scan_out  (item scanned / weighed in, then removed: the put-back EPOS never sees)
  bay dwell >= DWELL_MIN_S, no scan   -> dwell_no_scan (bay-level only: a trolley can't tell WHICH product was looked at)
  checkout                            -> items (scan_in minus scan_out), total (catalog price_gbp), loyalty opt-in
NOT recorded (a real trolley can't see it): 'noticed' without a stop, which product was looked at, persona,
archetype, OCEAN, mission, budget, Jev probabilities / reasons / feelings, back-of-pack reads.

Privacy: trolley_id is random per trip (resets every trip). A session links to a person (loyalty_id, pseudonymous)
ONLY when opt_in_loyalty is true at checkout. No health inference: the profile endpoint passes only declared diets.

    python3 sim/trolley.py data/sim/runs/<run>.json [--opt-in 0.6]
"""
from __future__ import annotations

import datetime as dt
import glob
import hashlib
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

RUNS_DIR = os.path.join(ROOT, "data", "sim", "runs")
OUT_DIR = os.path.join(ROOT, "data", "sim", "trolley")
SIMULATED = "SIMULATED: derived from a sim run (sim/trolley.py), not recorded by real trolleys"

PACING = {
    "pass_s_per_shelf_row": {"value": 1.5, "note": "assumption: seconds to roll past one shelf row of a bay without stopping"},
    "look_s": {"value": "event notice_factors.seconds_at_shelf (persona param; 6 s if missing)",
               "note": "sim value: each product the shopper looked at adds the persona's seconds_at_shelf to the bay dwell"},
    "pickup_s": {"value": 8.0, "note": "assumption: extra seconds to pick up and handle a product (read the pack)"},
    "walk_m_same_aisle": {"value": 2.0, "note": "assumption: metres between neighbouring bays in one aisle"},
    "walk_m_new_aisle": {"value": 10.0, "note": "assumption: metres to the next aisle (round the end cap)"},
    "walk_speed_mps": {"value": 1.3, "note": "same as sim/layout_optimise.py PARAMS walk_speed_mps (assumption)"},
    "dwell_min_s": {"value": 5.0, "note": "assumption: a trolley stopped >= 5 s at a bay counts as a dwell (spec: 'at least N seconds')"},
    "trip_start": {"value": "08:00-20:00 uniform, seeded", "note": "assumption: arrival time of day; real trolleys log real clocks"},
    "opt_in_loyalty": {"value": 0.6, "note": "assumption (configurable): share of trips that scan a loyalty card / app at the till; not measured"},
    "household": {"value": "opted-in shoppers of the same persona in one run, up to 3 trips per loyalty_id, 7 days apart",
                  "note": "simulation shortcut so a loyalty_id has repeat visits to count; in a store the loyalty card makes this link"},
    "put_back_capture": {"value": 1.0, "note": "assumption: every sim put-back is caught as a scan_out (cart camera / weight "
                         "drop). With scan-only handsets an item put back without being scanned would be missed: upper bound"},
}
NOT_RECORDED = ["noticed (looked without the trolley stopping)", "which product at a bay was looked at",
                "persona / archetype", "OCEAN traits", "mission / budget", "Jev probabilities, reasons, feelings",
                "back-of-pack reads", "anything about health (only declared at checkout, never inferred)"]


def _p(key):
    return PACING[key]["value"]


def unit_of(slot: str) -> str:
    return slot.rsplit("-r", 1)[0] if "-r" in slot else slot


def load_run(run: str) -> dict:
    fp = run if os.path.exists(run) else os.path.join(RUNS_DIR, os.path.basename(run).replace(".json", "") + ".json")
    if not os.path.exists(fp):
        raise ValueError(f"no such run: {run}")
    with open(fp) as f:
        return json.load(f)


def store_variant(run: dict) -> str | None:
    """the store a run used, as the sim/run.py STORE_VARIANT name (None = the standard store)."""
    s = (run.get("inputs") or {}).get("store") or ""
    b = os.path.basename(s)
    if "/formats/" in s:
        return b.split(".")[0]
    if b.startswith("store_") and b != "store.config.json":
        return b[len("store_"):].split(".")[0]
    return None


def _catalog(run: dict) -> dict:
    cat = {}
    for p in (run.get("inputs") or {}).get("catalog") or []:
        fp = os.path.join(ROOT, p)
        if os.path.exists(fp):
            d = json.load(open(fp))
            for x in (d.values() if isinstance(d, dict) else d):
                if isinstance(x, dict) and x.get("code"):
                    cat.setdefault(str(x["code"]), x)
    for x in run.get("catalog_inline") or []:
        if isinstance(x, dict) and x.get("code"):
            cat.setdefault(str(x["code"]), x)
    return cat


def _aisles(run: dict) -> dict:
    s = (run.get("inputs") or {}).get("store")
    try:
        cfg = json.load(open(os.path.join(ROOT, s)))
        return {u["id"]: u.get("aisle") for u in cfg.get("units", [])}
    except Exception:
        return {}


def _hid(*parts, n=8):
    return hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()[:n]


def session_of(agent: dict, run: dict, cat: dict, aisles: dict, rng: random.Random, day: dt.date) -> dict:
    events = agent.get("events") or []
    by_slot: dict[str, list] = {}
    for e in events:
        by_slot.setdefault(e.get("slot"), []).append(e)
    # bay visits in walking order (path holds slots; consecutive slots of one unit = one bay stop)
    bays: list[dict] = []
    for slot in agent.get("path") or []:
        u = unit_of(slot)
        if not bays or bays[-1]["bay"] != u:
            bays.append({"bay": u, "aisle": aisles.get(u), "slots": [], "_ev": []})
        bays[-1]["slots"].append(slot)
        bays[-1]["_ev"] += by_slot.get(slot, [])
    start = dt.datetime.combine(day, dt.time(8)) + dt.timedelta(seconds=rng.uniform(0, 12 * 3600))
    t = start
    scans, basket, prev = [], [], None
    for b in bays:
        if prev is not None:
            m = _p("walk_m_same_aisle") if aisles.get(prev) == b["aisle"] and b["aisle"] is not None else _p("walk_m_new_aisle")
            t += dt.timedelta(seconds=m / _p("walk_speed_mps"))
        dwell = _p("pass_s_per_shelf_row") * len(b["slots"])
        ev_out = []
        for e in b["_ev"]:
            st = e.get("stage_reached")
            if st in ("looked", "taken", "put_back"):
                dwell += float(((e.get("notice_factors") or {}).get("seconds_at_shelf")) or 6.0)
            if st in ("taken", "put_back"):
                dwell += _p("pickup_s")
                kind = "scan_in" if st == "taken" else "scan_out"
                if kind == "scan_out" and rng.random() > _p("put_back_capture"):
                    continue
                if kind == "scan_out":  # it went in, then came back out: log both, as the trolley would
                    ev_out.append({"type": "scan_in", "code": e["product"]})
                ev_out.append({"type": kind, "code": e["product"]})
                if kind == "scan_in":
                    basket.append(e["product"])
        dwell = round(dwell, 1)
        arrive = t
        t += dt.timedelta(seconds=dwell)
        step = dwell / (len(ev_out) + 1)
        for i, x in enumerate(ev_out):
            x["t"] = (arrive + dt.timedelta(seconds=step * (i + 1))).isoformat(timespec="seconds")
            p = cat.get(x["code"]) or {}
            x["name"] = p.get("name") or p.get("product_name") or x["code"]
            x["bay"] = b["bay"]
        if not ev_out and dwell >= _p("dwell_min_s"):
            ev_out.append({"type": "dwell_no_scan", "bay": b["bay"], "t": arrive.isoformat(timespec="seconds"),
                           "dwell_s": dwell, "label": f"stopped {dwell:.0f} s at bay {b['bay']}, scanned nothing "
                           f"(>= {_p('dwell_min_s'):.0f} s threshold, assumption)"})
        b.update({"arrive": arrive.isoformat(timespec="seconds"), "dwell_s": dwell, "events": ev_out})
        scans += ev_out
        prev = b["bay"]
        del b["_ev"]
    end = t + dt.timedelta(seconds=60)  # assumption: ~1 min at the till, folded into the trip end
    items = list(dict.fromkeys(basket))
    priced = [_num((cat.get(c) or {}).get("price_gbp")) for c in items]
    return {
        "trolley_id": "T-" + "%08x" % rng.getrandbits(32),
        "store": store_variant(run) or "standard",
        "start": start.isoformat(timespec="seconds"), "end": end.isoformat(timespec="seconds"),
        "minutes": round((end - start).total_seconds() / 60, 1),
        "bays": bays, "path_slots": list(agent.get("path") or []),
        "events": scans,
        "counts": {"bays": len(bays), "scan_in": sum(1 for x in scans if x["type"] == "scan_in"),
                   "scan_out": sum(1 for x in scans if x["type"] == "scan_out"),
                   "dwell_no_scan": sum(1 for x in scans if x["type"] == "dwell_no_scan")},
        "checkout": {"items": items, "n_items": len(items),
                     "total_gbp": round(sum(x for x in priced if x), 2),
                     "total_source": "sum of catalog price_gbp over scanned-in items still in the trolley "
                                     "(catalog prices are curator assumptions)",
                     "opt_in_loyalty": False, "loyalty_id": None},
        "_persona": agent.get("persona_id"),  # used only to group households below, stripped before writing
    }


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def build(run: dict, opt_in: float | None = None) -> dict:
    opt_in = _p("opt_in_loyalty") if opt_in is None else float(opt_in)
    rid = run["run_id"]
    rng = random.Random(f"trolley|{rid}")
    cat, aisles = _catalog(run), _aisles(run)
    try:
        day0 = dt.date.fromisoformat(str(run.get("created", ""))[:10])
    except ValueError:
        day0 = dt.date.today()
    humans = [a for a in run.get("agents", []) if a.get("kind") != "ai_agent" and not str(a.get("persona_id", "")).startswith("ai_")]
    sessions = [session_of(a, run, cat, aisles, rng, day0) for a in humans]
    # loyalty opt-in at checkout, then group opted-in trips into households (assumption, see PACING.household)
    groups: dict[str, list] = {}
    for s in sessions:
        if rng.random() < opt_in:
            s["checkout"]["opt_in_loyalty"] = True
            groups.setdefault(s["_persona"], []).append(s)
    for pid, ss in groups.items():
        for k in range(0, len(ss), 3):
            lid = "LY-" + _hid(rid, pid, k).upper()
            chunk = ss[k:k + 3]
            for i, s in enumerate(chunk):  # trips 7 days apart, oldest first
                shift = dt.timedelta(days=7 * (len(chunk) - 1 - i))
                for key in ("start", "end"):
                    s[key] = (dt.datetime.fromisoformat(s[key]) - shift).isoformat(timespec="seconds")
                for b in s["bays"]:
                    b["arrive"] = (dt.datetime.fromisoformat(b["arrive"]) - shift).isoformat(timespec="seconds")
                for e in s["events"]:
                    e["t"] = (dt.datetime.fromisoformat(e["t"]) - shift).isoformat(timespec="seconds")
                s["checkout"]["loyalty_id"] = lid
    sessions.sort(key=lambda s: s["start"])
    for i, s in enumerate(sessions):
        s.pop("_persona", None)
        s["session_id"] = f"s{i + 1:04d}"
    loyalty: dict[str, list] = {}
    for s in sessions:
        if s["checkout"]["loyalty_id"]:
            loyalty.setdefault(s["checkout"]["loyalty_id"], []).append(s["session_id"])
    return {
        "run_id": rid, "generated": dt.datetime.now().isoformat(timespec="seconds"),
        "provenance": SIMULATED, "source_run": f"data/sim/runs/{rid}.json",
        "store": store_variant(run) or "standard", "store_config": (run.get("inputs") or {}).get("store"),
        "planogram": run.get("planogram"),
        "mapping": {"path (slots)": "bay visits (bay = shelf unit)", "taken": "scan_in",
                    "put_back": "scan_in then scan_out (the put-back EPOS never sees)",
                    "looked / dwell >= dwell_min_s, no scan": "dwell_no_scan (bay-level, product unknown)",
                    "basket at end": "checkout.items", "not_noticed": "nothing (time rolling past only)"},
        "pacing": PACING, "not_recorded": NOT_RECORDED,
        "privacy": "trolley_id random per trip; loyalty_id (pseudonymous hash) only when opt_in_loyalty is true; "
                   "no persona, traits or health data in a session",
        "n_sessions": len(sessions), "n_opted_in": sum(1 for s in sessions if s["checkout"]["opt_in_loyalty"]),
        "loyalty": [{"loyalty_id": k, "sessions": v, "trips": len(v)} for k, v in sorted(loyalty.items(), key=lambda kv: -len(kv[1]))],
        "sessions": sessions,
    }


def out_path(rid: str) -> str:
    return os.path.join(OUT_DIR, f"{rid}.sessions.json")


def write(run: dict, opt_in: float | None = None) -> str:
    d = build(run, opt_in)
    os.makedirs(OUT_DIR, exist_ok=True)
    fp = out_path(run["run_id"])
    with open(fp, "w") as f:
        json.dump(d, f, indent=1, ensure_ascii=False)
    _readme()
    return fp


def sessions_for(rid: str) -> dict:
    """cached sessions for a run; rebuilt if missing or older than the run file."""
    rid = os.path.basename(rid).replace(".json", "")
    fp, rf = out_path(rid), os.path.join(RUNS_DIR, rid + ".json")
    if not os.path.exists(rf):
        raise ValueError(f"no such run: {rid}")
    if not os.path.exists(fp) or os.path.getmtime(fp) < os.path.getmtime(rf):
        write(load_run(rf))
    with open(fp) as f:
        return json.load(f)


def summaries(rid: str) -> dict:
    d = sessions_for(rid)
    rows = [{"session_id": s["session_id"], "trolley_id": s["trolley_id"], "start": s["start"], "minutes": s["minutes"],
             **s["counts"], "n_items": s["checkout"]["n_items"], "total_gbp": s["checkout"]["total_gbp"],
             "opt_in_loyalty": s["checkout"]["opt_in_loyalty"], "loyalty_id": s["checkout"]["loyalty_id"]}
            for s in d["sessions"]]
    return {k: v for k, v in d.items() if k != "sessions"} | {"summaries": rows, "sessions": d["sessions"]}


def profile(body: dict) -> dict:
    """basket(s) from trolley sessions -> sim/customer.py profile. Caller holds the store lock (sim/server.py)."""
    import customer
    rid = body.get("run")
    if not rid:
        raise ValueError("run is required")
    d = sessions_for(rid)
    by_id = {s["session_id"]: s for s in d["sessions"]}
    lid = body.get("loyalty_id")
    if lid:
        picked = [s for s in d["sessions"] if s["checkout"]["loyalty_id"] == lid]
        if not picked:
            raise ValueError(f"no opted-in sessions for loyalty_id {lid}")
        link = f"linked by loyalty_id {lid}: the shopper opted in at checkout on {len(picked)} trip(s)"
    else:
        ids = [str(x) for x in body.get("session_ids") or []]
        picked = [by_id[i] for i in ids if i in by_id]
        if not picked:
            raise ValueError("no matching session_ids")
        lids = {s["checkout"]["loyalty_id"] for s in picked}
        if len(picked) > 1 and (None in lids or len(lids) > 1):
            raise ValueError("can't merge these sessions into one person: only trips under the same opted-in loyalty_id "
                             "are linked. Anonymous trips stay separate (privacy rule).")
        link = (f"linked by loyalty_id {picked[0]['checkout']['loyalty_id']} (opt-in)" if picked[0]["checkout"]["loyalty_id"]
                else "one anonymous trip: not linked to any person (no loyalty opt-in)")
    picked.sort(key=lambda s: s["start"])
    visits = [s["checkout"]["items"] for s in picked if s["checkout"]["items"]]
    if not visits:
        raise ValueError("these sessions checked out nothing (no scan_in left in the trolley)")
    req = {"visits": visits, "declared": body.get("declared") or {}, "engine": body.get("engine") or "code",
           "planogram": body.get("planogram") or d.get("planogram"), "products": body.get("products"),
           "name": body.get("name") or (lid and f"loyalty {lid}") or "anonymous trolley trip",
           "id": (lid or picked[0]["trolley_id"]).lower().replace("-", "_")}
    prof = customer.profile(req)
    puts = [e for s in picked for e in s["events"] if e["type"] == "scan_out"]
    prof["provenance"] = {
        "source": "from smart-trolley sessions", "simulated": SIMULATED, "run_id": d["run_id"],
        "sessions": [s["session_id"] for s in picked], "trolley_ids": [s["trolley_id"] for s in picked], "link": link,
        "from_trolley_signals": {
            "visits": f"{len(visits)} checkout basket(s) = scan_in minus scan_out per trip, oldest first",
            "habits": "count of trips each item was in the checkout basket",
            "put_backs": [{"code": e["code"], "name": e.get("name"), "bay": e.get("bay"), "t": e["t"]} for e in puts],
            "dwell_no_scan_bays": sorted({e["bay"] for s in picked for e in s["events"] if e["type"] == "dwell_no_scan"}),
            "minutes": [s["minutes"] for s in picked],
        },
        "inferred": "persona guess, likes / avoids, mission and budget come from sim/customer.py over the products in the "
                    "baskets (see persona_guess.method). Put-backs and dwells are shown, not used by the guess.",
        "declared_only": "diet / health lenses switch on only if declared (body.declared); never inferred from trolley data",
        "pacing": d["pacing"],
    }
    return prof


def _readme():
    os.makedirs(OUT_DIR, exist_ok=True)
    rows = "\n".join(f"| `{k}` | {v['value']} | {v['note']} |" for k, v in PACING.items())
    txt = f"""# smart-trolley sessions (SIMULATED)

Built by `sim/trolley.py` from `data/sim/runs/<run>.json`: what a store's tracked trolleys / scan-as-you-shop
baskets would record for the same trips (spec: `docs/ideas/smart-trolleys.md`). **Every file here is simulated**,
derived from a sim run. Nothing was measured in a real store.

    python3 sim/trolley.py data/sim/runs/<run>.json [--opt-in 0.6]   # -> <run>.sessions.json

## sim -> trolley signal

| in the sim | what the trolley records |
|---|---|
| agent path (shelf slots) | bay visits in walking order (bay = shelf unit, e.g. `U3`) with `dwell_s` |
| stage `taken` | `scan_in` |
| stage `put_back` | `scan_in` then `scan_out`: the put-back EPOS never sees |
| looked, or any stop >= `dwell_min_s` with no scan | `dwell_no_scan` for the **bay** (a trolley can't tell which product) |
| `not_noticed` | nothing (only the seconds rolling past the bay) |
| basket at the end | `checkout.items`, `total_gbp` (catalog `price_gbp`, curator assumptions) |
| loyalty card at the till | `opt_in_loyalty` (assumed share) and a pseudonymous `loyalty_id` only if opted in |

**dwell_s** = `pass_s_per_shelf_row` x rows in the bay + for each product looked at the persona's `seconds_at_shelf`
(sim value, from the event) + `pickup_s` for each pick-up. Walk time between bays = metres / walk speed.

## not recorded (a real trolley can't see it)

{chr(10).join('- ' + x for x in NOT_RECORDED)}

## pacing and other assumptions

| key | value | note |
|---|---|---|
{rows}

## privacy

`trolley_id` is random per trip and resets every trip. A session is linked to a person (`loyalty_id`, a pseudonymous
hash) **only** when `opt_in_loyalty` is true at checkout. Anonymous trips are never merged
(`POST /api/trolley/profile` refuses). Health / diet lenses switch on only when declared, never inferred.
Brands should only ever see aggregated funnels (k >= 10), see `docs/data-collection.md`.
"""
    with open(os.path.join(OUT_DIR, "README.md"), "w") as f:
        f.write(txt)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    opt = None
    if "--opt-in" in argv:
        opt = float(argv[argv.index("--opt-in") + 1])
        args = [a for a in args if a != argv[argv.index("--opt-in") + 1]]
    runs = args or sorted(glob.glob(os.path.join(RUNS_DIR, "run_*.json")))[-1:]
    for r in runs:
        run = load_run(r)
        fp = write(run, opt)
        d = json.load(open(fp))
        ss = d["sessions"]
        print(f"{os.path.relpath(fp, ROOT)}: {d['n_sessions']} sessions, {d['n_opted_in']} opted in, "
              f"{len(d['loyalty'])} loyalty ids, scan_in {sum(s['counts']['scan_in'] for s in ss)}, "
              f"scan_out {sum(s['counts']['scan_out'] for s in ss)}, dwell_no_scan {sum(s['counts']['dwell_no_scan'] for s in ss)}, "
              f"median minutes {sorted(s['minutes'] for s in ss)[len(ss) // 2] if ss else 0}")


if __name__ == "__main__":
    main(sys.argv[1:])

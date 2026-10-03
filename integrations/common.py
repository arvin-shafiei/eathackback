"""Shared helpers for integrations/: load the real data and turn sim run logs into a brand funnel.

Nothing here calls an LLM. Every number is a count from logged agent decisions
(data/sim/runs/*.json, CONTRACT.md shape) or a field from data/products/catalog.json (Open Food Facts).

Funnel stages (online and offline use the same four; see docs/data-collection.md):
  shown       the shopper's path passed the slot (e-com: impression)
  noticed     the notice gate fired, they looked (e-com: product-detail view)
  considered  they picked it up / read it (e-com: add-to-cart)
  picked      it went in the basket (e-com: purchase)
  put back    considered but rejected (e-com: remove-from-cart)
  walked past noticed but never considered (e-com: viewed, bounced)
"""
from __future__ import annotations

import glob
import json
import math
import os
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "data", "products", "catalog.json")
PERSONA_DIR = os.path.join(ROOT, "data", "personas", "lens")
RUNS_DIR = os.path.join(ROOT, "data", "sim", "runs")
BRAND_DIR = os.path.join(ROOT, "data", "sim", "brand")


def rel(p: str) -> str:
    return os.path.relpath(p, ROOT)


def load_catalog() -> list[dict]:
    with open(CATALOG) as f:
        return json.load(f)


def catalog_by_code() -> dict[str, dict]:
    return {p["code"]: p for p in load_catalog()}


def load_personas() -> dict[str, dict]:
    out = {}
    for f in sorted(glob.glob(os.path.join(PERSONA_DIR, "*.json"))):
        with open(f) as fh:
            p = json.load(fh)
        p["_file"] = rel(f)
        out[p["archetype"]] = p
    return out


def wilson(k: int, n: int, z: float = 1.96) -> list[float]:
    if n <= 0:
        return [0.0, 1.0]
    ph = k / n
    d = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / d
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d
    return [round(max(0.0, c - h), 4), round(min(1.0, c + h), 4)]


def human_runs(include_mock: bool = False) -> list[str]:
    """Human-shopper runs (run_*.json). Mock runs are excluded unless asked: their reasons are heuristic."""
    files = sorted(glob.glob(os.path.join(RUNS_DIR, "run_*.json")))
    return [f for f in files if include_mock or "_mock_" not in os.path.basename(f)]


def brand_funnel(code: str, run_files: list[str] | None = None) -> dict:
    """Aggregate one product's funnel across run logs. Pure counting over logged events."""
    cat = catalog_by_code()
    p = cat.get(code)
    run_files = run_files if run_files is not None else human_runs()
    tot = Counter()
    reasons = defaultdict(lambda: {"count": 0, "examples": []})
    by_arch = defaultdict(Counter)
    used = []
    for f in run_files:
        with open(f) as fh:
            r = json.load(fh)
        s = (r.get("stats") or {}).get("per_product", {}).get(code)
        if not s:
            continue
        used.append({"run_id": r.get("run_id"), "file": rel(f), "engine": r.get("engine") or ",".join(r.get("models") or []),
                     "agents": len(r.get("agents") or [])})
        for k in ("shown", "noticed", "considered", "picked", "rejected", "walk_past"):
            tot[k] += int(s.get(k) or 0)
        for t in s.get("top_reject_reasons") or []:
            m = t.get("mechanism", "unknown")
            reasons[m]["count"] += int(t.get("count") or 0)
            for e in (t.get("examples") or [])[:2]:
                if len(reasons[m]["examples"]) < 3:
                    reasons[m]["examples"].append({**e, "run_id": r.get("run_id")})
        for a, v in (s.get("by_archetype") or {}).items():
            for k in ("shown", "noticed", "picked", "rejected"):
                by_arch[a][k] += int(v.get(k) or 0)
    n = tot["shown"]
    looked_walked = max(0, tot["noticed"] - tot["considered"])
    stages = [
        {"stage": "shown", "label": "passed the shelf", "ecom": "impression", "count": n},
        {"stage": "noticed", "label": "looked at it", "ecom": "product-detail view", "count": tot["noticed"]},
        {"stage": "considered", "label": "picked it up", "ecom": "add-to-cart", "count": tot["considered"]},
        {"stage": "picked", "label": "kept it", "ecom": "purchase", "count": tot["picked"]},
    ]
    for st in stages:
        st["rate_of_shown"] = round(st["count"] / n, 4) if n else None
        st["ci95"] = wilson(st["count"], n)
    top = sorted(({"mechanism": m, **v} for m, v in reasons.items()), key=lambda x: -x["count"])
    return {
        "product": {"code": code, "name": (p or {}).get("name"), "brand": (p or {}).get("brand"),
                    "category": (p or {}).get("category"), "role": (p or {}).get("role"),
                    "image": (p or {}).get("image"), "off_url": (p or {}).get("off_url")},
        "funnel": stages,
        "leaks": {"looked_and_walked_away": looked_walked, "picked_up_and_put_back": tot["rejected"],
                  "never_noticed": max(0, n - tot["noticed"])},
        "top_put_back_reasons": top[:5],
        "by_archetype": {a: {**dict(v), "pick_rate": round(v["picked"] / v["shown"], 4) if v["shown"] else None,
                             "ci95": wilson(v["picked"], v["shown"])} for a, v in sorted(by_arch.items())},
        "small_sample": n < 30,
        "sources": {"runs": used, "catalog": rel(CATALOG),
                    "method": "counts of logged agent decisions summed across runs; Wilson 95% CI (z=1.96)",
                    "funnel_mapping": "docs/data-collection.md#the-4-stage-funnel"},
    }


def best_documented_codes(n: int = 5, run_files: list[str] | None = None) -> list[str]:
    """Products with the most 'shown' events across runs (most evidence)."""
    run_files = run_files if run_files is not None else human_runs()
    c = Counter()
    for f in run_files:
        with open(f) as fh:
            r = json.load(fh)
        for code, s in (r.get("stats") or {}).get("per_product", {}).items():
            c[code] += int(s.get("shown") or 0)
    return [k for k, _ in c.most_common(n)]

"""Literature-calibrated notice model (no LLM).

p_notice = sigmoid(alpha0 + alpha_row[row] + alpha_f*ln(facings) + alpha_c*(centrality-1)
                   + mission term + time term + OCEAN terms)

Every coefficient comes from sim/coefficients.json, where each one carries a source.
`explain()` returns the coefficient table with derivations so the frontend can show it.
"""
from __future__ import annotations

import glob
import json
import math
import os
import re
from functools import lru_cache

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
COEF_PATH = os.path.join(HERE, "coefficients.json")
OCEAN_DIR = os.path.join(ROOT, "data", "personas", "ocean")

ROW_NAMES = {1: "top", 2: "eye", 3: "bottom"}
# E.json external-eating mapping: eye-level HFSS-ish products in snack/confectionery/soft-drink units
HFSS_CATS = {"crisps_savoury", "biscuits_chocolate", "soft_drinks", "snack_bars"}


def logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


@lru_cache(maxsize=1)
def coefficients() -> dict:
    with open(COEF_PATH) as f:
        c = json.load(f)
    p_ref = c["p_ref_eye_centre_1facing"]["value"]
    p_bottom = p_ref / c["eye_vs_bottom_sales_ratio"]["value"]
    p_top = p_bottom * c["top_vs_bottom_notice_ratio"]["value"]
    p_edge = p_ref / c["centre_vs_edge_ratio"]["value"]
    derived = {
        "alpha0": {"value": logit(p_ref), "source": "logit(p_ref_eye_centre_1facing)"},
        "alpha_row": {
            "eye": {"value": 0.0, "source": "reference row"},
            "top": {"value": logit(p_top) - logit(p_ref),
                    "source": "derived from eye_vs_bottom_sales_ratio and top_vs_bottom_notice_ratio"},
            "bottom": {"value": logit(p_bottom) - logit(p_ref),
                       "source": "derived from eye_vs_bottom_sales_ratio"},
        },
        "alpha_f": {"value": c["facings_elasticity"]["value"] / (1 - p_ref),
                    "source": "derived from facings_elasticity at p_ref"},
        "alpha_c": {"value": logit(p_ref) - logit(p_edge),
                    "source": "derived from centre_vs_edge_ratio"},
    }
    c["_derived"] = derived
    c["_ocean_effects"] = load_ocean_effects(c)
    return c


def _classify_applies(text: str) -> str:
    t = (text or "").lower()
    if any(k in t for k in ("label/read", "nutrition field", "'warning' attributes", "read the back")):
        return "label"
    if "favourite" in t:
        return "incumbent"
    if any(k in t for k in ("off-mission", "off_mission", "on_mission=false", "browse", "impulse", "unplanned")):
        return "off_mission"
    if any(k in t for k in ("visual food cue", "hfss")):
        return "hfss"
    if "favourite" in t:
        return "incumbent"
    if any(k in t for k in ("challenger", "unfamiliar", "new brand", "novel", "trending")):
        return "challenger"
    return "all"


def _z_convention(trait: str, d: dict) -> tuple[float, float, str]:
    """(mean, sd) to standardise a 0-1 trait, read from the ocean file's own convention text."""
    blob = json.dumps({k: v for k, v in d.items() if k != "effects"})
    m = re.search(r"\(" + trait + r"01 - ([\d.]+)\) / ([\d.]+)", blob)
    if m:
        return float(m.group(1)), float(m.group(2)), m.group(0)
    if re.search(r"2\*\(" + trait + r" - 0\.5\)", blob):
        return 0.5, 0.5, f"n_c = 2*({trait} - 0.5)"
    return 0.5, 0.5, "assumption: default (T - 0.5) / 0.5"


def load_ocean_effects(c: dict) -> list[dict]:
    """OCEAN modifiers for the NOTICE and LABEL-READ stages only.

    Uses data/personas/ocean/<T>.json (written by the OCEAN research agent) when present. Only effects
    whose sim_mapping targets the notice model or the label/read stage, with a non-zero coef, are used
    here; choice-stage effects are carried into the LLM persona prompt qualitatively, not numerically.
    Falls back to the labelled defaults in coefficients.json."""
    effects: list[dict] = []
    files = sorted(glob.glob(os.path.join(OCEAN_DIR, "*.json")))
    for fp in files:
        try:
            with open(fp) as f:
                d = json.load(f)
        except Exception:
            continue
        trait = str(d.get("trait") or os.path.basename(fp)[0]).upper()[:1]
        mean, sd, conv = _z_convention(trait, d)
        for e in d.get("effects", []):
            try:
                coef = float(e.get("coef", 0))
            except Exception:
                continue
            mapping = str(e.get("sim_mapping", ""))
            ml = mapping.lower()
            is_notice = ml.startswith(("sim/notice.py", "notice", "(a) notice"))
            is_label = "label/read" in ml or "p_read_label" in ml
            if coef == 0 or not (is_notice or is_label):
                continue  # choice/lens-stage effect: carried qualitatively by the LLM persona prompt
            if is_label or "nutrition field" in ml or "'warning' attributes" in ml:
                applies = "label"
            else:
                applies = _classify_applies(mapping)
            if applies == "all":
                continue  # unclassified: never applied silently
            effects.append({
                "trait": trait, "coef": coef, "applies": applies, "z_mean": mean, "z_sd": sd,
                "z_convention": conv, "id": e.get("id", ""),
                "effect": e.get("effect") or e.get("behaviour", "")[:120],
                "sim_mapping": mapping[:300],
                "source": str(e.get("source", ""))[:400] or f"{os.path.basename(fp)} (no source field)",
                "confidence": e.get("confidence", ""),
                "file": os.path.relpath(fp, ROOT),
            })
    if effects:
        return effects
    for name, e in c["ocean_defaults"].items():
        if name.startswith("_"):
            continue
        effects.append({
            "trait": e["trait"], "coef": e["coef"], "z_mean": 0.5, "z_sd": 0.5,
            "z_convention": "(T - 0.5) / 0.5", "id": name,
            "applies": _classify_applies(e["applies_to"]),
            "effect": e["effect"], "source": e["source"], "file": "sim/coefficients.json",
        })
    return effects


def trait_z(e: dict, ocean: dict) -> float:
    v = float(ocean.get(e["trait"], e["z_mean"]))
    return (v - e["z_mean"]) / e["z_sd"]


def centrality(pos: int, n: int) -> float:
    """1 at the centre of the slot set, 0 at the edge."""
    if n <= 1:
        return 1.0
    mid = (n - 1) / 2.0
    return 1.0 - abs(pos - mid) / mid


def p_notice(*, row: int, facings: int, pos: int, n_in_set: int, on_mission: bool,
             ocean: dict, role: str = "", persona_params: dict | None = None,
             nutriscore: str = "", category: str = "") -> tuple[float, dict]:
    """Return (p, factors). factors records each logit term so the frontend can show why."""
    c = coefficients()
    d = c["_derived"]
    pp = persona_params or {}
    # rows below the 3 we have alphas for (4-5 on superstore gondolas) are below eye level -> bottom alpha.
    # source: data/store/formats/*.config.json notice_row_map (assumption, conservative; was silently "eye" before)
    rowname = ROW_NAMES.get(int(row), "bottom")

    a0 = d["alpha0"]["value"]
    if c["persona_eye_override"]["value"] and pp.get("p_notice_eye_level"):
        a0 = logit(float(pp["p_notice_eye_level"]))
    a_row = d["alpha_row"][rowname]["value"]
    f_eff = max(1, min(int(facings or 1), int(c["facings_cap"]["value"])))
    a_f = d["alpha_f"]["value"] * math.log(f_eff)
    cent = centrality(pos, n_in_set)
    a_c = d["alpha_c"]["value"] * (cent - 1.0)
    a_m = 0.0 if on_mission else c["mission_relevance_logit"]["off_mission_value"]
    secs = float(pp.get("seconds_at_shelf") or c["seconds_at_shelf_logit_per_ln"]["ref_seconds"])
    a_t = c["seconds_at_shelf_logit_per_ln"]["value"] * math.log(
        max(secs, 1.0) / c["seconds_at_shelf_logit_per_ln"]["ref_seconds"])

    trait_boost = 0.0
    trait_terms = []
    hfss = str(nutriscore).lower() in ("d", "e") and category in HFSS_CATS
    for e in c["_ocean_effects"]:
        ap = e["applies"]
        if ap == "label":
            continue
        if ap == "challenger" and role != "challenger":
            continue
        if ap == "incumbent" and role != "incumbent":
            continue
        if ap == "off_mission" and on_mission:
            continue
        if ap == "hfss" and not (hfss and rowname == "eye"):
            continue
        term = e["coef"] * trait_z(e, ocean)
        trait_boost += term
        trait_terms.append({"trait": e["trait"], "id": e.get("id", ""), "term": round(term, 3),
                            "effect": e["effect"][:100], "file": e["file"]})

    z = a0 + a_row + a_f + a_c + a_m + a_t + trait_boost
    p = sigmoid(z)
    factors = {
        "row": rowname, "facings": int(facings or 1), "centrality": round(cent, 2),
        "on_mission": on_mission, "seconds_at_shelf": secs,
        "logit_terms": {"alpha0": round(a0, 3), "row": round(a_row, 3), "facings": round(a_f, 3),
                        "centre": round(a_c, 3), "mission": round(a_m, 3), "time": round(a_t, 3),
                        "ocean": round(trait_boost, 3)},
        "trait_boost": round(trait_boost, 3),
        "trait_terms": trait_terms,
    }
    return p, factors


def p_reads_labels(ocean: dict, persona_params: dict | None = None) -> float:
    """Chance the shopper turns the pack over (gets ingredients/nutrition in the prompt).
    Base 0.27 = share of UK in-store shoppers seen looking at nutrition info (Grunert, Wills &
    Fernandez-Celemin 2010, Appetite 55(2), via data/personas/ocean/C.json C7). Trait terms from the
    ocean files' label/read effects. Blended 50/50 with the persona's skeptic-calibrated
    reads_structured_data_0_1 when present (assumption: equal weight)."""
    pp = persona_params or {}
    c = coefficients()
    z = logit(0.27)
    for e in c["_ocean_effects"]:
        if e["applies"] == "label":
            z += e["coef"] * trait_z(e, ocean)
    p = sigmoid(z)
    rsd = pp.get("reads_structured_data_0_1")
    if rsd is None:
        return p
    return 0.5 * p + 0.5 * float(rsd)


def explain() -> dict:
    c = coefficients()
    return {
        "formula": "p_notice = sigmoid(alpha0 + alpha_row[row] + alpha_f*ln(min(facings,cap)) + alpha_c*(centrality-1) + mission + time + sum(OCEAN terms))",
        "derived": c["_derived"],
        "inputs": {k: v for k, v in c.items() if not k.startswith("_") and k != "ocean_defaults"},
        "ocean_effects": c["_ocean_effects"],
    }


if __name__ == "__main__":
    print(json.dumps(explain(), indent=1)[:3000])
    for row in (1, 2, 3):
        for fac in (1, 2, 4):
            p, _ = p_notice(row=row, facings=fac, pos=0, n_in_set=1, on_mission=True, ocean={})
            print(ROW_NAMES[row], fac, round(p, 3))

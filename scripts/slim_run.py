"""Shrink a sim run log for the browser and git without losing traceability.

The repeated per-event OCEAN trait explanations (`notice_factors.trait_terms[].effect/file`) are moved once into
a top-level `trait_effects` table keyed by `<trait>:<id or effect hash>`; each event keeps the key + its numeric
term, so every notice probability still traces to its effect text and source file.
Usage: python3 scripts/slim_run.py data/sim/runs/<run>.json   (rewrites in place, compact JSON)
"""
import hashlib, json, sys

path = sys.argv[1]
r = json.load(open(path))
table = {}
for a in r.get("agents", []):
    for ev in a.get("events", []):
        nf = ev.get("notice_factors") or {}
        terms = nf.get("trait_terms")
        if not terms:
            continue
        slim = []
        for t in terms:
            key = f"{t.get('trait')}:{t.get('id') or hashlib.sha1((t.get('effect') or '').encode()).hexdigest()[:8]}"
            table.setdefault(key, {"trait": t.get("trait"), "effect": t.get("effect"), "file": t.get("file")})
            slim.append({"k": key, "term": t.get("term")})
        nf["trait_terms"] = slim
# not-noticed events: keep the notice INPUTS (row, facings, centrality, on_mission, seconds_at_shelf) + p_notice,
# drop the stored per-term arithmetic; it is exactly recomputable with sim/notice.py p_notice(...) from those inputs.
dropped = 0
for a in r.get("agents", []):
    for ev in a.get("events", []):
        if ev.get("stage_reached") == "not_noticed" or ev.get("decision") == "not_noticed":
            nf = ev.get("notice_factors") or {}
            for k in ("logit_terms", "trait_terms"):
                if k in nf:
                    nf.pop(k); dropped += 1
            ev["notice_trace"] = "recompute: sim/notice.py p_notice(row, facings, centrality, on_mission, ocean, persona_params)"
r["trait_effects"] = table
r["slimmed"] = ("trait_terms[].effect/file moved to top-level trait_effects; not-noticed events keep notice inputs + p_notice, "
              "their per-term arithmetic is dropped (recompute with sim/notice.py) — scripts/slim_run.py; no values changed")
with open(path, "w") as f:
    json.dump(r, f, separators=(",", ":"))
print(path, "trait effects:", len(table))

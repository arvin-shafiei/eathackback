"""Tiny API for the frontend (stdlib http.server) on :8787.

POST /api/run       {"planogram": <dict or path>, "agents": 10, "seed": 1, "engine": "jev"}   engine: jev (default) | mock | llm
POST /api/agent_run {"models": ["jev"], "runs": 3, "seed": 1, "mock": false}                   models default ["jev"]
POST /api/optimise  {"product": "<code>", "agents": 30, "seeds": [1], "edits": ["eye","facings","claim"], "engine": "jev"}
OpenRouter is only called when a request explicitly asks for engine "llm" (or names OpenRouter models in agent_run).
POST /api/run  also takes "persona_ids": [...] and "agents_per_persona": N to test only those personas
GET  /api/personas        all personas (data/personas/lens + data/personas/custom), each with "custom": bool
POST /api/personas        persona builder: validate, normalise, fill sim_params from the nearest persona, save
                          to data/personas/custom/<slug>.json, return it
POST /api/placement/scan        {"product": "<code>", "planogram": <dict>, "agents": 200, "seed": 1}
POST /api/placement/experiment  {"product": "<code>", "planogram": <dict>, "placements": [{"slot","pos","facings"}], "agents": 60, "seeds": [1], "engine": "jev"}
POST /api/import     {"ref": "<tesco product link | barcode | open food facts link>"}  -> product draft
/api/run, /api/agent_run, /api/optimise and /api/placement/* also take "products": [<brand-supplied product>, ...]
(sim/uploads.py); /api/agent_run takes "exclude": [codes].
GET  /api/runs            list of runs (id, created, models, n_agents, cost)
GET  /api/runs/<run_id>   full run json
GET  /api/coefficients    notice-model coefficients with sources
GET  /api/health
"""
from __future__ import annotations

import contextlib
import datetime as dt
import glob
import json
import math
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import notice  # noqa: E402
import run as simrun  # noqa: E402

MAX_AGENTS = 200  # guard against an accidental huge spend from the UI
_run_lock = threading.Lock()


@contextlib.contextmanager
def _store_for(body):
    """Hold the run lock and point the loaders in sim/run.py at the store the request names ("store": "xl").
    Reset on the way out, so a request that names no store always gets the standard one."""
    store = body.get("store") or None
    if store not in simrun.STORE_VARIANTS and store != "standard" and body.get("products"):
        # simulating an upload on the wrong store would put it on shelves the shoppers never walk
        raise ValueError(f"brand uploads run on the standard and xl stores; the '{store}' format is not wired to the "
                         "upload path yet. open the app with ?store=xl")
    with _run_lock:
        simrun.STORE_VARIANT = store if store in simrun.STORE_VARIANTS else None
        try:
            yield
        finally:
            simrun.STORE_VARIANT = None

USER_SRC = "user-defined (dashboard)"
OCEAN_KEYS = "OCEAN"


class BadRequest(ValueError):
    pass


# ---------------------------------------------------------------- persona builder
def catalog_fields() -> set:
    cat, _ = simrun.load_catalog()
    out = set()
    for p in cat.values():
        out.update(k for k in p.keys() if not k.startswith("_"))
    return out


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:48] or "persona"


def _cos(a: list[float], b: list[float]) -> float:
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / (na * nb) if na and nb else 0.0


def _lens_vec(p: dict) -> dict:
    v = {}
    for l in p.get("lens") or []:
        key = str(l.get("off_field") or l.get("attribute") or "")
        try:
            v[key] = v.get(key, 0.0) + float(l.get("weight") or 0)
        except Exception:
            continue
    return v


def nearest_persona(new: dict, pool: list[dict]) -> dict | None:
    """Similarity = 0.5 * cosine(OCEAN centred at 0.5) + 0.5 * cosine(lens weights by off_field)."""
    best = None
    o_new = [float(new["ocean"][t]) - 0.5 for t in OCEAN_KEYS]
    l_new = _lens_vec(new)
    for p in pool:
        o = [float(p.get("ocean", {}).get(t, 0.5)) - 0.5 for t in OCEAN_KEYS]
        lp = _lens_vec(p)
        keys = sorted(set(l_new) | set(lp))
        lc = _cos([l_new.get(k, 0.0) for k in keys], [lp.get(k, 0.0) for k in keys])
        oc = _cos(o_new, o)
        sim = 0.5 * oc + 0.5 * lc
        if best is None or sim > best["similarity"]:
            best = {"persona_id": p["id"], "similarity": round(sim, 4), "ocean_cosine": round(oc, 4),
                    "lens_cosine": round(lc, 4), "shared_lens_fields": sorted(set(l_new) & set(lp)), "_p": p}
    return best


def build_persona(body: dict) -> dict:
    req = ["name", "archetype", "mission", "budget_gbp", "ocean", "lens", "rejection_triggers", "trust_signals"]
    missing = [k for k in req if body.get(k) in (None, "", [], {})]
    if missing:
        raise BadRequest(f"missing required fields: {missing}")
    missions = [k for k in simrun.MISSION_CATEGORIES if not k.startswith("_")]
    if body["mission"] not in missions:
        raise BadRequest(f"mission must be one of {missions}")
    try:
        budget = float(body["budget_gbp"])
    except Exception:
        raise BadRequest("budget_gbp must be a number")
    if budget <= 0:
        raise BadRequest("budget_gbp must be > 0")
    oc = body["ocean"]
    if not isinstance(oc, dict) or any(t not in oc for t in OCEAN_KEYS):
        raise BadRequest("ocean needs O, C, E, A, N")
    ocean, clamped = {}, []
    for t in OCEAN_KEYS:
        try:
            v = float(oc[t])
        except Exception:
            raise BadRequest(f"ocean.{t} must be a number")
        c = min(1.0, max(0.0, v))
        if c != v:
            clamped.append(f"{t}: {v} -> {c}")
        ocean[t] = round(c, 3)
    fields = catalog_fields()
    lens_in = body["lens"]
    if not isinstance(lens_in, list):
        raise BadRequest("lens must be a list")
    lens, bad = [], []
    for i, l in enumerate(lens_in):
        if not isinstance(l, dict):
            raise BadRequest(f"lens[{i}] must be an object")
        for k in ("attribute", "off_field", "direction", "weight"):
            if l.get(k) in (None, ""):
                raise BadRequest(f"lens[{i}].{k} is required")
        if l["off_field"] not in fields:
            bad.append(l["off_field"])
        try:
            w = float(l["weight"])
        except Exception:
            raise BadRequest(f"lens[{i}].weight must be a number")
        if w < 0:
            raise BadRequest(f"lens[{i}].weight must be >= 0")
        lens.append({"attribute": str(l["attribute"]), "off_field": l["off_field"], "direction": str(l["direction"]),
                     "weight_input": w, "why": str(l.get("why") or ""), "source": USER_SRC})
    if bad:
        raise BadRequest(f"lens off_field not in the catalog: {sorted(set(bad))}. Valid fields: {sorted(fields)}")
    tw = sum(l["weight_input"] for l in lens)
    if tw <= 0:
        raise BadRequest("lens weights must sum to > 0")
    for l in lens:
        l["weight"] = round(l["weight_input"] / tw, 4)

    def items(xs, key):
        out = []
        for x in xs or []:
            if isinstance(x, dict) and x.get(key):
                out.append({key: str(x[key]), "source": str(x.get("source") or USER_SRC)})
            elif isinstance(x, str) and x.strip():
                out.append({key: x.strip(), "source": USER_SRC})
        return out

    triggers = items(body["rejection_triggers"], "trigger")
    trust = items(body["trust_signals"], "signal")
    if not triggers or not trust:
        raise BadRequest("rejection_triggers and trust_signals need at least one non-empty entry each")
    name, archetype = str(body["name"]).strip(), str(body["archetype"]).strip()
    slug = _slug(f"{name}_{archetype}")
    persona = {
        "id": f"p_custom_{slug}", "name": name, "archetype": archetype, "archetype_source": USER_SRC,
        "mission": body["mission"], "mission_source": USER_SRC,
        "budget_gbp": budget, "budget_source": USER_SRC,
        "channel": body.get("channel") or "instore",
        "ocean": ocean, "ocean_source": USER_SRC + (f"; clamped to 0-1: {clamped}" if clamped else ""),
        "lens": lens, "lens_note": "weights normalised to sum to 1 in code (sim/server.py build_persona); weight_input is what the user typed",
        "rejection_triggers": triggers, "trust_signals": trust,
        "habits": items(body.get("habits"), "habit"),
        "dossier": str(body.get("dossier") or
                       f"I'm {name}. {archetype.replace('_', ' ').capitalize()} shopper, on {body['mission'].replace('_', ' ')} "
                       f"with about £{budget:.0f} to spend."),
        "dossier_source": USER_SRC if body.get("dossier") else "generated in code from name, archetype, mission and budget (sim/server.py)",
        "verbatims": [v for v in (body.get("verbatims") or []) if isinstance(v, dict) and v.get("quote")],
        "custom": True, "created": dt.datetime.now().isoformat(timespec="seconds"),
    }
    pool = [p for p in simrun.load_personas()[0] if not p.get("custom")]
    near = nearest_persona(persona, pool)
    user_sp = body.get("sim_params") or body.get("sim_parameters") or {}
    sp, sp_src = {}, {}
    if near:
        base = near["_p"].get("sim_parameters") or {}
        for k, v in base.items():
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                sp[k] = v
                sp_src[k] = f"borrowed from nearest persona {near['persona_id']} (similarity {near['similarity']})"
    for k, v in (user_sp.items() if isinstance(user_sp, dict) else []):
        try:
            sp[k] = float(v)
            sp_src[k] = USER_SRC
        except Exception:
            continue
    persona["sim_params"] = sp
    persona["sim_params_sources"] = sp_src
    if near:
        persona["sim_params_borrowed_from"] = {k: v for k, v in near.items() if k != "_p"} | {
            "method": "nearest existing (non-custom) persona by 0.5*cosine(OCEAN centred at 0.5) + "
                      "0.5*cosine(lens weights keyed by off_field); only sim_params the user did not set are borrowed"}
    os.makedirs(simrun.CUSTOM_PERSONAS_DIR, exist_ok=True)
    fp = os.path.join(simrun.CUSTOM_PERSONAS_DIR, slug + ".json")
    with open(fp, "w") as f:
        json.dump(persona, f, indent=1, ensure_ascii=False)
    persona["_file"] = os.path.relpath(fp, simrun.ROOT)
    return persona


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/")
        if path == "/api/health":
            return self._send(200, {"ok": True})
        if path == "/api/coefficients":
            return self._send(200, notice.explain())
        if path == "/api/personas":
            ps, src = simrun.load_personas()
            return self._send(200, [{**p, "custom": bool(p.get("custom"))} for p in ps])
        if path == "/api/runs":
            out = []
            for fp in sorted(glob.glob(os.path.join(simrun.RUNS_DIR, "*.json")), reverse=True):
                try:
                    r = json.load(open(fp))
                    out.append({"run_id": r["run_id"], "created": r.get("created"), "models": r.get("models"),
                                "arm": r.get("arm", "shopper"), "n_agents": len(r.get("agents", [])),
                                "cost": r.get("cost"), "label": r.get("label", ""), "mock": r.get("mock", False),
                                "engine": r.get("engine")})
                except Exception:
                    continue
            return self._send(200, out)
        if path.startswith("/api/runs/"):
            rid = os.path.basename(path)
            fp = os.path.join(simrun.RUNS_DIR, rid + ".json")
            if os.path.exists(fp):
                return self._send(200, json.load(open(fp)))
            return self._send(404, {"error": "no such run"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?")[0].rstrip("/")
        try:
            b = self._body()
            if path == "/api/personas":
                return self._send(200, build_persona(b))
            with _store_for(b):
                if path == "/api/run":
                    engine = "mock" if b.get("mock") else b.get("engine", simrun.DEFAULT_ENGINE)
                    pids = b.get("persona_ids") or None
                    app = b.get("agents_per_persona")
                    if pids and app and int(app) * len(pids) > MAX_AGENTS:
                        raise BadRequest(f"agents_per_persona x persona_ids exceeds {MAX_AGENTS}")
                    run = simrun.run_simulation(planogram=b.get("planogram"),
                                                agents=min(int(b.get("agents", 10)), MAX_AGENTS),
                                                persona_ids=pids, agents_per_persona=int(app) if app else None,
                                                models=b.get("models") if engine == "llm" else None,
                                                seed=int(b.get("seed", 1)), engine=engine,
                                                max_tokens=min(int(b.get("max_tokens", 250)), 300),
                                                label=b.get("label", "ui"),
                                                extra_products=b.get("products"))
                    return self._send(200, run)
                if path == "/api/agent_run":
                    import agent_shopper
                    run = agent_shopper.run_agents(b.get("models") or ["jev"],
                                                   min(int(b.get("runs", 3)), 20), int(b.get("seed", 1)),
                                                   bool(b.get("mock", False)),
                                                   extra_products=b.get("products"), exclude=b.get("exclude"))
                    return self._send(200, run)
                if path == "/api/optimise":
                    import optimise
                    out = optimise.optimise(b["product"], min(int(b.get("agents", 30)), MAX_AGENTS),
                                            b.get("seeds", [1]), b.get("models"), bool(b.get("mock", False)),
                                            b.get("edits", ["eye", "facings", "claim"]), b.get("price"),
                                            b.get("planogram"),
                                            engine="mock" if b.get("mock") else b.get("engine", simrun.DEFAULT_ENGINE),
                                            extra_products=b.get("products"))
                    return self._send(200, out)
                if path == "/api/import":
                    import tesco
                    return self._send(200, tesco.import_product(str(b.get("ref") or "")))
                if path == "/api/placement/scan":
                    import placement
                    out = placement.scan(b["product"], planogram=b.get("planogram"),
                                         extra_products=b.get("products"),
                                         agents=min(int(b.get("agents", 200)), 1000), seed=int(b.get("seed", 1)))
                    return self._send(200, out)
                if path == "/api/placement/experiment":
                    import placement
                    out = placement.experiment(b["product"], planogram=b.get("planogram"),
                                               extra_products=b.get("products"),
                                               placements=(b.get("placements") or [])[:5],
                                               agents=min(int(b.get("agents", 60)), MAX_AGENTS),
                                               seeds=b.get("seeds", [1]), models=b.get("models"),
                                               engine="mock" if b.get("mock") else b.get("engine", simrun.DEFAULT_ENGINE))
                    return self._send(200, out)
            self._send(404, {"error": "not found"})
        except BadRequest as e:
            self._send(400, {"error": str(e)[:1500]})
        except ValueError as e:
            self._send(400, {"error": str(e)[:500]})
        except Exception as e:
            self._send(500, {"error": repr(e)[:500]})


def main(port=8787):
    srv = ThreadingHTTPServer(("0.0.0.0", port), H)
    print(f"sim server on http://localhost:{port}")
    srv.serve_forever()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8787)

"""Local demo of integrations/openapi.yaml (stdlib only). Port 8788.

Built here:     POST /v1/brand/funnel, /v1/ecom/rerank, /v1/ecom/readiness, GET /v1/health, GET /v1/openapi.yaml
Proxied:        POST /v1/shelf/simulate -> sim/server.py :8787 /api/run
                POST /v1/retailer/layout -> /api/optimise per product (eye, facings)
                POST /v1/brand/pack-test -> /api/optimise (claim, price)
Designed only:  POST /v1/shopper/swaps -> 501 with a pointer (never a fake answer)

Auth: if SHELF_API_TOKEN is set, requests need `Authorization: Bearer <token>`.

  python3 integrations/api_server.py
  curl -s localhost:8788/v1/brand/funnel -d '{"product":"5000168036755"}'
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "ecom-rerank"))
from common import brand_funnel, catalog_by_code, human_runs, load_personas, RUNS_DIR  # noqa: E402

SIM = os.environ.get("SIM_SERVER", "http://localhost:8787")
TOKEN = os.environ.get("SHELF_API_TOKEN")


def _sim(path: str, body: dict) -> dict:
    req = urllib.request.Request(SIM + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())


def _listing(items) -> list[dict]:
    cat = catalog_by_code()
    out = []
    for x in items or []:
        if isinstance(x, str):
            if x not in cat:
                raise KeyError(f"unknown barcode {x}")
            out.append(cat[x])
        else:
            out.append(x)
    return out


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj, ctype="application/json"):
        b = obj.encode() if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self._send(204, "")

    def _auth(self) -> bool:
        if not TOKEN:
            return True
        if self.headers.get("Authorization", "") == f"Bearer {TOKEN}":
            return True
        self._send(401, {"error": "missing or wrong bearer token", "status": "unauthorized"})
        return False

    def do_GET(self):
        p = self.path.split("?")[0].rstrip("/")
        if p == "/v1/health":
            return self._send(200, {"ok": True, "sim": SIM})
        if p == "/v1/openapi.yaml":
            with open(os.path.join(HERE, "openapi.yaml")) as f:
                return self._send(200, f.read(), "application/yaml")
        if p.startswith("/v1/brand/funnel/"):  # GET convenience for the widget
            if not self._auth():
                return
            return self._send(200, brand_funnel(os.path.basename(p)))
        self._send(404, {"error": "not found", "status": "not_found"})

    def do_POST(self):
        if not self._auth():
            return
        p = self.path.split("?")[0].rstrip("/")
        try:
            n = int(self.headers.get("Content-Length") or 0)
            b = json.loads(self.rfile.read(n) or b"{}")
            if p == "/v1/brand/funnel":
                code = b["product"]
                if code not in catalog_by_code():
                    return self._send(404, {"error": f"unknown product {code}", "status": "not_found"})
                files = human_runs(bool(b.get("include_mock")))
                if b.get("run_ids"):
                    files = [os.path.join(RUNS_DIR, r + ".json") for r in b["run_ids"]]
                return self._send(200, brand_funnel(code, files))
            if p in ("/v1/ecom/rerank", "/v1/ecom/readiness"):
                import rerank as rr
                listing = _listing(b.get("listing"))
                out = {"agent_readiness": {"products": [rr.agent_readiness(x) for x in listing]}}
                if p == "/v1/ecom/rerank":
                    personas = load_personas()
                    arch = b.get("archetype")
                    if arch and arch not in personas:
                        return self._send(400, {"error": f"unknown archetype {arch}", "status": "bad_request",
                                                "see": "components.schemas.Archetype in openapi.yaml"})
                    if b.get("session_signals"):
                        inf = rr.infer_archetype(b["session_signals"], personas, int(b.get("seed", 0)))
                        out["archetype_inference"] = inf
                        arch = None if inf["archetype"] == rr.UNCLEAR else inf["archetype"]
                    out["rerank"] = rr.rerank(listing, arch, personas, int(b.get("seed", 0)))
                return self._send(200, out)
            if b.get("engine", "jev") not in ("jev", "mock"):
                # rule: TypeSafe Jev only. Never forward engine=llm (OpenRouter) from the public API.
                return self._send(400, {"error": "engine must be 'jev' or 'mock'", "status": "bad_request"})
            if p == "/v1/shelf/simulate":
                return self._send(200, _sim("/api/run", {k: b[k] for k in ("planogram", "agents", "seed", "engine") if k in b}))
            if p == "/v1/retailer/layout":
                res = [_sim("/api/optimise", {"product": c, "edits": b.get("edits", ["eye", "facings"]),
                                              "agents": b.get("agents", 30), "seeds": b.get("seeds", [1]),
                                              "planogram": b.get("planogram")}) for c in b.get("products", [])]
                return self._send(200, {"results": res,
                                        "status": "partial: per-product edits via sim/optimise.py; whole-store annealing designed"})
            if p == "/v1/brand/pack-test":
                edits = b.get("edits") or []
                kinds = [e.get("kind") for e in edits]
                price = next((e.get("value") for e in edits if e.get("kind") == "price"), None)
                if "pack_copy" in kinds:
                    return self._send(501, {"error": "free-text pack_copy rewrite not built; use kind=claim (true OFF-backed claim) or price",
                                            "status": "designed_not_built", "see": "sim/optimise.py"})
                opt_edits = [k for k in kinds if k in ("claim", "eye", "facings")] + (["price"] if price else [])
                return self._send(200, _sim("/api/optimise", {"product": b["product"], "edits": opt_edits, "price": price,
                                                              "agents": b.get("agents", 30), "seeds": b.get("seeds", [1]),
                                                              "engine": b.get("engine", "jev")}))
            if p == "/v1/shopper/swaps":
                # served by sim/swaps.py (code finds + measures candidates, Jev judges accept/benefit/triggers/price)
                sys.path.insert(0, os.path.join(os.path.dirname(HERE), "sim"))
                import swaps as sw  # noqa: E402
                import rerank as rr  # noqa: E402
                personas = load_personas()
                arch, inf = b.get("archetype"), None
                if not arch and b.get("session_signals"):
                    inf = rr.infer_archetype(b["session_signals"], personas, int(b.get("seed", 0)))
                    arch = None if inf["archetype"] == rr.UNCLEAR else inf["archetype"]
                if not arch or arch not in personas:
                    return self._send(400, {"error": "need a known archetype (or session_signals that resolve to one)",
                                            "archetype_inference": inf, "status": "bad_request"})
                res = sw.run_swaps(arch, list(b["basket"]), top=int(b.get("top", 3)), out_name="api")
                res.pop("_path", None)
                res["archetype_inference"] = inf
                res["goal_note"] = ("'goal' is not a filter yet: candidates must raise the persona's lens grade AND improve "
                                    "at least one OFF health field (fibre, sugar, protein, salt, additives, NOVA, ...)")
                return self._send(200, res)
            self._send(404, {"error": "not found", "status": "not_found"})
        except KeyError as e:
            self._send(400, {"error": f"bad request: {e}", "status": "bad_request"})
        except urllib.error.URLError as e:
            self._send(502, {"error": f"sim server at {SIM} failed: {e}. Start or update it: python3 sim/server.py"})
        except Exception as e:
            self._send(500, {"error": repr(e)[:500]})


def main(port: int = 8788):
    print(f"shelf insight API on http://localhost:{port}  (sim proxy -> {SIM})")
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8788)

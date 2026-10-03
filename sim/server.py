"""Tiny API for the frontend (stdlib http.server) on :8787.

POST /api/run       {"planogram": <dict or path>, "agents": 10, "models": ["google/gemini-2.5-flash"], "seed": 1, "mock": false}
POST /api/agent_run {"models": [...], "runs": 3, "seed": 1, "mock": false}
POST /api/optimise  {"product": "<code>", "agents": 30, "seeds": [1], "edits": ["eye","facings","claim"], "mock": false}
GET  /api/runs            list of runs (id, created, models, n_agents, cost)
GET  /api/runs/<run_id>   full run json
GET  /api/coefficients    notice-model coefficients with sources
GET  /api/health
"""
from __future__ import annotations

import glob
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import notice  # noqa: E402
import run as simrun  # noqa: E402

MAX_AGENTS = 200  # guard against an accidental huge spend from the UI
_run_lock = threading.Lock()


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
        if path == "/api/runs":
            out = []
            for fp in sorted(glob.glob(os.path.join(simrun.RUNS_DIR, "*.json")), reverse=True):
                try:
                    r = json.load(open(fp))
                    out.append({"run_id": r["run_id"], "created": r.get("created"), "models": r.get("models"),
                                "arm": r.get("arm", "shopper"), "n_agents": len(r.get("agents", [])),
                                "cost": r.get("cost"), "label": r.get("label", ""), "mock": r.get("mock", False)})
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
            with _run_lock:
                if path == "/api/run":
                    run = simrun.run_simulation(planogram=b.get("planogram"),
                                                agents=min(int(b.get("agents", 10)), MAX_AGENTS),
                                                models=b.get("models"), seed=int(b.get("seed", 1)),
                                                mock=bool(b.get("mock", False)),
                                                max_tokens=min(int(b.get("max_tokens", 250)), 300),
                                                label=b.get("label", "ui"))
                    return self._send(200, run)
                if path == "/api/agent_run":
                    import agent_shopper
                    run = agent_shopper.run_agents(b.get("models") or [simrun.DEFAULT_MODEL],
                                                   min(int(b.get("runs", 3)), 20), int(b.get("seed", 1)),
                                                   bool(b.get("mock", False)))
                    return self._send(200, run)
                if path == "/api/optimise":
                    import optimise
                    out = optimise.optimise(b["product"], min(int(b.get("agents", 30)), MAX_AGENTS),
                                            b.get("seeds", [1]), b.get("models"), bool(b.get("mock", False)),
                                            b.get("edits", ["eye", "facings", "claim"]), b.get("price"),
                                            b.get("planogram"))
                    return self._send(200, out)
            self._send(404, {"error": "not found"})
        except Exception as e:
            self._send(500, {"error": repr(e)[:500]})


def main(port=8787):
    srv = ThreadingHTTPServer(("0.0.0.0", port), H)
    print(f"sim server on http://localhost:{port}")
    srv.serve_forever()


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8787)

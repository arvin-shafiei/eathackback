"""OpenRouter chat completions: JSON mode, disk cache, retries, cost log, spend guard."""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE_DIR = os.path.join(ROOT, "data", "sim", "cache")
COST_LOG = os.path.join(ROOT, "data", "sim", "cost_log.jsonl")
URL = "https://openrouter.ai/api/v1/chat/completions"
KEY_URL = "https://openrouter.ai/api/v1/key"
MIN_REMAINING_USD = 5.0  # CONTRACT: $50 cap total; stop well before it

_lock = threading.Lock()
_guard = {"checked_at": 0.0, "remaining": None}
_session_cost = {"usd": 0.0, "calls": 0, "cached": 0}


class SpendGuardTripped(RuntimeError):
    pass


def api_key() -> str:
    """The project key in .env wins over any OPENROUTER_API_KEY in the shell environment, so spend lands
    on the capped hackathon key ($50 limit) that the spend guard watches."""
    env = os.path.join(ROOT, ".env")
    if os.path.exists(env):
        for line in open(env):
            line = line.strip()
            if line.startswith("OPENROUTER_API_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    k = os.environ.get("OPENROUTER_API_KEY")
    if k:
        return k
    raise RuntimeError("OPENROUTER_API_KEY not set (.env)")


def limit_remaining(force: bool = False) -> float | None:
    with _lock:
        if not force and time.time() - _guard["checked_at"] < 20 and _guard["remaining"] is not None:
            return _guard["remaining"]
    try:
        r = requests.get(KEY_URL, headers={"Authorization": f"Bearer {api_key()}"}, timeout=15)
        d = r.json().get("data", {})
        rem = d.get("limit_remaining")
        if rem is None and d.get("limit") is not None:
            rem = float(d["limit"]) - float(d.get("usage", 0))
    except Exception:
        rem = _guard["remaining"]
    with _lock:
        _guard["checked_at"] = time.time()
        _guard["remaining"] = rem
    return rem


def check_guard():
    rem = limit_remaining()
    if rem is None:
        raise SpendGuardTripped("could not read limit_remaining for the key (no cap set or endpoint down); refusing to spend")
    if rem < MIN_REMAINING_USD:
        raise SpendGuardTripped(f"OpenRouter limit_remaining ${rem:.2f} < ${MIN_REMAINING_USD}")


def _cache_key(model: str, messages: list, max_tokens: int, temperature: float) -> str:
    blob = json.dumps({"model": model, "messages": messages, "max_tokens": max_tokens,
                       "temperature": temperature}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def parse_json(text: str) -> dict:
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            return json.loads(m.group(0))
        raise


def chat_json(model: str, system: str, user: str, *, max_tokens: int = 250,
              temperature: float = 0.7, retries: int = 3, tag: str = "") -> dict:
    """Returns {"data": parsed_json, "cost": usd, "cached": bool, "usage": {...}}."""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    key = _cache_key(model, messages, max_tokens, temperature)
    os.makedirs(CACHE_DIR, exist_ok=True)
    cp = os.path.join(CACHE_DIR, key + ".json")
    if os.path.exists(cp):
        with open(cp) as f:
            c = json.load(f)
        with _lock:
            _session_cost["cached"] += 1
        return {"data": c["data"], "cost": 0.0, "cached": True, "usage": c.get("usage", {})}

    check_guard()
    body = {"model": model, "messages": messages, "max_tokens": max_tokens,
            "temperature": temperature, "response_format": {"type": "json_object"},
            "usage": {"include": True}, "reasoning": {"enabled": False}}
    headers = {"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json",
               "HTTP-Referer": "https://github.com/eathack", "X-Title": "eathack shelf sim"}
    last_err = None
    for attempt in range(retries + 1):
        try:
            r = requests.post(URL, headers=headers, json=body, timeout=90)
            if r.status_code in (429, 500, 502, 503, 504):
                last_err = f"HTTP {r.status_code}: {r.text[:200]}"
                time.sleep(1.5 * (2 ** attempt))
                continue
            if r.status_code == 400 and "reasoning" in body:
                # some models reject the reasoning param; retry without it
                body.pop("reasoning", None)
                last_err = r.text[:200]
                continue
            r.raise_for_status()
            j = r.json()
            if "error" in j:
                last_err = str(j["error"])[:300]
                time.sleep(1.5 * (2 ** attempt))
                continue
            text = j["choices"][0]["message"].get("content") or ""
            usage = j.get("usage", {}) or {}
            cost = float(usage.get("cost") or 0.0)
            with _lock:
                _session_cost["usd"] += cost
                _session_cost["calls"] += 1
                os.makedirs(os.path.dirname(COST_LOG), exist_ok=True)
                with open(COST_LOG, "a") as f:
                    f.write(json.dumps({"ts": time.time(), "model": model, "tag": tag, "cost": cost,
                                        "prompt_tokens": usage.get("prompt_tokens"),
                                        "completion_tokens": usage.get("completion_tokens")}) + "\n")
            try:
                data = parse_json(text)
            except Exception:
                last_err = f"bad JSON: {text[:200]}"
                body["temperature"] = 0.2
                continue
            with open(cp, "w") as f:
                json.dump({"model": model, "messages": messages, "data": data, "usage": usage,
                           "raw": text}, f)
            return {"data": data, "cost": cost, "cached": False, "usage": usage}
        except SpendGuardTripped:
            raise
        except Exception as e:  # network etc.
            last_err = repr(e)
            time.sleep(1.5 * (2 ** attempt))
    raise RuntimeError(f"LLM call failed after retries ({model}): {last_err}")


def session_cost() -> dict:
    with _lock:
        return dict(_session_cost)


if __name__ == "__main__":
    print("limit_remaining:", limit_remaining(force=True))

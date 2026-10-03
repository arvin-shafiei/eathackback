"""TypeSafe Jev (System One) decision engine for the shelf sim.

Code stays in control; Jev answers narrow, typed judgments. All arithmetic (price ratios, traffic lights,
additive counts, NOVA) is done here and handed to Jev as words (docs: model-jaggedness/jev-1.13 #2 "Math and
Numbers", #5 "Large state", #8 "Choice option order").

One request per (agent, slot) carries every question for every noticed product (speculative fan-out,
docs: patterns/fan-out). Code then samples the decision from the calibrated Choice distribution with a
common-random-number draw and composes the per-product outcome from appeal Scores and trigger Nouls.

Docs: https://docs.typesafe.ai/api.md  /patterns/fan-out.md  /patterns/composite-scoring.md  /confidence.md
      /model-jaggedness/jev-1.13.md  /sdk/python/usage.md
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE_DIR = os.path.join(ROOT, "data", "sim", "cache", "jev")
COST_LOG = os.path.join(ROOT, "data", "sim", "cost_log.jsonl")

MODEL = "jev-latest"
USD_PER_M_INPUT = 0.042  # output tokens are free (TypeSafe pricing, Oct 2026)
PRICE_SOURCE = "TypeSafe pricing: $0.042 per 1M input tokens, output free (provided by the project owner, 2026-10-03)"
MAX_OPTIONS = 255  # docs api.md: max 255 options per Choice
# rate limits: 80 req/s, 100k tok/s. Stay under both with a token bucket.
REQ_PER_S = 70.0
TOK_PER_S = 90_000.0
DEFAULT_MAX_USD = 5.0  # session spend guard; Jev is cheap, this is a runaway stop, not a budget

_lock = threading.Lock()
_session = {"usd": 0.0, "calls": 0, "cached": 0, "input_tokens": 0, "output_tokens": 0, "max_usd": DEFAULT_MAX_USD}
_client = None


class JevSpendGuard(RuntimeError):
    pass


# ---------------------------------------------------------------- plumbing
def api_key() -> str:
    """.env first (like llm.py), then the shell environment."""
    env = os.path.join(ROOT, ".env")
    if os.path.exists(env):
        for line in open(env):
            line = line.strip()
            if line.startswith("TYPESAFE_API_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    k = os.environ.get("TYPESAFE_API_KEY")
    if k:
        return k
    raise RuntimeError("TYPESAFE_API_KEY not set (.env)")


def client():
    global _client
    with _lock:
        if _client is None:
            from typesafe_sdk import RetryPolicy, TypeSafeClient
            # SDK retries 429/5xx with backoff and honours Retry-After by default; we widen max_retries.
            _client = TypeSafeClient(api_key=api_key(), model=MODEL,
                                     retry=RetryPolicy(max_retries=6, backoff_max=10.0, timeout=60.0))
        return _client


class _Bucket:
    """Token bucket for both req/s and tok/s, shared by all threads."""

    def __init__(self):
        self.t = time.monotonic()
        self.req = REQ_PER_S
        self.tok = TOK_PER_S
        self.lk = threading.Lock()

    def take(self, tokens: int):
        tokens = min(tokens, TOK_PER_S)
        while True:
            with self.lk:
                now = time.monotonic()
                dt = now - self.t
                self.t = now
                self.req = min(REQ_PER_S, self.req + dt * REQ_PER_S)
                self.tok = min(TOK_PER_S, self.tok + dt * TOK_PER_S)
                if self.req >= 1 and self.tok >= tokens:
                    self.req -= 1
                    self.tok -= tokens
                    return
                wait = max((1 - self.req) / REQ_PER_S, (tokens - self.tok) / TOK_PER_S, 0.005)
            time.sleep(wait)


_bucket = _Bucket()


def set_max_usd(v: float):
    with _lock:
        _session["max_usd"] = float(v)


def session_cost() -> dict:
    with _lock:
        return dict(_session)


def cost_of(input_tokens: int) -> float:
    return (input_tokens or 0) * USD_PER_M_INPUT / 1e6


def ask(state, questions: dict, *, tag: str = "") -> dict:
    """One System One request. Returns the raw API JSON ({model, answers, usage}) plus
    {"cached", "cost", "cache_key"}. Disk-cached on sha256(model, state, questions)."""
    blob = json.dumps({"model": MODEL, "state": state, "questions": questions}, sort_keys=True, ensure_ascii=False)
    key = hashlib.sha256(blob.encode()).hexdigest()
    os.makedirs(CACHE_DIR, exist_ok=True)
    cp = os.path.join(CACHE_DIR, key + ".json")
    if os.path.exists(cp):
        try:
            with open(cp) as f:
                c = json.load(f)
            with _lock:
                _session["cached"] += 1
            return {**c["response"], "cached": True, "cost": 0.0, "cache_key": key}
        except Exception:
            pass
    with _lock:
        if _session["usd"] >= _session["max_usd"]:
            raise JevSpendGuard(f"jev session spend ${_session['usd']:.4f} >= cap ${_session['max_usd']}")
    _bucket.take(int(len(blob) / 3.2))
    res = client().system_one(state, questions)
    j = res.raw_http_response.json()
    usage = j.get("usage") or {}
    itok, otok = int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
    cost = cost_of(itok)
    with _lock:
        _session["usd"] += cost
        _session["calls"] += 1
        _session["input_tokens"] += itok
        _session["output_tokens"] += otok
        os.makedirs(os.path.dirname(COST_LOG), exist_ok=True)
        with open(COST_LOG, "a") as f:
            f.write(json.dumps({"ts": time.time(), "model": "jev", "jev_model": j.get("model"), "tag": tag,
                                "cost": round(cost, 8), "prompt_tokens": itok, "completion_tokens": otok,
                                "n_questions": len(questions)}) + "\n")
    tmp = cp + f".{os.getpid()}.{threading.get_ident()}.tmp"
    with open(tmp, "w") as f:
        json.dump({"request": {"model": MODEL, "state": state, "questions": questions}, "response": j}, f,
                  ensure_ascii=False)
    os.replace(tmp, cp)
    return {**j, "cached": False, "cost": cost, "cache_key": key}


# ---------------------------------------------------------------- words, not numbers (code does the maths)
TL_FOOD = {"sugars_100g": (5, 22.5), "fat_100g": (3, 17.5), "saturated_fat_100g": (1.5, 5), "salt_100g": (0.3, 1.5)}
TL_DRINK = {"sugars_100g": (2.5, 11.25), "fat_100g": (1.5, 8.75), "saturated_fat_100g": (0.75, 2.5), "salt_100g": (0.3, 0.75)}
TL_SOURCE = ("UK FoP traffic lights per 100g/100ml, DHSC/FSA 'Guide to creating a front of pack nutrition label' (2016): "
             "https://www.gov.uk/government/publications/front-of-pack-nutrition-labelling-guidance")
LIQUID_CATS = ("soft_drinks", "plant_milk_dairy_alt", "hot_drinks")
TL_NAMES = {"sugars_100g": "sugar", "fat_100g": "fat", "saturated_fat_100g": "saturated fat", "salt_100g": "salt"}
NOVA_WORDS = {1: "unprocessed or minimally processed (NOVA 1)", 2: "processed culinary ingredient (NOVA 2)",
              3: "processed food (NOVA 3)", 4: "ultra-processed (NOVA 4)"}
ROLE_WORDS = {"challenger": "small challenger brand (newer, less familiar)",
              "incumbent": "big familiar brand", "own_label": "supermarket own-label"}


def _num(p, *keys):
    for k in keys:
        v = p.get(k)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def traffic_lights(p: dict) -> list[str]:
    th = TL_DRINK if p.get("category") in LIQUID_CATS else TL_FOOD
    out = []
    for k, (lo, hi) in th.items():
        v = _num(p, k, k.replace("_fat", "-fat"))
        if v is None:
            continue
        col = "green (low)" if v <= lo else "red (high)" if v > hi else "amber (medium)"
        out.append(f"{TL_NAMES[k]}: {col}")
    return out


def price_words(price: float | None, set_prices: list[float]) -> str:
    if not price:
        return "price not shown"
    lo = min(x for x in set_prices if x) if any(set_prices) else price
    r = price / lo if lo else 1.0
    if len([x for x in set_prices if x]) < 2:
        rel = "the only price you are looking at"
    elif r <= 1.04:
        rel = "the cheapest in this set"
    elif r <= 1.3:
        rel = "a little dearer than the cheapest here"
    elif r <= 1.75:
        rel = "about 1.5x the cheapest here"
    elif r <= 2.5:
        rel = "about 2x the cheapest here"
    else:
        rel = f"about {round(r)}x the cheapest here"
    return f"£{price:.2f}, {rel}"


def unit_price(p: dict):
    for k, unit in (("price_per_kg_gbp", "kg"), ("unit_price_gbp_per_kg", "kg"), ("price_per_litre_gbp", "l"),
                    ("unit_price_gbp_per_l", "l")):
        v = _num(p, k)
        if v:
            return v, unit
    v = _num(p, "price_per_100g", "unit_price_per_100g")
    return (v * 10, "kg") if v else (None, None)


def unit_price_words(p: dict, set_items: list[dict]) -> str | None:
    v, u = unit_price(p)
    if not v:
        return None
    others = [unit_price(q)[0] for q in set_items if unit_price(q)[1] == u and unit_price(q)[0]]
    if len(others) < 2:
        return None
    lo = min(others)
    r = v / lo
    return ("lowest price per " + ("kilo" if u == "kg" else "litre") + " in this set" if r <= 1.04 else
            "a bit more per " + ("kilo" if u == "kg" else "litre") + " than the best value here" if r <= 1.4 else
            "noticeably more per " + ("kilo" if u == "kg" else "litre") + " than the best value here" if r <= 2.2 else
            "much more per " + ("kilo" if u == "kg" else "litre") + " than the best value here")


def additives_words(n) -> str | None:
    if n is None:
        return None
    n = int(n)
    return "no additives" if n == 0 else "one or two additives" if n <= 2 else "several additives (3-5)" if n <= 5 else "a long list of additives (6+)"


def protein_words(p: dict) -> str | None:
    g = _num(p, "proteins_100g")
    if g is None:
        return None
    kcal = _num(p, "energy_kcal_100g", "energy-kcal_100g")
    share = (4 * g / kcal) if kcal else None
    if share is not None and share >= 0.20:
        b = "high protein (qualifies for a 'high protein' claim)"
    elif share is not None and share >= 0.12:
        b = "source of protein"
    else:
        b = "not a protein food"
    return f"{b}; about {'20g+' if g >= 20 else '10-20g' if g >= 10 else '5-10g' if g >= 5 else 'under 5g'} protein per 100g"


def fibre_words(p: dict) -> str | None:
    f = _num(p, "fiber_100g")
    if f is None:
        return None
    return "high fibre" if f >= 6 else "source of fibre" if f >= 3 else "low fibre"


def label_words(p: dict) -> list[str]:
    out = []
    for l in p.get("labels") or []:
        l = str(l).replace("en:", "").replace("-", " ")
        if l and l not in out:
            out.append(l)
    return out[:6]


def product_state(p: dict, set_items: list[dict], reads_labels: bool, budget_left: float | None) -> dict:
    """The card the shopper sees. Front of pack always; back of pack only if they read labels."""
    prices = [float(q.get("price_gbp") or 0) for q in set_items]
    d = {"name": p.get("name", ""), "brand": p.get("brand", ""),
         "brand_type": ROLE_WORDS.get(p.get("role", ""), p.get("role", "")),
         "price": price_words(p.get("price_gbp"), prices),
         "pack_copy": (p.get("pack_copy") or "")[:220]}
    if p.get("quantity"):
        d["pack_size"] = str(p["quantity"])
    up = unit_price_words(p, set_items)
    if up:
        d["value"] = up
    if budget_left is not None and p.get("price_gbp"):
        pr = float(p["price_gbp"])
        d["budget"] = ("more than the budget left" if pr > budget_left else
                       "would use most of the budget left" if pr > 0.5 * budget_left else
                       "fits easily in the budget left")
    badges = label_words(p)
    if badges:
        d["on_pack_badges"] = badges
    if reads_labels:
        back = {}
        tl = traffic_lights(p)
        if tl:
            back["traffic_lights"] = tl
        for k, f in (("protein", protein_words), ("fibre", fibre_words)):
            w = f(p)
            if w:
                back[k] = w
        aw = additives_words(p.get("additives_n"))
        if aw:
            back["additives"] = aw
        if p.get("sweeteners"):
            sw = [str(s).replace("en:", "") for s in (p.get("sweeteners_list") or [])][:3]
            back["sweeteners"] = "contains sweeteners" + (f" ({', '.join(sw)})" if sw else "")
        if isinstance(p.get("palm_oil_n"), (int, float)):
            back["palm_oil"] = "contains palm oil" if p["palm_oil_n"] > 0 else "no palm oil listed"
        if p.get("nova") in NOVA_WORDS:
            back["processing"] = NOVA_WORDS[p["nova"]]
        al = [str(a).replace("en:", "") for a in (p.get("allergens") or [])]
        back["allergens"] = ", ".join(al) if al else "none declared"
        tr = p.get("traces")
        if tr:
            tr = tr if isinstance(tr, list) else str(tr).split(",")
            back["may_contain"] = ", ".join(str(t).replace("en:", "").strip() for t in tr)[:80]
        ing = (p.get("ingredients_text") or "").strip()
        if ing:
            back["ingredients_start"] = ing[:180]
        d["back_of_pack"] = back
    return d


# ---------------------------------------------------------------- shopper state
OCEAN_PHRASES = {
    "O": ("high openness: curious, happy to try an unfamiliar brand", "low openness: sticks with what they know, wary of new things"),
    "C": ("high conscientiousness: sticks to the list and budget, reads labels, plans", "low conscientiousness: shops on impulse, rarely checks the back of pack"),
    "E": ("high extraversion: drawn to bright packs, buzz and impulse treats", "low extraversion: unmoved by hype and loud packaging"),
    "A": ("high agreeableness: tends to trust brand claims", "low agreeableness: cynical about marketing, quick to call out a gimmick"),
    "N": ("high neuroticism: anxious about wasting money, sticks to safe choices", "low neuroticism: relaxed about a bad buy"),
}
MISSION_WORDS = {
    "weekly_shop": "the weekly shop: restocking the usual things, not here to experiment",
    "meal_deal": "a lunchtime meal deal on a short break: main + snack + drink, fast",
    "top_up": "a quick top-up shop for a few things that ran out",
    "treat": "picking up a treat for themselves",
    "gym": "after the gym, looking for something that fits their protein goals",
}
DIRECTION_WORDS = {"lower_better": "wants less / lower", "higher_better": "wants more / higher"}


def _first_sentences(text: str, n=3, cap=480) -> str:
    s = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return " ".join(s[:n])[:cap]


def _txt(x, *keys) -> str:
    if isinstance(x, dict):
        for k in keys:
            if x.get(k):
                return str(x[k])
        return json.dumps(x)[:200]
    return str(x)


def top_triggers(persona: dict, n=3) -> list[dict]:
    return [t if isinstance(t, dict) else {"trigger": str(t)} for t in (persona.get("rejection_triggers") or [])[:n]]


def top_trust(persona: dict, n=2) -> list[dict]:
    return [t if isinstance(t, dict) else {"signal": str(t)} for t in (persona.get("trust_signals") or [])[:n]]


def shopper_state(persona: dict, ocean: dict, *, mission: str, budget_left: float | None, category: str,
                  on_mission: bool, basket: list[str]) -> dict:
    budget = persona.get("budget_gbp")
    if budget_left is None or not budget:
        bw = "no fixed budget today"
    else:
        f = budget_left / float(budget)
        bw = (f"plenty of budget left (about £{budget_left:.0f} of £{float(budget):.0f})" if f > 0.5 else
              f"budget getting tight (about £{budget_left:.0f} of £{float(budget):.0f} left)" if f > 0.2 else
              f"almost out of budget (about £{budget_left:.2f} left)")
    traits = []
    for t in "OCEAN":
        v = float(ocean.get(t, 0.5))
        if v >= 0.65:
            traits.append(OCEAN_PHRASES[t][0])
        elif v <= 0.35:
            traits.append(OCEAN_PHRASES[t][1])
    lens = sorted(persona.get("lens") or [], key=lambda l: -float(l.get("weight") or 0))[:3]
    prios = []
    for l in lens:
        d = str(l.get("direction", ""))
        prios.append(f"{str(l.get('attribute','')).replace('_', ' ')}: {DIRECTION_WORDS.get(d, d.replace('_', ' '))}"
                     + (f" ({str(l.get('why'))[:90]})" if l.get("why") else ""))
    secs = (persona.get("sim_parameters") or {}).get("seconds_at_shelf", 6)
    return {
        "who": _first_sentences(persona.get("dossier", "")),
        "mission": MISSION_WORDS.get(mission, mission.replace("_", " ")),
        "this_shelf": f"{category.replace('_', ' ')} shelf; " + (
            "it is on today's list" if on_mission else "NOT on today's list, just passing through"),
        "time_at_shelf": "a glance of a couple of seconds" if float(secs) <= 3 else
                         "a few seconds" if float(secs) <= 8 else "takes their time",
        "budget": bw,
        "basket_so_far": ", ".join(basket[-6:]) if basket else "empty",
        "personality": traits or ["average on every Big Five trait"],
        "priorities": prios,
        "put_offs": [_txt(t, "trigger")[:220] for t in top_triggers(persona)],
        "trusts": [_txt(t, "signal", "trust")[:200] for t in top_trust(persona)],
        "habits": [_txt(h, "habit")[:160] for h in (persona.get("habits") or [])[:2]],
    }


# ---------------------------------------------------------------- questions (speculative fan-out)
APPEAL_LEVELS = [
    "would actively avoid it: puts them off",
    "dislikes it: would not choose it",
    "indifferent: no real pull either way",
    "mildly drawn: might pick it up",
    "really wants it: exactly what they would grab",
]
APPEAL_SHORT = ["would actively avoid", "dislikes", "indifferent", "mildly drawn", "really wants it"]
MECHANISMS = {
    "habit": "habit: it is (or isn't) what they always buy",
    "loss_aversion": "betrayal / loss aversion: a familiar product changed, shrank or got worse value",
    "price_anchor": "price: compares the price against what they expect or the cheaper options",
    "trust": "trust: a brand, badge or certification they trust (or distrust)",
    "gimmick_reactance": "gimmick reactance: pushes back against a claim that feels like marketing spin",
    "social_proof": "social proof: buzz, popularity, what others are buying or posting",
    "health_goal": "health goal: nutrition, ingredients or processing against their health aims",
    "mission_fit": "mission fit: whether it fits what they came in for today",
    "novelty": "novelty: curiosity about something new or unusual",
    "effort": "effort: too much hassle to read, compare or think about",
    "indifference": "indifference: it barely registers and no reason stands out",
}


def build_questions(cards: list[dict], n_trig: int, n_trust: int, rng: random.Random,
                    with_pickup: bool = True) -> tuple[dict, dict]:
    """Returns (questions, meta). meta records shuffled option orders (jaggedness #8). The rng is consumed
    identically with or without pick-up questions, so a follow-up request keeps the same option orders."""
    n = len(cards)
    opts = [f"p{i}" for i in range(n)] + ["none"]
    rng.shuffle(opts)
    crit = {}
    for o in opts:
        if o == "none":
            crit[o] = "walks past without taking anything from this shelf"
        else:
            i = int(o[1:])
            crit[o] = f"takes `products[{i}]` ({cards[i]['name']}) and puts it in the basket"
    q = {"decision": {
        "type": "choice",
        "instructions": ("In the few seconds `shopper` spends at this shelf, what do they most likely do? Most real "
                         "shoppers walk past most products; they only take something that fits `shopper.mission` "
                         "and that they actually want, at `shopper.budget`."),
        "criteria": crit}}
    mech_orders = {}
    for i, c in enumerate(cards):
        nm = c["name"]
        if with_pickup:
            q[f"pickup_{i}"] = {"type": "noul",
                                "instructions": f"Does `shopper` pick up `products[{i}]` ({nm}) to look at it more closely?",
                                "criteria": {"true": "they take it off the shelf to look at it (to read it, check it or consider it)",
                                             "false": "they only glance at it on the shelf, or ignore it"}}
        q[f"appeal_{i}"] = {"type": "score",
                            "instructions": f"How does `shopper` feel about `products[{i}]` ({nm}) on today's trip?",
                            "criteria": APPEAL_LEVELS}
        for k in range(n_trig):
            q[f"trig_{i}_{k}"] = {"type": "noul",
                                  "instructions": f"Does `products[{i}]` ({nm}) show what `shopper.put_offs[{k}]` describes?",
                                  "criteria": {"true": "the card clearly shows it",
                                               "false": "the card does not show it, or does not show enough to tell"}}
        for k in range(n_trust):
            q[f"trust_{i}_{k}"] = {"type": "noul",
                                   "instructions": f"Does `products[{i}]` ({nm}) show what `shopper.trusts[{k}]` describes?",
                                   "criteria": {"true": "the card clearly shows it",
                                                "false": "the card does not show it, or does not show enough to tell"}}
        mo = list(MECHANISMS)
        rng.shuffle(mo)
        mech_orders[i] = mo
        q[f"mechanism_{i}"] = {"type": "choice",
                               "instructions": f"Which best explains how `shopper` reacts to `products[{i}]` ({nm})?",
                               "criteria": {m: MECHANISMS[m] for m in mo}}
    return q, {"decision_option_order": opts, "mechanism_option_order": mech_orders}


# ---------------------------------------------------------------- verbatims for the WHY
_URL = re.compile(r"https?://[^\s;,)\]]+")
_QUOTE = re.compile(r"['‘“\"]([^'’”\"]{12,240})['’”\"]")
_STOP = set("the a an and or of to in on for with is it its that this be as at by from not no but if are was they their "
            "them you your i my me e g eg than then so".split())


def _words(s):
    return {w for w in re.findall(r"[a-z]{3,}", (s or "").lower()) if w not in _STOP}


def verbatim_for(item: dict, persona: dict) -> dict | None:
    """A persona verbatim backing a trigger / trust signal: the quote+URL in its own source if it has one,
    else the persona verbatim with the most word overlap. Method is recorded."""
    src = str(item.get("source") or "")
    urls = _URL.findall(src)
    for v in persona.get("verbatims") or []:  # the trigger cites a thread the persona already quotes
        if v.get("url") and any(v["url"].rstrip("/") in u or u.rstrip("/") in v["url"] for u in urls):
            return {"quote": v.get("quote", "")[:240], "url": v["url"], "method": "persona verbatim from the trigger's cited thread"}
    for qm in _QUOTE.finditer(src):
        if len(qm.group(1).split()) >= 5 and urls:
            return {"quote": qm.group(1).strip(), "url": urls[0], "method": "quoted in the trigger's own source"}
    tw = _words(_txt(item, "trigger", "signal"))
    best, bs = None, 0
    for v in persona.get("verbatims") or []:
        s = len(tw & _words(v.get("quote", "")))
        if s > bs:
            best, bs = v, s
    if best and bs >= 2:
        return {"quote": best.get("quote", "")[:240], "url": best.get("url", ""),
                "method": f"persona verbatim with most word overlap ({bs} shared words)"}
    if urls:
        return {"quote": "", "url": urls[0], "method": "URL from the trigger's own source"}
    return None


# ---------------------------------------------------------------- one slot decision
MECH_ATTRS = {"price_anchor": ["price_gbp"], "habit": ["brand"], "loss_aversion": ["brand", "quantity", "price_gbp"],
              "trust": ["brand", "labels"], "gimmick_reactance": ["pack_copy"], "social_proof": ["brand", "pack_copy"],
              "health_goal": ["sugars_100g", "salt_100g", "additives_n", "nova", "ingredients_text"],
              "mission_fit": ["category", "pack_copy"], "novelty": ["brand", "pack_copy"], "effort": [], "indifference": []}
APPEAL_REJECT_P = 0.5  # P(appeal <= "dislikes") > 0.5 -> reject (more likely than not they dislike or avoid it)
NOUL_FIRES = 0.5          # Noul > 0.5 = more likely yes than no (docs: primitives/noul, confidence.md)


STAGE_TO_DECISION = {"taken": "pick", "put_back": "reject", "looked": "walk_past", "not_noticed": "not_noticed"}


def _req_summary(res, questions, n_products, purpose):
    usage = res.get("usage", {}) or {}
    return {"purpose": purpose, "jev_model": res.get("model", MODEL), "cache_key": res["cache_key"],
            "cached": res["cached"], "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
            "cost_usd": round(res["cost"], 8), "cost_if_uncached_usd": round(cost_of(usage.get("input_tokens")), 8),
            "n_questions": len(questions)}


def decide_slot(*, persona, ocean, mission, budget_left, category, on_mission, basket, noticed, reads_labels,
                draw_u: float, pickup_draws: list[float], rng_key: str, tag: str = "") -> dict:
    """The shopper funnel for one slot: LOOK (noticed, from notice.py) -> PICK_UP (Jev Noul, sampled) ->
    PUT_BACK or TAKE (decision Choice, sampled).

    Request A: one fan-out with pick-up Nouls + decision + per-product appeal/put-offs/trusts/mechanism.
    Cards show the back of pack only if the shopper reads labels (C draw). If a non-label-reader picks
    something up, request B re-asks the judgments with the back of pack revealed for the picked-up items
    (docs: a second request is warranted when an earlier answer changes the state). Otherwise A is final.

    noticed: list of (code, product_dict, facings); pickup_draws: one uniform per noticed product.
    Returns {"per_product": {code: event fields}, "chosen": code|None, "requests": [...], "state": final_state}."""
    prods = [p for _, p, _ in noticed]
    shopper = shopper_state(persona, ocean, mission=mission, budget_left=budget_left, category=category,
                            on_mission=on_mission, basket=basket)
    trig = top_triggers(persona)
    trust = top_trust(persona)
    nt, ns = len(shopper["put_offs"]), len(shopper["trusts"])
    cards = [product_state(p, prods, reads_labels, budget_left) for p in prods]
    state = {"shopper": shopper, "products": cards}
    questions, meta = build_questions(cards, nt, ns, random.Random(rng_key), with_pickup=True)
    res = ask(state, questions, tag=tag)
    requests = [_req_summary(res, questions, len(cards), "A")]
    p_pick = [float(res["answers"][f"pickup_{i}"]["noul"]) for i in range(len(noticed))]
    examined = [pickup_draws[i] < p_pick[i] for i in range(len(noticed))]
    back_seen = [reads_labels or examined[i] for i in range(len(noticed))]
    final, final_state = res, state
    if not reads_labels and any(examined):
        cards_b = [product_state(p, prods, back_seen[i], budget_left) for i, p in enumerate(prods)]
        state_b = {"shopper": shopper, "products": cards_b}
        q_b, meta_b = build_questions(cards_b, nt, ns, random.Random(rng_key), with_pickup=False)
        assert meta_b == meta
        final = ask(state_b, q_b, tag=tag + ":turned_over")
        final_state = state_b
        requests.append(_req_summary(final, q_b, len(cards_b), "B"))
    A = final["answers"]
    jev_model = final.get("model", MODEL)
    dec = A["decision"]
    probs = dec["probabilities"]
    # sample in the shuffled option order with the common-random-number draw
    acc, sampled = 0.0, meta["decision_option_order"][-1]
    for o in meta["decision_option_order"]:
        acc += float(probs.get(o, 0))
        if draw_u < acc:
            sampled = o
            break
    argmax = max(probs, key=lambda o: probs[o])
    chosen_i = None if sampled == "none" else int(sampled[1:])
    decision_rec = {"probabilities": {k: round(float(v), 4) for k, v in probs.items()},
                    "options": [noticed[i][0] for i in range(len(noticed))],
                    "option_order": meta["decision_option_order"], "confidence": dec.get("confidence"),
                    "argmax": argmax, "sampled": sampled, "sampled_is_argmax": sampled == argmax,
                    "draw_u": round(draw_u, 6)}
    took_name = "nothing" if chosen_i is None else noticed[chosen_i][1].get("name", "")
    out = {}
    for i, (code, p, _) in enumerate(noticed):
        ap = A[f"appeal_{i}"]
        ap_probs = {int(k): float(v) for k, v in ap["probabilities"].items()}
        ap_level = max(ap_probs, key=lambda k: ap_probs[k])
        score = float(ap["score"])
        p_dislike = ap_probs.get(0, 0.0) + ap_probs.get(1, 0.0)
        nouls = {}
        for k, t in enumerate(trig):
            nouls[f"trigger_{k}"] = {"text": _txt(t, "trigger")[:220], "p": round(float(A[f"trig_{i}_{k}"]["noul"]), 4),
                                     "source": t.get("source", "")}
        for k, t in enumerate(trust):
            nouls[f"trust_{k}"] = {"text": _txt(t, "signal", "trust")[:200], "p": round(float(A[f"trust_{i}_{k}"]["noul"]), 4),
                                   "source": t.get("source", "")}
        mech = A[f"mechanism_{i}"]
        mprobs = {k: round(float(v), 4) for k, v in mech["probabilities"].items()}
        mchoice = max(mprobs, key=lambda k: mprobs[k])
        fired = sorted([(v["p"], k) for k, v in nouls.items() if k.startswith("trigger") and v["p"] > NOUL_FIRES], reverse=True)
        trusted = sorted([(v["p"], k) for k, v in nouls.items() if k.startswith("trust") and v["p"] > NOUL_FIRES], reverse=True)
        refs = [f"TypeSafe {jev_model} (sim/jev.py funnel: pick-up Noul + decision Choice, {len(requests)} request(s))"]
        verb = None
        mech_word = MECHANISMS[mchoice].split(":")[0]
        p_take = float(probs.get(f"p{i}", 0))
        if i == chosen_i:
            stage = "taken"
            why = (f"[jev] took it{'' if examined[i] else ' (grabbed without a close look)'}: {mech_word} "
                   f"(p={mprobs[mchoice]:.2f}), appeal '{APPEAL_SHORT[ap_level]}' (score {score:.1f}/4)")
            if trusted:
                k = trusted[0][1]
                why += f"; trusts '{nouls[k]['text'][:70]}' (p={nouls[k]['p']:.2f})"
                verb = verbatim_for(trust[int(k.split('_')[1])], persona)
            why += f"; P(take)={p_take:.2f}"
            if fired:
                why += f"; despite put-off p={fired[0][0]:.2f}"
        elif examined[i]:
            stage = "put_back"
            if fired:
                k = fired[0][1]
                why = f"[jev] picked it up, put it back: sees '{nouls[k]['text'][:90]}' (p={nouls[k]['p']:.2f})"
                verb = verbatim_for(trig[int(k.split('_')[1])], persona)
            elif p_dislike > APPEAL_REJECT_P:
                why = (f"[jev] picked it up, put it back: P(dislikes or avoids)={p_dislike:.2f}, appeal "
                       f"'{APPEAL_SHORT[ap_level]}', {mech_word} (p={mprobs[mchoice]:.2f})")
            else:
                why = (f"[jev] picked it up, put it back: appeal '{APPEAL_SHORT[ap_level]}', {mech_word} "
                       f"(p={mprobs[mchoice]:.2f}); P(take)={p_take:.2f}, took {took_name}")
        else:
            stage = "looked"
            why = (f"[jev] looked, didn't pick it up (P(pick up)={p_pick[i]:.2f}): appeal '{APPEAL_SHORT[ap_level]}' "
                   f"(score {score:.1f}/4); P(take)={p_take:.2f}")
            if fired:
                k = fired[0][1]
                why += f"; put off at a glance by '{nouls[k]['text'][:70]}' (p={nouls[k]['p']:.2f})"
                verb = verbatim_for(trig[int(k.split('_')[1])], persona)
        if verb:
            refs.append(verb["url"])
            why += f' — like "{verb["quote"][:110]}"' if verb.get("quote") else ""
        for k, v in nouls.items():
            if v["p"] > NOUL_FIRES and v.get("source"):
                refs.append(f"{k}: {str(v['source'])[:200]}")
        attrs = list(MECH_ATTRS.get(mchoice, []))
        if not back_seen[i]:
            attrs = [a for a in attrs if a in ("price_gbp", "brand", "pack_copy", "labels", "category", "quantity")]
        out[code] = {
            "decision": STAGE_TO_DECISION[stage], "stage_reached": stage,
            "p_pick_up": round(p_pick[i], 4), "picked_up": examined[i] or stage == "taken",
            "pick_up_draw": round(pickup_draws[i], 6), "back_of_pack_seen": back_seen[i],
            "reason": why[:420], "attributes_cited": attrs,
            "feeling": APPEAL_SHORT[ap_level], "sentiment": round(score / 2 - 1, 3),
            "mechanism": mchoice, "source_refs": refs, "engine": "jev", "jev_model": jev_model,
            "verbatim": verb,
            "jev": {"decision": decision_rec, "self": f"p{i}",
                    "pick_up": {"p": round(p_pick[i], 4), "draw_u": round(pickup_draws[i], 6), "examined": examined[i]},
                    "appeal": {"score": round(score, 4), "level": ap_level, "p_dislike_or_avoid": round(p_dislike, 4),
                               "probabilities": [round(ap_probs.get(k, 0.0), 4) for k in range(len(APPEAL_LEVELS))],
                               "confidence": ap.get("confidence")},
                    "nouls": {k: v["p"] for k, v in nouls.items()},
                    "nouls_fired": {k: {"text": v["text"], "p": v["p"], "source": str(v["source"])[:300]}
                                    for k, v in nouls.items() if v["p"] > NOUL_FIRES},
                    "mechanism": {"choice": mchoice, "confidence": mech.get("confidence"),
                                  "probabilities": {k: v for k, v in mprobs.items() if v >= 0.005},
                                  "option_order": meta["mechanism_option_order"][i]},
                    "judged_in_request": "B" if len(requests) > 1 else "A",
                    "requests": requests},
        }
    return {"per_product": out, "chosen": noticed[chosen_i][0] if chosen_i is not None else None,
            "requests": requests, "state": final_state}


LEGEND = {
    "engine": "TypeSafe System One (Jev) via sim/jev.py; one fan-out request per (agent, slot), plus request B "
              "when a non-label-reader picks something up (back of pack revealed for picked-up items)",
    "pricing": PRICE_SOURCE,
    "funnel_rule": ("LOOK = noticed (sim/notice.py). PICK_UP if draw_u < p (pick-up Noul, request A). TAKE if the "
                    "decision Choice sample lands on this product (taken implies picked up). PUT_BACK = picked up, "
                    "not taken. LOOKED = noticed, not picked up. decision: taken->pick, put_back->reject, looked->walk_past"),
    "decision": ("probabilities over p0..pN (= jev.decision.options[i], the noticed products in shelf order) and "
                 "'none'; option_order is the shuffled order sent to Jev (jaggedness #8); sampled with draw_u = "
                 "sha256(seed, agent, 'jev_decide', slot) walking option_order; jev.self is this product's option"),
    "pick_up_draw": "sha256(seed, agent, 'pickup', product) uniform (common random numbers across optimiser arms)",
    "appeal_levels": APPEAL_LEVELS,
    "sentiment": "score/2 - 1 (appeal levels 0..4 -> -1..1)",
    "nouls": ("trigger_k = persona.rejection_triggers[k] (top 3), trust_k = persona.trust_signals[k] (top 2); "
              "value = P(yes) that the card shows it; fired = p > 0.5"),
    "mechanisms": MECHANISMS,
    "requests": "A = pick-up + decision fan-out, B = re-judged with back of pack; cache_key -> data/sim/cache/jev/<key>.json holds the exact state, questions and raw answer",
    "docs": ["https://docs.typesafe.ai/patterns/fan-out.md", "https://docs.typesafe.ai/confidence.md",
             "https://docs.typesafe.ai/model-jaggedness/jev-1.13.md", "https://docs.typesafe.ai/api.md"],
}


def catalog_name(noticed, opt):
    try:
        return noticed[int(opt[1:])][1].get("name", opt)
    except Exception:
        return opt


# ---------------------------------------------------------------- AI-agent arm: Choice over a feed
def feed_state_item(p: dict, feed: list[dict]) -> dict:
    prices = [float(q.get("price_gbp") or 0) for q in feed if q.get("category") == p.get("category")]
    pr = p.get("price_gbp")
    band = None
    if pr:
        pr = float(pr)
        band = ("under £1" if pr < 1 else "£1-£2" if pr < 2 else "£2-£3" if pr < 3 else "£3-£4" if pr < 4 else "£4 or more")
    d = {"name": p.get("name", ""), "brand": p.get("brand", ""), "category": str(p.get("category", "")).replace("_", " "),
         "price": (price_words(pr, prices).replace("this set", "its category").replace("here", "in its category")
                   + f" (band {band})") if pr else "price missing",
         "pack_copy": (p.get("pack_copy") or "")[:160]}
    b = label_words(p)
    if b:
        d["labels"] = b
    tl = traffic_lights(p)
    if tl:
        d["traffic_lights"] = tl
    for k, f in (("protein", protein_words), ("fibre", fibre_words)):
        w = f(p)
        if w:
            d[k] = w
    if p.get("sweeteners"):
        d["sweeteners"] = "contains sweeteners"
    aw = additives_words(p.get("additives_n"))
    if aw:
        d["additives"] = aw
    if p.get("nova") in NOVA_WORDS:
        d["processing"] = NOVA_WORDS[p["nova"]]
    return d


def agent_pick(mission_text: str, feed: list[dict], *, draw_u: float, tag: str = "") -> dict:
    """feed: product dicts in the (shuffled) retailer order. Option order = feed order on purpose, so the
    first-option lean (jaggedness #8) is measured, not hidden. Hierarchical when > MAX_OPTIONS-1 items."""
    items = [feed_state_item(p, feed) for p in feed]

    def one_choice(idx: list[int], extra_tag=""):
        state = {"user_request": mission_text, "feed": [items[i] for i in idx]}
        crit = {f"f{j}": f"buy `feed[{j}]` ({items[i]['name']})" for j, i in enumerate(idx)}
        crit["none"] = "buy nothing: no item fits the request"
        q = {"pick": {"type": "choice",
                      "instructions": ("You are an AI shopping agent buying for the user. Which single item in "
                                       "`feed` best satisfies `user_request`?"),
                      "criteria": crit}}
        r = ask(state, q, tag=tag + extra_tag)
        a = r["answers"]["pick"]
        probs = {k: float(v) for k, v in a["probabilities"].items()}
        return r, probs, a.get("confidence")

    if len(items) <= MAX_OPTIONS - 1:
        r, probs, conf = one_choice(list(range(len(items))))
        reqs = [r]
        full = {(int(k[1:]) if k != "none" else None): v for k, v in probs.items()}
        order = [f"f{j}" for j in range(len(items))] + ["none"]
    else:  # hierarchical: per-category Choice, then a final Choice over category winners
        cats = {}
        for i, p in enumerate(feed):
            cats.setdefault(p.get("category"), []).append(i)
        winners, reqs = [], []
        for c, idx in cats.items():
            for s in range(0, len(idx), MAX_OPTIONS - 1):
                part = idx[s:s + MAX_OPTIONS - 1]
                r, pr, _ = one_choice(part, f":{c}")
                reqs.append(r)
                best = max((k for k in pr if k != "none"), key=lambda k: pr[k])
                winners.append(part[int(best[1:])])
        r, pr, conf = one_choice(winners, ":final")
        reqs.append(r)
        full = {(winners[int(k[1:])] if k != "none" else None): v for k, v in pr.items()}
        order = [f"f{j}" for j in range(len(winners))] + ["none"]
    acc, sampled = 0.0, None
    keys = [k for k in full if k is not None] + [None]
    for k in keys:
        acc += full.get(k, 0)
        if draw_u < acc:
            sampled = k
            break
    argmax = max(full, key=lambda k: full[k])
    return {"sampled": sampled, "argmax": argmax, "probabilities": full, "confidence": conf,
            "jev_model": reqs[-1].get("model", MODEL), "option_order_note": "options in feed order (f0 = position 1)",
            "n_requests": len(reqs), "input_tokens": sum((x.get("usage") or {}).get("input_tokens", 0) for x in reqs),
            "cost": sum(x["cost"] for x in reqs), "cached": all(x["cached"] for x in reqs),
            "cache_keys": [x["cache_key"] for x in reqs], "state_items": items, "order": order}


if __name__ == "__main__":
    print(json.dumps(session_cost()))

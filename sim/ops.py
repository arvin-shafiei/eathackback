#!/usr/bin/env python3
"""Store operations: a discrete-event simulation of a trading day (or several) in the XL store.

Spec: docs/ideas/store-ops.md. Rule zero applies: every parameter is read from data/ops/params.json or
data/sim/ops/params_extra.json and its source string travels into the output (`params_used`). Arithmetic
is in code. Jev (TypeSafe System One via `from jev import ask`) answers one judgment only: "would this
shopper use self-checkout for this basket?" (cached, capped). No OpenRouter / LLM calls anywhere here.

What runs (heapq event loop; simpy is not installed):
  arrivals   non-homogeneous Poisson per minute from the DfT NTS hour curve x day share x weekly customers
  missions   mix by daypart (lunch meal deal, after-school treats/desserts, evening top-up) -> persona
  shopping   route = mission units + browse, nearest-neighbour from the nearer entrance; at each slot
             p_notice (sim/notice.py, row-mapped) x P(take | noticed) from a FAST SURROGATE built from
             the Jev run logs (data/sim/runs/run_*jev*.json; shrunk counts + Wilson CI) or, for products
             the runs never showed, a lens-grade logit fitted on the seen pairs (labelled lens_logit)
  stock      shelf + back room per SKU; an empty facing triggers the Gruen et al. 2002 reaction mix
  restockers N agents; policy `priority` = P(stock-out before next round) x demand x margin proxy,
             or baseline `fifo` (first SKU to cross the 25% trigger is served first)
  spills     per-visit drop chance (base 2 per 1,000 trips, x5 after a bump; bumps rise with aisle
             crowding); cleaners dispatched; the aisle is blocked until clean
  manager    hourly review; ROP = E(L)E(D) + z*sqrt(E(L)sigma_D^2 + E(D)^2 sigma_L^2); orders arrive at
             06:00 after the lead time
  checkout   service time formula (Klee 2006 / WPI 2004) + live queue -> `smart` lane choice, vs
             baseline `jsq` (join shortest queue, nearest on ties) or `nearest`; reneging after patience
  cafe, theft/EAS gates/guard, checkout theatre (unload/scan/bag/pay) for the 3D replay

CLI:
  python3 sim/ops.py --day Sat --compress 1 --staff restock=4,clean=2 --routing smart --seed 1
  python3 sim/ops.py --compare --seeds 1,2,3 --days 2      # all policy arms, same seeds (CRN) + RESULTS.md
  python3 sim/ops.py --no-jev ...                           # labelled fallback acceptance table, $0
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import glob
import json
import math
import os
import random
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import notice  # noqa: E402
from run import hu, wilson, jitter_ocean, load_personas  # noqa: E402  (import only)

OUT_DIR = os.path.join(ROOT, "data", "sim", "ops")
PARAMS_PATH = os.path.join(ROOT, "data", "ops", "params.json")
EXTRA_PATH = os.path.join(OUT_DIR, "params_extra.json")
DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
DAY_S = 86400.0
GEOM = {"spacing": 5.0, "unitLen": 6.4, "zCentre": 10.0, "crossGap": 2.4,
        "source": "web/src/layout.ts G via sim/layout_optimise.py GEOM (gondola spacing 5 m, unit 6.4 m, cross-aisle 2.4 m)"}
CHILLED_CATS = {"yoghurt", "plant_milk_dairy_alt", "ready_meals_soup", "frozen_icecream"}
JEV_SCO_Q = {"type": "noul",
             "instructions": ("`shopper` has finished shopping and is carrying `basket`. A staffed till and a "
                              "self-checkout are both free right now, with the same wait. Would `shopper` choose "
                              "the self-checkout?"),
             "criteria": {"true": "they use the self-checkout", "false": "they go to the staffed till"}}


# ================================================================ parameters (traced)
class Params:
    def __init__(self):
        a = json.load(open(PARAMS_PATH))["params"]
        b = json.load(open(EXTRA_PATH))["params"]
        self.all = {}
        for k, v in a.items():
            self.all[k] = {**v, "file": os.path.relpath(PARAMS_PATH, ROOT)}
        for k, v in b.items():
            self.all[k] = {**v, "file": os.path.relpath(EXTRA_PATH, ROOT)}
        self.used = {}
        self.overrides = {}

    def __call__(self, name):
        e = self.all[name]
        v = self.overrides.get(name, e["value"])
        self.used[name] = {"value": v, "unit": e.get("unit"), "source": e.get("source"),
                           "confidence": e.get("confidence"), "file": e["file"],
                           **({"overridden_from": e["value"]} if name in self.overrides else {})}
        return v


# ================================================================ mini DES (heapq)
class Env:
    def __init__(self):
        self.now = 0.0
        self.h = []
        self.n = 0

    def at(self, t, fn):
        import heapq
        heapq.heappush(self.h, (t, self.n, fn))
        self.n += 1

    def process(self, gen):
        self._step(gen, None)

    def _step(self, gen, val):
        try:
            cmd = gen.send(val)
        except StopIteration:
            return
        if isinstance(cmd, Signal):
            cmd.add(lambda v, g=gen: self._step(g, v))
        else:
            self.at(self.now + max(0.0, float(cmd)), lambda g=gen: self._step(g, None))

    def run(self, until):
        import heapq
        while self.h and self.h[0][0] <= until:
            t, _, fn = heapq.heappop(self.h)
            self.now = t
            fn()
        self.now = max(self.now, until)


class Signal:
    def __init__(self, env):
        self.env, self.cbs, self.fired, self.value = env, [], False, None

    def add(self, cb):
        if self.fired:
            self.env.at(self.env.now, lambda: cb(self.value))
        else:
            self.cbs.append(cb)

    def fire(self, v=None):
        if self.fired:
            return
        self.fired, self.value = True, v
        for cb in self.cbs:
            self.env.at(self.env.now, lambda c=cb: c(v))


class Resource:
    def __init__(self, env, cap):
        self.env, self.cap, self.users, self.waiters = env, cap, 0, collections.deque()

    def request(self):
        s = Signal(self.env)
        if self.users < self.cap:
            self.users += 1
            s.fire()
        else:
            self.waiters.append(s)
        return s

    def release(self):
        if self.waiters:
            self.waiters.popleft().fire()
        else:
            self.users -= 1


# ================================================================ store + geometry
def load_store_bundle():
    xl = [os.path.join(ROOT, p) for p in ("data/store/store_xl.config.json", "data/store/planogram_xl.json",
                                          "data/products/catalog_xl.json")]
    small = [os.path.join(ROOT, p) for p in ("data/store/store.config.json", "data/store/planogram.json",
                                             "data/products/catalog.json")]
    paths, fallback = (xl, False) if all(os.path.exists(p) for p in xl) else (small, True)
    store, plan, cat = (json.load(open(p)) for p in paths)
    catalog = {str(x["code"]): x for x in cat}
    if fallback:  # small store has no geometry: synthesise it (labelled)
        n = store.get("aisles", 4)
        for u in store["units"]:
            gx = (u["aisle"] - (n + 1) / 2) * GEOM["spacing"]
            u.setdefault("x", gx - 0.5 if u["side"] == "L" else gx + 0.5)
            u.setdefault("z", GEOM["zCentre"])
            u.setdefault("fridge", u["category"] in CHILLED_CATS)
        store["checkouts"] = [{"id": "T1", "type": "staffed", "bank": "tills", "x": -3, "z": 22},
                              {"id": "T2", "type": "staffed", "bank": "tills", "x": 3, "z": 22}] + [
            {"id": f"S{i+1}", "type": "self", "bank": "self_east", "x": 8 + 1.6 * i, "z": 22} for i in range(4)]
        store["entrances"] = [{"id": "E1", **store.get("entrance", {"x": 0, "z": -2})}]
        store["stockroom"] = {"x": 0, "z": 30, "door": {"x": 0, "z": 26.5}}
        store["_synth_geometry"] = "assumption: small store has no geometry; 2 tills + 4 SCO synthesised"
        for s in plan.values():
            for c in s["products"]:
                s.setdefault("capacity", {})[c] = 6
                s.setdefault("stock", {})[c] = 6
    return store, plan, catalog, [os.path.relpath(p, ROOT) for p in paths], fallback


class Geo:
    """Aisle graph: walkways between gondolas, joined by a front and a back cross-aisle. Distance between two
    points = metres along walkways/cross-aisles (Manhattan inside that graph)."""

    def __init__(self, store):
        sp = GEOM["spacing"]
        by_aisle = collections.defaultdict(list)
        for u in store["units"]:
            by_aisle[u["aisle"]].append(u)
        self.gx = {a: sum(u["x"] for u in us) / len(us) for a, us in by_aisle.items()}
        self.wx0 = min(self.gx.values()) - sp / 2
        self.wx1 = max(self.gx.values()) + sp / 2
        zc = GEOM["zCentre"]
        self.zf = zc - GEOM["unitLen"] / 2 - GEOM["crossGap"] / 2
        self.zb = zc + GEOM["unitLen"] / 2 + GEOM["crossGap"] / 2
        self.upos = {}
        for u in store["units"]:
            g = self.gx[u["aisle"]]
            x = g - sp / 2 if u["side"] == "L" else g + sp / 2
            w = int(round((x - self.wx0) / sp))
            self.upos[u["id"]] = (x, zc, w)
        self.segments = [f"W{w}" for w in range(int(round((self.wx1 - self.wx0) / sp)) + 1)] + ["FRONT", "BACK", "TILLS", "CAFE"]

    def seg_of_unit(self, uid):
        return f"W{self.upos[uid][2]}"

    def _exits(self, p):
        x, z, w = p
        if w is not None:
            return [("F", x, abs(z - self.zf)), ("B", x, abs(z - self.zb))]
        if z <= self.zf:
            return [("F", x, self.zf - z)]
        if z >= self.zb:
            return [("B", x, z - self.zb)]
        return [("F", x, abs(z - self.zf)), ("B", x, abs(z - self.zb))]

    def dist(self, a, b):
        a = a if len(a) == 3 else (a[0], a[1], None)
        b = b if len(b) == 3 else (b[0], b[1], None)
        if a[2] is not None and a[2] == b[2]:
            return abs(a[1] - b[1])
        best = 1e9
        for ea, xa, ca in self._exits(a):
            for eb, xb, cb in self._exits(b):
                c = ca + cb + abs(xa - xb) + (0 if ea == eb else (self.zb - self.zf))
                best = min(best, c)
        return best


# ================================================================ surrogate P(take | noticed)
def logit(p):
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def sigmoid(x):
    return 1 / (1 + math.exp(-x))


class Surrogate:
    def __init__(self, catalog, P):
        self.m = P("surrogate_shrinkage_m")
        counts = collections.defaultdict(lambda: [0, 0])
        files = sorted(glob.glob(os.path.join(ROOT, "data/sim/runs/run_*jev*.json")))
        n_ev = 0
        for f in files:
            r = json.load(open(f))
            for a in r.get("agents", []):
                arch = a.get("archetype") or a.get("persona_id")
                for e in a.get("events", []):
                    if not e.get("noticed") or e.get("product") not in catalog:
                        continue
                    st = e.get("stage_reached") or {"pick": "taken"}.get(e.get("decision"), "")
                    c = counts[(arch, e["product"])]
                    c[0] += 1
                    c[1] += int(st == "taken")
                    n_ev += 1
        self.files = [os.path.relpath(f, ROOT) for f in files]
        self.n_events = n_ev
        self.counts = dict(counts)
        tot = collections.defaultdict(lambda: [0, 0])
        for (a, _), (n, k) in counts.items():
            tot[a][0] += n
            tot[a][1] += k
        gn, gk = sum(v[0] for v in tot.values()), sum(v[1] for v in tot.values())
        self.global_mean = gk / gn if gn else 0.2
        self.arch_mean = {a: (k / n if n else self.global_mean) for a, (n, k) in tot.items()}
        self.catalog = catalog
        # lens-grade slope, fitted on seen pairs (n >= 5): logit(p_shrunk) - logit(p_arch) = beta * (grade - mean grade)
        gbar = collections.defaultdict(list)
        for (a, code) in counts:
            g = self._grade(a, code)
            if g is not None:
                gbar[a].append(g)
        self.gbar = {a: sum(v) / len(v) for a, v in gbar.items() if v}
        sxy = sxx = 0.0
        npairs = 0
        for (a, code), (n, k) in counts.items():
            g = self._grade(a, code)
            if n < 5 or g is None or a not in self.gbar:
                continue
            ps = (k + self.m * self.arch_mean[a]) / (n + self.m)
            x = g - self.gbar[a]
            y = logit(ps) - logit(self.arch_mean[a])
            sxy += n * x * y
            sxx += n * x * x
            npairs += 1
        self.beta = sxy / sxx if sxx > 0 else 0.0
        self.beta_n = npairs
        self.cache = {}
        self.used = collections.Counter()

    def _grade(self, arch, code):
        g = (self.catalog.get(code, {}).get("lens_grades") or {}).get(arch)
        if isinstance(g, dict):
            g = g.get("score")
        return float(g) if isinstance(g, (int, float)) else None

    def p(self, arch, code):
        key = (arch, code)
        if key in self.cache:
            return self.cache[key]
        pa = self.arch_mean.get(arch, self.global_mean)
        if key in self.counts:
            n, k = self.counts[key]
            v = ((k + self.m * pa) / (n + self.m), "jev_runs")
        else:
            g = self._grade(arch, code)
            if g is None or arch not in self.gbar:
                v = (pa, "archetype_mean")
            else:
                v = (sigmoid(logit(pa) + self.beta * (g - self.gbar[arch])), "lens_logit")
        self.cache[key] = v
        return v

    def summary(self):
        cov = collections.Counter(self.p(a, c)[1] for (a, c) in self.cache)
        return {"source_files": self.files, "noticed_events": self.n_events, "pairs_with_counts": len(self.counts),
                "archetype_take_given_noticed": {a: {"p": round(v, 4), "n": sum(n for (aa, _), (n, _k) in self.counts.items() if aa == a),
                                                     "ci95": wilson(sum(k for (aa, _), (_n, k) in self.counts.items() if aa == a),
                                                                    sum(n for (aa, _), (n, _k) in self.counts.items() if aa == a))}
                                                 for a, v in sorted(self.arch_mean.items())},
                "shrinkage": "(k + m*p_arch)/(n + m), m from params_extra surrogate_shrinkage_m",
                "lens_logit": {"beta": round(self.beta, 4), "fitted_on_pairs": self.beta_n,
                               "formula": "P = sigmoid(logit(p_arch) + beta*(lens_grade[arch] - mean grade of seen products))",
                               "label": "fallback for products never shown in a Jev run (all auto_xl + the 4 new curated categories)"},
                "lookups_by_source": dict(cov)}

    def ci(self, arch, code):
        if (arch, code) in self.counts:
            n, k = self.counts[(arch, code)]
            return {"n": n, "k": k, "ci95": wilson(k, n)}
        return None


# ================================================================ demand / arrivals
def arrival_rate_per_min(P, dow, minute_of_day):
    """Expected arrivals in one minute: weekly customers x day share x NTS hour share (shifted by the
    trip-to-store lag) / 60."""
    lag = P("trip_start_to_arrival_lag_min")
    h = int(((minute_of_day - lag) // 60) % 24)
    return P("store_customers_per_week") * P("shopping_trips_by_day_share")[dow] * \
        P("weekday_shopping_trip_start_share_by_hour")[h] / 60.0


def daypart(hour):
    for k, (a, b) in {"08-12": (0, 12), "12-14": (12, 14), "14-15": (14, 15), "15-17": (15, 17),
                      "17-19": (17, 19), "19-22": (19, 24)}.items():
        if a <= hour < b:
            return k
    return "19-22"


def poisson(rng, lam):
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, int(round(rng.gauss(lam, math.sqrt(lam)))))
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= L:
            return k
        k += 1


def neg_binomial(rng, mean, k):
    lam = rng.gammavariate(k, mean / k)
    return poisson(rng, lam)


def poisson_sf(s, lam):
    """P(X >= s), X ~ Poisson(lam)."""
    if s <= 0:
        return 1.0
    if lam <= 0:
        return 0.0
    term = math.exp(-lam)
    cdf = term
    for i in range(1, s):
        term *= lam / i
        cdf += term
    return max(0.0, 1.0 - cdf)


def exp_shortfall(s, m):
    """E[(D - s)+] for D ~ Poisson(m): expected units wanted beyond the s on the shelf."""
    if m <= 0:
        return 0.0
    pk = math.exp(-m)
    acc = 0.0
    for k in range(int(s)):
        acc += (s - k) * pk
        pk *= m / (k + 1)
    return max(0.0, m - s + acc)


def pct(xs, q):
    if not xs:
        return None
    xs = sorted(xs)
    i = (len(xs) - 1) * q
    lo, hi = int(math.floor(i)), int(math.ceil(i))
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


# ================================================================ the model
class OpsSim:
    def __init__(self, *, seed=1, days=1, dow="Sat", routing="smart", restock="priority", staff=None,
                 compress=1, use_jev=True, jev_max_calls=400, hours=None, verbose=True, shared=None):
        self.P = Params()
        P = self.P
        self.seed, self.routing, self.restock_policy = seed, routing, restock
        self.verbose = verbose
        self.staff_n = {"restock": 4, "clean": 2, "guard": 1, **(staff or {})}
        self.compress = max(1, int(compress))
        d0 = DOWS.index(dow)
        self.dows = [DOWS[(d0 + i) % 7] for i in range(days)]
        self.days = days
        oh = P("open_hours")
        self.open_h, self.close_h = (hours or oh)
        self.use_jev, self.jev_max_calls = use_jev, jev_max_calls
        if shared is None:
            shared = self.build_shared(use_jev)
        self.shared = shared
        self.store, self.plan, self.catalog, self.paths, self.fallback = shared["bundle"]
        self.geo = shared["geo"]
        self.sur = shared["sur"]
        self.personas = shared["personas"]
        self.persona_src = shared["persona_src"]
        self.env = Env()
        self.events = []
        self.c = collections.Counter()

    # ---------------------------------------------------------------- shared, policy-independent inputs
    @staticmethod
    def build_shared(use_jev=True):
        P = Params()
        bundle = load_store_bundle()
        store, plan, catalog, paths, fallback = bundle
        personas, psrc = load_personas()
        return {"bundle": bundle, "geo": Geo(store), "sur": Surrogate(catalog, P), "personas": personas,
                "persona_src": psrc, "jev_table": {}, "jev_meta": {"calls": 0, "cached": 0, "cost_usd": 0.0,
                                                                   "errors": [], "fallback_used": 0}}

    def log(self, *a):
        if self.verbose:
            print(*a, flush=True)

    def ev(self, t, typ, **kw):
        self.events.append({"t": round(t, 1), "type": typ, **kw})

    # ---------------------------------------------------------------- setup
    def setup(self):
        P, store, plan = self.P, self.store, self.plan
        self.units = {u["id"]: u for u in store["units"]}
        self.row_map = {int(k): int({"top": 1, "eye": 2, "bottom": 3}.get(v, 2)) if isinstance(v, str) else int(v)
                        for k, v in (store.get("notice_row_map") or {}).items() if k.isdigit()}
        self.slot_of = {}
        self.cap, self.shelf, self.slot_products = {}, {}, {}
        mult = P("shelf_capacity_multiplier")
        for sid, s in plan.items():
            self.slot_products[sid] = list(s["products"])
            for c in s["products"]:
                self.slot_of[c] = sid
                self.cap[c] = int(round(int((s.get("capacity") or {}).get(c, 6)) * mult))
                self.shelf[c] = self.cap[c]  # opens fully faced up (planogram stock = capacity)
        self.slot_order = sorted(plan)
        self.prod_order = sorted(self.cap)
        self.unit_slots = collections.defaultdict(list)
        for sid in plan:
            u, r = sid.rsplit("-r", 1)
            self.unit_slots[u].append((int(r), sid))
        for u in self.unit_slots:
            self.unit_slots[u].sort()
        self.cat_units = collections.defaultdict(list)
        for u in store["units"]:
            self.cat_units[u["category"]].append(u["id"])
        self.mission_cats = P("mission_categories_xl")
        self.price = {c: float(self.catalog[c].get("price_gbp") or 0) for c in self.cap}
        P.overrides["offrange_item_price_gbp"] = round(sum(self.price.values()) / len(self.price), 2)
        self.offrange_price = P("offrange_item_price_gbp")
        self.by_mission = collections.defaultdict(list)
        for p in self.personas:
            self.by_mission[p.get("mission", "weekly_shop")].append(p)
        self.walk = P("walk_speed_mps")
        self.staff_walk = P("staff_walk_speed_mps")
        # lanes
        self.lanes = []
        for co in store["checkouts"]:
            self.lanes.append({"id": co["id"], "type": "staffed" if co["type"] == "staffed" else "self",
                               "bank": co.get("bank", "self"), "x": co["x"], "z": co["z"], "queue": [], "cur": None,
                               "cur_pred_end": 0.0, "busy_s": 0.0, "served": 0})
        per_att = P("sco_terminals_per_attendant")
        self.attendants = {}
        for b in {l["bank"] for l in self.lanes if l["type"] == "self"}:
            n = sum(1 for l in self.lanes if l["bank"] == b)
            self.attendants[b] = Resource(self.env, max(1, math.ceil(n / per_att)))
        self.door = (store["stockroom"]["door"]["x"], store["stockroom"]["door"]["z"])
        self.entrances = [(e["x"], e["z"], e["id"]) for e in store.get("entrances") or [{"id": "E1", **store["entrance"]}]]
        cafe = P("cafe")
        self.cafe = cafe
        self.cafe_seats = Resource(self.env, cafe["seats"])
        self.theft = P("theft")
        # forecast + initial back room
        self.build_forecast()
        lo, hi = P("backroom_cover_days")
        self.backroom = {}
        for c in self.cap:
            u = hu("backroom", c)  # same for every seed/policy: the store's starting position
            self.backroom[c] = int(round(self.daily_forecast(c, self.dows[0]) * (lo + (hi - lo) * u)))
        self.on_order = collections.Counter()
        self.trigger_t = {}
        self.inprogress = set()
        self.zero_since = {}
        self.oos_seconds = collections.Counter()
        self.alerted = set()
        self.queries = collections.deque()
        self.spills = {}           # spill id -> dict
        self.blocked = collections.Counter()  # segment -> active spills
        self.spill_q = collections.deque()
        self.occ = collections.Counter()
        self.inside = {}
        self.shoppers = []
        self.staff = []

    # ---------------------------------------------------------------- shopper planning (stock-free, deterministic)
    def persona_for(self, mission, key):
        pool = self.by_mission.get(mission) or self.personas
        return pool[int(hu(key, "persona") * len(pool)) % len(pool)]

    def plan_shopper(self, sid, mission, persona, ns):
        """Route + ordered desires. `ns` namespaces the draws (seed for the day, 'forecast' for the manager's
        history). Stock-free: the same shopper wants the same things under every policy (common random numbers)."""
        P = self.P
        rng = random.Random(f"{ns}|{sid}")
        ocean = jitter_ocean(persona.get("ocean", {}), rng)
        cats = set(persona.get("mission_categories") or self.mission_cats.get(mission, []))
        bp = P("browse_prob")
        route = []
        for u in self.store["units"]:
            on = u["category"] in cats
            if on or hu(ns, sid, "browse", u["id"]) < bp:
                route.append((u["id"], on))
        mean = P("basket_items_by_mission")[mission]["mean"]
        target = max(1, neg_binomial(rng, mean, P("basket_nb_dispersion_k")))
        in_share = P("in_range_share_of_basket")[mission]
        shelf_cap = max(1, int(round(target * in_share)))
        pp = persona.get("sim_parameters") or {}
        arch = persona.get("archetype", persona["id"])
        desires = {}
        rows_browse = P("browse_dwell_slots")
        for uid, on in route:
            slots = self.unit_slots[uid]
            if not on:
                slots = [s for s in slots if s[0] == 2][:rows_browse] or slots[:rows_browse]
            want = []
            for row, slot in slots:
                prods = self.slot_products[slot]
                fac = self.plan[slot].get("facings") or {}
                for i, c in enumerate(prods):
                    pr = self.catalog[c]
                    pn, _ = notice.p_notice(row=self.row_map.get(row, row if row <= 3 else 3), facings=fac.get(c, 1),
                                            pos=i, n_in_set=len(prods), on_mission=on, ocean=ocean,
                                            role=pr.get("role", ""), persona_params=pp,
                                            nutriscore=pr.get("nutriscore", ""), category=pr.get("category", ""))
                    if hu(ns, sid, "notice", c) >= pn:
                        continue
                    pt, _src = self.sur.p(arch, c)
                    if hu(ns, sid, "take", c) < pt:
                        want.append(c)
            desires[uid] = (want, len(slots))
        return {"route": route, "desires": desires, "target": target, "shelf_cap": shelf_cap, "ocean": ocean,
                "secs": float(pp.get("seconds_at_shelf") or 6), "arch": arch}

    def build_forecast(self):
        """Manager's 'history': E[units per shopper] by product and mission from a Monte Carlo of the same
        shopper model (seed namespace 'forecast'); rate(t) = arrivals(t) x sum_m mix_m(t) x E_m."""
        n = self.P("forecast_shoppers_per_mission")
        if "E" in self.shared:
            self.E = self.shared["E"]
        else:
            self.E = self.shared["E"] = self._mc_forecast(n)
        mix = self.P("mission_mix_by_daypart")
        self._fc_hour = {}
        for dow in set(self.dows):
            for h in range(24):
                lam_h = sum(arrival_rate_per_min(self.P, dow, h * 60 + mm) for mm in range(60))
                mx = mix[daypart(h)]
                self._fc_hour[(dow, h)] = (lam_h, mx)

    def _mc_forecast(self, n):
        E = {}
        for m in self.P("basket_items_by_mission"):
            cnt = collections.Counter()
            for i in range(n):
                sid = f"f{m}{i}"
                per = self.persona_for(m, f"forecast|{sid}")
                pl = self.plan_shopper(sid, m, per, "forecast")
                taken = 0
                for uid, _on in self.order_route(pl["route"], self.entrances[0][:2])[0]:
                    for c in pl["desires"][uid][0]:
                        if taken >= pl["shelf_cap"]:
                            break
                        cnt[c] += 1
                        taken += 1
            E[m] = {c: v / n for c, v in cnt.items()}
        return E

    def rate_per_s(self, c, dow, hour):
        lam_h, mx = self._fc_hour[(dow, hour)]
        return lam_h * sum(mx[m] * self.E[m].get(c, 0.0) for m in mx) / 3600.0

    def daily_forecast(self, c, dow):
        return sum(self.rate_per_s(c, dow, h) * 3600 for h in range(self.open_h, self.close_h))

    def order_route(self, route, start):
        """Nearest-neighbour ordering over unit positions from `start`; returns (ordered, metres)."""
        left = list(route)
        pos = (start[0], start[1], None)
        out, m = [], 0.0
        while left:
            j = min(range(len(left)), key=lambda i: self.geo.dist(pos, self.geo.upos[left[i][0]]))
            d = self.geo.dist(pos, self.geo.upos[left[j][0]])
            m += d
            pos = self.geo.upos[left[j][0]]
            out.append(left.pop(j))
        return out, m

    # ---------------------------------------------------------------- Jev: self-checkout acceptance
    def bucket(self, n):
        for k, (a, b) in self.P("basket_buckets").items():
            if a <= n <= b:
                return k
        return "very_big"

    def jev_state(self, persona, mission, bucket, loose, age):
        import jev as J
        traits = []
        for t in "OCEAN":
            v = float((persona.get("ocean") or {}).get(t, 0.5))
            if v >= 0.65:
                traits.append(J.OCEAN_PHRASES[t][0])
            elif v <= 0.35:
                traits.append(J.OCEAN_PHRASES[t][1])
        size = {"few": "a few items (1 to 5) in their hands or a basket", "small": "a basket of about 6 to 15 items",
                "big": "a trolley with about 16 to 40 items", "very_big": "a full trolley with more than 40 items"}[bucket]
        return {"shopper": {"who": J._first_sentences(persona.get("dossier", "")),
                            "mission": J.MISSION_WORDS.get(mission, mission.replace("_", " ")),
                            "personality": traits or ["average on every Big Five trait"],
                            "habits": [J._txt(h, "habit")[:160] for h in (persona.get("habits") or [])[:2]]},
                "basket": {"size": size,
                           "weighing": "includes loose fruit or veg that has to be weighed" if loose else "nothing to weigh",
                           "age_check": "includes an age-restricted item (e.g. alcohol) that needs an ID check" if age
                           else "nothing age-restricted"}}

    def resolve_jev(self, combos):
        tab, meta = self.shared["jev_table"], self.shared["jev_meta"]
        todo = [k for k in combos if k not in tab]
        if not todo:
            return
        fb = self.P("sco_accept_fallback")
        if not self.use_jev:
            for k in todo:
                tab[k] = {"p": fb[k[2]], "source": "fallback (params_extra sco_accept_fallback, --no-jev)"}
                meta["fallback_used"] += 1
            return
        import jev as J
        pmap = {p["id"]: p for p in self.personas}
        budget = max(0, self.jev_max_calls - meta["calls"] - meta["cached"])
        ask_now, rest = todo[:budget], todo[budget:]

        def one(k):
            pid, mission, b, loose, age = k
            if meta.get("halt"):
                return k, {"p": fb[b], "source": f"fallback (jev halted: {meta['halt']})", "error": True}
            st = self.jev_state(pmap[pid], mission, b, loose, age)
            try:
                r = J.ask(st, {"use_sco": JEV_SCO_Q}, tag=f"ops_sco:{pid}:{mission}:{b}:{int(loose)}:{int(age)}")
                return k, {"p": round(float(r["answers"]["use_sco"]["noul"]), 4), "source": "jev",
                           "jev_model": r.get("model"), "cache_key": r["cache_key"], "cached": r["cached"],
                           "cost_usd": r["cost"]}
            except Exception as e:  # noqa: BLE001
                if " 402 " in str(e) or "credits" in str(e):
                    meta["halt"] = "402 no TypeSafe credits"
                return k, {"p": fb[b], "source": f"fallback (jev error: {str(e)[:120]})", "error": True}

        with ThreadPoolExecutor(16) as ex:
            for k, v in ex.map(one, ask_now):
                tab[k] = v
                if v.get("error"):
                    meta["errors"].append(v["source"])
                    meta["fallback_used"] += 1
                elif v["cached"]:
                    meta["cached"] += 1
                else:
                    meta["calls"] += 1
                    meta["cost_usd"] += v["cost_usd"]
        for k in rest:
            tab[k] = {"p": fb[k[2]], "source": "fallback (jev call cap reached)"}
            meta["fallback_used"] += 1

    # ---------------------------------------------------------------- spawning
    def spawn_day(self, d):
        P = self.P
        dow = self.dows[d]
        rng = random.Random(f"arrivals|{self.seed}|{d}")
        mix = P("mission_mix_by_daypart")
        missions = list(P("basket_items_by_mission"))
        out = []
        i = 0
        loose_share = P("loose_produce_share_of_offrange")
        age_p = P("age_restricted_basket_prob")
        cafe_p = self.cafe["visit_prob_by_daypart"]
        for mnt in range(self.open_h * 60, self.close_h * 60):
            k = poisson(rng, arrival_rate_per_min(P, dow, mnt))
            for _ in range(k):
                t = d * DAY_S + mnt * 60 + rng.random() * 60
                sid = f"d{d}s{i:05d}"
                i += 1
                key = f"{self.seed}|{sid}"
                hr = mnt // 60
                mx = mix[daypart(hr)]
                u, acc, mission = hu(key, "mission"), 0.0, missions[-1]
                for m in missions:
                    acc += mx.get(m, 0)
                    if u < acc:
                        mission = m
                        break
                per = self.persona_for(mission, key)
                pl = self.plan_shopper(sid, mission, per, str(self.seed))
                # entrance: the one that gives the shorter route (spreads arrivals over both doors)
                best = None
                for ex, ez, eid in self.entrances:
                    o, m_ = self.order_route(pl["route"], (ex, ez))
                    if best is None or m_ < best[1]:
                        best = (o, m_, (ex, ez, eid))
                offr = max(0, pl["target"] - pl["shelf_cap"])
                loose = sum(1 for j in range(offr) if hu(key, "loose", j) < loose_share)
                age = hu(key, "age") < age_p[mission]
                th = None
                if hu(key, "theft") < self.theft["attempt_share"]:
                    th = "walkout_unscanned" if hu(key, "theft_mode") < self.theft["mode_split"]["walkout_unscanned"] else "sco_skip_scan"
                out.append({"id": sid, "key": key, "t_arrive": t, "persona": per["id"], "arch": pl["arch"],
                            "mission": mission, "route": best[0], "route_m": round(best[1], 1), "entrance": best[2],
                            "desires": pl["desires"], "target": pl["target"], "shelf_cap": pl["shelf_cap"],
                            "secs": pl["secs"], "offrange": offr,
                            "planned_items": min(sum(len(w) for w, _ in pl["desires"].values()), pl["shelf_cap"]) + offr, "loose": loose, "age": age, "theft": th,
                            "cafe": hu(key, "cafe") < cafe_p[daypart(hr)],
                            "patience_s": random.Random(f"{key}|patience").gammavariate(P("patience_gamma_shape"), P("patience_min")[mission] * 60 / P("patience_gamma_shape"))})
        return out

    # ---------------------------------------------------------------- stock helpers
    def set_shelf(self, c, v, t):
        old = self.shelf[c]
        self.shelf[c] = v
        if v <= 0 and old > 0:
            self.zero_since[c] = t
        elif v > 0 and old <= 0 and c in self.zero_since:
            self.oos_seconds[c] += t - self.zero_since.pop(c)
        if v <= self.P("restock_trigger_fill") * self.cap[c]:
            self.trigger_t.setdefault(c, t)
        else:
            self.trigger_t.pop(c, None)

    def substitute(self, c, same_brand, arch):
        cat, brand = self.catalog[c]["category"], self.catalog[c].get("brand")
        pool = [x for u in self.cat_units[cat] for _, s in self.unit_slots[u] for x in self.slot_products[s]
                if x != c and self.shelf[x] > 0 and ((self.catalog[x].get("brand") == brand) == same_brand)]
        if same_brand and not pool:
            return self.substitute(c, False, arch)
        if not pool:
            return None
        return max(pool, key=lambda x: (self.sur.p(arch, x)[0], x))

    # ---------------------------------------------------------------- shopper process
    def shopper(self, s):
        env, geo, P = self.env, self.geo, self.P
        s["waypoints"] = [[round(env.now), s["entrance"][0], s["entrance"][1], "enter"]]
        s["basket"], s["oos"], s["skipped_units"] = [], [], []
        self.inside[s["id"]] = s
        pos = (s["entrance"][0], s["entrance"][1], None)
        self.occ["FRONT"] += 1
        seg_now = "FRONT"
        queue = [u for u, _ in s["route"]]
        deferred = set()
        taken = 0
        p_spill_visit = P("spill_rate_per_1000_shoppers") / 1000.0 / max(1, len(queue))
        while queue:
            uid = queue.pop(0)
            seg = geo.seg_of_unit(uid)
            if self.blocked[seg] > 0:
                d = P("spill_detour_m")
                yield d / self.walk
                if uid not in deferred:
                    deferred.add(uid)
                    queue.append(uid)
                    self.c["spill_detours"] += 1
                else:
                    s["skipped_units"].append(uid)
                    self.c["spill_skipped_unit_visits"] += 1
                continue
            up = geo.upos[uid]
            self.occ[seg_now] -= 1
            self.occ[seg] += 1
            seg_now = seg
            yield geo.dist(pos, up) / self.walk
            pos = up
            s["waypoints"].append([round(env.now), up[0], up[1], uid])
            others = max(0, self.occ[seg] - 1)
            bumped = hu(s["key"], "bump", uid) < 1 - math.exp(-P("bump_k_per_other") * others)
            if bumped:
                self.c["collisions"] += 1
            want, nslots = s["desires"][uid]
            for c in want:
                if taken >= s["shelf_cap"]:
                    break
                if self.shelf[c] > 0:
                    self.set_shelf(c, self.shelf[c] - 1, env.now)
                    s["basket"].append(c)
                    taken += 1
                    continue
                if self.on_oos(s, c, uid):
                    taken += 1  # substitute went in the basket
            yield nslots * s["secs"]
            mult = P("spill_prob_multiplier_on_collision") if bumped else 1
            if hu(s["key"], "spill", uid) < p_spill_visit * mult:
                self.new_spill(env.now, uid, seg, up, s, bumped)
        self.occ[seg_now] -= 1
        # cafe
        if s["cafe"]:
            self.occ["CAFE"] += 1
            yield from self.cafe_visit(s, pos)
            self.occ["CAFE"] -= 1
            pos = (self.cafe["counter"]["x"], self.cafe["counter"]["z"], None)
        # checkout (or walk out)
        self.occ["TILLS"] += 1
        n_items = len(s["basket"]) + s["offrange"]
        s["items_n"] = n_items
        if s["theft"] == "walkout_unscanned":
            self.occ["TILLS"] -= 1
            s["outcome"] = "walkout"
            yield from self.exit_gate(s, pos, unscanned=list(s["basket"]))
            return
        lane = self.choose_lane(s, pos)
        yield geo.dist(pos, (lane["x"], lane["z"], None)) / self.walk
        s["waypoints"].append([round(env.now), lane["x"], lane["z"], lane["id"]])
        done = Signal(env)
        s["_done"] = done
        self.join(lane, s)
        res = yield done
        self.occ["TILLS"] -= 1
        pos = (lane["x"], lane["z"], None)
        if res == "abandon":
            s["outcome"] = "abandoned"
            self.c["abandoned"] += 1
            # abandoned trolley: staff wheel it to the back room; items re-enter stock there (assumption)
            for c in s["basket"]:
                self.backroom[c] += 1
            yield from self.exit_gate(s, pos, unscanned=[])
            return
        s["outcome"] = "paid"
        yield from self.exit_gate(s, pos, unscanned=s.get("skipped_scan", []))

    def on_oos(self, s, c, uid):
        P = self.P
        R = P("oos_reaction")
        u, acc, react = hu(s["key"], "oos", c), 0.0, "do_not_buy"
        for k, v in R.items():
            acc += v
            if u < acc:
                react = k
                break
        cause = "shelf_restocking" if (self.backroom[c] > 0 or c in self.inprogress) else "store_ordering"
        rec = {"t": round(self.env.now, 1), "code": c, "reaction": react, "price": self.price[c], "cause": cause}
        self.c[f"oos_cause_{cause}"] += 1
        if react in ("substitute_other_brand", "substitute_same_brand"):
            sub = self.substitute(c, react == "substitute_same_brand", s["arch"])
            if sub:
                self.set_shelf(sub, self.shelf[sub] - 1, self.env.now)
                s["basket"].append(sub)
                rec["sub"] = sub
                rec["recovered_gbp"] = self.price[sub]
            else:
                rec["sub"] = None
        s["oos"].append(rec)
        self.c["oos_events"] += 1
        self.c[f"oos_{react}"] += 1
        if len(s["oos"]) == 1 and hu(s["key"], "ask_staff") < P("oos_staff_query_prob"):  # per OOS-hit shopper
            self.queries.append({"t": self.env.now, "pos": self.geo.upos[uid], "code": c})
            self.c["staff_queries"] += 1
        self.ev(self.env.now, "oos", shopper=s["id"], code=c, slot=self.slot_of[c], reaction=react, sub=rec.get("sub"))
        return bool(rec.get("sub"))

    def cafe_visit(self, s, pos):
        env, cf = self.env, self.cafe
        cpos = (cf["counter"]["x"], cf["counter"]["z"], None)
        yield self.geo.dist(pos, cpos) / self.walk
        s["waypoints"].append([round(env.now), cpos[0], cpos[1], "cafe"])
        if self.cafe_seats.users >= self.cafe_seats.cap:
            # wait up to N minutes for a seat (polled each 30 s), else leave without buying
            waited = 0.0
            while self.cafe_seats.users >= self.cafe_seats.cap and waited < cf["wait_for_seat_max_min"] * 60:
                yield 30
                waited += 30
            if self.cafe_seats.users >= self.cafe_seats.cap:
                self.c["cafe_turnaway"] += 1
                self.ev(env.now, "cafe_turnaway", shopper=s["id"])
                return
        yield self.cafe_seats.request()
        item = cf["menu"][int(hu(s["key"], "menu") * len(cf["menu"])) % len(cf["menu"])]
        self.c["cafe_visits"] += 1
        self.cafe_rev = getattr(self, "cafe_rev", 0.0) + item["price_gbp"]
        s["cafe_item"] = item["code"]
        self.ev(env.now, "cafe_sit", shopper=s["id"], item=item["code"], price=item["price_gbp"])
        dwell = -math.log(1 - hu(s["key"], "cafe_dwell") * 0.999999) * cf["dwell_min_mean"] * 60
        yield dwell
        self.cafe_seats.release()

    def exit_gate(self, s, pos, unscanned):
        env, th = self.env, self.theft
        ex = min(self.entrances, key=lambda e: self.geo.dist(pos, (e[0], e[1], None)))
        yield self.geo.dist(pos, (ex[0], ex[1], None)) / self.walk
        s["waypoints"].append([round(env.now), ex[0], ex[1], "exit"])
        s["t_leave"] = round(env.now, 1)
        if unscanned:
            tagged = [c for c in unscanned if hu(s["key"], "tag", c) < th["eas_tagged_item_share"]]
            val = sum(self.price[c] for c in unscanned)
            alarm = bool(tagged) and hu(s["key"], "eas") < th["eas_detection_rate"]
            inc = {"shopper": s["id"], "mode": s["theft"], "items": len(unscanned), "value_gbp": round(val, 2),
                   "tagged": len(tagged), "alarm": alarm, "gate": ex[2], "t": round(env.now, 1)}
            self.c["theft_attempts"] += 1
            if alarm:
                self.c["alarms"] += 1
                self.ev(env.now, "alarm", gate=ex[2], x=ex[0], z=ex[1], shopper=s["id"])
                g = self.free_guard()
                if g is not None:
                    d = self.geo.dist((g["x"], g["z"], None), (ex[0], ex[1], None))
                    resp = d / th["guard_speed_mps"]
                    inc["guard_response_s"] = round(resp, 1)
                    inc["recovered"] = resp <= th["guard_recovery_window_s"]
                    env.process(self.guard_job(g, ex, resp))
                else:
                    inc["recovered"] = False
                    inc["guard_response_s"] = None
            else:
                inc["recovered"] = False
            if not inc["recovered"]:
                self.shrink = getattr(self, "shrink", 0.0) + val
            self.incidents.append(inc)
        self.inside.pop(s["id"], None)

    def free_guard(self):
        for g in self.staff:
            if g["role"] == "guard" and g["task"] == "idle":
                return g
        return None

    def guard_job(self, g, ex, resp):
        t0 = self.env.now
        self.move(g, (ex[0], ex[1]), resp, "respond_alarm")
        yield resp + self.theft["guard_handle_min"] * 60
        post = self.theft["guard_post"]
        self.move(g, (post["x"], post["z"]), 0, "idle")
        g["busy_s"] += self.env.now - t0

    # ---------------------------------------------------------------- checkout
    def predict(self, s, typ):
        P = self.P
        n, loose, age = s["items_n"], s["loose"], int(s["age"])
        if typ == "staffed":
            return P("staffed_fixed_s") + P("staffed_per_item_s") * n + P("produce_weigh_s_staffed") * loose + \
                P("age_check_delay_s_staffed") * age
        return P("sco_initiation_s") + P("sco_per_item_s") * n + P("sco_payment_card_s") + P("sco_deactivation_s") + \
            P("produce_weigh_s_sco") * loose + P("age_check_delay_s_sco") * age + \
            P("sco_intervention_prob") * P("sco_intervention_resolution_s")

    def lane_wait(self, lane):
        now = self.env.now
        w = max(0.0, lane["cur_pred_end"] - now) if lane["cur"] else 0.0
        return w + sum(self.predict(q, lane["type"]) for q in lane["queue"])

    def choose_lane(self, s, pos):
        P = self.P
        pid, mission = s["persona"], s["mission"]
        k = (pid, mission, self.bucket(s["items_n"]), s["loose"] > 0, bool(s["age"]))
        if k not in self.shared["jev_table"]:
            self.resolve_jev([k])  # actual basket landed in a bucket not pre-asked (OOS / drops): ask now (cached after)
        acc = self.shared["jev_table"][k]
        s["sco_accept_p"] = acc["p"]
        accepts = hu(s["key"], "sco_accept") < acc["p"]
        if s["theft"] == "sco_skip_scan":
            accepts = True  # a skip-scanner needs a self-checkout
        s["accepts_sco"] = accepts
        lanes = [l for l in self.lanes if l["type"] == "staffed" or accepts]
        dist = {l["id"]: self.geo.dist(pos, (l["x"], l["z"], None)) for l in lanes}
        if self.routing == "smart":
            def cost(l):
                return dist[l["id"]] / self.walk + self.lane_wait(l) + self.predict(s, l["type"])
            lane = min(lanes, key=lambda l: (cost(l), l["id"]))
            s["route_pred"] = {"walk_s": round(dist[lane["id"]] / self.walk, 1), "wait_s": round(self.lane_wait(lane), 1),
                               "service_s": round(self.predict(s, lane["type"]), 1)}
        elif self.routing == "smart_wait":
            lane = min(lanes, key=lambda l: (dist[l["id"]] / self.walk + self.lane_wait(l), self.predict(s, l["type"]), l["id"]))
            s["route_pred"] = {"walk_s": round(dist[lane["id"]] / self.walk, 1), "wait_s": round(self.lane_wait(lane), 1),
                               "service_s": round(self.predict(s, lane["type"]), 1)}
        elif self.routing == "jsq":
            lane = min(lanes, key=lambda l: (len(l["queue"]) + (1 if l["cur"] else 0), dist[l["id"]], l["id"]))
        else:  # nearest
            lane = min(lanes, key=lambda l: (dist[l["id"]], l["id"]))
        s["lane"], s["lane_type"] = lane["id"], lane["type"]
        return lane

    def join(self, lane, s):
        env = self.env
        s["t_join"] = env.now
        s["q_ahead"] = len(lane["queue"]) + (1 if lane["cur"] else 0)
        lane["queue"].append(s)
        env.at(env.now + s["patience_s"], lambda: self.renege(lane, s))
        if lane["cur"] is None:
            self.start_next(lane)

    def renege(self, lane, s):
        if s in lane["queue"]:
            lane["queue"].remove(s)
            s["wait_s"] = round(self.env.now - s["t_join"], 1)
            self.ev(self.env.now, "abandon", shopper=s["id"], lane=lane["id"], waited_s=s["wait_s"],
                    items=s["items_n"])
            s["_done"].fire("abandon")

    def start_next(self, lane):
        if not lane["queue"]:
            lane["cur"] = None
            return
        s = lane["queue"].pop(0)
        lane["cur"] = s
        s["t_start"] = self.env.now
        s["wait_s"] = round(s["t_start"] - s["t_join"], 1)
        lane["cur_pred_end"] = self.env.now + self.predict(s, lane["type"])
        self.env.process(self.serve(lane, s))

    def serve(self, lane, s):
        P, env = self.P, self.env
        t0 = env.now
        cv = P("service_time_cv")
        sig = math.sqrt(math.log(1 + cv * cv))
        z = statistics.NormalDist().inv_cdf(min(max(hu(s["key"], "svc"), 1e-6), 1 - 1e-6))
        noise = math.exp(sig * z - sig * sig / 2)
        codes = list(s["basket"]) + ["offrange"] * s["offrange"]
        skipped = []
        if s["theft"] == "sco_skip_scan":
            skipped = [c for c in s["basket"] if hu(s["key"], "skip", c) < self.theft["skip_scan_item_share"]]
            s["skipped_scan"] = skipped
        n = len(codes)
        if lane["type"] == "staffed":
            per, start = P("staffed_per_item_s") * noise, 0.0
            pay = P("staffed_payment_card_s")
            fixed = P("staffed_fixed_s") * noise
            weigh, age = P("produce_weigh_s_staffed") * s["loose"], P("age_check_delay_s_staffed") * int(s["age"])
            body = fixed + per * n + weigh + age
            att_need = 0.0
        else:
            per, start = P("sco_per_item_s") * noise, P("sco_initiation_s")
            pay = P("sco_payment_card_s")
            weigh = P("produce_weigh_s_sco") * s["loose"]
            body = start + per * n + pay + P("sco_deactivation_s") + weigh
            interv = hu(s["key"], "interv") < P("sco_intervention_prob")
            att_need = P("sco_intervention_resolution_s") * interv + P("age_check_delay_s_sco") * int(s["age"])
        th = {"unload": round(t0, 1), "scans": [], "skipped": []}
        tt = t0 + start
        skip_left = list(skipped)
        for c in codes:
            if c in skip_left:
                skip_left.remove(c)
                th["skipped"].append(c)
                continue
            tt += per
            th["scans"].append(round(tt, 1))  # i-th scan = i-th scanned item of basket (+ 'offrange' items last)
        yield body
        if att_need > 0:
            t_req = env.now
            yield self.attendants[lane["bank"]].request()
            s["attendant_wait_s"] = round(env.now - t_req, 1)
            yield att_need
            self.attendants[lane["bank"]].release()
            self.c["sco_interventions"] += 1
        th["bag"] = round(env.now - pay * 0.5, 1)
        th["pay"] = round(env.now - pay * 0.25, 1)
        th["done"] = round(env.now, 1)
        s["theatre"] = th
        s["t_end"] = env.now
        s["service_s"] = round(env.now - t0, 1)
        lane["busy_s"] += env.now - t0
        lane["served"] += 1
        self.revenue = getattr(self, "revenue", 0.0) + sum(self.price[c] for c in s["basket"] if c not in skipped)
        self.offrange_rev = getattr(self, "offrange_rev", 0.0) + s["offrange"] * self.offrange_price
        s["_done"].fire("paid")
        self.start_next(lane)

    # ---------------------------------------------------------------- staff
    def move(self, st, to, dur, task):
        x0, z0 = self.pos_of(st)
        st["leg"] = (x0, z0, to[0], to[1], self.env.now, self.env.now + dur)
        st["x"], st["z"] = to
        st["task"] = task

    def pos_of(self, st, t=None):
        x0, z0, x1, z1, t0, t1 = st["leg"]
        t = self.env.now if t is None else t
        if t >= t1 or t1 <= t0:
            return (x1, z1)
        f = max(0.0, (t - t0) / (t1 - t0))
        return (x0 + (x1 - x0) * f, z0 + (z1 - z0) * f)

    def walk_to(self, st, to, task):
        d = self.geo.dist((st["x"], st["z"], st.get("w")), to)
        dur = d / self.staff_walk
        self.move(st, (to[0], to[1]), dur, task)
        st["w"] = to[2] if len(to) == 3 else None
        return dur

    def open_now(self):
        tod = self.env.now % DAY_S
        return self.open_h * 3600 <= tod < self.close_h * 3600

    def restocker(self, st):
        P, env = self.P, self.env
        case_units, cph = P("restock_case_units"), P("restock_cases_per_hour")
        while True:
            if not self.open_now():
                yield 60
                continue
            if self.queries:
                q = self.queries.popleft()
                t0 = env.now
                yield self.walk_to(st, q["pos"], "customer_query")
                st["task"] = "customer_query"
                yield P("oos_staff_query_min") * 60
                st["busy_s"] += env.now - t0
                self.c["queries_answered"] += 1
                continue
            c, bay_rule = self.next_restock()
            if c is None:
                if st["task"] != "idle":
                    self.move(st, (st["x"], st["z"]), 0, "idle")
                yield 30
                continue
            t0 = env.now
            self.inprogress.add(c)
            need = self.cap[c] - self.shelf[c]
            take = min(need, self.backroom[c])
            self.backroom[c] -= take
            yield self.walk_to(st, (self.door[0], self.door[1], None), f"fetch {c}")
            uid = self.slot_of[c].rsplit("-r", 1)[0]
            yield self.walk_to(st, self.geo.upos[uid], f"to {self.slot_of[c]}")
            # work the bay: other SKUs on the same unit below restock_batch_fill_below come along in the cage
            batch = {c: take}
            for _r, sl in self.unit_slots[uid]:
                for x in self.slot_products[sl]:
                    if x not in batch and x not in self.inprogress and self.backroom[x] > 0 and \
                            self.shelf[x] < self.cap[x] and (self.shelf[x] < P("restock_batch_fill_below") * self.cap[x]
                                                             or (bay_rule is not None and bay_rule(x))):
                        tk = min(self.cap[x] - self.shelf[x], self.backroom[x])
                        self.backroom[x] -= tk
                        self.inprogress.add(x)
                        batch[x] = tk
            put_total = 0
            for x, tk in batch.items():
                st["task"] = f"restock {self.slot_of[x]}:{x}"
                cases = math.ceil(tk / case_units) if tk else 0
                yield cases * 3600.0 / cph
                put = min(tk, self.cap[x] - self.shelf[x])  # never over-fill; surplus goes back to the back room
                self.set_shelf(x, self.shelf[x] + put, env.now)
                self.backroom[x] += tk - put
                self.inprogress.discard(x)
                put_total += put
                self.c["units_restocked"] += put
                self.c["sku_refills"] += 1
            dur = env.now - t0
            st["busy_s"] += dur
            self.task_s.append(dur)
            self.c["restock_tasks"] += 1
            self.ev(env.now, "restocked", staff=st["id"], unit=uid, lead=c, skus=len(batch), units=put_total,
                    task_s=round(dur))

    def next_restock(self):
        """Return (lead SKU, extra bay-inclusion rule or None).
        fifo         : the SKU that crossed the restock trigger first (baseline)
        priority     : spec-literal SKU score = P(stock-out before next round) x demand/h x price x margin proxy
        priority_bay : bay (unit) score = sum over its SKUs of expected lost margin before the next round,
                       E[(D - s)+] x price x margin, divided by the labour seconds of the trip (walk + cases)"""
        P = self.P
        trig = P("restock_trigger_fill")
        cands = [c for c in self.cap if c not in self.inprogress and self.backroom[c] > 0 and self.shelf[c] < self.cap[c]]
        if self.restock_policy == "fifo":
            due = [(self.trigger_t[c], c) for c in cands if c in self.trigger_t]
            return (min(due)[1] if due else None), None
        dow = self.dows[min(int(self.env.now // DAY_S), self.days - 1)]
        hr = int((self.env.now % DAY_S) // 3600)
        mean_task = (sum(self.task_s[-50:]) / len(self.task_s[-50:])) if self.task_s else 300.0
        mg = P("margin_proxy_by_role")
        nR = max(1, self.staff_n["restock"])
        if self.restock_policy == "priority":
            n_due = sum(1 for c in cands if self.shelf[c] <= trig * self.cap[c])
            T = max(300.0, n_due / nR * mean_task)
            thr = P("restock_smart_pso_threshold")
            best, bs = None, -1.0
            for c in cands:
                lam = self.rate_per_s(c, dow, hr)
                pso = poisson_sf(self.shelf[c], lam * T)
                if not (self.shelf[c] <= trig * self.cap[c] or pso > thr):
                    continue
                score = pso * lam * 3600 * self.price[c] * mg.get(self.catalog[c].get("role"), 0.3)
                if score > bs or (score == bs and best is not None and c < best):
                    best, bs = c, score
            return best, None
        # priority_bay
        bays_due = {self.slot_of[c].rsplit("-r", 1)[0] for c in cands if self.shelf[c] <= trig * self.cap[c]}
        T = min(3600.0, max(300.0, len(bays_due) / nR * mean_task))
        cph, cu = P("restock_cases_per_hour"), P("restock_case_units")
        by_unit = collections.defaultdict(list)
        for c in cands:
            by_unit[self.slot_of[c].rsplit("-r", 1)[0]].append(c)
        short = {}
        best, bs = None, 0.0
        for uid, cs in by_unit.items():
            val, lab, lead, lv = 0.0, 2 * self.geo.dist((self.door[0], self.door[1], None), self.geo.upos[uid]) / self.staff_walk, None, -1
            for c in cs:
                es = exp_shortfall(self.shelf[c], self.rate_per_s(c, dow, hr) * T)
                short[c] = es
                if not (es > 0.5 or self.shelf[c] <= trig * self.cap[c]):
                    continue
                v = es * self.price[c] * mg.get(self.catalog[c].get("role"), 0.3)
                val += v
                lab += math.ceil(min(self.cap[c] - self.shelf[c], self.backroom[c]) / cu) * 3600.0 / cph
                if v > lv:
                    lead, lv = c, v
            if lead is None or val <= 0:
                continue
            sc = val / lab
            if sc > bs:
                best, bs = lead, sc
        return best, (lambda x: short.get(x, 0.0) > 0.5)

    def cleaner(self, st):
        P, env = self.P, self.env
        while True:
            if not self.spill_q:
                yield 15
                continue
            sp = self.spill_q.popleft()
            t0 = env.now
            yield self.walk_to(st, sp["pos"], f"to spill {sp['id']}")
            sp["t_arrive"] = env.now
            sp["response_s"] = round(env.now - sp["t"], 1)
            st["task"] = f"clean {sp['id']}"
            yield P("spill_clean_and_dry_min") * 60
            sp["t_clear"] = env.now
            self.blocked[sp["seg"]] -= 1
            st["busy_s"] += env.now - t0
            self.ev(env.now, "spill_cleared", id=sp["id"], seg=sp["seg"], response_s=sp["response_s"],
                    blocked_s=round(env.now - sp["t"], 1), staff=st["id"])
            self.move(st, (st["x"], st["z"]), 0, "idle")

    def new_spill(self, t, uid, seg, up, s, bumped):
        sid = f"sp{len(self.spills)+1}"
        dropped = s["basket"].pop() if s["basket"] else None
        sp = {"id": sid, "t": t, "unit": uid, "seg": seg, "pos": up, "x": up[0], "z": up[1], "shopper": s["id"],
              "after_bump": bumped, "dropped": dropped}
        self.spills[sid] = sp
        self.blocked[seg] += 1
        self.spill_q.append(sp)
        if dropped:
            self.waste = getattr(self, "waste", 0.0) + self.price[dropped]
        self.ev(t, "spill", id=sid, seg=seg, unit=uid, x=up[0], z=up[1], after_bump=bumped, dropped=dropped)

    def manager(self):
        P, env = self.P, self.env
        z, sl = P("service_level_z"), P("lead_time_sd_days")
        case = P("restock_case_units")
        rev_days = P("order_review_period_days")
        while True:
            if self.open_now():
                d = int(env.now // DAY_S)
                dow = self.dows[min(d, self.days - 1)]
                hr = int((env.now % DAY_S) // 3600)
                n_orders = 0
                for c in self.cap:
                    ED = self.daily_forecast(c, dow)
                    chilled = self.catalog[c].get("category") in CHILLED_CATS
                    L = P("lead_time_days_chilled") if chilled else P("lead_time_days_ambient")
                    SS = z * math.sqrt(L * ED + ED * ED * sl * sl)   # sigma_D^2 = E(D) (Poisson demand, assumption)
                    ROP = L * ED + SS
                    IP = self.shelf[c] + self.backroom[c] + self.on_order[c]
                    rest = sum(self.rate_per_s(c, dow, h) * 3600 for h in range(hr + 1, self.close_h))
                    if self.shelf[c] + self.backroom[c] < rest and (d, c) not in self.alerted:
                        self.alerted.add((d, c))
                        self.c["going_out_alerts"] += 1
                        self.ev(env.now, "going_out_alert", code=c, slot=self.slot_of[c],
                                on_hand=self.shelf[c] + self.backroom[c], forecast_rest_of_day=round(rest, 1))
                    if IP <= ROP:
                        Q = math.ceil(max(case, ROP + ED * rev_days - IP) / case) * case
                        u = hu("lead", self.seed, c, round(env.now))
                        Ls = max(1, int(round(L + sl * statistics.NormalDist().inv_cdf(min(max(u, 1e-6), 1 - 1e-6)))))
                        arrive = (d + Ls) * DAY_S + P("delivery_hour") * 3600
                        self.on_order[c] += Q
                        self.orders.append({"t": round(env.now, 1), "code": c, "qty": Q, "ROP": round(ROP, 1),
                                            "IP": IP, "E_D_per_day": round(ED, 2), "SS": round(SS, 2),
                                            "lead_days": Ls, "arrives": arrive, "chilled": chilled})
                        env.at(arrive, lambda c=c, Q=Q: self.deliver(c, Q))
                        n_orders += 1
                if n_orders:
                    self.ev(env.now, "orders", n=n_orders)
            yield P("manager_review_min") * 60

    def deliver(self, c, Q):
        self.on_order[c] -= Q
        self.backroom[c] += Q
        self.c["deliveries"] += 1
        self.c["units_delivered"] += Q

    def night_fill(self, d):
        if not self.P("night_fill"):
            return
        moved = 0
        for c in self.cap:
            put = min(self.cap[c] - self.shelf[c], self.backroom[c])
            if put > 0:
                self.backroom[c] -= put
                self.set_shelf(c, self.shelf[c] + put, self.env.now)
                moved += put
        self.c["night_fill_units"] += moved
        self.ev(self.env.now, "night_fill", units=moved)

    # ---------------------------------------------------------------- timeline
    def snapshot(self):
        env = self.env
        t = env.now
        fills = {}
        for sid, prods in self.slot_products.items():
            cap = sum(self.cap[c] for c in prods)
            fills[sid] = round(sum(self.shelf[c] for c in prods) / cap, 3) if cap else 0
        fr = {"t": round(t), "day": int(t // DAY_S), "clock": f"{int((t % DAY_S)//3600):02d}:{int((t % 3600)//60):02d}",
              "inside": len(self.inside), "seg": {k: v for k, v in self.occ.items() if v > 0},
              "q": {l["id"]: len(l["queue"]) + (1 if l["cur"] else 0) for l in self.lanes},
              "fill": [fills[k] for k in self.slot_order],
              "empty": [i for i, c in enumerate(self.prod_order) if self.shelf[c] <= 0],
              "staff": [{"id": s["id"], "role": s["role"], "x": round(self.pos_of(s)[0], 2),
                         "z": round(self.pos_of(s)[1], 2), "task": s["task"]} for s in self.staff],
              "spills": [k for k, v in self.spills.items() if "t_clear" not in v and v["t"] <= t],
              "cafe": self.cafe_seats.users, "orders_total": len(self.orders),
              "backroom_units": sum(self.backroom.values())}
        self.frames.append(fr)

    def ticker(self, d):
        step = 60 * self.compress
        t_open = d * DAY_S + self.open_h * 3600
        t_close = d * DAY_S + self.close_h * 3600
        while self.env.now < t_close or self.inside:
            if self.env.now >= t_open:
                self.snapshot()
            yield step
            if self.env.now > t_close + 3 * 3600:
                break

    # ---------------------------------------------------------------- run
    def run(self):
        t_wall = time.time()
        self.setup()
        env = self.env
        self.orders, self.frames, self.task_s, self.incidents = [], [], [], []
        # staff
        door = self.door
        for i in range(self.staff_n["restock"]):
            self.staff.append({"id": f"R{i+1}", "role": "restock", "x": door[0], "z": door[1], "task": "idle",
                               "leg": (door[0], door[1], door[0], door[1], 0, 0), "busy_s": 0.0})
        for i in range(self.staff_n["clean"]):
            self.staff.append({"id": f"C{i+1}", "role": "clean", "x": door[0], "z": door[1], "task": "idle",
                               "leg": (door[0], door[1], door[0], door[1], 0, 0), "busy_s": 0.0})
        gp = self.theft["guard_post"]
        for i in range(self.staff_n["guard"]):
            self.staff.append({"id": f"G{i+1}", "role": "guard", "x": gp["x"], "z": gp["z"], "task": "idle",
                               "leg": (gp["x"], gp["z"], gp["x"], gp["z"], 0, 0), "busy_s": 0.0})
        for st in self.staff:
            if st["role"] == "restock":
                env.process(self.restocker(st))
            elif st["role"] == "clean":
                env.process(self.cleaner(st))
        self.day_spawn = []
        for d in range(self.days):
            sh = self.spawn_day(d)
            # pre-ask Jev for every combo the planned baskets need, in parallel (planned items = min(wanted, cap) + off-range)
            combos = sorted({(s["persona"], s["mission"], self.bucket(s["planned_items"]), s["loose"] > 0, bool(s["age"]))
                             for s in sh})
            self.resolve_jev(combos)
            self.day_spawn.append(sh)
        env.at(0, lambda: env.process(self.manager()))
        for d in range(self.days):
            env.at(d * DAY_S + (self.open_h - 1) * 3600, lambda d=d: self.night_fill(d))
            env.at(d * DAY_S + self.open_h * 3600, lambda d=d: env.process(self.ticker(d)))
            for s in self.day_spawn[d]:
                env.at(s["t_arrive"], lambda s=s: self._start_shopper(s))
        end = (self.days - 1) * DAY_S + (self.close_h + 3) * 3600
        env.run(end)
        for c, t0 in list(self.zero_since.items()):  # close open stock-out intervals at the end of trading
            self.oos_seconds[c] += max(0.0, min(env.now, (self.days - 1) * DAY_S + self.close_h * 3600) - t0)
        self.wall_s = time.time() - t_wall
        return self

    def _start_shopper(self, s):
        self.shoppers.append(s)
        self.env.process(self.shopper(s))

    # ---------------------------------------------------------------- KPIs
    def kpis(self):
        P = self.P
        sh = self.shoppers
        paid = [s for s in sh if s.get("outcome") == "paid"]
        queued = [s for s in sh if "t_join" in s]
        waits = [s["wait_s"] for s in paid]
        ab = [s for s in sh if s.get("outcome") == "abandoned"]
        open_s = (self.close_h - self.open_h) * 3600 * self.days
        lanes = {l["id"]: {"type": l["type"], "served": l["served"], "utilisation": round(l["busy_s"] / open_s, 3)}
                 for l in self.lanes}
        by_type = collections.defaultdict(list)
        for s in paid:
            by_type[s["lane_type"]].append(s)
        sku_open_s = open_s * len(self.cap)
        oos_s = sum(self.oos_seconds.values())
        hit = [s for s in sh if s.get("oos")]
        by_day_frames = collections.defaultdict(list)
        for f in self.frames:
            if self.open_h * 3600 <= f["t"] % DAY_S < self.close_h * 3600:
                by_day_frames[f["day"]].append(f)
        oos_by_day = collections.Counter(int(o["t"] // DAY_S) for s in sh for o in s.get("oos", []))
        lost = 0.0
        recovered = 0.0
        react = collections.Counter()
        for s in sh:
            for o in s.get("oos", []):
                react[o["reaction"]] += 1
                if o.get("sub"):
                    recovered += o.get("recovered_gbp", 0)
                    lost += max(0.0, o["price"] - o.get("recovered_gbp", 0))
                else:
                    lost += o["price"]
        ab_val = sum(sum(self.price[c] for c in s["basket"]) + s["offrange"] * self.offrange_price for s in ab)
        spills = list(self.spills.values())
        resp = [sp["response_s"] for sp in spills if "response_s" in sp]
        blk = [sp["t_clear"] - sp["t"] for sp in spills if "t_clear" in sp]
        st = {r: [x for x in self.staff if x["role"] == r] for r in ("restock", "clean", "guard")}
        util = {r: round(sum(x["busy_s"] for x in v) / (open_s * max(1, len(v))), 3) for r, v in st.items()}
        cafe_occ = collections.defaultdict(list)
        for f in self.frames:
            cafe_occ[f["clock"][:2]].append(f["cafe"])
        inc = self.incidents
        alarms = [i for i in inc if i["alarm"]]
        hours = (self.close_h - self.open_h) * self.days
        K = {
            "shoppers": {"value": len(sh), "trace": "arrivals: Poisson per minute, rate = store_customers_per_week x shopping_trips_by_day_share[dow] x weekday_shopping_trip_start_share_by_hour[h - lag]/60",
                         "params": ["store_customers_per_week", "shopping_trips_by_day_share", "weekday_shopping_trip_start_share_by_hour", "trip_start_to_arrival_lag_min"]},
            "missions": dict(collections.Counter(s["mission"] for s in sh)),
            "checkout": {
                "routing": self.routing,
                "served": len(paid), "abandoned": len(ab), "abandon_rate": round(len(ab) / max(1, len(queued)), 4),
                "abandon_rate_ci95": wilson(len(ab), len(queued)),
                "abandoned_basket_value_gbp": round(ab_val, 2),
                "mean_wait_s": round(statistics.mean(waits), 1) if waits else None,
                "p90_wait_s": round(pct(waits, 0.9), 1) if waits else None,
                "max_wait_s": round(max(waits), 1) if waits else None,
                "mean_time_in_checkout_s": round(statistics.mean([s["t_end"] - s["t_join"] for s in paid]), 1) if paid else None,
                "throughput_per_open_hour": round(len(paid) / hours, 1),
                "peak_hour_throughput": max(collections.Counter(int((s["t_end"] % DAY_S) // 3600) for s in paid).values()) if paid else 0,
                "share_self_checkout": round(len(by_type["self"]) / max(1, len(paid)), 3),
                "accepts_sco_share": round(sum(1 for s in queued if s.get("accepts_sco")) / max(1, len(queued)), 3),
                "by_lane_type": {t: {"n": len(v), "mean_items": round(statistics.mean([s["items_n"] for s in v]), 1),
                                     "mean_service_s": round(statistics.mean([s["service_s"] for s in v]), 1),
                                     "mean_wait_s": round(statistics.mean([s["wait_s"] for s in v]), 1)} for t, v in by_type.items()},
                "lanes": lanes, "sco_interventions": self.c["sco_interventions"],
                "trace": "wait = service start - queue join (served shoppers); abandon = still queued after patience (exponential, patience_min by mission); service = service_time_formula x lognormal(service_time_cv); SCO interventions hold a bank attendant (ceil(terminals/sco_terminals_per_attendant))",
                "params": ["service_time_formula", "staffed_fixed_s", "staffed_per_item_s", "sco_initiation_s", "sco_per_item_s",
                           "sco_payment_card_s", "sco_deactivation_s", "sco_intervention_prob", "sco_intervention_resolution_s",
                           "produce_weigh_s_staffed", "produce_weigh_s_sco", "age_check_delay_s_sco", "age_check_delay_s_staffed",
                           "sco_terminals_per_attendant", "patience_min", "patience_gamma_shape", "service_time_cv", "basket_items_by_mission",
                           "in_range_share_of_basket", "loose_produce_share_of_offrange", "age_restricted_basket_prob"]},
            "stock": {
                "restock_policy": self.restock_policy,
                "oos_events": self.c["oos_events"], "oos_reactions": dict(react),
                "shoppers_hit_oos_share": round(len(hit) / max(1, len(sh)), 4),
                "shoppers_hit_oos_benchmark": {"value": P("shoppers_encountering_oos"), "source": "params.json shoppers_encountering_oos (Gruen & Corsten 2008)"},
                "sku_minutes_oos_share": round(oos_s / sku_open_s, 4),
                "sku_oos_share_by_day": {self.dows[d]: round(statistics.mean(len(f["empty"]) / len(self.cap) for f in fr), 4)
                                         for d, fr in sorted(by_day_frames.items())},
                "oos_events_by_day": {self.dows[d]: n for d, n in sorted(oos_by_day.items())},
                "oos_cause": {"shelf_restocking (back room had stock)": self.c["oos_cause_shelf_restocking"],
                              "store_ordering (back room empty)": self.c["oos_cause_store_ordering"],
                              "benchmark": {"value": P("oos_root_cause"), "source": "params.json oos_root_cause (Gruen & Corsten 2008); upstream supply failures are not modelled"}},
                "sku_oos_benchmark": {"value": P("oos_rate"), "source": "params.json oos_rate (Gruen et al. 2002)"},
                "skus_ever_empty": sum(1 for c in self.cap if self.oos_seconds[c] > 0),
                "lost_sales_gbp": round(lost, 2), "substitution_recovered_gbp": round(recovered, 2),
                "restock_tasks": self.c["restock_tasks"], "units_restocked": self.c["units_restocked"],
                "night_fill_units": self.c["night_fill_units"],
                "staff_queries": self.c["staff_queries"], "queries_answered": self.c["queries_answered"],
                "restocker_utilisation": util["restock"],
                "mean_restock_task_s": round(statistics.mean(self.task_s), 1) if self.task_s else None,
                "backroom_units_end": sum(self.backroom.values()),
                "trace": "OOS event = shopper wants (noticed x P(take)) a SKU whose shelf is 0 -> Gruen reaction drawn; lost £ = price unless substituted (difference counted); SKU-minutes OOS = time each SKU's shelf sat at 0 during trading",
                "params": ["oos_reaction", "oos_staff_query_prob", "oos_staff_query_min", "restock_trigger_fill", "restock_cases_per_hour",
                           "restock_case_units", "restock_smart_pso_threshold", "margin_proxy_by_role", "backroom_cover_days", "night_fill"]},
            "manager": {
                "orders": len(self.orders), "units_ordered": sum(o["qty"] for o in self.orders),
                "deliveries_received": self.c["deliveries"], "units_delivered": self.c["units_delivered"],
                "going_out_alerts": self.c["going_out_alerts"],
                "trace": "hourly review; ROP = L*E(D) + z*sqrt(L*E(D) + E(D)^2*sigma_L^2) (sigma_D^2 = E(D), Poisson); order up to ROP + E(D)*review when IP <= ROP; delivery at delivery_hour on day + round(L + N(0, sigma_L))",
                "params": ["reorder_point_formula", "service_level_z", "lead_time_days_chilled", "lead_time_days_ambient", "lead_time_sd_days",
                           "order_review_period_days", "delivery_hour", "manager_review_min", "forecast_shoppers_per_mission"]},
            "spills": {
                "spills": len(spills), "after_collision": sum(1 for s in spills if s["after_bump"]),
                "collisions": self.c["collisions"],
                "mean_response_s": round(statistics.mean(resp), 1) if resp else None,
                "p90_response_s": round(pct(resp, 0.9), 1) if resp else None,
                "within_target_share": round(sum(1 for r in resp if r <= P("cleaner_response_target_min") * 60) / len(resp), 3) if resp else None,
                "mean_aisle_blocked_s": round(statistics.mean(blk), 1) if blk else None,
                "shopper_detours": self.c["spill_detours"], "skipped_unit_visits": self.c["spill_skipped_unit_visits"],
                "dropped_item_waste_gbp": round(getattr(self, "waste", 0.0), 2),
                "cleaner_utilisation": util["clean"],
                "trace": "per unit visit P(spill) = spill_rate/1000/route_units x (multiplier if bumped); P(bump) = 1-exp(-k x others in walkway)",
                "params": ["spill_rate_per_1000_shoppers", "spill_prob_multiplier_on_collision", "bump_k_per_other", "cleaner_response_target_min",
                           "spill_clean_and_dry_min", "spill_detour_m", "slips_share_major_injuries"]},
            "cafe": {
                "visits": self.c["cafe_visits"], "turnaway": self.c["cafe_turnaway"],
                "revenue_gbp": round(getattr(self, "cafe_rev", 0.0), 2),
                "mean_occupancy_by_hour": {h: round(statistics.mean(v), 1) for h, v in sorted(cafe_occ.items())},
                "seats": self.cafe["seats"], "params": ["cafe"]},
            "security": {
                "theft_attempts": len(inc), "alarms": len(alarms),
                "detection_rate": round(len(alarms) / len(inc), 3) if inc else None,
                "recovered": sum(1 for i in inc if i.get("recovered")),
                "shrink_gbp": round(getattr(self, "shrink", 0.0), 2),
                "incidents_per_open_hour": round(len(inc) / hours, 3),
                "guard_utilisation": util["guard"],
                "incidents": inc, "params": ["theft"]},
            "revenue": {"shelf_items_gbp": round(getattr(self, "revenue", 0.0), 2),
                        "offrange_items_gbp_estimate": round(getattr(self, "offrange_rev", 0.0), 2),
                        "cafe_gbp": round(getattr(self, "cafe_rev", 0.0), 2)},
        }
        return K

    def output(self, out_id):
        K = self.kpis()
        P = self.P
        shoppers = []
        for s in self.shoppers:
            shoppers.append({k: (round(v, 1) if isinstance(v, float) else v) for k, v in s.items()
                             if k not in ("_done", "desires", "key", "route", "secs", "planned_items")})
        jt = {"|".join(map(str, k)): v for k, v in self.shared["jev_table"].items()}
        geo = self.geo
        return {
            "id": out_id, "created": dt.datetime.now().isoformat(timespec="seconds"),
            "engine": {"des": "heapq event loop (sim/ops.py; simpy not installed)", "judgments": "TypeSafe Jev (sim/jev.py ask), self-checkout acceptance only",
                       "arithmetic": "code"},
            "cli": {"seed": self.seed, "days": self.days, "dows": self.dows, "routing": self.routing, "restock": self.restock_policy,
                    "staff": self.staff_n, "compress": self.compress, "hours": [self.open_h, self.close_h], "jev": self.use_jev},
            "inputs": {"store": self.paths, "fallback_small_store": self.fallback, "personas": self.persona_src,
                       "params": [os.path.relpath(PARAMS_PATH, ROOT), os.path.relpath(EXTRA_PATH, ROOT)]},
            "kpis": K,
            "surrogate": self.sur.summary(),
            "jev": {**self.shared["jev_meta"], "question": JEV_SCO_Q, "table": jt,
                    "price": "TypeSafe $0.042 per 1M input tokens, output free (sim/jev.py PRICE_SOURCE)"},
            "params_used": P.used,
            "geometry": {"units": {u: {"x": p[0], "z": p[1], "walkway": p[2]} for u, p in geo.upos.items()},
                         "front_cross_z": geo.zf, "back_cross_z": geo.zb, "segments": geo.segments,
                         "lanes": [{k: l[k] for k in ("id", "type", "bank", "x", "z")} for l in self.lanes],
                         "entrances": self.entrances, "stockroom_door": self.door, "cafe": {k: self.cafe[k] for k in ("counter", "seats_centre", "seats")},
                         "source": GEOM["source"]},
            "timeline": {"frame_s": 60 * self.compress, "n": len(self.frames),
                         "fill_slot_order": self.slot_order, "empty_product_order": self.prod_order,
                         "frame_doc": "seg = shoppers per aisle segment (W<n> walkway, FRONT/BACK cross-aisles, TILLS, CAFE); q = people at each lane incl. in service; fill[i] = shelf units / capacity of slot fill_slot_order[i]; empty = indices into empty_product_order with shelf 0; staff = position + task; spills = active spill ids",
                         "frames": self.frames},
            "events": self.events,
            "orders": self.orders,
            "spills": [{k: (round(v, 1) if isinstance(v, float) else v) for k, v in sp.items() if k != "pos"} for sp in self.spills.values()],
            "shoppers": shoppers,
            "wall_s": round(self.wall_s, 1),
        }


# ================================================================ comparison + report
def summary_row(K):
    c, s, sp = K["checkout"], K["stock"], K["spills"]
    return {"mean_wait_s": c["mean_wait_s"], "p90_wait_s": c["p90_wait_s"], "abandon_rate": c["abandon_rate"],
            "abandoned": c["abandoned"], "served": c["served"], "throughput_per_open_hour": c["throughput_per_open_hour"],
            "share_self_checkout": c["share_self_checkout"], "oos_events": s["oos_events"],
            "sku_minutes_oos_share": s["sku_minutes_oos_share"], "shoppers_hit_oos_share": s["shoppers_hit_oos_share"],
            "lost_sales_gbp": s["lost_sales_gbp"], "restock_tasks": s["restock_tasks"],
            "restocker_utilisation": s["restocker_utilisation"], "orders": K["manager"]["orders"],
            "spills": sp["spills"], "mean_spill_response_s": sp["mean_response_s"]}


def paired(a, b):
    """Mean paired difference b - a with a t-based 95% CI (n seeds)."""
    d = [y - x for x, y in zip(a, b) if x is not None and y is not None]
    if not d:
        return None
    m = statistics.mean(d)
    if len(d) < 2:
        return {"mean": round(m, 4), "ci95": None, "n": len(d)}
    se = statistics.stdev(d) / math.sqrt(len(d))
    tq = {2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 9: 2.306, 10: 2.262}.get(len(d), 2.0)
    return {"mean": round(m, 4), "ci95": [round(m - tq * se, 4), round(m + tq * se, 4)], "n": len(d)}


def write_results(arms, seeds, args, rows, jev_meta, files, staff):
    def g(arm, k):
        return [rows[(arm, s)][k] for s in seeds]

    def mean(arm, k):
        v = [x for x in g(arm, k) if x is not None]
        return round(statistics.mean(v), 3) if v else None

    def verdict(dd, lower_is_better=True, unit=""):
        if dd is None or dd["ci95"] is None:
            return "not enough seeds for a CI"
        lo, hi = dd["ci95"]
        if hi < 0:
            return "better" if lower_is_better else "worse"
        if lo > 0:
            return "worse" if lower_is_better else "better"
        return "no clear difference (CI spans 0)"

    L = []
    L.append("# store ops: results (sim/ops.py)\n")
    L.append(f"*Generated {dt.datetime.now().isoformat(timespec='minutes')} by `python3 sim/ops.py {' '.join(sys.argv[1:])}`. "
             f"Seeds {seeds} (common random numbers: every arm sees the same shoppers, baskets, service-time noise and draws), "
             f"{args.days} trading day(s) from {args.day} {args.hours or '08-22'}, staff {staff}. Day files: {', '.join('`'+f+'`' for f in files)}.*\n")
    L.append("Every number below comes out of the event log of a run. Parameters and their sources are in each day file's "
             "`params_used` (`data/ops/params.json` + `data/sim/ops/params_extra.json`). Low-confidence parameters are labelled assumptions there.\n")
    names = {"A": "smart routing + priority restock", "B": "JSQ routing (baseline) + priority restock",
             "C": "smart routing + FIFO restock (baseline)", "D": "nearest-lane routing + priority restock"}
    L.append("## arms (mean over seeds)\n")
    keys = ["mean_wait_s", "p90_wait_s", "abandon_rate", "served", "throughput_per_open_hour", "share_self_checkout",
            "oos_events", "sku_minutes_oos_share", "shoppers_hit_oos_share", "lost_sales_gbp", "restock_tasks",
            "restocker_utilisation", "orders", "spills", "mean_spill_response_s"]
    L.append("| KPI | " + " | ".join(f"{a}: {names[a]}" for a in arms) + " |")
    L.append("|---|" + "---|" * len(arms))
    for k in keys:
        L.append(f"| {k} | " + " | ".join(str(mean(a, k)) for a in arms) + " |")
    L.append("")
    out = {}
    L.append("## 1. does smart checkout routing help? (A vs B, and A vs D)\n")
    for other in [x for x in ("B", "D") if x in arms]:
        L.append(f"**A vs {other} ({names[other]})**, paired over seeds, difference = A - {other}:\n")
        for k, lib in (("mean_wait_s", True), ("p90_wait_s", True), ("abandon_rate", True), ("throughput_per_open_hour", False)):
            dd = paired(g(other, k), g("A", k))
            out[f"A-{other}:{k}"] = dd
            L.append(f"- {k}: {other} {mean(other, k)} -> A {mean('A', k)}; diff {dd['mean'] if dd else None}, "
                     f"95% CI {dd['ci95'] if dd else None} -> **{verdict(dd, lib)}**")
        L.append("")
    L.append("## 2. does priority restocking help? (A vs C)\n")
    for k, lib in (("oos_events", True), ("sku_minutes_oos_share", True), ("shoppers_hit_oos_share", True),
                   ("lost_sales_gbp", True), ("restock_tasks", True)):
        dd = paired(g("C", k), g("A", k))
        out[f"A-C:{k}"] = dd
        L.append(f"- {k}: FIFO {mean('C', k)} -> priority {mean('A', k)}; diff {dd['mean'] if dd else None}, "
                 f"95% CI {dd['ci95'] if dd else None} -> **{verdict(dd, lib)}**")
    L.append("")
    return L, out


def run_one(args, routing, restock, seed, shared, write=True, tag=""):
    staff = dict(kv.split("=") for kv in args.staff.split(",")) if args.staff else {}
    staff = {k: int(v) for k, v in staff.items()}
    hours = [int(x) for x in args.hours.split("-")] if args.hours else None
    sim = OpsSim(seed=seed, days=args.days, dow=args.day, routing=routing, restock=restock, staff=staff,
                 compress=args.compress, use_jev=not args.no_jev, jev_max_calls=args.jev_max_calls, hours=hours,
                 verbose=False, shared=shared)
    sim.run()
    out_id = f"{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}_s{seed}_{routing}_{restock}{tag}"
    o = sim.output(out_id)
    path = None
    if write:
        os.makedirs(OUT_DIR, exist_ok=True)
        path = os.path.join(OUT_DIR, f"day_{out_id}.json")
        with open(path, "w") as f:
            json.dump(o, f, separators=(",", ":"), ensure_ascii=False)
    return sim, o, path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--day", nargs="?", const="Sat", default="Sat", help="day of week to simulate (default Sat, the busiest)")
    ap.add_argument("--days", type=int, default=1, help="consecutive trading days (manager orders land on day 2+)")
    ap.add_argument("--hours", default=None, help="e.g. 15-17 to simulate only a window (default params open_hours)")
    ap.add_argument("--compress", type=int, default=1, help="timeline frame every N minutes (physics unchanged)")
    ap.add_argument("--staff", default="restock=4,clean=2,guard=1")
    ap.add_argument("--routing", choices=["smart", "smart_wait", "jsq", "nearest", "baseline"], default="smart")
    ap.add_argument("--restock", choices=["priority_bay", "priority", "fifo"], default="priority_bay")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--compare", action="store_true", help="run arms A-D over --seeds and write RESULTS.md")
    ap.add_argument("--seeds", default="1,2,3")
    ap.add_argument("--no-jev", action="store_true")
    ap.add_argument("--jev-max-calls", type=int, default=400)
    ap.add_argument("--set", action="append", default=[], help="override a param: name=json (sensitivity)")
    args = ap.parse_args()
    if args.routing == "baseline":
        args.routing = "jsq"
    t0 = time.time()
    shared = OpsSim.build_shared(not args.no_jev)
    if not args.compare:
        sim, o, path = run_one(args, args.routing, args.restock, args.seed, shared)
        K = o["kpis"]
        print(json.dumps({"file": os.path.relpath(path, ROOT), "summary": summary_row(K), "jev": {k: v for k, v in o["jev"].items() if k in ("calls", "cached", "cost_usd", "fallback_used")},
                          "wall_s": round(time.time() - t0, 1), "size_mb": round(os.path.getsize(path) / 1e6, 2)}, indent=1))
        return
    seeds = [int(x) for x in args.seeds.split(",")]
    arms = {"A": ("smart", "priority"), "B": ("jsq", "priority"), "C": ("smart", "fifo"), "D": ("nearest", "priority")}
    rows, files, results = {}, [], {}
    for s in seeds:
        for a, (ro, re_) in arms.items():
            write = (s == seeds[0] and a in ("A", "B"))  # day files for the replay: smart vs baseline routing, first seed
            sim, o, path = run_one(args, ro, re_, s, shared, write=write, tag=f"_{a}")
            rows[(a, s)] = summary_row(o["kpis"])
            results[f"{a}|{s}"] = {"arm": a, "seed": s, "routing": ro, "restock": re_, "kpis": o["kpis"] | {"security": {k: v for k, v in o["kpis"]["security"].items() if k != "incidents"}}}
            if path:
                files.append(os.path.relpath(path, ROOT))
            print(f"[{a} seed {s}] {json.dumps(rows[(a, s)])} ({sim.wall_s:.1f}s)", flush=True)
    L, diffs = write_results(list(arms), seeds, args, rows, shared["jev_meta"], files, args.staff)
    jm = shared["jev_meta"]
    tab = shared["jev_table"]
    srcs = collections.Counter(v["source"].split(" (")[0] for v in tab.values())
    L.append("## Jev calls and cost\n")
    L.append(f"- one Noul per (persona, mission, basket-size bucket, needs weighing, age-restricted): {len(tab)} combos; "
             f"{jm['calls']} uncached calls, {jm['cached']} from cache, {jm['fallback_used']} fallbacks, errors {len(jm['errors'])}; "
             f"**${jm['cost_usd']:.4f}** this run (sources: {dict(srcs)}).")
    accs = collections.defaultdict(list)
    for k, v in tab.items():
        accs[k[2]].append(v["p"])
    L.append("- mean P(use self-checkout) by basket bucket: " + ", ".join(f"{b} {statistics.mean(v):.2f} (n={len(v)})" for b, v in accs.items()) + ".")
    L.append("")
    json.dump({"seeds": seeds, "arms": {a: {"routing": r, "restock": q} for a, (r, q) in arms.items()},
               "runs": results, "paired_diffs": diffs, "jev": {k: v for k, v in jm.items()}, "files": files},
              open(os.path.join(OUT_DIR, "RESULTS.json"), "w"), indent=1, default=str)
    with open(os.path.join(OUT_DIR, "RESULTS.auto.md"), "w") as f:
        f.write("\n".join(L) + "\n")
    print("\n".join(L))
    print(f"[done] {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()

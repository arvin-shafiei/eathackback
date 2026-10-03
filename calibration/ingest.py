#!/usr/bin/env python3
"""
The Shelf calibration: turn the form CSV export into per-brand HUMAN shares.

    python calibration/ingest.py responses.csv                       # writes calibration/out/human_shares.json
    python calibration/ingest.py responses.csv --brands brands.txt   # fixes the brand universe (25 Shelf brands)
    python calibration/ingest.py --demo                              # makes a DEMO csv (fake, labelled) and runs on it

Stdlib only. Every statistic in the output carries a `method` / `source` string.

Methods (all cited):
  * Top-1 share + Wilson score 95% CI ............ Wilson (1927) JASA 22(158):209-212, doi:10.1080/01621459.1927.10502953
  * Top-3 rate given tasted + Wilson CI .......... same
  * Bradley-Terry strength from implied pairs .... Bradley & Terry (1952) Biometrika 39:324-345;
                                                   fitted by the MM algorithm of Hunter (2004) Ann. Statist. 32(1):384-406
    Implied pairs: rank1 > rank2 > rank3 > every other brand the voter ticked as tasted.
    (This is the standard "rank-breaking" of a partial ranking into pairwise wins;
     Azari Soufiani, Parkes & Xia 2014, ICML "Computing parametric ranking models via rank-breaking".)
  * BT 95% CI: percentile bootstrap over VOTERS (B=300), Efron & Tibshirani (1993).
  * TIPI scoring: Gosling, Rentfrow & Swann (2003) J. Research in Personality 37:504-528,
    doi:10.1016/S0092-6566(03)00046-1. Reverse-scored items: 2,4,6,8,10.

Column ids: the form puts an id in square brackets in each question title, e.g. "[top1] Your #1 brand".
We read the id from the brackets; if there are none, we fall back to the lower-cased header.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "out"

# ---- shared vocabulary (must match form_spec.md and compare.py) -----------------------------
# Why-tags = the same mechanism ids the sim logs in events[].mechanism (CONTRACT.md lists
# loss_aversion | habit | trust | price_anchor | gimmick_reactance | ...). The extra ids come from the
# 8 human truths in research/03-reddit-human-truths.md. compare.py aliases sim spellings onto these.
WHY_TAGS = {
    "taste": "sensory: it tasted best (research/03 truth 6: sensory detectability / signature taste)",
    "trust": "trust: brand/ingredients feel trustworthy (research/03 truth 5: borrowed trust)",
    "health_label": "health: better ingredients/nutrition (research/03 truth 7; C->label reading, research/04)",
    "price_anchor": "value: worth the price vs what's next to it (research/03 truth 4: reference-price anchoring)",
    "habit": "habit: like what I already buy (research/03 truth 2/6: habit, sacred SKUs)",
    "novelty": "novelty: new/different, want to try it (README: Openness -> food neophilia)",
    "mission_fit": "fit: fits how I'd use it - lunch/gym/kids (README: mission)",
    "social_proof": "social: heard of it / others rate it (research/03 truth 5)",
    "salience": "pack: the pack caught my eye (research/04 notice model)",
    "gimmick_reactance": "gimmick: claims feel like a gimmick (research/03 truth 8: reactance)",
    "loss_aversion": "risk: too risky to waste money on (research/03 truth 1/7: loss aversion)",
    "price_too_high": "price: too expensive for what it is (research/03 truth 7: 'too expensive' as cover)",
}
# What a respondent sees in the form -> tag id (form_spec.md uses exactly these labels).
WHY_LABELS = {
    "tasted best": "taste", "taste": "taste",
    "i trust it": "trust", "trust": "trust",
    "healthier / cleaner ingredients": "health_label", "healthier": "health_label", "health": "health_label",
    "good value vs alternatives": "price_anchor", "good value": "price_anchor", "value": "price_anchor",
    "like what i already buy": "habit", "habit": "habit",
    "new / different, want to try": "novelty", "novelty": "novelty", "new": "novelty",
    "fits how i'd use it": "mission_fit", "fits my use": "mission_fit", "fit": "mission_fit",
    "heard of it / others rate it": "social_proof", "social proof": "social_proof",
    "pack caught my eye": "salience", "pack": "salience",
    "claims feel gimmicky": "gimmick_reactance", "gimmick": "gimmick_reactance",
    "risky / might waste money": "loss_aversion", "risky": "loss_aversion",
    "too expensive for what it is": "price_too_high", "too expensive": "price_too_high",
}
# Screener ticks -> CONTRACT.md lens archetypes (so human segments line up with sim archetypes).
SEGMENT_LABELS = {
    "i have kids at home": "upf_avoider_parent",
    "i avoid ultra-processed food / additives": "eco_low_chemical",
    "i'm on glp-1 / smaller appetite": "glp1_small_appetite",
    "budget comes first": "frugal_unit_price",
    "i track protein / gym": "protein_gym",
    "protein claims annoy me": "protein_sceptic_gimmick_reactant",
    "i buy the same things every week": "habit_loyalist_shrinkflation_angry",
    "i buy a meal deal most workdays": "meal_deal_office",
    "vegan / vegetarian": "vegan_ethical",
    "allergy / coeliac in household": "allergen_coeliac",
    "i ask chatgpt/ai what to buy": "ai_delegator",
    "i try new things i see on tiktok": "novelty_seeker_tiktok",
}
MISSIONS = {"weekly shop": "weekly_shop", "meal deal": "meal_deal", "top-up": "top_up", "top up": "top_up",
            "treat": "treat", "gym": "gym", "gym / post-workout": "gym"}
BUY = {"yes": "yes", "maybe": "maybe", "no": "no",
       "yes, at shelf price": "yes", "maybe": "maybe", "no, not at that price": "no"}

TIPI_SOURCE = ("Gosling, Rentfrow & Swann (2003) J. Res. Pers. 37:504-528; items 1-10 on 1-7; "
               "E=1,6R A=2R,7 C=3,8R ES=4R,9 O=5,10R; N=8-ES; rescaled to 0-1 as (x-1)/6 "
               "to match CONTRACT.md ocean 0-1")


# ---- stats helpers ------------------------------------------------------------------------
def wilson(k: int, n: int, z: float = 1.959964) -> list[float]:
    """Wilson score interval (Wilson 1927). Returns [lo, hi]; [0,0] when n=0."""
    if n <= 0:
        return [0.0, 0.0]
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(max(0.0, centre - half), 4), round(min(1.0, centre + half), 4)]


def bradley_terry(pairs: list[tuple[str, str]], items: list[str], iters: int = 500,
                  prior: float = 0.5) -> dict[str, float]:
    """MM algorithm (Hunter 2004). pairs = (winner, loser).
    `prior`: each item gets `prior` virtual wins and losses against a fixed reference of strength 1
    (assumption: keeps zero-win brands finite at n~50; equivalent to a weak Beta-like shrinkage)."""
    w = {i: 1.0 for i in items}
    wins = Counter(a for a, _ in pairs)
    n_ij = Counter(frozenset(p) for p in pairs if p[0] != p[1])
    nbrs = defaultdict(set)
    for a, b in pairs:
        nbrs[a].add(b)
        nbrs[b].add(a)
    for _ in range(iters):
        new = {}
        for i in items:
            num = wins[i] + prior
            den = 2 * prior / (w[i] + 1.0)  # virtual games vs reference (strength 1)
            for j in nbrs[i]:
                den += n_ij[frozenset((i, j))] / (w[i] + w[j])
            new[i] = num / den if den > 0 else w[i]
        # normalise to geometric mean 1
        g = math.exp(sum(math.log(v) for v in new.values()) / len(new))
        new = {k: v / g for k, v in new.items()}
        if max(abs(new[k] - w[k]) for k in items) < 1e-9:
            w = new
            break
        w = new
    return w


def bt_shares(w: dict[str, float]) -> dict[str, float]:
    s = sum(w.values())
    return {k: v / s for k, v in w.items()}


# ---- parsing --------------------------------------------------------------------------------
def col_id(header: str) -> str:
    m = re.search(r"\[([a-z0-9_]+)\]", header, re.I)
    return (m.group(1) if m else header).strip().lower()


def split_multi(v: str) -> list[str]:
    if not v:
        return []
    parts = re.split(r",\s+|;\s*|\n", v) if ("," in v or ";" in v or "\n" in v) else [v]
    return [p.strip() for p in parts if p.strip()]


def norm_brand(b: str, universe: dict[str, str]) -> str | None:
    if not b:
        return None
    k = re.sub(r"\s+", " ", b.strip().lower())
    if k in ("", "none", "n/a", "-", "skip"):
        return None
    return universe.get(k, b.strip())


def map_tags(v: str) -> list[str]:
    out = []
    for p in split_multi(v):
        t = WHY_LABELS.get(p.lower())
        if t is None and p.lower() in WHY_TAGS:
            t = p.lower()
        out.append(t or "other")
    return out


def tipi_score(row: dict) -> dict | None:
    try:
        x = [float(row[f"tipi_{i}"]) for i in range(1, 11)]
    except (KeyError, ValueError, TypeError):
        return None
    if any(not (1 <= v <= 7) for v in x):
        return None
    r = lambda v: 8 - v  # reverse score
    E = (x[0] + r(x[5])) / 2
    A = (r(x[1]) + x[6]) / 2
    C = (x[2] + r(x[7])) / 2
    ES = (r(x[3]) + x[8]) / 2
    O = (x[4] + r(x[9])) / 2
    N = 8 - ES
    s = lambda v: round((v - 1) / 6, 4)
    return {"O": s(O), "C": s(C), "E": s(E), "A": s(A), "N": s(N)}


def load_rows(path: Path, universe: dict[str, str]) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        raw = list(csv.DictReader(f))
    voters = []
    for i, r in enumerate(raw):
        row = {col_id(k): (v or "").strip() for k, v in r.items() if k is not None}
        tops = [norm_brand(row.get(f"top{k}", ""), universe) for k in (1, 2, 3)]
        tops = [t for t in tops if t]
        tops = list(dict.fromkeys(tops))  # drop duplicate ranks, keep order
        if not tops:
            continue  # empty submission
        tasted = [norm_brand(b, universe) for b in split_multi(row.get("tasted", ""))]
        tasted = list(dict.fromkeys([t for t in tasted if t] + tops))
        segs = [SEGMENT_LABELS.get(s.lower(), s.lower()) for s in split_multi(row.get("segments", ""))]
        voters.append({
            "voter": row.get("voter") or f"v{i + 1:03d}",
            "tops": tops,
            "tasted": tasted,
            "buy_top1": BUY.get(row.get("buy_top1", "").lower()),
            "why_top1": map_tags(row.get("why_top1", "")),
            "walkpast": norm_brand(row.get("walkpast", ""), universe),
            "why_walkpast": map_tags(row.get("why_walkpast", "")),
            "mission": MISSIONS.get(row.get("mission", "").lower(), row.get("mission", "").lower() or None),
            "segments": segs,
            "ocean": tipi_score(row),
            "note": row.get("note", ""),
        })
    return voters


# ---- aggregation ----------------------------------------------------------------------------
def implied_pairs(v: dict) -> list[tuple[str, str]]:
    tops, rest = v["tops"], [b for b in v["tasted"] if b not in v["tops"]]
    pairs = []
    for a in range(len(tops)):
        for b in range(a + 1, len(tops)):
            pairs.append((tops[a], tops[b]))
        for o in rest:
            pairs.append((tops[a], o))
    return pairs


def shares_for(voters: list[dict], brands: list[str], boot: int = 300, seed: int = 7) -> dict:
    n = len(voters)
    top1 = Counter(v["tops"][0] for v in voters)
    top3 = Counter(b for v in voters for b in v["tops"])
    tasted = Counter(b for v in voters for b in v["tasted"])
    walk = Counter(v["walkpast"] for v in voters if v["walkpast"])
    pairs = [p for v in voters for p in implied_pairs(v)]
    bt = bt_shares(bradley_terry(pairs, brands)) if brands else {}

    rng = random.Random(seed)
    boots = defaultdict(list)
    if boot and n >= 5:
        for _ in range(boot):
            sample = [voters[rng.randrange(n)] for _ in range(n)]
            ps = [p for v in sample for p in implied_pairs(v)]
            s = bt_shares(bradley_terry(ps, brands, iters=200))
            for b in brands:
                boots[b].append(s[b])

    def pct(xs, q):
        xs = sorted(xs)
        return xs[min(len(xs) - 1, max(0, int(round(q * (len(xs) - 1)))))]

    out = {}
    for b in brands:
        why = Counter(t for v in voters if v["tops"][0] == b for t in v["why_top1"])
        whyw = Counter(t for v in voters if v["walkpast"] == b for t in v["why_walkpast"])
        buy = Counter(v["buy_top1"] for v in voters if v["tops"][0] == b and v["buy_top1"])
        out[b] = {
            "top1_votes": top1[b], "top1_share": round(top1[b] / n, 4) if n else 0,
            "top1_ci95": wilson(top1[b], n),
            "top3_votes": top3[b], "tasted": tasted[b],
            "top3_rate_given_tasted": round(top3[b] / tasted[b], 4) if tasted[b] else None,
            "top3_rate_ci95": wilson(top3[b], tasted[b]),
            "bt_share": round(bt.get(b, 0), 4),
            "bt_ci95": [round(pct(boots[b], .025), 4), round(pct(boots[b], .975), 4)] if boots[b] else None,
            "buy_top1": dict(buy),
            "why_top1": dict(why.most_common()),
            "walkpast_votes": walk[b], "walkpast_rate_given_tasted":
                round(walk[b] / tasted[b], 4) if tasted[b] else None,
            "why_walkpast": dict(whyw.most_common()),
        }
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="?", help="form export CSV")
    ap.add_argument("--brands", help="text file, one Shelf brand per line (fixes spelling + universe)")
    ap.add_argument("--out", default=str(OUT_DIR / "human_shares.json"))
    ap.add_argument("--boot", type=int, default=300)
    ap.add_argument("--min-seg", type=int, default=8,
                    help="min voters to report a segment (assumption: below ~8 a Wilson CI is wider than +-30pp)")
    ap.add_argument("--demo", action="store_true", help="generate a clearly-labelled FAKE csv and run on it")
    a = ap.parse_args(argv)

    if a.demo:
        from make_demo import make_demo  # type: ignore
        a.csv, a.brands = make_demo()
        a.out = str(OUT_DIR / "DEMO_human_shares.json")
    if not a.csv:
        ap.error("give a CSV or --demo")

    universe = {}
    if a.brands:
        for line in Path(a.brands).read_text().splitlines():
            if line.strip():
                universe[line.strip().lower()] = line.strip()
    voters = load_rows(Path(a.csv), universe)
    if not voters:
        sys.exit("no usable rows (need at least [top1])")
    brands = sorted(set(universe.values()) | {b for v in voters for b in v["tasted"]})

    n = len(voters)
    buy_all = Counter(v["buy_top1"] for v in voters if v["buy_top1"])
    seg_counts = Counter(s for v in voters for s in v["segments"])
    by_seg = {s: {"n": c, "brands": shares_for([v for v in voters if s in v["segments"]], brands, boot=0)}
              for s, c in seg_counts.items() if c >= a.min_seg}
    mis_counts = Counter(v["mission"] for v in voters if v["mission"])
    by_mis = {m: {"n": c, "brands": shares_for([v for v in voters if v["mission"] == m], brands, boot=0)}
              for m, c in mis_counts.items() if c >= a.min_seg}
    oc = [v["ocean"] for v in voters if v["ocean"]]
    ocean_summary = None
    if oc:
        ocean_summary = {}
        for t in "OCEAN":
            xs = [o[t] for o in oc]
            m = sum(xs) / len(xs)
            sd = math.sqrt(sum((x - m) ** 2 for x in xs) / max(1, len(xs) - 1))
            ocean_summary[t] = {"mean": round(m, 4), "sd": round(sd, 4), "n": len(xs)}

    result = {
        "kind": "DEMO - FAKE DATA, DO NOT PRESENT" if a.demo else "human_shares",
        "source": {"csv": str(a.csv), "collected_at": "The Shelf, EAT_HACK 3 Oct 2026 (25 challenger brands)",
                   "form": "calibration/form_spec.md"},
        "n_voters": n,
        "methods": {
            "top1_share": "votes for brand as #1 / voters; 95% CI Wilson (1927)",
            "top3_rate_given_tasted": "times in top-3 / times tasted; Wilson CI",
            "bt_share": "Bradley-Terry (1952) strength via MM (Hunter 2004) on rank-broken pairs "
                        "(top1>top2>top3>other tasted), normalised to sum 1; prior 0.5 virtual games "
                        "vs reference (assumption: shrinkage for n~50); CI = voter bootstrap B=%d" % a.boot,
            "segments": "screener ticks mapped to CONTRACT.md archetypes (SEGMENT_LABELS); only segments "
                        "with n>=%d reported (assumption)" % a.min_seg,
            "ocean": TIPI_SOURCE,
            "why_tags": WHY_TAGS,
        },
        "positivity_check": {
            "buy_top1": dict(buy_all),
            "share_no_or_maybe": round((buy_all["no"] + buy_all["maybe"]) / max(1, sum(buy_all.values())), 4),
            "share_no_ci95": wilson(buy_all["no"], sum(buy_all.values())),
            "walkpast_named": sum(1 for v in voters if v["walkpast"]),
            "why": "humans can say 'no' even to their favourite; LLM personas rarely do "
                   "(research/05-personas.md sec 6 item 6; arXiv 2609.13148 variance compression)",
        },
        "ocean_summary": ocean_summary,
        "brands": shares_for(voters, brands, boot=a.boot),
        "by_segment": by_seg,
        "by_mission": by_mis,
        "voters": [{"voter": v["voter"], "tops": v["tops"], "segments": v["segments"],
                    "mission": v["mission"], "ocean": v["ocean"], "buy_top1": v["buy_top1"]} for v in voters],
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(result, indent=2))
    top = sorted(result["brands"].items(), key=lambda kv: -kv[1]["bt_share"])[:5]
    print(f"[ingest] {n} voters, {len(brands)} brands -> {a.out}")
    for b, s in top:
        print(f"  {b:28s} BT {s['bt_share']:.3f} {s['bt_ci95']}  top1 {s['top1_votes']:>2} {s['top1_ci95']}")
    return result


if __name__ == "__main__":
    main()

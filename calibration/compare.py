#!/usr/bin/env python3
"""
Sim vs human on The Shelf brands. Answers: "how far can you trust the synthetic shoppers, and where not?"

    python calibration/compare.py --human calibration/out/human_shares.json \
        --run data/sim/runs/<run_id>.json --map calibration/brand_map.json
    python calibration/compare.py --demo        # runs make_demo + ingest + compare on FAKE fixtures

Outputs calibration/out/compare.json (+ a printed scorecard). Stdlib only.

What it reports (every metric names its method + source):
 1. Rank agreement: Spearman rho and Kendall tau-b between sim brand shares and human brand shares,
    with a permutation p-value (assumption: 2000 permutations is enough for a 3-decimal p).
 2. Level error: mean absolute error in percentage points; top-5 overlap.
 3. Per-segment error: same metrics within each human screener segment that maps onto a CONTRACT.md
    archetype, sim side restricted to agents of that archetype. arXiv 2609.13148 (Tigre & Souto,
    "When Can You Trust Your Synthetic Users?") reports 10-30pp subgroup error despite good topline,
    so we expect this to be the weak spot and we print it next to n.
 4. Positivity bias / variance compression: sim P(pick | considered) and sentiment vs the human rate of
    saying no/maybe to buying even their #1; SD(sim shares)/SD(human shares).
    (arXiv 2609.13148: variance compression; research/05-personas.md sec 6 item 6: "LLM personas don't reject".)
 5. Why-tag agreement: total-variation distance between human why-tags on #1 picks and sim mechanisms on picks.
 6. AIPW-style correction (prediction-powered / doubly robust with known labelling propensity):
       theta_hat_b = mean_{sim agents a} f_b(x_a)  +  mean_{voters i} ( Y_ib - f_b(x_i) )
    where Y_ib = 1 if voter i ranked brand b #1, f_b(x) = sim share of b for segment x.
    Var = Var(f)/N + Var(resid)/n  -> 95% CI.  With a constant (random) labelling propensity, AIPW
    reduces to this form (Angelopoulos et al. 2023, "Prediction-powered inference", Science 382:669;
    applied to LLM consumer panels with n=50-300 calibration responses and 83-94% bias reduction on
    pricing in arXiv 2609.13148). We ALSO run an honest 80/20 split (K random splits) and report how much
    of the naive sim error on the held-out 20% the rectifier removes. At n~50 treat as topline only.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics as st
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
from ingest import WHY_TAGS  # noqa: E402

# Sim mechanism spellings -> form why-tag ids (anything else counted as "other").
MECH_ALIAS = {
    "loss_aversion": "loss_aversion", "betrayal_aversion": "loss_aversion", "trial_risk": "loss_aversion",
    "habit": "habit", "status_quo": "habit", "default": "habit", "sacred_sku": "habit",
    "trust": "trust", "borrowed_trust": "trust", "source_credibility": "trust",
    "price_anchor": "price_anchor", "reference_price": "price_anchor", "transaction_utility": "price_anchor",
    "unit_price": "price_anchor", "price": "price_too_high", "price_too_high": "price_too_high",
    "gimmick_reactance": "gimmick_reactance", "reactance": "gimmick_reactance",
    "novelty": "novelty", "neophilia": "novelty", "variety_seeking": "novelty",
    "health_label": "health_label", "label_reading": "health_label", "upf_avoidance": "health_label",
    "mission_fit": "mission_fit", "meal_deal": "mission_fit", "satiety": "mission_fit",
    "social_proof": "social_proof", "reviews": "social_proof",
    "salience": "salience", "eye_level": "salience", "taste": "taste", "sensory": "taste",
}


# ---- rank stats -----------------------------------------------------------------------------
def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def pearson(a, b):
    if len(a) < 3:
        return None
    ma, mb = st.fmean(a), st.fmean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else None


def spearman(a, b):
    return pearson(ranks(a), ranks(b))


def kendall_tau_b(a, b):
    n = len(a)
    c = d = ta = tb = 0
    for i in range(n):
        for j in range(i + 1, n):
            da, db = a[i] - a[j], b[i] - b[j]
            if da == 0 and db == 0:
                continue
            if da == 0:
                ta += 1
            elif db == 0:
                tb += 1
            elif da * db > 0:
                c += 1
            else:
                d += 1
    den = math.sqrt((c + d + ta) * (c + d + tb))
    return (c - d) / den if den else None


def perm_p(a, b, n_perm=2000, seed=11):
    obs = spearman(a, b)
    if obs is None:
        return None
    rng = random.Random(seed)
    bb = list(b)
    hits = 0
    for _ in range(n_perm):
        rng.shuffle(bb)
        r = spearman(a, bb)
        if r is not None and abs(r) >= abs(obs) - 1e-12:
            hits += 1
    return (hits + 1) / (n_perm + 1)


def agreement(sim: dict, hum: dict, brands: list[str]) -> dict:
    a = [sim.get(b, 0.0) for b in brands]
    h = [hum.get(b, 0.0) for b in brands]
    top = lambda d: set(sorted(brands, key=lambda b: -d.get(b, 0))[:5])
    sd_h = st.pstdev(h) if len(h) > 1 else 0
    return {
        "n_brands": len(brands),
        "spearman_rho": r4(spearman(a, h)), "spearman_perm_p": r4(perm_p(a, h)),
        "kendall_tau_b": r4(kendall_tau_b(a, h)),
        "mae_pp": r4(100 * st.fmean(abs(x - y) for x, y in zip(a, h))) if brands else None,
        "top5_overlap": len(top(sim) & top(hum)),
        "sd_ratio_sim_over_human": r4(st.pstdev(a) / sd_h) if sd_h else None,
    }


def r4(x):
    return None if x is None else round(x, 4)


# ---- sim side -------------------------------------------------------------------------------
def load_brand_map(path: str | None, human_brands: list[str]) -> dict[str, list[str]]:
    """shelf brand -> product codes. Falls back to matching catalog.json `brand` (case-insensitive)."""
    if path and Path(path).exists():
        m = json.loads(Path(path).read_text())
        return m.get("map", m)
    cat = ROOT / "data/products/catalog.json"
    out = defaultdict(list)
    if cat.exists():
        hb = {b.lower(): b for b in human_brands}
        for p in json.loads(cat.read_text()):
            b = hb.get((p.get("brand") or "").split(",")[0].strip().lower())
            if b:
                out[b].append(p["code"])
    return dict(out)


def persona_archetypes() -> dict[str, str]:
    p = ROOT / "data/personas/personas.json"
    if not p.exists():
        return {}
    return {x["id"]: x.get("archetype") for x in json.loads(p.read_text()) if "id" in x}


def sim_shares(agents: list[dict], code2brand: dict[str, str], brands: list[str]) -> tuple[dict, dict]:
    """Exposure-adjusted share: pick_rate_b = picked/shown per brand; share = pick_rate / sum(pick_rate).
    (assumption: the sim shows brands unevenly - path + notice gate - so raw pick counts would reward
    exposure, while The Shelf gave every voter free access to taste; normalising by `shown` aligns them.)"""
    shown, picked, considered = Counter(), Counter(), Counter()
    sentiments = []
    mech = Counter()
    for ag in agents:
        for e in ag.get("events", []):
            b = code2brand.get(str(e.get("product")))
            if not b:
                continue
            shown[b] += 1
            if e.get("noticed") and e.get("decision") != "not_noticed":
                considered[b] += 1
                if isinstance(e.get("sentiment"), (int, float)):
                    sentiments.append(e["sentiment"])
            if e.get("decision") == "pick":
                picked[b] += 1
                mech[MECH_ALIAS.get(str(e.get("mechanism", "")).lower(), "other")] += 1
    rate = {b: picked[b] / shown[b] for b in brands if shown[b]}
    s = sum(rate.values())
    shares = {b: (rate.get(b, 0.0) / s if s else 0.0) for b in brands}
    tot_c = sum(considered.values())
    meta = {"events_matched": sum(shown.values()), "brands_seen": len(rate),
            "p_pick_given_considered": r4(sum(picked.values()) / tot_c) if tot_c else None,
            "mean_sentiment": r4(st.fmean(sentiments)) if sentiments else None,
            "mechanisms_on_picks": dict(mech)}
    return shares, meta


def tvd(p: Counter, q: Counter) -> float | None:
    sp, sq = sum(p.values()), sum(q.values())
    if not sp or not sq:
        return None
    keys = set(p) | set(q)
    return round(0.5 * sum(abs(p[k] / sp - q[k] / sq) for k in keys), 4)


# ---- AIPW / PPI -------------------------------------------------------------------------------
def aipw(human: dict, seg_sim: dict, overall_sim: dict, agents_arch: list[str], brands: list[str],
         k_splits: int = 50, seed: int = 5) -> dict:
    voters = human.get("voters", [])
    n = len(voters)
    if n < 10:
        return {"skipped": f"n={n} voters < 10"}

    def f(b, segs):
        vals = [seg_sim[s][b] for s in segs if s in seg_sim]
        return st.fmean(vals) if vals else overall_sim.get(b, 0.0)

    N = len(agents_arch)
    fpop = {b: [f(b, [a]) for a in agents_arch] for b in brands}
    out = {}
    for b in brands:
        Y = [1.0 if v["tops"] and v["tops"][0] == b else 0.0 for v in voters]
        F = [f(b, v.get("segments", [])) for v in voters]
        res = [y - x for y, x in zip(Y, F)]
        naive = st.fmean(fpop[b]) if N else overall_sim.get(b, 0.0)
        theta = naive + st.fmean(res)
        var = (st.pvariance(fpop[b]) / N if N > 1 else 0) + (st.variance(res) / n if n > 1 else 0)
        se = math.sqrt(var)
        out[b] = {"sim_naive": r4(naive), "human_top1": r4(st.fmean(Y)), "aipw": r4(theta),
                  "aipw_ci95": [r4(theta - 1.96 * se), r4(theta + 1.96 * se)]}

    # honest holdout: fit rectifier on 80% of voters, score on the other 20%
    rng = random.Random(seed)
    red, mae_n, mae_c = [], [], []
    for _ in range(k_splits):
        idx = list(range(n))
        rng.shuffle(idx)
        cut = int(0.8 * n)
        tr, te = idx[:cut], idx[cut:]
        bn = bc = en = ec = 0.0
        for b in brands:
            Ytr = [1.0 if voters[i]["tops"][0] == b else 0.0 for i in tr]
            Ftr = [f(b, voters[i].get("segments", [])) for i in tr]
            Yte = st.fmean(1.0 if voters[i]["tops"][0] == b else 0.0 for i in te)
            naive = st.fmean(fpop[b]) if N else overall_sim.get(b, 0.0)
            corr = naive + st.fmean(y - x for y, x in zip(Ytr, Ftr))
            bn += naive - Yte
            bc += corr - Yte
            en += abs(naive - Yte)
            ec += abs(corr - Yte)
        mae_n.append(en / len(brands))
        mae_c.append(ec / len(brands))
    return {
        "method": "PPI/AIPW with constant labelling propensity (Angelopoulos et al. 2023 Science 382:669; "
                  "arXiv 2609.13148 for LLM consumer panels). Y = voter's #1; f = sim segment share.",
        "per_brand": out,
        "holdout_80_20": {"k_splits": k_splits,
                          "mae_pp_naive": r4(100 * st.fmean(mae_n)),
                          "mae_pp_corrected": r4(100 * st.fmean(mae_c)),
                          "error_reduction": r4(1 - st.fmean(mae_c) / st.fmean(mae_n)) if st.fmean(mae_n) else None,
                          "caveat": "20% of ~50 voters = ~10 people; per-brand top-1 shares on 10 people are "
                                    "mostly 0/1 noise, so this number is wide. Topline only (research/05 sec 6)."},
    }


def ocean_compare(human: dict, agents: list[dict]) -> dict:
    """Real TIPI OCEAN (Gosling 2003, rescaled 0-1) of the voters vs the OCEAN the sim assigned its agents.
    A sim population much more Open / Conscientious than the room means its trait->behaviour effects
    (research/04, CONTRACT ocean_effects) are being applied to the wrong people."""
    hs = human.get("ocean_summary") or {}
    out = {}
    for t in "OCEAN":
        xs = [ag["ocean"][t] for ag in agents if isinstance(ag.get("ocean"), dict) and t in ag["ocean"]]
        sim = {"mean": r4(st.fmean(xs)), "sd": r4(st.pstdev(xs)), "n": len(xs)} if xs else None
        h = hs.get(t)
        out[t] = {"human_tipi": h, "sim": sim,
                  "mean_gap": r4(sim["mean"] - h["mean"]) if (sim and h) else None}
    out["note"] = ("TIPI is a 10-item screen (test-retest ~.72 per Gosling 2003); compare means, "
                   "do not score individuals. Volunteer hackathon builders are not UK shoppers.")
    return out


# ---- main -------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--human", default=str(HERE / "out/human_shares.json"))
    ap.add_argument("--run", help="sim run log (CONTRACT.md shape)")
    ap.add_argument("--map", default=str(HERE / "brand_map.json"))
    ap.add_argument("--metric", default="bt_share", choices=["bt_share", "top1_share"])
    ap.add_argument("--out", default=str(HERE / "out/compare.json"))
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args(argv)

    if a.demo:
        import ingest
        from make_demo import make_demo
        csv_p, br_p = make_demo()
        ingest.main([csv_p, "--brands", br_p, "--out", str(HERE / "out/DEMO_human_shares.json"), "--boot", "100"])
        a.human = str(HERE / "out/DEMO_human_shares.json")
        a.run = str(HERE / "fixtures/DEMO_sim_run.json")
        a.map = str(HERE / "fixtures/DEMO_brand_map.json")
        a.out = str(HERE / "out/DEMO_compare.json")
    if not a.run:
        runs = sorted((ROOT / "data/sim/runs").glob("*.json"))
        if not runs:
            sys.exit("no --run given and data/sim/runs/ is empty")
        a.run = str(runs[-1])

    human = json.loads(Path(a.human).read_text())
    run = json.loads(Path(a.run).read_text())
    hb = human["brands"]
    bmap = load_brand_map(a.map, list(hb))
    code2brand = {str(c): b for b, cs in bmap.items() for c in cs}
    brands = sorted(b for b in hb if b in bmap)
    if len(brands) < 3:
        sys.exit(f"only {len(brands)} Shelf brands map to sim products - fill calibration/brand_map.json")

    arch_of = persona_archetypes()
    agents = [ag for ag in run.get("agents", []) if ag.get("persona_id") != "ai_agent" and ag.get("kind") != "ai_agent"]
    for ag in agents:
        ag["_arch"] = ag.get("archetype") or arch_of.get(ag.get("persona_id")) or \
            str(ag.get("persona_id", "")).removeprefix("p_")
    hum_share = {b: hb[b][a.metric] for b in brands}
    renorm = sum(hum_share.values())
    hum_share = {b: v / renorm for b, v in hum_share.items()} if renorm else hum_share
    sim_all, sim_meta = sim_shares(agents, code2brand, brands)

    seg_sim, seg_report = {}, {}
    for arch in sorted({ag["_arch"] for ag in agents}):
        s, m = sim_shares([ag for ag in agents if ag["_arch"] == arch], code2brand, brands)
        seg_sim[arch] = s
        if arch in human.get("by_segment", {}):
            hs = human["by_segment"][arch]
            h = {b: hs["brands"][b][a.metric] for b in brands}
            t = sum(h.values()) or 1
            h = {b: v / t for b, v in h.items()}
            seg_report[arch] = {"n_humans": hs["n"],
                                "n_sim_agents": sum(1 for ag in agents if ag["_arch"] == arch),
                                **agreement(s, h, brands)}

    hum_why = Counter()
    for b in brands:
        hum_why.update(hb[b].get("why_top1", {}))
    pos = human.get("positivity_check", {})
    result = {
        "kind": human.get("kind", "compare") if "DEMO" in str(human.get("kind")) else "compare",
        "inputs": {"human": a.human, "run": a.run, "brand_map": a.map, "human_metric": a.metric,
                   "n_voters": human.get("n_voters"), "n_sim_agents": len(agents),
                   "brands_compared": brands},
        "topline": agreement(sim_all, hum_share, brands),
        "per_segment": seg_report,
        "positivity_bias": {
            "sim_p_pick_given_considered": sim_meta["p_pick_given_considered"],
            "sim_mean_sentiment": sim_meta["mean_sentiment"],
            "human_share_no_or_maybe_on_own_#1": pos.get("share_no_or_maybe"),
            "human_buy_top1": pos.get("buy_top1"),
            "read": "If the sim picks most of what it considers while humans hedge even on their favourite, "
                    "the sim is positivity-biased (arXiv 2609.13148; NN/g 'chatbots want to please' via README).",
        },
        "why_tags": {"human_on_#1": dict(hum_why), "sim_on_picks": sim_meta["mechanisms_on_picks"],
                     "total_variation_distance": tvd(hum_why, Counter(sim_meta["mechanisms_on_picks"])),
                     "vocabulary": WHY_TAGS},
        "ocean": ocean_compare(human, agents),
        "aipw": aipw(human, seg_sim, sim_all, [ag["_arch"] for ag in agents], brands),
        "per_brand": {b: {"sim_share": r4(sim_all[b]), "human_share": r4(hum_share[b]),
                          "human_ci95_" + a.metric: hb[b].get("bt_ci95" if a.metric == "bt_share" else "top1_ci95"),
                          "gap_pp": r4(100 * (sim_all[b] - hum_share[b]))} for b in brands},
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(result, indent=2))

    t = result["topline"]
    print(f"[compare] {len(brands)} brands | rho={t['spearman_rho']} (p={t['spearman_perm_p']}) "
          f"tau_b={t['kendall_tau_b']} MAE={t['mae_pp']}pp top5={t['top5_overlap']}/5 "
          f"SDratio={t['sd_ratio_sim_over_human']}")
    for s, r in seg_report.items():
        print(f"  seg {s:34s} n_h={r['n_humans']:>3} rho={r['spearman_rho']} MAE={r['mae_pp']}pp")
    pb = result["positivity_bias"]
    print(f"  positivity: sim P(pick|considered)={pb['sim_p_pick_given_considered']} "
          f"vs human no/maybe on own #1={pb['human_share_no_or_maybe_on_own_#1']}")
    h = result["aipw"].get("holdout_80_20", {})
    print(f"  AIPW holdout: MAE naive={h.get('mae_pp_naive')}pp -> corrected={h.get('mae_pp_corrected')}pp "
          f"(reduction {h.get('error_reduction')})")
    print(f"  -> {a.out}")
    return result


if __name__ == "__main__":
    main()

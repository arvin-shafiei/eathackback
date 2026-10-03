#!/usr/bin/env python3
"""
DEMO FIXTURES ONLY. Fake data used to test ingest.py / compare.py end-to-end before real votes arrive.
Never present these numbers. All files are prefixed DEMO_ and every JSON carries kind="DEMO - FAKE".

Writes:
  calibration/fixtures/DEMO_brands.txt        25 placeholder brand names (Brand A..Y)
  calibration/fixtures/DEMO_responses.csv     50 fake voters in the exact form-export layout
  calibration/fixtures/DEMO_sim_run.json      fake sim run log in CONTRACT.md shape (positivity-biased on purpose)
  calibration/fixtures/DEMO_brand_map.json    shelf brand -> sim product codes
"""
import csv
import json
import math
import random
from pathlib import Path

FX = Path(__file__).resolve().parent / "fixtures"
SEGS = ["I have kids at home", "I avoid ultra-processed food / additives", "Budget comes first",
        "I track protein / gym", "I buy a meal deal most workdays", "I try new things I see on TikTok"]
SEG_ARCH = ["upf_avoider_parent", "eco_low_chemical", "frugal_unit_price", "protein_gym",
            "meal_deal_office", "novelty_seeker_tiktok"]
WHY = ["Tasted best", "I trust it", "Healthier / cleaner ingredients", "Good value vs alternatives",
       "New / different, want to try", "Fits how I'd use it"]
WHYNOT = ["Too expensive for what it is", "Claims feel gimmicky", "Risky / might waste money", "Tasted best"]
MISS = ["Weekly shop", "Meal deal", "Top-up", "Treat", "Gym"]


def make_demo(seed: int = 3):
    rng = random.Random(seed)
    FX.mkdir(parents=True, exist_ok=True)
    brands = [f"Brand {chr(65 + i)}" for i in range(25)]
    (FX / "DEMO_brands.txt").write_text("\n".join(brands) + "\n")
    true = {b: rng.gauss(0, 1) for b in brands}  # latent "taste" utility

    hdr = ["Submitted at", "[voter] Nickname (optional)", "[tasted] Which did you taste?",
           "[top1] Your #1", "[top2] Your #2", "[top3] Your #3",
           "[buy_top1] Would you buy your #1 at shelf price?", "[why_top1] Why #1?",
           "[walkpast] One you'd walk past", "[why_walkpast] Why walk past?",
           "[mission] You'd buy this on a...", "[segments] Tick any that fit you"] + \
          [f"[tipi_{i}] TIPI {i}" for i in range(1, 11)]
    rows = []
    for v in range(50):
        tasted = rng.sample(brands, rng.randint(6, 14))
        noisy = sorted(tasted, key=lambda b: -(true[b] + rng.gauss(0, 0.8)))
        segs = rng.sample(SEGS, rng.randint(1, 2))
        tipi = [rng.randint(2, 7) for _ in range(10)] if rng.random() < 0.7 else [""] * 10
        rows.append(["2026-10-03 14:%02d" % v, f"demo{v}", ", ".join(tasted), noisy[0], noisy[1], noisy[2],
                     rng.choices(["Yes, at shelf price", "Maybe", "No, not at that price"], [5, 3, 2])[0],
                     ", ".join(rng.sample(WHY, 2)), noisy[-1], rng.choice(WHYNOT),
                     rng.choice(MISS), ", ".join(segs)] + tipi)
    with open(FX / "DEMO_responses.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(hdr)
        w.writerows(rows)

    # Fake sim run: one product per brand; sim utility = true + extra noise, pick probabilities inflated
    # (positivity bias) so compare.py has something to detect.
    bmap = {b: [f"DEMO{1000 + i}"] for i, b in enumerate(brands)}
    (FX / "DEMO_brand_map.json").write_text(json.dumps(
        {"kind": "DEMO - FAKE", "map": bmap}, indent=2))
    per = {}
    agents = []
    for ai in range(120):
        arch = rng.choice(SEG_ARCH)
        evs = []
        for b in rng.sample(brands, 10):
            u = 0.6 * true[b] + rng.gauss(0, 0.6)
            p_pick = 1 / (1 + math.exp(-(u + 0.8)))  # +0.8 = baked-in positivity
            noticed = rng.random() < 0.6
            dec = "not_noticed" if not noticed else ("pick" if rng.random() < p_pick else
                                                     rng.choice(["reject", "walk_past"]))
            code = bmap[b][0]
            evs.append({"step": len(evs), "slot": "U1-r2", "product": code, "p_notice": 0.6, "noticed": noticed,
                        "decision": dec, "mechanism": rng.choice(["trust", "habit", "price_anchor", "novelty"]),
                        "sentiment": round(rng.uniform(-0.2, 1.0), 2), "reason": "DEMO", "source_refs": []})
            s = per.setdefault(code, {"shown": 0, "noticed": 0, "considered": 0, "picked": 0,
                                      "rejected": 0, "walk_past": 0})
            s["shown"] += 1
            s["noticed"] += noticed
            s["considered"] += noticed
            s["picked"] += dec == "pick"
            s["rejected"] += dec == "reject"
            s["walk_past"] += dec == "walk_past"
        agents.append({"agent_id": f"a{ai:03d}", "persona_id": f"p_{arch}", "archetype": arch,
                       "model": "DEMO", "ocean": {t: round(rng.uniform(.3, .7), 2) for t in "OCEAN"},
                       "path": [], "events": evs})
    for s in per.values():
        s["pick_rate"] = s["picked"] / s["shown"] if s["shown"] else 0
    run = {"kind": "DEMO - FAKE", "run_id": "DEMO", "created": "2026-10-03", "models": ["DEMO"],
           "agents": agents, "stats": {"per_product": per}}
    (FX / "DEMO_sim_run.json").write_text(json.dumps(run))
    return str(FX / "DEMO_responses.csv"), str(FX / "DEMO_brands.txt")


if __name__ == "__main__":
    print(make_demo())

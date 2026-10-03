"""Weekly brand digest as Slack Block Kit JSON.

Reads the brand funnel counted from human-shopper run logs (integrations/common.py), any brand_report files in
data/sim/brand/, and any optimiser results in data/sim/optimise/ for the brand's products. No LLM calls.

Default is --dry-run: prints the Block Kit payload and writes integrations/slack/example_digest.json.
Posting needs BOTH --post and SLACK_WEBHOOK_URL in the environment (an incoming-webhook URL). Nothing is posted
unless you do that on purpose.

  python3 integrations/slack/weekly_digest.py --brand "McVitie's"
  python3 integrations/slack/weekly_digest.py --products 5000168036755,5410126716016
  python3 integrations/slack/weekly_digest.py --top 3                 # the 3 best-evidenced products
  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/... python3 integrations/slack/weekly_digest.py --brand X --post
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import ROOT, best_documented_codes, brand_funnel, human_runs, load_catalog, rel  # noqa: E402

WEEK = 7 * 86400
MECH = {"habit": "habit", "loss_aversion": "felt like worse value", "price_anchor": "price vs what's next to it",
        "trust": "trust / distrust", "gimmick_reactance": "felt like a gimmick", "social_proof": "social proof",
        "health_goal": "health goal", "mission_fit": "not what they came for", "novelty": "novelty",
        "effort": "too much effort", "indifference": "no pull"}


def runs_in(lo: float, hi: float) -> list[str]:
    return [f for f in human_runs() if lo <= os.path.getmtime(f) < hi]


def pct(x):
    return "–" if x is None else f"{round(100 * x)}%"


def opt_results(code: str) -> list[dict]:
    out = []
    for f in glob.glob(os.path.join(ROOT, "data", "sim", "optimise", f"opt_{code}_*.json")):
        if "_mock_" in f:
            continue
        with open(f) as fh:
            d = json.load(fh)
        for r in d.get("results") or []:
            out.append({**r, "file": rel(f)})
    return out


def product_blocks(code: str, now: float) -> list[dict]:
    cur = brand_funnel(code, runs_in(now - WEEK, now + 1))
    prev = brand_funnel(code, runs_in(now - 2 * WEEK, now - WEEK))
    p = cur["product"]
    st = {s["stage"]: s for s in cur["funnel"]}
    n = st["shown"]["count"]
    if n == 0:
        return []
    kept = st["picked"]
    pv = {s["stage"]: s for s in prev["funnel"]}
    trend = ("no previous week logged to compare" if pv["shown"]["count"] == 0 else
             f"last week {pct(pv['picked']['rate_of_shown'])} kept (n={pv['shown']['count']})")
    lk = cur["leaks"]
    lines = [
        f"*{p['name']}* ({p['brand']}, {p['role']}) · <{p['off_url']}|OFF {code}>",
        f"passed {n} · looked {st['noticed']['count']} ({pct(st['noticed']['rate_of_shown'])}) · "
        f"picked up {st['considered']['count']} · *kept {kept['count']} ({pct(kept['rate_of_shown'])}, "
        f"95% CI {pct(kept['ci95'][0])}–{pct(kept['ci95'][1])})* · {trend}",
        f"leaks: {lk['never_noticed']} never noticed · {lk['looked_and_walked_away']} looked and walked away · "
        f"{lk['picked_up_and_put_back']} picked up and put back",
    ]
    top = (cur["top_put_back_reasons"] or [None])[0]
    if top:
        ex = (top.get("examples") or [{}])[0]
        reason = str(ex.get("reason", "")).split("] ", 1)[-1][:180]
        lines.append(f"top put-back: *{MECH.get(top['mechanism'], top['mechanism'])}* ({top['count']}×) — _{reason}_ "
                     f"({ex.get('persona_id', '')}, {ex.get('run_id', '')})")
    best = sorted((r for r in opt_results(code) if r.get("significant")), key=lambda r: -r.get("delta_pick", 0))
    if best:
        b = best[0]
        lines.append(f"tested fix: *{b['edit']}* → Δpick {b['delta_pick']:+.1%} (95% CI {b['delta_ci95'][0]:+.1%} to "
                     f"{b['delta_ci95'][1]:+.1%}) · {b.get('what_changed', '')[:120]}")
    if cur["small_sample"]:
        lines.append(":warning: small sample (< 30 shoppers): read the CI, not the headline.")
    blk = [{"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)}}]
    if p.get("image"):
        blk[0]["accessory"] = {"type": "image", "image_url": p["image"], "alt_text": p["name"] or code}
    blk.append({"type": "context", "elements": [{"type": "mrkdwn", "text":
               "sources: " + ", ".join(r["run_id"] for r in cur["sources"]["runs"]) + " · " + cur["sources"]["method"]}]})
    return blk


def digest(codes: list[str], title: str) -> dict:
    now = time.time()
    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"shelf digest · {title}"[:150]}},
        {"type": "context", "elements": [{"type": "mrkdwn", "text":
            f"week to {time.strftime('%d %b %Y', time.localtime(now))} · synthetic shoppers (TypeSafe Jev) walking a "
            "3D store of real Open Food Facts products · every number is a count of logged decisions"}]},
        {"type": "divider"},
    ]
    shown = 0
    for c in codes:
        b = product_blocks(c, now)
        if b:
            blocks += b + [{"type": "divider"}]
            shown += 1
    if not shown:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "no shopper runs logged for these products this week."}})
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text":
                  "how it's counted: docs/data-collection.md · API: integrations/openapi.yaml"}]})
    return {"text": f"shelf digest · {title}", "blocks": blocks[:50]}  # Slack limit: 50 blocks per message


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--brand")
    ap.add_argument("--products", help="comma-separated barcodes")
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--post", action="store_true", help="actually POST to $SLACK_WEBHOOK_URL (off by default)")
    ap.add_argument("--out", default=os.path.join(HERE, "example_digest.json"))
    a = ap.parse_args()
    cat = load_catalog()
    if a.brand:
        codes = [p["code"] for p in cat if (p.get("brand") or "").lower() == a.brand.lower()]
        title = a.brand
    elif a.products:
        codes, title = a.products.split(","), "selected products"
    else:
        codes, title = best_documented_codes(a.top), f"top {a.top} best-evidenced products"
    payload = digest(codes, title)
    js = json.dumps(payload, indent=2, ensure_ascii=False)
    with open(a.out, "w") as f:
        f.write(js)
    if a.post:
        url = os.environ.get("SLACK_WEBHOOK_URL")
        if not url:
            sys.exit("--post needs SLACK_WEBHOOK_URL; nothing sent")
        req = urllib.request.Request(url, data=js.encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            print("slack:", r.status, r.read()[:200])
    else:
        print(js)
        print(f"\n[dry-run] not posted. wrote {rel(a.out)}. Preview: paste into https://app.slack.com/block-kit-builder",
              file=sys.stderr)


if __name__ == "__main__":
    main()

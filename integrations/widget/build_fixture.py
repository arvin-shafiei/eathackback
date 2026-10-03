"""Build the static fixture the widget demo reads: integrations/widget/fixture.json.

Source order (honest):
  1. data/sim/brand/*.json if a brand_report has been written there (passed through under "brand_report").
  2. Otherwise the funnel is counted directly from human-shopper run logs (integrations/common.py::brand_funnel).
No LLM calls. Every number is a count from data/sim/runs/*.json.

  python3 integrations/widget/build_fixture.py [--n 6]
"""
import argparse
import glob
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import BRAND_DIR, best_documented_codes, brand_funnel, rel  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6)
    a = ap.parse_args()
    codes = best_documented_codes(a.n)
    brand_files = {os.path.splitext(os.path.basename(f))[0]: f for f in glob.glob(os.path.join(BRAND_DIR, "*.json"))}
    out = {"fixture": True,
           "note": "static snapshot for the widget demo, counted from sim run logs; not live data",
           "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
           "products": {}}
    for c in codes:
        f = brand_funnel(c)
        if c in brand_files:
            with open(brand_files[c]) as fh:
                f["brand_report"] = json.load(fh)
            f["sources"]["brand_report"] = rel(brand_files[c])
        out["products"][c] = f
    p = os.path.join(HERE, "fixture.json")
    with open(p, "w") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
    print(f"wrote {rel(p)}: {', '.join(f'{c} ({out['products'][c]['product']['name']})' for c in codes)}")


if __name__ == "__main__":
    main()

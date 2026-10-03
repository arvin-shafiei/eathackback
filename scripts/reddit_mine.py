"""Mine Reddit (via Arctic Shift archive API) for verbatim choice/rejection evidence.

Usage: python3 reddit_mine.py  -> writes reddit_corpus.jsonl + prints a summary
"""
import json, time, urllib.parse, urllib.request, sys

API = "https://arctic-shift.photon-reddit.com/api/comments/search"

SUBS = ["CasualUK", "AskUK", "unitedkingdom", "UKPersonalFinance", "britishproblems",
        "tesco", "sainsburys", "Aldi_UK", "ukfood", "ultraprocessedfood", "CoeliacUK",
        "smallbusinessuk", "UKBusiness", "Entrepreneur", "smallbusiness", "foodbusiness",
        "ecommerce", "shopify", "MarketResearch", "retail", "Frugal_UK", "MealPrepSunday", "snackexchange"]

QUERIES = {
    # Human Truth: rejection / near-choice / say-do gap / trust
    "went_back": "went back to",
    "switched_to": "switched to",
    "never_again": "never buying again",
    "tried_new_brand": "tried the new",
    "favourites_list": "favourites list",
    "same_shop_online": "same things every week",
    "shrinkflation": "shrinkflation",
    "own_brand_same": "own brand is just as good",
    "never_heard_of": "never heard of the brand",
    "discontinued": "discontinued",
    "meal_deal": "meal deal",
    "protein_everything": "protein version",
    "upf": "ultra processed",
    # Founders / buyers
    "listing": "listed in tesco",
    "buyer_meeting": "supermarket buyer",
    "delisted": "delisted",
    "range_review": "range review",
    "rate_of_sale": "rate of sale",
    # AI agents
    "chatgpt_shopping": "chatgpt recommended",
    "rufus": "rufus",
}


def fetch(sub, q, limit=100):
    params = {"body": q, "subreddit": sub, "limit": limit, "sort": "desc"}
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "eathack-research/0.1"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r).get("data", []) or []
        except Exception as e:
            time.sleep(1.5 * (attempt + 1))
    return []


def main():
    seen, rows = set(), []
    pairs = [(s, k, q) for k, q in QUERIES.items() for s in SUBS]
    for i, (sub, key, q) in enumerate(pairs):
        for c in fetch(sub, q):
            if c["id"] in seen or len(c.get("body", "")) < 40:
                continue
            seen.add(c["id"])
            rows.append({"id": c["id"], "sub": sub, "query": key, "score": c.get("score"),
                         "created_utc": c.get("created_utc"), "link_id": c.get("link_id"),
                         "permalink": f"https://www.reddit.com/r/{sub}/comments/{c.get('link_id','')[3:]}/_/{c['id']}/",
                         "body": c["body"]})
        if i % 25 == 0:
            print(f"{i}/{len(pairs)} queries, {len(rows)} comments", file=sys.stderr)
        time.sleep(0.25)
    with open("reddit_corpus.jsonl", "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    from collections import Counter
    print("TOTAL", len(rows))
    print(Counter(r["query"] for r in rows).most_common())
    print(Counter(r["sub"] for r in rows).most_common())


if __name__ == "__main__":
    main()

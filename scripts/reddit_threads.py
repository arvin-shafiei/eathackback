"""Fetch full comment trees for Reddit threads discovered via Google (Arctic Shift archive API).

Writes reddit_threads.jsonl: one line per thread {id, theme, title, sub, comments:[{depth,score,body}]}
"""
import json, time, urllib.request

THEMES = ["online_favourites_lockin", "buy_it_again_repeat", "tried_new_went_back", "own_brand_vs_branded",
          "trust_unknown_brand", "small_brand_listing", "buyer_meeting", "delisted", "say_do_healthy",
          "meal_deal", "chatgpt_shopping", "rufus_ai_bias", "shrinkflation_switch", "protein_gimmick",
          "impulse_instore_vs_online"]

IDS = """1kb3qj5,0 19dwzsy,0 ien9hn,0 xboxf7,0 1pz5jn3,0 1ro0hny,0 1iryyg2,0 1ovx87e,0 1qpajil,1 1rxetu2,1 1pmtqxt,1 qtbshl,1 17amn59,1 1q0mhl7,1 1nxc8xs,1 1hjtc5x,1 1ui9o6z,1 1haicfc,2 1dayfk7,2 1uosc29,2 1b4i3rn,3 178noq5,7 1p3q2ce,2 w16p18,2 nuaagu,2 1essgh0,2 13u6xww,3 vqe2sz,4 1ow5fne,3 1oy466h,3 1bq1qcm,3 r9e5bo,3 r38ifw,3 1s6g52a,3 1lidcyl,4 1q1ffjm,4 1wbyp1n,4 m2znm3,4 1buwayp,4 1jns9wh,4 r2udam,4 13i1ssb,4 1k7fys6,5 1u5ozi2,5 1srgd2g,5 1srgcly,5 1c2hhgr,5 koeowj,5 1q82o9c,5 179akww,5 1rt62t1,5 155oi06,6 14yoh96,6 l9j451,6 1fwmmzu,6 1o9b5tp,6 1sjasuc,6 1s8spmj,6 1o3q3ez,7 1e8k6o1,7 1v79v53,7 tgaw95,7 zbq597,7 189bm6e,7 1511znd,12 1hxrebw,7 1l225m,8 onllmx,8 1i6sx4v,8 141ixms,8 1vdsme2,8 1ctdsa7,8 1ln69mo,8 17bo8wt,8 1pf70di,8 1bc79kh,9 1d3amm2,9 1h1g0jq,9 1qazvyk,9 1pmmtcv,9 1k4ayi9,9 ss89i9,9 1umagm0,9 1d1lxjk,10 1vobhlt,10 1m9u7e6,10 1j9pozm,10 11q147q,10 1axlwyg,10 1wefie0,10 1hyqe97,10 1l7s96u,10 1vjypr7,10 1pjbs1p,10 1gmqm4a,11 1sp38qu,11 1rc3t5x,11 1u6kouq,11 1wsl7h9,11 1oxqnv6,11 1r8zg70,11 1rsb4zg,11 1roa2pp,11 1ajk04w,11 1scat6b,12 1oi5mf0,12 1tsbmt5,12 82m9zj,12 1s9qhp0,12 1qtc78s,12 eraymp,12 1tjgl9c,12 1qgcwyr,12 1wqczct,13 1oqtnv1,13 1tbf6zw,13 1rruybd,13 1q6qho0,13 191icpc,13 1sit7ev,13 1wmfkpi,13 1w6dwm8,13 1u6l4ix,13 1m43a3k,14 18jsjo5,14 11g8gs0,14 iz6kv,14 1slupta,14 1p23kqd,14 1m43ahw,14 123vm1c,14 18u2xec,14 1qv7q4o,14"""

BASE = "https://arctic-shift.photon-reddit.com/api"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "eathack-research/0.1"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                j = json.load(r)
            if j.get("data") is not None:
                return j["data"]
        except Exception:
            pass
        time.sleep(3 * (attempt + 1))
    return None


def flatten(children, depth=0, out=None):
    out = [] if out is None else out
    for c in children or []:
        if c.get("kind") != "t1":
            continue
        d = c["data"]
        body = d.get("body") or ""
        if len(body) > 30 and body not in ("[deleted]", "[removed]"):
            out.append({"depth": depth, "score": d.get("score"), "body": body})
        rep = d.get("replies")
        if isinstance(rep, dict):
            flatten(rep["data"]["children"], depth + 1, out)
    return out


def main():
    pairs = [p.split(",") for p in IDS.split()]
    with open("../data/reddit/reddit_threads.jsonl", "w") as f:
        for i, (tid, ti) in enumerate(pairs):
            post = get(f"{BASE}/posts/ids?ids={tid}") or [{}]
            p = post[0] if post else {}
            tree = get(f"{BASE}/comments/tree?link_id={tid}&limit=300") or []
            row = {"id": tid, "theme": THEMES[int(ti)], "sub": p.get("subreddit"), "title": p.get("title"),
                   "selftext": (p.get("selftext") or "")[:2000], "post_score": p.get("score"),
                   "url": f"https://www.reddit.com/comments/{tid}", "comments": flatten(tree)}
            f.write(json.dumps(row) + "\n"); f.flush()
            print(i, tid, row["sub"], len(row["comments"]), (row["title"] or "")[:70], flush=True)
            time.sleep(1.0)


if __name__ == "__main__":
    main()

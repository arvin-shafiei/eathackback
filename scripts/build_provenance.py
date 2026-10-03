#!/usr/bin/env python3
"""Build the "how was this persona made?" provenance data (rule zero: no black box).

Outputs (all under data/provenance/):
  graph.json          layered DAG for a Sankey / flow chart
                      subreddit -> thread -> theme -> mechanism -> persona -> persona attribute
  personas/<id>.json  every persona field -> classified sources + evidence mix (honesty meter)
  corpus_stats.json   corpus totals, mechanism counts, top verbatims, length histogram
  README.md           what each file is + matching methodology and its limits

Deterministic, stdlib only. Re-run: python3 scripts/build_provenance.py
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
from collections import Counter, defaultdict
from statistics import median

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731
OUT = P("data", "provenance")

# --------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------

def norm(s: str) -> str:
    s = (s or "").lower().replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def words25(s: str, n: int = 25) -> str:
    w = re.sub(r"\s+", " ", (s or "").strip()).split(" ")
    return " ".join(w[:n]) + (" ..." if len(w) > n else "")


def slug(s: str, n: int = 48) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:n]


REDDIT_RE = re.compile(r"https?://(?:www\.|old\.)?reddit\.com/(?:r/\w+/)?comments/([a-z0-9]+)", re.I)
URL_RE = re.compile(r"https?://[^\s'\")\]<>,;]+")
DOI_RE = re.compile(r"(?:doi\.org/|doi:\s?)(10\.\d{4,}/[^\s'\")\];,]+)", re.I)

# --------------------------------------------------------------------------------------
# load corpus
# --------------------------------------------------------------------------------------

threads = {r["thread_id"]: r for r in csv.DictReader(open(P("data/reddit/threads_index.csv"), encoding="utf-8"))}
for r in threads.values():
    r["post_score"] = int(r["post_score"] or 0)
    r["n_comments"] = int(r["n_comments"] or 0)
comments = list(csv.DictReader(open(P("data/reddit/comments.csv"), encoding="utf-8")))
for i, c in enumerate(comments):
    c["idx"] = i
    c["score"] = int(c["score"] or 0)
    c["depth"] = int(c["depth"] or 0)
    c["_n"] = norm(c["body"])
by_thread = defaultdict(list)
for c in comments:
    by_thread[c["thread_id"]].append(c)
# thread selftext/title (quotes are sometimes from the OP, not a comment)
posts = {}
if os.path.exists(P("data/reddit/reddit_threads.jsonl")):
    for line in open(P("data/reddit/reddit_threads.jsonl"), encoding="utf-8"):
        d = json.loads(line)
        posts[d["id"]] = norm((d.get("title") or "") + " " + (d.get("selftext") or ""))

coded = json.load(open(P("research/03-reddit-coded.json"), encoding="utf-8"))
THEMES = sorted({r["theme"] for r in threads.values()})


def theme_key(raw: str) -> str:
    for t in sorted(THEMES, key=len, reverse=True):
        if raw.startswith(t):
            return t
    return slug(raw.split(".")[0].split(":")[0])


def find_comment(quote: str, thread_ids=None):
    """Locate a quote in comments.csv (normalised substring of its longest fragment).
    Returns (comment|None, 'post'|None)."""
    frags = [norm(f) for f in re.split(r"\.\.\.|…|\[|\]", quote or "")]
    frags = sorted([f for f in frags if len(f) >= 15], key=len, reverse=True)
    if not frags:
        return None, None
    probe = frags[0][:90]
    pools = [by_thread.get(t, []) for t in thread_ids] if thread_ids else []
    pools.append(comments)
    best = None
    for pool in pools:
        hits = [c for c in pool if probe in c["_n"]]
        if hits:
            best = max(hits, key=lambda c: c["score"])
            return best, None
    if thread_ids:
        for t in thread_ids:
            if probe in posts.get(t, ""):
                return None, t
    return None, None


def comment_ref(c, quote=None):
    return {
        "url": c["thread_url"],
        "thread_id": c["thread_id"],
        "subreddit": c["subreddit"],
        "theme": c["theme"],
        "score": c["score"],
        "verbatim": words25(quote or c["body"]),
        "verified_in_corpus": True,
    }


# --------------------------------------------------------------------------------------
# mechanism families (canonical layer so the Sankey is legible). Ordered; keyword lists are
# the mapping rule and are written into graph.json so the mapping is inspectable.
# --------------------------------------------------------------------------------------
FAMILIES = [
    ("betrayal", "Betrayal aversion / hidden change (shrinkflation, reformulation)",
     ["betrayal", "deception", "shrinkflation", "skimpflation", "reformulat", "quality drift", "quality decline",
      "wetflation", "recipe change", "shrank", "shrunk", "smaller now", "lied", "quality fade"]),
    ("habit", "Habit, defaults and status-quo lock-in",
     ["habit", "status quo", "default", "automaticity", "lock-in", "lockin", "inertia", "routine", "autopilot",
      "favourites", "re-order", "reorder", "buy it again", "nostalgia", "loyal", "same brand", "every week"]),
    ("trust", "Trust heuristics (provenance, reviews, insiders, retailer halo)",
     ["trust", "provenance", "same factory", "insider", "review", "credib", "authentic", "halo", "manufacturer",
      "cheap talk", "own-label", "own label", "own brand"]),
    ("price", "Price anchoring, fairness and unit-price value",
     ["anchor", "reference price", "price fairness", "gouging", "dual entitlement", "unit price", "per 100g",
      "price per", "value-for-money", "value for money", "deal", "promotion", "offer", "drip pric", "price",
      "frugal", "cheap", "markup", "clubcard", "nectar"]),
    ("mental_accounting", "Mental accounting and budget constraints",
     ["mental accounting", "budget", "liquidity", "scarcity mindset", "payday", "banked", "treat slot"]),
    ("effort", "Effort, friction, time and cognitive offload",
     ["effort", "friction", "convenience", "time scarcity", "time-poor", "cognitive", "offload", "delegat",
      "quick", "faff", "lunch", "minutes"]),
    ("reactance", "Reactance and persuasion knowledge (gimmicks, manipulation)",
     ["reactance", "manipulat", "persuasion knowledge", "gimmick", "intrusive", "moralis", "redundant",
      "greenwash", "marketing", "con", "rip-off", "rip off", "sponsored"]),
    ("loss", "Loss aversion (delisting, waste, scarcity)",
     ["loss aversion", "endowment", "delist", "discontinued", "waste", "spoil", "scarcity", "stockpil",
      "out of stock", "out-of-stock"]),
    ("identity_ethics", "Identity, ethics and values screening",
     ["identity", "ethic", "values", "vegan", "plant-based", "local", "cruelty", "palm oil", "organic",
      "environment", "eco", "recycl", "plastic", "privacy", "british", "animal"]),
    ("health", "Health halo, ingredient and UPF cues",
     ["health halo", "health", "protein", "upf", "ultra-processed", "additive", "e-number", "e number",
      "ingredient", "nutri", "sugar", "sweetener", "emulsifier", "fibre", "calorie", "nova", "chemical"]),
    ("need_state", "Need-state missions (GLP-1, allergy, gym, diet)",
     ["glp-1", "glp1", "need-state", "need state", "appetite", "gym", "diabetic", "allergen", "allergy",
      "gluten", "coeliac", "celiac", "bariatric", "portion", "macro"]),
    ("sensory_control", "Sensory inspection and need for control",
     ["sensory", "taste", "texture", "control", "detectab", "inspection", "fresh produce", "picker",
      "substitution", "veto"]),
    ("novelty", "Novelty, discovery and impulse",
     ["novelty", "discovery", "hedonic", "impulse", "browsing", "treasure", "tiktok", "viral", "social media",
      "cue-triggered", "new flavour", "limited edition", "try new", "trial"]),
    ("social_proof", "Social proof, word of mouth and in-group",
     ["social proof", "reciprocity", "word of mouth", "in-group", "velocity", "mumsnet", "friends",
      "recommend", "underdog"]),
    ("ai_agent", "AI-agent delegation and agent trust",
     ["chatgpt", "rufus", "ai ", "agent", "assistant", "hallucinat", "llm", "alexa"]),
    ("self_control", "Self-control, precommitment and temporal discounting",
     ["precommitment", "self-control", "self control", "cooling-off", "temporal discounting", "restriction-rebound",
      "all-or-nothing", "self-binding", "sunk-cost", "hype regret", "trying new then going back"]),
    ("choice_architecture", "Choice architecture, visibility and availability",
     ["choice architecture", "shelf", "placement", "eye level", "eye-level", "layout", "choice overload",
      "availability", "visib", "position", "aisle", "notice"]),
]
FAM_LABEL = {k: lbl for k, lbl, _ in FAMILIES}


def _kw_pos(t: str, k: str) -> int:
    k = k.strip()
    if len(k) <= 4:  # short keywords need whole-word match ('con' must not hit 'control')
        m = re.search(r"\b" + re.escape(k) + r"\b", t)
        return m.start() if m else -1
    return t.find(k)


def family_of(text: str):
    """Return (family_key, matched_keyword, hits).
    Rule 1: in the lead phrase (text before the first '('), the family whose keyword appears EARLIEST wins
            (coders put the mechanism name first).
    Rule 2: otherwise the family with the most keyword hits over the full text; ties -> FAMILIES order."""
    t = " " + (text or "").lower() + " "
    head = t.split("(")[0]
    best = (None, None, 10 ** 9)
    for key, _lbl, kws in FAMILIES:
        for k in kws:
            pos = _kw_pos(head, k)
            if pos >= 0 and pos < best[2]:
                best = (key, k, pos)
    if best[0]:
        return best[0], best[1], 1
    best = (None, None, 0)
    for key, _lbl, kws in FAMILIES:
        hits = [k for k in kws if _kw_pos(t, k) >= 0]
        if len(hits) > best[2]:
            best = (key, hits[0], len(hits))
    return best


# coded mechanisms -> family; verbatims -> corpus comments
coded_mechs = []  # flat list
theme_threads = defaultdict(list)
for r in threads.values():
    theme_threads[r["theme"]].append(r["thread_id"])
for block in coded:
    tk = theme_key(block["theme"])
    for i, m in enumerate(block.get("mechanisms", [])):
        fam, kw, _ = family_of(m["mechanism"])
        method = f"keyword:'{kw}' in mechanism name" if fam else "no_keyword_match"
        if not fam:
            fam, kw, _ = family_of(m["mechanism"] + " " + m.get("what_people_do", ""))
            method = f"keyword:'{kw}' in what_people_do" if fam else "unmapped"
        vrefs = []
        for v in m.get("verbatims", []):
            q = re.sub(r"\s*\(r/\w+[^)]*\)\s*$", "", v).strip().strip('"').strip("“”")
            c, post_tid = find_comment(q, theme_threads[tk])
            if c:
                vrefs.append(comment_ref(c, q))
            elif post_tid:
                th = threads[post_tid]
                vrefs.append({"url": th["url"], "thread_id": post_tid, "subreddit": th["subreddit"], "theme": tk,
                              "score": th["post_score"], "verbatim": words25(q), "verified_in_corpus": True,
                              "note": "quote is from the original post"})
            else:
                sub = re.search(r"\(r/(\w+)", v)
                vrefs.append({"url": None, "subreddit": sub.group(1) if sub else None, "theme": tk, "score": None,
                              "verbatim": words25(q), "verified_in_corpus": False,
                              "note": "coder verbatim not found verbatim in comments.csv (paraphrase/edit)"})
        coded_mechs.append({
            "id": f"{tk}#{i}", "theme": tk, "mechanism": m["mechanism"], "approx_count": m.get("approx_count", 0),
            "what_people_do": m.get("what_people_do", ""), "family": fam or "other", "family_method": method,
            "verbatims": vrefs,
        })

# coded say/do, rejection, trust snippets used for inference of unsourced staged-persona items
coded_snippets = []
for block in coded:
    tk = theme_key(block["theme"])
    for sec in ("rejection_triggers", "trust_builders", "say_vs_do_gaps", "channel_differences", "surprising"):
        for s in block.get(sec, []) or []:
            coded_snippets.append({"theme": tk, "section": sec, "text": s if isinstance(s, str) else json.dumps(s)})
    for m in coded_mechs:
        pass
for m in coded_mechs:
    coded_snippets.append({"theme": m["theme"], "section": "mechanism", "text": m["mechanism"] + ". " + m["what_people_do"],
                           "mech_id": m["id"]})

STOP = set("""a an the and or of to in on for with is are was be it its this that as at by from not no but if
they them their she he her his i we you our your so do does did than then very more most less just only into out
up about over can will would should could have has had been being which who what when where how all any some one
two three per vs via also e g eg etc s t don doesn isn buy own get like make product products food item items
well actual really thing things people shop shopper shoppers""".split())


def toks(s):
    return {w[:6] for w in norm(s).split() if w not in STOP and len(w) > 2}


def infer_from_corpus(text: str):
    """Keyword-overlap inference for items that carry no explicit citation.
    Returns a source dict (class reddit_inferred) or None."""
    tt = toks(text)
    if len(tt) < 3:
        return None
    best, bs = None, 0.0
    for sn in coded_snippets:
        st = toks(sn["text"])
        inter = tt & st
        if len(inter) < 3:
            continue
        j = len(inter) / len(tt | st)
        if j > bs:
            best, bs = (sn, inter), j
    if not best or bs < 0.14:
        return None
    sn, inter = best
    ref = {"class": "reddit_inferred", "method": f"inferred:keyword_overlap(jaccard={bs:.2f}; shared={sorted(inter)[:6]})",
           "theme": sn["theme"], "coded_section": sn["section"], "coded_text": words25(sn["text"], 40)}
    if sn.get("mech_id"):
        m = next(x for x in coded_mechs if x["id"] == sn["mech_id"])
        v = next((v for v in m["verbatims"] if v.get("url")), None)
        if v:
            ref.update({"url": v["url"], "subreddit": v["subreddit"], "score": v["score"], "verbatim": v["verbatim"]})
    return ref


# --------------------------------------------------------------------------------------
# source-string classification
# --------------------------------------------------------------------------------------
PAPER_RE = re.compile(
    r"doi|10\.\d{4,}/|\bpmc\d*|pmc\.ncbi|ncbi\.nlm|pubmed|arxiv|et al|journal|\bj\.\s|proceedings|appetite\b|"
    r"food quality|psycholog|nutrients\b|lancet|bmj|plos|systematic review|meta-analysis|\bpers(onality)?\b.*\d{4}|"
    r"[A-Z][a-zà-ÿ]+(?:,? (?:&|and) [A-Z][a-zà-ÿ]+)*(?: et al\.?)?,? \(?(?:19|20)\d{2}\)?", re.I)
PAPER_RE_STRICT = re.compile(r"[A-Z][a-zà-ÿõ-]+(?:,? (?:[A-Z][a-zà-ÿ-]+,? )*(?:&|and) [A-Z][a-zà-ÿ-]+)?(?: et al\.?)?,? \(?(?:19|20)\d{2}\b")
SALES_RE = re.compile(r"nielsen|kantar|circana|the grocer|worldpanel|best-?sellers?|market share|data/sales|"
                      r"uk_products\.csv|rate of sale|epos|\bIRI\b|mintel|statista", re.I)
OFF_RE = re.compile(r"openfoodfacts|open food facts|\bOFF\b", re.I if False else 0)
STAGED_RE = re.compile(r"staged_personas|staged .{0,30}dossier|staged persona|verdict\.sim_param", re.I)
INTERNAL_RE = re.compile(r"research/0[0-9]|research/04|human mean|skeptic|05-personas|section 4c|CONTRACT\.md|"
                         r"data/personas/(?:lens|ocean)", re.I)
REDDIT_CORPUS_RE = re.compile(r"research/corpus/|03-reddit|comments\.csv|reddit_threads|r/[A-Za-z]\w+", re.I)
ASSUMP_RE = re.compile(r"assum|illustrative|invented|placeholder|guess|not used by the sim|no source|"
                       r"set so |chosen so |judg(e)?ment call|heuristic choice|plausible", re.I)
WEB_NAMES_RE = re.compile(r"mumsnet|moneysavingexpert|\bMSE\b|wikipedia|which\?|bbc|guardian|coeliac uk|"
                          r"fsa\b|food standards|trustpilot|tiktok\.com|youtube", re.I)
ACADEMIC_HOST = re.compile(r"doi\.org|ncbi\.nlm|pmc\.|arxiv\.org|sciencedirect|springer|wiley|tandfonline|"
                           r"nature\.com|bmj\.com|thelancet|mdpi|frontiersin|sagepub|jstor|academic\.oup|"
                           r"cambridge\.org/core|researchgate|ssrn|nber\.org|psycnet", re.I)

QUOTE_RE = re.compile(r"(?:^|[\s(:,])['\"‘“](.{12,}?)['\"’”](?=[\s),;.:]|$)")


def split_segments(text: str):
    # split on ';' and ' | ' but never inside a URL
    parts = re.split(r";\s+|\s+\|\s+", text or "")
    return [p.strip() for p in parts if p and p.strip()]


def classify_source(text: str, verbatims_by_url=None, field_hint=""):
    """Parse a free-text source string into classified source entries."""
    verbatims_by_url = verbatims_by_url or {}
    out = []
    if not text or not str(text).strip():
        return [{"class": "assumption", "method": "missing_source", "text": "no source given for this field"}]
    text = str(text)
    for seg in split_segments(text):
        got = False
        quotes = [q for q in QUOTE_RE.findall(seg)]
        # --- reddit urls
        rids = REDDIT_RE.findall(seg)
        for rid in dict.fromkeys(rids):
            got = True
            th = threads.get(rid)
            ref = None
            cands = quotes + verbatims_by_url.get(rid, [])
            for q in cands:
                c, post_tid = find_comment(q, [rid])
                if c and c["thread_id"] == rid:
                    ref = comment_ref(c, q)
                    ref["method"] = "url_match+quote_verified"
                    break
                if post_tid:
                    ref = {"url": th["url"], "thread_id": rid, "subreddit": th["subreddit"], "theme": th["theme"],
                           "score": th["post_score"], "verbatim": words25(q), "verified_in_corpus": True,
                           "method": "url_match+quote_in_post"}
                    break
            if not ref:
                if th:
                    ref = {"url": th["url"], "thread_id": rid, "subreddit": th["subreddit"], "theme": th["theme"],
                           "score": th["post_score"], "score_is": "post_score(thread)", "thread_title": th["title"],
                           "verbatim": words25(cands[0]) if cands else None,
                           "verified_in_corpus": False,
                           "method": "url_match(thread_only; quote not located)" if cands else "url_match(thread_only)"}
                else:
                    ref = {"url": f"https://www.reddit.com/comments/{rid}", "thread_id": rid, "subreddit": None,
                           "theme": None, "score": None, "verbatim": words25(quotes[0]) if quotes else None,
                           "verified_in_corpus": False, "method": "reddit_url_not_in_corpus"}
            ref["class"] = "reddit"
            out.append(ref)
        # --- corpus references without url
        if not rids and REDDIT_CORPUS_RE.search(seg):
            got = True
            out.append({"class": "reddit", "method": "corpus_reference(no url)", "text": words25(seg, 40),
                        "url": None, "verified_in_corpus": False})
        # --- other urls
        urls = [u for u in URL_RE.findall(seg) if "reddit.com" not in u]
        for u in urls:
            got = True
            if "openfoodfacts" in u:
                out.append({"class": "off_field", "method": "url:openfoodfacts", "url": u, "citation": words25(seg, 40)})
            elif ACADEMIC_HOST.search(u):
                out.append({"class": "paper", "method": "url:academic_host", "url": u, "citation": words25(seg, 40)})
            else:
                out.append({"class": "web_other", "method": "url:non_academic", "url": u, "citation": words25(seg, 40)})
        # --- textual doi / paper cites without academic url
        if not any(o.get("class") == "paper" for o in out[-len(urls):] if urls) and \
                (DOI_RE.search(seg) or PAPER_RE_STRICT.search(seg) or re.search(r"\bPMC\d+|arxiv|et al", seg)):
            if not (urls and all("openfoodfacts" in u for u in urls)):
                m = DOI_RE.search(seg)
                got = True
                out.append({"class": "paper", "method": "text:citation_pattern", "citation": words25(seg, 40),
                            "url": ("https://doi.org/" + m.group(1)) if m else None})
        sm = SALES_RE.search(seg)
        if sm:
            got = True
            if re.search(r"\d\s*%|£\s*\d|\d+(\.\d+)?\s*(m|bn)\b|share|sales|yoy|growth|\+\d", seg, re.I):
                out.append({"class": "sales_data", "method": f"keyword:'{sm.group(0)}'+figure",
                            "citation": words25(seg, 40)})
            else:  # e.g. a quote from The Grocer with no figure = trade press, not sales data
                out.append({"class": "web_other", "method": f"trade_press:'{sm.group(0)}'(no figure)",
                            "citation": words25(seg, 40)})
        if OFF_RE.search(seg) and not any("openfoodfacts" in u for u in urls):
            got = True
            out.append({"class": "off_field", "method": "keyword:'OFF'", "citation": words25(seg, 40)})
        if STAGED_RE.search(seg):
            got = True
            out.append({"class": "staged_persona", "method": "keyword:'staged_personas'", "citation": words25(seg, 40)})
        if not urls and WEB_NAMES_RE.search(seg) and not rids:
            got = True
            out.append({"class": "web_other", "method": f"keyword:'{WEB_NAMES_RE.search(seg).group(0)}'",
                        "citation": words25(seg, 40)})
        if INTERNAL_RE.search(seg):
            got = True
            out.append({"class": "internal_research", "method": f"keyword:'{INTERNAL_RE.search(seg).group(0)}'",
                        "citation": words25(seg, 40)})
        if ASSUMP_RE.search(seg):
            got = True
            out.append({"class": "assumption", "method": f"keyword:'{ASSUMP_RE.search(seg).group(0)}'",
                        "text": words25(seg, 40)})
        if not got:
            out.append({"class": "assumption", "method": "unclassified_text(no citation found)", "text": words25(seg, 40)})
    return out


CLASSES = ["reddit", "reddit_inferred", "paper", "off_field", "sales_data", "staged_persona", "web_other",
           "internal_research", "assumption"]
STRENGTH = {c: i for i, c in enumerate(["reddit", "paper", "sales_data", "off_field", "reddit_inferred",
                                         "web_other", "staged_persona", "internal_research", "assumption"])}


def finalise_field(f):
    cl = sorted({s["class"] for s in f["sources"]}, key=lambda c: STRENGTH[c])
    f["classes"] = cl
    f["class_share"] = {c: round(1 / len(cl), 4) for c in cl}
    f["primary_class"] = cl[0]
    return f


def evidence_mix(fields):
    tot = Counter()
    for f in fields:
        for c, w in f["class_share"].items():
            tot[c] += w
    n = len(fields) or 1
    raw = {c: 100 * tot[c] / n for c in CLASSES}
    # largest-remainder rounding to 1 dp so the shown numbers sum to exactly 100.0
    tenths = {c: int(raw[c] * 10) for c in CLASSES}
    rem = 1000 - sum(tenths.values())
    for c in sorted(CLASSES, key=lambda c: raw[c] * 10 - tenths[c], reverse=True)[:rem]:
        tenths[c] += 1
    mix = {c: tenths[c] / 10 for c in CLASSES}
    prim = Counter(f["primary_class"] for f in fields)
    anyc = Counter(c for f in fields for c in f["classes"])
    return {
        "method": "each field = 1 unit, split equally across the distinct source classes it cites; mix = mean over fields",
        "pct": mix,
        "headline": {
            "reddit": round(mix["reddit"] + mix["reddit_inferred"], 1),
            "paper": mix["paper"],
            "off_field": mix["off_field"],
            "assumption": mix["assumption"],
            "other (sales, staged, web, internal)": round(mix["sales_data"] + mix["staged_persona"] + mix["web_other"]
                                                          + mix["internal_research"], 1),
        },
        "n_fields": len(fields),
        "fields_by_primary_class": dict(prim),
        "pct_fields_with_any": {c: round(100 * anyc[c] / n, 1) for c in CLASSES if anyc[c]},
        "pct_fields_with_any_assumption": round(100 * anyc["assumption"] / n, 1),
    }


# --------------------------------------------------------------------------------------
# personas
# --------------------------------------------------------------------------------------
ocean_defs = {t: json.load(open(P("data/personas/ocean", f"{t}.json"), encoding="utf-8")) for t in "OCEAN"}


def ocean_prior_clause(trait, archetype):
    txt = json.dumps(ocean_defs[trait])
    m = re.search(re.escape(archetype) + r"\s*([+-]?\d[\d.]*)\s*(\([^)]*\))?", txt)
    if m:
        return f"data/personas/ocean/{trait}.json archetype prior: {archetype} {m.group(1)} {m.group(2) or ''}".strip()
    return None


def field(fid, kind, label, value, sources, extra=None):
    f = {"field": fid, "kind": kind, "label": label, "value": value, "sources": sources}
    if extra:
        f.update(extra)
    return finalise_field(f)


def build_lens_persona(path):
    x = json.load(open(path, encoding="utf-8"))
    vb = defaultdict(list)
    for v in x.get("verbatims", []):
        m = REDDIT_RE.search(v.get("url", "") or "")
        if m:
            vb[m.group(1)].append(v["quote"])
    F = []
    rel = os.path.relpath(path, ROOT)
    for k in ("budget_gbp", "channel", "mission", "household", "age"):
        if k not in x:
            continue
        sk = {"budget_gbp": "budget_source"}.get(k, f"{k}_source")
        src = x.get(sk)
        if src is None and k == "age":
            src = x.get("household_source")
        srcs = classify_source(src, vb) if src else [{"class": "assumption", "method": "missing_source",
                                                       "text": f"no {sk} in {rel}"}]
        F.append(field(f"profile.{k}", "profile", k, x[k], srcs))
    for i, l in enumerate(x.get("lens", [])):
        F.append(field(f"lens.{l['attribute']}", "lens_weight", f"lens: {l['attribute']} (w={l.get('weight')})",
                       l.get("weight"), classify_source(l.get("source"), vb),
                       {"measured_by_off_field": l.get("off_field"), "direction": l.get("direction"),
                        "why": l.get("why")}))
    if x.get("lens_weights_source"):
        F.append(field("lens._weights", "lens_weight", "lens weight magnitudes (rank/scale)",
                       x.get("lens_weights_sum"), classify_source(x["lens_weights_source"], vb)))
    for g in x.get("hard_gates", []) or []:
        F.append(field(f"gate.{g['gate']}", "trigger", f"hard gate: {g['gate']}", g.get("rule"),
                       classify_source(g.get("source"), vb)))
    for t in "OCEAN":
        if t not in (x.get("ocean") or {}):
            continue
        effs = [e for e in x.get("ocean_effects", []) if e.get("trait") == t]
        srcs = []
        for e in effs:
            if e.get("justification"):
                srcs += classify_source(e["justification"], vb)
        clause = ocean_prior_clause(t, x.get("archetype", ""))
        if clause:
            srcs.append({"class": "internal_research", "method": "ocean_prior_table", "citation": clause})
        srcs.append({"class": "assumption", "method": "hand_set_score",
                     "text": f"trait score {x['ocean'][t]} set by hand for the archetype; no psychometric measurement"})
        F.append(field(f"ocean.{t}", "ocean_trait", f"OCEAN {t} = {x['ocean'][t]}", x["ocean"][t], srcs))
        for j, e in enumerate(effs):
            s = classify_source(e.get("source"), vb)
            if e.get("coef_source"):
                s += classify_source(e["coef_source"], vb)
            F.append(field(f"ocean_effect.{t}.{j}", "ocean_trait", f"OCEAN {t} effect (coef={e.get('coef')})",
                           e.get("coef"), s, {"effect": e.get("effect")}))
    for sec, key, kind in (("rejection_triggers", "trigger", "trigger"), ("trust_signals", "signal", "trust_signal"),
                           ("habits", "habit", "habit")):
        for i, it in enumerate(x.get(sec, []) or []):
            F.append(field(f"{sec}[{i}]", kind, words25(it.get(key, ""), 12), it.get(key),
                           classify_source(it.get("source"), vb),
                           {"off_check": it["off_check"]} if it.get("off_check") else None))
    sps = x.get("sim_params_sources") or {}
    for k, v in (x.get("sim_params") or {}).items():
        F.append(field(f"sim_params.{k}", "sim_param", f"{k} = {v}", v, classify_source(sps.get(k), vb)))
    return {
        "persona_id": x["id"], "name": x.get("name"), "archetype": x.get("archetype"), "kind": "lens",
        "source_file": rel, "fields": F,
        "verbatims": [{"quote": words25(v["quote"], 40), "url": v.get("url"),
                       **({"subreddit": v["subreddit"], "score": v["score"]} if v.get("subreddit") else {})}
                      for v in x.get("verbatims", [])],
        "built_from": x.get("built_from"),
    }


def build_staged_persona(i, p):
    d = p["dossier"]
    name = p["persona"]["name"]
    pid = "staged_" + slug(name)
    F = []

    def src_or_infer(text, extra_text=None):
        s = classify_source(text) if text else []
        cited = [x for x in s if not x["method"].startswith(("unclassified", "missing"))]
        if cited:
            return s
        inf = infer_from_corpus(extra_text or text or "")
        if inf:
            return [inf]
        return [{"class": "assumption", "method": "no_citation_and_no_corpus_match",
                 "text": words25(extra_text or text or "", 30)}]

    for j, b in enumerate(d.get("behavioural_drivers", [])):
        s = classify_source(b.get("evidence_verbatim"))
        if not [x for x in s if not x["method"].startswith(("unclassified", "missing"))]:
            s = src_or_infer(None, b["principle"] + " " + (b.get("evidence_verbatim") or ""))
        F.append(field(f"behavioural_drivers[{j}]", "lens_weight",
                       f"driver: {words25(b['principle'], 10)} (w={b.get('weight_0_1')})", b.get("weight_0_1"), s,
                       {"principle": b["principle"]}))
    for sec, kind in (("rejection_triggers", "trigger"), ("trust_signals", "trust_signal"), ("missions", "habit")):
        for j, t in enumerate(d.get(sec, []) or []):
            t = t if isinstance(t, str) else json.dumps(t)
            F.append(field(f"{sec}[{j}]", kind, words25(t, 12), t, src_or_infer(t, t)))
    if d.get("says_vs_does"):
        F.append(field("says_vs_does", "habit", "says vs does", words25(d["says_vs_does"], 30),
                       src_or_infer(d["says_vs_does"], d["says_vs_does"])))
    for k, v in (p.get("verdict", {}).get("sim_parameters") or {}).items():
        F.append(field(f"sim_params.{k}", "sim_param", f"{k} = {v}", v, [
            {"class": "assumption", "method": "skeptic_calibrated_prior",
             "text": "set by the LLM skeptic verdict pass; research/05-personas.md section 6 says 'treat every number as a prior'"},
            {"class": "internal_research", "method": "table:research/05-personas.md section 4c",
             "citation": "research/05-personas.md section 4c per-persona parameter table (skeptic-calibrated)"}]))
    return {
        "persona_id": pid, "name": name, "archetype": p["persona"].get("role"), "kind": "staged",
        "source_file": f"data/personas/staged_personas_v1.json[{i}]", "fields": F,
        "persona_level_evidence": {
            "realism_score_1_10": p.get("verdict", {}).get("realism_score_1_10"),
            "supporting_evidence": [words25(s, 40) for s in p.get("verdict", {}).get("supporting_evidence", [])],
            "unrealistic_claims_flagged_by_skeptic": len(p.get("verdict", {}).get("unrealistic_claims", [])),
        },
    }


personas = [build_lens_persona(f) for f in sorted(glob.glob(P("data/personas/lens/*.json")))]
staged = json.load(open(P("data/personas/staged_personas_v1.json"), encoding="utf-8"))
personas += [build_staged_persona(i, p) for i, p in enumerate(staged)]
for pp in personas:
    pp["evidence_mix"] = evidence_mix(pp["fields"])
    lens_f = [f for f in pp["fields"] if f["field"].startswith("lens.") and f["field"] != "lens._weights"]
    pp["evidence_mix"]["lens_fields_measured_by_off_field"] = {
        "n": sum(1 for f in lens_f if f.get("measured_by_off_field")), "of": len(lens_f),
        "note": "OFF defines WHAT a lens attribute measures on the product; it is not evidence for WHY the weight is "
                "what it is, so it is reported here and not counted in the mix unless the source text cites OFF"}

# --------------------------------------------------------------------------------------
# graph
# --------------------------------------------------------------------------------------
LAYERS = ["subreddit", "thread", "theme", "mechanism", "persona", "attribute"]
nodes, links = {}, []


def node(nid, layer, label, count=0, url=None, **kw):
    if nid not in nodes:
        nodes[nid] = {"id": nid, "layer": LAYERS.index(layer), "layer_name": layer, "label": label, "count": 0}
        if url:
            nodes[nid]["url"] = url
        nodes[nid].update(kw)
    nodes[nid]["count"] += count
    return nid


def ev_comment(c):
    return {"verbatim": words25(c["body"]), "url": c["thread_url"], "score": c["score"], "subreddit": c["subreddit"]}


sub_comments = Counter(c["subreddit"] for c in comments)
for tid, th in threads.items():
    cs = by_thread.get(tid, [])
    s = node(f"sub:{th['subreddit']}", "subreddit", f"r/{th['subreddit']}", 0, f"https://www.reddit.com/r/{th['subreddit']}")
    t = node(f"thr:{tid}", "thread", words25(th["title"], 12), len(cs), th["url"], post_score=th["post_score"],
             theme=th["theme"], subreddit=th["subreddit"])
    top = sorted(cs, key=lambda c: -c["score"])[:2]
    ev = [ev_comment(c) for c in top] or [{"verbatim": words25(th["title"]), "url": th["url"], "score": th["post_score"]}]
    links.append({"source": s, "target": t, "value": max(len(cs), 1), "value_unit": "comments",
                  "method": "corpus_structure(thread posted in subreddit)", "evidence": ev})
    tm = node(f"theme:{th['theme']}", "theme", th["theme"].replace("_", " "), 0)
    links.append({"source": t, "target": tm, "value": max(len(cs), 1), "value_unit": "comments",
                  "method": "corpus_structure(thread collected under theme search)", "evidence": ev[:1]})
for s, n in sub_comments.items():
    nodes[f"sub:{s}"]["count"] = n
for tk in THEMES:
    if f"theme:{tk}" in nodes:
        nodes[f"theme:{tk}"]["count"] = sum(len(by_thread[t]) for t in theme_threads[tk])

# theme -> mechanism family (value = summed coded approx_count)
fam_members = defaultdict(list)
agg = defaultdict(lambda: {"value": 0, "members": [], "ev": []})
for m in coded_mechs:
    fam_members[m["family"]].append(m["id"])
    a = agg[(m["theme"], m["family"])]
    a["value"] += m["approx_count"]
    a["members"].append({"mechanism": m["mechanism"], "approx_count": m["approx_count"], "method": m["family_method"]})
    a["ev"] += [v for v in m["verbatims"] if v.get("url")] or m["verbatims"]
for (tk, fam), a in agg.items():
    mid = node(f"mech:{fam}", "mechanism", FAM_LABEL.get(fam, fam), a["value"], family=fam)
    ev = sorted(a["ev"], key=lambda v: -(v.get("score") or -1))[:3]
    ev = [{"verbatim": v["verbatim"], "url": v.get("url"), "score": v.get("score"), "subreddit": v.get("subreddit"),
           "verified_in_corpus": v.get("verified_in_corpus")} for v in ev]
    links.append({"source": f"theme:{tk}", "target": mid, "value": a["value"], "value_unit": "coded_approx_count",
                  "method": "coded:research/03-reddit-coded.json; family by " +
                            "; ".join(sorted({x["method"] for x in a["members"]})),
                  "coded_mechanisms": a["members"], "evidence": ev})

# non-reddit source nodes on the mechanism layer (explicit, never hidden)
SRC_NODES = {
    "paper": "Academic papers (not Reddit)",
    "off_field": "Open Food Facts field definitions",
    "sales_data": "Sales / market data (Kantar, NielsenIQ, The Grocer...)",
    "staged_persona": "Staged persona dossier (LLM-written, reviewed)",
    "web_other": "Other web (Mumsnet, MSE, news, Wikipedia)",
    "internal_research": "Internal research synthesis (research/*.md tables)",
    "assumption": "Unattributed / assumption",
}

for pp in personas:
    pn = node(f"persona:{pp['persona_id']}", "persona", f"{pp.get('name')} ({pp['persona_id']})", 0,
              kind=pp["kind"], evidence_mix=pp["evidence_mix"]["headline"])
    inflow = defaultdict(lambda: {"value": 0, "ev": [], "methods": Counter(), "fields": [], "themes": Counter(),
                                  "threads": set()})
    for f in pp["fields"]:
        aid = f"attr:{pp['persona_id']}:{f['field']}"
        node(aid, "attribute", f["label"], 1, kind=f["kind"], primary_class=f["primary_class"], persona=pp["persona_id"])
        nodes[pn]["count"] += 1
        best = sorted(f["sources"], key=lambda s: STRENGTH[s["class"]])[0]
        reddit_srcs = [s for s in f["sources"] if s["class"] in ("reddit", "reddit_inferred")]
        txt = " ".join(str(v) for v in (f["label"], f.get("value"), f.get("why"), f.get("principle"), f.get("effect"))
                       if v) + " " + " ".join(s.get("verbatim") or "" for s in reddit_srcs)
        if reddit_srcs:
            fam, kw, _ = family_of(txt)
            if fam:
                method = f"keyword:'{kw}'"
            else:
                th = next((s.get("theme") for s in reddit_srcs if s.get("theme")), None)
                cands = [(a["value"], fam_) for (tk, fam_), a in agg.items() if tk == th]
                fam = max(cands)[1] if cands else None
                method = f"url_match->theme:{th}->top_mechanism" if fam else "unattributed:reddit_source_without_theme_or_keyword"
            if reddit_srcs[0]["class"] == "reddit_inferred":
                method = reddit_srcs[0]["method"].split("(")[0] + "+" + method
            elif any(s.get("thread_id") for s in reddit_srcs):
                method = "url_match+" + method
            src_node = f"mech:{fam}" if fam else "src:assumption"
        else:
            src_node = f"src:{best['class']}"
            method = best["method"] if best["class"] != "assumption" else "unattributed:" + best["method"]
        if src_node.startswith("src:"):
            node(src_node, "mechanism", SRC_NODES[src_node[4:]], 0, source_class=src_node[4:])
        elif src_node not in nodes:
            node(src_node, "mechanism", FAM_LABEL.get(src_node[5:], src_node[5:]), 0, family=src_node[5:])
        e = []
        for s in sorted(f["sources"], key=lambda s: STRENGTH[s["class"]])[:3]:
            e.append({"verbatim": s.get("verbatim") or s.get("citation") or s.get("text") or s.get("coded_text")
                                  or (("thread title: " + words25(s["thread_title"], 20)) if s.get("thread_title") else None),
                      "url": s.get("url"), "class": s["class"], **({"score": s["score"]} if s.get("score") is not None else {}),
                      **({"subreddit": s["subreddit"]} if s.get("subreddit") else {})})
        e = [x for x in e if x["verbatim"]] or [{"verbatim": words25(str(f.get("value"))), "url": None,
                                                 "class": f["primary_class"]}]
        links.append({"source": pn, "target": aid, "value": 1, "value_unit": "attribute",
                      "method": f"primary_class:{f['primary_class']} ({best['method']})", "evidence": e[:2],
                      "classes": f["classes"]})
        a = inflow[src_node]
        a["value"] += 1
        a["methods"][method] += 1
        a["fields"].append(f["field"])
        a["ev"] += e[:1]
        for s_ in reddit_srcs:
            if s_.get("theme"):
                a["themes"][s_["theme"]] += 1
            if s_.get("thread_id"):
                a["threads"].add(s_["thread_id"])
    for src_node, a in inflow.items():
        ev = sorted(a["ev"], key=lambda v: -(v.get("score") or 0))[:4]
        links.append({"source": src_node, "target": pn, "value": a["value"], "value_unit": "attributes",
                      "method": "; ".join(f"{m} x{n}" for m, n in a["methods"].most_common()),
                      "fields": a["fields"], "via_themes": dict(a["themes"]),
                      "via_thread_ids": sorted(a["threads"]), "evidence": ev})

for nid in [n for n in nodes if n.startswith("src:")]:
    nodes[nid]["count"] = sum(l["value"] for l in links if l["source"] == nid)

for l in links:  # hard cap: graph evidence is <= 25 words
    for e in l["evidence"]:
        v = re.sub(r"\s*\.\.\.$", "", e["verbatim"] or "")
        if len(v.split()) > 25:
            e["verbatim"] = words25(v)

graph = {
    "generated_by": "scripts/build_provenance.py",
    "layers": LAYERS,
    "value_units": {
        "subreddit->thread, thread->theme": "comments in data/reddit/comments.csv",
        "theme->mechanism": "summed approx_count of coded mechanisms (research/03-reddit-coded.json)",
        "mechanism->persona": "number of persona attributes whose strongest evidence flows through that node",
        "persona->attribute": "1 per attribute",
        "note": "units differ between layer pairs; normalise widths per layer pair when drawing",
    },
    "mechanism_families": [{"id": f"mech:{k}", "label": l, "keywords": kws, "coded_members": fam_members.get(k, [])}
                           for k, l, kws in FAMILIES],
    "source_nodes": {f"src:{k}": v for k, v in SRC_NODES.items()},
    "nodes": list(nodes.values()),
    "links": links,
}

# --------------------------------------------------------------------------------------
# corpus stats
# --------------------------------------------------------------------------------------
by_sub = defaultdict(lambda: {"threads": 0, "comments": 0, "sum_comment_score": 0})
for th in threads.values():
    by_sub[th["subreddit"]]["threads"] += 1
for c in comments:
    b = by_sub[c["subreddit"]]
    b["comments"] += 1
    b["sum_comment_score"] += c["score"]
by_theme = {}
for tk in THEMES:
    cs = [c for t in theme_threads[tk] for c in by_thread[t]]
    blk = next((b for b in coded if theme_key(b["theme"]) == tk), None)
    by_theme[tk] = {"threads": len(theme_threads[tk]), "comments": len(cs),
                    "subreddits": dict(Counter(c["subreddit"] for c in cs).most_common()),
                    "coded_comments_read": blk.get("n_comments_read") if blk else None,
                    "coder_caveat": (blk["theme"][len(tk):].lstrip(" .:")[:400] or None) if blk else None}

fam_kws = {k: kws for k, _l, kws in FAMILIES}
mech_stats = []
for m in coded_mechs:
    v = sorted([x for x in m["verbatims"] if x.get("url")], key=lambda x: -(x.get("score") or 0))
    v = [dict(x, selection="coder_verbatim") for x in v]
    seen = {x["verbatim"] for x in v}
    if len(v) < 5:
        kws = fam_kws.get(m["family"], [])
        pool = [c for t in theme_threads[m["theme"]] for c in by_thread[t]
                if any(k in c["body"].lower() for k in kws) and 6 <= len(c["body"].split()) <= 120]
        for c in sorted(pool, key=lambda c: -c["score"]):
            if len(v) >= 5:
                break
            r = comment_ref(c)
            if r["verbatim"] in seen:
                continue
            seen.add(r["verbatim"])
            r["selection"] = f"keyword_supplement(family '{m['family']}' keywords, same theme)"
            v.append(r)
    mech_stats.append({"id": m["id"], "theme": m["theme"], "mechanism": m["mechanism"], "family": m["family"],
                       "family_method": m["family_method"], "approx_count": m["approx_count"],
                       "coder_verbatims_located": sum(1 for x in m["verbatims"] if x.get("url")),
                       "coder_verbatims_total": len(m["verbatims"]), "top_verbatims": v[:5]})
fam_tot = Counter()
for m in coded_mechs:
    fam_tot[m["family"]] += m["approx_count"]
lengths = [len(c["body"].split()) for c in comments]
bins = [0, 5, 10, 20, 40, 80, 160, 320, 10 ** 9]
hist = []
for lo, hi in zip(bins, bins[1:]):
    hist.append({"words_from": lo, "words_to": (hi - 1) if hi < 10 ** 9 else None,
                 "comments": sum(1 for n in lengths if lo <= n < hi)})
ids36 = sorted(threads, key=lambda s: int(s, 36))
corpus_stats = {
    "generated_by": "scripts/build_provenance.py",
    "totals": {"threads": len(threads), "comments": len(comments), "subreddits": len(by_sub), "themes": len(THEMES),
               "coded_mechanisms": len(coded_mechs), "coded_approx_count_sum": sum(m["approx_count"] for m in coded_mechs),
               "coder_verbatims": sum(len(m["verbatims"]) for m in coded_mechs),
               "coder_verbatims_located_in_corpus": sum(1 for m in coded_mechs for v in m["verbatims"] if v.get("url"))},
    "by_subreddit": dict(sorted(by_sub.items(), key=lambda kv: -kv[1]["comments"])),
    "by_theme": by_theme,
    "by_mechanism_family": [{"family": k, "label": FAM_LABEL.get(k, k), "approx_count": n,
                             "coded_mechanisms": len(fam_members[k])} for k, n in fam_tot.most_common()],
    "by_mechanism": mech_stats,
    "comment_length_words": {"histogram": hist, "median": median(lengths), "mean": round(sum(lengths) / len(lengths), 1),
                             "max": max(lengths)},
    "comment_score": {"median": median(c["score"] for c in comments), "max": max(c["score"] for c in comments),
                      "depth0_share": round(sum(1 for c in comments if c["depth"] == 0) / len(comments), 3)},
    "date_range": {"derivable": False,
                   "why": "neither comments.csv, threads_index.csv nor the raw thread JSON carries created_utc; "
                          "only base36 post ids, which increase monotonically with time",
                   "oldest_thread_by_id": {"id": ids36[0], "url": threads[ids36[0]]["url"]},
                   "newest_thread_by_id": {"id": ids36[-1], "url": threads[ids36[-1]]["url"]}},
}

# --------------------------------------------------------------------------------------
# write
# --------------------------------------------------------------------------------------
os.makedirs(P("data/provenance/personas"), exist_ok=True)
for f in glob.glob(P("data/provenance/personas/*.json")):
    os.remove(f)
for pp in personas:
    json.dump(pp, open(P("data/provenance/personas", pp["persona_id"] + ".json"), "w", encoding="utf-8"),
              indent=1, ensure_ascii=False)
json.dump({"personas": [{"persona_id": pp["persona_id"], "name": pp["name"], "kind": pp["kind"],
                         "n_fields": len(pp["fields"]), "evidence_mix": pp["evidence_mix"]["pct"],
                         "headline": pp["evidence_mix"]["headline"]} for pp in personas]},
          open(P("data/provenance/personas/index.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
json.dump(graph, open(P("data/provenance/graph.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
json.dump(corpus_stats, open(P("data/provenance/corpus_stats.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

# --------------------------------------------------------------------------------------
# sanity checks (fail loudly)
# --------------------------------------------------------------------------------------
problems = []
expect = {json.load(open(f))["id"] for f in glob.glob(P("data/personas/lens/*.json"))} | \
         {"staged_" + slug(p["persona"]["name"]) for p in staged}
have = {os.path.basename(f)[:-5] for f in glob.glob(P("data/provenance/personas/*.json"))} - {"index"}
if expect - have:
    problems.append(f"missing persona files: {sorted(expect - have)}")
for pp in personas:
    s = round(sum(pp["evidence_mix"]["pct"].values()), 1)
    if abs(s - 100.0) > 0.05:
        problems.append(f"{pp['persona_id']} evidence mix sums to {s}")
    for f in pp["fields"]:
        if not f["sources"]:
            problems.append(f"{pp['persona_id']}.{f['field']} has no sources")
for l in links:
    if not l.get("method"):
        problems.append(f"link without method {l['source']}->{l['target']}")
    if any(len(re.sub(r"\s*\.\.\.$", "", e.get("verbatim") or "").split()) > 25 for e in l.get("evidence") or []):
        problems.append(f"evidence over 25 words {l['source']}->{l['target']}")
    if not l.get("evidence") or not all(e.get("verbatim") for e in l["evidence"]):
        problems.append(f"link without evidence {l['source']}->{l['target']}")
    if l["source"] not in nodes or l["target"] not in nodes:
        problems.append(f"dangling link {l['source']}->{l['target']}")
    if nodes[l["source"]]["layer"] >= nodes[l["target"]]["layer"]:
        problems.append(f"non-forward link {l['source']}->{l['target']}")

print(f"nodes={len(nodes)} links={len(links)} personas={len(personas)}")
print(f"coder verbatims located: {corpus_stats['totals']['coder_verbatims_located_in_corpus']}/"
      f"{corpus_stats['totals']['coder_verbatims']}")
for pp in personas:
    h = pp["evidence_mix"]["headline"]
    print(f"  {pp['persona_id']:<42} n={len(pp['fields']):>3}  " + ", ".join(f"{v:.0f}% {k}" for k, v in h.items()))
if problems:
    print("PROBLEMS:")
    for p_ in problems[:50]:
        print("  -", p_)
    raise SystemExit(1)
print("sanity checks passed")

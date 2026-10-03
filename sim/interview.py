"""Interview the shoppers who met a product: answers built ONLY from the recorded run events (rule zero: no black box).

Two paths:
  evidence (free, default): every answer is a first-person sentence assembled from one shopper's recorded event
      (stage_reached, p_pick_up, the take distribution, triggers fired with p, appeal, mechanism, verbatim + url)
      and their persona file. Nothing is generated. Mirrored client-side in web/src/ui/InterviewSection.tsx.
  what-if (costs, Jev): for each interviewee, two System One requests via sim/jev.py ask() (disk-cached):
      the product card as recorded (baseline) and the card with the change described in words. Same questions in
      both, so the delta is like-for-like. If TypeSafe answers 402, ask() falls back to the OpenRouter jev-router,
      which is NOT calibrated: every answer says which engine produced it.

CLI:  python sim/interview.py <run_id> <product_code> [--whatif "at £1.20?"] [--agents a001,a006]
"""
from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import jev  # noqa: E402
import run as simrun  # noqa: E402

STAGE_RANK = {"taken": 3, "put_back": 2, "looked": 1, "not_noticed": 0}
GROUP_OF = {"taken": "bought", "put_back": "put_back", "looked": "walked_past", "not_noticed": "never_noticed"}
GROUP_TEXT = {"bought": "bought it", "put_back": "picked up & put back", "walked_past": "looked & walked past",
              "never_noticed": "never noticed"}
QUESTIONS = {
    "why_back": "why did you put it back?",
    "why_pick": "what made you pick it up?",
    "change": "what would change your mind?",
    "saw": "did you even see it?",
}


# ---------------------------------------------------------------- recorded evidence
def load_run(run_id: str) -> dict:
    fp = os.path.join(simrun.RUNS_DIR, os.path.basename(run_id) + ".json")
    with open(fp) as f:
        r = json.load(f)
    r["_file"] = os.path.relpath(fp, simrun.ROOT)
    return r


def _stage(e: dict) -> str:
    s = e.get("stage_reached")
    if s in STAGE_RANK:
        return s
    return {"pick": "taken", "reject": "put_back", "walk_past": "looked"}.get(e.get("decision"), "not_noticed")


def _secondary(e: dict) -> bool:
    return bool(e.get("secondary")) or str(e.get("reason") or "").startswith("(secondary")


def meetings(run: dict, code: str) -> list[dict]:
    """One row per human shopper who passed the product: their furthest-reaching recorded event."""
    out = []
    for a in run.get("agents", []):
        if a.get("kind") == "ai_agent" or str(a.get("persona_id", "")).startswith("ai_") or a.get("persona_id") in (
                "p_ai_assistant_general", "p_ai_retailer_assistant", "p_ai_price_bot"):
            continue
        evs = [e for e in a.get("events", []) if e.get("product") == code and e.get("mechanism") != "error"]
        if not evs:
            continue
        e = max(evs, key=lambda x: (STAGE_RANK[_stage(x)], not _secondary(x)))
        out.append({"agent": a, "event": e, "group": GROUP_OF[_stage(e)]})
    return out


def pick_interviewees(rows: list[dict], n: int = 6) -> list[dict]:
    """Round-robin over the four groups (largest first), one persona each where possible, so the panel mixes outcomes."""
    by = {g: [r for r in rows if r["group"] == g] for g in GROUP_TEXT}
    order = sorted(by, key=lambda g: -len(by[g]))
    seen_p, out = set(), []
    while len(out) < n and any(by.values()):
        for g in order:
            if len(out) >= n:
                break
            pool = by[g]
            if not pool:
                continue
            fresh = [r for r in pool if r["agent"]["persona_id"] not in seen_p and r["event"].get("jev") is not None] or \
                    [r for r in pool if r["agent"]["persona_id"] not in seen_p] or pool
            r = fresh[0]
            pool.remove(r)
            seen_p.add(r["agent"]["persona_id"])
            out.append(r)
    return out


def _p(x) -> str:
    return f"{float(x):.2f}" if isinstance(x, (int, float)) else "?"


def _take_p(e: dict):
    j = e.get("jev") or {}
    d = (j.get("decision") or {}).get("probabilities") or {}
    return d.get(j.get("self")) if j.get("self") else None


def _fired(e: dict, kind: str) -> list[dict]:
    f = (e.get("jev") or {}).get("nouls_fired") or {}
    return sorted([{"key": k, **v} for k, v in f.items() if k.startswith(kind)], key=lambda x: -float(x.get("p") or 0))


def _missing_trust(e: dict, persona: dict) -> list[dict]:
    n = (e.get("jev") or {}).get("nouls") or {}
    out = []
    for k, p in n.items():
        m = re.match(r"trust_(\d+)$", k)
        if m and float(p) < jev.NOUL_FIRES:
            ts = (persona.get("trust_signals") or [])
            i = int(m.group(1))
            if i < len(ts):
                out.append({"key": k, "text": jev._txt(ts[i], "signal", "trust"), "p": p})
    return sorted(out, key=lambda x: float(x["p"]))


def answer(agent: dict, e: dict, persona: dict, qid: str, run_file: str) -> dict:
    """First-person answer from the record only. Returns {text, inferred, fields, files}."""
    st = _stage(e)
    j = e.get("jev") or {}
    nf = e.get("notice_factors") or {}
    fields: dict = {}
    pick = e.get("p_pick_up")
    take = _take_p(e)
    trig = _fired(e, "trigger")
    ap = j.get("appeal") or {}
    mech = j.get("mechanism") or {}
    verb = e.get("verbatim") or None
    inferred = False

    def quote():
        if verb and verb.get("quote"):
            fields["verbatim"] = verb
            q = verb["quote"]
            return f" like someone on reddit said: '{q[:160]}{'…' if len(q) > 160 else ''}' ({verb.get('url', '')})"
        return ""

    if qid == "saw":
        fields.update(p_notice=e.get("p_notice"), noticed=e.get("noticed"), row=nf.get("row"), facings=nf.get("facings"),
                      on_mission=nf.get("on_mission"))
        where = f"{nf.get('row', '?')} shelf, {nf.get('facings', '?')} facing{'s' if nf.get('facings') != 1 else ''}, " \
                f"{'on my list today' if nf.get('on_mission') else 'not on my list today'}"
        text = (f"yes, I noticed it (P notice {_p(e.get('p_notice'))}; {where})." if e.get("noticed") else
                f"no. I had a P {_p(e.get('p_notice'))} chance of noticing it ({where}) and I missed it.")
    elif qid == "why_pick":
        fields.update(stage_reached=st, p_pick_up=pick, picked_up=e.get("picked_up"))
        if st in ("taken", "put_back"):
            bits = [f"I picked it up (P {_p(pick)})"]
            if mech.get("choice"):
                mp = (mech.get("probabilities") or {}).get(mech["choice"])
                fields["mechanism"] = {"choice": mech["choice"], "p": mp}
                bits.append(f"the reaction jev named was {mech['choice'].replace('_', ' ')} (p {_p(mp)})")
            if ap:
                fields["appeal"] = {"level": ap.get("level"), "score": ap.get("score")}
                bits.append(f"I felt '{jev.APPEAL_SHORT[int(ap.get('level', 2))]}' about it ({_p(ap.get('score'))}/4)")
            tr = _fired(e, "trust")
            if tr:
                fields["trust_fired"] = tr
                bits.append(f"and it showed something I trust: {tr[0]['text']} (p {_p(tr[0].get('p'))})")
            text = ", ".join(bits) + "."
        elif st == "looked":
            text = f"I didn't. I looked at it but only had a P {_p(pick)} of picking it up, and the draw said no."
        else:
            text = "I didn't. I never noticed it on the shelf."
    elif qid == "why_back":
        fields.update(stage_reached=st, p_pick_up=pick, p_take=take)
        if st == "put_back":
            text = f"I picked it up (P {_p(pick)}) but put it back"
            if trig:
                fields["triggers_fired"] = trig
                text += f": it showed '{trig[0]['text']}' (p {_p(trig[0].get('p'))})"
            elif ap:
                fields["appeal"] = {"level": ap.get("level"), "p_dislike_or_avoid": ap.get("p_dislike_or_avoid")}
                text += f": none of my put-offs fired, but I only felt '{jev.APPEAL_SHORT[int(ap.get('level', 2))]}'"
            if take is not None:
                text += f". my chance of taking it was P {_p(take)}"
            text += "." + quote()
        elif st == "taken":
            text = f"I didn't put it back: I took it (P take {_p(take)})."
        elif st == "looked":
            text = f"I never had it in my hand: P pick up {_p(pick)}, and the draw said leave it."
        else:
            text = "I never saw it, so there was nothing to put back."
    else:  # change: inferred from what fired / what was missing in the record
        inferred = True
        fields.update(stage_reached=st)
        tips = []
        if st == "not_noticed":
            terms = nf.get("logit_terms") or {}
            neg = sorted([(k, v) for k, v in terms.items() if isinstance(v, (int, float)) and v < 0 and k != "alpha0"],
                         key=lambda kv: kv[1])
            fields.update(p_notice=e.get("p_notice"), logit_terms=terms)
            if neg:
                tips.append(f"being easier to see: the biggest drag on my noticing it was '{neg[0][0]}' ({neg[0][1]:+.2f} on the logit)")
            else:
                tips.append(f"being easier to see (P notice was {_p(e.get('p_notice'))})")
        for t in trig[:2]:
            fields.setdefault("triggers_fired", trig)
            tips.append(f"if it didn't show '{t['text']}' (p {_p(t.get('p'))})")
        miss = _missing_trust(e, persona)
        for t in miss[:1]:
            fields["trust_missing"] = miss
            tips.append(f"if it showed '{t['text']}' (it read as only p {_p(t.get('p'))})")
        if st == "taken" and not tips:
            tips.append("nothing: I took it")
        if not tips:
            tips.append("the record has no fired put-off or missing trust signal to point at")
        text = "; ".join(tips) + ". (inferred from my record, not asked.)"
    pfile = persona.get("_file") or f"data/personas/lens/{agent.get('archetype') or agent['persona_id'][2:]}.json"
    return {"q": QUESTIONS[qid], "text": text, "inferred": inferred, "fields": fields,
            "files": {"run": f"{run_file} → agents[{agent['agent_id']}].events[step {e.get('step')}]", "persona": pfile},
            "engine": e.get("jev_model") or e.get("engine")}


def panel(run_id: str, code: str, n: int = 6) -> dict:
    run = load_run(run_id)
    personas = {p["id"]: p for p in simrun.load_personas(include_ai=True)[0]}
    rows = meetings(run, code)
    counts = {g: sum(1 for r in rows if r["group"] == g) for g in GROUP_TEXT}
    picked = pick_interviewees(rows, n)
    out = []
    for r in picked:
        a, e = r["agent"], r["event"]
        pe = personas.get(a["persona_id"], {})
        out.append({"agent_id": a["agent_id"], "persona_id": a["persona_id"], "name": pe.get("name", a["persona_id"]),
                    "archetype": a.get("archetype") or pe.get("archetype"), "group": r["group"],
                    "answers": {q: answer(a, e, pe, q, run["_file"]) for q in QUESTIONS}})
    return {"run_id": run["run_id"], "product": code, "counts": counts, "interviewees": out}


# ---------------------------------------------------------------- what-if (Jev)
_PRICE = re.compile(r"£\s*(\d+(?:\.\d{1,2})?)|(\d+)\s*p\b")
_CLAIM = re.compile(r"(?:with|says|claims?)\s+(?:an?\s+)?['\"]?([a-z0-9 \-/%]+?)['\"]?\s*claim", re.I)
_SHELF = re.compile(r"\b(eye[- ]level|top|bottom)\s+shelf", re.I)


def _product(run: dict, code: str) -> dict:
    cat, _ = simrun.load_catalog()
    for x in run.get("catalog_inline") or []:
        cat[str(x["code"])] = x
    return cat, cat.get(code) or {"code": code, "name": code}


def apply_change(p: dict, set_items: list[dict], question: str) -> tuple[dict, list[dict], str, list[str]]:
    """Code parses the change; Jev only ever sees it in words. Returns (product', set', what_changed words, notes)."""
    notes = []
    m = _PRICE.search(question)
    if m:
        new = float(m.group(1)) if m.group(1) else int(m.group(2)) / 100
        p2 = {**p, "price_gbp": new}
        s2 = [p2 if q.get("code") == p.get("code") else q for q in set_items]
        prices = [float(q.get("price_gbp") or 0) for q in s2]
        old_w = jev.price_words(p.get("price_gbp"), [float(q.get("price_gbp") or 0) for q in set_items])
        return p2, s2, f"the price has changed: it was {old_w}; now it is {jev.price_words(new, prices)}", notes
    m = _CLAIM.search(question)
    if m:
        claim = m.group(1).strip()
        p2 = {**p, "pack_copy": f"{claim.upper()}. " + str(p.get("pack_copy") or "")}
        s2 = [p2 if q.get("code") == p.get("code") else q for q in set_items]
        notes.append("hypothetical claim: it must be true and legal on the real pack (see the pack test for true claims only)")
        return p2, s2, f"the front of pack now carries a '{claim}' claim", notes
    m = _SHELF.search(question)
    if m:
        notes.append("a shelf move changes NOTICING, which is code (sim/notice.py), not Jev; these probabilities are "
                     "conditional on the shopper seeing it. use the placement section for the notice effect")
        return p, set_items, f"it has moved to the {m.group(1).lower().replace('-', ' ')} shelf", notes
    notes.append("free-text change: passed to Jev in your words, product card unchanged")
    return p, set_items, question.strip()[:240], notes


def _questions(name: str, n_trig: int, n_trust: int) -> dict:
    q = {
        "take": {"type": "noul", "instructions": f"On this trip, does `shopper` take `product` ({name}) and put it in the basket?",
                 "criteria": {"true": "they take it", "false": "they leave it on the shelf"}},
        "pickup": {"type": "noul", "instructions": f"Does `shopper` pick up `product` ({name}) to look at it more closely?",
                   "criteria": {"true": "they take it off the shelf to look at it", "false": "they only glance at it, or ignore it"}},
        "appeal": {"type": "score", "instructions": f"How does `shopper` feel about `product` ({name}) on today's trip?",
                   "criteria": jev.APPEAL_LEVELS},
    }
    for k in range(n_trig):
        q[f"trig_{k}"] = {"type": "noul", "instructions": f"Does `product` ({name}) show what `shopper.put_offs[{k}]` describes?",
                          "criteria": {"true": "the card clearly shows it", "false": "the card does not show it, or not enough to tell"}}
    for k in range(n_trust):
        q[f"trust_{k}"] = {"type": "noul", "instructions": f"Does `product` ({name}) show what `shopper.trusts[{k}]` describes?",
                           "criteria": {"true": "the card clearly shows it", "false": "the card does not show it, or not enough to tell"}}
    return q


def _read(res: dict, n_trig: int, n_trust: int) -> dict:
    A = res["answers"]
    ap = {int(k): float(v) for k, v in A["appeal"]["probabilities"].items()}
    return {"take": round(float(A["take"]["noul"]), 4), "pickup": round(float(A["pickup"]["noul"]), 4),
            "appeal_score": round(float(A["appeal"]["score"]), 3), "appeal_level": max(ap, key=ap.get),
            "triggers": {f"trigger_{k}": round(float(A[f"trig_{k}"]["noul"]), 4) for k in range(n_trig)},
            "trusts": {f"trust_{k}": round(float(A[f"trust_{k}"]["noul"]), 4) for k in range(n_trust)}}


def whatif(run_id: str, code: str, agent_ids: list[str], question: str) -> dict:
    run = load_run(run_id)
    personas = {p["id"]: p for p in simrun.load_personas(include_ai=True)[0]}
    cat, p = _product(run, code)
    plan, _ = simrun.load_planogram(run.get("planogram_inline") or run.get("planogram"))
    rows = {r["agent"]["agent_id"]: r for r in meetings(run, code)}
    out, total, notes_all = [], 0.0, None
    for aid in agent_ids[:8]:
        r = rows.get(aid)
        if not r:
            out.append({"agent_id": aid, "error": "this shopper did not meet the product in this run"})
            continue
        a, e = r["agent"], r["event"]
        persona = personas.get(a["persona_id"])
        if not persona:
            out.append({"agent_id": aid, "error": f"persona {a['persona_id']} not found"})
            continue
        slot = plan.get(e.get("slot")) or {}
        set_items = [cat[c] for c in slot.get("products", []) if c in cat] or [p]
        p2, s2, what, notes = apply_change(p, set_items, question)
        notes_all = notes
        nf = e.get("notice_factors") or {}
        shopper = jev.shopper_state(persona, a.get("ocean") or persona.get("ocean") or {}, mission=a.get("mission") or persona.get("mission", "weekly_shop"),
                                    budget_left=a.get("budget_gbp"), category=slot.get("category", p.get("category", "")),
                                    on_mission=bool(nf.get("on_mission")), basket=[])
        reads = bool(e.get("back_of_pack_seen") or a.get("reads_labels"))
        nt, ns = len(shopper["put_offs"]), len(shopper["trusts"])
        qs = _questions(p.get("name", code), nt, ns)
        base_state = {"shopper": shopper, "product": jev.product_state(p, set_items, reads, a.get("budget_gbp"))}
        new_state = {"shopper": shopper, "product": jev.product_state(p2, s2, reads, a.get("budget_gbp")), "what_changed": what}
        try:
            rb = jev.ask(base_state, qs, tag=f"interview:base:{run_id}:{aid}:{code}")
            rn = jev.ask(new_state, qs, tag=f"interview:whatif:{run_id}:{aid}:{code}")
        except Exception as ex:  # spend guard, network, no key: say so, never invent
            out.append({"agent_id": aid, "error": f"jev request failed: {repr(ex)[:200]}"})
            continue
        b, n = _read(rb, nt, ns), _read(rn, nt, ns)
        router = rn.get("backend") == "jev-router" or rb.get("backend") == "jev-router"
        cost = float(rb.get("cost") or 0) + float(rn.get("cost") or 0)
        total += cost
        out.append({
            "agent_id": aid, "persona_id": a["persona_id"], "name": persona.get("name"), "group": r["group"],
            "recorded": {"stage_reached": _stage(e), "p_pick_up": e.get("p_pick_up"), "p_take_shelf_choice": _take_p(e)},
            "baseline": b, "whatif": n, "delta_take": round(n["take"] - b["take"], 4), "delta_pickup": round(n["pickup"] - b["pickup"], 4),
            "put_offs": shopper["put_offs"], "trusts": shopper["trusts"],
            "engine": "jev-router" if router else "jev", "calibrated": not router,
            "model": rn.get("routed_model") or rn.get("model"), "cached": bool(rb.get("cached") and rn.get("cached")),
            "cost_usd": round(cost, 8), "cache_keys": [rb.get("cache_key"), rn.get("cache_key")],
        })
    return {"run_id": run_id, "product": code, "question": question, "what_changed_words": what if out else None,
            "notes": notes_all or [], "results": out, "cost_usd": round(total, 8), "backend": jev.backend(),
            "method": ("two System One requests per shopper via sim/jev.py ask() (disk-cached): the product card as "
                       "recorded, and the card with the change in words; same questions (take Noul, pick-up Noul, appeal "
                       "Score, one Noul per put-off and trust signal), so delta = what-if minus baseline. 'recorded' is the "
                       "run's shelf Choice P(take), a different question, shown for reference only.")}


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        sys.exit(1)
    rid, code = args[0], args[1]
    if "--whatif" in args:
        q = args[args.index("--whatif") + 1]
        ids = args[args.index("--agents") + 1].split(",") if "--agents" in args else \
            [i["agent_id"] for i in panel(rid, code)["interviewees"]]
        print(json.dumps(whatif(rid, code, ids, q), indent=1, ensure_ascii=False))
    else:
        print(json.dumps(panel(rid, code), indent=1, ensure_ascii=False))

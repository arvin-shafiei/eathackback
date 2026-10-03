"""Build data/products/curated/hot_drinks.json from the OFF UK pool + OFF API v2 snapshots.
Rules and every assumption: data/products/curated/hot_drinks_rules.md
"""
import json, math, re
import pandas as pd

ROOT = "/Users/arvin/orca/eathackback"
S = ROOT + "/data/products/curated/hot_drinks_off_api"
OFF = "https://world.openfoodfacts.org/product/"
NOT_FETCHED = "not fetched (no retailer page fetched; curator estimate, Oct 2026)"

ROWS = {
    # row 1 (top): coffee -- instant jar incumbent, sachet latte incumbent, RTD oat challenger, Lidl own-label ground
    "1": ["8445290522740", "8711000677810", "5060574954630", "4056489639145"],
    # row 2 (eye): everyday black tea -- the two UK builder's-tea incumbents vs organic challenger vs Asda own-label
    "2": ["8720608039593", "5010357112092", "5021991113673", "5054781861034"],
    # row 3 (bottom): hot chocolate & herbal -- full-sugar incumbent, sweetened low-cal, own-label "lighter", organic herbal challenger
    "3": ["5034660021582", "7612100053607", "5059697390005", "5060519143730"],
}

# code: (role, price_gbp, price_source, cups_per_pack, cups_source)
META = {
    "8445290522740": ("incumbent", 6.00, f"assumption: typical UK RRP Nescafé Gold Blend 150g jar ~£6.00 (big-4 range ~£5.50-£7.00, 2025-26); {NOT_FETCHED}",
                      83, "150g (OFF quantity) / 1.8g per mug (assumption: 1 heaped tsp)"),
    "8711000677810": ("incumbent", 3.25, f"assumption: typical UK RRP Kenco latte sachet box ~£3.25; {NOT_FETCHED}",
                      8, "assumption: standard UK box of 8 sachets (OFF quantity empty)"),
    "5060574954630": ("challenger", 2.00, f"assumption: typical UK RRP 250ml RTD oat coffee carton ~£2.00 (Grind/Minor Figures tier £1.80-£2.20); {NOT_FETCHED}",
                      1, "250 ml single carton (OFF quantity)"),
    "4056489639145": ("own_label", 3.29, f"assumption: Lidl Bellarom single-origin ground coffee 250g typically ~£2.99-£3.49; {NOT_FETCHED}",
                      35.7, "250g (OFF quantity) / 7g per cup (assumption: cafetière/filter dose ~55-60g per litre)"),
    "8720608039593": ("incumbent", 1.75, f"assumption: typical UK RRP PG Tips 40 bags ~£1.75; {NOT_FETCHED}",
                      40, "40 bags (OFF quantity)"),
    "5010357112092": ("incumbent", 8.50, f"assumption: typical UK RRP Yorkshire Tea 240 bags ~£8.50; {NOT_FETCHED}",
                      240, "OFF quantity '240' read as 240 bags (Yorkshire Tea's 240-bag box; OFF gives no unit)"),
    "5021991113673": ("challenger", 3.80, f"assumption: typical UK RRP Clipper Organic Everyday 80 bags ~£3.80; {NOT_FETCHED}",
                      80, "80 bags (OFF product_name)"),
    "5054781861034": ("own_label", 0.79, f"assumption: Asda Everyday 40 tea bags (125g) typically ~£0.79; {NOT_FETCHED}",
                      40, "125g (OFF quantity) at ~3.1g/bag = 40 bags (assumption)"),
    "5034660021582": ("incumbent", 5.50, f"assumption: typical UK RRP Cadbury Hot Chocolate 500g tub ~£5.50; {NOT_FETCHED}",
                      27.8, "500g (OFF quantity) / 18g (OFF serving_size)"),
    "7612100053607": ("incumbent", 3.75, f"assumption: typical UK RRP Options Belgian Choc 220g ~£3.75; {NOT_FETCHED}",
                      20, "220g (OFF quantity) / 11g (OFF serving_size '11 g + 200 ml water')"),
    "5059697390005": ("own_label", 2.50, f"assumption: Tesco Lighter Hot Chocolate 270g typically ~£2.50; {NOT_FETCHED}",
                      24.5, "270g (OFF quantity) / 11g powder per 211ml serving (assumption: same instant format as Options; OFF serving_size 211ml)"),
    "5060519143730": ("challenger", 3.50, f"assumption: typical UK RRP Pukka 20-sachet collection box ~£3.50; {NOT_FETCHED}",
                      20, "32.4g (OFF quantity) at ~1.6g/sachet = 20 sachets (assumption)"),
}

# per-cup nutrition: (basis, amount, unit, source). basis 'powder' -> per100g * dose_g/100; 'prepared' -> per100ml * ml/100
CUP = {
    "8445290522740": ("powder", 1.8, "g", "assumption: 1 heaped tsp ≈ 1.8g per mug"),
    "8711000677810": ("powder", 18.5, "g", "assumption: OFF serving_size 'approx 6g' is implausible for a 36%-milk-powder latte sachet; used 18.5g = Nescafé Gold Vanilla Latte sachet in OFF pool (7613034315557, quantity '8 x 18.5 g')"),
    "5060574954630": ("prepared", 250, "ml", "OFF quantity 250 ml, whole carton = one serve"),
    "4056489639145": ("powder", 7, "g", "assumption: 7g ground coffee per cup (nutrition per 100g ground; brewed values near zero)"),
    "8720608039593": ("prepared", 250, "ml", "assumption: 250ml mug; OFF nutrition read as infusion values"),
    "5010357112092": ("prepared", 250, "ml", "assumption: 250ml mug; OFF nutrition read as infusion values"),
    "5021991113673": ("prepared", 250, "ml", "assumption: 250ml mug; OFF nutrition read as infusion values"),
    "5054781861034": ("prepared", 250, "ml", "assumption: 250ml mug; OFF nutrition read as infusion values"),
    "5034660021582": ("powder", 18, "g", "OFF serving_size 18g; milk not included (shopper adds own)"),
    "7612100053607": ("prepared", 211, "ml", "OFF serving_size '11 g + 200 ml water'; OFF nutrition is as-prepared (20 kcal/100ml)"),
    "5059697390005": ("prepared", 211, "ml", "OFF serving_size 211ml; OFF nutrition is as-prepared (19 kcal/100ml)"),
    "5060519143730": ("prepared", 250, "ml", "assumption: 250ml mug; OFF nutrition 0 kcal"),
}

PACK_COPY_EXTRA = {
    "8445290522740": "100% soluble coffee",
    "8711000677810": "instant latte sachets",
    "5060574954630": "cold brew arabica coffee with oat drink",
    "4056489639145": "single-origin kenya ground coffee",
    "7612100053607": "~42 kcal per prepared cup",
    "5060519143730": "organic herbal & green tea collection (ginseng matcha green, turmeric, night time)",
}
PACK_COPY_SRC = {
    "7612100053607": "OFF serving_size (11g + 200ml) x OFF energy-kcal_prepared 20/100ml = ~42 kcal/cup; brand's '40 calories' claim not verified, worded as computed",
}

SWEETENER_E = {f"en:e{n}" for n in list(range(950, 970)) + [420, 421]}
SWEET_WORDS = re.compile(r"stevia|steviol|erythritol|sucralose|aspartame|acesulfame|saccharin")
UPF_MARKERS = re.compile(r"glucose syrup|maltodextrin|hydrogenated|whey|permeate|polydextrose|modified starch|flavouring|milk proteins")
GLUTEN = re.compile(r"\b(barley|wheat|rye|malt|spelt|oats?)\b")
FUNCTIONAL = {
    "functional botanical (ginseng/matcha/tulsi/turmeric/adaptogen)": re.compile(r"ginseng|matcha|tulsi|turmeric|adaptogen|ashwagandha|detox"),
    "added vitamins/minerals": re.compile(r"vitamin|calcium-source|added calcium|fortified"),
}
REDUCED_LABELS = {"en:reduced-sugar", "en:30-less-sugar", "en:low-sugar", "en:low-or-no-sugar"}
TREND = re.compile(r"oat|cold brew|iced|matcha|ginseng|adaptogen|turmeric|mushroom|collagen")
ETHICAL = {"en:fair-trade", "en:fairtrade-international", "en:rainforest-alliance", "en:the-vegan-society", "en:1-for-the-planet",
           "en:b-corporation", "en:cocoa-life", "en:ethical-tea-partnership", "en:soil-association-organic"}
ECO = {"a-plus": 1, "a": .9, "b": .75, "c": .5, "d": .25, "e": .1, "f": 0}
NUTRI = {"a": 1, "b": .75, "c": .5, "d": .25, "e": 0}

pool = pd.read_parquet(ROOT + "/data/products/uk_products.parquet").set_index("code")


def lst(v):
    return [x for x in str(v).split("|") if x] if isinstance(v, str) and v else []


def num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else round(f, 4)
    except (TypeError, ValueError):
        return None


def clamp(x):
    return round(max(0.0, min(1.0, x)), 3)


def base(code):
    r = pool.loc[code]
    api = json.load(open(f"{S}/api_{code}.json"))["product"]
    p = dict(name=r["name"], brand=r["brand"], categories=lst(r["categories"]), labels=lst(r["labels"]),
             additives=lst(r["additives"]), analysis=lst(r["analysis"]),
             nova=int(r["nova"]) if num(r["nova"]) is not None else None, nutriscore=r["nutriscore"], ecoscore=r["ecoscore"],
             packaging=lst(r["packaging"]), stores=lst(r["stores"]), quantity=r["quantity"], scans=num(r["scans"]),
             completeness=num(r["completeness"]), ingredients_text=r["ingredients_text"], image=r["image"],
             **{k: num(r[k]) for k in ["energy-kcal_100g", "fat_100g", "saturated-fat_100g", "sugars_100g", "salt_100g", "fiber_100g", "proteins_100g"]})
    p["additives_n"] = len(p["additives"]) if p["additives"] else int(r["additives_n"] or 0)
    # API v2 fills gaps the bulk parquet leaves empty
    p["ingredients_n"] = api.get("ingredients_n")
    p["allergens"] = api.get("allergens_tags", []) or lst(r["allergens"])
    p["traces"] = api.get("traces_tags", [])
    p["recycling"] = api.get("packaging_recycling_tags", [])
    p["serving_size_off"] = api.get("serving_size")
    if not p["stores"] and api.get("stores"):
        p["stores"] = [s.strip() for s in api["stores"].split(",") if s.strip()]
    return p


def derived(code, p):
    txt = (p["ingredients_text"] or "").lower()
    sw = sorted({a for a in p["additives"] if a in SWEETENER_E} | set(SWEET_WORDS.findall(txt)))
    # de-dup e951 + 'aspartame' style double counts: words only count if no matching E-number
    e_n = len([a for a in p["additives"] if a in SWEETENER_E]); w_n = len(set(SWEET_WORDS.findall(txt)))
    p["sweeteners"] = max(e_n, w_n)
    p["sweeteners_list"] = sw
    A = set(p["analysis"])
    p["palm_oil_n"] = len(re.findall(r"\bpalm", txt))
    p["palm_free"] = 1.0 if "en:palm-oil-free" in A and p["palm_oil_n"] == 0 else (0.0 if (p["palm_oil_n"] or "en:may-contain-palm-oil" in A) else 0.5)
    role, price, psrc, cups, csrc = META[code]
    basis, amt, unit, cupsrc = CUP[code]
    f = amt / 100
    p.update(role=role, price_gbp=price, price_source=psrc, cups_per_pack=cups, cups_per_pack_source=csrc,
             price_per_cup_gbp=round(price / cups, 3))
    p["per_cup"] = {"basis": basis, "dose": f"{amt}{unit}", "source": cupsrc,
                    "sugars_g": round((p["sugars_100g"] or 0) * f, 2), "energy_kcal": round((p["energy-kcal_100g"] or 0) * f, 1),
                    "proteins_g": round((p["proteins_100g"] or 0) * f, 2)}
    p["derived_field_notes"] = {
        "sweeteners": "max(count of OFF additives in E420/E421/E950-E969, count of sweetener words in OFF ingredients_text); pool column empty",
        "palm_oil_n": "count of 'palm' tokens in OFF ingredients_text; palm-free score from OFF analysis tags",
        "per_cup": "OFF per-100g/ml values x dose; dose source given in per_cup.source",
        "price_per_cup_gbp": "price_gbp (assumption) / cups_per_pack",
    }


def pack_copy(code, p):
    L = set(p["labels"])
    m = {"en:organic": "organic", "en:fair-trade": "fair trade", "en:rainforest-alliance": "rainforest alliance",
         "en:vegan": "vegan", "en:no-gluten": "gluten free", "en:30-less-sugar": "30% less sugar", "en:reduced-sugar": "reduced sugar",
         "en:plant-based-tea-bags": "plant-based tea bags", "en:1-for-the-planet": "1% for the planet", "en:cocoa-life": "cocoa life"}
    claims = [v for k, v in m.items() if k in L]
    extra = PACK_COPY_EXTRA.get(code)
    if extra and extra not in claims:
        claims.insert(0, extra)
    brand = p["brand"].split(",")[0].strip().lower()
    name = (p["name"] or "").lower()
    import unicodedata
    fold = lambda t: unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode()
    head = name if fold(brand.split()[0]) in fold(name) else f"{brand} {name}"
    return head + (" - " + ", ".join(dict.fromkeys(claims)) if claims else "")


def grades(code, p, ctx):
    L = set(p["labels"]); A = set(p["analysis"])
    txt = (p["ingredients_text"] or "").lower(); name = (p["name"] or "").lower()
    add_s = 1 - min(p["additives_n"], 10) / 10
    eco = ECO.get(p["ecoscore"], .5); nutri = NUTRI.get(p["nutriscore"], .4)
    organic = 1 if "en:organic" in L else 0
    nova = p["nova"] or 4
    cup = p["per_cup"]; sug_c = cup["sugars_g"]; kcal_c = cup["energy_kcal"]; prot_c = cup["proteins_g"]
    sugar_s = max(0, 1 - sug_c / 12); kcal_s = max(0, 1 - kcal_c / 100)
    nosweet = 1 if p["sweeteners"] == 0 else 0
    lo, hi = ctx["ppc_min"], ctx["ppc_max"]
    ppc_s = 1 - math.log(p["price_per_cup_gbp"] / lo) / math.log(hi / lo)
    ppc_w = f"price_per_cup=£{p['price_per_cup_gbp']} (price assumption / {p['cups_per_pack']} cups); log-scaled within shelf £{lo}-£{hi}"
    ap = f"additives_n={p['additives_n']} (OFF)"
    sp = f"sugars per cup={sug_c}g ({cup['basis']}, dose {cup['dose']}; OFF sugars_100g={p['sugars_100g']})"
    kp = f"kcal per cup={kcal_c} (OFF energy-kcal_100g={p['energy-kcal_100g']} x dose)"
    swp = f"sweeteners={p['sweeteners_list'] or 'none'} (OFF additives/ingredients_text)"
    g = {}
    g["eco_low_chemical"] = (0.4 * add_s + 0.3 * eco + 0.2 * organic + 0.1 * p["palm_free"],
                             [ap, f"ecoscore={p['ecoscore']} (OFF; unknown->0.5)", f"organic={bool(organic)} (OFF labels)",
                              f"palm-free={p['palm_free']} (OFF analysis)"])
    markers = sorted(set(UPF_MARKERS.findall(txt)))
    g["upf_avoider_parent"] = (0.4 * (4 - nova) / 3 + 0.2 * add_s + 0.2 * nosweet + 0.1 * (0 if markers else 1) + 0.1 * sugar_s,
                               [f"nova={p['nova']} (OFF)", ap, swp, f"UPF marker ingredients={markers or 'none'} (OFF ingredients_text)", sp])
    no_sugar_ing = 0 if re.search(r"\bsugar\b|glucose", txt) else 1
    g["glp1_small_appetite"] = (0.4 * sugar_s + 0.4 * kcal_s + 0.2 * no_sugar_ing,
                                [sp, kp, f"no sugar/glucose in ingredients={bool(no_sugar_ing)} (OFF ingredients_text)"])
    g["frugal_unit_price"] = (0.85 * ppc_s + 0.15 * (p["role"] == "own_label"), [ppc_w, f"role={p['role']}"])
    g["protein_gym"] = (0.6 * min(prot_c / 10, 1) + 0.2 * sugar_s + 0.2 * kcal_s,
                        [f"protein per cup={prot_c}g (OFF proteins_100g={p['proteins_100g']} x dose; milk not counted)", sp, kp])
    hay = " ".join([name, txt, " ".join(L), (pack_copy(code, p) or "").lower()])
    claims = [k for k, rx in FUNCTIONAL.items() if rx.search(hay)]
    if L & REDUCED_LABELS:
        claims.append("reduced/low sugar claim")
    g["protein_sceptic_gimmick_reactant"] = (0.6 * (1 - min(len(claims), 3) / 3) + 0.2 * nosweet + 0.2 * add_s,
                                             [f"functional/diet claims={claims or 'none'} (OFF name/labels/ingredients_text)", swp, ap])
    reform = 1 if (p["sweeteners"] or (L & REDUCED_LABELS)) else 0
    g["habit_loyalist_shrinkflation_angry"] = (0.5 * (p["role"] == "incumbent") + 0.3 * (1 - reform) + 0.2 * ppc_s,
                                               [f"role={p['role']}", f"reformulated/'lighter' signal={bool(reform)} (OFF labels + sweeteners)", ppc_w])
    if p["cups_per_pack"] == 1:
        fmt, fmt_w = 1.0, "ready-to-drink single serve"
    elif "sachet" in (name + " " + str(p["categories"])) or code in ("8711000677810", "5060519143730"):
        fmt, fmt_w = 0.5, "individual sachets (desk drawer)"
    else:
        fmt, fmt_w = 0.2, "multi-cup jar/box"
    big4 = {"tesco", "sainsbury's", "asda", "morrisons", "lidl", "aldi", "waitrose", "co-op"}
    mainstream = 1 if (p["role"] in ("incumbent", "own_label") or {s.lower() for s in p["stores"]} & big4) else 0
    g["meal_deal_office"] = (0.6 * fmt + 0.2 * mainstream + 0.2 * sugar_s,
                             [f"format={fmt_w} (OFF quantity/name)", f"mainstream={bool(mainstream)} (role={p['role']}, OFF stores={p['stores'] or 'unknown'})", sp])
    vegan_s = 1 if "en:vegan" in L else (0.8 if "en:vegan" in A else (0.5 if "en:maybe-vegan" in A else (0 if "en:non-vegan" in A else 0.3)))
    eth = sorted(L & ETHICAL)
    g["vegan_ethical"] = (0.6 * vegan_s + 0.2 * organic + 0.2 * (1 if eth else 0),
                          [f"vegan_signal={vegan_s} (OFF labels/analysis)", f"organic={bool(organic)} (OFF labels)", f"ethical_labels={eth or 'none'} (OFF labels)"])
    gl = GLUTEN.findall(txt)
    if "en:no-gluten" in L:
        cs, cw = 1.0, "label en:no-gluten (OFF labels)"
    elif gl or "en:gluten" in p["allergens"]:
        cs, cw = 0.1, f"gluten source {sorted(set(gl)) or ''} / allergens={p['allergens']} (OFF)"
    else:
        cs, cw = 0.7, "no gluten ingredient, but no gluten-free label (OFF labels)"
    if not txt:
        cs -= 0.1
    g["allergen_coeliac"] = (cs, [cw, f"allergens={p['allergens'] or 'none declared'} traces={p['traces'] or 'none'} (OFF API)"])
    comp = min(p["completeness"] or 0, 1)
    g["ai_delegator"] = (0.4 * comp + 0.4 * nutri + 0.2 * (1 if p["stores"] else 0),
                         [f"completeness={p['completeness']} (OFF)", f"nutriscore={p['nutriscore']} (OFF)", f"stores known={bool(p['stores'])} (OFF)"])
    tr = bool(TREND.search(hay))
    g["novelty_seeker_tiktok"] = (0.55 * (p["role"] == "challenger") + 0.45 * tr,
                                  [f"role={p['role']}", f"trend_term(oat/cold brew/iced/matcha/ginseng/turmeric)={tr} (OFF name/ingredients)"])
    return {k: {"score": clamp(v[0]), "why": v[1]} for k, v in g.items()}


codes = [c for r in ROWS.values() for c in r]
prods = {}
for c in codes:
    p = base(c); derived(c, p); prods[c] = p
ctx = dict(ppc_min=min(p["price_per_cup_gbp"] for p in prods.values()), ppc_max=max(p["price_per_cup_gbp"] for p in prods.values()))
out = []
for row, cs in ROWS.items():
    for c in cs:
        p = prods[c]
        rec = {"code": c, "name": p["name"], "brand": p["brand"], "category": "hot_drinks", "role": p["role"], "row": int(row),
               "price_gbp": p["price_gbp"], "price_source": p["price_source"], "price_per_cup_gbp": p["price_per_cup_gbp"],
               "cups_per_pack": p["cups_per_pack"], "cups_per_pack_source": p["cups_per_pack_source"],
               "pack_copy": pack_copy(c, p),
               "pack_copy_source": PACK_COPY_SRC.get(c, "derived from OFF product_name + OFF labels (+ OFF ingredients_text for descriptors)"),
               "nova": p["nova"], "nutriscore": p["nutriscore"], "ecoscore": p["ecoscore"], "additives_n": p["additives_n"],
               "additives": p["additives"], "labels": p["labels"], "allergens": p["allergens"], "traces": p["traces"],
               "analysis": p["analysis"], "ingredients_n": p["ingredients_n"], "ingredients_text": p["ingredients_text"],
               "sugars_100g": p["sugars_100g"], "fiber_100g": p["fiber_100g"], "proteins_100g": p["proteins_100g"], "salt_100g": p["salt_100g"],
               "energy_kcal_100g": p["energy-kcal_100g"], "fat_100g": p["fat_100g"], "saturated_fat_100g": p["saturated-fat_100g"],
               "per_cup": p["per_cup"], "serving_size_off": p["serving_size_off"],
               "sweeteners": p["sweeteners"], "sweeteners_list": p["sweeteners_list"], "palm_oil_n": p["palm_oil_n"],
               "derived_field_notes": p["derived_field_notes"], "quantity": p["quantity"], "stores": p["stores"] or None,
               "packaging": p["packaging"], "recycling": p["recycling"], "image": p["image"], "off_url": OFF + c,
               "completeness": p["completeness"], "scans": p["scans"],
               "data_source": "OFF UK pool (data/products/uk_products.parquet) + OFF API v2 snapshot (hot_drinks_off_api/api_<code>.json, fetched 2026-10-03) for allergens/traces/ingredients_n/recycling/serving_size",
               "lens_grades": grades(c, p, ctx)}
        out.append(rec)
doc = {"category": "hot_drinks",
       "row_themes": {"1": "coffee: instant jar vs sachet latte vs RTD oat challenger vs own-label ground",
                      "2": "everyday black tea: two incumbents vs organic challenger vs own-label",
                      "3": "hot chocolate & herbal: full sugar vs sweetened low-cal vs own-label lighter vs organic herbal"},
       "rows": ROWS, "rules": "data/products/curated/hot_drinks_rules.md",
       "source_pool": "data/products/uk_products.parquet (Open Food Facts UK)", "products": out}
json.dump(doc, open(f"{ROOT}/data/products/curated/hot_drinks.json", "w"), indent=1, ensure_ascii=False)
for r in out:
    print(r["row"], r["code"], r["brand"][:16].ljust(16), r["role"][:4], r["nova"], r["nutriscore"], r["ecoscore"], "add", r["additives_n"],
          "sw", r["sweeteners"], "cup", r["per_cup"]["sugars_g"], r["per_cup"]["energy_kcal"], "£/cup", r["price_per_cup_gbp"], "|",
          " ".join(f"{v['score']:.2f}" for v in r["lens_grades"].values()))
    print("   ", r["pack_copy"])

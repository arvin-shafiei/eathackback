import json, math, re
import pandas as pd

ROOT = "/Users/arvin/orca/eathackback"
S = ROOT + "/data/products/curated/snack_bars_off_api"
OFF = "https://world.openfoodfacts.org/product/"

ROWS = {
    # row 1 (top): oat / cereal bars -- incumbent vs challenger vs organic kids vs own-label "no added sugar" with polyols
    "1": ["8410076600790", "5060482840179", "5024121100475", "20422684"],
    # row 2 (eye): fruit & nut bars -- Nakd vs Lidl Alesto dupe vs KIND vs Eat Natural
    "2": ["5060088701478", "4056489239918", "5000159558396", "8000500417195"],
    # row 3 (bottom): protein bars -- Grenade vs Trek vs Bounce vs Lidl Deluxe own-label
    "3": ["5060811384084", "5060088709047", "5060411920040", "20402167"],
}

# role / price / units-per-pack (pack count from OFF quantity) -- prices are assumptions (no retailer page fetched)
META = {
    "8410076600790": ("incumbent", 2.50, 5, "assumption: typical UK RRP for Nature Valley Crunchy 5x42g multipack in Tesco/Sainsbury's (~£2.50, 2025-26), not fetched"),
    "5060482840179": ("challenger", 2.50, 3, "assumption: typical UK RRP for Deliciously Ella oat bar 3x50g multipack (~£2.50), not fetched"),
    "5024121100475": ("challenger", 2.25, 6, "assumption: typical UK RRP for Organix Soft Oaty Bars 6x23g (~£2.25), not fetched"),
    "20422684": ("own_label", 1.29, 8, "assumption: Lidl Crownfield multipack bars typically £1.19-£1.49 (8x25g), not fetched"),
    "5060088701478": ("incumbent", 2.40, 4, "assumption: typical UK RRP for Nakd 4x35g multipack (~£2.40), not fetched"),
    "4056489239918": ("own_label", 1.79, 5, "assumption: Lidl Alesto raw fruit & nut 5x35g typically ~£1.79, not fetched"),
    "5000159558396": ("challenger", 3.00, 3, "assumption: typical UK RRP for KIND 3x30g multipack (~£3.00), not fetched"),
    "8000500417195": ("incumbent", 1.25, 1, "assumption: typical UK single-bar RRP for Eat Natural 40g (~£1.25), not fetched"),
    "5060811384084": ("challenger", 2.50, 1, "assumption: typical UK single-bar RRP for Grenade 60g protein bar (~£2.50), not fetched"),
    "5060088709047": ("incumbent", 2.75, 3, "assumption: typical UK RRP for TREK protein flapjack 3x50g (~£2.75), not fetched"),
    "5060411920040": ("challenger", 2.50, 1, "assumption: typical Holland & Barrett price for a Bounce 90g pack (~£2.50), not fetched"),
    "20402167": ("own_label", 1.99, 3, "assumption: Lidl Deluxe protein bars 3x45g typically ~£1.99, not fetched"),
}
GRAMS = {"8410076600790": 210, "5060482840179": 150, "5024121100475": 138, "20422684": 200, "5060088701478": 140,
         "4056489239918": 175, "5000159558396": 90, "8000500417195": 40, "5060811384084": 60, "5060088709047": 150,
         "5060411920040": 90, "20402167": 135}
GRAMS_SRC = {"5060811384084": "assumption: OFF quantity missing; Grenade bars are sold as 60g"}

SWEETENER_E = {f"en:e{n}" for n in [420, 421, 950, 951, 952, 953, 954, 955, 957, 959, 960, 961, 962, 964, 965, 966, 967, 968, 969]}
ECO = {"a-plus": 1, "a": 1, "b": .75, "c": .5, "d": .25, "e": 0, "f": 0}
NUTRI = {"a": 1, "b": .75, "c": .5, "d": .25, "e": 0}
NOVA = {1: 1, 2: .75, 3: .5, 4: 0}
INDULGENT = re.compile(r"oreo|caramel|chocolate|choc|cocoa|cacao|toffee|bakewell", re.I)

pool = pd.read_parquet(f"{ROOT}/data/products/uk_products.parquet").set_index("code")
grenade = json.load(open(f"{S}/g_5060811384084.json"))["product"]


def lst(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return []
    return [x for x in str(v).split("|") if x]


def num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else round(f, 2)
    except (TypeError, ValueError):
        return None


def base(code):
    api = json.load(open(f"{S}/api_{code}.json"))["product"]
    if code in pool.index:
        r = pool.loc[code]
        p = dict(name=r["name"], brand=r["brand"], categories=lst(r["categories"]), labels=lst(r["labels"]),
                 additives_n=int(r["additives_n"] or 0), additives=lst(r["additives"]), analysis=lst(r["analysis"]),
                 nova=int(r["nova"]) if num(r["nova"]) else None, nutriscore=r["nutriscore"], ecoscore=r["ecoscore"],
                 packaging=lst(r["packaging"]), stores=lst(r["stores"]), quantity=r["quantity"], scans=num(r["scans"]),
                 completeness=num(r["completeness"]), ingredients_text=r["ingredients_text"], image=r["image"],
                 **{k: num(r[k]) for k in ["energy-kcal_100g", "fat_100g", "saturated-fat_100g", "sugars_100g", "salt_100g", "fiber_100g", "proteins_100g"]},
                 data_source="OFF UK pool (data/products/uk_products.parquet)")
    else:
        n = grenade["nutriments"]
        p = dict(name=grenade["product_name"], brand=grenade["brands"], categories=grenade["categories_tags"], labels=[],
                 additives_n=grenade["additives_n"], additives=grenade["additives_tags"],
                 analysis=grenade["ingredients_analysis_tags"], nova=grenade["nova_group"], nutriscore=grenade["nutriscore_grade"],
                 ecoscore=grenade["ecoscore_grade"], packaging=[], stores=[], quantity=grenade.get("quantity"), scans=grenade.get("unique_scans_n"),
                 completeness=round(grenade["completeness"], 4), ingredients_text=grenade["ingredients_text_en"], image=grenade["image_front_url"],
                 **{k: num(n.get(k)) for k in ["energy-kcal_100g", "fat_100g", "saturated-fat_100g", "sugars_100g", "salt_100g", "fiber_100g", "proteins_100g"]},
                 data_source="OFF API v2 /product/5060811384084 (not in UK pool: Grenade absent from bulk export filter)")
    p["ingredients_n"] = api.get("ingredients_n")
    p["allergens"] = api.get("allergens_tags", [])
    p["traces"] = [t.strip("\x1f ") for t in api.get("traces_tags", []) if t.strip("\x1f en:")]
    p["recycling"] = api.get("packaging_recycling_tags", [])
    return p


def derived(code, p):
    txt = (p["ingredients_text"] or "").lower()
    p["sweeteners"] = len([a for a in p["additives"] if a in SWEETENER_E])
    palm_txt = len(re.findall(r"\bpalm", txt))
    if palm_txt:
        p["palm_oil_n"] = palm_txt
    elif "en:may-contain-palm-oil" in p["analysis"]:
        p["palm_oil_n"] = 0.5
    else:
        p["palm_oil_n"] = 0
    role, price, units, psrc = META[code]
    p.update(role=role, price_gbp=price, price_source=psrc, units_per_pack=units, pack_g=GRAMS[code],
             pack_g_source=GRAMS_SRC.get(code, "OFF quantity field"),
             price_per_100g=round(price / GRAMS[code] * 100, 2), price_per_unit=round(price / units, 2))
    p["derived_field_notes"] = {
        "sweeteners": "count of OFF additives in E420/E421/E950-E969 (sweetener/polyol range); pool 'sweeteners' column was empty",
        "palm_oil_n": "count of 'palm' tokens in OFF ingredients_text; 0.5 if OFF analysis says may-contain-palm-oil; pool 'palm_oil_n' column was empty",
    }


def pack_copy(code, p):
    L = set(p["labels"])
    claims = []
    m = {"en:vegan": "vegan", "en:no-gluten": "gluten free", "en:organic": "organic", "en:soil-association-organic": "soil association organic",
         "en:no-added-sugar": "no added sugar", "en:high-in-protein": "high in protein", "en:source-of-fibre": "source of fibre",
         "en:no-artificial-additives": "no artificial additives", "en:no-artificial-preservatives": "no artificial preservatives",
         "en:rainforest-alliance": "rainforest alliance cocoa", "en:sustainable-palm-oil": "sustainable palm oil",
         "en:low-or-no-sugar": "low sugar", "en:kosher": "kosher", "en:fairtrade-kokao": "fairtrade cocoa"}
    for k, v in m.items():
        if k in L and v not in claims:
            claims.append(v)
    if code == "5060811384084":
        claims = ["high protein", "low sugar", "oreo collab"]  # from OFF product_name "Grenade High Protein Oreo" + sibling SKU names "HIGH PROTEIN, LOW SUGAR"
    if code == "5060088709047" and "protein" not in claims:
        claims.insert(0, "protein flapjack")
    brand = p["brand"].split(",")[0].strip().lower()
    name = p["name"].lower()
    head = name if name.startswith(brand) else f"{brand} {name}"
    return head + (" — " + ", ".join(claims) if claims else "")


def clamp(x):
    return round(max(0.0, min(1.0, x)), 3)


def grades(code, p, ctx):
    add = min(p["additives_n"], 10) / 10
    eco = ECO.get(p["ecoscore"], .4)
    nutri = NUTRI.get(p["nutriscore"], .4)
    nova = NOVA.get(p["nova"], .25)
    L = set(p["labels"]); A = set(p["analysis"])
    organic = 1 if "en:organic" in L else 0
    palm0 = 1 if p["palm_oil_n"] == 0 else 0
    sug = p["sugars_100g"] or 0; prot = p["proteins_100g"] or 0; fib = p["fiber_100g"] or 0; kcal = p["energy-kcal_100g"] or 0
    sweet = p["sweeteners"]
    vegan = 1 if ("en:vegan" in A or "en:vegan" in L) else 0
    unit_g = p["pack_g"] / p["units_per_pack"]
    name = (p["name"] or "").lower()
    g = {}
    ap = f"additives_n={p['additives_n']} (OFF)"; ep = f"ecoscore={p['ecoscore']} (OFF)"; np_ = f"nova={p['nova']} (OFF)"
    sp = f"sugars_100g={sug} (OFF)"; pp = f"proteins_100g={prot} (OFF)"

    g["eco_low_chemical"] = (0.4 * (1 - add) + 0.3 * eco + 0.2 * organic + 0.1 * palm0,
                             [ap, ep, f"organic label={bool(organic)} (OFF labels)", f"palm_oil_n={p['palm_oil_n']} (derived from OFF ingredients_text)"])
    g["upf_avoider_parent"] = (0.5 * nova + 0.25 * (1 - add) + 0.15 * (1 - min(sug, 40) / 40) + 0.1 * (sweet == 0),
                               [np_, ap, sp, f"sweeteners={sweet} (derived from OFF additives)"])
    portion = 1 if unit_g <= 40 else (.6 if unit_g <= 50 else .3)
    tenx = 1 if (prot > 0 and kcal < 10 * prot) else 0
    g["glp1_small_appetite"] = (0.3 * min(prot / 25, 1) + 0.2 * tenx + 0.2 * min(fib / 10, 1) + 0.1 * (1 - min(sug, 40) / 40) + 0.2 * portion,
                                [pp, f"energy-kcal_100g={kcal} (OFF) -> 10x test {'pass' if tenx else 'fail'}", f"fiber_100g={fib} (OFF)", sp, f"unit size={unit_g:.0f}g (OFF quantity)"])
    lo, hi = ctx["ppg_min"], ctx["ppg_max"]
    g["frugal_unit_price"] = (1 - (p["price_per_100g"] - lo) / (hi - lo),
                              [f"price_per_100g=£{p['price_per_100g']} (price assumption / OFF quantity)", f"min-max scaled within snack_bars shelf (£{lo}-£{hi}/100g)"])
    ppp = prot * p["pack_g"] / 100 / p["price_gbp"]
    g["protein_gym"] = (0.5 * min(prot / 30, 1) + 0.2 * tenx + 0.15 * (1 - min(sug, 30) / 30) + 0.15 * min(ppp / ctx["ppp_max"], 1),
                        [pp, f"10x test {'pass' if tenx else 'fail'} (kcal {kcal} vs 10x protein)", sp, f"protein per £={ppp:.1f}g"])
    claims_protein = "protein" in name or "en:high-in-protein" in L or "en:protein-bars" in p["categories"]
    gimmick = 0
    if claims_protein:
        gimmick = 0.35 if (not tenx or sweet > 0 or p["additives_n"] >= 3) else 0.1
    g["protein_sceptic_gimmick_reactant"] = (0.45 * nova + 0.3 * (1 - add) + 0.25 * (1 if (p["ingredients_n"] or 99) <= 10 else 0) - gimmick,
                                             [np_, ap, f"ingredients_n={p['ingredients_n']} (OFF)", f"protein claim={claims_protein} (OFF name/labels/categories); penalty={gimmick}"])
    fam = {"incumbent": 1, "own_label": .6, "challenger": .3}[p["role"]]
    sc = math.log1p(p["scans"] or 0) / math.log1p(ctx["scans_max"])
    g["habit_loyalist_shrinkflation_angry"] = (0.5 * fam + 0.3 * sc + 0.2 * (1 - (p["price_per_100g"] - lo) / (hi - lo)),
                                               [f"role={p['role']}", f"scans={p['scans']} (OFF unique scans, log-scaled)", f"price_per_100g=£{p['price_per_100g']}"])
    single = 1 if p["units_per_pack"] == 1 else .4
    g["meal_deal_office"] = (0.4 * single + 0.3 * min(prot / 20, 1) + 0.3 * (1 if p["price_per_unit"] <= 1.5 else max(0, 1 - (p["price_per_unit"] - 1.5) / 1.5)),
                             [f"units_per_pack={p['units_per_pack']} (OFF quantity)", pp, f"price_per_unit=£{p['price_per_unit']}"])
    ethic = 1 if L & {"en:rainforest-alliance", "en:fsc", "en:organic", "en:fairtrade-kokao", "en:fair-trade", "en:utz-certified"} else 0
    g["vegan_ethical"] = (0.6 * vegan + 0.15 * palm0 + 0.15 * eco + 0.1 * ethic,
                          [f"vegan={bool(vegan)} (OFF analysis/labels)", f"palm_oil_n={p['palm_oil_n']}", ep, f"ethical cert={bool(ethic)} (OFF labels)"])
    gf_label = "en:no-gluten" in L
    n_all = len([a for a in p["allergens"] if a != "en:gluten"])
    g["allergen_coeliac"] = (0.7 * gf_label + 0.3 * (1 - min(n_all, 4) / 4),
                             [f"no-gluten label={gf_label} (OFF labels)", f"allergens={p['allergens']} (OFF; en:gluten from 'gluten free oats' ignored when GF-labelled)", f"traces={p['traces']}"])
    g["ai_delegator"] = (0.4 * nutri + 0.3 * (1 - add) + 0.3 * (p["completeness"] or 0),
                         [f"nutriscore={p['nutriscore']} (OFF)", ap, f"completeness={p['completeness']} (OFF data legibility)"])
    g["novelty_seeker_tiktok"] = (0.5 * (p["role"] == "challenger") + 0.3 * (1 - sc) + 0.2 * bool(INDULGENT.search(name) or "oreo" in name),
                                  [f"role={p['role']}", f"scans={p['scans']} (fewer = less familiar)", f"indulgent/collab flavour in name={bool(INDULGENT.search(name))}"])
    return {k: {"score": clamp(v[0]), "why": v[1]} for k, v in g.items()}


codes = [c for r in ROWS.values() for c in r]
prods = {}
for c in codes:
    p = base(c); derived(c, p); prods[c] = p
ctx = dict(ppg_min=min(p["price_per_100g"] for p in prods.values()), ppg_max=max(p["price_per_100g"] for p in prods.values()),
           scans_max=max((p["scans"] or 0) for p in prods.values()),
           ppp_max=max(((p["proteins_100g"] or 0) * p["pack_g"] / 100 / p["price_gbp"]) for p in prods.values()))
out = []
for row, cs in ROWS.items():
    for c in cs:
        p = prods[c]
        rec = {"code": c, "name": p["name"], "brand": p["brand"], "category": "snack_bars", "row": int(row), "role": p["role"],
               "price_gbp": p["price_gbp"], "price_source": p["price_source"], "price_per_100g": p["price_per_100g"],
               "price_per_unit": p["price_per_unit"], "units_per_pack": p["units_per_pack"], "pack_g": p["pack_g"], "pack_g_source": p["pack_g_source"],
               "pack_copy": pack_copy(c, p), "pack_copy_source": "derived from OFF labels + product_name",
               "nova": p["nova"], "nutriscore": p["nutriscore"], "ecoscore": p["ecoscore"], "additives_n": p["additives_n"],
               "additives": p["additives"], "labels": p["labels"], "allergens": p["allergens"], "traces": p["traces"],
               "analysis": p["analysis"], "ingredients_n": p["ingredients_n"], "ingredients_text": p["ingredients_text"],
               "energy-kcal_100g": p["energy-kcal_100g"], "fat_100g": p["fat_100g"], "saturated-fat_100g": p["saturated-fat_100g"],
               "sugars_100g": p["sugars_100g"], "fiber_100g": p["fiber_100g"], "proteins_100g": p["proteins_100g"], "salt_100g": p["salt_100g"],
               "sweeteners": p["sweeteners"], "palm_oil_n": p["palm_oil_n"], "derived_field_notes": p["derived_field_notes"],
               "recycling": p["recycling"], "packaging": p["packaging"], "stores": p["stores"], "quantity": p["quantity"],
               "scans": p["scans"], "completeness": p["completeness"], "image": p["image"], "off_url": OFF + c,
               "data_source": p["data_source"], "lens_grades": grades(c, p, ctx)}
        out.append(rec)
doc = {"category": "snack_bars", "rules": "data/products/curated/snack_bars_rules.md",
       "row_themes": {"1": "oat / cereal bars", "2": "fruit & nut bars", "3": "protein bars"}, "rows": ROWS, "products": out}
json.dump(doc, open(f"{ROOT}/data/products/curated/snack_bars.json", "w"), indent=1, ensure_ascii=False)
for r in out:
    print(r["row"], r["code"], r["brand"][:14].ljust(14), r["role"][:4], r["nova"], r["nutriscore"], r["ecoscore"], r["additives_n"], "sw", r["sweeteners"], "palm", r["palm_oil_n"],
          "p", r["proteins_100g"], "£/100g", r["price_per_100g"], "|", " ".join(f"{v['score']:.2f}" for v in r["lens_grades"].values()))
    print("   ", r["pack_copy"])

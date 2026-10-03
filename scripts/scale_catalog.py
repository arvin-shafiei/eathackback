"""Scale the store ~5x: 144 curated SKUs -> ~480 SKUs, 12 aisles x 2 sides, 4 rows, staffed + self checkouts.

Rule zero (no black box): every added product field is an Open Food Facts (OFF) field from
data/products/uk_products.parquet, or a value computed from OFF fields by a formula written down in
data/products/curated_xl_rules.md, or a labelled "assumption: <why>". No LLM / Jev calls here: this is
pure selection + arithmetic.

Outputs
  data/products/catalog_xl.json        all curated products (unchanged + "curation":"curated") + auto_xl adds
  data/store/store_xl.config.json      layout (store.config.json schema, extended)
  data/store/planogram_xl.json         CONTRACT planogram shape + "stock" and "capacity" per slot
Run
  python scripts/scale_catalog.py
"""
from __future__ import annotations

import csv
import difflib
import glob
import json
import math
import os
import re
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)  # noqa: E731

TARGET_PER_CAT = 40
CATS = ["bakery_bread", "breakfast_cereal", "hot_drinks", "soft_drinks", "crisps_savoury", "snack_bars",
        "biscuits_chocolate", "confectionery_sweets", "ready_meals_soup", "plant_milk_dairy_alt", "yoghurt",
        "frozen_icecream"]  # aisle order 1..12 (chilled/frozen grouped at the far end; see store config)

# ---------------------------------------------------------------- category selectors (OFF categories tags)
# Priority order matters: a product goes to the FIRST category whose include-set it hits.
SELECTORS = [
    ("frozen_icecream", {"en:ice-creams-and-sorbets", "en:ice-creams", "en:sorbets", "en:ice-cream-tubs", "en:ice-cream-bars", "en:ice-lollies"}, {"en:frozen-fruits", "en:fruits", "en:cakes", "en:chocolate-candies"}),
    ("yoghurt", {"en:yogurts", "en:greek-style-yogurts", "en:non-dairy-yogurts", "en:plant-based-yogurts", "en:fruit-yogurts", "en:natural-yogurts"}, {"en:snacks", "en:breakfast-cereals", "en:ice-creams"}),
    ("plant_milk_dairy_alt", {"en:plant-based-milk-alternatives", "en:milk-substitutes", "en:oat-based-drinks", "en:soy-based-drinks", "en:almond-based-drinks"}, {"en:yogurts", "en:desserts", "en:coconut-milks-and-creams", "en:plant-based-creams-for-cooking", "en:coconut-waters", "en:chocolates"}),
    ("soft_drinks", {"en:sodas", "en:colas", "en:kombuchas", "en:lemonade", "en:flavoured-waters", "en:energy-drinks", "en:iced-teas", "en:carbonated-soft-drinks", "en:tonic-water", "en:ginger-beers"}, {"en:alcoholic-beverages", "en:beers", "en:wines", "en:ciders", "en:mineral-waters", "en:natural-mineral-waters"}),
    ("breakfast_cereal", {"en:breakfast-cereals", "en:mueslis", "en:granolas", "en:porridges"}, {"en:bars", "en:cereal-bars"}),
    ("snack_bars", {"en:cereal-bars", "en:protein-bars", "en:nut-bars", "en:fruit-bars", "en:energy-bars"}, {"en:chocolate-candies", "en:candies"}),
    ("hot_drinks", {"en:teas", "en:tea-bags", "en:black-teas", "en:green-teas", "en:herbal-teas", "en:coffees", "en:instant-coffees", "en:ground-coffees", "en:coffee-capsules", "en:cocoa-and-chocolate-powders", "en:hot-chocolate-powders", "en:instant-hot-chocolate"}, {"en:iced-teas", "en:carbonated-drinks", "en:bars", "en:snacks", "en:fermented-drinks", "en:kombuchas", "en:fruits-and-vegetables-based-foods", "en:iced-coffees"}),
    ("biscuits_chocolate", {"en:biscuits", "en:chocolate-biscuits", "en:cookies", "en:chocolates", "en:milk-chocolates", "en:dark-chocolates", "en:chocolate-bars", "en:filled-chocolates"}, {"en:crackers", "en:crackers-appetizers", "en:oatcakes", "en:rice-cakes", "en:crispbreads", "en:cocoa-and-chocolate-powders", "en:ice-creams"}),
    ("confectionery_sweets", {"en:candies", "en:gummi-candies", "en:jelly-candies", "en:liquorice-candies", "en:chewing-gum", "en:lollipops", "en:hard-candies", "en:marshmallows", "en:chewy-candies"}, {"en:desserts", "en:dessert-mixes"}),
    ("crisps_savoury", {"en:crisps", "en:potato-crisps", "en:popcorn", "en:tortilla-chips", "en:pretzels", "en:salty-snacks"}, {"en:nuts", "en:nuts-and-their-products", "en:crackers", "en:crackers-appetizers", "en:oatcakes", "en:biscuits-and-crackers", "en:crispbreads", "en:rice-cakes", "en:puffed-cereal-cakes", "en:meats", "en:dried-meats", "en:frozen-foods", "en:fries"}),
    ("ready_meals_soup", {"en:soups", "en:meals", "en:canned-meals", "en:instant-noodles", "en:prepared-meals"}, {"en:frozen-foods", "en:pizzas-pies-and-quiches", "en:sandwiches", "en:pizzas", "en:salads", "en:breads", "en:crepes", "en:sauces", "en:condiments", "en:salad-dressings", "en:stocks", "en:bouillon-cubes", "en:rices", "en:pastas", "en:pulses", "en:cereal-grains", "en:sauerkrauts", "en:desserts"}),
    ("bakery_bread", {"en:breads", "en:sliced-breads", "en:wholemeal-breads", "en:sourdough-breads", "en:flatbreads", "en:wraps", "en:tortillas", "en:pita-breads", "en:buns", "en:bread-rolls"}, {"en:frozen-foods", "en:crispbreads", "en:rusks", "en:crackers", "en:breadcrumbs", "en:breadsticks"}),
]
# Name sanity filter on top of the (noisy) OFF category tags: a product whose OFF name says it is something else is
# dropped. assumption: OFF category tags are crowd-sourced and sometimes wrong; these regexes only REMOVE candidates.
NAME_REJECT = {
    "frozen_icecream": r"cherr|frozen fruit|ferrero|torte|cake\b|peas|cones with",
    "plant_milk_dairy_alt": r"coconut milk$|^coconut milk|lait de coco|coco lopez|kokosmilch|coconut water|eau de coco|cream|ovaltine|whitener|powder",
    "soft_drinks": r"\bwater\b(?!.*(flavou?r|peach|raspberr|lemon|lime|cucumber|apple|berry|tonic))|mineral",
    "hot_drinks": r"iced|carrot|kombucha|bar\b|frappuccino|energy|detox|perform",
    "crisps_savoury": r"oatcake|cracker|crispbread|crisp bread|jerky|fries|rice cake|corn cake|flatbread|fettuccine|alfredo|cauliflower|coleslaw|pakora|dip\\b",
    "ready_meals_soup": r"salad cream|crepe|crêpe|stock|cube|bread|rice\b|lentils|grains|sauerkraut|chucrut|tamari|sauce$|wholefood|selection|waffle",
    "yoghurt": r"bites|oats|granola",
    "confectionery_sweets": r"dessert mix|angel delight|jelly$|daim",
    "biscuits_chocolate": r"oatcake|cracker|brek|oatibix",
    "bakery_bread": r"breadstick|crouton|crispbread|torinesi|taco",
    }
# assumption: a product name with these words is not an English UK pack name (OFF UK pool includes EU imports whose
# product_name is in French/German/Spanish/etc.). English UK pack copy is required so the shopper agent reads English.
FOREIGN = re.compile(r"\b(de|du|des|au|aux|avec|sans|le|la|les|et|mit|ohne|und|der|die|das|el|al|con|y|di|alla|"
                     r"goût|gout|chocolat|lait|eau|boisson|flocons|sojadrink|joghurt\w*|mandel|hafer|schokoladen\w*|"
                     r"kokosmilch|brassé|yaourts?|citron|glace|batonnet|parfum|coffret|bolachas|puur|noir|sukkerfri|"
                     r"mineralwasser|sablés|chucrut|estilo|vollkornbrot|roggen|eis|torte|kakao|natur|avoine|mélange|"
                     r"complète|complets|trigo|riz|cèpes|tészta\w*|kpoptészta|petillante|gingembre|fleur|soja|"
                     r"geröstete|zucker|milch|sel|poivre|nature|boite|ovale|bio|w|sosie|rodzajów|karamel|int)\b|\d{5,}", re.I)
# subtype bins: the greedy picker spreads added SKUs across these so a category is not all one format
SUBTYPES = {
    "biscuits_chocolate": [("biscuit", {"en:biscuits", "en:cookies", "en:chocolate-biscuits"}), ("chocolate", {"en:chocolates"})],
    "soft_drinks": [("cola", {"en:colas"}), ("energy", {"en:energy-drinks"}), ("kombucha", {"en:kombuchas"}), ("iced_tea", {"en:iced-teas"}), ("flavoured_water", {"en:flavoured-waters"})],
    "hot_drinks": [("cocoa", {"en:cocoa-and-chocolate-powders"}), ("coffee", {"en:coffees", "en:instant-coffees", "en:ground-coffees"}), ("tea", {"en:teas", "en:tea-bags"})],
    "ready_meals_soup": [("soup", {"en:soups"}), ("noodles", {"en:instant-noodles"}), ("meal", {"en:meals", "en:canned-meals"})],
    "crisps_savoury": [("popcorn", {"en:popcorn"}), ("tortilla", {"en:tortilla-chips"}), ("pretzel", {"en:pretzels"}), ("crisps", {"en:crisps", "en:potato-crisps"})],
    "yoghurt": [("plant", {"en:non-dairy-yogurts", "en:plant-based-yogurts", "en:dairy-substitutes"}), ("greek", {"en:greek-style-yogurts"}), ("fruit", {"en:fruit-yogurts"})],
    "bakery_bread": [("wraps_flat", {"en:wraps", "en:tortillas", "en:flatbreads", "en:pita-breads"}), ("rolls_buns", {"en:buns", "en:bread-rolls"}), ("loaf", {"en:breads"})],
}

# ---------------------------------------------------------------- roles
OWN_LABEL_RETAILERS = ["tesco", "sainsbury's", "sainsburys", "asda", "aldi", "lidl", "morrisons", "co-op", "coop",
                       "m&s", "marks & spencer", "marks and spencer", "waitrose", "iceland", "ocado"]
# assumption: well-known retailer-exclusive sub-brands (Aldi/Lidl/Tesco/etc. exclusive labels), so they are own_label
# even though the retailer name is not in the OFF brand string. Seed list = the own-label sub-brands already used by
# the curators (Freeway, Crownfield, Gelatelli, Bellarom, Specially Selected, Everyday Essentials, Sweet Corner, Alesto,
# Bramwells, Deluxe) plus their best-known siblings.
OWN_LABEL_SUBBRANDS = ["freeway", "crownfield", "gelatelli", "bellarom", "specially selected", "everyday essentials",
                       "sweet corner", "alesto", "bramwells", "deluxe", "milbona", "pilos", "snack day", "harvest morn",
                       "moser roth", "dairyfine", "choceur", "j.d. gross", "fin carre", "sondey", "solevita",
                       "vemondo", "mamia", "oaklands", "the deli", "cucina", "stockwell", "hearty food co",
                       "by sainsbury", "extra special", "just essentials", "the best", "duchy organic",
                       "essential waitrose", "simply", "baresi", "belbake", "rowan hill", "brooklea", "emporium",
                       "nature's pick", "corale", "cowbelle", "grandessa", "barissimo", "expressi", "nutoka",
                       "acti leaf", "the grower's harvest", "growers harvest", "alcafe", "diplomat", "kong strong", "carrick glen"]
# assumption: big UK brands for the 4 categories that data/sales/uk_bestsellers.csv does not cover (bakery, frozen,
# hot drinks, sugar confectionery). Seeded from the curators' own incumbents in those categories plus the obvious
# category leaders; labelled per product as role_source.
INCUMBENT_ASSUMED = ["warburtons", "hovis", "kingsmill", "allinson", "mission", "new york bakery", "roberts", "genius",
                     "ben & jerry's", "ben and jerry's", "magnum", "wall's", "walls", "carte d'or", "haagen-dazs",
                     "häagen-dazs", "cornetto", "swedish glace", "kelly's", "mackie's", "yorkshire tea", "taylors",
                     "pg tips", "tetley", "twinings", "typhoo", "clipper", "nescafe", "nescafé", "kenco",
                     "douwe egberts", "lavazza", "starbucks", "options", "galaxy", "haribo", "maynards", "bassetts",
                     "rowntree", "swizzels", "wrigley", "skittles", "starburst", "fox's glacier", "polo", "trebor",
                     "cadbury", "nestle", "nestlé", "mars", "kellogg", "quaker", "alpen", "jordans", "weetabix"]
NON_BRAND_ROWS = {"category total", "total category", "own label", "own label (all retailers)", "tesco (own label)"}


def subtype(cat, tags):
    for name, ts in SUBTYPES.get(cat, []):
        if tags & ts:
            return name
    return "other"


def norm(s) -> str:
    s = str(s or "").lower().replace("’", "'").replace("é", "e").replace("ü", "u").replace("ä", "a")
    return re.sub(r"\s+", " ", s).strip()


def load_bestseller_brands():
    """Incumbent brands = brands in NIQ/Kantar/trade top lists (not the 'other_*' watch-lists of challengers)."""
    out = set()
    with open(P("data/sales/uk_bestsellers.csv"), newline="") as f:
        for r in csv.DictReader(f):
            b = norm(r["brand"])
            if not b or b in NON_BRAND_ROWS or r["table"].startswith("other_"):
                continue
            out.add(b)
    return out


GENERIC_FIRST = {"the", "old", "light", "high", "simply", "little", "real", "nature", "natural", "sweet", "crunchy",
                 "special", "original", "pure", "total", "white", "fresh", "good", "go", "own", "category", "free"}


def bfirst(s) -> str:
    k = re.sub(r"[^a-z0-9 ]", " ", norm(s).split(",")[0]).split()
    return k[0] if k else ""


def bkey(s) -> str:
    return re.sub(r"[^a-z0-9&, ]", "", norm(s))


def brand_matches(brand_n: str, names, first_token=False) -> str | None:
    """Whole-word match of a known brand inside the OFF brand string (apostrophes ignored). With first_token, the
    known brand's first word (>=4 letters, not generic) is enough: 'Lindt Excellence' (sales list) matches 'Lindt'."""
    b = bkey(brand_n)
    for n in names:
        nn = bkey(n)
        if not nn:
            continue
        if b == nn or re.search(r"(^|[\s,(/-])" + re.escape(nn) + r"($|[\s,)/-])", b):
            return n
        if first_token:
            ft = nn.split()[0] if nn.split() else ""
            if len(ft) >= 4 and ft not in GENERIC_FIRST and re.search(r"(^|[\s,])" + re.escape(ft) + r"($|[\s,])", b):
                return n
    return None


def role_for(brand: str, bestsellers, curated_inc):
    b = norm(brand)
    m = brand_matches(b, OWN_LABEL_RETAILERS)
    if m:
        return "own_label", f"brand '{brand}' contains UK retailer name '{m}' (OFF brands)"
    m = brand_matches(b, OWN_LABEL_SUBBRANDS)
    if m:
        return "own_label", f"assumption: '{m}' is a retailer-exclusive sub-brand (OFF brands='{brand}')"
    m = brand_matches(b, bestsellers, first_token=True)
    if m:
        return "incumbent", f"brand '{m}' appears in data/sales/uk_bestsellers.csv top lists (OFF brands='{brand}')"
    m = brand_matches(b, curated_inc)
    if m:
        return "incumbent", f"brand '{m}' is an incumbent in the curated set (data/products/curated) (OFF brands='{brand}')"
    m = brand_matches(b, INCUMBENT_ASSUMED)
    if m:
        return "incumbent", f"assumption: '{m}' is a long-standing UK category leader not covered by uk_bestsellers.csv"
    return "challenger", "brand not own-label and not in uk_bestsellers.csv / curated incumbents / assumed leaders"


# ---------------------------------------------------------------- OFF field helpers
def split(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return []
    return [t for t in str(v).split("|") if t]


def num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else round(f, 2)
    except (TypeError, ValueError):
        return None


QTY_RE = re.compile(r"(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|gram|grams|gr|ml|cl|l|litre|litres|liter)\b", re.I)


def parse_qty(q):
    """-> (total_g_or_ml, item_g_or_ml) from OFF quantity. ml treated as g (assumption: density ~1 for shelf maths)."""
    if not q:
        return None, None
    m = QTY_RE.search(str(q))
    if not m:
        return None, None
    n = int(m.group(1)) if m.group(1) else 1
    v = float(m.group(2).replace(",", "."))
    u = m.group(3).lower()
    mult = {"kg": 1000, "l": 1000, "litre": 1000, "litres": 1000, "liter": 1000, "cl": 10}.get(u, 1)
    item = v * mult
    if item <= 0 or item > 20000:
        return None, None
    return item * n, item


SWEET_E = {f"en:e{n}" for n in list(range(950, 970)) + [420, 421]}
SWEET_WORDS = re.compile(r"stevia|steviol|erythritol|sucralose|aspartame|acesulfame|saccharin|xylitol|maltitol|sorbitol", re.I)
AZO = {"en:e102", "en:e104", "en:e110", "en:e122", "en:e124", "en:e129"}
EMULS = {"en:e471", "en:e472e", "en:e481", "en:e482", "en:e461", "en:e464", "en:e466", "en:e433", "en:e407", "en:e322i"}
GLUTEN = re.compile(r"\b(wheat|barley|rye|spelt|gluten|malt(?![oi]))", re.I)
ETHICAL = re.compile(r"carbon|b-corp|b-corporation|fair-?trade|climatepartner|vegan-society|vegetarian-society|soil-association|fsc|rainforest|utz", re.I)
MAJOR_GROCERS = re.compile(r"tesco|sainsbury|asda|morrisons|aldi|lidl|waitrose|co-op|coop|m&s|marks|iceland|ocado", re.I)
CLAIMS = {
    "protein": re.compile(r"protein", re.I),
    "gut/pre-probiotic": re.compile(r"prebiotic|probiotic|\bgut\b|live culture|kefir|kombucha", re.I),
    "high fibre": re.compile(r"high[- ]fib|fibre[- ]?rich|source-of-fibre", re.I),
    "added vitamins/energy/adaptogen": re.compile(r"vitamin|energy|immun|boost|ginseng|adaptogen|collagen|ashwagandha|mushroom|superfood", re.I),
    "low/zero/no-sugar": re.compile(r"no added sugar|sugar[- ]free|zero sugar|low sugar|no-added-sugar|reduced sugar", re.I),
    "keto/guilt-free/skinny": re.compile(r"keto|guilt|skinny|light\b|lighter", re.I),
}
TREND_COMMON = r"protein|prebiotic|probiotic|\bgut\b|kombucha|kefir|oat|plant[- ]based|vegan|gluten[- ]free|keto|zero sugar|matcha|mochi|sour|sourdough|collagen|ginger|turmeric|mushroom|lentil|chickpea|pea\b|seaweed|yuzu|biscoff|pistachio|dubai"
TREND = re.compile(TREND_COMMON, re.I)

ECO = {"a-plus": 1, "a": .9, "b": .75, "c": .5, "d": .25, "e": .1, "f": 0}
NUTRI = {"a": 1, "b": .75, "c": .5, "d": .25, "e": 0}

# assumption: single-serve thresholds per category (g or ml of ONE item): (<=small -> 1, <=medium -> .5, else 0).
# Taken from the curated rule files where they define one (soft_drinks 330/500, confectionery 50/150,
# frozen ~125/500, plant milk 600/1000); others are UK pack-format conventions (assumption).
SERVE = {"soft_drinks": (330, 500), "crisps_savoury": (50, 150), "snack_bars": (50, 150), "breakfast_cereal": (60, 375),
         "yoghurt": (150, 500), "biscuits_chocolate": (50, 150), "plant_milk_dairy_alt": (600, 1000),
         "ready_meals_soup": (400, 600), "bakery_bread": (100, 450), "frozen_icecream": (125, 500),
         "hot_drinks": (30, 250), "confectionery_sweets": (50, 150)}


def r3(x):
    return round(float(min(1.0, max(0.0, x))), 3)


# ---------------------------------------------------------------- scales derived from the curated set
def curated_scales(curated, offidx):
    """Per-category caps = max (or band) of the curated products' OFF values; every number here is data-derived."""
    by = defaultdict(list)
    for p in curated:
        by[p["category"]].append(p)
    sc = {}
    for c, ps in by.items():
        def vals(k, lo=0, hi=1e9):
            out = []
            for p in ps:
                v = num(p.get(k))
                if v is None and p["code"] in offidx:
                    v = num(offidx[p["code"]].get(k.replace("energy_kcal", "energy-kcal")))
                if v is not None and lo <= v <= hi:
                    out.append(v)
            return out
        s = vals("sugars_100g", 0, 100)
        k = vals("energy_kcal_100g", 1, 900)
        pr = vals("proteins_100g", 0, 100)
        fi = vals("fiber_100g", 0, 30)
        sc[c] = {
            "sugar_cap": round(max(max(s or [10]), 2.0), 1),
            "kcal_cap": round(max(max(k or [100]), 30.0), 0),
            "protein_cap": round(max(max(pr or [5]), 5.0), 1),
            "fibre_cap": round(max(max(fi or [3]), 3.0), 1),
        }
    return sc


def pack_total(p, offidx):
    t, _ = parse_qty(p.get("quantity"))
    if t is None and p["code"] in offidx:
        t, _ = parse_qty(offidx[p["code"]].get("quantity"))
    return t


def fit_price_model(curated, offidx):
    """log(price) = a_cat + beta*log(pack/median_pack_cat) + gamma_role, OLS on the curated set (whose prices are
    themselves curator assumptions). Returns per-category medians, role multipliers and beta."""
    rows = []
    for p in curated:
        t = pack_total(p, offidx)
        if t and p.get("price_gbp"):
            rows.append((p["category"], p["role"], t, float(p["price_gbp"])))
    med_pack = {c: float(np.median([r[2] for r in rows if r[0] == c])) for c in CATS}
    med_price = {c: float(np.median([float(p["price_gbp"]) for p in curated if p["category"] == c])) for c in CATS}
    band = {c: (min(float(p["price_gbp"]) for p in curated if p["category"] == c),
                max(float(p["price_gbp"]) for p in curated if p["category"] == c)) for c in CATS}
    X, y = [], []
    for c, role, t, pr in rows:
        x = [1.0 if c == cc else 0.0 for cc in CATS]
        x += [math.log(t / med_pack[c]), 1.0 if role == "own_label" else 0.0, 1.0 if role == "challenger" else 0.0]
        X.append(x)
        y.append(math.log(pr))
    coef, *_ = np.linalg.lstsq(np.array(X), np.array(y), rcond=None)
    beta = float(coef[len(CATS)])
    mult = {"incumbent": 1.0, "own_label": round(math.exp(coef[len(CATS) + 1]), 3), "challenger": round(math.exp(coef[len(CATS) + 2]), 3)}
    # category intercept at incumbent, median pack:
    base = {c: round(math.exp(coef[i]), 2) for i, c in enumerate(CATS)}
    return {"n_fit": len(rows), "beta_pack": round(beta, 3), "role_mult": mult, "base_incumbent_median_pack": base,
            "median_pack": {c: round(v, 0) for c, v in med_pack.items()}, "median_price": med_price, "band": band}


def unit_price_band(curated, offidx):
    out = {}
    for c in CATS:
        ups = []
        for p in curated:
            if p["category"] != c:
                continue
            t = pack_total(p, offidx)
            if t:
                ups.append(float(p["price_gbp"]) / t * 1000)
        out[c] = (round(min(ups), 2), round(max(ups), 2)) if ups else (1.0, 10.0)
    return out


# ---------------------------------------------------------------- lens grades (one shared rule set)
def grade(p, cat, sc, upb):
    s = sc[cat]
    adds = p["additives"]
    labels = p["labels"]
    lab = "|".join(labels)
    ana = "|".join(p.get("analysis") or [])
    ingr = p.get("ingredients_text") or ""
    name = p["name"]
    text = " ".join([name, lab, ingr[:400], p.get("pack_copy") or ""])
    sugar = p["sugars_100g"]
    kcal = p["energy_kcal_100g"]
    prot = p["proteins_100g"]
    fib = p["fiber_100g"]
    add_n = p["additives_n"] or 0
    add_s = 1 - min(add_n, 10) / 10
    eco = ECO.get(p["ecoscore"] or "", 0.5)
    nutri = NUTRI.get(p["nutriscore"] or "", 0.5)
    organic = 1.0 if "organic" in lab else 0.0
    if "en:palm-oil-free" in ana or re.search(r"no palm oil", ingr, re.I):
        palm_free, palm_txt = 1.0, "palm-oil-free=True (OFF analysis/ingredients)"
    elif re.search(r"\bpalm\b", ingr, re.I) or "en:palm-oil|" in ana + "|":
        palm_free, palm_txt = 0.0, "palm oil present (OFF ingredients/analysis)"
    else:
        palm_free, palm_txt = 0.5, "palm oil unknown (OFF; ->0.5)"
    sweet = p["sweeteners"] or 0
    sugar_s = 1 - min(sugar, s["sugar_cap"]) / s["sugar_cap"] if sugar is not None else 0.5
    kcal_s = 1 - min(kcal, s["kcal_cap"]) / s["kcal_cap"] if kcal is not None and kcal < 950 else 0.5
    prot_s = min((prot or 0) / s["protein_cap"], 1)
    fib_s = min((fib or 0) / s["fibre_cap"], 1) if fib is not None and fib <= 30 else 0.0
    _, item = parse_qty(p.get("quantity"))
    small, med = SERVE[cat]
    serve = 0.5 if item is None else (1.0 if item <= small else 0.5 if item <= med else 0.0)
    lo, hi = upb[cat]
    up = p.get("unit_price_gbp_per_kg")
    unit_s = 0.5 if up is None else 1 - (min(max(up, lo), hi) - lo) / max(hi - lo, 1e-9)
    nova = p["nova"] if p["nova"] in (1, 2, 3, 4) else 4
    markers = sorted(set(adds) & (AZO | EMULS))
    claims = [k for k, rx in CLAIMS.items() if rx.search(text)]
    mixed = (sugar or 0) > 0.5 and sweet > 0
    vegan_s = 1.0 if "en:vegan" in lab else .8 if "en:vegan" in ana.split("|") else .5 if "en:maybe-vegan" in ana else .3
    ethical = sorted({m.group(0) for m in ETHICAL.finditer(lab)})
    role = p["role"]
    mainstream = role in ("incumbent", "own_label") or bool(MAJOR_GROCERS.search(p.get("stores") or ""))
    gf_label = "en:no-gluten" in lab or "en:gluten-free" in lab or "en:products-without-gluten" in "|".join(p.get("_cats") or [])
    gl = GLUTEN.search(ingr) or "en:gluten" in (p.get("allergens") or [])
    trend = TREND.search(name + " " + lab)
    G = {}
    G["eco_low_chemical"] = (0.4 * add_s + 0.3 * eco + 0.2 * organic + 0.1 * palm_free,
                             [f"additives_n={add_n} (OFF)", f"ecoscore={p['ecoscore']} (OFF; unknown->0.5)", f"organic={bool(organic)} (OFF labels)", palm_txt])
    G["upf_avoider_parent"] = (0.4 * (4 - nova) / 3 + 0.2 * add_s + 0.2 * (sweet == 0) + 0.1 * (not markers) + 0.1 * sugar_s,
                               [f"nova={p['nova']} (OFF)", f"additives_n={add_n} (OFF)", f"sweeteners={sweet} (OFF additives/ingredients_text)",
                                f"azo/emulsifier markers={markers or 'none'} (OFF additives)", f"sugars_100g={sugar} (OFF; cap {s['sugar_cap']})"])
    G["glp1_small_appetite"] = (0.35 * sugar_s + 0.25 * serve + 0.2 * fib_s + 0.2 * kcal_s,
                                [f"sugars_100g={sugar} (OFF)", f"item size={item} (OFF quantity; serve band {small}/{med})",
                                 f"fiber_100g={fib} (OFF; cap {s['fibre_cap']})", f"energy-kcal_100g={kcal} (OFF; cap {s['kcal_cap']})"])
    G["frugal_unit_price"] = (0.85 * unit_s + 0.15 * (role == "own_label"),
                              [f"unit_price=£{up}/kg|L (price_gbp is assumption / OFF quantity; band £{lo}-£{hi})", f"role={role}"])
    G["protein_gym"] = (0.6 * prot_s + 0.2 * sugar_s + 0.2 * kcal_s,
                        [f"proteins_100g={prot} (OFF; cap {s['protein_cap']})", f"sugars_100g={sugar} (OFF)", f"energy-kcal_100g={kcal} (OFF)"])
    G["protein_sceptic_gimmick_reactant"] = (0.6 * (1 - min(len(claims), 3) / 3) + 0.2 * (sweet == 0) + 0.2 * add_s,
                                             [f"functional_claims={claims} (OFF name/labels/ingredients_text)", f"sweeteners={sweet} (OFF)", f"additives_n={add_n} (OFF)"])
    G["habit_loyalist_shrinkflation_angry"] = (0.5 * (role == "incumbent") + 0.3 * (not mixed) + 0.2 * unit_s,
                                               [f"role={role}", f"sugar+sweetener blend={mixed} (OFF sugars_100g + additives)", f"unit_price=£{up} (assumption)"])
    G["meal_deal_office"] = (0.4 * serve + 0.3 * mainstream + 0.3 * sugar_s,
                             [f"item size={item} (OFF quantity)", f"mainstream={mainstream} (role / OFF stores='{p.get('stores')}')", f"sugars_100g={sugar} (OFF)"])
    G["vegan_ethical"] = (0.6 * vegan_s + 0.2 * organic + 0.2 * bool(ethical),
                          [f"vegan_signal={vegan_s} (OFF labels/analysis)", f"organic={bool(organic)} (OFF labels)", f"ethical_labels={ethical or 'none'} (OFF labels)"])
    if gl:
        cs, cw = 0.1, f"gluten source in ingredients/allergens ('{gl.group(0) if hasattr(gl, 'group') else 'en:gluten'}') (OFF)"
    elif gf_label:
        cs, cw = 1.0, "label en:no-gluten / category products-without-gluten (OFF)"
    else:
        cs, cw = 0.7, "no gluten ingredient, but no gluten-free label (OFF)"
    if not ingr:
        cs -= 0.1
        cw += "; ingredients missing -> -0.1"
    G["allergen_coeliac"] = (cs, [cw])
    G["ai_delegator"] = (0.4 * (p["completeness"] or 0) + 0.4 * nutri + 0.2 * bool(p.get("stores")),
                         [f"completeness={p['completeness']} (OFF)", f"nutriscore={p['nutriscore']} (OFF; unknown->0.5)", f"stores known={bool(p.get('stores'))} (OFF)"])
    G["novelty_seeker_tiktok"] = (0.55 * (role == "challenger") + 0.45 * bool(trend),
                                  [f"role={role}", f"trend term={trend.group(0) if trend else 'none'} (OFF name/labels)"])
    return {k: {"score": r3(v), "why": w} for k, (v, w) in G.items()}


# ---------------------------------------------------------------- selection
def name_key(name, brand):
    n = norm(name)
    for w in norm(brand).split(","):
        w = w.strip()
        if w:
            n = n.replace(w, " ")
    n = re.sub(r"\d+(?:[.,]\d+)?\s*(kg|g|ml|l|cl|x|pack|pk)\b", " ", n)
    n = re.sub(r"[^a-z ]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def englishish(s):
    s = str(s or "")
    letters = [ch for ch in s if ch.isalpha()]
    return len(letters) >= 3 and sum(ch.isascii() for ch in letters) / len(letters) >= 0.95


def bins(p):
    add = p["additives_n"] or 0
    sug = p["sugars_100g"]
    lab = "|".join(p["labels"]) + "|" + "|".join(p.get("analysis") or [])
    return {"nova": p["nova"], "additives": 0 if add == 0 else 1 if add <= 3 else 2, "organic": "organic" in lab,
            "vegan": "en:vegan" in lab, "sugar": None if sug is None else (0 if sug < 5 else 1 if sug < 20 else 2),
            "subtype": p.get("_sub", "other")}


def main():
    df = pd.read_parquet(P("data/products/uk_products.parquet"))
    df = df.drop_duplicates("code")
    offidx = {r["code"]: r for r in df.to_dict("records")}

    # 1) curated products (catalog.json + the 4 extra curated categories), unchanged
    catalog = json.load(open(P("data/products/catalog.json")))
    have = {p["code"] for p in catalog}
    curated = list(catalog)
    for f in sorted(glob.glob(P("data/products/curated/*.json"))):
        for p in json.load(open(f)).get("products", []):
            if p["code"] not in have:
                curated.append(p)
                have.add(p["code"])
    for p in curated:
        p["curation"] = "curated"
    cats_present = sorted({p["category"] for p in curated})
    assert set(cats_present) == set(CATS), cats_present

    bestsellers = load_bestseller_brands()
    curated_inc = sorted({norm(p["brand"]) for p in curated if p["role"] == "incumbent"})
    sc = curated_scales(curated, offidx)
    price = fit_price_model(curated, offidx)
    upb = unit_price_band(curated, offidx)

    # 2) candidate pool
    cand = defaultdict(list)
    for r in df.to_dict("records"):
        if r["code"] in have:
            continue
        img = r.get("image") or ""
        if not img or "invalid" in img or not str(r.get("name") or "").strip() or not str(r.get("brand") or "").strip():
            continue
        if not r.get("ingredients_text") or num(r.get("sugars_100g")) is None or not englishish(r["name"]):
            continue
        if FOREIGN.search(r["name"]) or re.search(r"\boz\b", str(r.get("quantity") or ""), re.I):
            continue
        tags = set(split(r["categories"]))
        for c, inc, exc in SELECTORS:
            if tags & inc and not tags & exc:
                if not re.search(NAME_REJECT.get(c, r"^$x"), str(r["name"]), re.I):
                    r["_sub"] = subtype(c, tags)
                    cand[c].append(r)
                break

    added = []
    pool_sizes = {}
    for c in CATS:
        pool = cand[c]
        pool_sizes[c] = len(pool)
        need = TARGET_PER_CAT - sum(1 for p in curated if p["category"] == c)
        for r in pool:
            uk = str(r["code"]).startswith("50") or bool(MAJOR_GROCERS.search(str(r.get("stores") or "")))
            r["_uk"] = uk
            # quality = log1p(OFF unique scans) + 2*OFF completeness + 1 if UK signal (GS1 UK '50' prefix or OFF stores
            # lists a UK grocer). assumption: weights chosen so a UK-sold, well-documented SKU beats a heavily
            # scanned import.
            r["_q"] = math.log1p(num(r.get("scans")) or 0) + 2 * (num(r.get("completeness")) or 0) + (1.0 if uk else 0.0)
            r["_role"], r["_role_src"] = role_for(r["brand"], bestsellers, curated_inc)
        pool.sort(key=lambda r: -r["_q"])
        pool = pool[:600]
        # assumption: role mix for the added SKUs ~ 40% challenger / 35% incumbent / 25% own_label, close to the curated
        # set's own mix (66 challenger / 48 incumbent / 30 own_label of 144) but with more own-label, as in real UK shelves
        quota = {"challenger": round(need * .40), "incumbent": round(need * .35)}
        quota["own_label"] = need - quota["challenger"] - quota["incumbent"]
        chosen_keys = [(norm(p["brand"]), name_key(p["name"], p["brand"])) for p in curated if p["category"] == c]
        bin_count = defaultdict(Counter)
        for p in curated:
            if p["category"] == c:
                ctags = set(split(offidx.get(p["code"], {}).get("categories")))
                for k, v in bins({**p, "_sub": subtype(c, ctags), "analysis": p.get("analysis") if isinstance(p.get("analysis"), list) else split(p.get("analysis"))}).items():
                    bin_count[k][v] += 1
        picks = []
        brand_count = Counter(bfirst(p["brand"]) for p in curated if p["category"] == c)
        qmax = max([r["_q"] for r in pool] or [1])

        def prep(r):
            return {"nova": int(r["nova"]), "additives_n": int(r["additives_n"]), "sugars_100g": num(r["sugars_100g"]),
                    "labels": split(r["labels"]), "analysis": split(r["analysis"]), "_sub": r["_sub"]}

        def dup(r):
            k = (norm(r["brand"]), name_key(r["name"], r["brand"]))
            for b, n in chosen_keys:
                if b == k[0] and difflib.SequenceMatcher(None, n, k[1]).ratio() >= 0.8:
                    return True
                if n and n == k[1] and difflib.SequenceMatcher(None, b, k[0]).ratio() >= 0.6:
                    return True
            return False

        relax = False
        while len(picks) < need:
            best, best_s = None, -1
            for r in pool:
                if r.get("_taken"):
                    continue
                if not relax and quota.get(r["_role"], 0) <= 0:
                    continue
                if brand_count[bfirst(r["brand"])] >= 4:  # assumption: max 4 SKUs per brand (first word) per category, keeps variety
                    continue
                b = bins(prep(r))
                variety = sum((1.5 if k == "subtype" else 1) / (1 + bin_count[k][v]) for k, v in b.items())  # rarer attribute bins score higher
                s = r["_q"] / qmax + 0.6 * variety
                if s > best_s:
                    if dup(r):
                        r["_taken"] = True  # near-duplicate, never pick
                        continue
                    best, best_s = r, s
            if best is None:
                if relax:
                    break
                relax = True  # quota could not be met from this pool -> fill from any role (reported in summary)
                continue
            best["_taken"] = True
            quota[best["_role"]] = quota.get(best["_role"], 0) - 1
            brand_count[bfirst(best["brand"])] += 1
            chosen_keys.append((norm(best["brand"]), name_key(best["name"], best["brand"])))
            for k, v in bins(prep(best)).items():
                bin_count[k][v] += 1
            picks.append(best)
        for r in picks:
            added.append(build_product(r, c, price, sc, upb))

    xl = curated + added
    json.dump(xl, open(P("data/products/catalog_xl.json"), "w"), indent=1, ensure_ascii=False)

    cfg = build_store_config(sc, price, upb, pool_sizes)
    plano = build_planogram(xl, cfg)
    json.dump(cfg, open(P("data/store/store_xl.config.json"), "w"), indent=1, ensure_ascii=False)
    json.dump(plano, open(P("data/store/planogram_xl.json"), "w"), indent=1, ensure_ascii=False)
    validate()


def build_product(r, c, price, sc, upb):
    total, item = parse_qty(r.get("quantity"))
    role = r["_role"]
    base = price["base_incumbent_median_pack"][c]
    mult = price["role_mult"][role]
    rel = (total / price["median_pack"][c]) if total else 1.0
    raw = base * mult * rel ** price["beta_pack"]
    lo, hi = price["band"][c]
    pr = round(min(max(raw, lo), hi) * 20) / 20 - 0.01  # snap to x.x9/x.x4 shelf-price endings
    pr = round(max(pr, 0.25), 2)
    sweet_list = sorted(set(split(r["additives"])) & SWEET_E)
    words = sorted({w.lower() for w in SWEET_WORDS.findall(r.get("ingredients_text") or "")})
    labels = split(r["labels"])
    lab_txt = [l.split(":", 1)[-1].replace("-", " ") for l in labels if l.startswith("en:")][:4]
    p = {
        "code": r["code"], "name": str(r["name"]).strip(), "brand": str(r["brand"]).strip(), "category": c,
        "role": role, "role_source": r["_role_src"], "curation": "auto_xl",
        "price_gbp": pr,
        "price_source": (f"assumption: category median RRP band by role — price = base[{c}]=£{base} x role_mult[{role}]={mult} x "
                         f"(pack {total or 'unknown'}/{price['median_pack'][c]})^{price['beta_pack']}, clipped to curated band "
                         f"£{lo}-£{hi}; fitted on the curated set's (assumed) prices; see data/products/curated_xl_rules.md"),
        "pack_copy": str(r["name"]).strip() + (" - " + ", ".join(lab_txt) if lab_txt else ""),
        "pack_copy_source": "auto: OFF product_name + OFF labels (no front-of-pack text read)",
        "nova": int(r["nova"]), "nutriscore": r.get("nutriscore"), "ecoscore": r.get("ecoscore"),
        "additives_n": int(r["additives_n"]), "additives": split(r["additives"]), "labels": labels,
        "analysis": split(r["analysis"]), "allergens": split(r["allergens"]),
        "ingredients_n": num(r.get("ingredients_n")), "ingredients_text": r.get("ingredients_text"),
        "sugars_100g": num(r["sugars_100g"]), "fiber_100g": num(r["fiber_100g"]), "proteins_100g": num(r["proteins_100g"]),
        "salt_100g": num(r["salt_100g"]), "energy_kcal_100g": num(r["energy-kcal_100g"]), "fat_100g": num(r["fat_100g"]),
        "sweeteners": max(len(sweet_list), len(words)), "sweeteners_list": sweet_list + words,
        "palm_oil_n": None, "quantity": r.get("quantity"), "pack_total_g_or_ml": total,
        "unit_price_gbp_per_kg": round(pr / total * 1000, 2) if total else None,
        "stores": r.get("stores"), "recycling": [], "image": r["image"], "off_url": r["off_url"],
        "completeness": num(r["completeness"]), "scans": num(r["scans"]),
        "_cats": split(r["categories"]),
    }
    p["lens_grades"] = grade(p, c, sc, upb)
    p.pop("_cats")
    return p


# ---------------------------------------------------------------- layout
def build_store_config(sc, price, upb, pool_sizes):
    spacing = 5.0  # same gondola pitch as web/src/layout.ts G.spacing (assumption there: ~4m walkway + 1m gondola)
    n_aisles = len(CATS)
    gx = lambda a: (a - (n_aisles + 1) / 2) * spacing  # noqa: E731  (same formula as web gondolaX)
    chilled = {"yoghurt", "plant_milk_dairy_alt", "ready_meals_soup"}
    units = []
    for i, c in enumerate(CATS):
        a = i + 1
        for k, side in enumerate(("L", "R")):
            units.append({"id": f"U{2 * i + k + 1}", "aisle": a, "side": side, "category": c,
                          "fridge": c in chilled or c == "frozen_icecream", "freezer": c == "frozen_icecream",
                          "x": round(gx(a) + (-0.5 if side == "L" else 0.5), 2), "z": 10.0})
    checkouts = []
    for k in range(6):  # staffed bank, centred under the middle aisles
        checkouts.append({"id": f"T{k + 1}", "type": "staffed", "bank": "tills", "x": round(-7.0 + k * 2.8, 2), "z": 22.0, "lanes": 1})
    for b, x0 in (("self_west", -24.0), ("self_east", 16.0)):
        for k in range(6):  # 2 rows x 3 kiosks per bank
            checkouts.append({"id": f"{'SW' if b == 'self_west' else 'SE'}{k + 1}", "type": "self", "bank": b,
                              "x": round(x0 + (k % 3) * 1.6, 2), "z": 21.0 + (k // 3) * 2.0, "lanes": 1})
    return {
        "name": "eat_hack XL store (5x)",
        "aisles": n_aisles, "rows_per_unit": 4,
        "row_names": {"1": "top", "2": "eye", "3": "lower", "4": "bottom"},
        "notice_row_map": {"1": "top", "2": "eye", "3": "bottom", "4": "bottom",
                           "source": "assumption: sim/notice.py has alphas for top/eye/bottom only; 'lower' (just below eye) "
                                     "is given the bottom alpha until a sourced lower-shelf ratio is added (conservative)"},
        "products_per_slot": 5,
        "units": units,
        "entrance": {"x": -15.0, "z": -2.0},
        "entrances": [{"id": "E1", "x": -15.0, "z": -2.0}, {"id": "E2", "x": 15.0, "z": -2.0}],
        "checkout": {"x": 0.0, "z": 22.0},
        "checkouts": checkouts,
        "stockroom": {"x": 0.0, "z": 30.0, "door": {"x": 0.0, "z": 26.5}, "w": 20.0, "d": 6.0,
                      "source": "assumption: staff-only stockroom behind the checkout line, door on the centre line"},
        "aisle_widths": {"walkway_m": round(spacing - 1.0, 1), "cross_aisle_m": 2.4, "gondola_depth_m": 1.0, "unit_len_m": 6.4,
                         "source": "assumption: same geometry as web/src/layout.ts (G.spacing 5.0 - depth 1.0 = 4m walkway so two trolleys pass; crossGap 2.4)"},
        "layout_notes": [
            "12 aisles x 2 sides = 24 units (one category per aisle, both sides) instead of ~10 aisles x 2: keeps one category per gondola so the web aisle signs and the per-unit category field still hold; 24 units x 4 rows x 5 = 480 product slots.",
            "chilled categories (yoghurt, plant milk, ready meals/soup) and frozen sit in aisles 9-12 so they are the last aisles before the tills (assumption: UK stores put chilled/frozen late in the route to limit time out of refrigeration).",
            "two entrances at the front (z=-2), one per half of the store, so arrivals split instead of clumping at one door.",
            "6 staffed tills in the centre + 12 self-checkout kiosks in 2 banks of 6 (west, east); z=21-23.",
        ],
        "stock_rules": {
            "facings": "curated SKUs keep their planogram.json facings (all 1); auto_xl incumbents get 2 facings, others 1 (assumption: category leaders typically hold more facings)",
            "depth_units_per_facing": "item <=150 g/ml -> 8 deep, <=500 -> 6, <=1000 -> 4, larger or unknown -> 3; freezer x0.75 (assumption: standard 0.45m shelf depth / pack depth)",
            "capacity": "facings x depth_units_per_facing",
            "stock": "starts at capacity (store opens fully faced up)",
        },
        "derivation": {"scales_from_curated": sc, "price_model": price, "unit_price_band_gbp_per_kg": upb,
                       "pool_sizes": pool_sizes, "script": "scripts/scale_catalog.py", "rules": "data/products/curated_xl_rules.md"},
    }


def build_planogram(xl, cfg):
    old = json.load(open(P("data/store/planogram.json")))
    old_f = {c: f for s in old.values() for c, f in s.get("facings", {}).items()}
    per = cfg["products_per_slot"]
    plano = {}
    for c in CATS:
        us = [u["id"] for u in cfg["units"] if u["category"] == c]
        cur = [p for p in xl if p["category"] == c and p["curation"] == "curated"]
        auto = [p for p in xl if p["category"] == c and p["curation"] == "auto_xl"]
        slots = {f"{u}-r{r}": [] for u in us for r in range(1, 5)}
        # curated rows keep their meaning on the L unit: 1 top -> r1, 2 eye -> r2, 3 bottom -> r4
        rowmap = {1: 1, 2: 2, 3: 4}
        for p in cur:
            slots[f"{us[0]}-r{rowmap.get(int(p.get('row') or 2), 2)}"].append(p)
        # auto SKUs: row preference by role (assumption: retail convention: leaders at eye level, own-label/value low,
        # challengers top/lower)
        pref = {"incumbent": [2, 3, 1, 4], "own_label": [4, 3, 1, 2], "challenger": [1, 3, 2, 4]}
        for p in sorted(auto, key=lambda p: ({"incumbent": 0, "own_label": 1, "challenger": 2}[p["role"]], -(p["scans"] or 0))):
            placed = False
            for r in pref[p["role"]]:
                for u in (us[1], us[0]):
                    sid = f"{u}-r{r}"
                    if len(slots[sid]) < per:
                        slots[sid].append(p)
                        placed = True
                        break
                if placed:
                    break
            if not placed:
                sid = min(slots, key=lambda s: len(slots[s]))
                slots[sid].append(p)
        for sid, ps in slots.items():
            fac, cap, stock = {}, {}, {}
            for p in ps:
                f = old_f.get(p["code"], 1) if p["curation"] == "curated" else (2 if p["role"] == "incumbent" else 1)
                _, item = parse_qty(p.get("quantity"))
                d = 3 if item is None else 8 if item <= 150 else 6 if item <= 500 else 4 if item <= 1000 else 3
                if c == "frozen_icecream":
                    d = max(2, round(d * 0.75))
                fac[p["code"]] = f
                cap[p["code"]] = f * d
                stock[p["code"]] = f * d
            plano[sid] = {"category": c, "products": [p["code"] for p in ps], "facings": fac, "stock": stock, "capacity": cap}
    return plano


def validate():
    xl = json.load(open(P("data/products/catalog_xl.json")))
    cfg = json.load(open(P("data/store/store_xl.config.json")))
    pl = json.load(open(P("data/store/planogram_xl.json")))
    codes = [p["code"] for p in xl]
    assert len(codes) == len(set(codes)), "duplicate codes"
    cs = set(codes)
    placed = [c for s in pl.values() for c in s["products"]]
    missing = [c for c in placed if c not in cs]
    assert not missing, missing[:5]
    assert len(placed) == len(set(placed)), "a code is placed twice"
    unplaced = cs - set(placed)
    unit_ids = {u["id"] for u in cfg["units"]}
    for sid, s in pl.items():
        u, r = sid.rsplit("-r", 1)
        assert u in unit_ids and 1 <= int(r) <= cfg["rows_per_unit"], sid
        assert set(s["facings"]) == set(s["products"]) == set(s["stock"]) == set(s["capacity"]), sid
    for p in xl:
        assert len(p["lens_grades"]) == 12, (p["code"], len(p["lens_grades"]))
        for k, g in p["lens_grades"].items():
            assert 0 <= g["score"] <= 1 and g["why"], (p["code"], k)
    summary = {
        "products": len(xl),
        "by_category": dict(Counter(p["category"] for p in xl)),
        "by_role": dict(Counter(p["role"] for p in xl)),
        "by_category_role": {c: dict(Counter(p["role"] for p in xl if p["category"] == c)) for c in CATS},
        "by_curation": dict(Counter(p["curation"] for p in xl)),
        "nova": dict(Counter(p["nova"] for p in xl)),
        "units": len(cfg["units"]), "slots": len(pl), "placed": len(placed), "unplaced": len(unplaced),
        "checkouts": dict(Counter(c["type"] for c in cfg["checkouts"])),
        "fridge_units": sum(u["fridge"] for u in cfg["units"]),
        "total_capacity_units": sum(sum(s["capacity"].values()) for s in pl.values()),
    }
    print(json.dumps(summary, indent=1))
    return summary


if __name__ == "__main__":
    main()

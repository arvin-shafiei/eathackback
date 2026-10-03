import json, re, math, os
import pandas as pd

ROOT = "/Users/arvin/orca/eathackback/data/products"
df = pd.read_parquet(f"{ROOT}/uk_products.parquet")
A = "assumption: typical UK supermarket shelf price (non-promo) for this pack size, mid-2020s; not verified against a live retailer page"

# code -> (row, role, price_gbp, grams, gram_source, portable, price_note)
PICK = {
 # Row 1 (top): everyday biscuits
 "5000168036755": (1, "incumbent", 1.65, 360, "OFF quantity", 0.2),
 "5410126716016": (1, "incumbent", 1.75, 250, "OFF quantity", 0.2),
 "5054402919854": (1, "own_label", 0.65, 296, "OFF quantity", 0.2),
 "0061232201047": (1, "challenger", 1.90, 200, "OFF quantity", 0.2),
 # Row 2 (eye): chocolate bars
 "7622300845759": (2, "incumbent", 1.85, 110, "OFF quantity", 0.6),
 "8717677339914": (2, "challenger", 4.00, 180, "OFF quantity", 0.4),
 "5059697710001": (2, "own_label", 1.25, 100, "OFF quantity", 0.6),
 "5060719920162": (2, "challenger", 3.00, 90, "OFF quantity", 0.6),
 # Row 3 (bottom): better-for-you / free-from / functional
 "7622210445346": (3, "incumbent", 2.00, 250, "assumption: OFF quantity '5x'; UK pack is 5 x 50g", 1.0),
 "5056357909546": (3, "incumbent", 2.00, 57, "OFF quantity", 1.0),
 "00227643":      (3, "own_label", 1.50, 150, "OFF quantity", 0.2),
 "8410376058116": (3, "challenger", 1.60, 150, "assumption: OFF quantity missing; sibling Gullón Zero choc chip 8410376065220 lists 150 g", 0.2),
}
ROW_NAMES = {1: "everyday biscuits (top)", 2: "chocolate bars (eye)", 3: "better-for-you & free-from (bottom)"}

ECO = {"a-plus": 1.0, "a": 1.0, "b": 0.8, "c": 0.6, "d": 0.4, "e": 0.2, "f": 0.0}
NS = {"a": 1.0, "b": 0.75, "c": 0.5, "d": 0.25, "e": 0.0}
NOVA = {1: 1.0, 2: 0.75, 3: 0.5, 4: 0.0}
SWEET = re.compile(r"en:e(420|421|95\d|96\d)")
ETHIC = ["en:fair-trade", "en:fairtrade-international", "en:rainforest-alliance", "en:organic", "en:cocoa-life",
         "en:sustainable-palm-oil", "en:certified-b-corporation", "en:soil-association-organic"]
CLAIM = re.compile(r"protein|zero|sugar free|low sugar|slim", re.I)
FLAV = re.compile(r"ginger|orange|geranium|caramel|biscoff|74%|hi protein|free from|soft bakes", re.I)

def lst(x): return [t for t in str(x).split("|") if t and t != "None"] if isinstance(x, str) else []
def num(x, d=0.0):
    try:
        v = float(x); return d if math.isnan(v) else v
    except Exception: return d
def clip(x): return round(max(0.0, min(1.0, x)), 3)

products, rows = [], {"1": [], "2": [], "3": []}
for code, (row, role, price, grams, gsrc, portable) in PICK.items():
    r = df[df.code == code].iloc[0]
    labels, adds, alg, ana = lst(r.labels), lst(r.additives), lst(r.allergens), lst(r.analysis)
    add_n = len([a for a in adds if not re.match(r"en:e\d+[a-z]+$", a) or a.endswith("xx")]) if adds else 0
    add_n = int(num(r.additives_n, add_n))
    sweet = sorted({m.group(0) for a in adds for m in [SWEET.match(a)] if m})
    palm = 1.0 if "en:palm-oil" in ana else (0.5 if "en:may-contain-palm-oil" in ana else 0.0)
    organic = 1.0 if "en:organic" in labels else 0.0
    vegan = 1.0 if "en:vegan" in ana else 0.0
    gf_label = any(l in labels for l in ["en:no-gluten", "en:suitable-for-celiacs"])
    gluten = "en:gluten" in alg or bool(re.search(r"wheat|barley|spelt|\boat|flour", str(r.ingredients_text), re.I)) and not gf_label
    eco = ECO.get(str(r.ecoscore), 0.3); ns = NS.get(str(r.nutriscore), 0.3); nova = int(num(r.nova, 4))
    sug, fib, pro = num(r.sugars_100g), num(r.fiber_100g), num(r.proteins_100g)
    p100 = round(price / grams * 100, 3)
    ethic = [l for l in labels if l in ETHIC]
    claim = bool(CLAIM.search(str(r["name"]))) or any(l in labels for l in ["en:no-added-sugar", "en:low-sugar", "en:low-or-no-sugar"])
    scans = num(r.scans)
    fam = {"incumbent": 1.0, "own_label": 0.6, "challenger": 0.2}[role]
    nov = {"challenger": 1.0, "incumbent": 0.3, "own_label": 0.2}[role]

    G = {}
    G["eco_low_chemical"] = (0.4*(1-min(add_n,10)/10) + 0.3*eco + 0.2*organic + 0.1*(palm == 0),
        [f"additives_n={add_n} (OFF additives_tags)", f"ecoscore={r.ecoscore} (OFF)", f"organic={'yes' if organic else 'no'} (OFF labels)", f"palm_oil={'yes' if palm==1 else 'maybe' if palm else 'no'} (OFF ingredients_analysis)"])
    G["upf_avoider_parent"] = (0.5*NOVA.get(nova,0) + 0.3*(1-min(add_n,5)/5) + 0.2*(len(sweet)==0),
        [f"nova={nova} (OFF)", f"additives_n={add_n} (OFF)", f"sweeteners={sweet or 'none'} (OFF additives E420/421/E950-969)"])
    G["glp1_small_appetite"] = (0.35*min(pro/20,1) + 0.25*min(fib/6,1) + 0.25*(1-min(sug/50,1)) + 0.15*(1.0 if grams <= 100 or portable == 1.0 else 0.0),
        [f"proteins_100g={pro:.1f} (OFF)", f"fiber_100g={fib:.1f} (OFF)", f"sugars_100g={sug:.1f} (OFF)", f"pack {grams}g ({gsrc}); single-serve={portable==1.0}"])
    G["frugal_unit_price"] = (1 - (p100-0.20)/(2.50-0.20),
        [f"£{p100:.2f}/100g = price_gbp {price} / {grams}g", "anchors £0.20/100g→1, £2.50/100g→0 (assumption)"])
    G["protein_gym"] = (0.7*min(pro/30,1) + 0.3*(1-min(sug/40,1)),
        [f"proteins_100g={pro:.1f} (OFF)", f"sugars_100g={sug:.1f} (OFF)"])
    G["protein_sceptic_gimmick_reactant"] = (0.4*(not claim) + 0.3*(len(sweet)==0) + 0.3*(1-min(add_n,5)/5),
        [f"health/protein claim in name or labels={claim} (OFF product_name, labels)", f"sweeteners={sweet or 'none'} (OFF)", f"additives_n={add_n} (OFF)"])
    G["habit_loyalist_shrinkflation_angry"] = (0.6*fam + 0.4*(1-min(p100/2.50,1)),
        [f"role={role} → familiarity {fam} (assumption: incumbents are the habitual buy)", f"£{p100:.2f}/100g (price_gbp/OFF quantity)"])
    G["meal_deal_office"] = (0.5*portable + 0.3*(1-min(max(price-1.0,0)/3.0,1)) + 0.2*ns,
        [f"portable/single-serve={portable} (OFF quantity + pack format)", f"price_gbp={price}", f"nutriscore={r.nutriscore} (OFF)"])
    G["vegan_ethical"] = (0.5*vegan + 0.3*min(len(ethic),2)/2 + 0.2*(palm == 0),
        [f"vegan={'yes' if vegan else 'no/unknown'} (OFF ingredients_analysis)", f"ethics labels={ethic or 'none'} (OFF labels)", f"palm_oil={'no' if palm==0 else 'yes/maybe'} (OFF)"])
    G["allergen_coeliac"] = (0.0 if gluten else (1.0 if gf_label else 0.4),
        [f"allergens={alg or 'none listed'} (OFF)", f"gluten-free label={gf_label} (OFF labels)", "gluten cereal in ingredients_text" if gluten else "no gluten cereal found in ingredients_text"])
    G["ai_delegator"] = (0.4*ns + 0.3*min(num(r.completeness),1) + 0.3*(1-min(add_n,10)/10),
        [f"nutriscore={r.nutriscore} (OFF)", f"completeness={num(r.completeness):.2f} (OFF)", f"additives_n={add_n} (OFF)"])
    G["novelty_seeker_tiktok"] = (0.5*nov + 0.25*bool(FLAV.search(str(r["name"]))) + 0.25*(1-min(scans/250,1)),
        [f"role={role} → novelty {nov}", f"distinctive flavour/format word in name={bool(FLAV.search(str(r['name'])))} (OFF product_name)", f"scans={int(scans)} (OFF unique_scans_n; low = less mainstream, assumption)"])
    lens = {k: {"score": clip(v[0]), "why": v[1]} for k, v in G.items()}

    # pack copy: only claims backed by OFF labels/name
    LC = {"en:vegan": "vegan", "en:no-gluten": "gluten free", "en:organic": "organic", "en:fair-trade": "fairtrade",
          "en:rainforest-alliance": "rainforest alliance cocoa", "en:cocoa-life": "cocoa life", "en:sustainable-palm-oil": "sustainable palm oil",
          "en:source-of-fibre": "source of fibre", "en:no-artificial-colors": "no artificial colours", "en:no-artificial-flavors": "no artificial flavours",
          "en:no-milk": "milk free", "en:soil-association-organic": "soil association organic", "en:no-colorings": "no colourings"}
    claims = [v for k, v in LC.items() if k in labels]
    if "palm-oil-free" in " ".join(ana) and "en:palm-oil" not in ana: pass
    pc = f"{r['name']} · {r.brand} · {grams}g" + (" · " + " · ".join(claims) if claims else "")
    if code == "5056357909546": pc += " · 20g protein per bar (35.1g/100g × 57g, OFF)"
    if code == "8410376058116": pc += " · sweetened with maltitol & isomalt (OFF ingredients)"

    products.append({
        "code": code, "name": r["name"], "brand": r.brand, "category": "biscuits_chocolate", "role": role,
        "row": row, "price_gbp": price, "price_source": A, "price_per_100g": p100, "pack_grams": grams, "pack_grams_source": gsrc,
        "pack_copy": pc, "nova": nova, "nutriscore": r.nutriscore, "ecoscore": r.ecoscore, "additives_n": add_n, "additives": adds,
        "labels": labels, "allergens": alg, "analysis": ana, "ingredients_n": None if pd.isna(r.ingredients_n) else int(r.ingredients_n),
        "ingredients_text": r.ingredients_text, "sugars_100g": round(sug,2), "fiber_100g": round(fib,2), "proteins_100g": round(pro,2),
        "salt_100g": round(num(r.salt_100g),3), "sweeteners": len(sweet), "sweeteners_list": sweet, "palm_oil_n": 1 if palm==1 else 0,
        "palm_oil_source": "derived: OFF ingredients_analysis tag en:palm-oil (palm_oil_n column empty in pull)",
        "organic": bool(organic), "vegan": bool(vegan), "gluten_free_label": gf_label,
        "recycling": [], "image": r.image, "off_url": r.off_url, "scans": int(scans), "completeness": round(num(r.completeness),3),
        "lens_grades": lens,
    })
    rows[str(row)].append(code)

out = {"category": "biscuits_chocolate", "row_names": {str(k): v for k, v in ROW_NAMES.items()}, "rows": rows,
       "rules": "data/products/curated/biscuits_chocolate_rules.md", "source_pool": "data/products/uk_products.parquet (Open Food Facts)",
       "products": products}
os.makedirs(f"{ROOT}/curated", exist_ok=True)
json.dump(out, open(f"{ROOT}/curated/biscuits_chocolate.json", "w"), indent=1, ensure_ascii=False)
for p in products:
    print(p["row"], p["role"][:4], p["code"], p["name"][:32].ljust(32), " ".join(f"{k[:6]}={v['score']:.2f}" for k, v in p["lens_grades"].items()))

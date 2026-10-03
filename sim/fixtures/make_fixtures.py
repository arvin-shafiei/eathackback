"""Builds small fixture files so the sim runs before the real catalog/personas exist.
Fixture products are PLACEHOLDERS (fixture: true) — not real OFF data. Personas are
derived from data/personas/staged_personas_v1.json (real research), OCEAN values are assumptions."""
import json, os
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(H))
FIX = "assumption: fixture placeholder until data/products/catalog.json exists"
cats = ["soft_drinks","crisps_savoury","snack_bars","breakfast_cereal","yoghurt","biscuits_chocolate","plant_milk_dairy_alt","ready_meals_soup"]
store = {"aisles":4,"rows_per_unit":3,"row_names":{"1":"top","2":"eye","3":"bottom"},
  "units":[{"id":f"U{i+1}","aisle":i//2+1,"side":"LR"[i%2],"category":c} for i,c in enumerate(cats)],
  "entrance":{"x":0,"z":-2},"checkout":{"x":0,"z":22}}
# test-shelf products from research/05-personas.md section 0 + generic fixtures
P = []
def prod(code,name,brand,cat,role,price,copy,**kw):
    d = dict(code=code,name=name,brand=brand,category=cat,role=role,price_gbp=price,price_source=kw.pop("ps",FIX),
             pack_copy=copy,nova=kw.pop("nova",3),nutriscore=kw.pop("ns","c"),ecoscore="unknown",
             additives_n=kw.pop("add",0),additives=[],labels=kw.pop("labels",[]),allergens=kw.pop("allergens",[]),
             ingredients_n=kw.pop("ing_n",5),ingredients_text=kw.pop("ing",""),sugars_100g=kw.pop("sug",5.0),
             fiber_100g=kw.pop("fib",1.0),proteins_100g=kw.pop("pro",3.0),salt_100g=kw.pop("salt",0.3),
             sweeteners=kw.pop("swe",0),palm_oil_n=0,recycling=[],image="",off_url="",lens_grades={},fixture=True)
    P.append(d)
S="research/05-personas.md section 0 test shelf (persona research prior, not a shelf scan)"
prod("FX0001","Gutsy Pop raspberry prebiotic soda 330ml","Gutsy Pop","soft_drinks","challenger",1.85,"prebiotic soda, 6g fibre per can, no added sugar",ps=S,sug=1.5,fib=1.8,nova=4,ing="carbonated water, chicory root fibre, apple juice from concentrate, raspberry juice, natural flavouring, stevia",swe=1,labels=["en:vegan"])
prod("FX0002","Cola Zero 330ml","Incumbent Cola","soft_drinks","incumbent",1.25,"zero sugar",ps=S,sug=0,nova=4,add=4,swe=2,ing="carbonated water, colour (caramel E150d), phosphoric acid, sweeteners (aspartame, acesulfame K), natural flavourings, caffeine")
prod("FX0003","Light cola 330ml","Own Label","soft_drinks","own_label",0.55,"no added sugar",ps=S,sug=0,nova=4,add=4,swe=2,ing="carbonated water, colour (caramel E150d), phosphoric acid, sweeteners (sucralose, acesulfame K), flavourings")
prod("FX0004","Protein bar chocolate brownie 60g","Grenade-style","snack_bars","incumbent",2.20,"20g PROTEIN, low sugar",ps=S,pro=33,sug=2.1,nova=4,add=6,swe=1,ing="milk protein isolate, humectant (glycerol), sweetener (sucralose), palm fat, cocoa, emulsifier (soy lecithin), flavouring",allergens=["en:milk","en:soybeans"])
prod("FX0005","Nutty Crunch oat & nut bar 35g","Nutty Crunch","snack_bars","challenger",1.60,"oats, nuts, honey. that's it.",ps=S,pro=9,sug=14,fib=6.5,nova=3,ing_n=4,ing="oats (45%), peanuts (30%), honey, sea salt",allergens=["en:peanuts","en:gluten"])
prod("FX0006","Protein bar caramel 40g","Own Label","snack_bars","own_label",1.10,"15g protein",ps=S,pro=30,sug=4,nova=4,add=5,swe=1,ing="milk protein, soya crisp, sweetener (sucralose), palm oil, emulsifier (E471), flavouring",allergens=["en:milk","en:soybeans"])
prod("FX0007","Sea salt crisps 150g","Incumbent Crisps","crisps_savoury","incumbent",2.00,"sea salt, cooked in sunflower oil",sug=0.5,salt=1.3,nova=3,ing="potatoes, sunflower oil, sea salt")
prod("FX0008","Lentil puffs sour cream 90g","Challenger Snacks","crisps_savoury","challenger",1.50,"40% less fat than regular crisps",salt=1.6,nova=4,add=2,ing="lentil flour, rice flour, rapeseed oil, sour cream & chive seasoning (milk, flavourings, yeast extract)")
prod("FX0009","Ready salted crisps 6x25g","Own Label","crisps_savoury","own_label",0.95,"ready salted multipack",salt=1.4,nova=3,ing="potatoes, sunflower oil, salt")
prod("FX0010","Wholegrain wheat biscuits 24pk","Incumbent Cereal","breakfast_cereal","incumbent",3.25,"high fibre, 100% wholegrain",fib=10,sug=4.4,nova=1,ing="wholegrain wheat (95%), barley malt extract, sugar, salt")
prod("FX0011","Protein granola 400g","Challenger Granola","breakfast_cereal","challenger",4.50,"high protein granola, 25% protein",pro=25,sug=12,nova=4,add=1,ing="oats, soy protein isolate, honey, almonds, rapeseed oil, flavouring")
prod("FX0012","Natural greek style yoghurt 500g","Own Label","yoghurt","own_label",1.15,"thick and creamy",pro=5,sug=4.5,nova=1,ing="yoghurt (milk)",allergens=["en:milk"])
prod("FX0013","Kids yoghurt tubes strawberry 8x37g","Incumbent Dairy","yoghurt","incumbent",2.20,"source of calcium, made with real fruit",sug=11,nova=4,add=3,ing="yoghurt (milk), sugar, strawberry puree, modified maize starch, stabiliser (pectin), flavouring",allergens=["en:milk"])
prod("FX0014","Chocolate digestives 300g","Incumbent Biscuits","biscuits_chocolate","incumbent",2.00,"now 266g, same great taste",sug=28,nova=4,add=2,ing="wheat flour, milk chocolate, vegetable oil (palm), wholemeal wheat flour, sugar, raising agents",allergens=["en:gluten","en:milk"])
prod("FX0015","Oat drink barista 1L","Challenger Oat","plant_milk_dairy_alt","challenger",2.10,"made for coffee, fortified with calcium",sug=4,nova=4,add=3,ing="water, oats (10%), rapeseed oil, acidity regulator (dipotassium phosphate), calcium carbonate, salt, vitamins",labels=["en:vegan"])
prod("FX0016","Tomato soup 400g","Incumbent Soup","ready_meals_soup","incumbent",1.40,"classic cream of tomato",sug=5.8,salt=0.6,nova=4,add=1,ing="tomatoes (84%), water, rapeseed oil, sugar, modified cornflour, cream (milk), salt, spice extracts",allergens=["en:milk"])
plan = {}
bycat = {}
for p in P: bycat.setdefault(p["category"], []).append(p["code"])
for u in store["units"]:
    codes = bycat.get(u["category"], [])
    for r in (1,2,3):
        sid=f"{u['id']}-r{r}"
        # spread products across rows: challenger low, incumbent at eye, own-label bottom
        role_row = {"incumbent":2,"challenger":3,"own_label":1}
        prods = [c for c in codes if role_row[next(x for x in P if x["code"]==c)["role"]]==r]
        if prods:
            plan[sid] = {"category":u["category"],"products":prods,
                         "facings":{c:(4 if r==2 else 1) for c in prods}}
json.dump(store, open(os.path.join(H,"store.config.json"),"w"), indent=1)
json.dump(plan, open(os.path.join(H,"planogram.json"),"w"), indent=1)
json.dump(P, open(os.path.join(H,"catalog.json"),"w"), indent=1)
# personas
staged = json.load(open(os.path.join(ROOT,"data/personas/staged_personas_v1.json")))
spec = {"Priya":("p_priya","upf_avoider_parent","weekly_shop",25,{"O":0.45,"C":0.6,"E":0.5,"A":0.6,"N":0.6}),
        "Jordan":("p_jordan","ai_delegator","meal_deal",4,{"O":0.6,"C":0.3,"E":0.6,"A":0.55,"N":0.5}),
        "Margaret":("p_margaret","habit_loyalist_shrinkflation_angry","weekly_shop",30,{"O":0.2,"C":0.8,"E":0.45,"A":0.4,"N":0.65}),
        "Sam":("p_sam","glp1_small_appetite","top_up",12,{"O":0.5,"C":0.7,"E":0.4,"A":0.5,"N":0.55}),
        "Dev":("p_dev","frugal_unit_price","weekly_shop",15,{"O":0.4,"C":0.65,"E":0.55,"A":0.4,"N":0.45})}
for s in staged:
    n = s["persona"]["name"]
    if n not in spec: continue
    pid, arch, mission, budget, ocean = spec[n]
    d = s["dossier"]
    rx = __import__("re")
    verb = []
    for b in d["behavioural_drivers"]:
        m = rx.search(r'"([^"]{20,220})"', b["evidence_verbatim"]); u = rx.search(r"https?://\S+?(?=[)\s,']|$)", b["evidence_verbatim"])
        if m and u: verb.append({"quote": m.group(1), "url": u.group(0)})
    per = {"id":pid,"name":n,"archetype":arch,"mission":mission,"budget_gbp":budget,
           "budget_source":"assumption: per-store-visit budget for the sim, from the dossier's spend description",
           "channel":"instore","ocean":ocean,
           "ocean_source":"assumption: fixture OCEAN set by hand from the dossier, pending data/personas/lens",
           "ocean_effects":[], "lens":[{"attribute":"price_gbp","off_field":"price_gbp","direction":"lower_better",
              "weight":s["verdict"]["sim_parameters"]["price_sensitivity_0_1"],"why":"price_sensitivity_0_1",
              "source":"data/personas/staged_personas_v1.json verdict.sim_parameters (skeptic-calibrated)"}],
           "rejection_triggers":[{"trigger":t,"source":"data/personas/staged_personas_v1.json"} for t in d["rejection_triggers"]],
           "trust_signals":d["trust_signals"],"habits":[b["principle"] for b in d["behavioural_drivers"][:4]],
           "dossier":d["profile"][:2500],"verbatims":verb[:5],
           "sim_parameters":s["verdict"]["sim_parameters"],
           "sim_parameters_source":"data/personas/staged_personas_v1.json verdict.sim_parameters (skeptic-calibrated)",
           "fixture":True}
    json.dump(per, open(os.path.join(H,"personas",pid+".json"),"w"), indent=1)
print(len(P),"products",len(plan),"slots")

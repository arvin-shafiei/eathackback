import pandas as pd, json, math
d=pd.read_parquet('/Users/arvin/orca/eathackback/data/products/uk_products.parquet')
R='https://www.reddit.com/comments/1bq1qcm'
REDDIT_OAT="reddit verbatim: \"Lidl's super cheap £1.09 oat milk is better than the £2.20 Oatly stuff\" ("+R+")"
# code: (role, row, price, price_source, volume_l, vol_source, pack_copy)
sel={
 '7394376620713':('incumbent',1,2.20,"assumption: typical UK RRP for Oatly 1L chilled; corroborated by "+REDDIT_OAT,1.0,'OFF quantity "1l"',
   "whole oat drink · vegan · with calcium, iodine & vitamins D2, riboflavin, B12"),
 '5060406080223':('challenger',1,2.20,"assumption: Minor Figures barista 1L priced at Oatly parity (premium oat tier, same "+REDDIT_OAT+")",1.0,'OFF quantity "1 litre"',
   "barista oat · organic (USDA organic label) · dairy-free alternative to milk & soy"),
 '5060120281975':('challenger',1,2.40,"assumption: Rude Health organic 1L sits at a premium to Oatly (organic + B-Corp), est. £2.40",1.0,'OFF quantity "1 litre"',
   "organic oat drink · gluten-free oats · no added sugar · 4 ingredients · B Corp"),
 '5057753940317':('own_label',1,1.10,"assumption: Tesco own-label oat 1L priced near the own-label benchmark in "+REDDIT_OAT,1.0,'OFF quantity "1 l"',
   "oat drink · vegan · with vitamins B12, D2 & riboflavin"),
 '5000181024043':('incumbent',2,2.35,"assumption: Cravendale filtered 2L typical UK RRP ~£2.35 (premium vs own-label 4-pint)",2.0,'OFF quantity "2 l"',
   "filtered semi-skimmed milk · lasts longer (filtered) · ingredient: pasteurised milk"),
 '5000246728183':('incumbent',2,1.95,"assumption: Arla B.O.B 2L typical UK RRP ~£1.95",2.0,'OFF quantity "2 litres"',
   "semi-skimmed milk enriched with protein · 4.6g protein/100ml"),
 '5031021057952':('own_label',2,0.75,"assumption: Tesco 1 pint semi-skimmed, typical small-pack own-label price ~£0.75",0.568,'OFF quantity "568 ml"',
   "british semi-skimmed milk · 1 pint · suitable for vegetarians"),
 '5060674960098':('challenger',2,2.00,"assumption: Mighty Pea Protein Oat 1L challenger RRP ~£2.00",1.0,'assumption: OFF quantity missing; range sold as 1L cartons',
   "protein oat m.lk · with pea protein · vegan · 3.2g protein/100ml"),
 '5411188083191':('incumbent',3,1.85,"assumption: Alpro Soya Original 1L typical UK RRP ~£1.85",1.0,'OFF quantity "1l"',
   "soya original · rich in plant protein · source of calcium & iodine · vegan society · no gluten"),
 '5060362072263':('challenger',3,2.00,"assumption: Plenish organic soya 1L typical UK RRP ~£2.00",1.0,'OFF quantity "1 litre"',
   "organic soya drink · just spring water & organic soybeans (8%) · soil association organic"),
 '4088600574530':('own_label',3,0.69,"assumption: Aldi Everyday Essentials soya 1L, hard-discount entry price ~£0.69",1.0,'OFF quantity "1L"',
   "soya unsweetened · vegan · new recipe (soya beans now 7%, was 8%)"),
 '5411188110835':('incumbent',3,1.85,"assumption: Alpro Almond Original 1L typical UK RRP ~£1.85 (same tier as Alpro soya)",1.0,'OFF quantity "1 l"',
   "almond original · vegan · source of calcium · no lactose"),
}
rows={'1':[],'2':[],'3':[]}
NOVA={1:1.0,2:0.75,3:0.5,4:0.0}
ECO={'a-plus':1.0,'a':0.85,'b':0.65,'c':0.45,'d':0.25,'e':0.1}
NS={'a':1.0,'b':0.8,'c':0.55,'d':0.3,'e':0.1}
def lst(s): return [x for x in (s or '').split('|') if x]
def r3(x): return round(float(x),3)
out=[]
for code,(role,row,price,psrc,vol,vsrc,copy) in sel.items():
    r=d[d.code==code].iloc[0].to_dict()
    nan=lambda v: v is None or (isinstance(v,float) and math.isnan(v))
    labels=lst(r['labels']); additives=[a for a in lst(r['additives'])]
    # OFF lists sub-variants e.g. e340 and e340ii; count distinct = additives_n field
    an=int(r['additives_n'] or 0); analysis=lst(r['analysis'])
    allergens=lst(r['allergens'])
    cats=r['categories'] or ''
    name=r['name']; ing=(r['ingredients_text'] or '').lower()
    nonvegan='en:non-vegan' in analysis
    if 'en:milks' in cats and 'en:milk' not in allergens: allergens_d=allergens+['en:milk']
    else: allergens_d=list(allergens)
    if 'soy' in ing and 'en:soybeans' not in allergens_d: allergens_d=allergens_d+['en:soybeans']
    nova=int(r['nova']); eco=r['ecoscore']; ns=r['nutriscore']
    prot=float(r['proteins_100g'] or 0); sug=float(r['sugars_100g'] or 0)
    scans=0 if nan(r['scans']) else float(r['scans']); comp=float(r['completeness'])
    organic=1 if (any('organic' in l for l in labels) or 'organic' in name.lower()) else 0
    palm_free=1 if 'en:palm-oil-free' in analysis else 0
    vegan=1.0 if 'en:vegan' in analysis else (0.5 if 'en:maybe-vegan' in analysis or 'en:vegan-status-unknown' in analysis else 0.0)
    ethic_label=1 if any(l in labels for l in ['en:certified-b-corporation','en:the-vegan-society']) else 0
    gf_label='en:no-gluten' in labels
    oats='oat' in ing
    gluten_safe=1.0 if gf_label else (0.0 if ('en:gluten' in allergens or oats) else 0.8)
    protein_claim=1 if ('protein' in name.lower() or 'protein' in ing.split(',')[0] or any('protein' in l for l in labels) or 'enriched with protein' in ing) else 0
    barista=1 if 'barista' in name.lower() else 0
    new_recipe=1 if 'en:new-recipe' in labels else 0
    ppl=price/vol
    small=1 if vol<=0.6 else 0
    addS=1-min(an,5)/5; ecoS=ECO.get(eco,0.4); novaS=NOVA[nova]; nsS=NS.get(ns,0.5)
    fam=min(math.log1p(scans)/math.log(700),1)
    roleH={'incumbent':1.0,'own_label':0.6,'challenger':0.2}[role]
    roleN={'challenger':1.0,'incumbent':0.3,'own_label':0.0}[role]
    sugS=1-min(sug,5)/5
    G={}
    G['eco_low_chemical']=(0.35*addS+0.30*ecoS+0.20*organic+0.15*palm_free,
        [f'additives_n={an} (OFF)',f'ecoscore={eco} (OFF)',f'organic={organic} (OFF labels/name)',f'palm-oil-free={palm_free} (OFF analysis)'])
    G['upf_avoider_parent']=(0.50*novaS+0.30*addS+0.20*sugS,
        [f'nova={nova} (OFF)',f'additives_n={an} (OFF)',f'sugars_100g={sug} (OFF)'])
    G['glp1_small_appetite']=(0.50*min(prot/4,1)+0.30*nsS+0.20*(1 if vol<=0.6 else 0.5 if vol<=1 else 0),
        [f'proteins_100g={prot} (OFF)',f'nutriscore={ns} (OFF)',f'pack={vol}L ({vsrc})'])
    G['frugal_unit_price']=(max(0,min(1,(2.50-ppl)/2.00)),
        [f'£/L={ppl:.2f} = price_gbp {price} / {vol}L','anchors £0.50/L=1, £2.50/L=0 (assumption: own-label vs premium oat range, '+R+')'])
    G['protein_gym']=(0.80*min(prot/5,1)+0.20*protein_claim,
        [f'proteins_100g={prot} (OFF)',f'protein_claim={protein_claim} (OFF name/labels/ingredients)'])
    G['protein_sceptic_gimmick_reactant']=(0.50*(1-protein_claim)+0.25*addS+0.25*novaS,
        [f'protein_claim={protein_claim} (OFF name/labels/ingredients)',f'additives_n={an} (OFF)',f'nova={nova} (OFF)'])
    G['habit_loyalist_shrinkflation_angry']=(0.50*roleH+0.30*fam+0.20*(1-new_recipe),
        [f'role={role} (curation)',f'scans={int(scans)} (OFF, familiarity proxy, log-scaled to 700)',f'new_recipe_label={new_recipe} (OFF labels)'])
    G['meal_deal_office']=(0.50*small+0.30*(1 if price<=1.0 else 0)+0.20*barista,
        [f'pack={vol}L ({vsrc}); small<=0.6L={small}',f'price_gbp={price}<=£1: {int(price<=1.0)}',f'barista={barista} (OFF name; office coffee)'])
    G['vegan_ethical']=(0.60*vegan+0.20*organic+0.20*ethic_label,
        [f'vegan={vegan} (OFF analysis)',f'organic={organic} (OFF labels/name)',f'b-corp/vegan-society={ethic_label} (OFF labels)'])
    G['allergen_coeliac']=(0.70*gluten_safe+0.30*(1-min(len(allergens_d),2)/2),
        [f'no-gluten label={int(gf_label)} (OFF labels)',f'oats in ingredients={int(oats)} (OFF ingredients_text)',f'allergens={allergens_d} (OFF allergens; en:milk inferred from en:milks category where OFF field blank)'])
    G['ai_delegator']=(0.40*comp+0.30*nsS+0.30*min(len(labels),6)/6,
        [f'completeness={comp} (OFF)',f'nutriscore={ns} (OFF)',f'labels_n={len(labels)} (OFF)'])
    G['novelty_seeker_tiktok']=(0.60*roleN+0.25*barista+0.15*(1-fam),
        [f'role={role} (curation)',f'barista={barista} (OFF name)',f'scans={int(scans)} (OFF; fewer scans = newer/rarer)'])
    lg={k:{'score':r3(min(1,max(0,v))),'why':w} for k,(v,w) in G.items()}
    display=name
    if code=='5411188110835': display='Alpro Almond Original 1L'
    p={'code':code,'name':display,'off_name':name,'brand':r['brand'],'category':'plant_milk_dairy_alt','role':role,
       'price_gbp':price,'price_source':psrc,'pack_copy':copy,'quantity':r['quantity'],'volume_l':vol,'volume_source':vsrc,
       'unit_price_gbp_per_l':round(ppl,2),
       'nova':nova,'nutriscore':ns,'ecoscore':eco,'additives_n':an,'additives':additives,'labels':labels,
       'allergens':allergens,'ingredients_n':None if nan(r['ingredients_n']) else int(r['ingredients_n']),
       'ingredients_text':r['ingredients_text'],
       'sugars_100g':sug,'fiber_100g':None if nan(r['fiber_100g']) else float(r['fiber_100g']),'proteins_100g':prot,
       'salt_100g':r3(r['salt_100g']),'energy_kcal_100g':float(r['energy-kcal_100g']),
       'sweeteners':0 if nan(r['sweeteners']) else int(r['sweeteners']),
       'palm_oil_n':0 if nan(r['palm_oil_n']) else int(r['palm_oil_n']),'analysis':analysis,
       'recycling':[] if nan(r['recycling']) else lst(str(r['recycling'])),'packaging':lst(r['packaging']),
       'scans':int(scans),'completeness':comp,'image':r['image'],'off_url':r['off_url'],
       'lens_grades':lg}
    out.append(p); rows[str(row)].append(code)
res={'category':'plant_milk_dairy_alt',
     'row_themes':{'1':'oat drinks: incumbent Oatly vs challengers Minor Figures, Rude Health vs Tesco own-label',
                   '2':'cow milk & protein: Cravendale, Arla B.O.B protein, Tesco 1-pint vs Mighty Pea protein oat',
                   '3':'soya & almond: Alpro soya/almond incumbents vs Plenish organic vs Aldi own-label'},
     'rules':'data/products/curated/plant_milk_dairy_alt_rules.md',
     'rows':rows,'products':out}
json.dump(res,open('/Users/arvin/orca/eathackback/data/products/curated/plant_milk_dairy_alt.json','w'),indent=1,ensure_ascii=False)
import pandas as pd
t=pd.DataFrame([{**{'name':p['name'][:22],'role':p['role']},**{k[:10]:v['score'] for k,v in p['lens_grades'].items()}} for p in out])
pd.set_option('display.width',250); print(t.to_string())

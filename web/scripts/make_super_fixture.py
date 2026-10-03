"""Superstore fixture (UK Tesco-Extra-style floor plan) for the 3D store, until data/store/formats/superstore.* exists.

Writes web/public/data/fixturessuper/{store.config.json, planogram.json, catalog_extra.json}.
- Reuses the real XL units U1..U24 + their planogram slots (so XL sim runs replay on the same shelves).
- New food units are stocked with real Open Food Facts products from data/products/uk_products.parquet
  (selected by OFF category tag, most-scanned first). Prices are NOT retailer prices: each is a labelled
  category placeholder (assumption) so shelf-edge tags render.
- Non-food (household, health & beauty, baby, pet, home) and beer/wine/spirits (not in the OFF pull) have no
  planogram: the 3D store shows unbranded filler stock there.
Departments follow the schema the superstore generator uses: departments[] {id, name, sign_text, floor_color,
fixture_type, aisle_numbers} and units[] {department, aisle_number, fixture_type}.
Run: python web/scripts/make_super_fixture.py
"""
import json, os, re
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'web', 'public', 'data', 'fixturessuper')
os.makedirs(OUT, exist_ok=True)
xl_cfg = json.load(open(os.path.join(ROOT, 'data/store/store_xl.config.json')))
xl_plan = json.load(open(os.path.join(ROOT, 'data/store/planogram_xl.json')))
xl_cat = json.load(open(os.path.join(ROOT, 'data/products/catalog_xl.json')))
xl_units = {u['category']: [x for x in xl_cfg['units'] if x['category'] == u['category']] for u in xl_cfg['units']}
ROWS = xl_cfg['rows_per_unit']
PER_SLOT = 6

DEPTS = [
    ('food_to_go', 'food to go', 'food to go', '#ffe9a8', 'multideck'),
    ('produce', 'fresh fruit & veg', 'fruit & veg', '#cdeec2', 'produce'),
    ('bakery', 'bakery', 'bakery', '#f6dcb4', 'bakery'),
    ('meat', 'meat & poultry', 'meat & poultry', '#ffd3d3', 'multideck'),
    ('fish', 'fish', 'fish', '#cfe4ff', 'multideck'),
    ('deli', 'cooked meats & deli', 'deli', '#ffdcc8', 'multideck'),
    ('dairy', 'milk, butter & eggs', 'dairy & eggs', '#ddefff', 'multideck'),
    ('cheese', 'cheese', 'cheese', '#fff0b3', 'multideck'),
    ('meat_free', 'meat free', 'meat free', '#d8f5d0', 'multideck'),
    ('ready_meals', 'ready meals & pizza', 'ready meals', '#ffd6e0', 'multideck'),
    ('desserts', 'chilled desserts', 'desserts', '#efd9ff', 'multideck'),
    ('free_from', 'free from', 'free from', '#eef6d8', 'gondola'),
    ('grocery', 'food cupboard', 'food cupboard', '#f6eee6', 'gondola'),
    ('snacks', 'snacks & treats', 'snacks & treats', '#fde6d2', 'gondola'),
    ('drinks', 'drinks', 'drinks', '#ffe0da', 'gondola'),
    ('frozen', 'frozen', 'frozen', '#d4f1ff', 'freezer'),
    ('bws', 'beer, wine & spirits', 'beer, wine & spirits', '#f3d2e1', 'gondola'),
    ('household', 'household', 'household', '#e3eaf6', 'gondola'),
    ('health_beauty', 'health & beauty', 'health & beauty', '#fde0ef', 'gondola'),
    ('baby', 'baby', 'baby', '#e2f4ff', 'gondola'),
    ('pet', 'pet', 'pet', '#efe5d6', 'gondola'),
    ('home', 'home & seasonal', 'home & seasonal', '#ffe6d4', 'gondola'),
]
# OFF tag patterns + placeholder price (assumption: typical UK shelf price band midpoint, not a retailer quote)
OFF = {
    'fruit': (r'en:fresh-fruits|en:apples$|en:bananas|en:berries|en:citrus', 1.6),
    'vegetables': (r'en:fresh-vegetables|en:potatoes|en:carrots|en:onions|en:tomatoes', 1.1),
    'salad': (r'en:salads|en:lettuces', 1.3),
    'food_to_go': (r'en:sandwiches|en:wraps|en:sushi|en:pasta-salads', 3.2),
    'meat_poultry': (r'en:chicken-breasts|en:beef|en:pork|en:sausages|en:bacon|en:minced', 4.5),
    'fish': (r'en:fishes|en:salmon|en:smoked-fishes|en:prawns', 4.0),
    'cooked_meats_deli': (r'en:hams|en:cooked-poultries|en:salamis|en:pates|en:pork-pies', 2.5),
    'milk_butter_eggs': (r'en:milks|en:butters|en:eggs|en:creams', 1.8),
    'cheese': (r'en:cheeses|en:cheddar', 2.9),
    'meat_free': (r'en:meat-analogues|en:tofu', 3.0),
    'pizza': (r'en:pizzas', 3.5),
    'chilled_desserts': (r'en:dairy-desserts|en:cheesecakes|en:trifles|en:mousses', 2.2),
    'free_from': (r'en:gluten-free', 2.5),
    'tins_packets': (r'en:canned-vegetables|en:baked-beans|en:canned-soups|en:canned-tomatoes|en:canned-fishes', 1.0),
    'pasta_rice_noodles': (r'en:pastas|en:rices|en:noodles', 1.5),
    'world_foods': (r'en:curry-pastes|en:tortilla|en:soy-sauces|en:asian|en:mexican|en:indian', 2.0),
    'cooking_sauces': (r'en:sauces|en:ketchup|en:mayonnaises|en:pasta-sauces', 1.9),
    'home_baking': (r'en:flours|en:sugars|en:baking', 1.4),
    'spreads': (r'en:jams|en:honeys|en:peanut-butters', 2.3),
    'nuts_dried_fruit': (r'en:nuts|en:dried-fruits', 2.6),
    'oils_vinegar': (r'en:oils|en:vinegars', 2.8),
    'herbs_spices': (r'en:spices|en:herbs', 1.3),
    'crackers': (r'en:crackers|en:crispbreads|en:rice-cakes', 1.5),
    'water': (r'en:waters', 0.9),
    'juice': (r'en:juices|en:smoothies', 1.9),
    'squash': (r'en:squash|en:syrups', 1.6),
    'frozen_meals_veg': (r'en:frozen-foods', 2.5),
}
NONFOOD = {'household_cleaning', 'laundry', 'paper_bin_bags', 'toiletries', 'health_medicines', 'beauty', 'baby', 'pet_food',
           'cookshop', 'seasonal', 'beer_cider', 'wine', 'spirits_low_no'}

# aisle plan: (aisle number, department, [(category, n_units)])  — 2 bays x 2 sides = 4 units per aisle
FRONT = [
    (1, 'free_from', [('free_from', 4)]),
    (2, 'grocery', [('breakfast_cereal', 2), ('crackers', 2)]),
    (3, 'grocery', [('hot_drinks', 2), ('home_baking', 2)]),
    (4, 'grocery', [('tins_packets', 4)]),
    (5, 'grocery', [('pasta_rice_noodles', 4)]),
    (6, 'grocery', [('world_foods', 4)]),
    (7, 'grocery', [('cooking_sauces', 2), ('herbs_spices', 2)]),
    (8, 'snacks', [('biscuits_chocolate', 2), ('nuts_dried_fruit', 2)]),
    (9, 'snacks', [('crisps_savoury', 2), ('snack_bars', 2)]),
    (10, 'snacks', [('confectionery_sweets', 2), ('spreads', 2)]),
    (11, 'drinks', [('soft_drinks', 2), ('squash', 2)]),
    (12, 'drinks', [('water', 2), ('juice', 2)]),
    (13, 'frozen', [('frozen_icecream', 2), ('frozen_meals_veg', 2)]),
    (14, 'frozen', [('frozen_meals_veg', 4)]),
    (15, 'bws', [('beer_cider', 4)]),
    (16, 'bws', [('wine', 2), ('spirits_low_no', 2)]),
]
BACK = [
    (17, 'grocery', [('oils_vinegar', 4)]),
    (18, 'grocery', [('spreads', 4)]),
    (19, 'grocery', [('home_baking', 4)]),
    (20, 'grocery', [('world_foods', 4)]),
    (21, 'grocery', [('cooking_sauces', 4)]),
    (22, 'grocery', [('tins_packets', 4)]),
    (23, 'snacks', [('nuts_dried_fruit', 4)]),
    (24, 'household', [('household_cleaning', 4)]),
    (25, 'household', [('laundry', 4)]),
    (26, 'household', [('paper_bin_bags', 4)]),
    (27, 'health_beauty', [('toiletries', 4)]),
    (28, 'health_beauty', [('health_medicines', 2), ('beauty', 2)]),
    (29, 'baby', [('baby', 4)]),
    (30, 'pet', [('pet_food', 4)]),
    (31, 'home', [('cookshop', 4)]),
    (32, 'home', [('seasonal', 4)]),
]
RIGHT = [('food_to_go', 'food_to_go', 1), ('produce', 'fruit', 1), ('produce', 'vegetables', 1), ('produce', 'salad', 1), ('bakery', 'bakery_bread', 2)]
BACKWALL = [('meat', 'meat_poultry', 3), ('fish', 'fish', 1), ('deli', 'cooked_meats_deli', 2), ('dairy', 'milk_butter_eggs', 2),
            ('dairy', 'yoghurt', 2), ('dairy', 'plant_milk_dairy_alt', 2), ('cheese', 'cheese', 2)]
LEFT = [('meat_free', 'meat_free', 1), ('ready_meals', 'ready_meals_soup', 2), ('ready_meals', 'pizza', 1), ('desserts', 'chilled_desserts', 2)]

units, plan = [], {}
xl_used = {c: 0 for c in xl_units}
need = {}  # off category -> slots
seq = [0]
def new_unit(cat, dept, aisle_no=None, side=None, bay=0, fixture=None):
    # reuse the real XL unit (id + planogram) for XL categories
    if cat in xl_units and xl_used[cat] < len(xl_units[cat]):
        src = xl_units[cat][xl_used[cat]]; xl_used[cat] += 1
        uid = src['id']
        for r in range(1, ROWS + 1):
            if f'{uid}-r{r}' in xl_plan: plan[f'{uid}-r{r}'] = xl_plan[f'{uid}-r{r}']
    else:
        seq[0] += 1; uid = f'S{seq[0]}'
        if cat in OFF:
            for r in range(1, ROWS + 1): need.setdefault(cat, []).append(f'{uid}-r{r}')
    u = {'id': uid, 'aisle': aisle_no or 0, 'side': side or 'L', 'bay': bay, 'category': cat, 'department': dept}
    if aisle_no: u['aisle_number'] = aisle_no
    if fixture: u['fixture_type'] = fixture
    units.append(u)

for aisle_no, dept, cats in FRONT + BACK:
    flat = [c for c, n in cats for _ in range(n)]
    for i, cat in enumerate(flat):  # L bay0, R bay0, L bay1, R bay1
        new_unit(cat, dept, aisle_no, 'L' if i % 2 == 0 else 'R', i // 2, 'freezer' if dept == 'frozen' else None)
for dept, cat, n in RIGHT + BACKWALL + LEFT:
    for _ in range(n): new_unit(cat, dept)

# ---- stock the new food slots from OFF
df = pd.read_parquet(os.path.join(ROOT, 'data/products/uk_products.parquet'))
df = df[df.image.notna() & df.name.notna() & df.brand.notna() & ~df.image.fillna('invalid').str.contains('invalid')]
df = df.sort_values('scans', ascending=False)
have = {p['code'] for p in xl_cat}
OWN = re.compile(r'^(tesco|sainsbury|asda|morrisons|aldi|lidl|waitrose|co-?op|m&s|marks)', re.I)
extra = []
def clean(v):
    if v is None or (isinstance(v, float) and v != v): return None
    return v
for cat, slots in need.items():
    pat, price = OFF[cat]
    pool = df[df.categories.fillna('').str.contains(pat)]
    pool = pool[~pool.code.isin(have)].drop_duplicates('name')
    picks = pool.head(len(slots) * PER_SLOT)
    rows = picks.to_dict('records')
    for i, slot in enumerate(slots):
        chunk = rows[i * PER_SLOT:(i + 1) * PER_SLOT]
        if not chunk: continue
        codes = [r['code'] for r in chunk]
        plan[slot] = {'category': cat, 'products': codes,
                      'facings': {c: (2 if j < 2 else 1) for j, c in enumerate(codes)},
                      'stock': {c: 6 for c in codes}, 'capacity': {c: 6 for c in codes}}
        for r in chunk:
            have.add(r['code'])
            extra.append({
                'code': r['code'], 'name': r['name'], 'brand': str(r['brand']).split(',')[0], 'category': cat,
                'role': 'own_label' if OWN.match(str(r['brand'])) else 'incumbent',
                'price_gbp': price, 'price_source': 'assumption: fixture placeholder (typical UK shelf price for the category), not a retailer price',
                'nova': clean(r['nova']), 'nutriscore': clean(r['nutriscore']), 'ecoscore': clean(r['ecoscore']),
                'additives_n': clean(r['additives_n']), 'labels': [x for x in str(r['labels'] or '').split('|') if x][:8],
                'ingredients_n': clean(r['ingredients_n']), 'sugars_100g': clean(r['sugars_100g']), 'fiber_100g': clean(r['fiber_100g']),
                'proteins_100g': clean(r['proteins_100g']), 'salt_100g': clean(r['salt_100g']),
                'image': r['image'], 'off_url': r['off_url'], 'fixture': True,
            })

cfg = {
    'name': 'superstore (fixture, uk tesco-extra-style plan)', 'format': 'superstore',
    'aisles': 17, 'rows_per_unit': ROWS, 'row_names': xl_cfg['row_names'], 'notice_row_map': xl_cfg.get('notice_row_map'),
    'products_per_slot': PER_SLOT,
    'departments': [{'id': i, 'name': n, 'sign_text': s, 'floor_color': c, 'fixture_type': f,
                     'aisle_numbers': sorted({a for a, d, _ in FRONT + BACK if d == i})} for i, n, s, c, f in DEPTS],
    'units': units,
    'entrance': {'x': 0, 'z': 0}, 'entrances': [{'id': 'E1'}, {'id': 'E2'}],
    'checkout': {'x': 0, 'z': 0}, 'checkouts': {'staffed': 10, 'self': 16},
    'layout_notes': ['fixture: geometry is computed by web/src/layout.ts storePlan from departments + aisle numbers',
                     'assumption: aisle order and department placement follow a typical UK superstore (Tesco Extra style) racetrack'],
}
json.dump(cfg, open(os.path.join(OUT, 'store.config.json'), 'w'), indent=1)
json.dump(plan, open(os.path.join(OUT, 'planogram.json'), 'w'))
json.dump(xl_cat + extra, open(os.path.join(OUT, 'catalog_extra.json'), 'w'))
print(f'units {len(units)}  slots {len(plan)}  new products {len(extra)}  -> {OUT}')

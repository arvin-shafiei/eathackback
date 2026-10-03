"""Scale to a BIG SUPERMARKET: catalog_xl (480 SKUs, 12 categories) -> ~2,400 SKUs across ~36 categories, plus three
store formats (express / metro / superstore) with fully-filled planograms and a set of named example stores.

Rule zero (no black box): every product field is an Open Food Facts (OFF) field from data/products/uk_products.parquet,
a formula over OFF fields written down in data/products/superstore_rules.md (and curated_xl_rules.md, whose rule set
is IMPORTED from scripts/scale_catalog.py, not re-implemented), or a value labelled "assumption: <why>".
No LLM / Jev calls: selection + arithmetic only. Deterministic: same inputs -> same outputs.

Inputs (read-only)
  data/products/uk_products.parquet, data/products/catalog_xl.json, data/store/store_xl.config.json (derivation),
  data/sales/uk_bestsellers.csv, data/ops/params.json, data/personas/lens/*.json
Outputs (this script owns them)
  data/products/catalog_superstore.json
  data/store/formats/{express,metro,superstore}.config.json
  data/store/formats/planogram_{express,metro,superstore}.json
  data/store/stores.json
Run
  python scripts/scale_superstore.py            # build + validate
  python scripts/scale_superstore.py --pools    # only print candidate pool sizes per category
"""
from __future__ import annotations

import difflib
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scale_catalog as X  # noqa: E402  (reuse: role detection, dedupe keys, lens-grade rule set, qty parser)

ROOT = X.ROOT
P = X.P
FMT_DIR = P("data/store/formats")

XL_CATS = list(X.CATS)
XL_TOPUP_TARGET = 65  # assumption: a superstore range is deeper than the 40/category XL store; 65 keeps XL cats on par
NEW_TARGET = 80       # assumption: ~60-100 per new category, capped by pool depth (never padded)
MIN_KEEP = 15         # assumption: a category with <15 clean candidates is dropped (not padded with junk)

# ---------------------------------------------------------------- new categories (OFF category tags)
# (name, include tags, exclude tags, name-reject regex). A product goes to the FIRST matching category in ASSIGN_ORDER.
# assumption: OFF tags are crowd-sourced; the regexes only REMOVE candidates whose name contradicts the tag.
NEW = {
    "free_from": ({"en:products-without-gluten", "en:gluten-free-breads", "en:gluten-free-pasta", "en:gluten-free-biscuits",
                   "en:gluten-free-dry-pasta", "en:gluten-free-sliced-breads", "en:gluten-free-spaghetti", "en:gluten-free-cereals",
                   "en:gluten-free-oats", "en:gluten-free-flour", "en:gluten-free-toasts", "en:gluten-free-pastries"},
                  {"en:frozen-foods", "en:beverages"}, r"^$x"),
    "food_to_go": ({"en:sandwiches", "en:chicken-sandwiches", "en:chicken-wraps", "en:pasta-salads", "en:sushi", "en:filled-wraps",
                    "en:pasta-salad-with-chicken", "en:pasta-salad-with-meat", "en:pasta-salad-with-fish", "en:sub-sandwiches"},
                   {"en:frozen-foods", "en:breads", "en:sliced-breads", "en:sandwich-breads"}, r"bread$|loaf|thins|rolls?$|filler"),
    "low_no_alcohol": ({"en:non-alcoholic-beers", "en:non-alcoholic-ciders", "en:alcohol-free-lager", "en:low-alcohol-beer",
                        "en:vinos-sin-alcohol", "en:tinto-sin-alcohol", "en:alcohol-free-aperitif", "en:alcohol-free-cocktails",
                        "en:low-alcohol-beverage", "en:non-alcoholic-wines", "en:alcohol-free-wines"},
                       {"en:sodas", "en:ginger-beer", "en:root-beers"}, r"ginger beer|root beer"),
    "frozen_meals_veg": ({"en:frozen-foods"}, set(X.SELECTORS[0][1]) | {"en:frozen-desserts", "en:beverages", "en:chocolates", "en:candies"}, r"ice cream|sorbet|lolly|lollies|juice|saft|maltesers"),
    "water": ({"en:waters", "en:spring-waters", "en:mineral-waters", "en:natural-mineral-waters", "en:carbonated-waters",
               "en:carbonated-mineral-waters", "en:coconut-waters"},
              {"en:flavored-waters", "en:flavoured-waters", "en:tonic-water", "en:sodas", "en:energy-drinks"}, r"shrimp|prawn|tonic"),
    "juice_smoothies": ({"en:fruit-juices", "en:juices-and-nectars", "en:smoothies", "en:fruit-smoothies", "en:vegetable-juices",
                         "en:orange-juices", "en:apple-juices", "en:multifruit-juices", "en:squeezed-juices"},
                        {"en:sodas", "en:carbonated-drinks", "en:jams", "en:yogurts", "en:canned-fruits", "en:canned-fruits-in-juice"},
                        r"lemon juice|lime juice|in juice|cordial|concentrate$"),
    "chilled_desserts": ({"en:dairy-desserts", "en:sweet-mousses", "en:chocolate-mousses", "en:trifles", "en:cheesecakes",
                          "en:custards-and-pastry-creams", "en:creamy-puddings", "en:non-dairy-desserts", "en:chocolate-desserts",
                          "en:rice-puddings", "en:entremets-mousses-and-creamy-puddings", "en:dairy-mousses"},
                         {"en:yogurts", "en:ice-creams", "en:frozen-foods", "en:christmas-puddings", "en:yorkshire-puddings",
                          "en:dessert-mixes", "en:biscuits", "en:cakes", "en:cheeses", "en:candies"}, r"mix$|powder|christmas|cheese|yogh?urt|kefir|liquorice|activia"),
    "cheese": ({"en:cheeses", "en:cheese-substitutes", "en:cheddar-cheese", "en:cream-cheeses", "en:soft-cheeses"},
               {"en:cheesecakes", "en:pizzas", "en:pizzas-pies-and-quiches", "en:crackers-appetizers", "en:snacks", "en:meals",
                "en:sauces", "en:sandwiches", "en:breads", "en:biscuits-and-crackers", "en:salty-snacks"}, r"straws|twists|crackers|scone|toastie|sauce"),
    "milk_butter_eggs": ({"en:milks", "en:semi-skimmed-milks", "en:butters", "en:eggs", "en:chicken-eggs", "en:creams",
                          "en:fermented-creams", "en:spreadable-fats", "en:margarines", "en:dairy-spreads", "en:flavoured-milks",
                          "en:milkfat", "en:free-range-chicken-eggs", "en:salted-butters", "en:unsalted-butters"},
                         {"en:chocolate-eggs", "en:easter-eggs", "en:plant-based-milk-alternatives", "en:milk-substitutes",
                          "en:cocoa-and-chocolate-powders", "en:ice-creams", "en:scotch-eggs", "en:egg-pastas", "en:egg-noodles",
                          "en:coconut-milks-and-creams", "en:chocolates", "en:candies", "en:biscuits", "en:plant-based-creams-for-cooking",
                          "en:milk-chocolates", "en:cakes", "en:desserts", "en:mayonnaises", "en:sauces", "en:powdered-milks",
                          "en:breads", "en:pastries", "en:viennoiseries"}, r"chocolate egg|easter|mayo|noodle|pasta|powder|croissant|shortbread|fudge|caramel|toffee"),
    "meat_free": ({"en:meat-analogues", "en:meat-alternatives", "en:vegetarian-sausages", "en:vegetarian-patties", "en:vegetarian-balls",
                   "en:tofu", "en:tofus", "en:meat-analogues-from-soy-or-wheat-proteins"},
                  {"en:cheese-substitutes", "en:dairy-substitutes", "en:sandwiches", "en:salty-snacks", "en:canned-foods",
                   "en:spreads", "en:sauces"}, r"jerky|crisps|spread"),
    "cooked_meats_deli": ({"en:hams", "en:white-hams", "en:cured-hams", "en:cooked-poultries", "en:cooked-chicken", "en:poultry-hams",
                           "en:cooked-chicken-breast-slices", "en:cured-sausages", "en:salamis", "en:pates", "fr:charcuteries-cuites",
                           "fr:charcuteries-diverses", "en:dried-hams", "en:chorizo", "en:pork-pies", "en:scotch-eggs", "en:pork-pates",
                           "en:melton-mowbray-pork-pie"},
                          {"en:meat-analogues", "en:meat-alternatives", "en:sandwiches", "en:frozen-foods", "en:pizzas",
                           "en:canned-foods", "en:salty-snacks", "en:crisps"}, r"crisps|jerky|sandwich"),
    "meat_poultry": ({"en:chicken-breasts", "en:beef", "en:pork", "en:lamb-meat", "en:sausages", "en:pork-sausages", "en:bacon",
                      "en:hamburgers", "en:beef-hamburgers", "en:beef-steaks", "en:poultries", "en:chickens", "en:meat-preparations",
                      "en:minced-meats", "en:ground-beef-steaks", "en:beef-patties", "en:turkeys"},
                     {"en:hams", "en:cooked-poultries", "en:cooked-chicken", "en:cured-sausages", "en:dried-meats", "en:meals",
                      "en:pies", "en:frozen-foods", "en:sandwiches", "en:meat-analogues", "en:meat-alternatives", "en:canned-foods",
                      "en:pates", "en:poultry-hams", "en:cooked-chicken-breast-slices", "fr:charcuteries-cuites", "en:salty-snacks",
                      "en:snacks", "en:pizzas-pies-and-quiches", "en:breaded-chicken", "en:sauces", "en:soups", "en:eggs",
                      "en:chicken-eggs", "en:salads"}, r"crisps|soup|stock|gravy|pie\b|nugget|kiev|egg"),
    "fish_seafood": ({"en:fishes", "en:seafood", "en:fish-fillets", "en:smoked-fishes", "en:salmons", "en:prawns", "en:crustaceans",
                      "en:smoked-salmons", "en:mackerel-fillets", "en:cooked-prawns", "en:fatty-fishes", "en:lean-fishes"},
                     {"en:canned-fishes", "en:canned-foods", "en:frozen-foods", "en:meals", "en:sandwiches", "en:snacks",
                      "en:sauces", "en:pizzas-pies-and-quiches", "en:salads", "en:spreads", "en:crisps", "en:sushi"},
                     r"crisps|cracker|pie\b|paste|pate|sushi|fish fingers?|agar|gelatine"),
    "dips_salads_deli": ({"en:dips", "en:hummus", "en:coleslaw", "en:prepared-salads", "en:salads", "en:potato-salads",
                          "en:tzatzikis", "en:guacamole", "en:taramasalata"},
                         {"en:salad-dressings", "en:crisps", "en:sandwiches", "en:pasta-salads", "en:salty-snacks", "en:sauces-and-condiments-variety-packs",
                          "en:dried-products", "en:frozen-foods"}, r"dressing|crisps|chips|mix$|seasoning|sandwich|wrap"),
    "chilled_pizza_pasta_pies": ({"en:pizzas-pies-and-quiches", "en:pizzas", "en:quiches", "en:pies", "en:fresh-pasta",
                                  "en:stuffed-pastas", "en:salted-pies", "en:meat-pies", "en:puff-pastry-meals"},
                                 {"en:frozen-foods", "en:sweet-pies", "en:desserts", "en:pork-pies", "en:dry-pastas",
                                  "en:cakes", "en:sweet-pastries-and-pies"}, r"mince pie|apple pie|bakewell|frangipane|tart$|custard"),
    "fresh_produce": ({"en:fresh-vegetables", "en:fresh-fruits", "en:fresh-plant-based-foods", "en:leaf-vegetables", "en:fruits",
                       "en:vegetables", "en:berries", "en:tropical-fruits", "en:potatoes", "en:mushrooms", "en:tomatoes",
                       "en:aromatic-plants", "en:culinary-plants", "en:mixed-vegetables", "en:prepared-vegetables", "en:onions-and-their-products"},
                      {"en:canned-foods", "en:frozen-foods", "en:dried-products", "en:juices-and-nectars", "en:jams", "en:fruit-and-vegetable-preserves",
                       "en:snacks", "en:meals", "en:sauces", "en:soups", "en:desserts", "en:dried-fruits", "en:pickles", "en:yogurts",
                       "en:beverages", "en:spreads", "en:chips-and-fries", "en:breads", "en:dried-plant-based-foods",
                       "en:condiments", "en:fruit-purees", "en:compotes", "en:dairies", "en:breakfast-cereals", "en:groceries",
                       "en:meats", "en:fats", "en:pickled-vegetables", "en:legumes-and-their-products", "en:cereals-and-their-products",
                       "en:frozen-plant-based-foods", "en:canned-plant-based-foods"},
                      r"crisps|juice|smoothie|jam|soup|sauce|dried|\btin\b|canned|syrup|pur[eé]e|chips|fries|frozen|powder|pickled|crunch|bar\b|paste|chutney|dip\b|oil\b|hash brown|batter|grills?\b|cheese|bake\b|crispy|bacon"),
    "world_foods": ({"en:curry-pastes", "en:curry-sauces", "en:soy-sauces", "en:indian-sauces", "en:indian-style-sauces",
                     "en:coconut-milks-and-creams", "en:rice-noodles", "en:dried-rice-noodles", "en:egg-noodles", "en:chinese-noodles",
                     "en:udon-noodles", "en:red-curry-pastes", "en:green-curry-pastes", "en:poppadoms", "en:fish-sauces",
                     "en:hoisin-sauces", "en:taco-shells", "en:tortilla-wraps-kits", "en:fajita-kits", "en:sweet-chili-sauces",
                     "en:teriyaki-sauces", "en:oyster-sauces", "en:salsas", "en:kimchi", "en:miso", "en:misos"},
                    {"en:crisps", "en:salty-snacks", "en:meals", "en:frozen-foods", "en:breads"}, r"crisps"),
    "spreads_honey_jam": ({"en:jams", "en:honeys", "en:marmalades", "en:nut-butters", "en:peanut-butters", "en:chocolate-spreads",
                           "en:hazelnut-spreads", "en:yeast-extract-spreads", "en:sweet-spreads", "en:caramel-spreads",
                           "en:lemon-curds", "en:cocoa-and-hazelnuts-spreads", "en:berry-jams", "en:almond-butters"},
                          {"en:dairy-spreads", "en:spreadable-fats", "en:margarines", "en:cheese-spreads", "en:biscuits",
                           "en:jam-doughnuts", "en:cakes", "en:honey-yogurts", "en:cereals-with-honey", "en:meats", "en:yogurts",
                           "en:bars", "en:breakfast-cereals", "en:confectioneries"}, r"doughnut|yogh?urt|bar\b|cereal"),
    "nuts_dried_fruit": ({"en:nuts", "en:dried-fruits", "en:roasted-nuts", "en:salted-nuts", "en:peanuts", "en:cashew-nuts",
                          "en:mixed-nuts", "en:dried-apricots", "en:raisins", "en:sultanas", "en:dried-mangoes", "en:dried-cranberries",
                          "en:mixed-dried-fruits", "en:dried-prunes", "en:sunflower-seeds", "en:pumpkin-seeds", "en:flax-seeds",
                          "en:chia-seeds", "en:mixed-seeds", "en:almonds", "en:walnuts", "en:pistachios", "en:shelled-nuts",
                          "en:roasted-peanuts", "en:dates", "en:nuts-and-dried-fruits"},
                         {"en:nut-butters", "en:peanut-butters", "en:spreads", "en:nut-bars", "en:bars", "en:chocolates",
                          "en:breakfast-cereals", "en:vegetable-oils", "en:cereal-grains", "en:flours", "en:milk-substitutes",
                          "en:biscuits", "en:cakes", "en:candies", "en:chocolate-candies", "en:plant-based-milk-alternatives",
                          "en:coconut-milks-and-creams", "en:crisps", "en:yogurts"}, r"milk|butter|bar\b|chocolate|yoghurt coated"),
    "baking_home_cooking": ({"en:flours", "en:sugars", "en:baking-mixes", "en:baking-powder", "en:syrups", "en:simple-syrups",
                             "en:baking-decorations", "en:dessert-mixes", "en:yeasts", "en:cake-mixes", "en:icing-sugars",
                             "en:granulated-sugars", "en:powdered-sugars", "en:brown-sugars", "en:cane-sugar", "en:wheat-flours",
                             "en:bread-flours", "en:cereal-flours", "en:baking-ingredients", "en:home-baking", "en:custard-powders",
                             "en:cooking-helpers"},
                            {"en:beverages", "en:sodas", "en:breads", "en:artificially-sweetened-beverages", "en:sweetened-beverages",
                             "en:chocolates", "en:candies", "en:biscuits", "en:pancakes", "en:sauces", "en:cakes", "en:snacks"},
                            r"drink|cordial|squash|coffee syrup|pancakes?$|candy|cookies|sparkles"),
    "oils_vinegar_spices": ({"en:vegetable-oils", "en:olive-oils", "en:extra-virgin-olive-oils", "en:virgin-olive-oils",
                             "en:rapeseed-oils", "en:sunflower-oils", "en:coconut-oils", "en:vinegars", "en:herbs-and-spices",
                             "en:spices", "en:mixtures-of-herbs-and-spices", "en:salts", "en:dried-herbs", "en:seasonings",
                             "en:ground-spices", "en:cooking-sprays", "en:balsamic-vinegars", "en:cider-vinegars", "en:sea-salts",
                             "en:black-peppers", "en:peppers-spices", "en:fruit-and-fruit-seed-oils", "en:cereal-oils"},
                            {"en:salty-snacks", "en:crisps", "en:canned-fishes", "en:dried-tomato-in-oil", "en:fishes",
                             "en:meals", "en:sauces", "en:pickles", "en:chips-and-fries"}, r"crisps|sardine|tuna|chips"),
    "pasta_rice_grains": ({"en:pastas", "en:dry-pastas", "en:rices", "en:cereal-grains", "en:noodles", "en:couscous",
                           "en:quinoa", "en:bulgurs", "en:long-grain-rices", "en:basmati-rices", "en:brown-rices", "en:precooked-rices",
                           "en:lentils", "en:durum-wheat-pasta", "en:spaghetti", "en:pulses", "en:rolled-oats"},
                          {"en:meals", "en:pasta-dishes", "en:canned-foods", "en:frozen-foods", "en:breakfast-cereals", "en:flours",
                           "en:puffed-rice-cakes", "en:snacks", "en:rice-puddings", "en:desserts", "en:sauces", "en:instant-noodles",
                           "en:salads", "en:pasta-salads", "en:fresh-pasta", "en:stuffed-pastas", "en:cereal-bars", "en:biscuits",
                           "en:breads", "en:plant-based-milk-alternatives", "en:mueslis", "en:porridges"}, r"pot\b|snack|crisps|bar\b"),
    "tinned_jars": ({"en:canned-foods", "en:canned-vegetables", "en:canned-legumes", "en:canned-fishes", "en:canned-tomatoes",
                     "en:canned-fruits", "en:baked-beans-in-tomato-sauce", "en:canned-common-beans", "en:pickles",
                     "en:pickled-vegetables", "en:olives", "en:canned-tunas", "en:canned-sardines", "en:canned-chickpeas",
                     "en:canned-plant-based-foods", "en:canned-tomato-products", "en:canned-meats", "en:corned-beef"},
                    {"en:canned-soups", "en:beverages", "en:sodas", "en:coconut-milks-and-creams", "en:canned-meals",
                     "en:soups", "en:energy-drinks"}, r"drink|soda|cola"),
    "sauces_condiments": ({"en:sauces", "en:condiments", "en:ketchup", "en:mayonnaises", "en:mustards", "en:salad-dressings",
                           "en:pasta-sauces", "en:meal-sauces", "en:cooking-sauces", "en:chutneys", "en:barbecue-sauces",
                           "en:hot-sauces", "en:pestos", "en:gravies", "en:stocks", "en:bouillon-cubes", "en:broths",
                           "en:tomato-sauces", "en:green-pestos", "en:salad-creams"},
                          {"en:dessert-sauces", "en:dips", "en:hummus", "en:meals", "en:crisps", "en:salty-snacks", "en:frozen-foods",
                           "en:sandwiches"}, r"crisps|ice cream"),
}
# Category priority. free_from wins over every XL category (a real superstore has a free-from bay);
# then the XL selectors decide (keeps XL categories consistent with scale_catalog.py); then the new ones in this order.
PRE_XL = ["free_from", "food_to_go", "low_no_alcohol"]
POST_XL = ["frozen_meals_veg", "water", "juice_smoothies", "chilled_desserts", "cheese", "milk_butter_eggs", "meat_free",
           "cooked_meats_deli", "meat_poultry", "fish_seafood", "dips_salads_deli", "chilled_pizza_pasta_pies", "world_foods",
           "spreads_honey_jam", "nuts_dried_fruit", "baking_home_cooking", "oils_vinegar_spices", "pasta_rice_grains",
           "tinned_jars", "sauces_condiments", "fresh_produce"]
# world_foods also takes sauces/noodles/condiments whose OFF name says they are a world-cuisine product
WORLD_NAME = re.compile(r"tikka|korma|madras|jalfrezi|balti|masala|rogan josh|vindaloo|dhansak|biryani|thai|teriyaki|hoisin|"
                        r"sweet chil+i|szechuan|sichuan|katsu|enchilada|fajita|taco|gochujang|kimchi|miso|ramen|udon|poppadom|"
                        r"wasabi|harissa|peri[- ]peri|piri[- ]piri|jerk|chipotle|black bean|satay|pad thai|sriracha|tahini|ras el hanout|"
                        r"tamarind|garam|mango chutney|lime pickle|naan|chapati|tortilla|nachos? kit|refried", re.I)
WORLD_FAMILY = {"en:sauces", "en:condiments", "en:noodles", "en:cooking-helpers", "en:groceries", "en:meal-sauces",
                "en:cooking-sauces", "en:chutneys", "en:hot-sauces", "en:pickles", "en:canned-legumes"}

# assumption: long-standing UK leaders in the NEW categories (data/sales/uk_bestsellers.csv only covers 9 XL categories +
# meal deal). Seeded from obvious category leaders; labelled per product as role_source.
INCUMBENT_ASSUMED_SUPER = [
    "heinz", "hellmann's", "hellmanns", "colman's", "colmans", "branston", "hp", "lea & perrins", "bisto", "oxo", "knorr",
    "dolmio", "ragu", "loyd grossman", "homepride", "uncle ben's", "ben's original", "tilda", "napolina", "barilla",
    "de cecco", "garofalo", "patak's", "pataks", "sharwood's", "sharwoods", "blue dragon", "amoy", "old el paso", "kikkoman",
    "lee kum kee", "geeta's", "schwartz", "bertolli", "filippo berio", "flora", "lurpak", "anchor", "country life",
    "clover", "utterly butterly", "cathedral city", "pilgrims choice", "seriously", "philadelphia", "babybel", "dairylea",
    "arla", "cravendale", "yeo valley", "muller", "müller", "gü", "gu", "cadbury", "aero", "richmond", "wall's", "walls",
    "bernard matthews", "mattessons", "peperami", "quorn", "linda mccartney", "this", "richmond", "birds eye", "mccain",
    "young's", "youngs", "goodfella's", "chicago town", "aunt bessie's", "dr. oetker", "dr oetker", "ristorante",
    "john west", "princes", "green giant", "batchelors", "bachelors", "baxters", "hartley's", "hartleys", "bonne maman",
    "robertson's", "rowse", "gale's", "sun-pat", "sunpat", "marmite", "nutella", "kp", "whitworths", "silver spoon",
    "tate & lyle", "lyle's", "mcdougalls", "allinson's", "be-ro", "tropicana", "innocent", "copella", "ribena", "volvic",
    "evian", "highland spring", "buxton", "harrogate", "heineken", "guinness", "beck's", "becks", "budweiser", "peroni",
    "corona", "erdinger", "schar", "schär", "genius", "nairn's", "nairns", "warburtons", "hovis", "gressingham",
    "ginsters", "pukka", "higgidy", "sabra", "the delicious dip company", "pringles", "walkers", "mcvitie's", "mcvities",
    "kingsmill", "jacob's", "jacobs", "kelloggs", "kellogg's", "tetley", "pg tips", "ambrosia", "bird's", "birds", "angel delight",
    "hartley", "del monte", "s&w", "kenco", "oasis", "lucozade", "robinsons", "rachel's", "onken", "alpro",
]
CURATION = "auto_superstore"


# ---------------------------------------------------------------- helpers
def tags_of(r):
    return set(X.split(r.get("categories")))


def xl_category(r, tags):
    """The category scale_catalog.py's SELECTORS would give this product (None if none / name-rejected)."""
    for c, inc, exc in X.SELECTORS:
        if tags & inc and not tags & exc:
            if re.search(X.NAME_REJECT.get(c, r"^$x"), str(r["name"]), re.I):
                return None
            return c
    return None


def new_match(c, r, tags):
    inc, exc, rej = NEW[c]
    hit = bool(tags & inc)
    if c == "world_foods" and not hit:
        hit = bool(tags & WORLD_FAMILY) and bool(WORLD_NAME.search(str(r["name"])))
    if not hit or tags & exc:
        return False
    # assumption: fresh produce on the produce tables is unprocessed; NOVA 3/4 items tagged as vegetables are prepared
    # dishes (cauliflower cheese, hash browns, battered slices) and belong elsewhere.
    if c == "fresh_produce" and r.get("nova") not in (1, 2):
        return False
    return not re.search(rej, str(r["name"]), re.I)


def role_super(brand, bestsellers, curated_inc):
    role, src = X.role_for(brand, bestsellers, curated_inc)
    if role == "challenger":
        m = X.brand_matches(X.norm(brand), INCUMBENT_ASSUMED_SUPER)
        if m:
            return "incumbent", f"assumption: '{m}' is a long-standing UK category leader in a superstore-only category (not covered by uk_bestsellers.csv)"
    return role, src


def clean_base(r):
    """Superstore candidate filter for NEW categories: image + name + brand (spec), English UK name (XL rule)."""
    img = r.get("image") or ""
    if not img or "invalid" in img or not str(r.get("name") or "").strip() or not str(r.get("brand") or "").strip():
        return False
    if not X.englishish(r["name"]) or X.FOREIGN.search(str(r["name"])):
        return False
    if re.search(r"\boz\b", str(r.get("quantity") or ""), re.I):
        return False
    return True


def clean_xl(r):
    """XL top-ups keep the stricter XL filter (ingredients_text + sugars_100g present), so they grade like the XL set."""
    return clean_base(r) and bool(r.get("ingredients_text")) and X.num(r.get("sugars_100g")) is not None


def candidates(df, have):
    cand = defaultdict(list)
    for r in df.to_dict("records"):
        if r["code"] in have or not clean_base(r):
            continue
        tags = tags_of(r)
        cat = None
        for c in PRE_XL:
            if new_match(c, r, tags):
                cat = c
                break
        if cat is None:
            xc = xl_category(r, tags)
            if xc and clean_xl(r):
                cat = xc
            elif xc is None:
                for c in POST_XL:
                    if new_match(c, r, tags):
                        cat = c
                        break
        if cat:
            r["_tags"] = tags
            cand[cat].append(r)
    return cand




# ---------------------------------------------------------------- variety sub-types for the new categories (greedy picker bins)
SUB_NEW = {
    "milk_butter_eggs": [("eggs", {"en:eggs", "en:chicken-eggs"}), ("butter", {"en:butters", "en:salted-butters", "en:unsalted-butters"}),
                         ("spread", {"en:spreadable-fats", "en:margarines", "en:dairy-spreads"}), ("cream", {"en:creams", "en:fermented-creams"}),
                         ("milk", {"en:milks", "en:semi-skimmed-milks", "en:flavoured-milks"})],
    "fresh_produce": [("fruit", {"en:fruits", "en:fresh-fruits", "en:berries", "en:tropical-fruits"}), ("herb", {"en:aromatic-plants", "en:culinary-plants"}),
                      ("veg", {"en:vegetables", "en:fresh-vegetables", "en:leaf-vegetables", "en:potatoes", "en:tomatoes", "en:mushrooms"})],
    "meat_poultry": [("sausage_bacon", {"en:sausages", "en:bacon", "en:pork-sausages"}), ("chicken", {"en:chickens", "en:poultries", "en:chicken-breasts"}),
                     ("beef", {"en:beef", "en:beef-hamburgers", "en:beef-steaks"}), ("lamb", {"en:lamb-meat"}), ("pork", {"en:pork"})],
    "fish_seafood": [("smoked", {"en:smoked-fishes", "en:smoked-salmons"}), ("shellfish", {"en:prawns", "en:crustaceans"}), ("fillet", {"en:fish-fillets"})],
    "cheese": [("vegan", {"en:cheese-substitutes"}), ("cheddar", {"en:cheddar-cheese"}), ("soft", {"en:cream-cheeses", "en:soft-cheeses"}), ("italian", {"en:italian-cheeses"})],
    "pasta_rice_grains": [("noodle", {"en:noodles"}), ("pulse", {"en:pulses", "en:lentils"}), ("rice", {"en:rices"}), ("pasta", {"en:pastas"}), ("grain", {"en:cereal-grains"})],
    "tinned_jars": [("fish", {"en:canned-fishes"}), ("tomato", {"en:canned-tomatoes"}), ("fruit", {"en:canned-fruits"}), ("pickle", {"en:pickles", "en:olives"}),
                    ("beans", {"en:canned-legumes", "en:baked-beans-in-tomato-sauce"}), ("veg", {"en:canned-vegetables"})],
    "sauces_condiments": [("gravy_stock", {"en:gravies", "en:stocks", "en:bouillon-cubes", "en:broths"}), ("pasta", {"en:pasta-sauces", "en:pestos"}),
                          ("cooking", {"en:meal-sauces", "en:cooking-sauces"}), ("table", {"en:ketchup", "en:mayonnaises", "en:mustards", "en:salad-dressings", "en:salad-creams"}),
                          ("chutney_hot", {"en:chutneys", "en:hot-sauces", "en:barbecue-sauces"})],
    "oils_vinegar_spices": [("vinegar", {"en:vinegars"}), ("spice", {"en:herbs-and-spices", "en:spices", "en:mixtures-of-herbs-and-spices", "en:seasonings", "en:salts"}),
                            ("oil", {"en:vegetable-oils"})],
    "spreads_honey_jam": [("yeast", {"en:yeast-extract-spreads"}), ("honey", {"en:honeys"}), ("nut", {"en:nut-butters", "en:peanut-butters"}),
                          ("choc", {"en:chocolate-spreads", "en:hazelnut-spreads"}), ("jam", {"en:jams", "en:marmalades"})],
    "nuts_dried_fruit": [("seed", {"en:sunflower-seeds", "en:pumpkin-seeds", "en:flax-seeds", "en:chia-seeds", "en:mixed-seeds"}), ("dried_fruit", {"en:dried-fruits"}), ("nut", {"en:nuts"})],
    "juice_smoothies": [("smoothie", {"en:smoothies", "en:fruit-smoothies"}), ("orange", {"en:orange-juices"}), ("apple", {"en:apple-juices"})],
    "water": [("coconut", {"en:coconut-waters"}), ("sparkling", {"en:carbonated-waters", "en:carbonated-mineral-waters"})],
    "frozen_meals_veg": [("pizza", {"en:pizzas", "en:frozen-pizzas"}), ("chips", {"en:fries", "en:frozen-fries", "en:frozen-fried-potatoes"}), ("veg", {"en:frozen-vegetables"}),
                         ("fish", {"en:frozen-fishes", "en:frozen-seafood", "en:fish-fingers"}), ("meal", {"en:frozen-ready-made-meals", "en:meals"}), ("meat", {"en:meats"})],
    "chilled_pizza_pasta_pies": [("pizza", {"en:pizzas"}), ("pasta", {"en:fresh-pasta", "en:stuffed-pastas"}), ("pie_quiche", {"en:pies", "en:quiches"})],
    "baking_home_cooking": [("flour", {"en:flours"}), ("sugar", {"en:sugars"}), ("syrup", {"en:syrups", "en:simple-syrups"}), ("mix", {"en:baking-mixes", "en:dessert-mixes"})],
    "world_foods": [("coconut", {"en:coconut-milks-and-creams"}), ("indian", {"en:curry-sauces", "en:indian-sauces", "en:curry-pastes"}), ("asian", {"en:soy-sauces", "en:rice-noodles", "en:egg-noodles"})],
    "food_to_go": [("wrap", {"en:chicken-wraps", "en:filled-wraps"}), ("pasta_salad", {"en:pasta-salads"}), ("sandwich", {"en:sandwiches"})],
    "dips_salads_deli": [("houmous", {"en:hummus"}), ("salad", {"en:salads", "en:prepared-salads", "en:coleslaw"}), ("dip", {"en:dips"})],
    "cooked_meats_deli": [("pie", {"en:pork-pies"}), ("cured", {"en:cured-sausages", "en:salamis", "en:chorizo"}), ("chicken", {"en:cooked-poultries", "en:cooked-chicken"}), ("ham", {"en:hams"})],
    "meat_free": [("tofu", {"en:tofu", "en:tofus"}), ("sausage", {"en:vegetarian-sausages"}), ("burger", {"en:vegetarian-patties"})],
    "chilled_desserts": [("cheesecake", {"en:cheesecakes"}), ("custard", {"en:custards-and-pastry-creams"}), ("mousse", {"en:sweet-mousses", "en:dairy-mousses"}),
                         ("pudding", {"en:creamy-puddings", "en:rice-puddings"})],
    "free_from": [("bread", {"en:gluten-free-breads"}), ("pasta", {"en:gluten-free-pasta"}), ("biscuit", {"en:gluten-free-biscuits"})],
    "low_no_alcohol": [("cider", {"en:non-alcoholic-ciders"}), ("beer", {"en:non-alcoholic-beers"})],
}


def subtype(c, tags):
    if c in X.SUBTYPES:
        return X.subtype(c, tags)
    for name, ts in SUB_NEW.get(c, []):
        if tags & ts:
            return name
    return "other"


# assumption: single-serve thresholds (g or ml of ONE item) for the meal_deal / glp1 'serve' feature in NEW categories:
# (<=small -> 1, <=medium -> .5, else 0). UK pack-format conventions, not sourced; XL categories keep scale_catalog.SERVE.
SERVE_NEW = {"fresh_produce": (150, 500), "meat_poultry": (200, 500), "fish_seafood": (150, 300), "cheese": (50, 250),
             "chilled_desserts": (125, 400), "milk_butter_eggs": (330, 1000), "frozen_meals_veg": (400, 800),
             "pasta_rice_grains": (125, 500), "tinned_jars": (200, 400), "sauces_condiments": (150, 400),
             "oils_vinegar_spices": (100, 500), "baking_home_cooking": (250, 1000), "world_foods": (150, 400),
             "nuts_dried_fruit": (50, 200), "spreads_honey_jam": (200, 400), "juice_smoothies": (250, 750),
             "water": (500, 1000), "low_no_alcohol": (330, 500), "free_from": (100, 400), "meat_free": (200, 400),
             "food_to_go": (250, 400), "dips_salads_deli": (100, 250), "cooked_meats_deli": (100, 200),
             "chilled_pizza_pasta_pies": (300, 500)}
X.SERVE.update(SERVE_NEW)  # in-memory only: lets the imported grade() handle the new categories

# assumption: incumbent-brand shelf price per kg (or per L) at the category's median pack, UK 2025-26, author's estimate
# (not scraped, not measured). Used ONLY to anchor the price band of the NEW categories; every product's price_source
# spells out its own arithmetic. Sub-type overrides where one category mixes very different £/kg (milk vs butter).
UNIT_PRICE_ASSUMED = {
    "fresh_produce": 3.0, "meat_poultry": 9.0, "fish_seafood": 16.0, "cheese": 10.0, "chilled_desserts": 5.0,
    "milk_butter_eggs": 3.0, "frozen_meals_veg": 4.5, "pasta_rice_grains": 2.5, "tinned_jars": 3.0, "sauces_condiments": 5.5,
    "oils_vinegar_spices": 7.0, "baking_home_cooking": 2.0, "world_foods": 7.0, "nuts_dried_fruit": 12.0,
    "spreads_honey_jam": 8.0, "juice_smoothies": 2.2, "water": 0.6, "low_no_alcohol": 4.5, "free_from": 9.0, "meat_free": 10.0,
    "food_to_go": 15.0, "dips_salads_deli": 8.0, "cooked_meats_deli": 16.0, "chilled_pizza_pasta_pies": 6.0,
}
UNIT_PRICE_SUB = {("milk_butter_eggs", "milk"): 1.1, ("milk_butter_eggs", "butter"): 9.0, ("milk_butter_eggs", "eggs"): 4.5,
                  ("milk_butter_eggs", "cream"): 4.5, ("milk_butter_eggs", "spread"): 4.0, ("oils_vinegar_spices", "spice"): 35.0,
                  ("oils_vinegar_spices", "vinegar"): 3.0, ("oils_vinegar_spices", "oil"): 6.0, ("baking_home_cooking", "flour"): 1.2,
                  ("baking_home_cooking", "sugar"): 1.3, ("baking_home_cooking", "syrup"): 5.0, ("baking_home_cooking", "mix"): 6.0}
# assumption: pack-size elasticity for the NEW categories. Fresh/weighed foods price close to linearly in weight; UK
# multi-size ranges typically cut £/kg by ~20% when pack size doubles (2^0.7 = 1.62x price for 2x pack). The XL fit
# (0.296, scale_catalog.fit_price_model) came from snacks/drinks and is kept for XL top-ups only.
BETA_NEW = 0.7
PRICE_CLIP = (0.3, 6.0)  # assumption: shelf price clipped to 0.3x-6x of the category's median-pack incumbent price

# assumption: physical pack size for shelf filling. (facing width, height, depth) in cm for a reference pack of ref_g
# grams/ml, scaled by (pack/ref)^(1/3) (isometric scaling), clipped to 0.55x-2.0x. Typical UK formats (can, carton,
# jar, tray, bag); not measured. width_cm is the FACING width (what one facing uses along the shelf).
DIMS = {  # (w, h, d, ref_g)
    "bakery_bread": (13, 13, 28, 800), "breakfast_cereal": (19, 29, 7, 500), "hot_drinks": (12, 15, 7, 250),
    "soft_drinks": (6.5, 21, 6.5, 500), "crisps_savoury": (17, 24, 7, 150), "snack_bars": (14, 12, 5, 150),
    "biscuits_chocolate": (12, 8, 6, 200), "confectionery_sweets": (14, 20, 4, 150), "ready_meals_soup": (12, 8, 15, 400),
    "plant_milk_dairy_alt": (7, 24, 9.5, 1000), "yoghurt": (10, 9, 10, 450), "frozen_icecream": (17, 11, 12, 500),
    "fresh_produce": (18, 8, 25, 500), "meat_poultry": (15, 4, 22, 450), "fish_seafood": (13, 3, 20, 250),
    "cheese": (11, 4, 14, 350), "chilled_desserts": (14, 6, 10, 400), "milk_butter_eggs": (11, 7, 11, 500),
    "frozen_meals_veg": (19, 5, 26, 700), "pasta_rice_grains": (12, 25, 6, 500), "tinned_jars": (7.5, 11, 7.5, 400),
    "sauces_condiments": (7, 17, 7, 450), "oils_vinegar_spices": (7, 25, 7, 750), "baking_home_cooking": (12, 18, 8, 1000),
    "world_foods": (7, 14, 7, 400), "nuts_dried_fruit": (13, 20, 5, 200), "spreads_honey_jam": (7.5, 11, 7.5, 340),
    "juice_smoothies": (9.5, 24, 6.5, 1000), "water": (8, 30, 8, 1500), "low_no_alcohol": (6.6, 12, 6.6, 330),
    "free_from": (14, 18, 8, 400), "meat_free": (14, 5, 20, 300), "food_to_go": (8, 14, 12, 200),
    "dips_salads_deli": (10, 6, 10, 200), "cooked_meats_deli": (12, 2, 18, 120), "chilled_pizza_pasta_pies": (20, 5, 22, 400),
}
DIMS_SUB = {("milk_butter_eggs", "milk"): (11, 24, 11, 2000), ("milk_butter_eggs", "eggs"): (16, 7, 10, 360),
            ("milk_butter_eggs", "butter"): (11, 6, 7, 250), ("oils_vinegar_spices", "spice"): (4.5, 10, 4.5, 40)}


def pack_dims(cat, sub, total):
    w, h, d, ref = DIMS_SUB.get((cat, sub)) or DIMS[cat]
    s = 1.0 if not total else min(2.0, max(0.55, (total / ref) ** (1 / 3)))
    r5 = lambda v: round(v * s * 2) / 2  # noqa: E731
    src = (f"assumption: {cat}{'/' + sub if (cat, sub) in DIMS_SUB else ''} reference pack {w}x{h}x{d} cm (w x h x d) at {ref} g/ml, "
           f"scaled by (pack {total or 'unknown -> ref'}/{ref})^(1/3) = {s:.2f} (clip 0.55-2.0); UK pack-format convention, not measured")
    return {"width_cm": r5(w), "height_cm": r5(h), "depth_cm": r5(d), "dims_source": src}


# ---------------------------------------------------------------- selection (same greedy picker as scale_catalog.main)
def quality(r):
    uk = str(r["code"]).startswith("50") or bool(X.MAJOR_GROCERS.search(str(r.get("stores") or "")))
    # quality = log1p(OFF scans) + 2*OFF completeness + 1 if UK signal (same weights as scale_catalog; assumption there)
    return math.log1p(X.num(r.get("scans")) or 0) + 2 * (X.num(r.get("completeness")) or 0) + (1.0 if uk else 0.0)


def pick(c, pool, need, existing, offidx, bestsellers, curated_inc):
    for r in pool:
        r["_q"] = quality(r)
        r["_role"], r["_role_src"] = role_super(r["brand"], bestsellers, curated_inc)
        r["_sub"] = subtype(c, r["_tags"])
    pool = sorted(pool, key=lambda r: (-r["_q"], str(r["code"])))[:800]
    # same role quota as XL: ~40% challenger / 35% incumbent / 25% own_label (assumption, see curated_xl_rules.md §3)
    quota = {"challenger": round(need * .40), "incumbent": round(need * .35)}
    quota["own_label"] = need - quota["challenger"] - quota["incumbent"]
    # assumption: brand cap per category = max(4, 8% of the target). XL used 4; superstore own-label (Tesco, Sainsbury's,
    # Asda, M&S, Aldi...) each carry many fresh lines, so the cap scales with the category size.
    cap = max(4, round(need * 0.08)) if c not in XL_CATS else 4
    chosen_keys = [(X.norm(p["brand"]), X.name_key(p["name"], p["brand"])) for p in existing]
    bin_count = defaultdict(Counter)
    for p in existing:
        ctags = set(X.split(offidx.get(p["code"], {}).get("categories")))
        an = p.get("analysis") if isinstance(p.get("analysis"), list) else X.split(p.get("analysis"))
        for k, v in X.bins({**p, "_sub": subtype(c, ctags), "analysis": an}).items():
            bin_count[k][v] += 1
    brand_count = Counter(X.bfirst(p["brand"]) for p in existing)
    qmax = max([r["_q"] for r in pool] or [1])

    def prep(r):
        return {"nova": int(r["nova"]), "additives_n": int(r["additives_n"]), "sugars_100g": X.num(r["sugars_100g"]),
                "labels": X.split(r["labels"]), "analysis": X.split(r["analysis"]), "_sub": r["_sub"]}

    def dup(r):
        k = (X.norm(r["brand"]), X.name_key(r["name"], r["brand"]))
        for b, n in chosen_keys:
            if b == k[0] and difflib.SequenceMatcher(None, n, k[1]).ratio() >= 0.8:
                return True
            if n and n == k[1] and difflib.SequenceMatcher(None, b, k[0]).ratio() >= 0.6:
                return True
        return False

    picks, relax, taken = [], False, set()
    while len(picks) < need:
        best, best_s = None, -1
        for r in pool:
            if r["code"] in taken:
                continue
            if not relax and quota.get(r["_role"], 0) <= 0:
                continue
            if brand_count[X.bfirst(r["brand"])] >= cap:
                continue
            variety = sum((1.5 if k == "subtype" else 1) / (1 + bin_count[k][v]) for k, v in X.bins(prep(r)).items())
            s = r["_q"] / qmax + 0.6 * variety
            if s > best_s:
                if dup(r):
                    taken.add(r["code"])
                    continue
                best, best_s = r, s
        if best is None:
            if relax:
                break
            relax = True
            continue
        taken.add(best["code"])
        quota[best["_role"]] = quota.get(best["_role"], 0) - 1
        brand_count[X.bfirst(best["brand"])] += 1
        chosen_keys.append((X.norm(best["brand"]), X.name_key(best["name"], best["brand"])))
        for k, v in X.bins(prep(best)).items():
            bin_count[k][v] += 1
        picks.append(best)
    return picks


def pool_scales(pool):
    """Per-category caps for the NEW categories = 95th percentile of the category's candidate pool (data-derived)."""
    def p95(k, lo, hi, floor):
        v = [X.num(r.get(k)) for r in pool]
        v = [x for x in v if x is not None and lo <= x <= hi]
        return round(max(float(np.percentile(v, 95)) if v else floor, floor), 1)
    return {"sugar_cap": p95("sugars_100g", 0, 100, 2.0), "kcal_cap": p95("energy-kcal_100g", 1, 900, 30.0),
            "protein_cap": p95("proteins_100g", 0, 100, 5.0), "fibre_cap": p95("fiber_100g", 0, 30, 3.0),
            "source": "95th percentile of this category's OFF candidate pool (floors 2 g sugar / 30 kcal / 5 g protein / 3 g fibre)"}


def build_new(r, c, med_pack):
    """Product record for a NEW category: scale_catalog.build_product with a per-category price anchor (see price_source)."""
    sub = r["_sub"]
    total, _ = X.parse_qty(r.get("quantity"))
    up = UNIT_PRICE_SUB.get((c, sub), UNIT_PRICE_ASSUMED[c])
    mp = med_pack[c]
    base = round(up * mp / 1000, 2)
    lo, hi = round(base * PRICE_CLIP[0], 2), round(base * PRICE_CLIP[1], 2)
    price = {"base_incumbent_median_pack": {c: base}, "role_mult": XLD["price_model"]["role_mult"], "median_pack": {c: mp},
             "beta_pack": BETA_NEW, "band": {c: (lo, hi)}}
    p = X.build_product(r, c, price, {c: SC[c]}, {c: (0.0, 1.0)})  # grades redone after the unit-price band is known
    mult = price["role_mult"][p["role"]]
    p["price_source"] = (f"assumption: incumbent shelf price £{up}/kg|L for {c}{'/' + sub if (c, sub) in UNIT_PRICE_SUB else ''} "
                         f"(author's UK 2025-26 estimate) x category median pack {mp} g|ml = base £{base}; x role_mult[{p['role']}]={mult} "
                         f"(fitted on the curated set, store_xl.config.json derivation.price_model) x (pack {total or 'unknown'}/{mp})^{BETA_NEW} "
                         f"(assumption: pack elasticity), clipped £{lo}-£{hi}; see data/products/superstore_rules.md §4")
    p["_cats"] = sorted(r["_tags"])
    return p


def regrade(p, c, upb):
    p["lens_grades"] = X.grade(p, c, SC, upb)


# ---------------------------------------------------------------- store formats: fixtures + departments
# Fixture geometry. Every number labelled; UK shopfitting module sizes are conventions, not a cited standard.
FIXTURES = {
    "gondola": {"rows": 5, "bay_cm": 100, "shelf_depth_cm": 45, "row_clear_cm": 35, "fridge": False, "freezer": False,
                "source": "assumption: 1.0 m is a common UK gondola bay module (1.25 m also common); 5 shelves; 0.45 m shelf depth (same as store_xl stock_rules); ~35 cm clear per shelf on a ~2.0 m gondola"},
    "multideck_fridge": {"rows": 5, "bay_cm": 125, "shelf_depth_cm": 50, "row_clear_cm": 30, "fridge": True, "freezer": False,
                         "source": "assumption: open-front chilled multideck, 1.25 m module (common UK lengths 1.25/1.875/2.5 m), 5 shelves incl. base deck"},
    "wall_chiller": {"rows": 5, "bay_cm": 125, "shelf_depth_cm": 50, "row_clear_cm": 30, "fridge": True, "freezer": False,
                     "source": "assumption: same multideck module, wall-mounted on the perimeter (meal deal / chilled racetrack)"},
    "freezer_doors": {"rows": 5, "bay_cm": 75, "shelf_depth_cm": 60, "row_clear_cm": 30, "fridge": True, "freezer": True,
                      "source": "assumption: upright glass-door freezer, one ~75 cm door per bay, 5 shelves"},
    "produce_tables": {"rows": 3, "bay_cm": 120, "shelf_depth_cm": 40, "row_clear_cm": 25, "fridge": False, "freezer": False,
                       "source": "assumption: tiered produce table with crates (60x40 cm crates, 2 per 120 cm bay), 3 tiers; NOT a shelf"},
    "bakery_counter": {"rows": 4, "bay_cm": 100, "shelf_depth_cm": 40, "row_clear_cm": 40, "fridge": False, "freezer": False,
                       "source": "assumption: wooden bread racks + in-store bakery counter, 4 tiers"},
}
ROW_NAMES = {"1": "top", "2": "eye", "3": "middle", "4": "lower", "5": "bottom"}
# role -> preferred rows (1 = top). Same convention as store_xl (assumption: leaders at eye level, own-label/value low,
# challengers top/middle), extended to 5 rows; tables/racks with fewer rows use the same order filtered to their rows.
ROW_PREF = {"incumbent": [2, 3, 1, 4, 5], "own_label": [4, 5, 3, 2, 1], "challenger": [1, 3, 2, 4, 5]}
FACING_WEIGHT = {"incumbent": 2.0, "own_label": 1.5, "challenger": 1.0}  # assumption: leaders hold more facings
FMAX = 14  # assumption: no SKU gets more than 14 facings on one shelf (avoids one SKU walling a bay)

# Department catalogue (names follow UK superstore signage conventions; assumption, not a cited planogram).
# kind: produce | bakery | food_to_go | perimeter (chilled racetrack) | centre (numbered aisles) | frozen (numbered
# aisles, freezer doors) | bws (numbered aisle next to the tills)
DEPTS = {
    "fruit_veg": ("fruit & veg", "produce", "produce_tables", ["fresh_produce"], "#5f9e4a", "Fruit & Veg · Flowers"),
    "bakery": ("bakery", "bakery", "bakery_counter", ["bakery_bread"], "#c8955a", "Bakery"),
    "food_to_go": ("food to go · meal deal", "food_to_go", "wall_chiller", ["food_to_go"], "#d9534f", "Food to Go · Meal Deal"),
    "meat": ("meat & poultry", "perimeter", "multideck_fridge", ["meat_poultry"], "#b5544c", "Meat & Poultry"),
    "fish": ("fish", "perimeter", "multideck_fridge", ["fish_seafood"], "#4a7fb5", "Fish"),
    "cheese_deli": ("cheese & deli", "perimeter", "multideck_fridge", ["cheese", "cooked_meats_deli", "dips_salads_deli"], "#e0c060", "Cheese & Deli"),
    "dairy": ("dairy & eggs", "perimeter", "multideck_fridge", ["milk_butter_eggs", "yoghurt", "plant_milk_dairy_alt", "juice_smoothies"], "#f2f2e6", "Milk · Butter · Eggs · Yoghurt · Juice"),
    "ready_meals": ("ready meals", "perimeter", "multideck_fridge", ["ready_meals_soup", "chilled_pizza_pasta_pies", "meat_free"], "#9a6fb0", "Ready Meals · Pizza · Meat-free"),
    "desserts": ("chilled desserts", "perimeter", "multideck_fridge", ["chilled_desserts"], "#e89bb0", "Chilled Desserts"),
    "breakfast": ("cereals & breakfast", "centre", "gondola", ["breakfast_cereal", "spreads_honey_jam"], "#e8b04a", "Cereals · Spreads · Honey"),
    "hot_drinks": ("hot drinks", "centre", "gondola", ["hot_drinks"], "#7a5230", "Tea · Coffee · Hot Chocolate"),
    "baking": ("home baking", "centre", "gondola", ["baking_home_cooking"], "#d8c3a5", "Home Baking · Sugar · Flour"),
    "pasta_tins": ("pasta, rice & tins", "centre", "gondola", ["pasta_rice_grains", "tinned_jars"], "#c0a060", "Pasta · Rice · Tins · Jars"),
    "cooking": ("cooking sauces & condiments", "centre", "gondola", ["sauces_condiments", "oils_vinegar_spices"], "#c0504d", "Sauces · Oils · Herbs & Spices"),
    "world": ("world foods", "centre", "gondola", ["world_foods"], "#e07b39", "World Foods"),
    "free_from": ("free from", "centre", "gondola", ["free_from"], "#7fb77e", "Free From"),
    "snacks": ("crisps & snacks", "centre", "gondola", ["crisps_savoury", "nuts_dried_fruit", "snack_bars"], "#f0c419", "Crisps · Nuts · Snack Bars"),
    "biscuits": ("biscuits & chocolate", "centre", "gondola", ["biscuits_chocolate", "confectionery_sweets"], "#8b4513", "Biscuits · Chocolate · Sweets"),
    "drinks": ("soft drinks & water", "centre", "gondola", ["soft_drinks", "water"], "#3a8fd9", "Soft Drinks · Water"),
    "frozen": ("frozen", "frozen", "freezer_doors", ["frozen_meals_veg", "frozen_icecream"], "#a8d8f0", "Frozen · Ice Cream"),
    "bws": ("beer, wine & spirits", "bws", "gondola", ["low_no_alcohol"], "#6b2d5c", "Beer · Wine · Spirits (alcohol-free range)"),
}
# Per-format department overrides: express groups departments onto fewer fixtures (convenience format).
# (dept id, overrides). Overrides may change name, kind, fixture, cats. assumption: typical UK convenience layout
# (meal deal + drinks chillers by the door, one chilled wall, two short grocery aisles, a wall freezer by the tills).
EXPRESS_DEPTS = [
    ("fruit_veg", {}), ("bakery", {}), ("food_to_go", {}),
    ("drinks", {"kind": "perimeter", "fixture": "wall_chiller", "cats": ["soft_drinks", "water", "juice_smoothies"], "name": "chilled drinks"}),
    ("dairy", {"cats": ["milk_butter_eggs", "yoghurt", "plant_milk_dairy_alt", "cheese", "cooked_meats_deli", "dips_salads_deli"], "name": "dairy, cheese & deli"}),
    ("ready_meals", {"cats": ["ready_meals_soup", "chilled_pizza_pasta_pies", "meat_free", "chilled_desserts"], "name": "ready meals & desserts"}),
    ("snacks", {"cats": ["crisps_savoury", "snack_bars", "nuts_dried_fruit", "confectionery_sweets", "biscuits_chocolate"], "name": "crisps, snacks & confectionery", "sign": "Crisps · Snacks · Chocolate · Sweets"}),
    ("grocery", {"cats": ["breakfast_cereal", "spreads_honey_jam", "hot_drinks", "tinned_jars", "pasta_rice_grains", "sauces_condiments", "oils_vinegar_spices"]}),
    ("frozen", {"kind": "perimeter"}),
]
DEPTS["grocery"] = ("food cupboard", "centre", "gondola", [], "#c0a060", "Cereals · Tea & Coffee · Tins · Pasta · Sauces")

# Express range: assumption: convenience format carries the meal-deal + top-up lines (~330 SKUs); per-category counts
# below are the author's convenience-range estimate (no IGD/Kantar range data was reachable, see data/ops/evidence.md).
EXPRESS_QUOTA = {"food_to_go": 36, "soft_drinks": 30, "water": 8, "juice_smoothies": 10, "milk_butter_eggs": 14, "yoghurt": 10,
                 "plant_milk_dairy_alt": 5, "cheese": 8, "cooked_meats_deli": 8, "ready_meals_soup": 14, "dips_salads_deli": 6,
                 "chilled_pizza_pasta_pies": 6, "meat_free": 3, "crisps_savoury": 24, "snack_bars": 12, "confectionery_sweets": 20,
                 "biscuits_chocolate": 20, "nuts_dried_fruit": 6, "breakfast_cereal": 8, "spreads_honey_jam": 6, "tinned_jars": 10,
                 "pasta_rice_grains": 6, "sauces_condiments": 8, "oils_vinegar_spices": 3, "fresh_produce": 16, "bakery_bread": 14, "hot_drinks": 10, "chilled_desserts": 6,
                 "frozen_icecream": 10, "frozen_meals_veg": 6}
METRO_SHARE = 0.4  # assumption: a metro (~1,000 m² high-street) store carries ~40% of the superstore range per category

FORMATS = {
    "express": {"name": "eat_hack Express (convenience, ~10 units)", "centre_aisles": 2, "banks": 1, "bays_per_side": 2,
                "staffed": 2, "self": 4, "entrances": 1, "cafe": None, "depts": EXPRESS_DEPTS, "left_zone_m": 6.0},
    "metro": {"name": "eat_hack Metro (high street, ~24 units)", "centre_aisles": 6, "banks": 1, "bays_per_side": 3,
              "staffed": 4, "self": 8, "entrances": 1, "cafe": None, "depts": [(d, {}) for d in DEPTS if d != "grocery"], "left_zone_m": 10.0},
    "superstore": {"name": "eat_hack Superstore (retail park)", "centre_aisles": 36, "banks": 2, "bays_per_side": 3,
                   "staffed": 10, "self": 20, "entrances": 2, "cafe": {"tables": 10, "seats_per_table": 4},
                   "depts": [(d, {}) for d in DEPTS if d != "grocery"], "left_zone_m": 20.0},
}
# Floor geometry (metres). assumption: UK superstore conventions; aisle walkway lets two trolleys pass.
GEO = {"walkway_m": 2.2, "gondola_side_depth_m": 0.6, "racetrack_m": 3.5, "cross_aisle_m": 3.0, "endcap_depth_m": 0.6,
       "wall_fixture_depth_m": 1.1, "front_band_m": 14.0, "back_of_house_m": 12.0, "wall_m": 0.3,
       "source": "assumption: centre walkway 2.2 m (two trolleys pass), 0.6 m per gondola side (0.45 m shelf + upright), 3.5 m "
                 "perimeter 'racetrack', 3.0 m cross-aisle between aisle banks, 0.6 m end caps, 1.1 m wall multidecks, 14 m front "
                 "band for checkouts + lobby + café, 12 m back of house (stockroom + goods-in). Not measured."}
LAYOUT_SOURCE = ("assumption (standard UK grocery layout, as used by the large multiples; not a cited planogram): entrance -> "
                 "fruit & veg + flowers (Underhill's 'decompression zone' idea: fresh, colourful, low-decision products first) -> "
                 "in-store bakery -> chilled perimeter 'racetrack' along the back and side walls (meat, fish, cheese & deli, dairy, "
                 "ready meals, desserts) -> numbered centre-store ambient aisles -> frozen towards the end (limits time out of the "
                 "freezer; same rule as store_xl layout_notes) -> beer, wine & spirits next to the tills (age checks at the till) "
                 "-> checkout bank across the front (staffed + self) -> exits with EAS security gates; café by the entrance; "
                 "stockroom + goods-in at the back.")

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
MIN_KEEP = 20         # assumption: a category with <20 clean candidates is dropped (not padded with junk)

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
    "frozen_meals_veg": ({"en:frozen-foods"}, set(X.SELECTORS[0][1]) | {"en:frozen-desserts"}, r"ice cream|sorbet|lolly|lollies"),
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
                          "en:dessert-mixes", "en:biscuits", "en:cakes"}, r"mix$|powder|christmas"),
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
                     r"crisps|cracker|pie\b|paste|pate|sushi"),
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
                      r"crisps|juice|smoothie|jam|soup|sauce|dried|\btin\b|canned|syrup|pur[eé]e|chips|fries|frozen|powder|pickled|crunch|bar\b|paste|chutney|dip\b|oil\b"),
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
                            r"drink|cordial|squash|coffee syrup|pancakes?$"),
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


if __name__ == "__main__" and "--pools" in sys.argv:
    df = pd.read_parquet(P("data/products/uk_products.parquet")).drop_duplicates("code")
    xl = json.load(open(P("data/products/catalog_xl.json")))
    cand = candidates(df, {p["code"] for p in xl})
    for c in XL_CATS + PRE_XL + POST_XL:
        ps = cand.get(c, [])
        print(f"{c:28s} {len(ps):5d}  e.g. " + " | ".join(str(p['name'])[:28] for p in sorted(ps, key=lambda r: -(X.num(r.get('scans')) or 0))[:4]))
    sys.exit(0)

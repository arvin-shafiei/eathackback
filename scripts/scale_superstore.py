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
# assumption: perimeter (chilled / produce / bakery) fixtures are sized for at most 4 facings per SKU on average; the
# centre store is fixed by the aisle count and runs higher. Without the cap the chilled racetrack would be ~165 m long.
F_PERIM = 4.0
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
              "staffed": 4, "self": 8, "entrances": 1, "cafe": None, "left_zone_m": 10.0,
              # metro: the alcohol-free range sits in the drinks aisle (too few SKUs for its own BWS bay)
              "depts": [(d, {"cats": ["soft_drinks", "water", "low_no_alcohol"]} if d == "drinks" else {}) for d in DEPTS if d not in ("grocery", "bws")]},
    "superstore": {"name": "eat_hack Superstore (retail park)", "centre_aisles": 36, "banks": 2, "bays_per_side": 8,
                   "staffed": 16, "self": 32, "entrances": 2, "cafe": {"tables": 16, "seats_per_table": 4},
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


# ================================================================ 1. catalog
XLD = json.load(open(P("data/store/store_xl.config.json")))["derivation"]
SC = {c: dict(v) for c, v in XLD["scales_from_curated"].items()}


def build_catalog():
    df = pd.read_parquet(P("data/products/uk_products.parquet")).drop_duplicates("code")
    offidx = {r["code"]: r for r in df.to_dict("records")}
    xl = json.load(open(P("data/products/catalog_xl.json")))
    have = {p["code"] for p in xl}
    bestsellers = X.load_bestseller_brands()
    curated_inc = sorted({X.norm(p["brand"]) for p in xl if p.get("curation") == "curated" and p["role"] == "incumbent"})
    cand = candidates(df, have)
    pool_sizes = {c: len(cand.get(c, [])) for c in XL_CATS + PRE_XL + POST_XL}
    dropped = {c: n for c, n in pool_sizes.items() if c not in XL_CATS and n < MIN_KEEP}
    new_cats = [c for c in PRE_XL + POST_XL if c not in dropped]
    for c in new_cats:
        SC[c] = pool_scales(cand[c])

    added, picks_by = [], {}
    for c in XL_CATS + new_cats:
        existing = [p for p in xl if p["category"] == c]
        target = XL_TOPUP_TARGET if c in XL_CATS else NEW_TARGET
        need = max(0, target - len(existing))
        picks_by[c] = pick(c, cand.get(c, []), need, existing, offidx, bestsellers, curated_inc) if need else []

    xl_upb = {c: tuple(v) for c, v in XLD["unit_price_band_gbp_per_kg"].items()}
    med_pack = {}
    for c in new_cats:
        packs = [t for t in (X.parse_qty(r.get("quantity"))[0] for r in picks_by[c]) if t]
        med_pack[c] = round(float(np.median(packs)), 0) if packs else DIMS[c][3]
    upb_new = {}
    for c in XL_CATS + new_cats:
        for r in picks_by[c]:
            if c in XL_CATS:
                p = X.build_product(r, c, XLD["price_model"], SC, xl_upb)  # XL rule set + XL price model, unchanged
                p["_cats"] = sorted(r["_tags"])
            else:
                p = build_new(r, c, med_pack)
            p["curation"] = CURATION
            p["_sub"] = r["_sub"]
            added.append(p)
        if c in new_cats:
            ups = [p["unit_price_gbp_per_kg"] for p in added if p["category"] == c and p.get("unit_price_gbp_per_kg")]
            # unit-price band for the frugal lens = 5th-95th percentile of this category's (assumed) £/kg
            upb_new[c] = (round(float(np.percentile(ups, 5)), 2), round(float(np.percentile(ups, 95)), 2)) if ups else (1.0, 10.0)
    upb = {**xl_upb, **upb_new}
    for p in added:
        if p["category"] in new_cats:
            regrade(p, p["category"], upb)
        p.pop("_cats", None)

    cat = []
    for p in xl + added:  # XL products: every original field unchanged; only shelf-dims fields are appended
        q = dict(p)
        sub = q.pop("_sub", None)
        if sub is None:
            sub = subtype(q["category"], set(X.split(offidx.get(q["code"], {}).get("categories"))))
        total = q.get("pack_total_g_or_ml") or X.parse_qty(q.get("quantity"))[0]
        q.update(pack_dims(q["category"], sub, total))
        q["subtype"] = sub
        cat.append(q)
    deriv = {"pool_sizes": pool_sizes, "dropped_categories": dropped, "scales": SC, "unit_price_band_gbp_per_kg": upb,
             "median_pack_new": med_pack, "beta_new": BETA_NEW, "unit_price_assumed": UNIT_PRICE_ASSUMED,
             "unit_price_sub": {f"{a}/{b}": v for (a, b), v in UNIT_PRICE_SUB.items()}, "categories": XL_CATS + new_cats}
    return cat, deriv


# ================================================================ 2. formats
def resolve_depts(spec, cats_present):
    out = []
    for did, ov in spec["depts"]:
        name, kind, fixture, cats, color, sign = DEPTS[did]
        d = {"id": did, "name": ov.get("name", name), "kind": ov.get("kind", kind), "fixture": ov.get("fixture", fixture),
             "cats": [c for c in ov.get("cats", cats) if c in cats_present], "color": color, "sign": ov.get("sign", sign)}
        if d["cats"]:
            out.append(d)
    return out


def alloc(total, weights, minimum=1):
    """Largest-remainder allocation of `total` integer units to weights, each >= minimum."""
    keys = list(weights)
    base = {k: minimum for k in keys}
    rest = total - minimum * len(keys)
    assert rest >= 0, (total, weights)
    w = sum(weights.values()) or 1
    raw = {k: rest * weights[k] / w for k in keys}
    for k in keys:
        base[k] += int(raw[k])
    left = total - sum(base.values())
    for k in sorted(keys, key=lambda k: -(raw[k] - int(raw[k])))[:left]:
        base[k] += 1
    return base


def unit_shape(fixture, spec):
    f = FIXTURES[fixture]
    if fixture == "produce_tables":
        bays = 2
    elif fixture == "freezer_doors":
        bays = max(2, int(spec["bays_per_side"] * 100 // f["bay_cm"]))  # doors that fit the same run length as a gondola side
    else:
        bays = spec["bays_per_side"]
    return {"bays": bays, "rows": f["rows"], "shelf_width_cm": bays * f["bay_cm"]}


def build_format(fid, spec, prods):
    by_cat = defaultdict(list)
    for p in prods:
        by_cat[p["category"]].append(p)
    depts = resolve_depts(spec, set(by_cat))
    need = {d["id"]: sum(p["width_cm"] for c in d["cats"] for p in by_cat[c]) for d in depts}
    centre = [d for d in depts if d["kind"] in ("centre", "frozen", "bws")]
    perim = [d for d in depts if d["kind"] not in ("centre", "frozen", "bws")]
    N = spec["centre_aisles"]
    cap = lambda d: unit_shape(d["fixture"], spec)["shelf_width_cm"] * FIXTURES[d["fixture"]]["rows"]  # noqa: E731
    # BWS (alcohol-free range only, ~18 SKUs) gets exactly one side; the rest share the remaining sides by need
    fixed = {d["id"]: 1 for d in centre if d["kind"] == "bws"}
    sides = {**fixed, **alloc(2 * N - len(fixed), {d["id"]: need[d["id"]] / cap(d) for d in centre if d["id"] not in fixed})}
    f_centre = sum(sides[d["id"]] * cap(d) for d in centre) / sum(need[d["id"]] for d in centre)
    # perimeter fixtures sized so their average facings match the centre store (same space-to-range ratio)
    f_perim = min(f_centre, F_PERIM)
    n_perim = {d["id"]: max(math.ceil(len(d["cats"]) / FIXTURES[d["fixture"]]["rows"]), round(need[d["id"]] * f_perim / cap(d))) for d in perim}

    # ---- units in walk order
    units, seq = [], 0
    for d in perim + centre:
        n = n_perim.get(d["id"]) or sides[d["id"]]
        for k in range(n):
            seq += 1
            sh = unit_shape(d["fixture"], spec)
            fx = FIXTURES[d["fixture"]]
            units.append({"id": f"{fid[0].upper()}{seq}", "department": d["id"], "zone": d["kind"], "fixture": d["fixture"],
                          "fixture_type": d["fixture"], "rows": fx["rows"], "bays": sh["bays"], "bay_width_cm": fx["bay_cm"],
                          "shelf_width_cm": sh["shelf_width_cm"], "shelf_depth_cm": fx["shelf_depth_cm"], "row_clear_cm": fx["row_clear_cm"],
                          "fridge": fx["fridge"], "freezer": fx["freezer"], **({"doors": sh["bays"]} if d["fixture"] == "freezer_doors" else {})})
    # ---- rows -> categories (sequential within a department, proportional to shelf need)
    slots = {}
    for d in depts:
        du = [u for u in units if u["department"] == d["id"]]
        rows = [(u, r) for u in du for r in range(1, u["rows"] + 1)]
        cw = {c: sum(p["width_cm"] for p in by_cat[c]) for c in d["cats"]}
        if len(rows) < len(cw):  # more categories than rows: keep the biggest (should not happen with the specs above)
            raise SystemExit(f"{fid}/{d['id']}: {len(rows)} rows < {len(cw)} categories")
        n_rows = alloc(len(rows), cw)
        i = 0
        for c in d["cats"]:
            for u, r in rows[i:i + n_rows[c]]:
                slots[f"{u['id']}-r{r}"] = {"unit": u, "row": r, "category": c, "products": [], "used": 0.0}
            i += n_rows[c]
        for u in du:
            cs = [slots[f"{u['id']}-r{r}"]["category"] for r in range(1, u["rows"] + 1)]
            u["categories"] = list(dict.fromkeys(cs))
            u["category"] = Counter(cs).most_common(1)[0][0]
    # ---- products -> slots (role row preference, balanced count, width check at 1 facing)
    unplaced = []
    for c, ps in by_cat.items():
        cs = [s for s in slots.values() if s["category"] == c]
        if not cs:
            unplaced += [p["code"] for p in ps]
            continue
        target = math.ceil(len(ps) / len(cs))
        base_n = len(ps) // len(cs)
        order = sorted(ps, key=lambda p: ({"incumbent": 0, "own_label": 1, "challenger": 2}.get(p["role"], 3), -(p.get("scans") or 0), p["code"]))
        for p in order:
            pref = [r for r in ROW_PREF.get(p["role"], ROW_PREF["challenger"])]
            W = lambda s: s["unit"]["shelf_width_cm"]  # noqa: E731
            ok = [s for s in cs if len(s["products"]) < target and s["used"] + p["width_cm"] <= W(s)]
            if not ok:
                ok = [s for s in cs if s["used"] + p["width_cm"] <= W(s)]
            if not ok:
                unplaced.append(p["code"])
                continue
            # balance first (every row gets at least floor(n/rows) SKUs so no shelf is left empty), then role row preference
            s = min(ok, key=lambda s: (len(s["products"]) >= base_n, pref.index(s["row"]) if s["row"] in pref else 9, len(s["products"]), s["unit"]["id"]))
            s["products"].append(p)
            s["used"] += p["width_cm"]
    # ---- facings fill + stock
    plano, fills = {}, []
    for sid, s in slots.items():
        u, ps = s["unit"], s["products"]
        W = u["shelf_width_cm"]
        fac = {p["code"]: 1 for p in ps}
        rem = W - sum(p["width_cm"] for p in ps)
        while True:
            cand = [p for p in ps if p["width_cm"] <= rem + 1e-9 and fac[p["code"]] < FMAX]
            if not cand:
                break
            p = min(cand, key=lambda p: (fac[p["code"]] / FACING_WEIGHT.get(p["role"], 1.0), -(p.get("scans") or 0), p["code"]))
            fac[p["code"]] += 1
            rem -= p["width_cm"]
        used = sum(fac[p["code"]] * p["width_cm"] for p in ps)
        depth_units = {p["code"]: max(1, int(u["shelf_depth_cm"] // p["depth_cm"])) for p in ps}
        capd = {p["code"]: fac[p["code"]] * depth_units[p["code"]] for p in ps}
        fills.append(used / W)
        plano[sid] = {"category": s["category"], "products": [p["code"] for p in ps], "facings": fac, "stock": dict(capd),
                      "capacity": capd, "width_cm": W, "filled_cm": round(used, 1), "fill_ratio": round(used / W, 3)}
    geo = place(fid, spec, units, depts, sides, n_perim)
    return units, depts, plano, fills, unplaced, f_centre, geo


def place(fid, spec, units, depts, sides, n_perim):
    """Floor coordinates (metres). Origin = front-left outside corner; x to the right, z towards the back wall; the
    front wall (z=0) holds entrances, exits and the checkout bank. Racetrack: entrance (front-left) -> fruit & veg (left
    side) -> bakery (back-left) -> chilled along the back wall (left->right) then down the right wall -> centre aisles
    -> frozen + BWS aisles at the front-right, next to the tills."""
    g = GEO
    N, banks, L = spec["centre_aisles"], spec["banks"], spec["bays_per_side"] * 1.0
    C = math.ceil(N / banks)
    pitch = 2 * g["gondola_side_depth_m"] + g["walkway_m"]
    left = spec["left_zone_m"]
    xc0 = left + g["racetrack_m"]
    centre_w = C * pitch + 2 * g["gondola_side_depth_m"]
    W = round(xc0 + centre_w + g["racetrack_m"] + g["wall_fixture_depth_m"] + g["wall_m"], 1)
    zf0 = g["front_band_m"] + g["racetrack_m"] + g["endcap_depth_m"]
    bank_z = []  # (z0, z1) per bank, bank 0 = front
    z = zf0
    for b in range(banks):
        bank_z.append((round(z, 2), round(z + L, 2)))
        z += L + 2 * g["endcap_depth_m"] + g["cross_aisle_m"]
    z_centre_end = z - g["cross_aisle_m"] - g["endcap_depth_m"]
    D0 = z_centre_end + g["endcap_depth_m"] + g["racetrack_m"] + g["wall_fixture_depth_m"] + g["wall_m"]
    # perimeter chilled run length needed vs available on back + right walls; extra depth becomes promo/seasonal floor
    chilled = [u for u in units if u["zone"] == "perimeter"]
    run_len = sum(u["bays"] * u["bay_width_cm"] / 100 for u in chilled)
    back_avail = W - left - g["wall_fixture_depth_m"] - g["wall_m"]
    right_avail = lambda D: D - g["wall_m"] - g["wall_fixture_depth_m"] - g["front_band_m"] - g["racetrack_m"]  # noqa: E731
    D = D0
    if run_len > back_avail + right_avail(D0):
        D = D0 + (run_len - back_avail - right_avail(D0)) + 0.5
    D = round(D, 1)
    promo_floor = max(0.0, round(D - D0, 1))

    # centre aisles: numbered back bank first (1..C, left->right), front bank last, so the highest numbers (frozen,
    # BWS) sit at the front-right next to the tills
    order_banks = list(range(banks - 1, -1, -1))
    aisle_xy = {}
    for k in range(1, N + 1):
        b = order_banks[(k - 1) // C]
        j = (k - 1) % C
        x_aisle = xc0 + j * pitch + 2 * g["gondola_side_depth_m"] + g["walkway_m"] / 2
        z0, z1 = bank_z[b]
        aisle_xy[k] = {"x": round(x_aisle, 2), "z0": z0, "z1": z1, "bank": "back" if (banks > 1 and b == banks - 1) else "front", "column": j + 1}
    side_i = 0
    for u in units:
        if u["zone"] in ("centre", "frozen", "bws"):
            k, side = side_i // 2 + 1, "LR"[side_i % 2]
            side_i += 1
            a = aisle_xy[k]
            dx = g["walkway_m"] / 2 + g["gondola_side_depth_m"] / 2
            u.update({"aisle": k, "aisle_number": k, "side": side, "bay": 0, "perimeter": False,
                      "x": round(a["x"] + (-dx if side == "L" else dx), 2), "z": round((a["z0"] + a["z1"]) / 2, 2),
                      "facing": "+x" if side == "L" else "-x", "length_m": L})
    # perimeter: produce tables grid (left zone, front), bakery (left zone, back), food to go along the front band by
    # the entrance, chilled along back wall then right wall, express wall freezer at the right-front by the tills
    extra = N
    pt = [u for u in units if u["zone"] == "produce"]
    cols = max(1, int(left // 4.0))
    for i, u in enumerate(pt):
        u.update({"x": round(1.0 + 2.0 + (i % cols) * 4.0, 2), "z": round(g["front_band_m"] + 2.5 + (i // cols) * 3.0, 2), "facing": "-z", "length_m": 2.4})
    produce_z1 = g["front_band_m"] + 2.5 + math.ceil(len(pt) / cols) * 3.0 + 1.0 if pt else g["front_band_m"]
    bk = [u for u in units if u["zone"] == "bakery"]
    for i, u in enumerate(bk):
        L_u = u["bays"] * u["bay_width_cm"] / 100
        u.update({"x": round(g["wall_m"] + g["wall_fixture_depth_m"] / 2, 2), "z": round(produce_z1 + 1.0 + i * L_u + L_u / 2, 2), "facing": "+x", "length_m": L_u})
    bakery_z1 = produce_z1 + 1.0 + sum(u["bays"] * u["bay_width_cm"] / 100 for u in bk) + 1.0
    ftg = [u for u in units if u["zone"] == "food_to_go"]
    x_e1 = 2.0 + (spec["cafe"] and 16.0 or 0.0) + 2.0  # entrance E1 just right of the café (front-left)
    for i, u in enumerate(ftg):
        L_u = u["bays"] * u["bay_width_cm"] / 100
        u.update({"x": round(x_e1 + 4.0 + i * L_u + L_u / 2, 2), "z": round(g["front_band_m"] - g["wall_fixture_depth_m"] / 2, 2), "facing": "+z", "length_m": L_u})
    xb = left
    zr = D - g["wall_m"] - g["wall_fixture_depth_m"]
    for u in chilled:
        L_u = u["bays"] * u["bay_width_cm"] / 100
        if xb + L_u <= W - g["wall_m"] - g["wall_fixture_depth_m"] + 1e-6:
            u.update({"x": round(xb + L_u / 2, 2), "z": round(D - g["wall_m"] - g["wall_fixture_depth_m"] / 2, 2), "facing": "-z", "wall": "back", "length_m": L_u})
            xb += L_u
        else:
            u.update({"x": round(W - g["wall_m"] - g["wall_fixture_depth_m"] / 2, 2), "z": round(zr - L_u / 2, 2), "facing": "-x", "wall": "right", "length_m": L_u})
            zr -= L_u
    for u in units:
        if "aisle" not in u:
            extra += 1
            u.update({"aisle": extra, "aisle_number": None, "side": "L", "bay": 0, "perimeter": True})
        u.setdefault("facing", "-x")
    return {"W": W, "D": D, "D0": round(D0, 1), "promo_floor_m": promo_floor, "left": left, "xc0": xc0, "pitch": pitch, "C": C,
            "bank_z": bank_z, "aisle_xy": aisle_xy, "produce_z1": round(produce_z1, 2), "bakery_z1": round(bakery_z1, 2), "x_e1": x_e1,
            "chilled_run_m": round(run_len, 1)}


# ================================================================ 3. config assembly
def rect(x0, z0, x1, z1):
    return {"x0": round(min(x0, x1), 2), "z0": round(min(z0, z1), 2), "x1": round(max(x0, x1), 2), "z1": round(max(z0, z1), 2)}


def unit_rect(u):
    L, dpt = u.get("length_m", 3.0), FIXTURES[u["fixture"]]["shelf_depth_cm"] / 100 + 0.15
    if u["facing"] in ("+x", "-x"):
        return rect(u["x"] - dpt / 2, u["z"] - L / 2, u["x"] + dpt / 2, u["z"] + L / 2)
    return rect(u["x"] - L / 2, u["z"] - dpt / 2, u["x"] + L / 2, u["z"] + dpt / 2)


def bbox(rs, pad=0.0):
    return rect(min(r["x0"] for r in rs) - pad, min(r["z0"] for r in rs) - pad, max(r["x1"] for r in rs) + pad, max(r["z1"] for r in rs) + pad)


def build_config(fid, spec, units, depts, plano, geo, prods_by_code, f_centre):
    g = GEO
    W, D = geo["W"], geo["D"]
    # ---- departments (floor rectangles)
    dep_out = []
    for d in depts:
        du = [u for u in units if u["department"] == d["id"]]
        rs = [unit_rect(u) for u in du]
        if d["kind"] == "produce":
            zone = rect(0.3, g["front_band_m"], geo["left"], geo["produce_z1"])
        elif d["kind"] == "bakery":
            zone = rect(0.3, geo["produce_z1"], geo["left"], max(geo["bakery_z1"], max(r["z1"] for r in rs)))
        elif d["kind"] in ("centre", "frozen", "bws"):
            zone = bbox(rs, 0.2)
            zone = rect(zone["x0"], zone["z0"] - g["endcap_depth_m"], zone["x1"], zone["z1"] + g["endcap_depth_m"])
        else:  # wall fixtures: include the racetrack strip in front of them
            zone = bbox(rs, 0.0)
            if all(u.get("wall") == "back" for u in du):
                zone = rect(zone["x0"], zone["z0"] - g["racetrack_m"], zone["x1"], zone["z1"])
            elif all(u.get("wall") == "right" for u in du):
                zone = rect(zone["x0"] - g["racetrack_m"], zone["z0"], zone["x1"], zone["z1"])
            elif d["kind"] == "food_to_go":
                zone = rect(zone["x0"], zone["z0"] - 1.5, zone["x1"], zone["z1"])
        dep_out.append({"id": d["id"], "name": d["name"], "zone": zone, "zone_kind": d["kind"], "floor_color": d["color"],
                        "sign_text": d["sign"], "aisle_numbers": sorted({u["aisle_number"] for u in du if u.get("aisle_number")}),
                        "fixture_type": d["fixture"], "categories": d["cats"], "units": [u["id"] for u in du]})
    # flowers: a sub-zone of fruit & veg by the entrance (no OFF products; cut flowers are not food)
    fv = next((x for x in dep_out if x["id"] == "fruit_veg"), None)
    if fv:
        fv["sub_zones"] = [{"id": "flowers", "name": "flowers", "zone": rect(fv["zone"]["x0"], fv["zone"]["z0"], fv["zone"]["x0"] + min(4.0, geo["left"] - 0.6), fv["zone"]["z0"] + 2.0),
                            "note": "cut flowers / plants stand at the entrance; no OFF products (not food), shown as a fixture only"}]
    # ---- aisle signage + end caps (centre aisles only)
    signage, end_caps = [], []
    for k, a in geo["aisle_xy"].items():
        au = [u for u in units if u.get("aisle_number") == k]
        cats = list(dict.fromkeys(c for u in au for c in u["categories"]))
        dnames = list(dict.fromkeys(next(d["name"] for d in depts if d["id"] == u["department"]) for u in au))
        signage.append({"aisle_number": k, "sign_text": f"{k} · " + " · ".join(dnames), "categories": cats,
                        "departments": list(dict.fromkeys(u["department"] for u in au)), "bank": a["bank"],
                        "x": a["x"], "z": round(a["z0"] - g["endcap_depth_m"] - 0.4, 2), "hang_height_m": 2.8})
    # gondola runs: one double-sided run between neighbouring aisles; each run end facing a racetrack/cross aisle is an
    # end cap (promo bay). Planogram for end caps = secondary placement of the adjacent aisle's lead lines.
    runs = {}
    for k, a in geo["aisle_xy"].items():
        for side, dxr in (("L", -1), ("R", 1)):
            run_x = round(a["x"] + dxr * (g["walkway_m"] / 2 + g["gondola_side_depth_m"]), 2)
            runs.setdefault((a["bank"], run_x), set()).add(k)
    ec_w = 120  # assumption: end-cap promo bay 1.2 m wide, 5 shelves
    ec_i = 0
    for (bank, run_x), aisles in sorted(runs.items(), key=lambda t: (t[0][0], t[0][1])):
        a0 = geo["aisle_xy"][min(aisles)]
        for end in ("front", "back"):
            ec_i += 1
            z = a0["z0"] - g["endcap_depth_m"] / 2 if end == "front" else a0["z1"] + g["endcap_depth_m"] / 2
            src_units = [u for u in units if u.get("aisle_number") in aisles]
            leads = sorted({c for u in src_units for c in plano.get(f"{u['id']}-r2", {}).get("products", [])},
                           key=lambda c: (-(prods_by_code[c].get("scans") or 0), c))
            ps, rem, fac = [], ec_w, {}
            for c in leads:
                w = prods_by_code[c]["width_cm"]
                if len(ps) >= 3 or w > rem:
                    continue
                ps.append(c)
                fac[c] = 1
                rem -= w
            while ps:
                c = min((c for c in ps if prods_by_code[c]["width_cm"] <= rem and fac[c] < FMAX), key=lambda c: (fac[c], c), default=None)
                if c is None:
                    break
                fac[c] += 1
                rem -= prods_by_code[c]["width_cm"]
            filled = sum(fac[c] * prods_by_code[c]["width_cm"] for c in ps)
            end_caps.append({"id": f"EC{ec_i}", "bank": bank, "end": end, "adjacent_aisles": sorted(aisles), "x": run_x, "z": round(z, 2),
                             "width_cm": ec_w, "rows": 5, "promo": True,
                             "planogram": {"products": ps, "facings": fac, "rows_used": "all 5 rows (block display)",
                                           "fill_ratio_per_row": round(filled / ec_w, 3),
                                           "rule": "assumption: end cap = secondary placement of the top-3 (OFF scans) eye-row lines of the adjacent aisle(s); stock not separately counted"}})
    # ---- checkouts across the front, entrances/exits, gates, café, stockroom, goods-in, walls
    nS, nK = spec["staffed"], spec["self"]
    pitch_t, kp = 2.9, 1.45
    ftg_x1 = max([u["x"] + u["length_m"] / 2 for u in units if u["zone"] == "food_to_go"] or [geo["x_e1"] + 4])
    x0 = ftg_x1 + 3.0
    zc = round(g["front_band_m"] / 2 + 1.0, 2)
    checkouts = [{"id": f"T{i + 1}", "type": "staffed", "bank": "tills", "x": round(x0 + (i + 0.5) * pitch_t, 2), "z": zc, "lanes": 1} for i in range(nS)]
    xs0 = x0 + nS * pitch_t + 2.0
    cols = math.ceil(nK / 2)
    checkouts += [{"id": f"S{i + 1}", "type": "self", "bank": "self", "x": round(xs0 + (i % cols + 0.5) * kp, 2),
                   "z": round(zc + (-1.35 if i // cols == 0 else 1.35), 2), "lanes": 1} for i in range(nK)]
    x_till_end = xs0 + cols * kp
    ents = [{"id": "E1", "x": round(geo["x_e1"], 2), "z": 0.0, "note": "main entrance, front-left, into fruit & veg"}]
    exits = [{"id": "X1", "x": round(min(W - 3.0, x_till_end + 3.0), 2), "z": 0.0}]
    if spec["entrances"] > 1:
        ents.append({"id": "E2", "x": round(W - 4.0, 2), "z": 0.0, "note": "second entrance, front-right (car park side), by BWS/frozen"})
        exits.insert(0, {"id": "X0", "x": round(geo["x_e1"] + 3.0, 2), "z": 0.0})
    gates = [{"id": f"G{e['id']}{s}", "exit": e["id"], "x": round(e["x"] + dx, 2), "z": 1.2, "type": "EAS pedestal"} for e in exits for s, dx in (("a", -1.0), ("b", 1.0))]
    cafe = None
    if spec["cafe"]:
        cw, cd = 16.0, g["front_band_m"] - 1.0
        tables = [{"x": round(1.5 + (i % 5) * 3.0 + 1.0, 2), "z": round(2.0 + (i // 5) * 4.0 + 2.0, 2)} for i in range(spec["cafe"]["tables"])]
        seats = [{"x": round(t["x"] + dx, 2), "z": round(t["z"] + dz, 2), "table": ti} for ti, t in enumerate(tables)
                 for dx, dz in ((-0.6, 0), (0.6, 0), (0, -0.6), (0, 0.6))][: spec["cafe"]["tables"] * spec["cafe"]["seats_per_table"]]
        cafe = {"x": round(0.3 + cw / 2, 2), "z": round(0.3 + cd / 2, 2), "w": cw, "d": cd, "zone": rect(0.3, 0.3, 0.3 + cw, 0.3 + cd),
                "tables": len(tables), "table_positions": tables, "seats": seats, "counter": {"x": round(0.3 + cw / 2, 2), "z": round(cd - 0.8, 2)},
                "source": "assumption: in-store café by the main entrance (common in UK superstores); 10 tables x 4 seats"}
    stock = {"x": round(W / 2, 2), "z": round(D + g["back_of_house_m"] / 2, 2), "w": round(W - 2 * g["wall_m"], 2), "d": g["back_of_house_m"],
             "zone": rect(0, D, W, D + g["back_of_house_m"]),
             "doors": [{"x": round(W * 0.35, 2), "z": D}, {"x": round(W * 0.7, 2), "z": D}],
             "source": "assumption: back-of-house stockroom behind the back-wall chillers, two staff doors through the chilled run"}
    goods_in = {"x": round(W - 6.0, 2), "z": round(D + g["back_of_house_m"], 2), "dock_doors": 2 if fid == "superstore" else 1,
                "zone": rect(W - 12.0, D + g["back_of_house_m"] - 4.0, W, D + g["back_of_house_m"]),
                "source": "assumption: rear service yard with dock leveller(s); daily chilled delivery (data/ops/params.json lead_time_days_chilled=1)"}
    door_gaps = [(e["x"] - 1.5, e["x"] + 1.5) for e in ents + exits]
    walls, x = [], 0.0
    for a, b in sorted(door_gaps):
        if a > x:
            walls.append({"x0": round(x, 2), "z0": 0.0, "x1": round(a, 2), "z1": 0.0, "kind": "exterior_front"})
        x = max(x, b)
    walls.append({"x0": round(x, 2), "z0": 0.0, "x1": W, "z1": 0.0, "kind": "exterior_front"})
    walls += [{"x0": W, "z0": 0.0, "x1": W, "z1": round(D + g["back_of_house_m"], 2), "kind": "exterior_side"},
              {"x0": 0.0, "z0": 0.0, "x1": 0.0, "z1": round(D + g["back_of_house_m"], 2), "kind": "exterior_side"},
              {"x0": 0.0, "z0": round(D + g["back_of_house_m"], 2), "x1": W, "z1": round(D + g["back_of_house_m"], 2), "kind": "exterior_back"},
              {"x0": 0.0, "z0": D, "x1": W, "z1": D, "kind": "stockroom_partition", "doors": stock["doors"]}]
    # department divisions: an end panel between neighbouring wall departments + the checkout line rail
    dividers = []
    prev = None
    for u in [u for u in units if u["zone"] in ("perimeter", "food_to_go")]:
        if prev and prev["department"] != u["department"]:
            dividers.append({"between": [prev["department"], u["department"]], "x": round((prev["x"] + u["x"]) / 2, 2), "z": round((prev["z"] + u["z"]) / 2, 2), "kind": "end_panel"})
        prev = u
    dividers.append({"between": ["shop_floor", "checkouts"], "x0": round(x0 - 1.0, 2), "x1": round(x_till_end + 1.0, 2), "z": round(g["front_band_m"] - 0.3, 2), "kind": "checkout_rail"})
    # meal deal
    md = meal_deal(units, plano, prods_by_code)
    # summary numbers
    centre_u = [u for u in units if u.get("aisle_number")]
    return {
        "name": spec["name"], "format": fid,
        "coordinate_system": "metres; origin = front-left outside corner; x to the right, z towards the back wall; front wall z=0 holds entrances, exits and the checkout bank (real UK layout, NOT the web/store_xl grid where the tills are behind the aisles). Each unit has x,z (centre of its shelf face run), facing and length_m.",
        "footprint_m": {"w": W, "d": D, "back_of_house_d": g["back_of_house_m"], "sales_floor_m2": round(W * D), "promo_seasonal_floor_depth_m": geo["promo_floor_m"]},
        "aisles": max(u["aisle"] for u in units), "centre_aisles": spec["centre_aisles"],
        "aisles_note": "'aisle' on every unit keeps the store_xl schema (perimeter units get pseudo-aisle numbers after the centre aisles, aisle_number=null); renderers should place units by x/z/facing",
        "rows_per_unit": 5, "row_names": ROW_NAMES,
        "notice_row_map": {"1": "top", "2": "eye", "3": "bottom", "4": "bottom", "5": "bottom",
                           "source": "assumption: sim/notice.py has alphas for top/eye/bottom only; rows below eye level get the bottom alpha (same conservative rule as store_xl)"},
        "products_per_slot": round(np.mean([len(s["products"]) for s in plano.values()]), 1),
        "products_per_slot_note": "variable per slot (shelves are filled by width); this is the mean",
        "units": units, "departments": dep_out, "aisle_signage": signage, "end_caps": end_caps,
        "entrance": {"x": ents[0]["x"], "z": ents[0]["z"]}, "entrances": ents, "exits": exits, "security_gates": gates,
        "checkout": {"x": round((x0 + x_till_end) / 2, 2), "z": zc}, "checkouts": checkouts,
        "checkout_counts": {"staffed": nS, "self": nK,
                            "source": ("data/ops/params.json checkout_lanes_needed_example: ~10 staffed-lane equivalents at the Saturday 11:00 peak (294 arrivals/h, derived from Gruen & Corsten 2008 + DfT NTS); self-checkout count is an assumption (2 per staffed lane; one attendant per ~5 kiosks, params sco_terminals_per_attendant)"
                                       if fid == "superstore" else "assumption: format convention (express 2+4, metro 4+8); scaled down from the superstore's params-derived 10 staffed lanes")},
        "cafe": cafe, "stockroom": stock, "goods_in": goods_in, "walls": walls, "dividers": dividers, "meal_deal": md,
        "fixtures": FIXTURES, "geometry": GEO,
        "aisle_widths": {"walkway_m": GEO["walkway_m"], "cross_aisle_m": GEO["cross_aisle_m"], "racetrack_m": GEO["racetrack_m"],
                         "gondola_depth_m": 2 * GEO["gondola_side_depth_m"], "unit_len_m": spec["bays_per_side"] * 1.0, "source": GEO["source"]},
        "adjacency": {"walk_order": [d["id"] for d in depts], "source": LAYOUT_SOURCE},
        "layout_notes": [
            f"{len(units)} units: {len(centre_u)} centre-aisle sides ({spec['centre_aisles']} numbered aisles x 2) + {len(units) - len(centre_u)} perimeter fixtures (produce tables, bakery, food-to-go, chilled racetrack{', wall freezer' if fid == 'express' else ''}).",
            f"centre store space is fixed by the aisle count; perimeter fixtures are sized so their mean facings match the centre (space-to-range ratio {f_centre:.2f} shelf-cm per single-facing-cm).",
            "rows are assigned to categories within each department in walk order, proportional to the category's total single-facing width (sequential blocking); products go to rows by role preference (incumbent eye, own-label low, challenger top/middle).",
            "the range is ~10% of a real superstore's (~25-40k SKUs, assumption), so aisles are short (3 m runs) to keep facings plausible; set FORMATS[...]['bays_per_side'] to lengthen them (facings scale up proportionally)."
            + (f" Extra {geo['promo_floor_m']} m of depth was added so the chilled racetrack fits on the back + right walls; it becomes promo/seasonal floor between the aisles and the back wall." if geo["promo_floor_m"] > 0 else ""),
        ],
        "stock_rules": {"facings": f"fill each shelf: start every SKU at 1 facing, then repeatedly add a facing to the SKU with the lowest facings/weight (weight incumbent {FACING_WEIGHT['incumbent']}, own_label {FACING_WEIGHT['own_label']}, challenger {FACING_WEIGHT['challenger']}; assumption: leaders hold more facings) while it still fits the remaining width; max {FMAX} facings (assumption)",
                        "depth_units_per_facing": "floor(shelf_depth_cm / pack depth_cm), min 1 (pack dims are labelled assumptions in the catalog)",
                        "capacity": "facings x depth_units_per_facing", "stock": "starts at capacity (store opens fully faced up)",
                        "fill_ratio": "per slot sum(facings x width_cm) / shelf width_cm"},
    }


MD_SNACK = {"crisps_savoury": 55, "snack_bars": 60, "confectionery_sweets": 60, "biscuits_chocolate": 60, "nuts_dried_fruit": 60,
            "yoghurt": 200, "chilled_desserts": 150, "fresh_produce": 200, "dips_salads_deli": 150, "cheese": 50, "cooked_meats_deli": 100}
MD_DRINK = {"soft_drinks": 500, "water": 750, "juice_smoothies": 400, "plant_milk_dairy_alt": 330, "milk_butter_eggs": 500}


def meal_deal(units, plano, prods_by_code):
    """assumption: UK meal deal = main + snack + drink (data/sales/uk_bestsellers.csv meal_deal rows: Tesco Clubcard
    Unpacked #1 main/snack/drink; r/CasualUK 1bc79kh). Eligibility by category + single-item size (OFF quantity)."""
    codes = {c for s in plano.values() for c in s["products"]}
    out = {"main": [], "snack": [], "drink": []}
    for c in sorted(codes):
        p = prods_by_code[c]
        _, item = X.parse_qty(p.get("quantity"))
        if p["category"] == "food_to_go":
            out["main"].append(c)
        elif p["category"] in MD_SNACK and item and item <= MD_SNACK[p["category"]]:
            out["snack"].append(c)
        elif p["category"] in MD_DRINK and item and item <= MD_DRINK[p["category"]] and p["category"] != "milk_butter_eggs" or (
                p["category"] == "milk_butter_eggs" and p.get("subtype") == "milk" and item and item <= 500):
            out["drink"].append(c)
    return {"stand_units": [u["id"] for u in units if u["department"] == "food_to_go"], "eligible": out,
            "counts": {k: len(v) for k, v in out.items()}, "price_gbp": 3.85,
            "price_source": "data/personas/lens/meal_deal_office.json budget_source (Reddit corpus: '£3.75 in Sainsburys ... £3.80 in Tesco')",
            "rule": "assumption: main = any food_to_go SKU; snack = single item <= the size cap of its category " + json.dumps(MD_SNACK)
                    + "; drink = single item <= " + json.dumps(MD_DRINK) + " (flavoured milk only for milk_butter_eggs). Sizes from OFF quantity; items with unknown size are not eligible."}


# ================================================================ 4. format ranges
def norm_log_scans(ps):
    m = max([math.log1p(p.get("scans") or 0) for p in ps] or [1]) or 1
    return {p["code"]: math.log1p(p.get("scans") or 0) / m for p in ps}


def range_for(fid, cat):
    """assumption (labelled): express = top EXPRESS_QUOTA[c] per category by 0.5*popularity + 0.5*meal_deal_office lens
    (convenience = meal-deal + top-up missions); metro = top 40% per category by 0.6*popularity + 0.4*(incumbent or
    own-label) -> now: 40% of each role per category by popularity (keeps the role mix). popularity = log1p(OFF scans) normalised within the category (OFF scans as a popularity proxy)."""
    if fid == "superstore":
        return list(cat)
    out = []
    by = defaultdict(list)
    for p in cat:
        by[p["category"]].append(p)
    for c, ps in by.items():
        pop = norm_log_scans(ps)
        if fid == "express":
            n = EXPRESS_QUOTA.get(c, 0)
            key = lambda p: -(0.5 * pop[p["code"]] + 0.5 * p["lens_grades"]["meal_deal_office"]["score"])  # noqa: E731
        else:  # metro: 40% of each role within the category (keeps the challenger/incumbent/own-label mix), by popularity
            for role in ("incumbent", "own_label", "challenger"):
                rp = [p for p in ps if p["role"] == role]
                out += sorted(rp, key=lambda p: (-pop[p["code"]], p["code"]))[:max(1 if rp else 0, round(METRO_SHARE * len(rp)))]
            continue
        out += sorted(ps, key=lambda p: (key(p), p["code"]))[:n]
    return out


# ================================================================ 5. stores.json
def build_stores():
    params = json.load(open(P("data/ops/params.json")))["params"]
    hours = params["weekday_shopping_trip_start_share_by_hour"]["value"]
    mix = params["mission_mix_by_daypart"]["value"]
    acc, tot = Counter(), 0.0
    for key, m in mix.items():
        a, b = (int(x) for x in key.split("-"))
        sh = sum(hours[a:b])
        tot += sh
        for k, v in m.items():
            acc[k] += sh * v
    base = {k: round(v / tot, 4) for k, v in acc.items()}
    personas = {}
    import glob
    for f in sorted(glob.glob(P("data/personas/lens/*.json"))):
        d = json.load(open(f))
        personas[d["archetype"]] = d["mission"]
    STORES = [
        {"id": "express_office", "name": "Ludgate Lane Express", "context": "express · office district (City fringe, weekday lunch trade)", "format": "express",
         "customers_per_week": (4000, "data/ops/params.json store_customers_per_week range low end: Gruen & Corsten (2008) 'smaller format' 4,000 customers/week (US illustrative; medium confidence)"),
         "hour_multipliers": ({"07-09": 1.6, "12-14": 2.5, "17-18": 1.4, "19-22": 0.5}, "assumption: office district: lunch (meal deal) and commute peaks; the NTS commute peak at 17:00 (params commute_trip_start_share_17h) anchors the evening bump"),
         "day_multipliers": ({"Sat": 0.35, "Sun": 0.25}, "assumption: offices shut at weekends; weekday NTS day shares otherwise"),
         "mission_mult": ({"meal_deal": 4.0, "top_up": 1.2, "weekly_shop": 0.1, "treat": 1.0, "gym": 1.5}, "assumption: an office-district express is a meal-deal + top-up store; almost no weekly shops"),
         "persona_mult": ({"habit_loyalist_shrinkflation_angry": 1.2, "upf_avoider_parent": 0.5, "glp1_small_appetite": 1.3}, "assumption: office workers are habit-led at lunch; fewer parents shopping for kids; GLP-1 users buy small portions at lunch")},
        {"id": "express_campus", "name": "Quad Express", "context": "express · university campus (term time)", "format": "express",
         "customers_per_week": (4000, "data/ops/params.json store_customers_per_week range low end (Gruen & Corsten 2008 smaller format)"),
         "hour_multipliers": ({"07-09": 0.5, "12-14": 1.8, "19-22": 2.0}, "assumption: students shop late; lunch peak between lectures"),
         "day_multipliers": ({}, "NTS day shares (params shopping_trips_day_multiplier) unchanged"),
         "mission_mult": ({"meal_deal": 2.0, "top_up": 1.3, "weekly_shop": 0.4, "treat": 1.5, "gym": 2.0}, "assumption: students buy meal deals, top-ups, treats and gym food; few big shops in an express"),
         "persona_mult": ({"frugal_unit_price": 2.0, "novelty_seeker_tiktok": 1.5, "vegan_ethical": 1.5, "upf_avoider_parent": 0.2, "habit_loyalist_shrinkflation_angry": 0.6, "ai_delegator": 0.5},
                          "assumption: student budgets (frugal), TikTok-driven trial, higher vegan share; few parents; fewer habit loyalists")},
        {"id": "metro_high_street", "name": "Northgate Metro", "context": "metro · high street (mixed office + residential)", "format": "metro",
         "customers_per_week": (10900, "data/ops/params.json store_customers_per_week: Gruen & Corsten (2008) supermarket cost example, 10,900 customers/week (US illustrative; medium confidence)"),
         "hour_multipliers": ({"12-14": 1.3, "17-18": 1.2}, "assumption: high-street lunch and after-work bumps on top of the NTS curve"),
         "day_multipliers": ({}, "NTS day shares unchanged"),
         "mission_mult": ({"meal_deal": 1.5, "top_up": 1.3, "weekly_shop": 0.7, "treat": 1.0, "gym": 1.0}, "assumption: high-street metro skews to top-up and lunch vs the params baseline"),
         "persona_mult": ({}, "no adjustment: params baseline mission mix carries the persona split")},
        {"id": "superstore_retail_park", "name": "Kingsmead Superstore", "context": "superstore · retail park (car-borne family big shop)", "format": "superstore",
         "customers_per_week": (20000, "assumption: ~2x the Gruen & Corsten (2008) 10,900/week supermarket example for a large retail-park superstore; no UK store-level footfall source fetched (data/ops/evidence.md gaps)"),
         "hour_multipliers": ({"15-17": 1.2}, "assumption: after-school family trips (NTS escort-education peak 15:00, params school_escort_trip_start_share_15h)"),
         "day_multipliers": ({"Sat": 1.15}, "assumption: retail-park Saturday skew on top of the NTS Saturday share (1.45x average day)"),
         "mission_mult": ({"meal_deal": 0.4, "top_up": 0.7, "weekly_shop": 1.8, "treat": 1.3, "gym": 0.8}, "assumption: car-borne big shop; 'treat' includes the family after-school trip (params after_school_treat_uplift)"),
         "persona_mult": ({"upf_avoider_parent": 1.6, "frugal_unit_price": 1.2, "meal_deal_office": 0.5}, "assumption: families with children dominate retail-park big shops; value-seeking on big baskets")},
    ]
    out = []
    for s in STORES:
        mm, mm_src = s["mission_mult"]
        raw = {k: base.get(k, 0) * mm.get(k, 1.0) for k in base}
        t = sum(raw.values())
        mission = {k: round(v / t, 4) for k, v in raw.items()}
        n_by_mission = Counter(personas.values())
        pm, pm_src = s["persona_mult"]
        pw = {a: mission.get(m, 0) / n_by_mission[m] * pm.get(a, 1.0) for a, m in personas.items()}
        t = sum(pw.values())
        pw = {a: round(v / t, 4) for a, v in sorted(pw.items(), key=lambda kv: -kv[1])}
        cpw, cpw_src = s["customers_per_week"]
        hm, hm_src = s["hour_multipliers"]
        dm, dm_src = s["day_multipliers"]
        out.append({
            "id": s["id"], "name": s["name"], "name_note": "fictional store name", "context": s["context"], "format": s["format"],
            "config": f"data/store/formats/{s['format']}.config.json", "planogram": f"data/store/formats/planogram_{s['format']}.json",
            "customers_per_week": {"value": cpw, "source": cpw_src},
            "footfall_curve": {"hour_shares_ref": "data/ops/params.json#params.weekday_shopping_trip_start_share_by_hour (DfT NTS 2025 NTS0502b, shopping)",
                               "day_shares_ref": "data/ops/params.json#params.shopping_trips_day_multiplier (DfT NTS0504b)",
                               "hour_multipliers": hm, "hour_multipliers_source": hm_src, "day_multipliers": dm, "day_multipliers_source": dm_src,
                               "formula": "arrivals/h = customers_per_week x day_share x hour_share x hour_multiplier x day_multiplier, renormalised so the week sums to customers_per_week"},
            "mission_mix": mission,
            "mission_mix_source": {"baseline": base, "baseline_source": "derived: params mission_mix_by_daypart (assumption, low confidence) weighted by the NTS hour shares of each daypart window 08-22",
                                   "multipliers": mm, "multipliers_source": mm_src,
                                   "note": "'treat' covers the family after-school trip (params 15-17 window); missions use the params keys so the ops engine can consume them"},
            "persona_weights": pw,
            "persona_weights_source": {"rule": "derived: weight(persona) = mission_mix[persona.mission] / (number of personas with that mission) x multiplier, renormalised. persona.mission from data/personas/lens/<archetype>.json",
                                       "multipliers": pm, "multipliers_source": pm_src,
                                       "dominant": list(pw)[:3]},
        })
    return {"_doc": "Named example stores (fictional names, real-ish UK contexts). Each points to a format config + planogram in data/store/formats/. Every number has a source or 'assumption:'. Built by scripts/scale_superstore.py.",
            "stores": out}


# ================================================================ 6. main + validate
def dump(obj, path, compact=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)


CACHE = os.environ.get("SUPERSTORE_DERIV_CACHE", "/tmp/scale_superstore_deriv.json")


def main():
    if "--layout-only" in sys.argv and os.path.exists(CACHE):  # dev: reuse the built catalog, rebuild formats only
        cat, deriv = json.load(open(P("data/products/catalog_superstore.json"))), json.load(open(CACHE))
    else:
        cat, deriv = build_catalog()
        dump(cat, P("data/products/catalog_superstore.json"), compact=True)
        json.dump(deriv, open(CACHE, "w"))
    by_code = {p["code"]: p for p in cat}
    summary = {"catalog": {"products": len(cat), "categories": len({p['category'] for p in cat}),
                           "by_curation": dict(Counter(p["curation"] for p in cat)), "by_role": dict(Counter(p["role"] for p in cat)),
                           "by_category": dict(sorted(Counter(p["category"] for p in cat).items())),
                           "pool_sizes": deriv["pool_sizes"], "dropped_categories": deriv["dropped_categories"]}, "formats": {}}
    for fid, spec in FORMATS.items():
        prods = range_for(fid, cat)
        units, depts, plano, fills, unplaced, f_centre, geo = build_format(fid, spec, prods)
        cfg = build_config(fid, spec, units, depts, plano, geo, by_code, f_centre)
        cfg["derivation"] = {"script": "scripts/scale_superstore.py", "rules": "data/products/superstore_rules.md",
                             "catalog": "data/products/catalog_superstore.json", "range_rule": range_for.__doc__.strip(),
                             "skus_in_range": len(prods), "skus_placed": len(prods) - len(unplaced), "unplaced": unplaced,
                             "space_to_range_ratio": round(f_centre, 3), "geometry": {k: v for k, v in geo.items() if k not in ("aisle_xy",)},
                             **({"catalog_derivation": deriv} if fid == "superstore" else {})}
        dump(cfg, P(f"data/store/formats/{fid}.config.json"))
        dump(plano, P(f"data/store/formats/planogram_{fid}.json"))
        f = np.array(fills)
        summary["formats"][fid] = {"units": len(units), "centre_aisles": spec["centre_aisles"], "slots": len(plano), "skus": len(prods),
                                   "placed": len(prods) - len(unplaced), "unplaced": len(unplaced),
                                   "fill_ratio": {"mean": round(f.mean(), 3), "min": round(f.min(), 3), "p5": round(float(np.percentile(f, 5)), 3), "median": round(float(np.median(f)), 3)},
                                   "facings_mean": round(np.mean([v for s in plano.values() for v in s["facings"].values()]), 2),
                                   "footprint_m": cfg["footprint_m"], "departments": len(cfg["departments"]), "end_caps": len(cfg["end_caps"]),
                                   "by_role": dict(Counter(by_code[c]["role"] for s in plano.values() for c in s["products"])),
                                   "fixtures": dict(Counter(u["fixture"] for u in units)), "checkouts": cfg["checkout_counts"]["staffed"], "self": cfg["checkout_counts"]["self"],
                                   "meal_deal": cfg["meal_deal"]["counts"]}
    dump(build_stores(), P("data/store/stores.json"))
    validate(summary)


def validate(summary):
    cat = json.load(open(P("data/products/catalog_superstore.json")))
    codes = [p["code"] for p in cat]
    assert len(codes) == len(set(codes)), "duplicate codes in catalog"
    cs = set(codes)
    xl = json.load(open(P("data/products/catalog_xl.json")))
    by = {p["code"]: p for p in cat}
    for p in xl:  # the 480 XL products are kept with every original field unchanged
        q = by[p["code"]]
        assert all(q[k] == v for k, v in p.items()), p["code"]
    for p in cat:
        assert len(p["lens_grades"]) == 12 and all(0 <= g["score"] <= 1 and g["why"] for g in p["lens_grades"].values()), p["code"]
        assert p["image"] and p["name"] and p["brand"] and p["width_cm"] > 0 and p["price_gbp"] > 0, p["code"]
    for fid in FORMATS:
        cfg = json.load(open(P(f"data/store/formats/{fid}.config.json")))
        pl = json.load(open(P(f"data/store/formats/planogram_{fid}.json")))
        uid = {u["id"]: u for u in cfg["units"]}
        placed = [c for s in pl.values() for c in s["products"]]
        assert not [c for c in placed if c not in cs], "planogram code missing from catalog"
        assert len(placed) == len(set(placed)), f"{fid}: code placed twice"
        for sid, s in pl.items():
            u, r = sid.rsplit("-r", 1)
            assert u in uid and 1 <= int(r) <= uid[u]["rows"], sid
            assert set(s["facings"]) == set(s["products"]) == set(s["stock"]) == set(s["capacity"]), sid
            assert s["filled_cm"] <= s["width_cm"] + 1e-6, sid
        for d in cfg["departments"]:
            assert all(k in d for k in ("id", "name", "zone", "floor_color", "sign_text", "aisle_numbers", "fixture_type")), d["id"]
        assert all(u.get("department") and "aisle_number" in u for u in cfg["units"])
        for ec in cfg["end_caps"]:
            assert all(c in cs for c in ec["planogram"]["products"])
    st = json.load(open(P("data/store/stores.json")))
    for s in st["stores"]:
        assert abs(sum(s["mission_mix"].values()) - 1) < 1e-3 and abs(sum(s["persona_weights"].values()) - 1) < 1e-3, s["id"]
        assert os.path.exists(P(s["config"])) and os.path.exists(P(s["planogram"]))
    summary["stores"] = [{"id": s["id"], "format": s["format"], "dominant_personas": s["persona_weights_source"]["dominant"],
                          "mission_mix": s["mission_mix"]} for s in st["stores"]]
    summary["file_sizes_kb"] = {f: round(os.path.getsize(P(f)) / 1024) for f in
                                ["data/products/catalog_superstore.json", "data/store/stores.json"] +
                                [f"data/store/formats/{a}{fid}.{b}" for fid in FORMATS for a, b in (("", "config.json"), ("planogram_", "json"))]}
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    if "--pools" in sys.argv:
        df = pd.read_parquet(P("data/products/uk_products.parquet")).drop_duplicates("code")
        cand = candidates(df, {p["code"] for p in json.load(open(P("data/products/catalog_xl.json")))})
        for c in XL_CATS + PRE_XL + POST_XL:
            print(f"{c:28s} {len(cand.get(c, [])):5d}")
    else:
        main()

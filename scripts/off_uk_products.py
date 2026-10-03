"""Pull UK grocery products from the Open Food Facts parquet dump (HF) into data/products/.

Keeps products sold in the UK with ingredients + NOVA + Nutri-Score present, flattens
nested fields (English name/ingredients, key nutriments, front image URL) and writes
uk_products.parquet + uk_products.csv. Licence: ODbL (data), CC BY-SA (images).
"""
import duckdb, json, os

SRC = "https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "products")
os.makedirs(OUT, exist_ok=True)

con = duckdb.connect()
con.execute("LOAD httpfs;")
con.execute(f"""
CREATE TABLE uk AS
SELECT code, brands, brands_tags, categories_tags, food_groups_tags, labels_tags, additives_n, additives_tags,
       allergens_tags, ingredients_analysis_tags, ingredients_n, ingredients_from_palm_oil_n, nova_group,
       nutriscore_grade, nutriscore_score, environmental_score_grade, environmental_score_score,
       nutrient_levels_tags, packaging_tags, packaging_recycling_tags, origins, stores_tags, quantity,
       product_quantity, product_quantity_unit, serving_size, with_sweeteners, with_non_nutritive_sweeteners,
       unique_scans_n, popularity_key, completeness, product_name, ingredients_text, nutriments, images, link
FROM '{SRC}'
WHERE list_contains(countries_tags, 'en:united-kingdom')
  AND nova_group IS NOT NULL AND nutriscore_grade IN ('a','b','c','d','e')
  AND ingredients_n > 0 AND NOT coalesce(obsolete, false)
""")
print("uk rows", con.execute("select count(*) from uk").fetchone())
con.execute(f"COPY uk TO '{OUT}/uk_products_raw.parquet' (FORMAT parquet)")


def en(struct_list):
    if not struct_list:
        return None
    for s in struct_list:
        if s.get("lang") in ("en", "main"):
            return s.get("text")
    return struct_list[0].get("text")


NUT = ["energy-kcal", "fat", "saturated-fat", "sugars", "salt", "fiber", "proteins"]
df = con.execute("select * from uk").fetchdf()
rows = []
for r in df.to_dict("records"):
    nut = {n["name"]: n.get("100g") for n in (r["nutriments"] if r["nutriments"] is not None else []) if n.get("name") in NUT}
    img = None
    for im in (r["images"] if r["images"] is not None else []):
        if str(im.get("key", "")).startswith("front"):
            img = f"https://images.openfoodfacts.org/images/products/{r['code']}/{im['key']}.{im.get('rev', 1)}.400.jpg"
            break
    rows.append({
        "code": r["code"], "name": en(list(r["product_name"]) if r["product_name"] is not None else None), "brand": r["brands"],
        "categories": "|".join(r["categories_tags"] or []), "labels": "|".join(r["labels_tags"] or []),
        "additives_n": r["additives_n"], "additives": "|".join(r["additives_tags"] or []),
        "allergens": "|".join(r["allergens_tags"] or []), "analysis": "|".join(r["ingredients_analysis_tags"] or []),
        "ingredients_n": r["ingredients_n"], "palm_oil_n": r["ingredients_from_palm_oil_n"], "nova": r["nova_group"],
        "nutriscore": r["nutriscore_grade"], "ecoscore": r["environmental_score_grade"],
        "packaging": "|".join(r["packaging_tags"] or []), "recycling": "|".join(r["packaging_recycling_tags"] or []),
        "stores": "|".join(r["stores_tags"] or []), "quantity": r["quantity"], "sweeteners": r["with_sweeteners"],
        "scans": r["unique_scans_n"], "completeness": r["completeness"],
        "ingredients_text": en(list(r["ingredients_text"]) if r["ingredients_text"] is not None else None),
        **{f"{k}_100g": nut.get(k) for k in NUT},
        "image": img, "off_url": f"https://world.openfoodfacts.org/product/{r['code']}",
    })
import pandas as pd
flat = pd.DataFrame(rows)
flat.to_parquet(f"{OUT}/uk_products.parquet", index=False)
flat.to_csv(f"{OUT}/uk_products.csv", index=False)
print("flat rows", len(flat), "with image", flat.image.notna().sum())

"""Stream the Open Food Facts CSV dump (S3) and keep UK grocery products -> data/products/.

Filters: sold in the UK, has ingredients, NOVA group and a Nutri-Score grade. One pass, no full
download kept on disk. Licence: ODbL (data), CC BY-SA (images).
Usage: python3 scripts/off_uk_products.py
"""
import csv, gzip, io, os, sys, urllib.request

URL = "https://openfoodfacts-ds.s3.eu-west-3.amazonaws.com/en.openfoodfacts.org.products.csv.gz"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "products")
os.makedirs(OUT, exist_ok=True)
csv.field_size_limit(sys.maxsize)

KEEP = {  # output name -> candidate source columns (first present wins)
    "code": ["code"], "name": ["product_name_en", "product_name"], "brand": ["brands"],
    "categories": ["categories_tags"], "labels": ["labels_tags"], "additives_n": ["additives_n"],
    "additives": ["additives_tags"], "allergens": ["allergens_tags", "allergens"],
    "analysis": ["ingredients_analysis_tags"], "ingredients_n": ["ingredients_n"],
    "palm_oil_n": ["ingredients_from_palm_oil_n"], "nova": ["nova_group"], "nutriscore": ["nutriscore_grade"],
    "ecoscore": ["environmental_score_grade", "ecoscore_grade"], "packaging": ["packaging_tags"],
    "recycling": ["packaging_recycling_tags"], "stores": ["stores_tags", "stores"], "quantity": ["quantity"],
    "sweeteners": ["with_sweeteners"], "scans": ["unique_scans_n"], "completeness": ["completeness"],
    "ingredients_text": ["ingredients_text_en", "ingredients_text"],
    "energy-kcal_100g": ["energy-kcal_100g"], "fat_100g": ["fat_100g"], "saturated-fat_100g": ["saturated-fat_100g"],
    "sugars_100g": ["sugars_100g"], "salt_100g": ["salt_100g"], "fiber_100g": ["fiber_100g"],
    "proteins_100g": ["proteins_100g"], "image": ["image_front_url", "image_url"],
}


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "eathack/0.1 (adjib2005@gmail.com)"})
    resp = urllib.request.urlopen(req, timeout=120)
    text = io.TextIOWrapper(gzip.GzipFile(fileobj=resp), encoding="utf-8", errors="replace", newline="")
    reader = csv.reader(text, delimiter="\t", quoting=csv.QUOTE_NONE)
    header = next(reader)
    idx = {h: i for i, h in enumerate(header)}
    src = {k: next((idx[c] for c in cands if c in idx), None) for k, cands in KEEP.items()}
    ci = idx["countries_tags"]
    out_path = os.path.join(OUT, "uk_products.csv.tmp")
    n = kept = 0
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(list(KEEP) + ["off_url"])
        for row in reader:
            n += 1
            if n % 500000 == 0:
                print(f"scanned {n:,} kept {kept:,}", flush=True)
            if len(row) != len(header) or "en:united-kingdom" not in row[ci]:
                continue
            get = lambda k: row[src[k]] if src[k] is not None else ""
            if not get("ingredients_text") or get("nova") == "" or get("nutriscore") not in ("a", "b", "c", "d", "e"):
                continue
            vals = [get(k).replace(",", "|") if k in ("categories", "labels", "additives", "allergens", "analysis",
                                                        "packaging", "recycling", "stores") else get(k) for k in KEEP]
            w.writerow(vals + [f"https://world.openfoodfacts.org/product/{get('code')}"])
            kept += 1
    os.replace(out_path, os.path.join(OUT, "uk_products.csv"))
    import pandas as pd
    df = pd.read_csv(os.path.join(OUT, "uk_products.csv"), dtype={"code": str}, low_memory=False)
    df.to_parquet(os.path.join(OUT, "uk_products.parquet"), index=False)
    print(f"DONE scanned {n:,} kept {len(df):,}")


if __name__ == "__main__":
    main()

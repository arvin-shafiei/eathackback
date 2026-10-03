"""Brand-supplied products: a brand types its own product in and it is simulated on the shelf.

Nothing here is verified against Open Food Facts, so every product is stamped
`brand_supplied: true` and `source: "brand-supplied, unverified"`. The frontend shows that in the trace.

Free text goes straight into the shopper and agent prompts, so it is length-capped. That limits, but does
not remove, the room for a brand to write instructions into its own pack copy (see README limitations).
"""
from __future__ import annotations

import re

SOURCE = "brand-supplied, unverified"
OFF_URL = re.compile(r"^https://world\.openfoodfacts\.org/product/\d{8,14}$")
ROLES = ("challenger", "incumbent", "own_label")
TEXT_CAPS = {"name": 80, "brand": 60, "pack_copy": 300, "ingredients_text": 800, "quantity": 40}
NUMERIC = ("sugars_100g", "fiber_100g", "proteins_100g", "salt_100g", "energy_kcal_100g")
LISTS = ("labels", "allergens", "additives")


def _num(v):
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def clean_product(p: dict, categories: set[str]) -> dict:
    code = str(p.get("code") or "").strip()
    if not code:
        raise ValueError("uploaded product needs a code")
    category = str(p.get("category") or "")
    if category not in categories:
        raise ValueError(f"uploaded product {code}: category '{category}' is not a unit in this store "
                         f"(have {sorted(categories)})")
    price = _num(p.get("price_gbp"))
    if not price or price <= 0:
        raise ValueError(f"uploaded product {code}: price_gbp must be a positive number")
    out = {"code": code, "category": category, "price_gbp": round(price, 2),
           "role": p.get("role") if p.get("role") in ROLES else "challenger"}
    for k, cap in TEXT_CAPS.items():
        out[k] = " ".join(str(p.get(k) or "").split())[:cap]
    if not out["name"]:
        raise ValueError(f"uploaded product {code}: name is required")
    for k in NUMERIC:
        out[k] = _num(p.get(k))
    for k in LISTS:
        out[k] = [str(x)[:40] for x in (p.get(k) or []) if str(x).strip()][:12]
    out["additives_n"] = len(out["additives"])
    out["nutriscore"] = str(p.get("nutriscore") or "").lower()[:1]
    nova = _num(p.get("nova"))
    out["nova"] = int(nova) if nova else None
    # the image is only drawn on the 3D pack; no prompt ever includes it
    out["image"] = str(p.get("image") or "")
    off_url = str(p.get("off_url") or "")
    out.update(brand_supplied=True, source=SOURCE, price_source=SOURCE, pack_copy_source=SOURCE,
               off_url=off_url if OFF_URL.match(off_url) else "", lens_grades={},
               imported_from=str(p.get("imported_from") or "")[:200])
    if isinstance(p.get("field_sources"), dict):
        # where an import read each field from; the brand could edit the form afterwards, so the stamp stays
        out["field_sources"] = {str(k)[:40]: str(v)[:240] for k, v in list(p["field_sources"].items())[:30]}
    return out


def merge(catalog: dict, extra_products, store: dict) -> tuple[dict, list[dict]]:
    """Return (catalog with the cleaned uploads added, the cleaned uploads)."""
    if not extra_products:
        return catalog, []
    categories = {u["category"] for u in store["units"]}
    cleaned = [clean_product(p, categories) for p in extra_products]
    catalog = dict(catalog)
    for p in cleaned:
        catalog[p["code"]] = p
    return catalog, cleaned

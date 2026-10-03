"""Import one product from a Tesco product link or a barcode, so a brand does not have to type it in.

python3 sim/tesco.py https://www.tesco.com/groceries/en-GB/products/254656543
python3 sim/tesco.py 5000436589457

Two sources, both recorded per field in `field_sources`:
  1. The Tesco product page's schema.org JSON-LD (what Tesco publishes for search engines): name, brand,
     price, image, description and the barcode (gtin13).
  2. Open Food Facts, looked up by that barcode: ingredients, nutrition per 100g, labels, allergens,
     Nutri-Score, NOVA. Open licence (ODbL), same source as the rest of the catalogue.

Measured 3 Oct 2026: Tesco's bot protection answers curl and headless Chrome with "Access Denied"; only a
normal browser window gets the page. So a link is opened once in the local Chrome, in a real window placed
off screen, and its schema.org block is read over the devtools port. The result is saved to
data/products/tesco_cache/<id>.json (with the date) and reused. This needs Chrome on the machine running
the sim server; without it, or if Tesco still refuses, the error asks for the barcode instead. A barcode
skips Tesco entirely and reads Open Food Facts.
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(os.path.dirname(HERE), "data", "products", "tesco_cache")
BARCODE_RE = re.compile(r"^\d{8,14}$")
OFF_URL_RE = re.compile(r"^https://(?:world|uk)\.openfoodfacts\.org/product/(\d{8,14})(?:/.*)?$")
URL_RE = re.compile(r"^https://www\.tesco\.com/(?:groceries|shop)/en-GB/products/(\d{6,12})/?(?:\?.*)?$")
CHROME_PATHS = ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                "/Applications/Chromium.app/Contents/MacOS/Chromium",
                "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
OFF_FIELDS = ("product_name,brands,quantity,ingredients_text_en,ingredients_text,nutriments,labels_tags,"
              "allergens_tags,additives_tags,nutriscore_grade,nova_group,categories_tags,image_front_url")
# assumption: keyword match on Open Food Facts category tags; the brand confirms the unit in the form
CATEGORY_KEYWORDS = (
    ("plant_milk_dairy_alt", ("plant-based-milk", "milk-substitute", "dairy-substitute", "oat-drink", "soy-drink")),
    ("yoghurt", ("yogurt", "yoghurt", "kefir", "skyr")),
    ("breakfast_cereal", ("breakfast-cereal", "cereals", "muesli", "granola", "porridge")),
    ("snack_bars", ("bars", "cereal-bar", "protein-bar")),
    ("crisps_savoury", ("crisps", "chips", "salty-snacks", "popcorn")),
    ("biscuits_chocolate", ("biscuit", "chocolate", "cookies", "confectioner")),
    ("soft_drinks", ("sodas", "soft-drink", "carbonated", "beverages", "kombucha", "juices")),
    ("ready_meals_soup", ("meals", "soups", "ready-meal")),
)


def find_chrome() -> str:
    for p in CHROME_PATHS:
        if os.path.exists(p):
            return p
    for name in ("google-chrome", "chromium", "chromium-browser"):
        if shutil.which(name):
            return shutil.which(name)
    raise RuntimeError("no Chrome/Chromium found on this machine; type the product in instead")


BLOCKED = ("tesco would not serve that page to this machine's browser. "
           "paste the barcode from the back of the pack instead (it reads open food facts).")



class _DevTools:
    """Just enough of a WebSocket client (stdlib only) to ask one Chrome tab to evaluate an expression."""

    def __init__(self, ws_url: str):
        host_port, path = ws_url[len("ws://"):].split("/", 1)
        host, port = host_port.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(4096)
        if b" 101 " not in buf.split(b"\r\n", 1)[0]:
            raise RuntimeError("chrome refused the devtools connection")
        self.n = 0

    def _read(self, n: int) -> bytes:
        out = b""
        while len(out) < n:
            chunk = self.sock.recv(n - len(out))
            if not chunk:
                raise RuntimeError("chrome closed the devtools connection")
            out += chunk
        return out

    def _recv(self) -> str:
        data = b""
        while True:
            b1, b2 = self._read(2)
            size = b2 & 0x7F
            if size == 126:
                size = struct.unpack(">H", self._read(2))[0]
            elif size == 127:
                size = struct.unpack(">Q", self._read(8))[0]
            data += self._read(size)
            if b1 & 0x80:  # FIN
                return data.decode("utf-8", "replace")

    def evaluate(self, expression: str):
        self.n += 1
        payload = json.dumps({"id": self.n, "method": "Runtime.evaluate",
                              "params": {"expression": expression, "returnByValue": True}}).encode()
        mask = os.urandom(4)
        head = bytes([0x81]) + (bytes([0x80 | len(payload)]) if len(payload) < 126
                                else bytes([0x80 | 126]) + struct.pack(">H", len(payload)))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        while True:
            msg = json.loads(self._recv())
            if msg.get("id") == self.n:
                return ((msg.get("result") or {}).get("result") or {}).get("value")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


LD_JSON = "JSON.stringify([...document.querySelectorAll('script[type=\"application/ld+json\"]')].map(s => s.textContent))"


def fetch_ld_json_in_window(url: str, timeout: int = 30) -> str:
    """Open the page in a normal (not headless) Chrome window, off screen, and read its ld+json blocks over the
    devtools port. Returns them wrapped as script tags so parse_product can read them."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    prof = tempfile.mkdtemp(prefix="tesco-chrome-")
    proc = subprocess.Popen(
        [find_chrome(), f"--remote-debugging-port={port}", f"--user-data-dir={prof}", "--no-first-run",
         "--no-default-browser-check", "--window-position=-2400,-2400", "--window-size=1200,900", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    dev = None
    try:
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(0.6)
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2) as r:
                    tabs = json.load(r)
            except Exception:
                continue
            tab = next((t for t in tabs if t.get("type") == "page" and "tesco.com" in t.get("url", "")), None)
            if not tab:
                continue
            if dev is None:
                dev = _DevTools(tab["webSocketDebuggerUrl"])
            blocks = json.loads(dev.evaluate(LD_JSON) or "[]")
            if any('"Product"' in b for b in blocks):
                return "".join(f'<script type="application/ld+json">{b}</script>' for b in blocks)
            if "Access Denied" in (dev.evaluate("document.title") or ""):
                break
        raise RuntimeError(BLOCKED)
    finally:
        if dev:
            dev.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(prof, ignore_errors=True)


def tesco_node(url: str, product_id: str) -> tuple[dict, str]:
    """The page's schema.org Product node, and how we got it."""
    cached = os.path.join(CACHE_DIR, f"{product_id}.json")
    if os.path.exists(cached):
        with open(cached) as f:
            snap = json.load(f)
        return snap["product"], f"captured in a browser {snap.get('captured', '')}"
    node = parse_product(fetch_ld_json_in_window(url))
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(cached, "w") as f:
        json.dump({"captured": time.strftime("%Y-%m-%d"), "url": url,
                   "note": "schema.org Product node from the public product page, read in a normal browser window",
                   "product": {k: node.get(k) for k in ("@type", "name", "brand", "image", "gtin13", "sku", "description", "offers")}},
                  f, indent=1, ensure_ascii=False)
    return node, "loaded live in a browser window"


def parse_product(html: str) -> dict:
    for block in re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        nodes = data.get("@graph", [data]) if isinstance(data, dict) else data
        for node in nodes:
            if isinstance(node, dict) and node.get("@type") == "Product":
                return node
    if "Access Denied" in html[:600]:
        raise RuntimeError(BLOCKED)
    raise RuntimeError("no product data found on that page; check the link opens a single product")


def off_lookup(barcode: str) -> dict:
    url = f"https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields={OFF_FIELDS}"
    req = urllib.request.Request(url, headers={"User-Agent": "eathack-shelf-sim/0.1 (hackathon project)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return (json.load(r) or {}).get("product") or {}
    except Exception:
        return {}


def guess_category(tags: list[str]) -> str:
    joined = " ".join(tags or [])
    for category, words in CATEGORY_KEYWORDS:
        if any(w in joined for w in words):
            return category
    return ""


def import_product(ref: str) -> dict:
    """Return a product draft for the add-product form from a Tesco link, a barcode or an Open Food
    Facts link. Raises ValueError for anything else: this never fetches an arbitrary URL."""
    ref = ref.strip()
    m = URL_RE.match(ref)
    off_m = OFF_URL_RE.match(ref)
    draft, sources = {}, {}
    if m:
        node, how = tesco_node(ref, m.group(1))
        tesco = f"tesco.com product page (schema.org data, {how}), {ref}"
        offer = node.get("offers") or {}
        image = node.get("image")
        brand = node.get("brand")
        barcode = str(node.get("gtin13") or "").lstrip("0")
        draft = {"name": node.get("name") or "",
                 "brand": (brand.get("name") if isinstance(brand, dict) else brand) or "",
                 "price_gbp": offer.get("price"), "pack_copy": node.get("description") or "",
                 "image": (image[0] if isinstance(image, list) and image else image) or ""}
        sources = {k: tesco for k in draft if draft[k]}
    elif BARCODE_RE.match(ref) or off_m:
        barcode = (off_m.group(1) if off_m else ref).lstrip("0")
    else:
        raise ValueError("paste a tesco product link (https://www.tesco.com/groceries/en-GB/products/…), "
                         "a barcode, or an open food facts product link.")
    draft.update(barcode=barcode, imported_from=ref)
    off = off_lookup(barcode) if barcode else {}
    if not m and not off:
        raise RuntimeError(f"open food facts has no product with barcode {barcode}. type the product in instead.")
    if off and not m:
        off_only = f"Open Food Facts, https://world.openfoodfacts.org/product/{barcode}"
        for k, v in (("name", off.get("product_name")), ("brand", (off.get("brands") or "").split(",")[0].strip())):
            if v:
                draft[k], sources[k] = v, off_only
    if off:
        off_url = f"https://world.openfoodfacts.org/product/{barcode}"
        n = off.get("nutriments") or {}
        from_off = {
            "ingredients_text": off.get("ingredients_text_en") or off.get("ingredients_text") or "",
            "sugars_100g": n.get("sugars_100g"), "fiber_100g": n.get("fiber_100g"),
            "proteins_100g": n.get("proteins_100g"), "salt_100g": n.get("salt_100g"),
            "energy_kcal_100g": n.get("energy-kcal_100g"),
            "labels": off.get("labels_tags") or [], "allergens": off.get("allergens_tags") or [],
            "additives": off.get("additives_tags") or [],
            "nutriscore": off.get("nutriscore_grade") if off.get("nutriscore_grade") in list("abcde") else "",
            "nova": off.get("nova_group"), "quantity": off.get("quantity") or "",
            "category": guess_category(off.get("categories_tags") or []),
        }
        if not draft.get("image"):
            from_off["image"] = off.get("image_front_url") or ""
        for k, v in from_off.items():
            if isinstance(v, float):
                v = round(v, 1)
            if v not in (None, "", []):
                draft[k] = v
                sources[k] = (f"assumption: keyword match on Open Food Facts categories, {off_url}"
                              if k == "category" else f"Open Food Facts, {off_url}")
        draft["off_url"] = off_url
    draft["field_sources"] = sources
    draft["off_found"] = bool(off)
    return draft


if __name__ == "__main__":
    print(json.dumps(import_product(sys.argv[1]), indent=1, ensure_ascii=False))

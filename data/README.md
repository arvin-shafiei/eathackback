# Data

## reddit/
Public Reddit threads discovered via Google search (15 shopper/founder/buyer/AI-agent themes), comment trees fetched from the **Arctic Shift** Reddit archive API (`scripts/reddit_threads.py`). Reddit's own endpoints return 403 to scripts, so the archive was used instead.

- `reddit_threads.jsonl` — raw: one thread per line (`id, theme, sub, title, selftext, post_score, url, comments[{depth,score,body}]`)
- `comments.csv` — flat, one row per comment (10,642 rows)
- `threads_index.csv` — 133 threads with theme, subreddit, comment count
- `threads/<theme>__<id>.json` — one file per thread
- `fetch.log` — fetch log

Themes: online_favourites_lockin, buy_it_again_repeat, tried_new_went_back, own_brand_vs_branded, trust_unknown_brand, small_brand_listing, buyer_meeting, delisted, say_do_healthy, meal_deal, chatgpt_shopping, rufus_ai_bias, shrinkflation_switch, protein_gimmick, impulse_instore_vs_online.

Comments < 30 chars and [deleted]/[removed] are dropped. Usernames are not stored.

## products/
`uk_products.csv` / `.parquet`: **36,548 UK products** from the Open Food Facts full dump (4.54M products streamed, filtered to `en:united-kingdom`, with ingredients, NOVA and Nutri-Score present). Built by `scripts/off_uk_products.py`. Fields: barcode, name, brand, categories, labels, additives (n and list), allergens, NOVA, Nutri-Score, eco-score, packaging/recycling, stores, nutrients per 100g, image URL, OFF URL. Licence: ODbL (data), CC BY-SA (images).
`curated/<category>.json`: per-shelf curated SKUs with transparent lens grades (built by curator agents).

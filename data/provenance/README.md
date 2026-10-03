# data/provenance: how each persona was made

This folder holds the data behind the "no black box" provenance view. Every number a persona carries
should trace back to a Reddit comment, a paper, a data source, or an assumption that says it is one.
`scripts/build_provenance.py` regenerates all of it (stdlib only, deterministic, about 5 s):

```
python3 scripts/build_provenance.py
```

The script runs its own sanity checks and exits non-zero if any fail. It checks that every persona has a
file, that each evidence mix sums to 100%, that every source list is non-empty, and that every link has a
method, at least one evidence item, both endpoints and a forward direction.

## Files

| File | What it is |
|---|---|
| `graph.json` | A layered DAG for a Sankey or flow chart: `subreddit → thread → theme → mechanism → persona → attribute`. Each node has `{id, layer, layer_name, label, count, url?}` and each link has `{source, target, value, value_unit, method, evidence[]}`. Evidence items are verbatims or citations of 25 words or fewer, with a URL where one exists. |
| `personas/<persona_id>.json` | One file per persona: 12 lens personas (`p_*`, from `data/personas/lens/`) and 13 staged personas (`staged_*`, from `data/personas/staged_personas_v1.json`). Every field lists its classified sources and an `evidence_mix`, which is the honesty meter. |
| `personas/index.json` | A one-line evidence mix per persona, for a list view. |
| `corpus_stats.json` | Totals by subreddit, theme and mechanism (coded `approx_count`), up to 5 top-upvoted verbatims per coded mechanism with URLs, a comment-length histogram, score stats, and a note on dates. |

### Graph layers and value units

| Link | `value` means | Evidence on the link |
|---|---|---|
| subreddit → thread | comments in `comments.csv` for that thread | top-scored comments in the thread |
| thread → theme | same | top comment |
| theme → mechanism | summed `approx_count` of the coded mechanisms (`research/03-reddit-coded.json`) that map to that mechanism family | coder verbatims, located in `comments.csv` (with URL and score) |
| mechanism → persona | number of persona attributes whose strongest evidence flows through that node | the best source of those attributes; `via_themes` and `via_thread_ids` let the UI light up the whole path |
| persona → attribute | 1 per attribute | the attribute's top sources |

Units differ between layer pairs (comments, then coder counts, then attributes), so normalise link widths
per layer pair when drawing.

The **mechanism layer** has 17 canonical *mechanism families*, such as "Betrayal aversion" or
"Habit, defaults and status-quo lock-in". `graph.mechanism_families` lists each family's keywords and the
coded mechanisms in it. The same layer also has explicit **non-Reddit source nodes**: `src:paper`,
`src:off_field`, `src:sales_data`, `src:staged_persona`, `src:web_other`, `src:internal_research` and
**`src:assumption` ("Unattributed / assumption")**. When an attribute has no Reddit evidence, it flows from
one of these nodes instead of being hidden.

## Source classes (per-persona files)

| Class | Rule |
|---|---|
| `reddit` | A `reddit.com/comments/<id>` URL in the source text. The thread is looked up in `threads_index.csv`. Quoted text from the source, or the persona's own `verbatims[]` for that URL, is then searched for in the thread's comments: the longest quote fragment is normalised and matched as a substring. `method` says how far the match got. `url_match+quote_verified` gives comment score and subreddit. `url_match+quote_in_post` means the quote is in the OP. `url_match(thread_only)` means the quote was not located, so the score shown is the post score (`score_is`). Text that names the corpus without a URL (`comments.csv` grep counts, `research/corpus/*.md`) counts as `corpus_reference(no url)`. |
| `reddit_inferred` | Staged personas only. A trigger, trust signal, mission or "says vs does" with **no citation at all** is matched by keyword overlap to coded snippets (mechanisms, rejection triggers, trust builders, say/do gaps). The rule is Jaccard on 6-character stems, at least 0.14, with at least 3 shared stems. The method string records the score and the shared stems. This is weaker evidence and is shown separately. |
| `paper` | A DOI, PMC, arXiv or other academic host URL, or a text citation pattern (`Author [& Author] [et al.] YEAR`, `doi:`, `PMC…`). |
| `off_field` | The source cites Open Food Facts (URL or "OFF"). Note that a lens attribute's `off_field` says *what* the attribute measures, not *why* it has its weight. It is kept as `measured_by_off_field` and reported in `evidence_mix.lens_fields_measured_by_off_field`, but it is not counted as evidence. That is why OFF % is near zero. |
| `sales_data` | Kantar, NielsenIQ, Circana, The Grocer, Worldpanel or similar, cited **with a figure** (%, £, share, YoY). A Grocer quote without a figure counts as `web_other` (trade press). |
| `staged_persona` | A lens persona that borrows from the staged dossiers (`staged_personas_v1.json`). |
| `web_other` | A non-academic URL or named forum (Mumsnet, MSE, Wikipedia, retailer press releases, Coeliac UK…). |
| `internal_research` | A pointer into our own synthesis (`research/0x-*.md`, the "human mean" table in `research/05-personas.md` §4c, archetype priors in `data/personas/ocean/*.json`). These are second-hand: follow the chain into those docs. |
| `assumption` | The source text says so ("assumption", "illustrative", "set so", "plausible"…), the field has no source (`missing_source`), the text has no recognisable citation (`unclassified_text`), or it is an OCEAN score, which is always hand-set (`hand_set_score`). |

A source string is split on `;` and each segment can yield several classes. For example,
"1.3x is assumption: close to … Li & Kallas 2021" yields both `assumption` and `paper`.

### Evidence mix (the honesty meter)

Each persona field counts as **one unit**, split equally across the *distinct* classes it cites. A field
backed by Reddit and an assumption counts 0.5 Reddit and 0.5 assumption. `evidence_mix.pct` is the mean
over fields, rounded with largest remainder so it sums to exactly 100.0. `headline` folds this into
Reddit (cited + inferred), paper, OFF, assumption and other. The file also gives
`pct_fields_with_any` (for example, the share of fields that carry *any* assumption) and
`fields_by_primary_class`, where a field's primary class is its strongest one, ranked
reddit > paper > sales > OFF > inferred > web > staged > internal > assumption.

Fields covered:

* **Lens personas:** profile (budget, channel, mission, household, age), every lens weight plus the weight
  magnitudes, hard gates, OCEAN scores and each OCEAN effect coefficient, rejection triggers, trust
  signals, habits, and every sim_param.
* **Staged personas:** behavioural drivers (from `evidence_verbatim`), rejection triggers, trust signals,
  missions, says-vs-does, and `verdict.sim_parameters`. The sim parameters are classed as assumption plus
  internal research, because they come from the LLM skeptic pass and §6 of `research/05-personas.md` says
  "treat every number as a prior".

## Mapping persona → mechanism

For each attribute that has Reddit evidence, the mechanism family is chosen by:

1. **keyword**: the family whose keyword list matches most in the attribute text (label, value, why or
   effect, plus the verbatims it cites), for example `url_match+keyword:'palm oil'`. Keywords of 4
   characters or fewer must match as whole words.
2. **fallback**: `url_match->theme:<t>->top_mechanism`, which is the largest coded family in the theme
   that the cited thread belongs to.
3. **otherwise**: `src:assumption`, with method `unattributed:…`.

Coded mechanism → family uses the same keyword lists. The family whose keyword appears **earliest in the
mechanism's lead phrase** (the text before the first parenthesis) wins. Otherwise the most keyword hits
over the mechanism name plus `what_people_do` decides. Every link records the rule it used.

## Limits (read before quoting a number)

* **Keyword mapping is crude.** Family assignment is a transparent rule, not a semantic judgement. Some
  assignments are arguable, such as "Capacity and over-commitment risk" → loss, or "Accuracy failure /
  availability of vivid errors" → choice architecture. The method string is there so a reviewer can
  disagree with a specific link.
* **`approx_count` values are coder estimates**, per `research/03-reddit-human-truths.md`. They show
  direction, not frequency. Several themes are mostly off-topic: online_favourites is Etsy and fashion,
  buy_it_again is under 5% literal, and buyer_meeting is about 21% on topic. The coder caveats are kept in
  `corpus_stats.by_theme[*].coder_caveat`.
* **Coder verbatims:** 597 of 704 were located in `comments.csv`. The rest are paraphrased or edited and are
  flagged `verified_in_corpus: false`.
* **A URL match proves the thread was cited, not that the comment supports the claim.** Where the quote was
  located we give its score. A high score means agreement among Reddit voters, not representativeness.
  Reddit over-represents label-readers and complainers.
* **`reddit_inferred` is our own inference**, applied only where the persona author cited nothing. A
  threshold of 0.14 still lets through loose matches. Treat it as "a similar idea exists in the corpus",
  not as "this is where it came from".
* **Equal split per field ignores weight.** A lens weight of 0.24 and a habit note count the same.
  The `fields` list allows a weighted view if needed.
* **Internal research is a hop, not a root.** `internal_research` and `staged_persona` sources point to
  documents that are themselves partly LLM-written. They are not counted as Reddit or paper even when those
  documents cite such sources.
* **No dates.** Neither the CSVs nor the raw thread JSON carry `created_utc`, so `corpus_stats.date_range`
  only gives the oldest and newest base36 thread ids, which rise with time.
* `corpus_stats.by_mechanism[*].top_verbatims` uses coder verbatims first, sorted by score. If fewer than 5
  were located, it tops up with the highest-scored comments in the same theme that contain the family's
  keywords (`selection: keyword_supplement…`). Those top-ups were not chosen by the coder.

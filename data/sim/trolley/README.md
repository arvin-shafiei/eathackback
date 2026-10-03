# smart-trolley sessions (SIMULATED)

Built by `sim/trolley.py` from `data/sim/runs/<run>.json`: what a store's tracked trolleys / scan-as-you-shop
baskets would record for the same trips (spec: `docs/ideas/smart-trolleys.md`). **Every file here is simulated**,
derived from a sim run. Nothing was measured in a real store.

    python3 sim/trolley.py data/sim/runs/<run>.json [--opt-in 0.6]   # -> <run>.sessions.json

## sim -> trolley signal

| in the sim | what the trolley records |
|---|---|
| agent path (shelf slots) | bay visits in walking order (bay = shelf unit, e.g. `U3`) with `dwell_s` |
| stage `taken` | `scan_in` |
| stage `put_back` | `scan_in` then `scan_out`: the put-back EPOS never sees |
| looked, or any stop >= `dwell_min_s` with no scan | `dwell_no_scan` for the **bay** (a trolley can't tell which product) |
| `not_noticed` | nothing (only the seconds rolling past the bay) |
| basket at the end | `checkout.items`, `total_gbp` (catalog `price_gbp`, curator assumptions) |
| loyalty card at the till | `opt_in_loyalty` (assumed share) and a pseudonymous `loyalty_id` only if opted in |

**dwell_s** = `pass_s_per_shelf_row` x rows in the bay + for each product looked at the persona's `seconds_at_shelf`
(sim value, from the event) + `pickup_s` for each pick-up. Walk time between bays = metres / walk speed.

## not recorded (a real trolley can't see it)

- noticed (looked without the trolley stopping)
- which product at a bay was looked at
- persona / archetype
- OCEAN traits
- mission / budget
- Jev probabilities, reasons, feelings
- back-of-pack reads
- anything about health (only declared at checkout, never inferred)

## pacing and other assumptions

| key | value | note |
|---|---|---|
| `pass_s_per_shelf_row` | 1.5 | assumption: seconds to roll past one shelf row of a bay without stopping |
| `look_s` | event notice_factors.seconds_at_shelf (persona param; 6 s if missing) | sim value: each product the shopper looked at adds the persona's seconds_at_shelf to the bay dwell |
| `pickup_s` | 8.0 | assumption: extra seconds to pick up and handle a product (read the pack) |
| `walk_m_same_aisle` | 2.0 | assumption: metres between neighbouring bays in one aisle |
| `walk_m_new_aisle` | 10.0 | assumption: metres to the next aisle (round the end cap) |
| `walk_speed_mps` | 1.3 | same as sim/layout_optimise.py PARAMS walk_speed_mps (assumption) |
| `dwell_min_s` | 5.0 | assumption: a trolley stopped >= 5 s at a bay counts as a dwell (spec: 'at least N seconds') |
| `trip_start` | 08:00-20:00 uniform, seeded | assumption: arrival time of day; real trolleys log real clocks |
| `opt_in_loyalty` | 0.6 | assumption (configurable): share of trips that scan a loyalty card / app at the till; not measured |
| `household` | opted-in shoppers of the same persona in one run, up to 3 trips per loyalty_id, 7 days apart | simulation shortcut so a loyalty_id has repeat visits to count; in a store the loyalty card makes this link |
| `put_back_capture` | 1.0 | assumption: every sim put-back is caught as a scan_out (cart camera / weight drop). With scan-only handsets an item put back without being scanned would be missed: upper bound |

## privacy

`trolley_id` is random per trip and resets every trip. A session is linked to a person (`loyalty_id`, a pseudonymous
hash) **only** when `opt_in_loyalty` is true at checkout. Anonymous trips are never merged
(`POST /api/trolley/profile` refuses). Health / diet lenses switch on only when declared, never inferred.
Brands should only ever see aggregated funnels (k >= 10), see `docs/data-collection.md`.

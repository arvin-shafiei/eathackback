# idea: store operations layer ("the store runs itself")

*Captured 3 Oct 2026 from the team discussion. Status: building.*

1. **Checkout routing.** Each shopper's basket (item count, loose produce that needs weighing, age-restricted items, bulky items) gives a predicted service time at a staffed till vs self-checkout. Combine that with the live queue to send them to the fastest lane. The arithmetic is a queueing model in code; Jev is used only for judgments such as "would this shopper accept self-checkout?" (age, item mix, persona).
2. **Time-of-day traffic.** The mission mix shifts by hour: lunch is meal deals, after school is family shops with more snacks and desserts, evening is top-ups. Arrivals per hour follow a sourced footfall curve, or a labelled assumption where we have no source.
3. **Staff agents.**
   - **Restockers:** shelves deplete as shoppers take items. Restockers prioritise by stock-out risk × demand, and stock-outs trigger the substitution / walk-away reactions from Gruen et al. 2002.
   - **Cleaners:** shoppers occasionally drop items, more often after bumping into each other. A cleaner is dispatched, and the spill blocks the aisle until it's cleared.
   - **Manager:** places orders for items going out of stock, using a reorder point = demand during lead time + safety stock (code, traceable).
4. **Bigger, better store.**
   - About **5× the items** (~480 SKUs), more aisles, more checkouts (staffed + self), and two entrances.
   - Spawn spacing and route spreading so shoppers don't clump.

Every parameter (scan seconds per item, payment time, footfall by hour, OOS rates, spill frequency, lead times) carries a source or a labelled assumption: rule zero.

## added 3 Oct (team): the ENGINE MUST ALSO model these
5. **Café zone:** a seating area (N tables × seats from config; add it to `store_xl.config.json` if missing, with a `cafe` object containing a counter and a seats list). A share of shoppers (more mid-morning and afternoon) visit the café, buy a food/drink item from a small café menu (use real OFF products from the pastries, sandwiches and hot-drinks categories, with prices labelled), and sit for a dwell time sourced or labelled as an assumption. Seats are a capacity-limited resource: if none are free, the shopper waits or leaves. Report café occupancy by hour, turnaway and revenue.
6. **Security / shoplifting:** a small, sourced share of shoppers (BRC Crime Survey 2025/26 / ONS shoplifting stats, or a labelled assumption) attempt theft, either by leaving with unscanned items or by self-checkout skip-scanning (sourced rate if found). EAS gates at the exits detect tagged items with a sourced or assumed detection rate, the alarm fires (event `alarm` with position/time for the 3D "beep beep beep"), and a guard agent responds (response time). Report shrink £, incidents/hour, detection rate, and guard utilisation.
7. **Checkout theatre events for the 3D replay:** per shopper at checkout, emit `unload` (items onto the belt), `scan` (one event per item with timestamp, at the staffed or self scanner), `bag` and `pay`, so the frontend can animate the conveyor and scanner beeps item by item.

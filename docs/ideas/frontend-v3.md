# frontend v3 queue (to launch when the current 3D/physics pass finishes)

From the team, 3 Oct afternoon:
1. **Bigger store from data:** render `data/store/store_xl.config.json` + `planogram_xl.json` (~480 SKUs, ~20 units × 4 rows, 2 entrances, 6 staffed + 12 self checkouts, stockroom). Better crowd distribution, no clumping.
2. **Shelf dividers** between product sets/facings; price tags per set; visible **stock levels**: products disappear as they're taken, with a gap/empty-shelf state on stock-out.
3. **Checkout theatre (physics):**
   - Staffed tills: the shopper unloads basket/trolley items onto the **conveyor belt**, items travel down the belt, the cashier scans them (beep + flash), then bagging.
   - **Self-checkouts:** the shopper scans each item at the scanner (beep), puts it in the bagging area, and pays.
   - Lane choice follows the ops engine's routing (smart vs baseline), with queue lines visible.
4. **Baskets and trolleys fill with physics:** picked items are rigid bodies that settle inside the carrier, and empty out onto the belt at checkout.
5. **Staff agents** (from the `sim/ops.py` timeline): restockers pushing cages from the stockroom to low-stock slots; cleaners going to spills (spill decal plus a "wet floor" sign, aisle blocked); a manager with a tablet placing orders (order pop-ups).
6. **Café:** a seating area with tables and chairs, a counter with food items (pastries, sandwiches, coffee). Some shoppers go to the café, sit down and chill (eat/drink animation, relaxed idle), then leave. Seats are a limited resource in the ops engine (café dwell time sourced or labelled as an assumption).
7. **Time-of-day control:** a clock slider (08:00–22:00) that drives footfall, mission mix (lunch meal-deal, after-school family/desserts, evening top-up), queue lengths and staff tasks; plus a KPI HUD (waits p50/p90, stock-outs, lost sales, spills, café occupancy).
8. **Persona builder + provenance views** (dashboard): create/test a persona (`POST /api/personas`, `POST /api/run {persona_ids}`), and a Sankey from `data/provenance/graph.json` plus a per-persona evidence-mix meter.
9. **Three surfaces as tabs:** retailer (layout optimiser), brand (funnel + pack test), shopper (swaps + personal route card).
10. **Security / shoplifting:** a small share of shoppers (rate sourced, e.g. BRC crime survey, or a labelled assumption) try to leave with unscanned items. EAS security gates at the exits go **beep beep beep** with flashing lights, a security guard agent walks over, and the incident is logged in the ops KPIs (shrink £, incidents per hour). Also covers self-checkout "skip-scan" shrink (sourced rate).

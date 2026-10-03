# real world: smart trolleys and baskets (how the sim becomes real data)

*Captured 3 Oct 2026 from the team discussion.*

**Problem:** in the simulation we know every shopper's path and every pick-up and put-back. In a real store you can't tell who did what.

**Answer:** fit the store's own **trolleys and baskets with trackers**. This kit already exists commercially (Caper/Instacart smart carts, Amazon Dash Cart, retailer scan-as-you-shop handsets such as Tesco Scan as you Shop and Sainsbury's SmartShop).

| funnel stage (the sim) | what the trolley records in a real store |
|---|---|
| **path / walked past** | Trolley position from an anonymous tag (BLE beacons or UWB) gives the route, how long it stayed in each aisle, and congestion. That's the owner heatmap. |
| **look** | Trolley stopped in front of a shelf bay for at least N seconds (dwell). No cameras on faces. |
| **pick up → take** | Item scanned into the trolley (scan-as-you-shop) or detected by weight or cart camera. |
| **pick up → put back** | Item scanned *out* again, or a weight drop with no checkout line. That's the brand funnel's put-back, which EPOS never sees. |
| **checkout** | The session ends. **Only if the customer chooses** (loyalty card / app scan at the till) is the trolley session linked to a person. Otherwise it stays an anonymous session. |

**Who it is:** the trolley ID is pseudonymous and resets after each trip. Linking to a person happens only on opt-in at checkout. That's what feeds the **shoppers** service: basket → persona → next-visit route + one new item.

**Privacy (UK GDPR):**
- consent and opt-in for linking;
- no biometrics or face tracking;
- health traits only if the customer declares them;
- brands only ever see aggregated funnels (k ≥ 10);
- retention limits.

See `docs/data-collection.md`.

**How the sim fits:** the simulation is the **cold start**. A store can test layouts and products before it has any tracked trolleys, then calibrate the shopper models against real trolley sessions as they arrive (`calibration/`).

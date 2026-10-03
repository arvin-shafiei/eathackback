Desktop product analytics checks

From `web/`, run `npm run test:analytics` for event-count and shelf-loop invariants.

For the browser check, start `python3 sim/server.py 8788` from the repository root and `npm run dev -- --port 5175` from `web/`. Install Chromium with `npx playwright install chromium`, then run `npm run test:demo`. Set `DEMO_BASE_URL` for another port or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing Chromium installation.

The Playwright check uses the real superstore layout and the committed 60-shopper mock run. It checks independently counted funnel values, activity pagination and filters, CSV, trace navigation, forecast agreement with the selected 3D loop, animation, product changes, 1440 and 1280 pixel desktop widths, and an unavailable suggestion API. It neither applies a shelf change nor calls a paid model. Screenshots default to `/tmp/eathack-demo`; use `DEMO_OUTPUT_DIR` to change that.

Demo: `/?store=superstore&nointro&view=analytics&run=run_20261003_142844_s22_mock_483c&product=20969929`

The standard recorded simulation is also checked by the event invariant suite. Runs describe simulated shoppers rather than observed customer behavior; these graphs show patterns within a run, not retention or a historical time series.

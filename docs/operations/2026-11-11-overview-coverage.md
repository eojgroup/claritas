# Restore overview coverage without restoring startup fan-out

Infrastructure release `b37646a` completed successfully in [run 42982593695](https://github.com/eojgroup/claritas/actions/runs/42982593695).
The subsequent UI review exposed a distinct data-cohort problem: 4,882 current
developments included 46 located events, but none of the latest 40 cards had
coordinates. Filtering the map to the latest 24 cards therefore hid every pin.
Country shading was also calculated from those cards rather than the full window.

The saved overview now includes full-window country counts, up to 200 located
events, and up to eight retained visual events independently of the latest cards.
All share the selected period, country, topic and priority. Country-only reporting
contributes to country shading; it does not become an inferred incident position.
The worker joins retained satellite and publisher assets once per refresh and
stores image references in the projection, preserving imagery in scoped views.
Expired assets are removed on refresh. Publisher photos keep an unknown capture
date and are labelled separately from satellite acquisitions.

Activity history stays visible and distinguishes high-priority activity. Topic
counts are direct filters. The map retains expansion, priority shading and a
leading-country panel. Selected event essentials and visuals open alongside the
map, below the history, rather than after the entire development list. Country
clicks open a profile and filter the overview;
optional reference/weather/market data load sequentially after selection. The
initial authentication/overview/briefing request budget remains unchanged. Event
context shows publisher photos and an observed-versus-baseline transport chart
when those records exist, using the already-loaded evidence. iPhone/iPad receive
the same full-window map data, country profiles and visual context.

The deployment waits for all six fresh snapshots to contain `countries`,
`map_events` and `visual_events`, preventing old cached payloads from satisfying
the release gate. The previous integer coverage field remains compatible.

Validation includes 457 API unit tests, 180 web tests, and 34 PostGIS integration
tests. The database regression explicitly covers older located events outside
the latest cards, complete country totals, scoped publisher previews and expiry.
Apple model coverage includes independent map cohorts and unknown photo capture
dates; signing and device builds are verified by the Apple workflow.

A rollback-only production benchmark found 6,637 current developments, 104 mapped
countries, 59 located events and two retained visual events. Rebuilding the 24-hour
payload queries took 194 ms, seven-day queries 1,124 ms and a country scope 20 ms.
Initial retained-image enrichment updated 504 historical projection records in
2,827 ms. This work stays in the background; global readers use saved JSON.

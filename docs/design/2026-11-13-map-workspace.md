# World map workspace — 13 November 2026

The World screen uses the map as its background and primary interaction area. The map has no surrounding card, nested header, border or page padding. Phone context moves between a compact summary, a shared map/context view and a full-height reading panel. Wider layouts use a collapsible context panel beside the unobstructed map viewport.

Country and event selection updates that context panel. It does not close the expanded web map or replace the native canvas. The existing full-window activity chart, priority/topic/period filters, daily briefing, images, country profiles and event evidence remain available. No new feed or imagery requests were added to startup. The native overview refresh belongs to the workspace so it continues when the panel shows a selected event.

The phone map starts around the leading country instead of squeezing the entire world into the available width. Country selection focuses that country. Web count refreshes preserve camera position, and resizing the available viewport preserves its geographic center and scale. The world/reset control still exposes global coverage. Native map gestures use one finger for movement here; maps embedded in scrolling source pages retain two-finger movement.

The sliding panel has a separate grab handle so scrolling content does not move the map. Web keyboard users can use Arrow Up/Down and Home/End on the handle; hidden context is inert. The native handle has a VoiceOver adjustable action. The geography and signal sources remain the existing bundled Natural Earth data and cached overview response.

The simulator review now renders the actual WorldMapWorkspace rather than an isolated map card. It uses the existing captured overview through a Debug-only installation method. Release builds contain no fixture entry point.

Validation and deployment results are recorded in the pull request and release runs. Screenshots produced with captured data establish layout only; they do not establish production data freshness or verify physical-device gestures.

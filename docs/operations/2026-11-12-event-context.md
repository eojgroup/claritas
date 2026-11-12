# Event context recovery and visual continuity

The reported Valencia event (`95b94d45-c7d9-4559-b5c8-e90f091e5032`)
exists and has valid transport evidence. Production returned
`regional_reporting: []` on the default lightweight read. This field is an
object or `null` in the web and Apple contracts. Apple rejected the response;
the web source panel attempted to access `regional_reporting.items.length` and
failed during rendering. The earlier release probe checked event existence but
did not check this nested contract.

The response builder now returns `null` when regional context is unrequested.
This is a read-path fix, so existing and newly created events receive the same
correct shape without a database migration. No compatibility adapter accepts
the erroneous array. The server also checks the inferred regional-reporting
type at compile time. Regression coverage exercises a newly created event,
authenticated HTTP under optional-query contention, web rendering and strict
Apple decoding; the deployment probe rejects an incorrect lightweight shape.

The iPhone/iPad overview uses the retained touch canvas with bundled Natural
Earth country geometry and the existing density/event/imagery overlays. It
focuses on the leading or selected country, supports country profile taps,
pinch/pan/reset and renders without Apple basemap tiles. Country counts retain
count units instead of a `/100` relevance label. The dedicated transport tracking
workspace remains separate.

Event visuals now include stored publisher photos on Apple as well as processed
satellite previews and observed-versus-baseline transport charts. Image matching
uses the event's last-activity window (72 hours before to 24 hours after). Related
article reuse additionally requires the same specific place and event type, or
an explicit event relationship. Satellite reuse still requires actual rendered
coverage. Recently collected bytes cannot make an old capture or old article
eligible. The same time window controls background overview image selection.
Article publication is never represented as a verified photograph capture date.
No image downloads, model inference or extra source fan-out run on event opening.

The event visual selector leads with available images or the recorded transport
comparison. Weather loads only after selection, through an authenticated,
optional-priority, cached endpoint. It reads one retained country reference
snapshot within six hours of the event update, and at most twelve temperature
forecast points from that provider. Temperature, precipitation, wind speed and
direction are rendered from those records. Reference geography is explicitly
separated from the event site; the line is labelled as a forecast, not observed
history. Missing samples return `weather: null`. The initial overview/event
request budget does not grow, and no generated weather or transport scene is used.

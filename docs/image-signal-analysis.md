# Image analysis and signals

Satellite previews and publisher photographs use the existing free-only
OpenRouter multimodal provider. Structured interpretations now include visible
truck and vessel count ranges, confidence, limitations and normalized detection
boxes. Unknown counts stay `null`, with `not_resolvable` status; obscured areas
are never silently counted as zero. A count describes visible objects in that
image, not a complete port inventory. One scene cannot establish whether a ship
is stationary or waiting, or whether congestion exists.

Satellite counts are checked against both sensor and delivered resolution.
Trucks require at most 1.5 m/pixel. Large vessels require at most 20 m/pixel and
boxes at least six delivered pixels long and two pixels wide. Counts from radar,
spectral indices, false-color products, unknown resolutions, or unknown/high
cloud coverage are withheld. These thresholds are conservative application
heuristics, not an accuracy guarantee. Our Sentinel-2 data cannot resolve trucks
reliably: its visible bands have 10 m native resolution. Upsampling does not add
sensor detail. Reference: https://www.esa.int/ESA_Multimedia/Images/2014/07/Sentinel-2_high-resolution_and_multispectral

Satellite count changes require an older scene within seven days at the same
location, AOI, product, mission, collection, sensor resolution, rendered scale,
and analyzed image dimensions. Only matching, confidence-qualified count scopes
are compared. Jobs and findings include the preview content hash; replacing pixels
clears old annotations and model evidence and queues fresh analysis. Overlapping uncertainty ranges indicate unresolved change. If no
comparable baseline is retained, only the current estimate is shown.

Confidence-qualified positive satellite counts add 1.5 relevance points;
a directional count change of at least five objects adds four. The total visual
bonus is capped at four points and comes only from scenes acquired within 72
hours. Repeated interpretations do not stack. The bonus does not increase event
confidence, source diversity, urgency or materiality. This is model evidence,
not an independent sensor measurement. The imagery workspace exposes estimates,
baseline changes and a bounded, idempotent analysis request for retained scenes.

## News image collection

An independent leased worker collects Open Graph, Twitter-card and article-owned
JSON-LD images from recent accepted news. Existing feed thumbnails are a fallback.
It does not scrape arbitrary page images, ads or logos. It fetches public HTTPS
resources with pinned DNS addresses, checked redirects, ten-second deadlines,
byte ceilings and image pixel limits. Each article contributes at most four
1024-pixel JPEG previews. Identical normalized images share content-addressed
storage and one model analysis, including when several articles reuse them.

Previews and associations live in `news_image_asset` and `news_article_image`.
Bytes and links expire after 14 days and are removed by the worker, along with
expired model evidence. Publisher attribution, article URL, source image URL,
caption, collection time and an explicit unverified-rights notice are retained.
Article publication time is not image capture time. Images do not inherit an
article feed's licence. Preview endpoints require authentication.

The imagery desk has a searchable news image collection; event details show
photos linked through their actual parent article. Images add model evidence to
that article's event. Reused identical photos count once per event. Capture time
and geography are unverified, so news image interpretations do not add a ranking
bonus or independent corroboration. Visible truck or vessel counts can still be
reviewed with optional detection boxes.

`NEWS_IMAGE_COLLECTION_ENABLED` and `NEWS_IMAGE_ANALYSIS_ENABLED` default to true.
`NEWS_IMAGE_MAX_DAILY_ARTICLES` defaults to 50 (zero pauses collection). Collection
and analysis run separately; missing vision configuration does not prevent image
retention. News inference can use at most three of the shared
`EO_VISION_MAX_DAILY_REQUESTS` (default 10), reserved atomically. The existing EO
vision feature flags, key, free-only model policy and zero-charge response checks
also govern news inference. Requests, including failed attempts, consume budget.
No new satellite acquisition or paid vision provider is introduced.

Migration V61 adds the image tables and queues up to 20 recent retained satellite
scenes for the version-two interpretation. Collection errors cannot fail news
or satellite ingestion. Bounded retries, worker leases, and persisted analysis
attempts allow recovery after a worker terminates.

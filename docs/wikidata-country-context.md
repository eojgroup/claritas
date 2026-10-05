# Country reference context

The leadership refresh also retrieves Wikidata capitals (P36), official languages
(P37), currencies (P38), neighbours (P47), flag references (P41), locator maps
(P242), and Earth coordinates (P625). Current best-ranked statements supply the
facts. Multiple capitals, currencies and languages are retained. References link
back to Wikidata, with the retrieval time and CC0 notice in the country panel.
The context is stored in the existing country leadership payload, so no migration
is needed. A failed context refresh preserves the previous snapshot independently
of elections and leadership refreshes.

Locator maps link to Wikimedia Commons. Raster thumbnails display only when
Commons returns a reusable licence and author attribution; source links survive
missing metadata or failed image requests. These files have their own licences,
not Wikidata's CC0. Their source depictions are preserved. Small decorative flags
use ISO country codes and the device's Unicode flag glyphs, avoiding a separate
image download per label. Unsupported codes have no flag.

P625 provides a representative country point, often at coarse precision. Preserve
and show the reported precision. These points position country aggregate markers
and center event maps only when event/evidence coordinates are unavailable. They
never create incident markers or replace measured event coordinates. Country
boundaries continue to use the existing Natural Earth dataset.

Country facts populate after the next successful scheduled leadership refresh.

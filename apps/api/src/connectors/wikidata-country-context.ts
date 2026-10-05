export type CountryReference = { id: string; name: string; source_url: string };
export type CountryMapReference = {
  source_url: string; file_name: string; thumbnail_url?: string;
  license?: string; license_url?: string; attribution?: string;
};
export type CountryContext = {
  capitals: CountryReference[]; languages: CountryReference[];
  currencies: CountryReference[]; neighbours: CountryReference[];
  coordinates: { latitude: number; longitude: number; precision_degrees: number | null; basis: "country_reference_point" } | null;
  locator_maps: CountryMapReference[]; flag: CountryMapReference | null;
  source_url: string; source_license: "CC0"; retrieved_at: string;
};
type Value = { value: string };
export type CountryContextBinding = Partial<Record<"country" | "iso2" | "property" | "value" | "valueLabel" | "latitude" | "longitude" | "precision", Value>>;
const userAgent = () => process.env.WIKIDATA_USER_AGENT?.trim() || "Claritas/0.1 (https://claritas.info; engineering@claritas.info)";
const entityId = (value?: string) => value?.match(/\/(Q\d+)$/)?.[1];

export function commonsReference(value?: string): CountryMapReference | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "commons.wikimedia.org" || !url.pathname.startsWith("/wiki/Special:FilePath/")) return null;
    const fileName = decodeURIComponent(url.pathname.slice("/wiki/Special:FilePath/".length)).replace(/_/g, " ");
    if (!fileName || fileName.length > 300) return null;
    return { file_name: fileName, source_url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName.replace(/ /g, "_"))}` };
  } catch { return null; }
}

export function normalizeCountryContext(rows: CountryContextBinding[], retrievedAt: string): Map<string, CountryContext> {
  const countries = new Map<string, CountryContext>();
  for (const row of rows) {
    const iso = row.iso2?.value.toUpperCase(); const id = entityId(row.country?.value);
    if (!iso || !/^[A-Z]{2}$/.test(iso) || !id) continue;
    const current = countries.get(iso) ?? { capitals: [], languages: [], currencies: [], neighbours: [], coordinates: null, locator_maps: [], flag: null, source_url: `https://www.wikidata.org/wiki/${id}`, source_license: "CC0", retrieved_at: retrievedAt } as CountryContext;
    const latitude = row.latitude ? Number(row.latitude.value) : NaN;
    const longitude = row.longitude ? Number(row.longitude.value) : NaN;
    const precision = row.precision ? Number(row.precision.value) : NaN;
    if (!current.coordinates && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      current.coordinates = { latitude, longitude, precision_degrees: Number.isFinite(precision) && precision > 0 ? precision : null, basis: "country_reference_point" };
    }
    const property = row.property?.value.match(/\/(P\d+)$/)?.[1];
    const field = ({ P36: "capitals", P37: "languages", P38: "currencies", P47: "neighbours" } as Record<string, "capitals" | "languages" | "currencies" | "neighbours">)[property ?? ""];
    const valueId = entityId(row.value?.value); const name = row.valueLabel?.value.trim();
    if (field && valueId && name && !/^Q\d+$/.test(name) && !current[field].some((entry) => entry.id === valueId)) current[field].push({ id: valueId, name, source_url: `https://www.wikidata.org/wiki/${valueId}` });
    if (property === "P41" || property === "P242") {
      const media = commonsReference(row.value?.value);
      if (media && property === "P41" && !current.flag) current.flag = media;
      if (media && property === "P242" && !current.locator_maps.some((map) => map.file_name === media.file_name)) current.locator_maps.push(media);
    }
    countries.set(iso, current);
  }
  return countries;
}

// Commons files have their own licences; Wikidata's CC0 does not cover images.
async function enrichMapThumbnails(contexts: Map<string, CountryContext>): Promise<void> {
  const maps = [...contexts.values()].flatMap((context) => context.locator_maps.slice(0, 2));
  const titles = [...new Set(maps.map((map) => `File:${map.file_name}`))];
  for (let offset = 0; offset < titles.length; offset += 50) {
    const url = new URL("https://commons.wikimedia.org/w/api.php");
    url.search = new URLSearchParams({ action: "query", format: "json", prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: "480", titles: titles.slice(offset, offset + 50).join("|") }).toString();
    try {
      const response = await fetch(url, { headers: { "user-agent": userAgent() }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) continue;
      const body = await response.json() as { query?: { pages?: Record<string, { title: string; imageinfo?: Array<{ thumburl?: string; extmetadata?: Record<string, { value?: string }> }> }> } };
      for (const page of Object.values(body.query?.pages ?? {})) {
        const info = page.imageinfo?.[0]; const metadata = info?.extmetadata;
        const text = (name: string) => metadata?.[name]?.value?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 1500);
        const license = text("LicenseShortName"); const attribution = text("Artist");
        if (!info?.thumburl || !/^https:\/\/(?:upload|thumb)\.wikimedia\.org\//.test(info.thumburl) || !license || !attribution) continue;
        // Display only reusable licences; other files remain source-page links.
        if (!/^(CC BY(?:-SA)? [\d.]+|CC0(?: [\d.]+)?|Public domain)$/i.test(license)) continue;
        for (const map of maps.filter((candidate) => `File:${candidate.file_name}`.replace(/_/g, " ") === page.title.replace(/_/g, " "))) {
          map.thumbnail_url = info.thumburl; map.license = license; map.attribution = attribution;
          const licenseUrl = metadata?.LicenseUrl?.value;
          if (licenseUrl?.startsWith("https://")) map.license_url = licenseUrl;
        }
      }
    } catch { /* Source links survive optional media-provider failures. */ }
  }
}

export async function fetchWikidataCountryContext(countryIds: string[]): Promise<Map<string, CountryContext>> {
  const ids = [...new Set(countryIds.filter((id) => /^Q\d+$/.test(id)))].slice(0, 250);
  if (!ids.length) return new Map();
  const query = `
    PREFIX wd: <http://www.wikidata.org/entity/>
    PREFIX wdt: <http://www.wikidata.org/prop/direct/>
    PREFIX p: <http://www.wikidata.org/prop/>
    PREFIX ps: <http://www.wikidata.org/prop/statement/>
    PREFIX psv: <http://www.wikidata.org/prop/statement/value/>
    PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
    PREFIX wikibase: <http://wikiba.se/ontology#>
    PREFIX bd: <http://www.bigdata.com/rdf#>
    SELECT ?country ?iso2 ?property ?value ?valueLabel ?latitude ?longitude ?precision WHERE {
      VALUES ?country { ${ids.map((id) => `wd:${id}`).join(" ")} }
      ?country wdt:P297 ?iso2.
      OPTIONAL {
        VALUES (?property ?claim ?statementProperty) {
          (wd:P36 p:P36 ps:P36) (wd:P37 p:P37 ps:P37) (wd:P38 p:P38 ps:P38)
          (wd:P47 p:P47 ps:P47) (wd:P41 p:P41 ps:P41) (wd:P242 p:P242 ps:P242)
        }
        ?country ?claim ?statement.
        ?statement a wikibase:BestRank; ?statementProperty ?value.
        FILTER NOT EXISTS { ?statement pq:P582 ?ended. }
      }
      OPTIONAL {
        ?country p:P625 ?coordinateStatement.
        ?coordinateStatement a wikibase:BestRank; psv:P625 ?coordinate.
        ?coordinate wikibase:geoLatitude ?latitude; wikibase:geoLongitude ?longitude;
          wikibase:geoGlobe wd:Q2.
        OPTIONAL { ?coordinate wikibase:geoPrecision ?precision. }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } ORDER BY ?iso2 ?property ?value LIMIT 15000`;
  const response = await fetch("https://query.wikidata.org/sparql", { method: "POST", headers: { accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded", "user-agent": userAgent() }, body: new URLSearchParams({ query, format: "json" }), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Wikidata country context failed (${response.status})`);
  const body = await response.json() as { results?: { bindings?: CountryContextBinding[] } };
  const rows = body.results?.bindings;
  if (!rows?.length || rows.length >= 15000) throw new Error("Incomplete country context; retaining previous snapshot.");
  const contexts = normalizeCountryContext(rows, new Date().toISOString());
  if (!contexts.size) throw new Error("No valid country context; retaining previous snapshot.");
  await enrichMapThumbnails(contexts);
  return contexts;
}

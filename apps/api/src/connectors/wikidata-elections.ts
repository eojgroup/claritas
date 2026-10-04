/** Wikidata election dates are reported schedules, never proof a vote took place. */
export type CountryElection = {
  id: string;
  title: string;
  date: string;
  date_precision: "day" | "month" | "year";
  election_type: string;
  source_url: string;
  source_license: "CC0";
  retrieved_at: string;
};
type Value = { value: string };
export type ElectionBinding = Partial<Record<"election" | "electionLabel" | "iso2" | "date" | "precision" | "typeLabel", Value>>;

export function normalizeElections(bindings: ElectionBinding[], retrievedAt: string): Map<string, CountryElection[]> {
  const countries = new Map<string, Map<string, CountryElection>>();
  for (const row of bindings) {
    const country = row.iso2?.value.trim().toUpperCase();
    const id = row.election?.value.match(/\/(Q\d+)$/)?.[1];
    const title = row.electionLabel?.value.trim();
    const date = row.date?.value;
    const precision = Number(row.precision?.value);
    if (!country || !/^[A-Z]{2}$/.test(country) || !id || !title || /^Q\d+$/.test(title)
      || !date || !Number.isFinite(Date.parse(date)) || precision < 9 || !Number.isFinite(precision)) continue;
    const entries = countries.get(country) ?? new Map<string, CountryElection>();
    const dateOnly = new Date(date).toISOString().slice(0, 10);
    entries.set(`${id}:${dateOnly}`, {
      id, title, date: dateOnly, date_precision: precision >= 11 ? "day" : precision === 10 ? "month" : "year",
      election_type: row.typeLabel?.value && !/^Q\d+$/.test(row.typeLabel.value) ? row.typeLabel.value : "Election",
      source_url: `https://www.wikidata.org/wiki/${id}`, source_license: "CC0", retrieved_at: retrievedAt,
    });
    countries.set(country, entries);
  }
  return new Map([...countries].map(([country, entries]) => [country, [...entries.values()].sort((a, b) => a.date.localeCompare(b.date))]));
}

export async function fetchWikidataElections(): Promise<Map<string, CountryElection[]>> {
  const now = new Date();
  const start = `${now.getUTCFullYear() - 1}-01-01T00:00:00Z`;
  const end = `${now.getUTCFullYear() + 3}-01-01T00:00:00Z`;
  const query = `
    PREFIX wd: <http://www.wikidata.org/entity/>
    PREFIX wdt: <http://www.wikidata.org/prop/direct/>
    PREFIX p: <http://www.wikidata.org/prop/>
    PREFIX psv: <http://www.wikidata.org/prop/statement/value/>
    PREFIX wikibase: <http://wikiba.se/ontology#>
    PREFIX bd: <http://www.bigdata.com/rdf#>
    PREFIX hint: <http://www.bigdata.com/queryHints#>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    SELECT DISTINCT ?election ?electionLabel ?iso2 ?date ?precision ?typeLabel WHERE {
      hint:Query hint:optimizer "None".
      ?type wdt:P279* wd:Q40231.
      ?election wdt:P31 ?type; wdt:P17 ?country; wdt:P585 ?date.
      FILTER(?date >= "${start}"^^xsd:dateTime && ?date < "${end}"^^xsd:dateTime)
      ?election p:P585/psv:P585 ?time.
      ?time wikibase:timeValue ?date; wikibase:timePrecision ?precision.
      ?country wdt:P297 ?iso2.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } ORDER BY ?date ?election LIMIT 10000`;
  const response = await fetch("https://query.wikidata.org/sparql", {
    method: "POST", headers: { accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded", "user-agent": process.env.WIKIDATA_USER_AGENT?.trim() || "Claritas/0.1 (https://claritas.info; engineering@claritas.info)" },
    body: new URLSearchParams({ query, format: "json" }), signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Wikidata elections request failed (${response.status})`);
  const body = await response.json() as { results?: { bindings?: ElectionBinding[] } };
  const bindings = body.results?.bindings;
  if (!Array.isArray(bindings) || bindings.length === 0 || bindings.length >= 10000) {
    throw new Error("Incomplete Wikidata election snapshot; retaining previous schedules.");
  }
  const normalized = normalizeElections(bindings, now.toISOString());
  if (!normalized.size) throw new Error("No valid election dates; retaining previous schedules.");
  return normalized;
}

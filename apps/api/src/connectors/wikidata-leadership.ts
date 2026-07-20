import { query, withTransaction } from "../db";

const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const WIKIDATA_ENTITY_URL = "https://www.wikidata.org/wiki";
const MIN_EXPECTED_COUNTRIES = 150;

const LEADERSHIP_QUERY = `
PREFIX schema: <http://schema.org/>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>

SELECT
  ?country
  ?countryLabel
  ?iso2
  ?governmentTypeLabel
  ?role
  ?leader
  ?leaderLabel
  ?startDate
  ?countryModified
WHERE {
  ?country wdt:P31 wd:Q3624078;
           wdt:P297 ?iso2.

  FILTER(STRLEN(?iso2) = 2)
  FILTER NOT EXISTS { ?country wdt:P576 ?dissolved. }

  {
    ?country wdt:P35 ?leader;
             p:P35 ?statement.
    ?statement ps:P35 ?leader.
    BIND("head_of_state" AS ?role)
  }
  UNION
  {
    ?country wdt:P6 ?leader;
             p:P6 ?statement.
    ?statement ps:P6 ?leader.
    BIND("head_of_government" AS ?role)
  }

  FILTER NOT EXISTS { ?statement pq:P582 ?ended. }

  OPTIONAL { ?statement pq:P580 ?startDate. }
  OPTIONAL { ?country wdt:P122 ?governmentType. }
  OPTIONAL { ?country schema:dateModified ?countryModified. }

  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
  }
}
ORDER BY ?countryLabel ?role ?leaderLabel
`;

export type LeadershipRoleType = "head_of_state" | "head_of_government";

export type CountryLeadershipRole = {
  role_type: LeadershipRoleType;
  person_name: string;
  person_wikidata_id: string;
  started_at: string | null;
  source_url: string;
};

export type CountryLeadership = {
  country: string;
  country_name: string;
  wikidata_country_id: string;
  government_type: string | null;
  summary: string;
  roles: CountryLeadershipRole[];
  source_name: "wikidata";
  source_url: string;
  source_license: "CC0";
  source_updated_at: string | null;
  retrieved_at: string;
};

export type LeadershipIngestResult = {
  fetched: number;
  countries: number;
  roles: number;
  inserted: number;
  updated: number;
  removed: number;
  skipped: number;
  source_updated_at: string | null;
  retrieved_at: string;
};

type SparqlValue = {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
};

type LeadershipBinding = {
  country?: SparqlValue;
  countryLabel?: SparqlValue;
  iso2?: SparqlValue;
  governmentTypeLabel?: SparqlValue;
  role?: SparqlValue;
  leader?: SparqlValue;
  leaderLabel?: SparqlValue;
  startDate?: SparqlValue;
  countryModified?: SparqlValue;
};

type SparqlResponse = {
  results?: {
    bindings?: LeadershipBinding[];
  };
};

type MutableCountryLeadership = {
  country: string;
  country_name: string;
  wikidata_country_id: string;
  government_types: Set<string>;
  roles: Map<string, CountryLeadershipRole>;
  source_updated_at: string | null;
};

type LeadershipDbRow = {
  country: string;
  country_name: string;
  wikidata_country_id: string;
  government_type: string | null;
  summary: string;
  source_name: string;
  source_url: string;
  source_license: string;
  source_updated_at: string | Date | null;
  retrieved_at: string | Date;
  role_type: string | null;
  person_name: string | null;
  person_wikidata_id: string | null;
  started_at: string | Date | null;
  role_source_url: string | null;
};

function entityId(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\/(Q\d+)$/);
  return match?.[1] ?? null;
}

function validIsoTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function latestTimestamp(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

function timestampToString(value: string | Date | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

function governmentTypeLabel(types: Set<string>): string | null {
  const values = Array.from(types)
    .map((value) => value.trim())
    .filter((value) => value && !/^Q\d+$/.test(value))
    .sort((a, b) => a.localeCompare(b));
  return values.length > 0 ? values.join(", ") : null;
}

function buildSummary(
  countryName: string,
  governmentType: string | null,
  roles: CountryLeadershipRole[]
): string {
  const stateLeaders = roles
    .filter((role) => role.role_type === "head_of_state")
    .map((role) => role.person_name);
  const governmentLeaders = roles
    .filter((role) => role.role_type === "head_of_government")
    .map((role) => role.person_name);

  const sentences: string[] = [];
  if (governmentType) {
    sentences.push(`${countryName} is described in Wikidata as ${governmentType}.`);
  }
  if (stateLeaders.length > 0) {
    sentences.push(`Head of state: ${stateLeaders.join(", ")}.`);
  }
  if (governmentLeaders.length > 0) {
    sentences.push(`Head of government: ${governmentLeaders.join(", ")}.`);
  }
  return sentences.join(" ") || `Current leadership records for ${countryName}.`;
}

async function fetchLeadershipBindings(): Promise<LeadershipBinding[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const userAgent =
    process.env.WIKIDATA_USER_AGENT?.trim() ||
    "Claritas/0.1 (https://claritas.info; engineering@claritas.info)";

  try {
    const body = new URLSearchParams({
      query: LEADERSHIP_QUERY,
      format: "json",
    });
    const response = await fetch(WIKIDATA_SPARQL_URL, {
      method: "POST",
      headers: {
        accept: "application/sparql-results+json",
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": userAgent,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 300);
      throw new Error(`Wikidata query failed (${response.status}): ${details}`);
    }
    const payload = (await response.json()) as SparqlResponse;
    return payload.results?.bindings ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBindings(bindings: LeadershipBinding[]): CountryLeadership[] {
  const countries = new Map<string, MutableCountryLeadership>();

  for (const binding of bindings) {
    const country = binding.iso2?.value.trim().toUpperCase();
    const countryName = binding.countryLabel?.value.trim();
    const countryId = entityId(binding.country?.value);
    const roleType = binding.role?.value as LeadershipRoleType | undefined;
    const personName = binding.leaderLabel?.value.trim();
    const personId = entityId(binding.leader?.value);

    if (
      !country ||
      country.length !== 2 ||
      !countryName ||
      !countryId ||
      (roleType !== "head_of_state" && roleType !== "head_of_government") ||
      !personName ||
      !personId
    ) {
      continue;
    }

    const existing = countries.get(country) ?? {
      country,
      country_name: countryName,
      wikidata_country_id: countryId,
      government_types: new Set<string>(),
      roles: new Map<string, CountryLeadershipRole>(),
      source_updated_at: null,
    };

    const governmentType = binding.governmentTypeLabel?.value.trim();
    if (governmentType) existing.government_types.add(governmentType);

    const role: CountryLeadershipRole = {
      role_type: roleType,
      person_name: personName,
      person_wikidata_id: personId,
      started_at: validIsoTimestamp(binding.startDate?.value),
      source_url: `${WIKIDATA_ENTITY_URL}/${personId}`,
    };
    const roleKey = `${roleType}:${personId}`;
    const priorRole = existing.roles.get(roleKey);
    if (!priorRole || (!priorRole.started_at && role.started_at)) {
      existing.roles.set(roleKey, role);
    }

    existing.source_updated_at = latestTimestamp(
      existing.source_updated_at,
      validIsoTimestamp(binding.countryModified?.value)
    );
    countries.set(country, existing);
  }

  return Array.from(countries.values())
    .map((country) => {
      const governmentType = governmentTypeLabel(country.government_types);
      const roles = Array.from(country.roles.values()).sort((a, b) => {
        const roleOrder = a.role_type.localeCompare(b.role_type);
        return roleOrder !== 0 ? roleOrder : a.person_name.localeCompare(b.person_name);
      });
      return {
        country: country.country,
        country_name: country.country_name,
        wikidata_country_id: country.wikidata_country_id,
        government_type: governmentType,
        summary: buildSummary(country.country_name, governmentType, roles),
        roles,
        source_name: "wikidata" as const,
        source_url: `${WIKIDATA_ENTITY_URL}/${country.wikidata_country_id}`,
        source_license: "CC0" as const,
        source_updated_at: country.source_updated_at,
        retrieved_at: "",
      };
    })
    .sort((a, b) => a.country_name.localeCompare(b.country_name));
}

export async function ingestWikidataLeadership(): Promise<LeadershipIngestResult> {
  const bindings = await fetchLeadershipBindings();
  const retrievedAt = new Date().toISOString();
  const countries = normalizeBindings(bindings).map((country) => ({
    ...country,
    retrieved_at: retrievedAt,
  }));

  if (countries.length < MIN_EXPECTED_COUNTRIES) {
    throw new Error(
      `Wikidata leadership query returned only ${countries.length} countries; refusing to replace the current snapshot.`
    );
  }

  const existing = await query<{ country: string }>(
    `SELECT upper(country_iso2) AS country FROM country_leadership`
  );
  const existingCountries = new Set(existing.rows.map((row) => row.country.trim().toUpperCase()));

  const removed = await withTransaction(async (client) => {
    for (const country of countries) {
      await client.query(
        `INSERT INTO country (iso2, name, ext)
         VALUES ($1::char(2), $2, jsonb_build_object('wikidata_id', $3::text))
         ON CONFLICT (iso2) DO UPDATE SET
           name = EXCLUDED.name,
           ext = COALESCE(country.ext, '{}'::jsonb) || EXCLUDED.ext`,
        [country.country, country.country_name, country.wikidata_country_id]
      );

      await client.query(
        `INSERT INTO country_leadership (
           country_iso2, country_name, wikidata_country_id, government_type,
           summary, source_name, source_url, source_license, source_updated_at,
           retrieved_at, payload
         )
         VALUES ($1::char(2), $2, $3, $4, $5, 'wikidata', $6, 'CC0', $7, $8, $9)
         ON CONFLICT (country_iso2) DO UPDATE SET
           country_name = EXCLUDED.country_name,
           wikidata_country_id = EXCLUDED.wikidata_country_id,
           government_type = EXCLUDED.government_type,
           summary = EXCLUDED.summary,
           source_name = EXCLUDED.source_name,
           source_url = EXCLUDED.source_url,
           source_license = EXCLUDED.source_license,
           source_updated_at = EXCLUDED.source_updated_at,
           retrieved_at = EXCLUDED.retrieved_at,
           payload = EXCLUDED.payload`,
        [
          country.country,
          country.country_name,
          country.wikidata_country_id,
          country.government_type,
          country.summary,
          country.source_url,
          country.source_updated_at,
          country.retrieved_at,
          JSON.stringify({ role_count: country.roles.length }),
        ]
      );

      await client.query(
        `DELETE FROM country_leadership_role WHERE country_iso2 = $1::char(2)`,
        [country.country]
      );

      for (const role of country.roles) {
        await client.query(
          `INSERT INTO country_leadership_role (
             country_iso2, role_type, person_name, person_wikidata_id,
             started_at, source_url, payload
           )
           VALUES ($1::char(2), $2, $3, $4, $5, $6, '{}'::jsonb)`,
          [
            country.country,
            role.role_type,
            role.person_name,
            role.person_wikidata_id,
            role.started_at,
            role.source_url,
          ]
        );
      }
    }

    const isoCodes = countries.map((country) => country.country);
    const result = await client.query(
      `DELETE FROM country_leadership
       WHERE NOT (upper(country_iso2) = ANY($1::text[]))`,
      [isoCodes]
    );
    return result.rowCount ?? 0;
  });

  const inserted = countries.filter((country) => !existingCountries.has(country.country)).length;
  const sourceUpdatedAt = countries.reduce<string | null>(
    (latest, country) => latestTimestamp(latest, country.source_updated_at),
    null
  );

  return {
    fetched: bindings.length,
    countries: countries.length,
    roles: countries.reduce((total, country) => total + country.roles.length, 0),
    inserted,
    updated: countries.length - inserted,
    removed,
    skipped: 0,
    source_updated_at: sourceUpdatedAt,
    retrieved_at: retrievedAt,
  };
}

export async function getCountryLeadershipLatest(): Promise<CountryLeadership[]> {
  const { rows } = await query<LeadershipDbRow>(
    `SELECT
       upper(cl.country_iso2) AS country,
       cl.country_name,
       cl.wikidata_country_id,
       cl.government_type,
       cl.summary,
       cl.source_name,
       cl.source_url,
       cl.source_license,
       cl.source_updated_at,
       cl.retrieved_at,
       clr.role_type,
       clr.person_name,
       clr.person_wikidata_id,
       clr.started_at,
       clr.source_url AS role_source_url
     FROM country_leadership cl
     LEFT JOIN country_leadership_role clr
       ON clr.country_iso2 = cl.country_iso2
     ORDER BY cl.country_name, clr.role_type, clr.person_name`
  );

  const countries = new Map<string, CountryLeadership>();
  for (const row of rows) {
    const country = row.country.trim().toUpperCase();
    const current = countries.get(country) ?? {
      country,
      country_name: row.country_name,
      wikidata_country_id: row.wikidata_country_id,
      government_type: row.government_type,
      summary: row.summary,
      roles: [],
      source_name: "wikidata",
      source_url: row.source_url,
      source_license: "CC0",
      source_updated_at: timestampToString(row.source_updated_at),
      retrieved_at: timestampToString(row.retrieved_at) ?? new Date(0).toISOString(),
    };
    if (
      (row.role_type === "head_of_state" || row.role_type === "head_of_government") &&
      row.person_name &&
      row.person_wikidata_id &&
      row.role_source_url
    ) {
      current.roles.push({
        role_type: row.role_type,
        person_name: row.person_name,
        person_wikidata_id: row.person_wikidata_id,
        started_at: timestampToString(row.started_at),
        source_url: row.role_source_url,
      });
    }
    countries.set(country, current);
  }
  return Array.from(countries.values());
}

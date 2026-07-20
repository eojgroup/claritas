"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestWikidataLeadership = ingestWikidataLeadership;
exports.getCountryLeadershipLatest = getCountryLeadershipLatest;
const db_1 = require("../db");
const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const WIKIDATA_ENTITY_URL = "https://www.wikidata.org/wiki";
const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
const MIN_EXPECTED_COUNTRIES = 150;
const entityLabelCache = new Map();
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
function entityId(value) {
    if (!value)
        return null;
    const match = value.match(/\/(Q\d+)$/);
    return match?.[1] ?? null;
}
function isEntityIdLabel(value) {
    return !value || /^Q\d+$/i.test(value.trim());
}
async function resolveEntityLabels(ids) {
    const uniqueIds = Array.from(new Set(ids.filter((id) => /^Q\d+$/.test(id))));
    const resolved = new Map();
    uniqueIds.forEach((id) => {
        const cached = entityLabelCache.get(id);
        if (cached)
            resolved.set(id, cached);
    });
    const missing = uniqueIds.filter((id) => !resolved.has(id));
    for (let offset = 0; offset < missing.length; offset += 50) {
        const batch = missing.slice(offset, offset + 50);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
            const url = new URL(WIKIDATA_API_URL);
            url.searchParams.set("action", "wbgetentities");
            url.searchParams.set("format", "json");
            url.searchParams.set("props", "labels");
            url.searchParams.set("languages", "en|mul|es");
            url.searchParams.set("languagefallback", "1");
            url.searchParams.set("ids", batch.join("|"));
            const response = await fetch(url, {
                headers: {
                    accept: "application/json",
                    "user-agent": process.env.WIKIDATA_USER_AGENT?.trim() ||
                        "Claritas/0.1 (https://claritas.info; engineering@claritas.info)",
                },
                signal: controller.signal,
            });
            if (!response.ok)
                continue;
            const payload = (await response.json());
            batch.forEach((id) => {
                const label = payload.entities?.[id]?.labels?.en?.value?.trim();
                if (!isEntityIdLabel(label)) {
                    entityLabelCache.set(id, label);
                    resolved.set(id, label);
                }
            });
        }
        catch {
            // The leadership response retains a safe unavailable-name fallback.
        }
        finally {
            clearTimeout(timeout);
        }
    }
    return resolved;
}
function validIsoTimestamp(value) {
    if (!value)
        return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}
function latestTimestamp(current, candidate) {
    if (!candidate)
        return current;
    if (!current)
        return candidate;
    return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}
function timestampToString(value) {
    if (value == null)
        return null;
    if (value instanceof Date)
        return value.toISOString();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}
function governmentTypeLabel(types) {
    const values = Array.from(types)
        .map((value) => value.trim())
        .filter((value) => value && !/^Q\d+$/.test(value))
        .sort((a, b) => a.localeCompare(b));
    return values.length > 0 ? values.join(", ") : null;
}
function buildSummary(countryName, governmentType, roles) {
    const stateLeaders = roles
        .filter((role) => role.role_type === "head_of_state")
        .map((role) => role.person_name);
    const governmentLeaders = roles
        .filter((role) => role.role_type === "head_of_government")
        .map((role) => role.person_name);
    const sentences = [];
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
async function fetchLeadershipBindings() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const userAgent = process.env.WIKIDATA_USER_AGENT?.trim() ||
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
        const payload = (await response.json());
        const bindings = payload.results?.bindings ?? [];
        const unresolvedIds = bindings.flatMap((binding) => {
            const id = entityId(binding.leader?.value);
            return id && isEntityIdLabel(binding.leaderLabel?.value) ? [id] : [];
        });
        if (unresolvedIds.length === 0)
            return bindings;
        const labels = await resolveEntityLabels(unresolvedIds);
        return bindings.map((binding) => {
            const id = entityId(binding.leader?.value);
            const resolvedLabel = id ? labels.get(id) : undefined;
            return resolvedLabel
                ? {
                    ...binding,
                    leaderLabel: { type: "literal", value: resolvedLabel, "xml:lang": "en" },
                }
                : binding;
        });
    }
    finally {
        clearTimeout(timeout);
    }
}
function normalizeBindings(bindings) {
    const countries = new Map();
    for (const binding of bindings) {
        const country = binding.iso2?.value.trim().toUpperCase();
        const countryName = binding.countryLabel?.value.trim();
        const countryId = entityId(binding.country?.value);
        const roleType = binding.role?.value;
        const rawPersonName = binding.leaderLabel?.value.trim();
        const personId = entityId(binding.leader?.value);
        const personName = isEntityIdLabel(rawPersonName)
            ? "Name unavailable"
            : rawPersonName;
        if (!country ||
            country.length !== 2 ||
            !countryName ||
            !countryId ||
            (roleType !== "head_of_state" && roleType !== "head_of_government") ||
            !personName ||
            !personId) {
            continue;
        }
        const existing = countries.get(country) ?? {
            country,
            country_name: countryName,
            wikidata_country_id: countryId,
            government_types: new Set(),
            roles: new Map(),
            source_updated_at: null,
        };
        const governmentType = binding.governmentTypeLabel?.value.trim();
        if (governmentType)
            existing.government_types.add(governmentType);
        const role = {
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
        existing.source_updated_at = latestTimestamp(existing.source_updated_at, validIsoTimestamp(binding.countryModified?.value));
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
            source_name: "wikidata",
            source_url: `${WIKIDATA_ENTITY_URL}/${country.wikidata_country_id}`,
            source_license: "CC0",
            source_updated_at: country.source_updated_at,
            retrieved_at: "",
        };
    })
        .sort((a, b) => a.country_name.localeCompare(b.country_name));
}
async function ingestWikidataLeadership() {
    const bindings = await fetchLeadershipBindings();
    const retrievedAt = new Date().toISOString();
    const countries = normalizeBindings(bindings).map((country) => ({
        ...country,
        retrieved_at: retrievedAt,
    }));
    if (countries.length < MIN_EXPECTED_COUNTRIES) {
        throw new Error(`Wikidata leadership query returned only ${countries.length} countries; refusing to replace the current snapshot.`);
    }
    const existing = await (0, db_1.query)(`SELECT upper(country_iso2) AS country FROM country_leadership`);
    const existingCountries = new Set(existing.rows.map((row) => row.country.trim().toUpperCase()));
    const removed = await (0, db_1.withTransaction)(async (client) => {
        for (const country of countries) {
            await client.query(`INSERT INTO country (iso2, name, ext)
         VALUES ($1::char(2), $2, jsonb_build_object('wikidata_id', $3::text))
         ON CONFLICT (iso2) DO UPDATE SET
           name = EXCLUDED.name,
           ext = COALESCE(country.ext, '{}'::jsonb) || EXCLUDED.ext`, [country.country, country.country_name, country.wikidata_country_id]);
            await client.query(`INSERT INTO country_leadership (
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
           payload = EXCLUDED.payload`, [
                country.country,
                country.country_name,
                country.wikidata_country_id,
                country.government_type,
                country.summary,
                country.source_url,
                country.source_updated_at,
                country.retrieved_at,
                JSON.stringify({ role_count: country.roles.length }),
            ]);
            await client.query(`DELETE FROM country_leadership_role WHERE country_iso2 = $1::char(2)`, [country.country]);
            for (const role of country.roles) {
                await client.query(`INSERT INTO country_leadership_role (
             country_iso2, role_type, person_name, person_wikidata_id,
             started_at, source_url, payload
           )
           VALUES ($1::char(2), $2, $3, $4, $5, $6, '{}'::jsonb)`, [
                    country.country,
                    role.role_type,
                    role.person_name,
                    role.person_wikidata_id,
                    role.started_at,
                    role.source_url,
                ]);
            }
        }
        const isoCodes = countries.map((country) => country.country);
        const result = await client.query(`DELETE FROM country_leadership
       WHERE NOT (upper(country_iso2) = ANY($1::text[]))`, [isoCodes]);
        return result.rowCount ?? 0;
    });
    const inserted = countries.filter((country) => !existingCountries.has(country.country)).length;
    const sourceUpdatedAt = countries.reduce((latest, country) => latestTimestamp(latest, country.source_updated_at), null);
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
async function getCountryLeadershipLatest() {
    const { rows } = await (0, db_1.query)(`SELECT
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
     ORDER BY cl.country_name, clr.role_type, clr.person_name`);
    const unresolvedLabels = await resolveEntityLabels(rows.flatMap((row) => row.person_wikidata_id && isEntityIdLabel(row.person_name)
        ? [row.person_wikidata_id]
        : []));
    if (unresolvedLabels.size > 0) {
        await Promise.all(Array.from(unresolvedLabels.entries()).map(([personId, personName]) => (0, db_1.query)(`UPDATE country_leadership_role
           SET person_name = $2, updated_at = now()
           WHERE person_wikidata_id = $1
             AND person_name ~ '^Q[0-9]+$'`, [personId, personName])));
    }
    const countries = new Map();
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
        if ((row.role_type === "head_of_state" || row.role_type === "head_of_government") &&
            row.person_name &&
            row.person_wikidata_id &&
            row.role_source_url) {
            current.roles.push({
                role_type: row.role_type,
                person_name: isEntityIdLabel(row.person_name)
                    ? unresolvedLabels.get(row.person_wikidata_id) ?? "Name unavailable"
                    : row.person_name,
                person_wikidata_id: row.person_wikidata_id,
                started_at: timestampToString(row.started_at),
                source_url: row.role_source_url,
            });
        }
        countries.set(country, current);
    }
    return Array.from(countries.values()).map((country) => ({
        ...country,
        summary: buildSummary(country.country_name, country.government_type, country.roles),
    }));
}

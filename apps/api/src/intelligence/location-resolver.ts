import { query } from "../db";
import { normalizeLocationAlias } from "./location-normalization";

export { normalizeLocationAlias } from "./location-normalization";

export type ResolvedLocation = {
  id: string;
  slug: string;
  location_type: string;
  canonical_name: string;
  country_iso2: string | null;
  latitude: number | null;
  longitude: number | null;
  importance_score: number;
  monitoring_tier: number;
  match_basis: "alias" | "identifier" | "coordinate";
  confidence: number;
};

export async function resolveKnownLocation(
  value: string,
  options: { countryIso2?: string | null; identifierScheme?: string | null } = {},
): Promise<ResolvedLocation | null> {
  const normalized = normalizeLocationAlias(value);
  if (!normalized || normalized.length > 180) return null;
  const country = options.countryIso2?.trim().toUpperCase() || null;
  if (options.identifierScheme) {
    const { rows } = await query<ResolvedLocation>(
      `SELECT location.id, location.slug, location.location_type, location.canonical_name,
              location.country_iso2, location.latitude, location.longitude,
              location.importance_score, location.monitoring_tier,
              'identifier'::text AS match_basis, 1::double precision AS confidence
       FROM intelligence_location_identifier identifier
       JOIN intelligence_location location ON location.id = identifier.location_id
       WHERE upper(identifier.identifier_scheme) = upper($1)
         AND upper(identifier.identifier_value) = upper($2)
         AND location.active
         AND ($3::text IS NULL OR location.country_iso2 = $3)
       ORDER BY location.importance_score DESC
       LIMIT 2`,
      [options.identifierScheme, value.trim(), country],
    );
    return rows.length === 1 ? rows[0] : null;
  }
  const { rows } = await query<ResolvedLocation>(
    `SELECT location.id, location.slug, location.location_type, location.canonical_name,
            location.country_iso2, location.latitude, location.longitude,
            location.importance_score, location.monitoring_tier,
            'alias'::text AS match_basis, alias.confidence
     FROM intelligence_location_alias alias
     JOIN intelligence_location location ON location.id = alias.location_id
     WHERE alias.normalized_alias = $1
       AND location.active
       AND ($2::text IS NULL OR location.country_iso2 = $2 OR location.country_iso2 IS NULL)
     ORDER BY alias.confidence DESC, location.importance_score DESC
     LIMIT 2`,
    [normalized, country],
  );
  if (rows.length !== 1) return null;
  return rows[0];
}

export async function resolveNearestLocation(
  latitude: number,
  longitude: number,
  radiusKm = 100,
  locationTypes?: string[],
): Promise<ResolvedLocation | null> {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const boundedRadius = Math.min(1_000, Math.max(1, radiusKm));
  const { rows } = await query<ResolvedLocation & { distance_km: number }>(
    `SELECT id, slug, location_type, canonical_name, country_iso2, latitude, longitude,
            importance_score, monitoring_tier, 'coordinate'::text AS match_basis,
            GREATEST(0.5, 1 - ST_Distance(center, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / ($3 * 1000)) AS confidence,
            ST_Distance(center, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 AS distance_km
     FROM intelligence_location
     WHERE active AND center IS NOT NULL
       AND ST_DWithin(center, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3 * 1000)
       AND ($4::text[] IS NULL OR location_type = ANY($4))
     ORDER BY center <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
              importance_score DESC
     LIMIT 1`,
    [latitude, longitude, boundedRadius, locationTypes?.length ? locationTypes : null],
  );
  return rows[0] ?? null;
}

export async function resolveLocationFromText(
  value: string,
  countryIso2?: string | null,
): Promise<ResolvedLocation | null> {
  const normalized = normalizeLocationAlias(value).slice(0, 8_000);
  if (!normalized) return null;
  const country = countryIso2?.trim().toUpperCase() || null;
  const { rows } = await query<ResolvedLocation & { alias_length: number }>(
    `SELECT location.id, location.slug, location.location_type, location.canonical_name,
            location.country_iso2, location.latitude, location.longitude,
            location.importance_score, location.monitoring_tier,
            'alias'::text AS match_basis, alias.confidence,
            length(alias.normalized_alias)::int AS alias_length
     FROM intelligence_location_alias alias
     JOIN intelligence_location location ON location.id = alias.location_id
     WHERE length(alias.normalized_alias) >= 3
       AND position(alias.normalized_alias in $1) > 0
       AND location.active
       AND ($2::text IS NULL OR location.country_iso2 = $2 OR location.country_iso2 IS NULL)
     ORDER BY length(alias.normalized_alias) DESC, alias.confidence DESC,
              location.importance_score DESC
     LIMIT 2`,
    [normalized, country],
  );
  if (!rows[0]) return null;
  if (rows[1] && rows[0].alias_length === rows[1].alias_length && rows[0].id !== rows[1].id) return null;
  return rows[0];
}

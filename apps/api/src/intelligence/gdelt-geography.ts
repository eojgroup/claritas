const CITY_GEO_TYPES = new Set([3, 4]);

function finiteCoordinate(latitudeValue: unknown, longitudeValue: unknown) {
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

/**
 * GDELT geography types 1, 2 and 5 are country/admin centroids. They are
 * useful context but not defensible satellite targets. Only city/local place
 * types 3 and 4 can seed event imagery.
 */
export function trustedGdeltLocations(payload: unknown): Array<{
  latitude: number;
  longitude: number;
  name: string | null;
}> {
  const record = payload && typeof payload === "object" ? payload as Record<string, any> : {};
  const locations = Array.isArray(record.gkg?.locations) ? record.gkg.locations : [];
  return locations.slice(0, 30).flatMap((candidate: any) => {
    if (!CITY_GEO_TYPES.has(Number(candidate?.type))) return [];
    const coordinate = finiteCoordinate(candidate?.latitude, candidate?.longitude);
    if (!coordinate) return [];
    return [{
      ...coordinate,
      name: typeof candidate?.name === "string" && candidate.name.trim()
        ? candidate.name.trim()
        : null,
    }];
  });
}

export function trustedGdeltActionCoordinate(record: {
  action_lat?: unknown;
  action_lon?: unknown;
  payload?: unknown;
}) {
  const payload = record.payload && typeof record.payload === "object"
    ? record.payload as Record<string, any>
    : {};
  if (!CITY_GEO_TYPES.has(Number(payload.action_geo?.type))) return null;
  return finiteCoordinate(record.action_lat, record.action_lon);
}

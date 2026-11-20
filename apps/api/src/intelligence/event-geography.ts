import { haversineDistanceKm } from "./correlation";

export const NAMED_POINT_LOCATION_TYPES = ["city", "port", "airport", "strait", "canal", "chokepoint", "industrial_facility", "refinery", "lng_terminal", "rail_terminal", "dam", "strategic_site", "point"];

// Local-place enrichment must agree with the event's retained named place.
// Broad countries/regions are not a precise anchor. Physical observations
// retain their own, independently observed coordinates.
export function newsCoordinateConflictsWithLocation(
  coordinate: { latitude: number; longitude: number },
  location: { location_type: string; latitude: number | null; longitude: number | null } | null,
) {
  if (!location || !NAMED_POINT_LOCATION_TYPES.includes(location.location_type)
    || location.latitude == null || location.longitude == null) return false;
  return haversineDistanceKm(coordinate.latitude, coordinate.longitude, Number(location.latitude), Number(location.longitude)) > 150;
}

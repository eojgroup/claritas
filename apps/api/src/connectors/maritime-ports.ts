import type { AisBoundingBox } from "./ais-subscription";

export type MaritimePort = {
  name: string;
  iso2: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  pattern: RegExp;
};

/**
 * Ports used for explicit position linkage and arrival/departure transitions.
 * Keep this list as the single source of truth for the default AISstream
 * subscription so ingestion capacity is spent on places Claritas can explain.
 */
export const MARITIME_PORTS: MaritimePort[] = [
  { name: "Los Angeles / Long Beach", iso2: "US", latitude: 33.74, longitude: -118.24, radius_km: 42, pattern: /\b(?:USLAX|USLGB|LOS ANGELES|LONG BEACH)\b/i },
  { name: "New York / Newark", iso2: "US", latitude: 40.67, longitude: -74.08, radius_km: 45, pattern: /\b(?:USNYC|USNWK|NEW YORK|NEWARK)\b/i },
  { name: "Savannah", iso2: "US", latitude: 32.08, longitude: -81.09, radius_km: 32, pattern: /\b(?:USSAV|SAVANNAH)\b/i },
  { name: "Vancouver", iso2: "CA", latitude: 49.30, longitude: -123.11, radius_km: 42, pattern: /\b(?:CAVAN|VANCOUVER)\b/i },
  { name: "Santos", iso2: "BR", latitude: -23.96, longitude: -46.30, radius_km: 36, pattern: /\b(?:BRSSZ|SANTOS)\b/i },
  { name: "Rotterdam", iso2: "NL", latitude: 51.95, longitude: 4.14, radius_km: 48, pattern: /\b(?:NLRTM|ROTTERDAM)\b/i },
  { name: "Antwerp-Bruges", iso2: "BE", latitude: 51.27, longitude: 4.34, radius_km: 42, pattern: /\b(?:BEANR|ANTWERP|BRUGES)\b/i },
  { name: "Hamburg", iso2: "DE", latitude: 53.54, longitude: 9.93, radius_km: 32, pattern: /\b(?:DEHAM|HAMBURG)\b/i },
  { name: "Copenhagen", iso2: "DK", latitude: 55.68, longitude: 12.60, radius_km: 32, pattern: /\b(?:DKCPH|COPENHAGEN|KOBENHAVN|KØBENHAVN)\b/i },
  { name: "Aarhus", iso2: "DK", latitude: 56.15, longitude: 10.25, radius_km: 32, pattern: /(?:\b(?:DKAAR|AARHUS)\b|ÅRHUS)/i },
  { name: "Oslo", iso2: "NO", latitude: 59.90, longitude: 10.75, radius_km: 34, pattern: /\b(?:NOOSL|OSLO)\b/i },
  { name: "Bergen", iso2: "NO", latitude: 60.39, longitude: 5.32, radius_km: 36, pattern: /\b(?:NOBGO|BERGEN)\b/i },
  { name: "Felixstowe", iso2: "GB", latitude: 51.95, longitude: 1.31, radius_km: 30, pattern: /\b(?:GBFXT|FELIXSTOWE)\b/i },
  { name: "Southampton", iso2: "GB", latitude: 50.90, longitude: -1.40, radius_km: 30, pattern: /\b(?:GBSOU|SOUTHAMPTON)\b/i },
  { name: "Algeciras", iso2: "ES", latitude: 36.13, longitude: -5.44, radius_km: 32, pattern: /\b(?:ESALG|ALGECIRAS)\b/i },
  { name: "Valencia", iso2: "ES", latitude: 39.44, longitude: -0.31, radius_km: 30, pattern: /\b(?:ESVLC|VALENCIA)\b/i },
  { name: "Piraeus", iso2: "GR", latitude: 37.94, longitude: 23.63, radius_km: 28, pattern: /\b(?:GRPIR|PIRAEUS)\b/i },
  { name: "Port Said", iso2: "EG", latitude: 31.25, longitude: 32.31, radius_km: 38, pattern: /\b(?:EGPSD|PORT SAID|SUEZ)\b/i },
  { name: "Jebel Ali", iso2: "AE", latitude: 25.01, longitude: 55.06, radius_km: 38, pattern: /\b(?:AEJEA|JEBEL ALI|DUBAI)\b/i },
  { name: "Singapore", iso2: "SG", latitude: 1.25, longitude: 103.82, radius_km: 55, pattern: /\b(?:SGSIN|SINGAPORE)\b/i },
  { name: "Shanghai", iso2: "CN", latitude: 31.23, longitude: 121.50, radius_km: 55, pattern: /\b(?:CNSHA|SHANGHAI)\b/i },
  { name: "Ningbo-Zhoushan", iso2: "CN", latitude: 29.87, longitude: 121.84, radius_km: 55, pattern: /\b(?:CNNGB|NINGBO|ZHOUSHAN)\b/i },
  { name: "Shenzhen", iso2: "CN", latitude: 22.51, longitude: 113.88, radius_km: 42, pattern: /\b(?:CNSZX|SHENZHEN|YANTIAN)\b/i },
  { name: "Hong Kong", iso2: "HK", latitude: 22.30, longitude: 114.16, radius_km: 38, pattern: /\b(?:HKHKG|HONG KONG)\b/i },
  { name: "Busan", iso2: "KR", latitude: 35.10, longitude: 129.04, radius_km: 34, pattern: /\b(?:KRPUS|BUSAN)\b/i },
  { name: "Yokohama", iso2: "JP", latitude: 35.45, longitude: 139.65, radius_km: 32, pattern: /\b(?:JPYOK|YOKOHAMA)\b/i },
  { name: "Tokyo", iso2: "JP", latitude: 35.62, longitude: 139.78, radius_km: 32, pattern: /\b(?:JPTYO|TOKYO)\b/i },
  { name: "Port Klang", iso2: "MY", latitude: 3.00, longitude: 101.39, radius_km: 34, pattern: /\b(?:MYPKG|PORT KLANG)\b/i },
  { name: "Tanjung Pelepas", iso2: "MY", latitude: 1.36, longitude: 103.55, radius_km: 30, pattern: /\b(?:MYTPP|TANJUNG PELEPAS)\b/i },
  { name: "Colombo", iso2: "LK", latitude: 6.95, longitude: 79.84, radius_km: 32, pattern: /\b(?:LKCMB|COLOMBO)\b/i },
  { name: "Nhava Sheva", iso2: "IN", latitude: 18.95, longitude: 72.95, radius_km: 36, pattern: /\b(?:INNSA|NHAVA SHEVA|JAWAHARLAL NEHRU)\b/i },
  { name: "Mundra", iso2: "IN", latitude: 22.74, longitude: 69.71, radius_km: 34, pattern: /\b(?:INMUN|MUNDRA)\b/i },
  { name: "Sydney", iso2: "AU", latitude: -33.86, longitude: 151.20, radius_km: 32, pattern: /\b(?:AUSYD|SYDNEY)\b/i },
  { name: "Melbourne", iso2: "AU", latitude: -37.84, longitude: 144.91, radius_km: 34, pattern: /\b(?:AUMEL|MELBOURNE)\b/i },
  { name: "Durban", iso2: "ZA", latitude: -29.87, longitude: 31.04, radius_km: 32, pattern: /\b(?:ZADUR|DURBAN)\b/i },
  { name: "Cape Town", iso2: "ZA", latitude: -33.91, longitude: 18.44, radius_km: 32, pattern: /\b(?:ZACPT|CAPE TOWN)\b/i },
];

const KILOMETRES_PER_LATITUDE_DEGREE = 111.32;

export const DEFAULT_MONITORED_PORT_AIS_RADIUS_KM = 110;

export function aisBoundingBoxAroundPort(
  port: Pick<MaritimePort, "latitude" | "longitude" | "radius_km">,
  minimumRadiusKm = DEFAULT_MONITORED_PORT_AIS_RADIUS_KM,
): AisBoundingBox {
  const radiusKm = Math.max(port.radius_km, minimumRadiusKm);
  const latitudeDelta = radiusKm / KILOMETRES_PER_LATITUDE_DEGREE;
  const longitudeScale = Math.max(
    0.01,
    Math.cos((port.latitude * Math.PI) / 180),
  );
  const longitudeDelta =
    radiusKm / (KILOMETRES_PER_LATITUDE_DEGREE * longitudeScale);
  return [
    [
      Math.max(-90, port.latitude - latitudeDelta),
      Math.max(-180, port.longitude - longitudeDelta),
    ],
    [
      Math.min(90, port.latitude + latitudeDelta),
      Math.min(180, port.longitude + longitudeDelta),
    ],
  ];
}

export function monitoredPortAisBoundingBoxes(
  minimumRadiusKm = DEFAULT_MONITORED_PORT_AIS_RADIUS_KM,
): AisBoundingBox[] {
  return MARITIME_PORTS.map((port) =>
    aisBoundingBoxAroundPort(port, minimumRadiusKm),
  );
}

export function aisBoundingBoxContains(
  box: AisBoundingBox,
  latitude: number,
  longitude: number,
): boolean {
  return (
    latitude >= box[0][0] &&
    latitude <= box[1][0] &&
    longitude >= box[0][1] &&
    longitude <= box[1][1]
  );
}

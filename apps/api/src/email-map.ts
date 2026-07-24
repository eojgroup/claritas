import sharp from "sharp";
import { feature } from "topojson-client";
import worldCountries from "world-countries";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";
import type {
  GeometryCollection,
  Properties,
  Topology,
} from "topojson-specification";

export type BriefingMapCountry = {
  country_iso2: string;
  country_name: string;
  relevance_score: number;
  news_count: number;
  podcast_count: number;
  market_count: number;
};

type CountryReference = {
  cca2?: string;
  ccn3?: string;
  latlng?: [number, number];
  name?: { common?: string };
};

type CountryProperties = {
  iso2: string;
  name: string;
};

const WIDTH = 1_200;
const HEIGHT = 600;
const MAP_LEFT = 34;
const MAP_TOP = 80;
const MAP_WIDTH = WIDTH - MAP_LEFT * 2;
const MAP_HEIGHT = HEIGHT - MAP_TOP - 36;

// Kept as a runtime package import so the Natural Earth data is available in
// the production image without copying generated assets into dist.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const worldAtlas = require("world-atlas/countries-110m.json") as Topology<{
  countries: GeometryCollection<Properties>;
}>;

const COUNTRY_REFERENCES = worldCountries as CountryReference[];
const ISO_BY_NUMERIC = new Map(
  COUNTRY_REFERENCES.filter((country) => country.ccn3 && country.cca2).map((country) => [
    country.ccn3!,
    country.cca2!.toUpperCase(),
  ])
);
const REFERENCE_BY_ISO = new Map(
  COUNTRY_REFERENCES.filter((country) => country.cca2).map((country) => [
    country.cca2!.toUpperCase(),
    country,
  ])
);

const WORLD_FEATURES = (() => {
  const raw = feature(
    worldAtlas,
    worldAtlas.objects.countries
  ) as unknown as FeatureCollection<Geometry, Properties>;
  return raw.features.flatMap((countryFeature) => {
    const numericId = String(countryFeature.id ?? "").padStart(3, "0");
    const iso2 = ISO_BY_NUMERIC.get(numericId);
    if (!iso2 || iso2 === "AQ") return [];
    const reference = REFERENCE_BY_ISO.get(iso2);
    return [
      {
        ...countryFeature,
        properties: {
          iso2,
          name: reference?.name?.common ?? iso2,
        },
      } satisfies Feature<Geometry, CountryProperties>,
    ];
  });
})();

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function project(position: Position): [number, number] {
  const longitude = Math.max(-180, Math.min(180, finite(Number(position[0]))));
  const latitude = Math.max(-90, Math.min(90, finite(Number(position[1]))));
  return [
    MAP_LEFT + ((longitude + 180) / 360) * MAP_WIDTH,
    MAP_TOP + ((90 - latitude) / 180) * MAP_HEIGHT,
  ];
}

function ringPath(ring: Position[]): string {
  if (ring.length === 0) return "";
  let output = "";
  let previousX: number | null = null;
  for (const coordinate of ring) {
    const [x, y] = project(coordinate);
    // Avoid drawing a line across the entire image when a Natural Earth ring
    // crosses the antimeridian.
    const command =
      previousX == null || Math.abs(x - previousX) > MAP_WIDTH * 0.6 ? "M" : "L";
    output += `${command}${x.toFixed(1)},${y.toFixed(1)}`;
    previousX = x;
  }
  return `${output}Z`;
}

function geometryPath(geometry: Geometry): string {
  if (geometry.type === "Polygon") {
    return (geometry as Polygon).coordinates.map(ringPath).join("");
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry as MultiPolygon).coordinates
      .flatMap((polygon) => polygon.map(ringPath))
      .join("");
  }
  return "";
}

function countryFill(relevance: number, featured: boolean): string {
  if (featured) return "#9a6038";
  if (relevance <= 0) return "#1b2d38";
  const ratio = Math.max(0, Math.min(1, relevance / 100));
  const low = [38, 67, 80];
  const high = [83, 126, 142];
  const rgb = low.map((channel, index) =>
    Math.round(channel + (high[index] - channel) * ratio)
  );
  return `rgb(${rgb.join(",")})`;
}

export function renderBriefingMapSvg(countries: BriefingMapCountry[]): string {
  const ranked = countries
    .filter((country) => /^[A-Z]{2}$/.test(country.country_iso2.toUpperCase()))
    .map((country) => ({
      ...country,
      country_iso2: country.country_iso2.toUpperCase(),
      relevance_score: Math.max(0, Math.min(100, finite(country.relevance_score))),
    }))
    .sort((left, right) => right.relevance_score - left.relevance_score)
    .slice(0, 80);
  const byIso = new Map(ranked.map((country) => [country.country_iso2, country]));
  const featured = ranked[0];

  const paths = WORLD_FEATURES.map((countryFeature) => {
    const iso2 = countryFeature.properties.iso2;
    const datum = byIso.get(iso2);
    const isFeatured = featured?.country_iso2 === iso2;
    return `<path d="${geometryPath(countryFeature.geometry)}" fill="${countryFill(
      datum?.relevance_score ?? 0,
      isFeatured
    )}" stroke="${isFeatured ? "#f8dfc9" : "#3d5562"}" stroke-width="${
      isFeatured ? 2.2 : 0.8
    }" fill-rule="evenodd"/>`;
  }).join("");

  const markers = ranked.flatMap((country, index) => {
    const reference = REFERENCE_BY_ISO.get(country.country_iso2);
    if (!reference?.latlng) return [];
    const [latitude, longitude] = reference.latlng;
    const [x, y] = project([longitude, latitude]);
    const radius = 8 + 18 * Math.sqrt(country.relevance_score / 100);
    const labelVisible = index < 12;
    const label = labelVisible
      ? `<text x="${x.toFixed(1)}" y="${(y - radius - 8).toFixed(
          1
        )}" text-anchor="middle" fill="#f7efe8" stroke="#07121a" stroke-width="5" paint-order="stroke" font-size="18" font-weight="700" letter-spacing="1">${escapeXml(
          country.country_iso2
        )}</text>`
      : "";
    const featuredRing =
      index === 0
        ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(
            radius + 9
          ).toFixed(
            1
          )}" fill="none" stroke="#ffd7b5" stroke-width="3" stroke-dasharray="7 5"/>`
        : "";
    return [
      `<g>${featuredRing}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(
        1
      )}" r="${(radius + 7).toFixed(
        1
      )}" fill="#f0a66f" fill-opacity="0.22"/><circle cx="${x.toFixed(
        1
      )}" cy="${y.toFixed(1)}" r="${radius.toFixed(
        1
      )}" fill="#f0a66f" stroke="#fff0d9" stroke-width="2.5"/><circle cx="${x.toFixed(
        1
      )}" cy="${y.toFixed(1)}" r="${(radius * 0.52).toFixed(
        1
      )}" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="2"/>${label}</g>`,
    ];
  }).join("");

  const featuredText = featured
    ? `<text x="36" y="35" fill="#f0a66f" font-size="15" font-weight="700" letter-spacing="2.5">HIGHEST BRIEFING RELEVANCE</text>
       <text x="36" y="62" fill="#f7efe8" font-size="23" font-weight="700">${escapeXml(
         featured.country_name
       )} · ${escapeXml(featured.country_iso2)}</text>
       <text x="${WIDTH - 36}" y="52" text-anchor="end" fill="#9fb0ba" font-size="16">Relevance ${Math.round(
         featured.relevance_score
       )}/100</text>`
    : `<text x="36" y="52" fill="#f7efe8" font-size="23" font-weight="700">Briefing signal map</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" rx="22" fill="#07121a"/>
    ${featuredText}
    <g>${paths}</g>
    <g>${markers}</g>
    <g transform="translate(36 ${HEIGHT - 28})">
      <circle cx="7" cy="-2" r="7" fill="#f0a66f"/>
      <text x="22" y="4" fill="#9fb0ba" font-size="14">Bubble size represents weighted cross-source relevance</text>
    </g>
    <text x="${WIDTH - 36}" y="${HEIGHT - 24}" text-anchor="end" fill="#70848f" font-size="11">Natural Earth geometry · country reference: world-countries (ODbL)</text>
  </svg>`;
}

export async function renderBriefingMapPng(
  countries: BriefingMapCountry[]
): Promise<Buffer> {
  return sharp(Buffer.from(renderBriefingMapSvg(countries)))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

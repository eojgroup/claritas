"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBriefingMapSvg = renderBriefingMapSvg;
exports.renderBriefingMapPng = renderBriefingMapPng;
const sharp_1 = __importDefault(require("sharp"));
const topojson_client_1 = require("topojson-client");
const world_countries_1 = __importDefault(require("world-countries"));
const WIDTH = 1_200;
const HEIGHT = 600;
const MAP_LEFT = 34;
const MAP_TOP = 80;
const MAP_WIDTH = WIDTH - MAP_LEFT * 2;
const MAP_HEIGHT = HEIGHT - MAP_TOP - 36;
const MAP_PALETTES = {
    light: {
        background: "#F3E9D7",
        border: "#87979E",
        countryLow: [213, 193, 164],
        countryHigh: [62, 106, 128],
        countryEmpty: "#E8D9C2",
        featuredCountry: "#B87547",
        featuredCountryBorder: "#172F42",
        ink: "#172F42",
        muted: "#53616A",
        attribution: "#687780",
        marker: "#E6A06A",
        markerHalo: "#E6A06A",
        markerStroke: "#FFFAF1",
        secondaryMarker: "#3E6A80",
        secondaryMarkerHalo: "#3E6A80",
        secondaryMarkerStroke: "#FFFAF1",
        labelOutline: "#F3E9D7",
    },
    dark: {
        background: "#081119",
        border: "#35566A",
        countryLow: [49, 95, 114],
        countryHigh: [119, 168, 186],
        countryEmpty: "#1B303E",
        featuredCountry: "#B87547",
        featuredCountryBorder: "#F1C49E",
        ink: "#F2EEE6",
        muted: "#A9B5BA",
        attribution: "#87979E",
        marker: "#EDA36A",
        markerHalo: "#EDA36A",
        markerStroke: "#FFF4E8",
        secondaryMarker: "#77A8BA",
        secondaryMarkerHalo: "#77A8BA",
        secondaryMarkerStroke: "#081119",
        labelOutline: "#081119",
    },
};
// Kept as a runtime package import so the Natural Earth data is available in
// the production image without copying generated assets into dist.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const worldAtlas = require("world-atlas/countries-110m.json");
const COUNTRY_REFERENCES = world_countries_1.default;
const ISO_BY_NUMERIC = new Map(COUNTRY_REFERENCES.filter((country) => country.ccn3 && country.cca2).map((country) => [
    country.ccn3,
    country.cca2.toUpperCase(),
]));
const REFERENCE_BY_ISO = new Map(COUNTRY_REFERENCES.filter((country) => country.cca2).map((country) => [
    country.cca2.toUpperCase(),
    country,
]));
const WORLD_FEATURES = (() => {
    const raw = (0, topojson_client_1.feature)(worldAtlas, worldAtlas.objects.countries);
    return raw.features.flatMap((countryFeature) => {
        const numericId = String(countryFeature.id ?? "").padStart(3, "0");
        const iso2 = ISO_BY_NUMERIC.get(numericId);
        if (!iso2 || iso2 === "AQ")
            return [];
        const reference = REFERENCE_BY_ISO.get(iso2);
        return [
            {
                ...countryFeature,
                properties: {
                    iso2,
                    name: reference?.name?.common ?? iso2,
                },
            },
        ];
    });
})();
function escapeXml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}
function project(position) {
    const longitude = Math.max(-180, Math.min(180, finite(Number(position[0]))));
    const latitude = Math.max(-90, Math.min(90, finite(Number(position[1]))));
    return [
        MAP_LEFT + ((longitude + 180) / 360) * MAP_WIDTH,
        MAP_TOP + ((90 - latitude) / 180) * MAP_HEIGHT,
    ];
}
function ringPath(ring) {
    if (ring.length === 0)
        return "";
    let output = "";
    let previousX = null;
    for (const coordinate of ring) {
        const [x, y] = project(coordinate);
        // Avoid drawing a line across the entire image when a Natural Earth ring
        // crosses the antimeridian.
        const command = previousX == null || Math.abs(x - previousX) > MAP_WIDTH * 0.6 ? "M" : "L";
        output += `${command}${x.toFixed(1)},${y.toFixed(1)}`;
        previousX = x;
    }
    return `${output}Z`;
}
function geometryPath(geometry) {
    if (geometry.type === "Polygon") {
        return geometry.coordinates.map(ringPath).join("");
    }
    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates
            .flatMap((polygon) => polygon.map(ringPath))
            .join("");
    }
    return "";
}
function countryFill(relevance, featured, palette) {
    if (featured)
        return palette.featuredCountry;
    if (relevance <= 0)
        return palette.countryEmpty;
    const ratio = Math.max(0, Math.min(1, relevance / 100));
    const rgb = palette.countryLow.map((channel, index) => Math.round(channel + (palette.countryHigh[index] - channel) * ratio));
    return `rgb(${rgb.join(",")})`;
}
function renderBriefingMapSvg(countries, theme = "dark") {
    const palette = MAP_PALETTES[theme];
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
        return `<path d="${geometryPath(countryFeature.geometry)}" fill="${countryFill(datum?.relevance_score ?? 0, isFeatured, palette)}" stroke="${isFeatured ? palette.featuredCountryBorder : palette.border}" stroke-width="${isFeatured ? 2.2 : 0.8}" fill-rule="evenodd"/>`;
    }).join("");
    const markers = ranked.flatMap((country, index) => {
        const reference = REFERENCE_BY_ISO.get(country.country_iso2);
        if (!reference?.latlng)
            return [];
        const [latitude, longitude] = reference.latlng;
        const [x, y] = project([longitude, latitude]);
        const radius = 8 + 18 * Math.sqrt(country.relevance_score / 100);
        const isFeatured = index === 0;
        const markerRadius = isFeatured ? radius : Math.max(7, radius * 0.58);
        const markerFill = isFeatured ? palette.marker : palette.secondaryMarker;
        const markerHalo = isFeatured ? palette.markerHalo : palette.secondaryMarkerHalo;
        const markerStroke = isFeatured ? palette.markerStroke : palette.secondaryMarkerStroke;
        const label = isFeatured
            ? `<text x="${x.toFixed(1)}" y="${(y - radius - 8).toFixed(1)}" text-anchor="middle" fill="${palette.ink}" stroke="${palette.labelOutline}" stroke-width="5" paint-order="stroke" font-family="Times New Roman, Times, serif" font-size="18" font-weight="700" letter-spacing="1">${escapeXml(country.country_iso2)}</text>`
            : "";
        const featuredRing = isFeatured
            ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(radius + 9).toFixed(1)}" fill="none" stroke="${palette.featuredCountryBorder}" stroke-width="3" stroke-dasharray="7 5"/>`
            : "";
        const innerRing = isFeatured
            ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(markerRadius * 0.52).toFixed(1)}" fill="none" stroke="${markerStroke}" stroke-opacity="0.55" stroke-width="2"/>`
            : "";
        return [
            `<g>${featuredRing}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(markerRadius + (isFeatured ? 7 : 4)).toFixed(1)}" fill="${markerHalo}" fill-opacity="${isFeatured ? "0.22" : "0.16"}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${markerRadius.toFixed(1)}" fill="${markerFill}" stroke="${markerStroke}" stroke-width="${isFeatured ? 2.5 : 1.5}"/>${innerRing}${label}</g>`,
        ];
    }).join("");
    const featuredText = featured
        ? `<text x="36" y="35" fill="${palette.marker}" font-family="Times New Roman, Times, serif" font-size="15" font-weight="700" letter-spacing="2.5">HIGHEST BRIEFING RELEVANCE</text>
       <text x="36" y="62" fill="${palette.ink}" font-family="Times New Roman, Times, serif" font-size="23" font-weight="700">${escapeXml(featured.country_name)} · ${escapeXml(featured.country_iso2)}</text>
       <text x="${WIDTH - 36}" y="52" text-anchor="end" fill="${palette.muted}" font-family="Times New Roman, Times, serif" font-size="16">Relevance ${Math.round(featured.relevance_score)}/100</text>`
        : `<text x="36" y="52" fill="${palette.ink}" font-family="Times New Roman, Times, serif" font-size="23" font-weight="700">Briefing signal map</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="${WIDTH}" height="${HEIGHT}" rx="22" fill="${palette.background}"/>
    ${featuredText}
    <g>${paths}</g>
    <g>${markers}</g>
    <g transform="translate(36 ${HEIGHT - 28})">
      <circle cx="7" cy="-2" r="7" fill="${palette.marker}"/>
      <text x="22" y="4" fill="${palette.muted}" font-family="Times New Roman, Times, serif" font-size="14">Highest-relevance country</text>
      <circle cx="225" cy="-2" r="6" fill="${palette.secondaryMarker}" stroke="${palette.secondaryMarkerStroke}" stroke-width="1"/>
      <text x="239" y="4" fill="${palette.muted}" font-family="Times New Roman, Times, serif" font-size="14">Other contributing countries</text>
      <text x="455" y="4" fill="${palette.muted}" font-family="Times New Roman, Times, serif" font-size="14">Marker size = weighted relevance</text>
    </g>
    <text x="${WIDTH - 36}" y="${HEIGHT - 24}" text-anchor="end" fill="${palette.attribution}" font-family="Times New Roman, Times, serif" font-size="11">Natural Earth geometry · country reference: world-countries (ODbL)</text>
  </svg>`;
}
async function renderBriefingMapPng(countries, theme = "dark") {
    return (0, sharp_1.default)(Buffer.from(renderBriefingMapSvg(countries, theme)))
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
}

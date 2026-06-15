import { memo, useEffect, useMemo, useRef, useState } from "react";
import MapView, { Marker, NavigationControl, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import worldCountries from "world-countries";

export type BubbleDatum = {
  country: string;
  count: number;
  tone?:
    | "news"
    | "weather-cold"
    | "weather-mild"
    | "weather-hot"
    | "positive"
    | "negative"
    | "neutral";
  meta?: {
    subtitle?: string;
    lines?: string[];
  };
};

export type WorldMapBubblesProps = {
  data: BubbleDatum[];
  onSelect?: (countryIso2: string) => void;
  dark?: boolean;
  legend?: boolean;
  variant?: "default" | "compact";
  primaryCountry?: string | null;
  secondaryCountry?: string | null;
  pinnedCountry?: string | null;
  scale?: "linear" | "log";
  showLabels?: boolean;
  legendLabel?: string;
};

type WorldCountryReference = {
  cca2?: string;
  properties?: { cca2?: string };
  latlng?: [number, number];
};

type BubbleMarker = {
  country: string;
  count: number;
  coordinate: [number, number];
  tone?: BubbleDatum["tone"];
  meta?: BubbleDatum["meta"];
};

const DEFAULT_STYLE_URL = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
const DEFAULT_DARK_STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const INITIAL_VIEW_STATE = {
  latitude: 14,
  longitude: 8,
  zoom: 0.9,
};

const getEnvValue = (key: string): string | undefined => {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const value = env?.[key];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

function markerPalette(
  tone: BubbleDatum["tone"],
  isDark: boolean,
): { fill: string; stroke: string; halo: string } {
  const paletteMap = {
    news: isDark
      ? { fill: "#eaa36c", stroke: "#f1c49e", halo: "rgba(234,163,108,0.22)" }
      : { fill: "#e6a06a", stroke: "#934719", halo: "rgba(230,160,106,0.18)" },
    "weather-cold": isDark
      ? { fill: "#7fa6b8", stroke: "#c6dce5", halo: "rgba(127,166,184,0.2)" }
      : { fill: "#3e6a80", stroke: "#172f42", halo: "rgba(62,106,128,0.16)" },
    "weather-mild": isDark
      ? { fill: "#c99b74", stroke: "#f1c49e", halo: "rgba(201,155,116,0.2)" }
      : { fill: "#b9855b", stroke: "#76452a", halo: "rgba(185,133,91,0.16)" },
    "weather-hot": isDark
      ? { fill: "#f0b888", stroke: "#ffe0c5", halo: "rgba(240,184,136,0.22)" }
      : { fill: "#934719", stroke: "#612e12", halo: "rgba(147,71,25,0.18)" },
    positive: isDark
      ? { fill: "#7fa6b8", stroke: "#c6dce5", halo: "rgba(127,166,184,0.21)" }
      : { fill: "#2a5268", stroke: "#172f42", halo: "rgba(42,82,104,0.16)" },
    negative: isDark
      ? { fill: "#d96b62", stroke: "#f4b4ae", halo: "rgba(217,107,98,0.2)" }
      : { fill: "#a73b32", stroke: "#702721", halo: "rgba(167,59,50,0.14)" },
    neutral: isDark
      ? { fill: "#aea08e", stroke: "#e8d9c2", halo: "rgba(174,160,142,0.18)" }
      : { fill: "#687780", stroke: "#344b59", halo: "rgba(104,119,128,0.14)" },
  } as const;

  return paletteMap[tone ?? "news"] ?? paletteMap.news;
}

export default memo(function WorldMapBubbles({
  data,
  onSelect,
  dark,
  legend = true,
  variant = "default",
  primaryCountry,
  secondaryCountry,
  pinnedCountry,
  scale = "linear",
  showLabels = true,
  legendLabel = "Relative intensity",
}: WorldMapBubblesProps) {
  const mapRef = useRef<MapRef | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<{
    show: boolean;
    x: number;
    y: number;
    country: string;
    value: number;
    meta?: BubbleDatum["meta"];
  } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const centroids = useMemo(() => {
    const map = new globalThis.Map<string, [number, number]>();
    for (const item of worldCountries as WorldCountryReference[]) {
      const iso = (item.cca2 || item.properties?.cca2 || "").toUpperCase();
      const latlng = item.latlng;
      if (!iso || !latlng || latlng.length < 2) continue;
      const [lat, lng] = latlng;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        map.set(iso, [lng, lat]);
      }
    }
    if (map.has("GB")) map.set("UK", map.get("GB")!);
    return map;
  }, []);

  const markers = useMemo(() => {
    const next: BubbleMarker[] = [];
    data.forEach((datum) => {
      const iso = datum.country.toUpperCase();
      const coordinate = centroids.get(iso) || centroids.get(iso === "UK" ? "GB" : iso);
      if (!coordinate) return;
      next.push({
        country: iso,
        count: datum.count,
        coordinate,
        tone: datum.tone,
        meta: datum.meta,
      });
    });
    return next.sort((a, b) => a.count - b.count);
  }, [centroids, data]);

  const max = useMemo(() => markers.reduce((m, d) => Math.max(m, d.count), 0) || 1, [markers]);
  const min = useMemo(() => {
    const value = markers.reduce((m, d) => Math.min(m, d.count), Infinity);
    return Number.isFinite(value) ? value : 0;
  }, [markers]);

  const isDark = !!dark;
  const isCompact = variant === "compact";
  const labelColor = isDark ? "#f6efe6" : "#28231e";
  const legendPalette = markerPalette(markers[markers.length - 1]?.tone, isDark);

  const mapStyle = useMemo(() => {
    const custom = getEnvValue(isDark ? "VITE_MAP_STYLE_DARK_URL" : "VITE_MAP_STYLE_URL");
    if (custom) return custom;
    const shared = getEnvValue("VITE_MAP_STYLE_URL");
    if (shared) return shared;
    return isDark ? DEFAULT_DARK_STYLE_URL : DEFAULT_STYLE_URL;
  }, [isDark]);

  const rScale = (value: number) => {
    const ratio =
      scale === "log"
        ? Math.log10(value + 1) / Math.log10(max + 1)
        : value / max;
    return (isCompact ? 3.5 : 5) + (isCompact ? 8 : 12) * Math.sqrt(Math.max(0, ratio));
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || markers.length === 0) return;
    const [firstLng, firstLat] = markers[0].coordinate;
    let minLng = firstLng;
    let maxLng = firstLng;
    let minLat = firstLat;
    let maxLat = firstLat;

    for (const marker of markers) {
      const [lng, lat] = marker.coordinate;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }

    if (minLng === maxLng && minLat === maxLat) {
      map.flyTo({ center: [minLng, minLat], zoom: 3, duration: 450 });
      return;
    }

    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      {
        padding: isCompact ? 42 : 84,
        duration: 600,
        maxZoom: isCompact ? 3.8 : 4.8,
      },
    );
  }, [isCompact, markers]);

  const primaryIso = primaryCountry?.toUpperCase();
  const secondaryIso = secondaryCountry?.toUpperCase();
  const pinnedIso = pinnedCountry?.toUpperCase();

  return (
    <div
      ref={containerRef}
      className="world-map relative h-full w-full overflow-hidden rounded-[0.85rem]"
    >
      <MapView
        ref={mapRef}
        mapLib={import("maplibre-gl")}
        initialViewState={INITIAL_VIEW_STATE}
        mapStyle={mapStyle}
        dragRotate={false}
        touchZoomRotate={false}
        projection="mercator"
        reuseMaps
        onError={(event) => {
          const reason =
            event?.error && event.error instanceof Error
              ? event.error.message
              : "Map style failed to load.";
          setMapError(reason);
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="top-right" showCompass={false} visualizePitch={false} />

        {markers.map((marker) => {
          const isPrimary = primaryIso === marker.country;
          const isSecondary = secondaryIso === marker.country;
          const isPinned = pinnedIso === marker.country;
          const palette = markerPalette(marker.tone, isDark);
          const fill = isPrimary
            ? isDark
              ? "#f0b888"
              : "#e6a06a"
            : isSecondary
              ? isDark
                ? "#7fa6b8"
                : "#3e6a80"
              : palette.fill;
          const stroke = isPrimary
            ? isDark
              ? "#ffe0c5"
              : "#934719"
            : isSecondary
              ? isDark
                ? "#c6dce5"
                : "#172f42"
              : palette.stroke;
          const halo = isPrimary
            ? "rgba(181,113,54,0.18)"
            : isSecondary
              ? "rgba(115,106,96,0.18)"
              : palette.halo;
          const size = rScale(marker.count) * 2;

          const updateTip = (event: React.MouseEvent<HTMLButtonElement>) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            setTip({
              show: true,
              x: event.clientX - rect.left + 8,
              y: event.clientY - rect.top + 8,
              country: marker.country,
              value: marker.count,
              meta: marker.meta,
            });
          };

          return (
            <Marker
              key={marker.country}
              longitude={marker.coordinate[0]}
              latitude={marker.coordinate[1]}
              anchor="center"
            >
              <button
                type="button"
                aria-label={`${marker.country}: ${marker.count}`}
                className="relative border-0 bg-transparent p-0"
                onMouseEnter={updateTip}
                onMouseMove={updateTip}
                onMouseLeave={() => setTip(null)}
                onClick={() => onSelect?.(marker.country)}
                style={{ cursor: "pointer" }}
              >
                <span
                  style={{
                    width: size,
                    height: size,
                    borderRadius: 999,
                    border: `1.5px solid ${stroke}`,
                    background: fill,
                    display: "block",
                    boxShadow: `0 0 0 4px ${halo}, 0 6px 16px rgba(47,41,35,0.18)`,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                      inset: size * 0.23,
                      borderRadius: 999,
                      border: `1px solid rgba(255,255,255,0.42)`,
                      opacity: 0.55,
                  }}
                />
                {isPinned && (
                  <span
                    style={{
                      position: "absolute",
                      inset: -6,
                      borderRadius: 999,
                      border: `1.5px solid ${isDark ? "#ffe0c5" : "#e6a06a"}`,
                      boxShadow: `0 0 0 5px ${isDark ? "rgba(234,163,108,0.16)" : "rgba(230,160,106,0.14)"}`,
                    }}
                  />
                )}
                {showLabels && (
                  <span
                    style={{
                      position: "absolute",
                      left: "50%",
                      transform: "translateX(-50%)",
                      top: -19,
                      fontSize: isCompact ? 9 : 10,
                      color: labelColor,
                      textShadow: "0 1px 2px rgba(0,0,0,0.5)",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      pointerEvents: "none",
                    }}
                  >
                    {marker.country}
                  </span>
                )}
              </button>
            </Marker>
          );
        })}
      </MapView>

      {legend && (
        <div
          className="absolute bottom-3 left-3 rounded-2xl border px-3 py-2 text-[11px] shadow-sm"
          style={{
            background: isDark ? "rgba(13,23,36,0.88)" : "rgba(255,255,255,0.9)",
            color: labelColor,
            borderColor: isDark ? "#3a3028" : "#ded5c9",
            backdropFilter: "blur(14px)",
          }}
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em]">
            {legendLabel}
          </div>
          <div className="flex items-center gap-2">
            <svg width={isCompact ? 66 : 82} height={isCompact ? 24 : 28}>
              {[0.2, 0.5, 1].map((factor, index) => {
                const radius = rScale(Math.max(1, max * factor));
                const cx = (isCompact ? 10 : 12) + index * (isCompact ? 21 : 25);
                const cy = isCompact ? 14 : 16;
                return (
                  <circle
                    key={factor}
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={legendPalette.fill}
                    stroke={legendPalette.stroke}
                    strokeWidth={1.2}
                  />
                );
              })}
            </svg>
            <span>{scale === "log" ? "Log size" : "Relative size"}</span>
          </div>
          <div className="mt-0.5 flex justify-between text-[10px]">
            <span>Min {min}</span>
            <span>Max {max}</span>
          </div>
        </div>
      )}

      {tip && tip.show && (
        <div
          className="pointer-events-none absolute rounded-2xl border px-3 py-2 text-xs shadow-lg"
          style={{
            left: tip.x,
            top: tip.y,
            background: isDark ? "rgba(13,23,36,0.94)" : "rgba(255,255,255,0.96)",
            color: labelColor,
            borderColor: isDark ? "#3a3028" : "#ded5c9",
            maxWidth: 240,
            backdropFilter: "blur(14px)",
          }}
        >
          <div className="font-semibold">{tip.country}</div>
          <div>{tip.meta?.subtitle ?? `${tip.value} ${tip.value === 1 ? "item" : "items"}`}</div>
          {tip.meta?.lines?.map((line, index) => (
            <div
              key={`${tip.country}-${index}`}
              style={{ color: isDark ? "#cfc2b4" : "#746a61" }}
            >
              {line}
            </div>
          ))}
        </div>
      )}

      {mapError && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2 text-xs text-amber-800">
          Map provider error: {mapError}
        </div>
      )}
    </div>
  );
});

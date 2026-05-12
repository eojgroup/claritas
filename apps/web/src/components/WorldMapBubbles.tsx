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

const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

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
      ? { fill: "#7fa4dc", stroke: "#c7d7f0", halo: "rgba(127,164,220,0.3)" }
      : { fill: "#4169a8", stroke: "#2f4f73", halo: "rgba(65,105,168,0.2)" },
    "weather-cold": isDark
      ? { fill: "#5eaec0", stroke: "#b8dfe6", halo: "rgba(94,174,192,0.28)" }
      : { fill: "#2d7a8a", stroke: "#1f5d6a", halo: "rgba(45,122,138,0.18)" },
    "weather-mild": isDark
      ? { fill: "#70b8b4", stroke: "#bfe2df", halo: "rgba(112,184,180,0.25)" }
      : { fill: "#2f6f73", stroke: "#244f53", halo: "rgba(47,111,115,0.17)" },
    "weather-hot": isDark
      ? { fill: "#c59a5b", stroke: "#e8d1ad", halo: "rgba(197,154,91,0.28)" }
      : { fill: "#9b6b3f", stroke: "#704d2f", halo: "rgba(155,107,63,0.18)" },
    positive: isDark
      ? { fill: "#70b8b4", stroke: "#bfe2df", halo: "rgba(112,184,180,0.26)" }
      : { fill: "#2f6f73", stroke: "#244f53", halo: "rgba(47,111,115,0.17)" },
    negative: isDark
      ? { fill: "#d77a86", stroke: "#efc4c9", halo: "rgba(215,122,134,0.26)" }
      : { fill: "#a8485b", stroke: "#7d3544", halo: "rgba(168,72,91,0.17)" },
    neutral: isDark
      ? { fill: "#98a7ba", stroke: "#d8e0ea", halo: "rgba(152,167,186,0.22)" }
      : { fill: "#687789", stroke: "#4d5a69", halo: "rgba(104,119,137,0.16)" },
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
  const labelColor = isDark ? "#f2f6fa" : "#172033";
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
    return (isCompact ? 4 : 6) + (isCompact ? 14 : 20) * Math.sqrt(Math.max(0, ratio));
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
      className="world-map relative h-full w-full overflow-hidden rounded-[1.1rem]"
    >
      <MapView
        ref={mapRef}
        mapLib={import("maplibre-gl")}
        initialViewState={INITIAL_VIEW_STATE}
        mapStyle={mapStyle}
        dragRotate={false}
        touchZoomRotate={false}
        projection="globe"
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
              ? "#5eaec0"
              : "#2d7a8a"
            : isSecondary
              ? isDark
                ? "#c59a5b"
                : "#9b6b3f"
              : palette.fill;
          const stroke = isPrimary
            ? isDark
              ? "#b8dfe6"
              : "#1f5d6a"
            : isSecondary
              ? isDark
                ? "#e8d1ad"
                : "#704d2f"
              : palette.stroke;
          const halo = isPrimary
            ? "rgba(45,122,138,0.24)"
            : isSecondary
              ? "rgba(155,107,63,0.24)"
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
                    background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.42), transparent 38%), ${fill}`,
                    display: "block",
                    boxShadow: `0 0 0 8px ${halo}, 0 14px 30px rgba(0,0,0,0.18)`,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    inset: size * 0.23,
                    borderRadius: 999,
                    border: `1px solid rgba(255,255,255,0.36)`,
                    opacity: 0.75,
                  }}
                />
                {isPinned && (
                  <span
                    style={{
                      position: "absolute",
                      inset: -6,
                      borderRadius: 999,
                      border: `1.5px solid ${isDark ? "#e8d1ad" : "#9b6b3f"}`,
                      boxShadow: `0 0 0 6px ${isDark ? "rgba(197,154,91,0.18)" : "rgba(155,107,63,0.14)"}`,
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
            borderColor: isDark ? "#29384c" : "#d8e0ea",
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
            <span>{scale === "log" ? "Log scale" : "Linear scale"}</span>
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
            borderColor: isDark ? "#29384c" : "#d8e0ea",
            maxWidth: 240,
            backdropFilter: "blur(14px)",
          }}
        >
          <div className="font-semibold">{tip.country}</div>
          <div>{tip.meta?.subtitle ?? `${tip.value} ${tip.value === 1 ? "item" : "items"}`}</div>
          {tip.meta?.lines?.map((line, index) => (
            <div
              key={`${tip.country}-${index}`}
              style={{ color: isDark ? "#b8c8d8" : "#687789" }}
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

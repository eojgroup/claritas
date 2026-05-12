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
      ? { fill: "#60a5fa", stroke: "#bfdbfe", halo: "rgba(96,165,250,0.35)" }
      : { fill: "#2563eb", stroke: "#1d4ed8", halo: "rgba(37,99,235,0.22)" },
    "weather-cold": isDark
      ? { fill: "#38bdf8", stroke: "#bae6fd", halo: "rgba(56,189,248,0.3)" }
      : { fill: "#0284c7", stroke: "#0369a1", halo: "rgba(2,132,199,0.2)" },
    "weather-mild": isDark
      ? { fill: "#5eead4", stroke: "#99f6e4", halo: "rgba(45,212,191,0.28)" }
      : { fill: "#0f766e", stroke: "#115e59", halo: "rgba(15,118,110,0.18)" },
    "weather-hot": isDark
      ? { fill: "#fbbf24", stroke: "#fde68a", halo: "rgba(251,191,36,0.32)" }
      : { fill: "#d97706", stroke: "#b45309", halo: "rgba(217,119,6,0.22)" },
    positive: isDark
      ? { fill: "#5eead4", stroke: "#99f6e4", halo: "rgba(45,212,191,0.3)" }
      : { fill: "#0f766e", stroke: "#115e59", halo: "rgba(15,118,110,0.18)" },
    negative: isDark
      ? { fill: "#fb7185", stroke: "#fecdd3", halo: "rgba(251,113,133,0.32)" }
      : { fill: "#be123c", stroke: "#9f1239", halo: "rgba(190,18,60,0.2)" },
    neutral: isDark
      ? { fill: "#94a3b8", stroke: "#cbd5e1", halo: "rgba(148,163,184,0.28)" }
      : { fill: "#64748b", stroke: "#475569", halo: "rgba(100,116,139,0.18)" },
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
  const labelColor = isDark ? "#e2e8f0" : "#0f172a";
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
              ? "#38bdf8"
              : "#0ea5e9"
            : isSecondary
              ? isDark
                ? "#fbbf24"
                : "#f59e0b"
              : palette.fill;
          const stroke = isPrimary
            ? isDark
              ? "#bae6fd"
              : "#0369a1"
            : isSecondary
              ? isDark
                ? "#fde68a"
                : "#b45309"
              : palette.stroke;
          const halo = isPrimary
            ? "rgba(14,165,233,0.28)"
            : isSecondary
              ? "rgba(245,158,11,0.28)"
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
                      border: `1.5px solid ${isDark ? "#fde68a" : "#f59e0b"}`,
                      boxShadow: `0 0 0 6px ${isDark ? "rgba(245,158,11,0.18)" : "rgba(245,158,11,0.14)"}`,
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
            background: isDark ? "rgba(8,18,30,0.86)" : "rgba(255,255,255,0.88)",
            color: labelColor,
            borderColor: isDark ? "#334155" : "#cbd5e1",
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
            background: isDark ? "rgba(7,17,29,0.94)" : "rgba(255,255,255,0.96)",
            color: labelColor,
            borderColor: isDark ? "#334155" : "#cbd5e1",
            maxWidth: 240,
            backdropFilter: "blur(14px)",
          }}
        >
          <div className="font-semibold">{tip.country}</div>
          <div>{tip.meta?.subtitle ?? `${tip.value} ${tip.value === 1 ? "item" : "items"}`}</div>
          {tip.meta?.lines?.map((line, index) => (
            <div
              key={`${tip.country}-${index}`}
              style={{ color: isDark ? "#b8c7d8" : "#5f6f82" }}
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

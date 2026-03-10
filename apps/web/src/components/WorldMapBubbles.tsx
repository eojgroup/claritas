import { memo, useEffect, useMemo, useRef, useState } from "react";
import MapView, { Marker, NavigationControl, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import worldCountries from "world-countries";

export type BubbleDatum = {
  country: string;
  count: number;
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
        meta: datum.meta,
      });
    });
    return next;
  }, [centroids, data]);

  const max = useMemo(() => markers.reduce((m, d) => Math.max(m, d.count), 0) || 1, [markers]);
  const min = useMemo(() => {
    const value = markers.reduce((m, d) => Math.min(m, d.count), Infinity);
    return Number.isFinite(value) ? value : 0;
  }, [markers]);

  const isDark = !!dark;
  const isCompact = variant === "compact";
  const labelColor = isDark ? "#e2e8f0" : "#0f172a";

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
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-xl">
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

          const fill = isPrimary
            ? "rgba(14,165,233,0.8)"
            : isSecondary
              ? "rgba(250,204,21,0.82)"
              : isDark
                ? "rgba(34,197,94,0.78)"
                : "rgba(16,115,74,0.78)";
          const stroke = isPrimary
            ? "#0284c7"
            : isSecondary
              ? "#d97706"
              : isDark
                ? "#16a34a"
                : "#0f5132";
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
                    border: `1px solid ${stroke}`,
                    background: fill,
                    display: "block",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.16)",
                  }}
                />
                {isPinned && (
                  <span
                    style={{
                      position: "absolute",
                      inset: -4,
                      borderRadius: 999,
                      border: `1.5px solid ${isDark ? "#fde047" : "#f59e0b"}`,
                    }}
                  />
                )}
                {showLabels && (
                  <span
                    style={{
                      position: "absolute",
                      left: "50%",
                      transform: "translateX(-50%)",
                      top: -18,
                      fontSize: isCompact ? 9 : 10,
                      color: labelColor,
                      textShadow: "0 1px 2px rgba(0,0,0,0.45)",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
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
          className="absolute bottom-2 left-2 rounded border px-2 py-1 text-[11px]"
          style={{
            background: isDark ? "rgba(15,23,42,0.84)" : "rgba(255,255,255,0.9)",
            color: labelColor,
            borderColor: isDark ? "#334155" : "#cbd5e1",
          }}
        >
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
                    fill={isDark ? "rgba(34,197,94,0.78)" : "rgba(16,115,74,0.78)"}
                    stroke={isDark ? "#16a34a" : "#0f5132"}
                    strokeWidth={1}
                  />
                );
              })}
            </svg>
            <span>Relative size · {scale === "log" ? "Log" : "Linear"}</span>
          </div>
          <div className="mt-0.5 flex justify-between text-[10px]">
            <span>Min {min}</span>
            <span>Max {max}</span>
          </div>
        </div>
      )}

      {tip && tip.show && (
        <div
          className="pointer-events-none absolute rounded border px-2 py-1 text-xs shadow"
          style={{
            left: tip.x,
            top: tip.y,
            background: isDark ? "#0f172a" : "#ffffff",
            color: labelColor,
            borderColor: isDark ? "#334155" : "#cbd5e1",
            maxWidth: 240,
          }}
        >
          <div className="font-semibold">{tip.country}</div>
          <div>{tip.meta?.subtitle ?? `${tip.value} ${tip.value === 1 ? "item" : "items"}`}</div>
          {tip.meta?.lines?.map((line, index) => (
            <div key={`${tip.country}-${index}`}>{line}</div>
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

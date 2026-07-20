import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldAtlas from "world-atlas/countries-110m.json";
import worldCountries from "world-countries";
import type {
  Feature,
  FeatureCollection,
  Geometry,
} from "geojson";
import type {
  GeometryCollection,
  Properties,
  Topology,
} from "topojson-specification";

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
  ccn3?: string;
  properties?: { cca2?: string };
  latlng?: [number, number];
  name?: { common?: string };
};

type CountryProperties = {
  iso2: string;
  name: string;
};

type BubbleMarker = {
  country: string;
  count: number;
  coordinate: [number, number];
  tone?: BubbleDatum["tone"];
  meta?: BubbleDatum["meta"];
};

type ViewTransform = {
  scale: number;
  x: number;
  y: number;
};

const INITIAL_SIZE = { width: 960, height: 480 };

const WORLD_GEOMETRY = (() => {
  const references = worldCountries as WorldCountryReference[];
  const isoByNumeric = new globalThis.Map(
    references
      .filter((country) => country.ccn3 && country.cca2)
      .map((country) => [country.ccn3!, country.cca2!.toUpperCase()]),
  );
  const nameByIso = new globalThis.Map(
    references
      .filter((country) => country.cca2)
      .map((country) => [
        country.cca2!.toUpperCase(),
        country.name?.common ?? country.cca2!.toUpperCase(),
      ]),
  );
  const centroidByIso = new globalThis.Map<string, [number, number]>();
  references.forEach((country) => {
    const iso = (country.cca2 ?? country.properties?.cca2 ?? "").toUpperCase();
    const [lat, lng] = country.latlng ?? [];
    if (
      !iso ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      iso === "AQ"
    ) {
      return;
    }
    centroidByIso.set(iso, [Number(lng), Number(lat)]);
  });
  if (centroidByIso.has("GB")) {
    centroidByIso.set("UK", centroidByIso.get("GB")!);
  }
  if (nameByIso.has("GB")) {
    nameByIso.set("UK", nameByIso.get("GB")!);
  }

  const topology = worldAtlas as unknown as Topology<{
    countries: GeometryCollection<Properties>;
    land: GeometryCollection<Properties>;
  }>;
  const raw = feature(
    topology,
    topology.objects.countries,
  ) as FeatureCollection<Geometry, Properties>;
  const features = raw.features.flatMap((countryFeature) => {
    const numericId = String(countryFeature.id ?? "").padStart(3, "0");
    const iso2 = isoByNumeric.get(numericId);
    if (!iso2 || iso2 === "AQ") return [];
    return [
      {
        ...countryFeature,
        properties: {
          iso2,
          name: nameByIso.get(iso2) ?? iso2,
        },
      } satisfies Feature<Geometry, CountryProperties>,
    ];
  });

  return {
    nameByIso,
    centroidByIso,
    collection: {
      type: "FeatureCollection",
      features,
    } satisfies FeatureCollection<Geometry, CountryProperties>,
  };
})();

function markerPalette(
  tone: BubbleDatum["tone"],
  isDark: boolean,
): { fill: string; stroke: string; halo: string } {
  const paletteMap = {
    news: isDark
      ? { fill: "#eaa36c", stroke: "#ffd6b3", halo: "rgba(234,163,108,0.22)" }
      : { fill: "#df8f55", stroke: "#7c3613", halo: "rgba(223,143,85,0.2)" },
    "weather-cold": isDark
      ? { fill: "#77a8ba", stroke: "#d1e9f1", halo: "rgba(119,168,186,0.22)" }
      : { fill: "#3e6a80", stroke: "#172f42", halo: "rgba(62,106,128,0.18)" },
    "weather-mild": isDark
      ? { fill: "#c99b74", stroke: "#f3d4ba", halo: "rgba(201,155,116,0.2)" }
      : { fill: "#b9855b", stroke: "#704225", halo: "rgba(185,133,91,0.17)" },
    "weather-hot": isDark
      ? { fill: "#ef9a67", stroke: "#ffe0c5", halo: "rgba(239,154,103,0.22)" }
      : { fill: "#a94c24", stroke: "#612e12", halo: "rgba(169,76,36,0.18)" },
    positive: isDark
      ? { fill: "#73b6aa", stroke: "#d2f0ea", halo: "rgba(115,182,170,0.2)" }
      : { fill: "#317d70", stroke: "#17473f", halo: "rgba(49,125,112,0.17)" },
    negative: isDark
      ? { fill: "#d96b62", stroke: "#ffd0cc", halo: "rgba(217,107,98,0.2)" }
      : { fill: "#a73b32", stroke: "#702721", halo: "rgba(167,59,50,0.16)" },
    neutral: isDark
      ? { fill: "#a99d8c", stroke: "#eee0cb", halo: "rgba(169,157,140,0.18)" }
      : { fill: "#687780", stroke: "#344b59", halo: "rgba(104,119,128,0.15)" },
  } as const;
  return paletteMap[tone ?? "news"] ?? paletteMap.news;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [size, setSize] = useState(INITIAL_SIZE);
  const [view, setView] = useState<ViewTransform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    country: string;
    value: number;
    rank: number;
    meta?: BubbleDatum["meta"];
  } | null>(null);

  const isDark = Boolean(dark);
  const isCompact = variant === "compact";
  const primaryIso = primaryCountry?.toUpperCase();
  const secondaryIso = secondaryCountry?.toUpperCase();
  const pinnedIso = pinnedCountry?.toUpperCase();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      setSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const projection = useMemo(
    () =>
      geoNaturalEarth1().fitExtent(
        [
          [18, 18],
          [Math.max(19, size.width - 18), Math.max(19, size.height - 18)],
        ],
        WORLD_GEOMETRY.collection,
      ),
    [size.height, size.width],
  );
  const path = useMemo(() => geoPath(projection), [projection]);

  const markers = useMemo(() => {
    const next: BubbleMarker[] = [];
    data.forEach((datum) => {
      const iso = datum.country.toUpperCase();
      const coordinate =
        WORLD_GEOMETRY.centroidByIso.get(iso) ??
        WORLD_GEOMETRY.centroidByIso.get(iso === "UK" ? "GB" : iso);
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
  }, [data]);

  const markerByCountry = useMemo(
    () =>
      new globalThis.Map(
        markers.map((marker) => [marker.country, marker] as const),
      ),
    [markers],
  );
  const rankByCountry = useMemo(
    () =>
      new globalThis.Map(
        [...markers]
          .sort((a, b) => b.count - a.count)
          .map((marker, index) => [marker.country, index + 1] as const),
      ),
    [markers],
  );
  const max = useMemo(
    () => markers.reduce((value, marker) => Math.max(value, marker.count), 0) || 1,
    [markers],
  );
  const min = useMemo(() => {
    const value = markers.reduce(
      (current, marker) => Math.min(current, marker.count),
      Infinity,
    );
    return Number.isFinite(value) ? value : 0;
  }, [markers]);

  const intensityFor = useCallback(
    (value: number) =>
      scale === "log"
        ? Math.log10(value + 1) / Math.log10(max + 1)
        : value / max,
    [max, scale],
  );
  const radiusFor = useCallback(
    (value: number) => {
      const ratio = Math.sqrt(Math.max(0, intensityFor(value)));
      return (isCompact ? 4 : 5) + (isCompact ? 8 : 12) * ratio;
    },
    [intensityFor, isCompact],
  );

  useEffect(() => {
    const points = markers
      .map((marker) => projection(marker.coordinate))
      .filter((point): point is [number, number] => Boolean(point));
    if (points.length < 2) {
      setView({ scale: 1, x: 0, y: 0 });
      return;
    }
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const fittedScale = clamp(
      Math.min(
        (size.width - (isCompact ? 70 : 110)) / contentWidth,
        (size.height - (isCompact ? 60 : 100)) / contentHeight,
      ),
      1,
      isCompact ? 3.2 : 4,
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setView({
      scale: fittedScale,
      x: size.width / 2 - centerX * fittedScale,
      y: size.height / 2 - centerY * fittedScale,
    });
  }, [isCompact, markers, projection, size.height, size.width]);

  const zoomAt = useCallback(
    (nextScale: number, anchorX: number, anchorY: number) => {
      setView((current) => {
        const scaleValue = clamp(nextScale, 1, 5);
        const ratio = scaleValue / current.scale;
        return {
          scale: scaleValue,
          x: anchorX - (anchorX - current.x) * ratio,
          y: anchorY - (anchorY - current.y) * ratio,
        };
      });
    },
    [],
  );

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.18 : 0.84;
    zoomAt(view.scale * factor, anchorX, anchorY);
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
    }
    if (!drag.moved) return;
    setView((current) => ({
      ...current,
      x: drag.originX + dx,
      y: drag.originY + dy,
    }));
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      suppressClickRef.current = drag.moved;
      if (drag.moved) {
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      dragRef.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  };

  const handleCountrySelect = (iso: string) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect?.(iso);
  };

  const updateTip = (
    event: ReactPointerEvent<SVGGElement>,
    marker: BubbleMarker,
  ) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredCountry(marker.country);
    setTip({
      x: clamp(event.clientX - rect.left + 10, 8, rect.width - 250),
      y: clamp(event.clientY - rect.top + 10, 8, rect.height - 118),
      country: marker.country,
      value: marker.count,
      rank: rankByCountry.get(marker.country) ?? markers.length,
      meta: marker.meta,
    });
  };

  const hoveredMarker = hoveredCountry
    ? markerByCountry.get(hoveredCountry)
    : undefined;
  const labelColor = isDark ? "#f4eee6" : "#1d2b33";
  const legendPalette = markerPalette(
    markers[markers.length - 1]?.tone,
    isDark,
  );

  return (
    <div
      ref={containerRef}
      className="world-map relative h-full w-full overflow-hidden rounded-[0.85rem]"
    >
      <svg
        ref={svgRef}
        className={`world-map-svg h-full w-full ${
          isDragging ? "is-dragging" : ""
        }`}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="application"
        aria-label="Interactive world signal map. Use the controls or mouse wheel to zoom and drag to pan."
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <rect
          width={size.width}
          height={size.height}
          fill={isDark ? "#07121a" : "#e7edf0"}
        />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {WORLD_GEOMETRY.collection.features.map((countryFeature) => {
            const iso = countryFeature.properties.iso2;
            const marker = markerByCountry.get(iso);
            const intensity = marker ? intensityFor(marker.count) : 0;
            const isPrimary = primaryIso === iso;
            const isSecondary = secondaryIso === iso;
            const isHovered = hoveredCountry === iso;
            const fill = isPrimary
              ? isDark
                ? "#b96f3d"
                : "#d9824b"
              : isSecondary
                ? isDark
                  ? "#3f7588"
                  : "#77a8ba"
                : marker
                  ? isDark
                    ? "#355d6d"
                    : "#86a6b2"
                  : isDark
                    ? "#1b2d38"
                    : "#cbd6da";
            const opacity = isPrimary
              ? 0.95
              : isSecondary
                ? 0.9
                : isHovered
                  ? 0.88
                  : marker
                    ? 0.56 + intensity * 0.34
                    : 0.82;
            const stroke =
              isPrimary || isSecondary || isHovered
                ? isDark
                  ? "#e6f2f5"
                  : "#284b5a"
                : isDark
                  ? "#48616e"
                  : "#94a5ab";
            return (
              <path
                key={iso}
                d={path(countryFeature) ?? undefined}
                fill={fill}
                fillOpacity={opacity}
                stroke={stroke}
                strokeWidth={isPrimary || isSecondary || isHovered ? 1.4 : 0.55}
                vectorEffect="non-scaling-stroke"
                role="button"
                tabIndex={marker || isPrimary || isSecondary ? 0 : -1}
                aria-label={`${countryFeature.properties.name}${
                  marker ? `: ${marker.count}` : ": no mapped signal"
                }`}
                className="world-map-country"
                onPointerEnter={() => setHoveredCountry(iso)}
                onPointerLeave={() => setHoveredCountry(null)}
                onClick={() => handleCountrySelect(iso)}
                onKeyDown={(
                  event: ReactKeyboardEvent<SVGPathElement>,
                ) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect?.(iso);
                  }
                }}
              />
            );
          })}

          {markers.map((marker) => {
            const point = projection(marker.coordinate);
            if (!point) return null;
            const isPrimary = primaryIso === marker.country;
            const isSecondary = secondaryIso === marker.country;
            const isPinned = pinnedIso === marker.country;
            const palette = markerPalette(marker.tone, isDark);
            const radius = radiusFor(marker.count) / view.scale;
            const showMarkerLabel =
              (showLabels &&
                (rankByCountry.get(marker.country) ?? Infinity) <=
                  (isCompact ? 10 : 16)) ||
              isPrimary ||
              isSecondary ||
              isPinned ||
              hoveredCountry === marker.country;
            return (
              <g
                key={marker.country}
                transform={`translate(${point[0]} ${point[1]})`}
                className="world-map-bubble"
                role="button"
                tabIndex={0}
                aria-label={`${WORLD_GEOMETRY.nameByIso.get(marker.country) ?? marker.country}: ${marker.count}`}
                onPointerEnter={(event) => updateTip(event, marker)}
                onPointerMove={(event) => updateTip(event, marker)}
                onPointerLeave={() => {
                  setTip(null);
                  setHoveredCountry(null);
                }}
                onClick={() => handleCountrySelect(marker.country)}
                onKeyDown={(event: ReactKeyboardEvent<SVGGElement>) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect?.(marker.country);
                  }
                }}
              >
                <circle
                  r={radius + 5 / view.scale}
                  fill={palette.halo}
                  className="world-map-bubble-halo"
                />
                {(isPrimary || isSecondary || isPinned) && (
                  <circle
                    r={radius + 4 / view.scale}
                    fill="none"
                    stroke={
                      isSecondary
                        ? isDark
                          ? "#d1e9f1"
                          : "#244a5c"
                        : isDark
                          ? "#ffe0c5"
                          : "#7c3613"
                    }
                    strokeWidth={2 / view.scale}
                  />
                )}
                <circle
                  r={radius}
                  fill={palette.fill}
                  stroke={palette.stroke}
                  strokeWidth={1.5 / view.scale}
                />
                <circle
                  r={radius * 0.52}
                  fill="none"
                  stroke="rgba(255,255,255,0.48)"
                  strokeWidth={1 / view.scale}
                />
                {showMarkerLabel && (
                  <text
                    y={-(radius + 6 / view.scale)}
                    textAnchor="middle"
                    fill={labelColor}
                    stroke={isDark ? "#07121a" : "#eef2f3"}
                    strokeWidth={3 / view.scale}
                    paintOrder="stroke"
                    fontSize={(isCompact ? 10 : 11) / view.scale}
                    fontWeight={700}
                    letterSpacing={0.5 / view.scale}
                    className="world-map-label"
                  >
                    {marker.country}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="world-map-controls absolute right-3 top-3">
        <button
          type="button"
          onClick={() =>
            zoomAt(view.scale * 1.35, size.width / 2, size.height / 2)
          }
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() =>
            zoomAt(view.scale / 1.35, size.width / 2, size.height / 2)
          }
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setView({ scale: 1, x: 0, y: 0 })}
          aria-label="Reset map view"
          title="Reset map view"
        >
          ↺
        </button>
      </div>

      {hoveredCountry && !tip && (
        <div className="map-country-readout pointer-events-none absolute left-3 top-3">
          <span>
            {WORLD_GEOMETRY.nameByIso.get(hoveredCountry) ?? hoveredCountry}
          </span>
          <strong>
            {hoveredMarker
              ? hoveredMarker.meta?.subtitle ??
                `${hoveredMarker.count} mapped items`
              : "No mapped signal in this view"}
          </strong>
          <small>Select the country to open its cross-domain profile</small>
        </div>
      )}

      {legend && (
        <div
          className="map-data-legend absolute bottom-3 left-3 rounded-xl border px-3 py-2 text-[11px] shadow-sm"
          style={{
            background: isDark
              ? "rgba(10,22,31,0.9)"
              : "rgba(255,255,255,0.92)",
            color: labelColor,
            borderColor: isDark ? "#3b4f5a" : "#bac6ca",
            backdropFilter: "blur(14px)",
          }}
        >
          <div className="map-legend-title mb-1 text-[10px] font-semibold uppercase tracking-[0.22em]">
            {legendLabel}
          </div>
          <div className="flex items-center gap-2">
            <svg width={58} height={24} aria-hidden="true">
              {[0.2, 0.5, 1].map((factor, index) => (
                <circle
                  key={factor}
                  cx={9 + index * 19}
                  cy={13}
                  r={Math.min(9, radiusFor(Math.max(1, max * factor)) * 0.55)}
                  fill={legendPalette.fill}
                  stroke={legendPalette.stroke}
                  strokeWidth={1}
                />
              ))}
            </svg>
            <span>
              {scale === "log" ? "Log-scaled bubbles" : "Relative bubbles"}
            </span>
          </div>
          <div className="mt-0.5 flex justify-between gap-4 text-[10px]">
            <span>Min {min}</span>
            <span>Max {max}</span>
          </div>
          <div className="map-legend-coverage mt-1 border-t border-current/15 pt-1 text-[10px] opacity-75">
            {markers.length} mapped · select country for profile
          </div>
        </div>
      )}

      <div className="map-geometry-attribution pointer-events-none absolute bottom-2 right-2">
        Natural Earth geometry · Claritas SVG
      </div>

      {tip && (
        <div
          className="pointer-events-none absolute rounded-xl border px-3 py-2 text-xs shadow-lg"
          style={{
            left: tip.x,
            top: tip.y,
            background: isDark
              ? "rgba(10,22,31,0.96)"
              : "rgba(255,255,255,0.97)",
            color: labelColor,
            borderColor: isDark ? "#3b4f5a" : "#bac6ca",
            maxWidth: 240,
            backdropFilter: "blur(14px)",
          }}
        >
          <div className="font-semibold">
            {WORLD_GEOMETRY.nameByIso.get(tip.country) ?? tip.country}
            <span className="ml-1 opacity-60">· {tip.country}</span>
          </div>
          <div>
            {tip.meta?.subtitle ??
              `${tip.value} ${tip.value === 1 ? "item" : "items"}`}
          </div>
          <div style={{ color: isDark ? "#b4c1c6" : "#65747a" }}>
            Rank {tip.rank} of {markers.length} in this view
          </div>
          {tip.meta?.lines?.map((line, index) => (
            <div
              key={`${tip.country}-${index}`}
              style={{ color: isDark ? "#b4c1c6" : "#65747a" }}
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

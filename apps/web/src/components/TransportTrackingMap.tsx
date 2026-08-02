import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldAtlas from "world-atlas/countries-50m.json";
import worldCountries from "world-countries";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type {
  GeometryCollection,
  Properties,
  Topology,
} from "topojson-specification";
import type {
  TransportEntity,
  TransportMode,
  TransportRouteAggregate,
  TransportTrackPoint,
} from "../lib/api";

type Props = {
  entities: TransportEntity[];
  routes?: TransportRouteAggregate[];
  selectedCountry?: string | null;
  selectedId?: string | null;
  track?: TransportTrackPoint[];
  mode?: TransportMode | "all";
  onSelect?: (entity: TransportEntity) => void;
};

const WIDTH = 1_120;
const HEIGHT = 560;
const topology = worldAtlas as unknown as Topology<{
  countries: GeometryCollection<Properties>;
}>;
const countries = feature(
  topology,
  topology.objects.countries,
) as FeatureCollection<Geometry, Properties>;
const projection = geoNaturalEarth1().fitExtent(
  [
    [14, 12],
    [WIDTH - 14, HEIGHT - 12],
  ],
  countries,
);
const path = geoPath(projection);
type CountryReference = {
  cca2?: string;
  ccn3?: string;
  latlng?: [number, number];
};
const countryReferences = worldCountries as CountryReference[];
const countryIsoByNumeric = new Map(
  countryReferences.flatMap((country) =>
    country.cca2 && country.ccn3
      ? [[country.ccn3.padStart(3, "0"), country.cca2.toUpperCase()] as const]
      : [],
  ),
);
const countryFeatureByIso = new Map<string, Feature<Geometry, Properties>>();
for (const country of countries.features) {
  const iso = countryIsoByNumeric.get(String(country.id ?? "").padStart(3, "0"));
  if (iso) countryFeatureByIso.set(iso, country);
}
const countryCoordinateByIso = new Map(
  countryReferences.flatMap((country) =>
    country.cca2 && country.latlng
      ? [
          [
            country.cca2.toUpperCase(),
            projection([country.latlng[1], country.latlng[0]]),
          ] as const,
        ]
      : [],
  ),
);

function project(latitude: number | null, longitude: number | null) {
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return null;
  }
  return projection([longitude, latitude]);
}

function routePath(entity: TransportEntity): string | null {
  const start = project(entity.origin_latitude, entity.origin_longitude);
  const end = project(
    entity.destination_latitude,
    entity.destination_longitude,
  );
  if (!start || !end) return null;
  const midpointX = (start[0] + end[0]) / 2;
  const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const midpointY = (start[1] + end[1]) / 2 - Math.min(90, distance * 0.22);
  return `M ${start[0]} ${start[1]} Q ${midpointX} ${midpointY} ${end[0]} ${end[1]}`;
}

function aggregateRoutePath(route: TransportRouteAggregate): string | null {
  const start = countryCoordinateByIso.get(route.origin_country.toUpperCase());
  const end = countryCoordinateByIso.get(route.destination_country.toUpperCase());
  if (!start || !end || route.origin_country === route.destination_country) return null;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const distance = Math.hypot(dx, dy);
  const bend = Math.min(105, distance * 0.18);
  const midpointX = (start[0] + end[0]) / 2 + (dy / Math.max(distance, 1)) * bend;
  const midpointY = (start[1] + end[1]) / 2 - (dx / Math.max(distance, 1)) * bend;
  return `M ${start[0]} ${start[1]} Q ${midpointX} ${midpointY} ${end[0]} ${end[1]}`;
}

function trackPath(track: TransportTrackPoint[]): string {
  return track
    .flatMap((point, index) => {
      const coordinate = project(point.latitude, point.longitude);
      return coordinate
        ? [`${index === 0 ? "M" : "L"} ${coordinate[0]} ${coordinate[1]}`]
        : [];
    })
    .join(" ");
}

export default function TransportTrackingMap({
  entities,
  routes = [],
  selectedCountry,
  selectedId,
  track = [],
  mode = "all",
  onSelect,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [hovered, setHovered] = useState<TransportEntity | null>(null);
  const visibleEntities = useMemo(
    () =>
      entities
        .filter(
          (entity) =>
            (mode === "all" || entity.mode === mode) &&
            project(entity.latitude, entity.longitude),
        )
        .slice(0, selectedCountry ? 2_500 : 1_200),
    [entities, mode, selectedCountry],
  );
  const routeEntities = useMemo(
    () =>
      visibleEntities
        .filter(
          (entity) =>
            entity.origin_latitude != null &&
            entity.origin_longitude != null &&
            entity.destination_latitude != null &&
            entity.destination_longitude != null,
        )
        .slice(0, 140),
    [visibleEntities],
  );
  const visibleRoutes = useMemo(
    () => {
      if (!selectedCountry) return [];
      return routes.filter(
        (route) =>
          (mode === "all" || route.mode === mode) &&
          (route.origin_country.toUpperCase() === selectedCountry.toUpperCase() ||
            route.destination_country.toUpperCase() === selectedCountry.toUpperCase()) &&
          aggregateRoutePath(route),
      );
    },
    [mode, routes, selectedCountry],
  );
  const flowCountryNodes = useMemo(() => {
    if (!selectedCountry) return [];
    const countryCodes = new Set<string>([selectedCountry.toUpperCase()]);
    visibleRoutes.forEach((route) => {
      countryCodes.add(route.origin_country.toUpperCase());
      countryCodes.add(route.destination_country.toUpperCase());
    });
    return Array.from(countryCodes).flatMap((iso) => {
      const coordinate = countryCoordinateByIso.get(iso);
      return coordinate ? [{ iso, coordinate }] : [];
    });
  }, [selectedCountry, visibleRoutes]);
  const selected = visibleEntities.find((entity) => entity.id === selectedId);
  const countryScopeView = useMemo(() => {
    const iso = selectedCountry?.toUpperCase();
    const selectedFeature = iso ? countryFeatureByIso.get(iso) : null;
    if (!selectedFeature) return { scale: 1, x: 0, y: 0 };
    const [[featureLeft, featureTop], [featureRight, featureBottom]] =
      path.bounds(selectedFeature);
    const coordinates = visibleRoutes.flatMap((route) =>
      [
        countryCoordinateByIso.get(route.origin_country.toUpperCase()),
        countryCoordinateByIso.get(route.destination_country.toUpperCase()),
      ].filter((coordinate): coordinate is [number, number] => Boolean(coordinate)),
    );
    const left = Math.min(featureLeft, ...coordinates.map((coordinate) => coordinate[0]));
    const right = Math.max(featureRight, ...coordinates.map((coordinate) => coordinate[0]));
    const top = Math.min(featureTop, ...coordinates.map((coordinate) => coordinate[1]));
    const bottom = Math.max(featureBottom, ...coordinates.map((coordinate) => coordinate[1]));
    const scopeWidth = Math.max(1, right - left);
    const scopeHeight = Math.max(1, bottom - top);
    const scale = Math.max(
      1,
      Math.min(9, (WIDTH * 0.72) / scopeWidth, (HEIGHT * 0.68) / scopeHeight),
    );
    const center: [number, number] = [(left + right) / 2, (top + bottom) / 2];
    return {
      scale,
      x: WIDTH / 2 - center[0] * scale,
      y: HEIGHT / 2 - center[1] * scale,
    };
  }, [selectedCountry, visibleRoutes]);

  useEffect(() => {
    const coordinate = selected
      ? project(selected.latitude, selected.longitude)
      : null;
    if (coordinate) {
      const scale = 9;
      setView({
        scale,
        x: WIDTH / 2 - coordinate[0] * scale,
        y: HEIGHT / 2 - coordinate[1] * scale,
      });
      return;
    }
    setView(countryScopeView);
  }, [countryScopeView, selected]);

  const zoom = (factor: number) => {
    setView((current) => {
      const scale = Math.max(1, Math.min(18, current.scale * factor));
      const ratio = scale / current.scale;
      return {
        scale,
        x: WIDTH / 2 + (current.x - WIDTH / 2) * ratio,
        y: HEIGHT / 2 + (current.y - HEIGHT / 2) * ratio,
      };
    });
  };

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 0.88 : 1.14);
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    // Pointer capture retargets the eventual click, so markers own their gesture.
    if (
      event.target instanceof Element &&
      event.target.closest('[data-transport-entity="true"]')
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      originX: view.x,
      originY: view.y,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setView((current) => ({
      ...current,
      x: drag.originX + ((event.clientX - drag.x) / rect.width) * WIDTH,
      y: drag.originY + ((event.clientY - drag.y) / rect.height) * HEIGHT,
    }));
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="transport-map-shell">
      <div className="transport-map-controls" aria-label="Map controls">
        <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          onClick={() => setView({ scale: 1, x: 0, y: 0 })}
        >
          World
        </button>
        {selectedCountry && (
          <button type="button" onClick={() => setView(countryScopeView)}>
            Flows
          </button>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Live transport tracking map with ${visibleEntities.length} vehicles`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <rect width={WIDTH} height={HEIGHT} className="transport-map-ocean" />
        <defs>
          <marker id="transport-arrow-aviation" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
            <path d="M 0 0 L 7 3.5 L 0 7 Z" />
          </marker>
          <marker id="transport-arrow-maritime" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="strokeWidth">
            <path d="M 0 0 L 7 3.5 L 0 7 Z" />
          </marker>
        </defs>
        <g
          transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
        >
          <g className="transport-map-land">
            {countries.features.map((country, index) => (
              <path
                key={String(country.id ?? index)}
                d={path(country) ?? ""}
                data-selected={
                  countryIsoByNumeric.get(String(country.id ?? "").padStart(3, "0")) ===
                    selectedCountry?.toUpperCase() || undefined
                }
              />
            ))}
          </g>

          <g className="transport-map-flows">
            {visibleRoutes.map((route) => (
              <path
                key={`flow-${route.mode}-${route.origin_country}-${route.destination_country}`}
                d={aggregateRoutePath(route) ?? ""}
                data-mode={route.mode}
                data-origin-basis={route.origin_basis}
                style={{
                  "--flow-weight": Math.min(
                    5,
                    1.2 + Math.log2(route.active_count + 1),
                  ),
                } as CSSProperties}
                markerEnd={`url(#transport-arrow-${route.mode})`}
              >
                <title>{`${route.origin_name} → ${route.destination_name}: ${route.active_count} ${route.mode === "aviation" ? "aircraft" : "vessels"}${route.origin_basis === "observed" ? "" : route.origin_basis === "mixed" ? " (some maritime origins use vessel flag as a proxy)" : " (maritime origin uses vessel flag as a proxy)"}`}</title>
              </path>
            ))}
          </g>

          <g className="transport-map-routes">
            {routeEntities.map((entity) => (
              <path
                key={`route-${entity.id}`}
                d={routePath(entity) ?? ""}
                data-mode={entity.mode}
                data-selected={entity.id === selectedId || undefined}
              />
            ))}
          </g>

          {track.length > 1 && (
            <g className="transport-map-selected-track">
              <path className="transport-map-track" d={trackPath(track)} />
              {track.map((point, index) => {
                const coordinate = project(point.latitude, point.longitude);
                return coordinate ? (
                  <circle
                    key={`${point.observed_at}-${index}`}
                    cx={coordinate[0]}
                    cy={coordinate[1]}
                    r={index === track.length - 1 ? 3 / view.scale : 1.6 / view.scale}
                    data-latest={index === track.length - 1 || undefined}
                  />
                ) : null;
              })}
            </g>
          )}

          <g className="transport-map-flow-nodes">
            {flowCountryNodes.map(({ iso, coordinate }) => (
              <g key={iso} transform={`translate(${coordinate[0]} ${coordinate[1]}) scale(${1 / view.scale})`} data-selected={iso === selectedCountry?.toUpperCase() || undefined}>
                <circle r={iso === selectedCountry?.toUpperCase() ? 11 : 8} />
                <text y={3.2} textAnchor="middle">{iso}</text>
              </g>
            ))}
          </g>

          <g className="transport-map-entities">
            {visibleEntities.map((entity) => {
              const coordinate = project(entity.latitude, entity.longitude);
              if (!coordinate) return null;
              const isSelected = entity.id === selectedId;
              return (
                <g
                  key={entity.id}
                  transform={`translate(${coordinate[0]} ${coordinate[1]})`}
                  data-mode={entity.mode}
                  data-selected={isSelected || undefined}
                  data-alert={entity.is_alert || undefined}
                  data-transport-entity="true"
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={`${entity.display_name ?? entity.entity_id}, ${entity.mode}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect?.(entity);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect?.(entity);
                    }
                  }}
                  onPointerEnter={() => setHovered(entity)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(entity)}
                  onBlur={() => setHovered(null)}
                >
                  <g transform={`rotate(${entity.heading ?? 0}) scale(${1 / view.scale})`}>
                    <circle className="transport-map-hit-target" r={14} />
                    {entity.mode === "aviation" ? (
                      <path d="M 0 -7 L 3 -1 L 7 2 L 7 4 L 1 2 L 1 7 L -1 7 L -1 2 L -7 4 L -7 2 L -3 -1 Z" />
                    ) : (
                      <path d="M 0 -6 L 5 4 L 0 7 L -5 4 Z" />
                    )}
                    <circle
                      className="transport-map-marker-ring"
                      r={isSelected ? 11 : 7}
                    />
                  </g>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {(hovered || selected) && (
        <div className="transport-map-tooltip">
          <strong>{(hovered ?? selected)?.display_name ?? (hovered ?? selected)?.entity_id}</strong>
          <span>
            {(hovered ?? selected)?.route_label ??
              (hovered ?? selected)?.status ??
              "Route pending"}
          </span>
          <small>
            {(hovered ?? selected)?.mode === "aviation"
              ? `${Math.round((hovered ?? selected)?.altitude ?? 0).toLocaleString()} ft · ${Math.round(
                  (hovered ?? selected)?.speed ?? 0,
                )} kt`
              : `${Math.round((hovered ?? selected)?.speed ?? 0)} kt · ${
                  (hovered ?? selected)?.registration_country_iso2 ?? "unlinked flag"
                }`}
          </small>
        </div>
      )}

      <div className="transport-map-legend">
        {selectedCountry && <span><i data-mode="flow" /> Directed country flow</span>}
        <span><i data-mode="aviation" /> Aircraft</span>
        <span><i data-mode="maritime" /> Vessels</span>
        <span><i data-mode="alert" /> Alert</span>
      </div>
    </div>
  );
}

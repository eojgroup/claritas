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
  comparisonCountry?: string | null;
  selectedId?: string | null;
  track?: TransportTrackPoint[];
  mode?: TransportMode | "all";
  onSelect?: (entity: TransportEntity) => void;
  onCountrySelect?: (country: string) => void;
};

type CountryConnection = {
  mode: TransportMode;
  selectedCountry: string;
  selectedName: string;
  counterpartCountry: string;
  counterpartName: string;
  activeCount: number;
  outboundCount: number;
  inboundCount: number;
  hasProxyOrigin: boolean;
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

function countryConnectionPath(connection: CountryConnection): string | null {
  const start = countryCoordinateByIso.get(connection.selectedCountry);
  const end = countryCoordinateByIso.get(connection.counterpartCountry);
  if (!start || !end || connection.selectedCountry === connection.counterpartCountry) {
    return null;
  }
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const distance = Math.hypot(dx, dy);
  const bend = Math.min(74, distance * 0.12);
  const lane = connection.mode === "aviation" ? -1 : 1;
  const midpointX =
    (start[0] + end[0]) / 2 +
    (dy / Math.max(distance, 1)) * bend * lane;
  const midpointY =
    (start[1] + end[1]) / 2 -
    (dx / Math.max(distance, 1)) * bend * lane;
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

function entityLinksCountry(entity: TransportEntity, country: string) {
  const iso = country.trim().toUpperCase();
  return entity.country_links.some(
    (link) => link.country.trim().toUpperCase() === iso,
  );
}

function entityLinksCorridor(
  entity: TransportEntity,
  firstCountry: string,
  secondCountry: string,
) {
  const first = firstCountry.trim().toUpperCase();
  const second = secondCountry.trim().toUpperCase();
  const origin =
    entity.origin_country_iso2?.trim().toUpperCase() ??
    (entity.mode === "maritime"
      ? entity.registration_country_iso2?.trim().toUpperCase()
      : undefined);
  const destination = entity.destination_country_iso2?.trim().toUpperCase();
  return (
    (origin === first && destination === second) ||
    (origin === second && destination === first)
  );
}

function countryLinkRoles(entity: TransportEntity, country: string) {
  const iso = country.trim().toUpperCase();
  return entity.country_links
    .filter((link) => link.country.trim().toUpperCase() === iso)
    .map((link) =>
      link.role === "registration" && entity.mode === "maritime"
        ? "flag"
        : link.role,
    )
    .join(", ");
}

export default function TransportTrackingMap({
  entities,
  routes = [],
  selectedCountry,
  comparisonCountry,
  selectedId,
  track = [],
  mode = "all",
  onSelect,
  onCountrySelect,
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
            (!selectedCountry || entityLinksCountry(entity, selectedCountry)) &&
            (!selectedCountry ||
              !comparisonCountry ||
              entityLinksCorridor(
                entity,
                selectedCountry,
                comparisonCountry,
              )) &&
            project(entity.latitude, entity.longitude),
        )
        .slice(0, selectedCountry ? 2_500 : 1_200),
    [comparisonCountry, entities, mode, selectedCountry],
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
      const selected = selectedCountry.trim().toUpperCase();
      const comparison = comparisonCountry?.trim().toUpperCase();
      return routes.filter(
        (route) => {
          const origin = route.origin_country.trim().toUpperCase();
          const destination = route.destination_country.trim().toUpperCase();
          const includesSelected = origin === selected || destination === selected;
          const matchesComparison =
            !comparison ||
            ((origin === selected && destination === comparison) ||
              (origin === comparison && destination === selected));
          return (
            (mode === "all" || route.mode === mode) &&
            includesSelected &&
            matchesComparison &&
            origin !== destination &&
            countryCoordinateByIso.has(origin) &&
            countryCoordinateByIso.has(destination)
          );
        },
      );
    },
    [comparisonCountry, mode, routes, selectedCountry],
  );
  const countryConnections = useMemo(() => {
    if (!selectedCountry) return [];
    const selectedIso = selectedCountry.trim().toUpperCase();
    const connections = new Map<string, CountryConnection>();
    visibleRoutes.forEach((route) => {
      const origin = route.origin_country.trim().toUpperCase();
      const destination = route.destination_country.trim().toUpperCase();
      const selectedIsOrigin = origin === selectedIso;
      const counterpartCountry = selectedIsOrigin ? destination : origin;
      const key = `${route.mode}-${counterpartCountry}`;
      const connection = connections.get(key) ?? {
        mode: route.mode,
        selectedCountry: selectedIso,
        selectedName: selectedIsOrigin ? route.origin_name : route.destination_name,
        counterpartCountry,
        counterpartName: selectedIsOrigin
          ? route.destination_name
          : route.origin_name,
        activeCount: 0,
        outboundCount: 0,
        inboundCount: 0,
        hasProxyOrigin: false,
      };
      connection.activeCount += route.active_count;
      if (selectedIsOrigin) {
        connection.outboundCount += route.active_count;
      } else {
        connection.inboundCount += route.active_count;
      }
      connection.hasProxyOrigin ||= route.origin_basis !== "observed";
      connections.set(key, connection);
    });
    return Array.from(connections.values()).filter(countryConnectionPath);
  }, [selectedCountry, visibleRoutes]);
  const flowCountryNodes = useMemo(() => {
    if (!selectedCountry) return [];
    const countryCodes = new Set<string>([selectedCountry.toUpperCase()]);
    countryConnections.forEach((connection) => {
      countryCodes.add(connection.counterpartCountry);
    });
    return Array.from(countryCodes).flatMap((iso) => {
      const coordinate = countryCoordinateByIso.get(iso);
      return coordinate ? [{ iso, coordinate }] : [];
    });
  }, [countryConnections, selectedCountry]);
  const selected = visibleEntities.find((entity) => entity.id === selectedId);
  const focusedEntity = hovered ?? selected;
  const countryScopeView = useMemo(() => {
    const iso = selectedCountry?.toUpperCase();
    const selectedFeature = iso ? countryFeatureByIso.get(iso) : null;
    if (!selectedFeature) return { scale: 1, x: 0, y: 0 };
    const [[featureLeft, featureTop], [featureRight, featureBottom]] =
      path.bounds(selectedFeature);
    const coordinates = countryConnections.flatMap((connection) =>
      [
        countryCoordinateByIso.get(connection.selectedCountry),
        countryCoordinateByIso.get(connection.counterpartCountry),
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
  }, [countryConnections, selectedCountry]);

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
      event.target.closest(
        '[data-transport-entity="true"], [data-transport-country-node="true"]',
      )
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
            Links
          </button>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Live transport tracking map with ${visibleEntities.length} vehicles and ${countryConnections.length} country connections${comparisonCountry ? ` between ${selectedCountry} and ${comparisonCountry}` : ""}`}
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
            {countries.features.map((country, index) => {
              const iso = countryIsoByNumeric.get(
                String(country.id ?? "").padStart(3, "0"),
              );
              return (
                <path
                  key={String(country.id ?? index)}
                  d={path(country) ?? ""}
                  data-selected={
                    iso === selectedCountry?.trim().toUpperCase() || undefined
                  }
                  data-comparison={
                    iso === comparisonCountry?.trim().toUpperCase() || undefined
                  }
                />
              );
            })}
          </g>

          <g className="transport-map-connections">
            {countryConnections.map((connection) => {
              const connectionPath = countryConnectionPath(connection) ?? "";
              const connectionStyle = {
                "--connection-weight": `${Math.min(
                  5,
                  1.2 + Math.log2(connection.activeCount + 1),
                )}px`,
              } as CSSProperties;
              const unit =
                connection.mode === "aviation" ? "flights" : "vessels";
              const qualification = connection.hasProxyOrigin
                ? " · includes flag-proxy origin evidence"
                : "";
              return (
                <g
                  key={`connection-${connection.mode}-${connection.counterpartCountry}`}
                  data-mode={connection.mode}
                >
                  <path
                    className="transport-map-connection-halo"
                    d={connectionPath}
                    style={connectionStyle}
                  />
                  <path
                    className="transport-map-connection-band"
                    d={connectionPath}
                    data-mode={connection.mode}
                    style={connectionStyle}
                  >
                    <title>{`${connection.selectedName} ↔ ${connection.counterpartName}: ${connection.activeCount} active ${unit} · ${connection.outboundCount} outbound · ${connection.inboundCount} inbound${qualification}`}</title>
                  </path>
                </g>
              );
            })}
          </g>

          <g className="transport-map-routes">
            {routeEntities.map((entity) => (
              <path
                key={`route-${entity.id}`}
                d={routePath(entity) ?? ""}
                data-mode={entity.mode}
                data-selected={entity.id === selectedId || undefined}
                markerEnd={`url(#transport-arrow-${entity.mode})`}
              >
                <title>{`${entity.display_name ?? entity.entity_id}: ${entity.route_label ?? "resolved vehicle route"}`}</title>
              </path>
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
            {flowCountryNodes.map(({ iso, coordinate }) => {
              const isSelected =
                iso === selectedCountry?.trim().toUpperCase();
              const isComparison =
                iso === comparisonCountry?.trim().toUpperCase();
              const isSelectable = !isSelected && Boolean(onCountrySelect);
              return (
                <g
                  key={iso}
                  transform={`translate(${coordinate[0]} ${coordinate[1]}) scale(${1 / view.scale})`}
                  data-selected={isSelected || undefined}
                  data-comparison={isComparison || undefined}
                  data-selectable={isSelectable || undefined}
                  data-transport-country-node="true"
                  tabIndex={isSelectable ? 0 : undefined}
                  role={isSelectable ? "button" : undefined}
                  aria-label={
                    isSelectable
                      ? `Compare ${selectedCountry} with ${iso}`
                      : undefined
                  }
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isSelectable) onCountrySelect?.(iso);
                  }}
                  onKeyDown={(event) => {
                    if (
                      isSelectable &&
                      (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      onCountrySelect?.(iso);
                    }
                  }}
                >
                  <circle r={isSelected || isComparison ? 11 : 8} />
                  <text y={3.2} textAnchor="middle">{iso}</text>
                </g>
              );
            })}
          </g>

          <g className="transport-map-entities">
            {visibleEntities.map((entity) => {
              const coordinate = project(entity.latitude, entity.longitude);
              if (!coordinate) return null;
              const isSelected = entity.id === selectedId;
              const isCountryLinked = Boolean(
                selectedCountry && entityLinksCountry(entity, selectedCountry),
              );
              return (
                <g
                  key={entity.id}
                  transform={`translate(${coordinate[0]} ${coordinate[1]})`}
                  data-mode={entity.mode}
                  data-selected={isSelected || undefined}
                  data-country-linked={isCountryLinked || undefined}
                  data-alert={entity.is_alert || undefined}
                  data-transport-entity="true"
                  tabIndex={0}
                  role="button"
                  aria-pressed={isSelected}
                  aria-label={`${entity.display_name ?? entity.entity_id}, ${entity.mode}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
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
                    <circle className="transport-map-hit-target" r={17} />
                    {entity.mode === "aviation" ? (
                      <path d="M 0 -7 L 3 -1 L 7 2 L 7 4 L 1 2 L 1 7 L -1 7 L -1 2 L -7 4 L -7 2 L -3 -1 Z" />
                    ) : (
                      <path d="M 0 -6 L 5 4 L 0 7 L -5 4 Z" />
                    )}
                    <circle
                      className="transport-map-marker-ring"
                      r={isSelected ? 11 : isCountryLinked ? 9 : 7}
                    />
                  </g>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {focusedEntity && (
        <div className="transport-map-tooltip">
          <strong>{focusedEntity.display_name ?? focusedEntity.entity_id}</strong>
          <span>
            {focusedEntity.route_label ??
              focusedEntity.status ??
              "Route pending"}
          </span>
          <small>
            {focusedEntity.mode === "aviation"
              ? `${Math.round(focusedEntity.altitude ?? 0).toLocaleString()} ft · ${Math.round(
                  focusedEntity.speed ?? 0,
                )} kt`
              : `${Math.round(focusedEntity.speed ?? 0)} kt · ${
                  focusedEntity.registration_country_iso2 ?? "unlinked flag"
                }`}
          </small>
          {selectedCountry && (
            <small>
              {selectedCountry.toUpperCase()} link: {countryLinkRoles(
                focusedEntity,
                selectedCountry,
              ) || "country association"}
            </small>
          )}
          <small>Select marker to inspect and follow</small>
        </div>
      )}

      <div className="transport-map-legend">
        {selectedCountry && mode !== "maritime" && <span><i data-mode="aviation-link" /> Flight connection</span>}
        {selectedCountry && mode !== "aviation" && <span><i data-mode="maritime-link" /> Shipping connection</span>}
        {routeEntities.length > 0 && <span><i data-mode="direction" /> Vehicle route direction</span>}
        {selectedCountry && <span><i data-mode="linked" /> Country-linked vehicle</span>}
        {comparisonCountry && <span><i data-mode="comparison" /> Compared country</span>}
        <span><i data-mode="aviation" /> Aircraft</span>
        <span><i data-mode="maritime" /> Vessels</span>
        <span><i data-mode="alert" /> Alert</span>
      </div>
    </div>
  );
}

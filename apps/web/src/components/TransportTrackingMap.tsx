import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldAtlas from "world-atlas/countries-110m.json";
import type { FeatureCollection, Geometry } from "geojson";
import type {
  GeometryCollection,
  Properties,
  Topology,
} from "topojson-specification";
import type {
  TransportEntity,
  TransportMode,
  TransportTrackPoint,
} from "../lib/api";

type Props = {
  entities: TransportEntity[];
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
        .slice(0, 1_200),
    [entities, mode],
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
  const selected = visibleEntities.find((entity) => entity.id === selectedId);

  const zoom = (factor: number) => {
    setView((current) => ({
      ...current,
      scale: Math.max(1, Math.min(6, current.scale * factor)),
    }));
  };

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 0.88 : 1.14);
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
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
          Reset
        </button>
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
        <g
          transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}
          style={{ transformOrigin: "center" }}
        >
          <g className="transport-map-land">
            {countries.features.map((country, index) => (
              <path key={String(country.id ?? index)} d={path(country) ?? ""} />
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
            <path className="transport-map-track" d={trackPath(track)} />
          )}

          <g className="transport-map-entities">
            {visibleEntities.map((entity) => {
              const coordinate = project(entity.latitude, entity.longitude);
              if (!coordinate) return null;
              const isSelected = entity.id === selectedId;
              return (
                <g
                  key={entity.id}
                  transform={`translate(${coordinate[0]} ${coordinate[1]}) rotate(${entity.heading ?? 0})`}
                  data-mode={entity.mode}
                  data-selected={isSelected || undefined}
                  data-alert={entity.is_alert || undefined}
                  tabIndex={0}
                  role="button"
                  aria-label={`${entity.display_name ?? entity.entity_id}, ${entity.mode}`}
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
                >
                  {entity.mode === "aviation" ? (
                    <path d="M 0 -7 L 3 -1 L 7 2 L 7 4 L 1 2 L 1 7 L -1 7 L -1 2 L -7 4 L -7 2 L -3 -1 Z" />
                  ) : (
                    <path d="M 0 -6 L 5 4 L 0 7 L -5 4 Z" />
                  )}
                  <circle r={isSelected ? 11 : 7} />
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
        <span><i data-mode="aviation" /> Aircraft</span>
        <span><i data-mode="maritime" /> Vessels</span>
        <span><i data-mode="alert" /> Alert</span>
      </div>
    </div>
  );
}

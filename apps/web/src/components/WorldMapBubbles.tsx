import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
  value?: number;
  tone?:
    | "signal"
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

export type WorldMapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
  label?: string;
  severity?: "low" | "medium" | "high" | "critical";
  hasImagery?: boolean;
  selected?: boolean;
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
  featuredCountry?: string | null;
  featuredLabel?: string;
  scale?: "linear" | "log";
  showLabels?: boolean;
  legendLabel?: string;
  fillMode?:
    | "default"
    | "temperature"
    | "diverging"
    | "sequential"
    | "relevance";
  valueDomain?: [number, number];
  valueUnit?: string;
  showBubbles?: boolean;
  points?: WorldMapPoint[];
  onSelectPoint?: (point: WorldMapPoint) => void;
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
  value: number;
  coordinate: [number, number];
  tone?: BubbleDatum["tone"];
  meta?: BubbleDatum["meta"];
};

type ViewTransform = {
  scale: number;
  x: number;
  y: number;
};

type ActivePointer = {
  clientX: number;
  clientY: number;
};

type PinchGesture = {
  startDistance: number;
  startMidpointX: number;
  startMidpointY: number;
  startScale: number;
  worldX: number;
  worldY: number;
  moved: boolean;
};

const INITIAL_SIZE = { width: 960, height: 480 };
const GESTURE_CLICK_SUPPRESSION_MS = 900;

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
    signal: isDark
      ? { fill: "#f0a66f", stroke: "#fff0d9", halo: "rgba(240,166,111,0.3)" }
      : { fill: "#c96d35", stroke: "#672f12", halo: "rgba(201,109,53,0.24)" },
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

function eventPointColor(
  severity: WorldMapPoint["severity"],
  isDark: boolean,
) {
  const colors = isDark
    ? { low: "#7eb8c9", medium: "#e0b86e", high: "#ee9463", critical: "#ef625c" }
    : { low: "#35758a", medium: "#9c7429", high: "#b9572f", critical: "#ad302e" };
  return colors[severity ?? "low"];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distanceBetween(
  first: ActivePointer,
  second: ActivePointer,
) {
  return Math.hypot(
    second.clientX - first.clientX,
    second.clientY - first.clientY,
  );
}

function midpointBetween(
  first: ActivePointer,
  second: ActivePointer,
) {
  return {
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2,
  };
}

function mapWheelZoomFactor(
  event: Pick<WheelEvent, "ctrlKey" | "metaKey" | "deltaMode" | "deltaY">,
  pageHeight: number,
) {
  const pixelDelta = event.deltaY * (
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, pageHeight)
        : 1
  );
  const boundedDelta = clamp(pixelDelta, -240, 240);
  const sensitivity = event.ctrlKey || event.metaKey ? 0.01 : 0.0018;
  return Math.exp(-boundedDelta * sensitivity);
}

function interpolateRgb(from: [number, number, number], to: [number, number, number], ratio: number) {
  const bounded = clamp(ratio, 0, 1);
  const channels = from.map((value, index) => Math.round(value + (to[index] - value) * bounded));
  return `rgb(${channels.join(",")})`;
}

function choroplethColor(
  value: number,
  mode: "temperature" | "diverging" | "sequential" | "relevance",
  domain: [number, number],
  dark: boolean,
) {
  const [rawMin, rawMax] = domain;
  const min = Math.min(rawMin, rawMax);
  const max = Math.max(rawMin, rawMax);
  if (mode === "temperature") {
    const ratio = (value - min) / Math.max(max - min, 0.0001);
    if (ratio < 0.5) {
      return interpolateRgb(dark ? [43, 91, 135] : [55, 113, 166], dark ? [211, 190, 126] : [239, 209, 126], ratio * 2);
    }
    return interpolateRgb(dark ? [211, 190, 126] : [239, 209, 126], dark ? [189, 65, 54] : [191, 54, 45], (ratio - 0.5) * 2);
  }
  if (mode === "sequential") {
    const ratio = (value - min) / Math.max(max - min, 0.0001);
    return interpolateRgb(
      dark ? [43, 57, 75] : [218, 227, 235],
      dark ? [116, 91, 184] : [99, 68, 173],
      ratio
    );
  }
  if (mode === "relevance") {
    const ratio = clamp((value - min) / Math.max(max - min, 0.0001), 0, 1);
    const low: [number, number, number] = dark ? [28, 48, 65] : [218, 228, 237];
    const middle: [number, number, number] = dark ? [48, 91, 109] : [112, 157, 176];
    const high: [number, number, number] = dark ? [216, 117, 67] : [190, 82, 43];
    return ratio < 0.55
      ? interpolateRgb(low, middle, ratio / 0.55)
      : interpolateRgb(middle, high, (ratio - 0.55) / 0.45);
  }
  const bound = Math.max(Math.abs(min), Math.abs(max), 0.0001);
  const normalized = clamp(value / bound, -1, 1);
  const neutral: [number, number, number] = dark ? [111, 105, 92] : [189, 181, 164];
  return normalized < 0
    ? interpolateRgb(neutral, dark ? [185, 63, 68] : [166, 48, 55], -normalized)
    : interpolateRgb(neutral, dark ? [45, 139, 117] : [39, 121, 101], normalized);
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
  featuredCountry,
  featuredLabel = "Highest relevance",
  scale = "linear",
  showLabels = true,
  legendLabel = "Relative intensity",
  fillMode = "default",
  valueDomain,
  valueUnit = "",
  showBubbles = true,
  points = [],
  onSelectPoint,
}: WorldMapBubblesProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const activePointersRef = useRef(new globalThis.Map<number, ActivePointer>());
  const pinchRef = useRef<PinchGesture | null>(null);
  const gestureMovedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const wheelZoomArmedRef = useRef(false);
  const [size, setSize] = useState(INITIAL_SIZE);
  const [view, setView] = useState<ViewTransform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [wheelZoomArmed, setWheelZoomArmed] = useState(false);
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{
    point: WorldMapPoint;
    x: number;
    y: number;
  } | null>(null);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    country: string;
    value: number;
    rank: number;
    meta?: BubbleDatum["meta"];
  } | null>(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const isDark = Boolean(dark);
  const isCompact = variant === "compact";
  const primaryIso = primaryCountry?.toUpperCase();
  const secondaryIso = secondaryCountry?.toUpperCase();
  const pinnedIso = pinnedCountry?.toUpperCase();
  const featuredIso = featuredCountry?.toUpperCase();

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
        value: Number.isFinite(datum.value) ? Number(datum.value) : datum.count,
        coordinate,
        tone: datum.tone,
        meta: datum.meta,
      });
    });
    return next.sort((a, b) => a.count - b.count);
  }, [data]);
  const eventPoints = useMemo(
    () => points
      .filter((point) =>
        Number.isFinite(point.latitude) &&
        Number.isFinite(point.longitude) &&
        point.latitude >= -90 &&
        point.latitude <= 90 &&
        point.longitude >= -180 &&
        point.longitude <= 180,
      )
      .slice(0, 120),
    [points],
  );

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
  const dataValueDomain = useMemo<[number, number]>(() => {
    if (valueDomain) return valueDomain;
    if (markers.length === 0) return [0, 1];
    return [
      Math.min(...markers.map((marker) => marker.value)),
      Math.max(...markers.map((marker) => marker.value)),
    ];
  }, [markers, valueDomain]);

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
    const projectedPoints = [
      ...markers.map((marker) => marker.coordinate),
      ...eventPoints.map((point): [number, number] => [point.longitude, point.latitude]),
    ]
      .map((coordinate) => projection(coordinate))
      .filter((point): point is [number, number] => Boolean(point));
    if (projectedPoints.length < 2) {
      setView({ scale: 1, x: 0, y: 0 });
      return;
    }
    const xs = projectedPoints.map((point) => point[0]);
    const ys = projectedPoints.map((point) => point[1]);
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
  }, [eventPoints, isCompact, markers, projection, size.height, size.width]);

  const zoomByAt = useCallback(
    (factor: number, anchorX: number, anchorY: number) => {
      setView((current) => {
        const scaleValue = clamp(current.scale * factor, 1, 5);
        const ratio = scaleValue / current.scale;
        const next = {
          scale: scaleValue,
          x: anchorX - (anchorX - current.x) * ratio,
          y: anchorY - (anchorY - current.y) * ratio,
        };
        viewRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      // Ordinary page scrolling must remain inert while the pointer merely
      // happens to cross the map. Mouse-wheel zoom is deliberately armed by a
      // click/drag on the map; browser/trackpad pinch (ctrlKey) remains direct.
      if (!event.ctrlKey && !event.metaKey && !wheelZoomArmedRef.current) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const anchorX = (event.clientX - rect.left) * (size.width / rect.width);
      const anchorY = (event.clientY - rect.top) * (size.height / rect.height);
      const factor = mapWheelZoomFactor(event, rect.height);
      const nextScale = clamp(viewRef.current.scale * factor, 1, 5);
      // Release the wheel back to document scrolling once the user reaches a
      // zoom boundary. Otherwise one gesture must perform exactly one action:
      // transform the map without also moving/reflowing the surrounding page.
      if (Math.abs(nextScale - viewRef.current.scale) < 0.0001) return;
      event.preventDefault();
      zoomByAt(factor, anchorX, anchorY);
      setHoveredPoint(null);
      setTip(null);
    };

    // React delegates wheel events through a passive root listener in current
    // browsers. A native non-passive listener is required to avoid the old
    // double action where one wheel tick both moved the page and zoomed the map.
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [size.height, size.width, zoomByAt]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const preserveTwoFingerGesture = (event: TouchEvent) => {
      if (event.touches.length >= 2 && event.cancelable) {
        event.preventDefault();
      }
    };
    // CSS leaves one-finger vertical pan to the document. Reserving only
    // multi-touch movement prevents the browser from claiming an intentional
    // two-finger map pinch/pan before the pointer handlers can process it.
    svg.addEventListener("touchmove", preserveTwoFingerGesture, {
      passive: false,
    });
    return () => svg.removeEventListener("touchmove", preserveTwoFingerGesture);
  }, []);

  const clientToMap = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1 || rect.height < 1) return null;
    return {
      x: (clientX - rect.left) * (size.width / rect.width),
      y: (clientY - rect.top) * (size.height / rect.height),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (event.pointerType !== "touch") {
      wheelZoomArmedRef.current = true;
      setWheelZoomArmed(true);
    }
    activePointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (activePointersRef.current.size >= 2) {
      activePointersRef.current.forEach((_, pointerId) => {
        try {
          event.currentTarget.setPointerCapture(pointerId);
        } catch {
          // A browser can reject capture if a pointer ended between events.
        }
      });
      const [first, second] = [...activePointersRef.current.values()];
      const midpoint = midpointBetween(first, second);
      const anchor = clientToMap(midpoint.clientX, midpoint.clientY);
      if (anchor) {
        const current = viewRef.current;
        pinchRef.current = {
          startDistance: Math.max(1, distanceBetween(first, second)),
          startMidpointX: midpoint.clientX,
          startMidpointY: midpoint.clientY,
          startScale: current.scale,
          worldX: (anchor.x - current.x) / current.scale,
          worldY: (anchor.y - current.y) / current.scale,
          moved: false,
        };
      }
      dragRef.current = null;
      return;
    }
    if (event.pointerType === "touch") {
      // A single finger belongs to normal vertical page scrolling. Touch map
      // manipulation starts only after a second active pointer is present.
      dragRef.current = null;
      return;
    }
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
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }
    if (pinchRef.current && activePointersRef.current.size >= 2) {
      const [first, second] = [...activePointersRef.current.values()];
      const pinch = pinchRef.current;
      const distance = Math.max(1, distanceBetween(first, second));
      const midpoint = midpointBetween(first, second);
      const anchor = clientToMap(midpoint.clientX, midpoint.clientY);
      if (!anchor) return;
      const scaleValue = clamp(
        pinch.startScale * (distance / pinch.startDistance),
        1,
        5,
      );
      const next = {
        scale: scaleValue,
        x: anchor.x - pinch.worldX * scaleValue,
        y: anchor.y - pinch.worldY * scaleValue,
      };
      if (Math.abs(distance - pinch.startDistance) > 3) {
        pinch.moved = true;
        gestureMovedRef.current = true;
      }
      if (
        Math.abs(midpoint.clientX - pinch.startMidpointX) +
          Math.abs(midpoint.clientY - pinch.startMidpointY) >
        3
      ) {
        pinch.moved = true;
        gestureMovedRef.current = true;
      }
      viewRef.current = next;
      setView(next);
      setIsDragging(true);
      event.preventDefault();
      return;
    }
    if (event.pointerType === "touch") return;
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      gestureMovedRef.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can race with a pointer leaving the document.
      }
      setIsDragging(true);
    }
    if (!drag.moved) return;
    setView((current) => {
      const next = {
        ...current,
        x: drag.originX + dx,
        y: drag.originY + dy,
      };
      viewRef.current = next;
      return next;
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId && drag.moved) {
      gestureMovedRef.current = true;
    }
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (drag?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
    if (activePointersRef.current.size === 0) {
      if (gestureMovedRef.current) {
        // Mobile browsers may synthesize click well after pointerup. A
        // timestamp remains reliable across that delay, unlike a zero-timeout
        // boolean, and is checked by both country and event targets.
        suppressClickUntilRef.current = Date.now() + GESTURE_CLICK_SUPPRESSION_MS;
      }
      gestureMovedRef.current = false;
      setIsDragging(false);
    }
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const gestureClickIsSuppressed = () =>
    Date.now() < suppressClickUntilRef.current;

  const handleCountrySelect = (iso: string) => {
    if (gestureClickIsSuppressed()) return;
    onSelect?.(iso);
  };

  const handlePointSelect = (point: WorldMapPoint) => {
    if (gestureClickIsSuppressed()) return;
    onSelectPoint?.(point);
  };

  const updateTip = (
    event: ReactPointerEvent<SVGElement>,
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
  const featuredMarker = featuredIso
    ? markerByCountry.get(featuredIso)
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
        tabIndex={0}
        style={{ touchAction: "pan-y" }}
        aria-label="Interactive world signal map. Use the mouse wheel, trackpad, or pinch gesture to zoom and drag to pan."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (!isDragging) {
            wheelZoomArmedRef.current = false;
            setWheelZoomArmed(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            wheelZoomArmedRef.current = false;
            setWheelZoomArmed(false);
            event.currentTarget.blur();
          }
        }}
      >
        <title>Scroll or pinch over the map to zoom. Drag to pan.</title>
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
            const isFeatured = featuredIso === iso;
            const isHovered = hoveredCountry === iso;
            const fill = fillMode !== "default" && marker
              ? choroplethColor(marker.value, fillMode, dataValueDomain, isDark)
              : isPrimary
                ? isDark
                  ? "#d47b47"
                  : "#c96735"
                : isSecondary
                  ? isDark
                    ? "#4f92ad"
                    : "#5d91a8"
                  : isFeatured
                    ? isDark
                      ? "#536f80"
                      : "#8fb1c2"
                    : marker
                      ? isDark
                        ? "#36596c"
                        : "#86a8b8"
                      : isDark
                        ? "#16283a"
                        : "#d4dee7";
            const opacity = isPrimary
              ? 0.95
              : isSecondary
                ? 0.9
                : isHovered
                  ? 0.88
              : marker
                    ? fillMode === "default" ? 0.56 + intensity * 0.34 : 0.88
                    : 0.82;
            const stroke =
              isFeatured
                ? isDark
                  ? "#ffd7b5"
                  : "#713513"
                : isPrimary || isSecondary || isHovered
                  ? isDark
                    ? "#e6f2f5"
                    : "#284b5a"
                : isDark
                  ? "#506b80"
                  : "#91a5b5";
            return (
              <path
                key={iso}
                d={path(countryFeature) ?? undefined}
                fill={fill}
                fillOpacity={opacity}
                stroke={stroke}
                strokeWidth={
                  isFeatured
                    ? 2.4
                    : isPrimary || isSecondary || isHovered
                      ? 1.4
                      : 0.55
                }
                vectorEffect="non-scaling-stroke"
                role="button"
                tabIndex={marker || isPrimary || isSecondary ? 0 : -1}
                aria-label={`${countryFeature.properties.name}${
                  marker ? `: ${marker.count}` : ": no mapped signal"
                }`}
                className="world-map-country"
                onPointerEnter={(event) => marker ? updateTip(event, marker) : setHoveredCountry(iso)}
                onPointerMove={(event) => marker && updateTip(event, marker)}
                onPointerLeave={() => { setHoveredCountry(null); setTip(null); }}
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

          {!showBubbles && featuredMarker && (() => {
            const point = projection(featuredMarker.coordinate);
            if (!point) return null;
            return (
              <g
                transform={`translate(${point[0]} ${point[1]})`}
                className="world-map-featured-marker"
                pointerEvents="none"
              >
                <circle
                  r={12 / view.scale}
                  fill="none"
                  stroke={isDark ? "#ffd7b5" : "#713513"}
                  strokeDasharray={`${3 / view.scale} ${2 / view.scale}`}
                  strokeWidth={2.25 / view.scale}
                />
                <circle
                  r={4 / view.scale}
                  fill={isDark ? "#fff0d9" : "#713513"}
                  stroke={isDark ? "#7d3514" : "#fff7ef"}
                  strokeWidth={1.25 / view.scale}
                />
                <text
                  y={-16 / view.scale}
                  textAnchor="middle"
                  fill={labelColor}
                  stroke={isDark ? "#07121a" : "#eef2f3"}
                  strokeWidth={3 / view.scale}
                  paintOrder="stroke"
                  fontSize={10 / view.scale}
                  fontWeight={800}
                >
                  {featuredMarker.country} · #1
                </text>
              </g>
            );
          })()}

          {showBubbles && markers.map((marker) => {
            const point = projection(marker.coordinate);
            if (!point) return null;
            const isPrimary = primaryIso === marker.country;
            const isSecondary = secondaryIso === marker.country;
            const isPinned = pinnedIso === marker.country;
            const isFeatured = featuredIso === marker.country;
            const palette = markerPalette(marker.tone, isDark);
            const radius = radiusFor(marker.count) / view.scale;
            const showMarkerLabel =
              (showLabels &&
                (rankByCountry.get(marker.country) ?? Infinity) <=
                  (isCompact ? 10 : 16)) ||
              isPrimary ||
              isSecondary ||
              isPinned ||
              isFeatured ||
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
                {isFeatured && (
                  <circle
                    r={radius + 8 / view.scale}
                    fill="none"
                    stroke={isDark ? "#ffd7b5" : "#8a431e"}
                    strokeDasharray={`${3 / view.scale} ${2 / view.scale}`}
                    strokeWidth={2.25 / view.scale}
                    className="world-map-featured-ring"
                  />
                )}
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
                {isFeatured && (
                  <text
                    x={radius + 5 / view.scale}
                    y={radius + 7 / view.scale}
                    fill={labelColor}
                    stroke={isDark ? "#07121a" : "#eef2f3"}
                    strokeWidth={3 / view.scale}
                    paintOrder="stroke"
                    fontSize={9 / view.scale}
                    fontWeight={800}
                    className="world-map-featured-rank"
                  >
                    #1
                  </text>
                )}
              </g>
            );
          })}

          {eventPoints.map((eventPoint, index) => {
            const point = projection([eventPoint.longitude, eventPoint.latitude]);
            if (!point) return null;
            const color = eventPointColor(eventPoint.severity, isDark);
            const radius = (eventPoint.severity === "critical"
              ? 7
              : eventPoint.severity === "high"
                ? 6
                : 5) / view.scale;
            const showPointLabel = eventPoint.selected || index < (isCompact ? 5 : 8);
            return (
              <g
                key={eventPoint.id}
                transform={`translate(${point[0]} ${point[1]})`}
                className="world-map-event"
                role="button"
                tabIndex={0}
                aria-label={`${eventPoint.title}. ${eventPoint.subtitle ?? "Mapped event"}`}
                onPointerEnter={(event) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setHoveredPoint({
                    point: eventPoint,
                    x: clamp(event.clientX - rect.left + 12, 8, rect.width - 280),
                    y: clamp(event.clientY - rect.top + 12, 8, rect.height - 128),
                  });
                }}
                onPointerLeave={() => setHoveredPoint(null)}
                onClick={() => handlePointSelect(eventPoint)}
                onKeyDown={(event: ReactKeyboardEvent<SVGGElement>) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectPoint?.(eventPoint);
                  }
                }}
              >
                <circle
                  r={radius + 5 / view.scale}
                  fill={color}
                  fillOpacity={0.2}
                  className="world-map-bubble-halo"
                />
                {eventPoint.hasImagery && (
                  <circle
                    r={radius + 4 / view.scale}
                    fill="none"
                    stroke={isDark ? "#7ed4e6" : "#176b7c"}
                    strokeWidth={1.75 / view.scale}
                    strokeDasharray={`${2.4 / view.scale} ${1.8 / view.scale}`}
                  />
                )}
                {eventPoint.selected && (
                  <circle
                    r={radius + 8 / view.scale}
                    fill="none"
                    stroke={isDark ? "#fff0d9" : "#57290f"}
                    strokeWidth={2.2 / view.scale}
                  />
                )}
                <circle
                  r={radius}
                  fill={color}
                  stroke={isDark ? "#fff7ed" : "#ffffff"}
                  strokeWidth={1.4 / view.scale}
                />
                {showPointLabel && (
                  <text
                    y={-(radius + 6 / view.scale)}
                    textAnchor="middle"
                    fill={labelColor}
                    stroke={isDark ? "#07121a" : "#eef2f3"}
                    strokeWidth={3 / view.scale}
                    paintOrder="stroke"
                    fontSize={9 / view.scale}
                    fontWeight={800}
                  >
                    {eventPoint.label ?? eventPoint.severity?.toUpperCase() ?? "EVENT"}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-3 right-3 z-[2] hidden rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-bg-elevated)]/90 px-2.5 py-1 text-[9px] font-semibold text-[color:var(--shell-muted)] shadow-sm backdrop-blur sm:block">
        {wheelZoomArmed
          ? "Scroll zoom active · leave map or press Esc to release"
          : "Click map to enable scroll zoom · pinch anytime"}
      </div>

      <div className="world-map-controls absolute right-3 top-3">
        <button
          type="button"
          onClick={() =>
            zoomByAt(1.35, size.width / 2, size.height / 2)
          }
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() =>
            zoomByAt(1 / 1.35, size.width / 2, size.height / 2)
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

      {hoveredPoint && (
        <div
          className="app-card pointer-events-none absolute z-10 w-64 rounded-lg p-3 text-left shadow-xl"
          style={{ left: hoveredPoint.x, top: hoveredPoint.y }}
          aria-hidden="true"
        >
          <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--shell-muted)]">
            {hoveredPoint.point.severity ?? "low"} event
            {hoveredPoint.point.hasImagery ? " · satellite available" : " · reported location"}
          </span>
          <strong className="mt-1 line-clamp-2 block text-xs leading-5 text-[color:var(--shell-ink)]">
            {hoveredPoint.point.title}
          </strong>
          {hoveredPoint.point.subtitle && (
            <small className="mt-1 block text-[color:var(--shell-muted)]">
              {hoveredPoint.point.subtitle}
            </small>
          )}
        </div>
      )}

      {featuredMarker && !hoveredCountry && !tip && (
        <button
          type="button"
          className="map-featured-country absolute left-3 top-3"
          onClick={() => handleCountrySelect(featuredMarker.country)}
        >
          <span>{featuredLabel}</span>
          <strong>
            {WORLD_GEOMETRY.nameByIso.get(featuredMarker.country) ??
              featuredMarker.country}
            <small> · {featuredMarker.country}</small>
          </strong>
          <em>
            {featuredMarker.meta?.subtitle ??
              `${featuredMarker.count} mapped signals`}
          </em>
          <small>Select to inspect the drivers</small>
        </button>
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
          {fillMode === "default" ? <div className="flex items-center gap-2">
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
          </div> : <div>
            <div
              className="h-2.5 w-40 rounded-full border border-current/20"
              style={{
                background: fillMode === "temperature"
                  ? "linear-gradient(90deg, rgb(55,113,166), rgb(239,209,126), rgb(191,54,45))"
                  : fillMode === "sequential"
                    ? "linear-gradient(90deg, rgb(218,227,235), rgb(99,68,173))"
                    : fillMode === "relevance"
                      ? "linear-gradient(90deg, rgb(208,221,225), rgb(218,181,126), rgb(188,83,34))"
                    : "linear-gradient(90deg, rgb(166,48,55), rgb(189,181,164), rgb(39,121,101))",
              }}
            />
            <div className="mt-1 flex justify-between gap-4 text-[10px]">
              <span>{dataValueDomain[0].toFixed(1)}{valueUnit}</span>
              <span>{dataValueDomain[1].toFixed(1)}{valueUnit}</span>
            </div>
          </div>}
          {fillMode === "default" && <div className="mt-0.5 flex justify-between gap-4 text-[10px]">
            <span>Min {min}</span>
            <span>Max {max}</span>
          </div>}
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

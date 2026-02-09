import { memo, useMemo, useRef, useState } from 'react';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import worldData from 'world-atlas/countries-110m.json';
import worldCountries from 'world-countries';

export type BubbleDatum = {
  country: string; // ISO2 code (not strictly needed for centroids)
  count: number;
};

export type WorldMapBubblesProps = {
  data: BubbleDatum[];
  onSelect?: (countryIso2: string) => void;
  dark?: boolean;
  legend?: boolean;
  variant?: "default" | "compact";
};

// TopoJSON -> GeoJSON features
const countries: any = (feature(worldData as any, (worldData as any).objects.countries) as any).features;

// Fixed-size projection matching the component's viewBox (800x400)
// This ensures bubbles and map align predictably across browsers.
const projection = geoEqualEarth().fitSize([800, 400], { type: 'Sphere' } as any);

export default memo(function WorldMapBubbles({
  data,
  onSelect,
  dark,
  legend = true,
  variant = "default",
}: WorldMapBubblesProps) {
  const path = useMemo(() => geoPath(projection), []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<{ show: boolean; x: number; y: number; country: string; value: number } | null>(null);

  // Build coarse centroids keyed by ISO2 using world-countries lat/lng metadata.
  // world-countries provides `latlng: [lat, lng]` — flip to [lng, lat] for d3 projections.
  const centroids = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const f of worldCountries as any[]) {
      const iso = (f.cca2 || f.properties?.cca2 || '').toUpperCase();
      const latlng = (f as any).latlng as [number, number] | undefined;
      if (!iso || !latlng || latlng.length < 2) continue;
      const [lat, lng] = latlng;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        map.set(iso, [lng, lat]);
      }
    }
    // Aliases
    if (map.has('GB')) map.set('UK', map.get('GB')!);
    return map;
  }, []);

  const max = useMemo(() => data.reduce((m, d) => Math.max(m, d.count), 0) || 1, [data]);

  const isDark = !!dark;
  const isCompact = variant === "compact";
  const landFill = isDark ? '#334155' : '#E5E7EB';
  const landStroke = isDark ? '#1f2937' : '#CBD5E1';
  const bubbleFill = isDark ? 'rgba(34,197,94,0.75)' : 'rgba(16,115,74,0.75)';
  const bubbleStroke = isDark ? '#16a34a' : '#0f5132';
  const labelColor = isDark ? '#e2e8f0' : '#0f172a';

  const rScale = (v: number) =>
    (isCompact ? 4 : 6) + (isCompact ? 16 : 22) * Math.sqrt(v / max);
  const labelSize = isCompact ? 9 : 10;
  const labelOffset = isCompact ? 1 : 2;

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <svg viewBox="0 0 800 400" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <g>
          {countries.map((geo: any, i: number) => (
            <path key={i} d={path(geo) || ''} fill={landFill} stroke={landStroke} strokeWidth={0.5} />
          ))}
        </g>
        <g>
          {data.map((d) => {
            const key = d.country.toUpperCase();
            const centroid = centroids.get(key) || centroids.get(key === 'UK' ? 'GB' : key);
            if (!centroid) return null;
            const [x, y] = projection(centroid)!;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const r = rScale(d.count);
            const handleMove = (e: React.MouseEvent<SVGGElement>) => {
              const rect = containerRef.current?.getBoundingClientRect();
              if (!rect) return;
              const px = e.clientX - rect.left + 8; // small offset
              const py = e.clientY - rect.top + 8;
              setTip({ show: true, x: px, y: py, country: key, value: d.count });
            };
            return (
              <g
                key={key}
                transform={`translate(${x},${y})`}
                onClick={() => onSelect?.(key)}
                onMouseEnter={handleMove}
                onMouseMove={handleMove}
                onMouseLeave={() => setTip(null)}
                style={{ cursor: 'pointer' }}
              >
                <circle r={r} fill={bubbleFill} stroke={bubbleStroke} strokeWidth={1} />
                <title>{`${key}: ${d.count}`}</title>
                <text textAnchor="middle" y={-r - labelOffset} style={{ fontSize: labelSize, fill: labelColor }}>
                  {key}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {legend && (
        <div className="absolute left-2 bottom-2 px-2 py-1 rounded border text-[11px]"
             style={{
               background: isDark ? 'rgba(30,41,59,0.85)' : 'rgba(255,255,255,0.85)',
               color: labelColor,
               borderColor: isDark ? '#334155' : '#cbd5e1'
             }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width={isCompact ? 64 : 80} height={isCompact ? 24 : 28}>
              {([0.2, 0.5, 1] as number[]).map((f, i) => {
                const r = rScale(Math.max(1, max * f));
                const cx = (isCompact ? 10 : 12) + i * (isCompact ? 20 : 24);
                const cy = isCompact ? 14 : 16;
                return <circle key={i} cx={cx} cy={cy} r={r} fill={bubbleFill} stroke={bubbleStroke} strokeWidth={1} />;
              })}
            </svg>
            <span>Relative size</span>
          </div>
        </div>
      )}

      {tip && tip.show && (
        <div className="pointer-events-none absolute rounded border px-2 py-1 text-xs shadow"
             style={{ left: tip.x, top: tip.y, background: isDark ? '#0f172a' : '#ffffff', color: labelColor, borderColor: isDark ? '#334155' : '#cbd5e1' }}>
          <div style={{ fontWeight: 600 }}>{tip.country}</div>
          <div>{tip.value} {tip.value === 1 ? 'item' : 'items'}</div>
        </div>
      )}
    </div>
  );
});

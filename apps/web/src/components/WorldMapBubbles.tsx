import { memo, useMemo } from 'react';
import { geoEqualEarth, geoPath, geoCentroid } from 'd3-geo';
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
};

// TopoJSON -> GeoJSON features
const countries: any = (feature(worldData as any, (worldData as any).objects.countries) as any).features;

const projection = geoEqualEarth();

export default memo(function WorldMapBubbles({ data, onSelect }: WorldMapBubblesProps) {
  const path = useMemo(() => geoPath(projection), []);

  // Build centroids for all countries keyed by ISO2 using world-countries metadata.
  const centroids = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const f of worldCountries as any[]) {
      const iso = (f.cca2 || f.properties?.cca2 || '').toUpperCase();
      if (!iso) continue;
      try {
        const c = geoCentroid(f as any) as [number, number];
        map.set(iso, c);
      } catch {}
    }
    return map;
  }, []);

  const max = useMemo(() => data.reduce((m, d) => Math.max(m, d.count), 0) || 1, [data]);

  return (
    <svg viewBox="0 0 800 400" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <g>
        {countries.map((geo: any, i: number) => (
          <path key={i} d={path(geo) || ''} fill="#E5E7EB" stroke="#CBD5E1" strokeWidth={0.5} />
        ))}
      </g>
      <g>
        {data.map((d) => {
          const key = d.country.toUpperCase();
          const centroid = centroids.get(key) || centroids.get(key === 'UK' ? 'GB' : key);
          if (!centroid) return null;
          const [x, y] = projection(centroid)!;
          const r = 6 + (22 * d.count) / max;
          return (
            <g
              key={key}
              transform={`translate(${x},${y})`}
              onClick={() => onSelect?.(key)}
              style={{ cursor: 'pointer' }}
            >
              <circle r={r} fill="rgba(16,115,74,0.75)" stroke="#0f5132" strokeWidth={1} />
              <text textAnchor="middle" y={-r - 2} style={{ fontSize: 10, fill: '#0f172a' }}>
                {key}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
});

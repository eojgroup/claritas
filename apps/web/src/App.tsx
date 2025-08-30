import { useEffect, useMemo, useState } from "react";
import { Search, Bell, Settings, Menu, User } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ZAxis,
} from "recharts";

// --- Utility mock data ---
const pieData = [
  { name: "Cat A", value: 45 },
  { name: "Cat B", value: 25 },
  { name: "Cat C", value: 30 },
];

const scatterData = [
  { x: 10, y: 30 },
  { x: 20, y: 20 },
  { x: 30, y: 27 },
  { x: 40, y: 35 },
  { x: 50, y: 18 },
];

import WorldMapBubbles from "./components/WorldMapBubbles";
import { fetchCountryStats, fetchNews, imageProxy, type CountryStat, type NewsItem } from "./lib/api";

export default function ClaritasDashboard() {
  const [query, setQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [countryStats, setCountryStats] = useState<CountryStat[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);

  useEffect(() => {
    // Load initial data
    fetchCountryStats({ days: 30 }).then(setCountryStats).catch(() => setCountryStats([]));
    fetchNews({ limit: 20 }).then(setNews).catch(() => setNews([]));
  }, []);

  useEffect(() => {
    // When a country is selected, refetch list filtered by country
    if (selectedCountry) {
      fetchNews({ limit: 20, country: selectedCountry }).then(setNews).catch(() => setNews([]));
    } else {
      fetchNews({ limit: 20 }).then(setNews).catch(() => setNews([]));
    }
  }, [selectedCountry]);

  const pieColors = useMemo(
    () => ["#0B1E2D", "#183447", "#254B66"],
    []
  );

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-slate-200 border-b border-slate-300">
        <div className="mx-auto max-w-7xl px-4 py-4 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative h-12 w-12">
              <div className="absolute -left-3 top-0 h-12 w-12 rounded-full bg-[#102739]" />
              <div className="absolute left-1 top-0 h-12 w-12 rounded-full bg-[#1F3C52] opacity-90" />
              <div className="absolute left-5 top-0 h-12 w-12 rounded-full bg-[#2D556F] opacity-80" />
            </div>
            <span className="font-extrabold tracking-wide text-2xl text-[#0B1E2D]">CLARITAS</span>
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-5 text-slate-800">
            <Settings className="h-6 w-6" />
            <Menu className="h-6 w-6" />
            <User className="h-6 w-6" />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-12 gap-4">
        {/* LEFT: Map + AI Search + News/Country Profile */}
        <section className="col-span-12 lg:col-span-7 flex flex-col gap-4">
          {/* Map Card */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="p-4 border-b border-slate-100 text-sm text-slate-500">#News per country</div>
            <div className="relative p-4">
              <div className="aspect-[16/9] rounded-xl overflow-hidden">
                {/* Fallback: derive bubbles from the currently loaded news if stats are empty */}
                <WorldMapBubbles
                  data={
                    (countryStats && countryStats.length > 0)
                      ? countryStats
                      : Object.entries(
                          (news || []).reduce<Record<string, number>>((acc, n) => {
                            const iso = (n.country_iso2 || "").toUpperCase();
                            if (!iso) return acc;
                            acc[iso] = (acc[iso] || 0) + 1;
                            return acc;
                          }, {})
                        ).map(([country, count]) => ({ country, count }))
                  }
                  onSelect={setSelectedCountry}
                />
              </div>
              {countryStats.length === 0 && (
                <div className="absolute bottom-3 right-4 text-xs text-slate-500 bg-white/70 px-2 py-1 rounded shadow-sm border">
                  No aggregated stats yet — showing live list fallback
                </div>
              )}
            </div>
            {/* AI Search */}
            <div className="border-t border-slate-100 p-3">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-inner">
                <Search className="h-5 w-5 text-slate-500" />
                <input
                  className="w-full bg-transparent outline-none placeholder:text-slate-400"
                  placeholder="AI Search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-white text-sm">Search</button>
              </div>
            </div>
          </div>

          {/* News + Country Profile grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="p-4 border-b border-slate-100 font-semibold">News</div>
              <ul className="p-4 space-y-3">
                {news.length === 0 && (
                  <li className="text-sm text-slate-500">No news items yet.</li>
                )}
                {news.map((n) => {
                  const img = imageProxy((n as any)?.payload?.urlToImage ?? (n as any)?.payload?.raw?.urlToImage);
                  return (
                    <li key={n.id} className="rounded-lg border border-slate-100 p-3 hover:bg-slate-50">
                      <div className="flex items-start gap-3">
                        {img ? (
                          <img
                            src={img}
                            alt={n.title ?? 'thumbnail'}
                            loading="lazy"
                            decoding="async"
                            referrerPolicy="no-referrer"
                            className="h-16 w-24 object-cover rounded-md border border-slate-200 flex-none"
                            onError={(e) => ((e.currentTarget.style.display = 'none'))}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <a href={n.url ?? '#'} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-900 hover:underline">
                            {n.title || n.url || 'Untitled'}
                          </a>
                          <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                            {n.country_iso2 && <span className="px-1.5 py-0.5 rounded bg-slate-100 border text-slate-700">{n.country_iso2}</span>}
                            {n.event_time && <span>{new Date(n.event_time).toLocaleString()}</span>}
                          </div>
                          {n.summary && <p className="text-sm text-slate-600 mt-1 line-clamp-3">{n.summary}</p>}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="p-4 border-b border-slate-100 font-semibold">Country profile based on selection</div>
              <div className="p-4 text-sm text-slate-600 space-y-2">
                {!selectedCountry && (
                  <div>Select a bubble on the map to see a brief profile.</div>
                )}
                {selectedCountry && (
                  <>
                    <div className="text-base font-semibold">Country: {selectedCountry}</div>
                    <div>Recent items from this country in the list are highlighted by the country tag.</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT: Analytics + Notifications */}
        <section className="col-span-12 lg:col-span-5 flex flex-col gap-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="p-4 border-b border-slate-100 font-semibold">
              News/number of ships etc per category
            </div>
            <div className="p-4 space-y-6">
              {/* Scatter */}
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                    <XAxis dataKey="x" tick={{ fontSize: 12 }} />
                    <YAxis dataKey="y" tick={{ fontSize: 12 }} />
                    <ZAxis range={[60, 60]} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                    <Scatter data={scatterData} fill="#94a3b8" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* Pie */}
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={pieColors[i % pieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="p-4 border-b border-slate-100 font-semibold flex items-center gap-2">
              <Bell className="h-5 w-5" /> Notifications
            </div>
            <div className="p-4 text-sm text-slate-600">No notifications yet.</div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-900 text-slate-100">
        <div className="mx-auto max-w-7xl px-4 py-3 text-sm">EOJC</div>
      </footer>
    </div>
  );
}

import { useMemo, useState } from "react";
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

const newsItems = ["News 1", "News 2", "News 3", "News 4"]; 

export default function ClaritasDashboard() {
  const [query, setQuery] = useState("");

  const pieColors = useMemo(
    () => ["#0B1E2D", "#183447", "#254B66"],
    []
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
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
      <main className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-12 gap-4">
        {/* LEFT: Map + AI Search + News/Country Profile */}
        <section className="col-span-12 lg:col-span-7 flex flex-col gap-4">
          {/* Map Card */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="p-4 border-b border-slate-100 text-sm text-slate-500">#News per country</div>
            <div className="relative p-4">
              {/* Placeholder world map */}
              <div className="aspect-[16/9] rounded-xl bg-gradient-to-tr from-slate-100 to-slate-200 grid place-items-center">
                <span className="text-slate-400">World map placeholder</span>
                {/* Bubble markers (decorative) */}
                <div className="absolute left-[18%] top-[35%] h-10 w-10 rounded-full bg-emerald-700/80" />
                <div className="absolute left-[35%] top-[30%] h-16 w-16 rounded-full bg-emerald-700/70" />
                <div className="absolute left-[45%] top-[50%] h-20 w-20 rounded-full bg-emerald-700/70" />
                <div className="absolute right-[18%] top-[40%] h-20 w-20 rounded-full bg-emerald-700/70" />
              </div>
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
              <ul className="p-4 space-y-2">
                {newsItems.map((n) => (
                  <li key={n} className="rounded-lg border border-slate-100 p-3 hover:bg-slate-50">
                    {n}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="p-4 border-b border-slate-100 font-semibold">Country profile based on selection</div>
              <div className="p-4 text-sm text-slate-600">
                Select a country bubble on the map (placeholder) to load a brief profile here.
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

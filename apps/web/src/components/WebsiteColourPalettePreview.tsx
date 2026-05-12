const palette = {
  navy: "#14233A",
  blue: "#2F4F73",
  teal: "#2F6F73",
  steel: "#687789",
  platinum: "#D8E0EA",
  cloud: "#F6F8FB",
  graphite: "#172033",
  bronze: "#9B6B3F",
};

const colors = [
  { name: "Executive Navy", hex: palette.navy, text: palette.cloud, role: "Navigation, headers, primary structure" },
  { name: "Boardroom Blue", hex: palette.blue, text: palette.cloud, role: "Data emphasis and selected states" },
  { name: "Operational Teal", hex: palette.teal, text: palette.cloud, role: "Positive states, live signals, confirmed actions" },
  { name: "Steel Gray", hex: palette.steel, text: palette.cloud, role: "Secondary text, labels, and inactive controls" },
  { name: "Platinum", hex: palette.platinum, text: palette.graphite, role: "Borders, dividers, and quiet panels" },
  { name: "Cloud", hex: palette.cloud, text: palette.graphite, role: "Page backgrounds and elevated surfaces" },
  { name: "Graphite", hex: palette.graphite, text: palette.cloud, role: "Body copy and high-contrast text" },
  { name: "Muted Bronze", hex: palette.bronze, text: palette.cloud, role: "Warnings, premium accents, and rare highlights" },
];

export default function WebsiteColourPalettePreview() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: palette.cloud, color: palette.graphite }}>
      <div className="mx-auto max-w-6xl space-y-10 p-8 md:p-12">
        <header className="grid gap-6 lg:grid-cols-[1fr_18rem] lg:items-end">
          <div className="space-y-3">
            <p className="text-sm uppercase tracking-[0.2em]" style={{ color: palette.steel }}>
              Enterprise colour system
            </p>
            <h1 className="text-4xl font-semibold md:text-5xl">Claritas palette preview</h1>
            <p className="max-w-3xl text-base md:text-lg" style={{ color: palette.steel }}>
              A restrained executive palette for dashboards, policy surfaces, analytics, and authentication flows.
            </p>
          </div>
          <div className="rounded-lg border p-4" style={{ backgroundColor: "#FFFFFF", borderColor: palette.platinum }}>
            <div className="text-xs uppercase tracking-[0.2em]" style={{ color: palette.steel }}>
              Primary stack
            </div>
            <div className="mt-3 flex h-14 overflow-hidden rounded-md">
              {[palette.navy, palette.blue, palette.teal, palette.steel, palette.bronze].map((hex) => (
                <div key={hex} className="flex-1" style={{ backgroundColor: hex }} />
              ))}
            </div>
          </div>
        </header>

        <section>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {colors.map((c) => (
              <div
                key={c.hex}
                className="overflow-hidden rounded-lg border shadow-sm"
                style={{ borderColor: palette.platinum, backgroundColor: "#FFFFFF" }}
              >
                <div className="grid h-32 place-items-center" style={{ backgroundColor: c.hex, color: c.text }}>
                  <span className="font-mono text-sm font-semibold">{c.hex}</span>
                </div>
                <div className="space-y-2 p-5">
                  <div className="text-lg font-medium">{c.name}</div>
                  <div className="text-sm" style={{ color: palette.steel }}>
                    {c.role}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid items-start gap-8 lg:grid-cols-2">
          <div className="rounded-lg border p-8 shadow-sm" style={{ backgroundColor: "#FFFFFF", borderColor: palette.platinum }}>
            <p className="mb-3 text-sm uppercase tracking-[0.2em]" style={{ color: palette.steel }}>
              Buttons and controls
            </p>
            <div className="mb-6 flex flex-wrap gap-4">
              <button
                className="rounded-lg px-5 py-3 text-sm font-medium shadow-sm"
                style={{ backgroundColor: palette.navy, color: palette.cloud }}
                type="button"
              >
                Primary action
              </button>
              <button
                className="rounded-lg px-5 py-3 text-sm font-medium shadow-sm"
                style={{ backgroundColor: palette.teal, color: palette.cloud }}
                type="button"
              >
                Approve signal
              </button>
              <button
                className="rounded-lg border px-5 py-3 text-sm font-medium"
                style={{ borderColor: palette.platinum, color: palette.blue, backgroundColor: palette.cloud }}
                type="button"
              >
                Secondary action
              </button>
            </div>
            <div className="rounded-lg border p-4" style={{ backgroundColor: palette.cloud, borderColor: palette.platinum }}>
              <label className="mb-2 block text-sm" style={{ color: palette.steel }}>
                Enterprise email
              </label>
              <div
                className="rounded-md px-4 py-3"
                style={{ backgroundColor: "#FFFFFF", border: `1px solid ${palette.platinum}`, color: palette.graphite }}
              >
                name@company.com
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-8 shadow-sm" style={{ backgroundColor: "#FFFFFF", borderColor: palette.platinum }}>
            <p className="mb-3 text-sm uppercase tracking-[0.2em]" style={{ color: palette.steel }}>
              Dashboard surfaces
            </p>
            <div className="space-y-4 rounded-lg p-6" style={{ backgroundColor: palette.cloud }}>
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-xl font-semibold">Risk operations</h3>
                <span className="rounded-full px-3 py-1 text-xs" style={{ backgroundColor: "#E8F1F1", color: palette.teal }}>
                  Stable
                </span>
              </div>
              <p style={{ color: palette.steel }}>
                Use navy for hierarchy, teal for trusted outcomes, steel for context, and bronze only for rare attention.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg p-4" style={{ backgroundColor: palette.navy, color: palette.cloud }}>
                  <div className="text-xs opacity-80">Signals</div>
                  <div className="text-2xl font-semibold">24.8k</div>
                </div>
                <div className="rounded-lg p-4" style={{ backgroundColor: palette.teal, color: palette.cloud }}>
                  <div className="text-xs opacity-80">Health</div>
                  <div className="text-2xl font-semibold">98%</div>
                </div>
                <div className="rounded-lg p-4" style={{ backgroundColor: palette.bronze, color: palette.cloud }}>
                  <div className="text-xs opacity-80">Watch</div>
                  <div className="text-2xl font-semibold">12</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border shadow-sm" style={{ borderColor: palette.platinum }}>
          <div className="grid lg:grid-cols-2">
            <div className="p-10 md:p-12" style={{ backgroundColor: palette.navy, color: palette.cloud }}>
              <p className="mb-4 text-sm uppercase tracking-[0.2em]" style={{ color: "#B8C8D8" }}>
                Application example
              </p>
              <h2 className="mb-4 text-4xl font-semibold leading-tight">Designed for executive signal review</h2>
              <p className="mb-6 text-base md:text-lg" style={{ color: "#D8E0EA" }}>
                The palette keeps dense data interfaces calm, legible, and credible across light and dark surfaces.
              </p>
              <div className="flex flex-wrap gap-4">
                <button
                  className="rounded-lg px-5 py-3 font-medium"
                  style={{ backgroundColor: palette.teal, color: palette.cloud }}
                  type="button"
                >
                  Open dashboard
                </button>
                <button
                  className="rounded-lg border px-5 py-3 font-medium"
                  style={{ borderColor: "#B8C8D8", color: "#D8E0EA" }}
                  type="button"
                >
                  Review controls
                </button>
              </div>
            </div>
            <div className="p-10 md:p-12" style={{ backgroundColor: "#EEF3F8", color: palette.graphite }}>
              <div className="rounded-lg bg-white p-8 shadow-sm">
                <div className="mb-4 h-2 w-24 rounded-full" style={{ backgroundColor: palette.bronze }} />
                <h3 className="mb-3 text-2xl font-semibold">Recommended usage</h3>
                <ul className="space-y-3 text-sm md:text-base" style={{ color: palette.steel }}>
                  <li><span className="font-medium" style={{ color: palette.graphite }}>Executive navy</span> for primary chrome and high-value headers</li>
                  <li><span className="font-medium" style={{ color: palette.graphite }}>Operational teal</span> for live status, health, and approved flows</li>
                  <li><span className="font-medium" style={{ color: palette.graphite }}>Boardroom blue</span> for data comparison and selected items</li>
                  <li><span className="font-medium" style={{ color: palette.graphite }}>Cloud and platinum</span> for readable surfaces and dividers</li>
                  <li><span className="font-medium" style={{ color: palette.graphite }}>Muted bronze</span> for limited warning or premium emphasis</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

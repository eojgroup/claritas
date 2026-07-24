import { useState } from "react";

const themes = {
  light: {
    canvas: "#F3E9D7",
    surface: "#FFFAF1",
    surfaceMuted: "#E9DCC8",
    surfaceStrong: "#DFC8A9",
    border: "#D5C1A4",
    borderStrong: "#9A8067",
    text: "#172F42",
    textMuted: "#53616A",
    textSubtle: "#6D6257",
    inverseText: "#FFFAF1",
    navy: "#172F42",
    navyHover: "#2A5268",
    blue: "#3E6A80",
    blueHover: "#2A5268",
    positiveText: "#244B61",
    orangeSoft: "#F3CDAA",
    orangeMuted: "#E8B98D",
    orangeText: "#532A16",
    orange: "#E6A06A",
    orangeStrong: "#934719",
    accentText: "#172F42",
    danger: "#A73B32",
    dangerSoft: "#F6D8D2",
    infoSoft: "#D7E6EA",
  },
  dark: {
    canvas: "#081119",
    surface: "#11222E",
    surfaceMuted: "#1B303E",
    surfaceStrong: "#152A38",
    border: "#283C47",
    borderStrong: "#40525C",
    text: "#F2EEE6",
    textMuted: "#A9B5BA",
    textSubtle: "#87979E",
    inverseText: "#FFFAF1",
    navy: "#315F72",
    navyHover: "#477A8D",
    blue: "#77A8BA",
    blueHover: "#9BC1CF",
    positiveText: "#A9CEDC",
    orangeSoft: "#503827",
    orangeMuted: "#9A6847",
    orangeText: "#FFF4E8",
    orange: "#EDA36A",
    orangeStrong: "#F0B888",
    accentText: "#172F42",
    danger: "#D96B62",
    dangerSoft: "#482C2B",
    infoSoft: "#223E4C",
  },
} as const;

type Mode = keyof typeof themes;
type Theme = (typeof themes)[Mode];

const chartSeries = [
  { color: "#315F72", text: "#FFFAF1" },
  { color: "#EDA36A", text: "#172F42" },
  { color: "#77A8BA", text: "#172F42" },
  { color: "#E8B98D", text: "#172F42" },
  { color: "#934719", text: "#FFFAF1" },
  { color: "#A9B8BF", text: "#172F42" },
];

function ColourSwatch({
  name,
  value,
  foreground,
  role,
  border,
  surface,
  text,
  mutedText,
}: {
  name: string;
  value: string;
  foreground: string;
  role: string;
  border: string;
  surface: string;
  text: string;
  mutedText: string;
}) {
  return (
    <article className="overflow-hidden rounded-lg border" style={{ backgroundColor: surface, borderColor: border }}>
      <div className="flex h-28 items-end justify-between gap-3 p-4" style={{ backgroundColor: value, color: foreground }}>
        <span className="text-sm font-semibold">{name}</span>
        <span className="font-mono text-xs">{value}</span>
      </div>
      <div className="space-y-1 p-4">
        <div className="text-xs font-semibold uppercase" style={{ color: text }}>
          Recommended role
        </div>
        <p className="text-sm leading-5" style={{ color: mutedText }}>
          {role}
        </p>
      </div>
    </article>
  );
}

function StatusBadge({
  children,
  background,
  color,
  border,
}: {
  children: string;
  background: string;
  color: string;
  border?: string;
}) {
  return (
    <span
      className="inline-flex min-h-7 items-center rounded-full border px-3 text-xs font-semibold"
      style={{ backgroundColor: background, borderColor: border ?? background, color }}
    >
      {children}
    </span>
  );
}

function SectionLabel({ children, theme }: { children: string; theme: Theme }) {
  return (
    <p className="mb-3 text-xs font-semibold uppercase" style={{ color: theme.textSubtle }}>
      {children}
    </p>
  );
}

export default function WebsiteColourPalettePreview() {
  const [mode, setMode] = useState<Mode>("light");
  const theme = themes[mode];

  const brandColors = [
    {
      name: "Command navy",
      value: theme.navy,
      foreground: theme.inverseText,
      role: "Navigation, primary actions, selected tabs, and high-value structure.",
    },
    {
      name: "Intelligence blue",
      value: theme.blue,
      foreground: theme.inverseText,
      role: "Trusted data, secondary actions, comparisons, and analytical series.",
    },
    {
      name: "Signal orange",
      value: theme.orange,
      foreground: theme.accentText,
      role: "Live activity, attention, current focus, and deliberate emphasis.",
    },
    {
      name: "Warm orange",
      value: theme.orangeMuted,
      foreground: theme.accentText,
      role: "Selected controls, comparison states, and warm supporting emphasis.",
    },
  ];

  const foundationColors = [
    {
      name: "Canvas",
      value: theme.canvas,
      foreground: theme.text,
      role: "Application background and broad page sections.",
    },
    {
      name: "Surface",
      value: theme.surface,
      foreground: theme.text,
      role: "Primary panels, forms, tables, and elevated working areas.",
    },
    {
      name: "Muted surface",
      value: theme.surfaceMuted,
      foreground: theme.text,
      role: "Grouped controls, quiet rows, and secondary content areas.",
    },
    {
      name: "Primary text",
      value: theme.text,
      foreground: theme.canvas,
      role: "Headlines, body copy, values, and critical labels.",
    },
  ];

  return (
    <div
      className="min-h-screen transition-colors duration-200"
      style={{ backgroundColor: theme.canvas, color: theme.text }}
    >
      <div className="mx-auto max-w-7xl space-y-10 p-6 md:p-10">
        <header className="grid gap-6 border-b pb-8 lg:grid-cols-[1fr_auto] lg:items-end" style={{ borderColor: theme.border }}>
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase" style={{ color: theme.orangeStrong }}>
              Claritas strategic colour system
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold md:text-5xl">Colour with a clear operational role</h1>
            <p className="max-w-3xl text-base leading-7 md:text-lg" style={{ color: theme.textMuted }}>
              Navy creates hierarchy, blue structures analytical information, orange directs attention, and layered
              beige keeps dense intelligence surfaces calm.
            </p>
          </div>

          <div
            aria-label="Preview colour mode"
            className="grid w-full grid-cols-2 rounded-lg border p-1 sm:w-64"
            style={{ backgroundColor: theme.surfaceMuted, borderColor: theme.border }}
          >
            {(["light", "dark"] as const).map((item) => {
              const selected = item === mode;
              return (
                <button
                  key={item}
                  aria-pressed={selected}
                  className="min-h-10 rounded-md px-4 text-sm font-semibold capitalize transition-colors"
                  onClick={() => setMode(item)}
                  style={{
                    backgroundColor: selected ? theme.navy : "transparent",
                    color: selected ? theme.inverseText : theme.textMuted,
                  }}
                  type="button"
                >
                  {item} mode
                </button>
              );
            })}
          </div>
        </header>

        <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <SectionLabel theme={theme}>Brand and action</SectionLabel>
              <h2 className="text-2xl font-semibold">Strategic signals</h2>
            </div>
            <p className="max-w-xl text-sm leading-6" style={{ color: theme.textMuted }}>
              Each accent has one dominant purpose. Repetition makes meaning predictable across dashboards and workflows.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {brandColors.map((color) => (
              <ColourSwatch
                key={color.name}
                {...color}
                border={theme.border}
                mutedText={theme.textMuted}
                surface={theme.surface}
                text={theme.text}
              />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-5">
            <SectionLabel theme={theme}>Foundation</SectionLabel>
            <h2 className="text-2xl font-semibold">Surfaces and text</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {foundationColors.map((color) => (
              <ColourSwatch
                key={color.name}
                {...color}
                border={theme.border}
                mutedText={theme.textMuted}
                surface={theme.surface}
                text={theme.text}
              />
            ))}
          </div>
        </section>

        <section className="grid items-start gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-lg border p-5 md:p-6" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
            <SectionLabel theme={theme}>Interaction contract</SectionLabel>
            <h2 className="text-2xl font-semibold">Controls stay readable in every state</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: theme.textMuted }}>
              Selected controls use intentional foreground pairs. Light orange and beige use navy text; navy and blue
              use warm light text.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="min-h-11 rounded-md px-5 text-sm font-semibold"
                style={{ backgroundColor: theme.navy, color: theme.inverseText }}
                type="button"
              >
                Primary action
              </button>
              <button
                className="min-h-11 rounded-md px-5 text-sm font-semibold"
                style={{ backgroundColor: theme.blue, color: theme.inverseText }}
                type="button"
              >
                Approve decision
              </button>
              <button
                className="min-h-11 rounded-md px-5 text-sm font-semibold"
                style={{ backgroundColor: theme.orange, color: theme.accentText }}
                type="button"
              >
                Review live signal
              </button>
              <button
                className="min-h-11 rounded-md border px-5 text-sm font-semibold"
                style={{ backgroundColor: theme.surface, borderColor: theme.borderStrong, color: theme.text }}
                type="button"
              >
                Secondary action
              </button>
              <button
                className="min-h-11 cursor-not-allowed rounded-md px-5 text-sm font-semibold opacity-60"
                disabled
                style={{ backgroundColor: theme.surfaceStrong, color: theme.textMuted }}
                type="button"
              >
                Disabled action
              </button>
            </div>

            <div className="mt-7 grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold" htmlFor="palette-email">
                  Intelligence recipient
                </label>
                <input
                  className="min-h-11 w-full rounded-md border px-3 text-sm outline-none"
                  defaultValue="strategy@company.com"
                  id="palette-email"
                  style={{ backgroundColor: theme.canvas, borderColor: theme.navyHover, color: theme.text }}
                  type="email"
                />
                <p className="mt-2 text-xs" style={{ color: theme.textMuted }}>
                  Focus uses navy, without relying on glow or low-contrast grey.
                </p>
              </div>

              <div>
                <div className="mb-2 text-sm font-semibold">Report view</div>
                <div
                  className="grid grid-cols-3 rounded-md border p-1"
                  style={{ backgroundColor: theme.surfaceMuted, borderColor: theme.border }}
                >
                  {["Briefing", "Markets", "Risk"].map((tab, index) => (
                    <button
                      key={tab}
                      aria-pressed={index === 0}
                      className="min-h-9 rounded px-2 text-xs font-semibold"
                      style={{
                        backgroundColor: index === 0 ? theme.orangeSoft : "transparent",
                        color: index === 0 ? theme.orangeText : theme.textMuted,
                      }}
                      type="button"
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </article>

          <article className="rounded-lg border p-5 md:p-6" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
            <SectionLabel theme={theme}>Semantic system</SectionLabel>
            <h2 className="text-2xl font-semibold">Status and data colours</h2>

            <div className="mt-5 flex flex-wrap gap-2">
              <StatusBadge background={theme.orangeSoft} color={theme.orangeText}>
                Published
              </StatusBadge>
              <StatusBadge background={theme.infoSoft} border={theme.navyHover} color={theme.text}>
                Monitoring
              </StatusBadge>
              <StatusBadge background={theme.orange} color={theme.accentText}>
                Needs review
              </StatusBadge>
              <StatusBadge background={theme.dangerSoft} border={theme.danger} color={theme.text}>
                At risk
              </StatusBadge>
              <StatusBadge background={theme.surfaceMuted} border={theme.border} color={theme.textMuted}>
                Inactive
              </StatusBadge>
            </div>

            <div className="mt-7">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold">Chart sequence</div>
                  <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                    Ordered for clear series separation
                  </div>
                </div>
                <span className="font-mono text-xs" style={{ color: theme.textSubtle }}>
                  6 series
                </span>
              </div>
              <div className="grid h-16 grid-cols-6 overflow-hidden rounded-md border" style={{ borderColor: theme.border }}>
                {chartSeries.map((series, index) => (
                  <div key={series.color} className="grid place-items-end p-2" style={{ backgroundColor: series.color }}>
                    <span className="text-xs font-semibold" style={{ color: series.text }}>
                      {index + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3">
              <div className="rounded-md p-4" style={{ backgroundColor: theme.blue, color: theme.inverseText }}>
                <div className="text-xs font-semibold uppercase">Positive</div>
                <div className="mt-1 text-2xl font-semibold">+18.4%</div>
              </div>
              <div className="rounded-md p-4" style={{ backgroundColor: theme.orange, color: theme.accentText }}>
                <div className="text-xs font-semibold uppercase">Attention</div>
                <div className="mt-1 text-2xl font-semibold">24 items</div>
              </div>
            </div>
          </article>
        </section>

        <section className="overflow-hidden rounded-lg border" style={{ borderColor: theme.border }}>
          <div className="grid lg:grid-cols-[16rem_1fr]">
            <aside className="p-5" style={{ backgroundColor: theme.navy, color: theme.inverseText }}>
              <div className="border-b pb-5" style={{ borderColor: theme.navyHover }}>
                <div className="text-xs font-semibold uppercase" style={{ color: theme.orangeStrong }}>
                  Claritas
                </div>
                <div className="mt-2 text-lg font-semibold">Strategic intelligence</div>
              </div>
              <nav className="mt-5 space-y-2" aria-label="Application preview">
                {["Daily briefing", "Live intelligence", "Markets", "Risk monitor"].map((item, index) => (
                  <div
                    key={item}
                    className="rounded-md px-3 py-2.5 text-sm font-semibold"
                    style={{
                      backgroundColor: index === 0 ? theme.orangeSoft : "transparent",
                      color: index === 0 ? theme.orangeText : theme.inverseText,
                    }}
                  >
                    {item}
                  </div>
                ))}
              </nav>
            </aside>

            <div className="p-5 md:p-7" style={{ backgroundColor: theme.canvas }}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <SectionLabel theme={theme}>Application preview</SectionLabel>
                  <h2 className="text-2xl font-semibold">Global strategic outlook</h2>
                  <p className="mt-1 text-sm" style={{ color: theme.textMuted }}>
                    A compact example of the palette working as one system.
                  </p>
                </div>
                <StatusBadge background={theme.orange} color={theme.accentText}>
                  Live briefing
                </StatusBadge>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                {[
                  { label: "Market confidence", value: "72.4", change: "+4.8", color: theme.navy },
                  { label: "Positive signals", value: "184", change: "+18", color: theme.blue },
                  { label: "Needs attention", value: "12", change: "-3", color: theme.orange },
                ].map((metric) => (
                  <article
                    key={metric.label}
                    className="rounded-md border p-4"
                    style={{ backgroundColor: theme.surface, borderColor: theme.border }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase" style={{ color: theme.textMuted }}>
                        {metric.label}
                      </span>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: metric.color }} />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <strong className="text-3xl">{metric.value}</strong>
                      <span className="text-sm font-semibold" style={{ color: theme.positiveText }}>
                        {metric.change}
                      </span>
                    </div>
                  </article>
                ))}
              </div>

              <article
                className="mt-4 rounded-md border p-5"
                style={{ backgroundColor: theme.surface, borderColor: theme.border }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Signal distribution</div>
                    <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                      Current briefing by strategic category
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge background={theme.orangeSoft} color={theme.orangeText}>
                      Stable
                    </StatusBadge>
                    <StatusBadge background={theme.orange} color={theme.accentText}>
                      3 alerts
                    </StatusBadge>
                  </div>
                </div>
                <div className="mt-5 flex h-24 items-end gap-2">
                  {[55, 82, 68, 94, 72, 46, 64, 88, 58, 76].map((height, index) => (
                    <div
                      key={`${height}-${index}`}
                      className="min-w-0 flex-1 rounded-t-sm"
                      style={{
                        backgroundColor: chartSeries[index % chartSeries.length].color,
                        height: `${height}%`,
                      }}
                    />
                  ))}
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

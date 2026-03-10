export default function WebsiteColourPalettePreview() {
  const colors = [
    { name: "Dark Blue", hex: "#1F3A5F", text: "#F7F3EC" },
    { name: "Dark Green", hex: "#2F5D50", text: "#F7F3EC" },
    { name: "Grey", hex: "#5B6166", text: "#F7F3EC" },
    { name: "Beige", hex: "#E8DDC8", text: "#222222" },
    { name: "Brown", hex: "#7A5C46", text: "#F7F3EC" },
    { name: "Off-white", hex: "#F7F3EC", text: "#222222" },
    { name: "Text", hex: "#222222", text: "#F7F3EC" },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F7F3EC", color: "#222222" }}>
      <div className="mx-auto max-w-6xl space-y-10 p-8 md:p-12">
        <header className="space-y-3">
          <p className="text-sm uppercase tracking-[0.2em]" style={{ color: "#5B6166" }}>
            Colour palette preview
          </p>
          <h1 className="text-4xl font-semibold md:text-5xl">Website palette visualisation</h1>
          <p className="max-w-3xl text-base md:text-lg" style={{ color: "#5B6166" }}>
            A visual reference for your selected tones across swatches, UI elements, and a sample landing section.
          </p>
        </header>

        <section>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {colors.map((c) => (
              <div
                key={c.hex}
                className="overflow-hidden rounded-3xl border shadow-sm"
                style={{ borderColor: "#E8DDC8", backgroundColor: "#FFFFFF" }}
              >
                <div className="h-32" style={{ backgroundColor: c.hex }} />
                <div className="space-y-1 p-5">
                  <div className="text-lg font-medium">{c.name}</div>
                  <div className="font-mono text-sm" style={{ color: "#5B6166" }}>
                    {c.hex}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid items-start gap-8 lg:grid-cols-2">
          <div className="rounded-[2rem] p-8 shadow-sm" style={{ backgroundColor: "#E8DDC8" }}>
            <p className="mb-3 text-sm uppercase tracking-[0.2em]" style={{ color: "#5B6166" }}>
              Buttons and controls
            </p>
            <div className="mb-6 flex flex-wrap gap-4">
              <button
                className="rounded-2xl px-5 py-3 text-sm font-medium shadow-sm"
                style={{ backgroundColor: "#1F3A5F", color: "#F7F3EC" }}
                type="button"
              >
                Primary action
              </button>
              <button
                className="rounded-2xl px-5 py-3 text-sm font-medium shadow-sm"
                style={{ backgroundColor: "#2F5D50", color: "#F7F3EC" }}
                type="button"
              >
                Secondary action
              </button>
              <button
                className="rounded-2xl px-5 py-3 text-sm font-medium shadow-sm"
                style={{ backgroundColor: "#7A5C46", color: "#F7F3EC" }}
                type="button"
              >
                Accent action
              </button>
            </div>
            <div className="rounded-2xl border p-4" style={{ backgroundColor: "#F7F3EC", borderColor: "#5B6166" }}>
              <label className="mb-2 block text-sm" style={{ color: "#5B6166" }}>
                Email address
              </label>
              <div
                className="rounded-xl px-4 py-3"
                style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8DDC8", color: "#222222" }}
              >
                name@company.com
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border p-8 shadow-sm" style={{ backgroundColor: "#FFFFFF", border: "1px solid #E8DDC8" }}>
            <p className="mb-3 text-sm uppercase tracking-[0.2em]" style={{ color: "#5B6166" }}>
              Card styling
            </p>
            <div className="space-y-4 rounded-3xl p-6" style={{ backgroundColor: "#F7F3EC" }}>
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-semibold">Analytics overview</h3>
                <span className="rounded-full px-3 py-1 text-xs" style={{ backgroundColor: "#2F5D50", color: "#F7F3EC" }}>
                  Healthy
                </span>
              </div>
              <p style={{ color: "#5B6166" }}>
                Use dark blue for structure, green for positive actions, beige for warmth, and brown sparingly for
                emphasis.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl p-4" style={{ backgroundColor: "#1F3A5F", color: "#F7F3EC" }}>
                  <div className="text-xs opacity-80">Visitors</div>
                  <div className="text-2xl font-semibold">24.8k</div>
                </div>
                <div className="rounded-2xl p-4" style={{ backgroundColor: "#2F5D50", color: "#F7F3EC" }}>
                  <div className="text-xs opacity-80">CTR</div>
                  <div className="text-2xl font-semibold">4.2%</div>
                </div>
                <div className="rounded-2xl p-4" style={{ backgroundColor: "#7A5C46", color: "#F7F3EC" }}>
                  <div className="text-xs opacity-80">Leads</div>
                  <div className="text-2xl font-semibold">312</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[2rem] shadow-sm">
          <div className="grid lg:grid-cols-2">
            <div className="p-10 md:p-12" style={{ backgroundColor: "#1F3A5F", color: "#F7F3EC" }}>
              <p className="mb-4 text-sm uppercase tracking-[0.2em]" style={{ color: "#E8DDC8" }}>
                Hero example
              </p>
              <h2 className="mb-4 text-4xl font-semibold leading-tight">A grounded palette with authority and warmth</h2>
              <p className="mb-6 text-base md:text-lg" style={{ color: "#F7F3EC" }}>
                This combination feels professional without becoming cold, and premium without looking ornate.
              </p>
              <div className="flex flex-wrap gap-4">
                <button
                  className="rounded-2xl px-5 py-3 font-medium"
                  style={{ backgroundColor: "#2F5D50", color: "#F7F3EC" }}
                  type="button"
                >
                  Get started
                </button>
                <button
                  className="rounded-2xl border px-5 py-3 font-medium"
                  style={{ borderColor: "#E8DDC8", color: "#E8DDC8" }}
                  type="button"
                >
                  Learn more
                </button>
              </div>
            </div>
            <div className="p-10 md:p-12" style={{ backgroundColor: "#E8DDC8", color: "#222222" }}>
              <div className="rounded-[2rem] bg-[#F7F3EC] p-8 shadow-sm">
                <div className="mb-4 h-3 w-24 rounded-full" style={{ backgroundColor: "#7A5C46" }} />
                <h3 className="mb-3 text-2xl font-semibold">Recommended usage</h3>
                <ul className="space-y-3 text-sm md:text-base" style={{ color: "#5B6166" }}>
                  <li>
                    <span className="font-medium" style={{ color: "#222222" }}>
                      Dark blue
                    </span>{" "}
                    for headers, navigation, hero sections
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: "#222222" }}>
                      Dark green
                    </span>{" "}
                    for primary CTAs and positive states
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: "#222222" }}>
                      Grey
                    </span>{" "}
                    for labels, borders, secondary text
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: "#222222" }}>
                      Beige/off-white
                    </span>{" "}
                    for backgrounds and surfaces
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: "#222222" }}>
                      Brown
                    </span>{" "}
                    for selective accents only
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

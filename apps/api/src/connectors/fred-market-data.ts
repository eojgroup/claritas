export type FredSeriesDefinition = {
  seriesId: string;
  canonicalSymbol: string;
  name: string;
  category: "commodity" | "macro_indicator";
  instrumentType: "commodity" | "macro";
  assetClass: "energy" | "macro";
  unit: string;
  frequency: "daily" | "monthly";
  scope: "country" | "global";
  country: "US" | null;
  relationship: "economic_indicator" | "source_jurisdiction";
  originalPublisher: string;
  valueSemantics: "price" | "index_level" | "rate";
  priority: number;
};

// This allowlist intentionally excludes third-party FRED series such as LBMA
// metals and proprietary financial indices. Every entry below originates with
// a U.S. public institution and carries its original publisher in provenance.
export const FRED_SERIES: FredSeriesDefinition[] = [
  {
    seriesId: "DCOILWTICO", canonicalSymbol: "WTI-SPOT", name: "WTI crude oil spot price",
    category: "commodity", instrumentType: "commodity", assetClass: "energy",
    unit: "USD per barrel", frequency: "daily", scope: "global", country: null,
    relationship: "source_jurisdiction", originalPublisher: "U.S. Energy Information Administration",
    valueSemantics: "price", priority: 10,
  },
  {
    seriesId: "DCOILBRENTEU", canonicalSymbol: "BRENT-SPOT", name: "Brent crude oil spot price",
    category: "commodity", instrumentType: "commodity", assetClass: "energy",
    unit: "USD per barrel", frequency: "daily", scope: "global", country: null,
    relationship: "source_jurisdiction", originalPublisher: "U.S. Energy Information Administration",
    valueSemantics: "price", priority: 20,
  },
  {
    seriesId: "DHHNGSP", canonicalSymbol: "HENRY-HUB-SPOT", name: "Henry Hub natural gas spot price",
    category: "commodity", instrumentType: "commodity", assetClass: "energy",
    unit: "USD per million BTU", frequency: "daily", scope: "global", country: null,
    relationship: "source_jurisdiction", originalPublisher: "U.S. Energy Information Administration",
    valueSemantics: "price", priority: 30,
  },
  {
    seriesId: "CPIAUCSL", canonicalSymbol: "US-CPI", name: "United States consumer price index",
    category: "macro_indicator", instrumentType: "macro", assetClass: "macro",
    unit: "index 1982–1984=100", frequency: "monthly", scope: "country", country: "US",
    relationship: "economic_indicator", originalPublisher: "U.S. Bureau of Labor Statistics",
    valueSemantics: "index_level", priority: 40,
  },
  {
    seriesId: "UNRATE", canonicalSymbol: "US-UNEMPLOYMENT", name: "United States unemployment rate",
    category: "macro_indicator", instrumentType: "macro", assetClass: "macro",
    unit: "%", frequency: "monthly", scope: "country", country: "US",
    relationship: "economic_indicator", originalPublisher: "U.S. Bureau of Labor Statistics",
    valueSemantics: "rate", priority: 50,
  },
  {
    seriesId: "INDPRO", canonicalSymbol: "US-INDUSTRIAL-PRODUCTION", name: "United States industrial production index",
    category: "macro_indicator", instrumentType: "macro", assetClass: "macro",
    unit: "index 2017=100", frequency: "monthly", scope: "country", country: "US",
    relationship: "economic_indicator", originalPublisher: "Board of Governors of the Federal Reserve System",
    valueSemantics: "index_level", priority: 60,
  },
];

export type FredObservation = {
  date: string;
  value: number;
  realtimeStart: string | null;
  realtimeEnd: string | null;
};

export function parseFredObservations(payload: unknown): FredObservation[] {
  const observations = Array.isArray((payload as any)?.observations) ? (payload as any).observations : [];
  return observations.flatMap((row: any): FredObservation[] => {
    const date = typeof row?.date === "string" ? row.date : "";
    const value = Number(row?.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value)) return [];
    return [{
      date,
      value,
      realtimeStart: typeof row?.realtime_start === "string" ? row.realtime_start : null,
      realtimeEnd: typeof row?.realtime_end === "string" ? row.realtime_end : null,
    }];
  });
}

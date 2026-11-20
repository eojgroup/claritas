import { Activity, CloudLightning, CloudSun, Flame, Landmark, Newspaper, ShieldAlert, Truck, Waves } from "lucide-react";

export const MAP_EVENT_KINDS = {
  earthquake: { label: "Earthquake", icon: Activity }, storm: { label: "Storm", icon: CloudLightning },
  fire: { label: "Fire", icon: Flame }, flood: { label: "Flood", icon: Waves },
  transport: { label: "Transport", icon: Truck }, weather: { label: "Weather", icon: CloudSun },
  markets: { label: "Markets", icon: Landmark }, security: { label: "Security", icon: ShieldAlert },
  news: { label: "News report", icon: Newspaper },
} as const;
export type MapEventKind = keyof typeof MAP_EVENT_KINDS;
export function mapEventKind(type: string): MapEventKind {
  if (/earthquake|seismic/.test(type)) return "earthquake";
  if (/storm|hurricane|typhoon|cyclone/.test(type)) return "storm";
  if (/fire/.test(type)) return "fire";
  if (/flood/.test(type)) return "flood";
  if (/transport|aviation|maritime|shipping/.test(type)) return "transport";
  if (/weather|temperature|precipitation/.test(type)) return "weather";
  if (/market|econom/.test(type)) return "markets";
  if (/security|conflict/.test(type)) return "security";
  return "news";
}

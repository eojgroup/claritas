import { createContext, useContext } from "react";
import type { CountryContext } from "../lib/api";
import { countryIso } from "./countryPresentation";
export const CountryDataContext = createContext<Record<string, CountryContext>>({});
export const useCountryContexts = () => useContext(CountryDataContext);
export function useCountryContext(iso?: string | null) {
  return useCountryContexts()[countryIso(iso) ?? ""];
}

import { countryFlagEmoji } from "./countryPresentation";
/** Decorative: the adjacent country name remains the accessible label. */
export default function CountryFlag({ country }: { country?: string | null }) {
  const flag = countryFlagEmoji(country);
  return flag ? <span className="country-flag" aria-hidden="true">{flag}</span> : null;
}

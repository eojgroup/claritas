export type CountryAttentionInput = {
  event_count: number;
  high_priority_count: number;
  previous_event_count?: number;
  peak_priority_score?: number;
};

/** Relative attention, not danger: importance and concentration dominate
 * volume. A small-sample adjustment keeps one routine report from looking
 * like a country-wide surge. The comparison uses the same preceding window. */
export function countryAttentionScore(country: CountryAttentionInput) {
  if (country.event_count <= 0) return 0;
  const peak = Math.min(100, Math.max(0, country.peak_priority_score ?? 0));
  const concentration = Math.min(100, country.high_priority_count / (country.event_count + 4) * 100);
  const previous = Math.max(0, country.previous_event_count ?? 0);
  const increase = Math.min(100, Math.max(0, (country.event_count - previous) / Math.max(4, previous)) * 100)
    * Math.min(1, country.event_count / 8);
  return Math.round(peak * .55 + concentration * .30 + increase * .15);
}

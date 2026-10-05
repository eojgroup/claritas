import type { CountryContext } from "../lib/api";
import CountryFlag from "./CountryFlag";
import SatelliteImage from "./SatelliteImage";

export default function CountryFacts({ context, country, name }: { context?: CountryContext | null; country: string; name: string }) {
  if (!context) return <section className="country-facts"><h4><CountryFlag country={country} />Country reference</h4><p>Wikidata country facts will appear after the next successful leadership refresh.</p></section>;
  const groups = [["Capital", context.capitals], ["Official languages", context.languages], ["Currencies", context.currencies], ["Neighbouring countries", context.neighbours]] as const;
  return <section className="country-facts" aria-label="Wikidata country reference">
    <h4><CountryFlag country={country} />Country reference</h4>
    <dl>{groups.map(([label, entries]) => <div key={label}><dt>{label}</dt><dd>{entries.length ? entries.map((entry, index) => <span key={entry.id}>{index > 0 && " · "}<a href={entry.source_url} target="_blank" rel="noreferrer">{entry.name}</a></span>) : "Not listed"}</dd></div>)}</dl>
    {context.coordinates && <p>Country reference point: {context.coordinates.latitude.toFixed(3)}°, {context.coordinates.longitude.toFixed(3)}°.
      {context.coordinates.precision_degrees != null && ` Source precision: ${context.coordinates.precision_degrees}°.`} This locates the country, not an incident or its borders.</p>}
    {context.locator_maps.slice(0, 2).map((map) => <figure key={map.source_url}>
      {map.thumbnail_url && <SatelliteImage sources={[map.thumbnail_url]} alt={`Locator map of ${name}`} className="country-locator-image" />}
      <figcaption><a href={map.source_url} target="_blank" rel="noreferrer">{map.thumbnail_url ? "Map source and attribution" : `View locator map of ${name}`}</a>
        {map.license && <small>{map.attribution} · {map.license_url ? <a href={map.license_url} target="_blank" rel="noreferrer">{map.license}</a> : map.license}</small>}
      </figcaption>
    </figure>)}
    {context.flag && <p><a href={context.flag.source_url} target="_blank" rel="noreferrer">Flag reference on Wikimedia Commons</a></p>}
    <p><a href={context.source_url} target="_blank" rel="noreferrer">Wikidata</a> · Facts: CC0 · Checked {new Date(context.retrieved_at).toLocaleDateString()}. Maps retain their individual licences and source depictions.</p>
  </section>;
}

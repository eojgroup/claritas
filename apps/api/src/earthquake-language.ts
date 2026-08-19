// A deliberately small, reviewed vocabulary for earthquake-family headlines.
// This is an admission signal, not translation or semantic inference. Each
// expression uses event-specific words in major GDELT languages and the input
// is bounded before evaluation.
const EARTHQUAKE_HEADLINE_PATTERNS: readonly RegExp[] = [
  /\b(?:earthquakes?|quakes?|aftershocks?|seismic|tremors?|epicent(?:er|re)s?|tsunamis?)\b/iu,
  /\b(?:terremotos?|sismos?|seísmos?|maremotos?|tsunamis?)\b/iu,
  /\b(?:séismes?|tremblements?\s+de\s+terre|tsunamis?)\b/iu,
  /\b(?:erdbeben|nachbeben|tsunamis?|aardbevingen?)\b/iu,
  /\b(?:terremoti?|sismi?|tsunamis?)\b/iu,
  /\b(?:depremler?|artçı\s+sarsıntı(?:lar)?|tsunamis?)\b/iu,
  /\b(?:gempa(?:\s+bumi|\s+susulan)?|tsunamis?)\b/iu,
  /(?:землетрясен|землетрус|цунами|афтершок)/iu,
  /(?:زلزال|زلازل|هزة\s+أرضية|تسونامي)/u,
  /(?:भूकंप|भूकम्प|सुनामी)/u,
  /(?:地震|余震|津波|海啸|海嘯)/u,
  /(?:지진|여진|쓰나미|해일)/u,
];

export function hasEarthquakeHeadlineSignal(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const title = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (title.length < 2 || title.length > 1_000) return false;
  return EARTHQUAKE_HEADLINE_PATTERNS.some((pattern) => pattern.test(title));
}

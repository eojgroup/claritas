const STOP = new Set("about after again against amid before being could during first from have into latest more news over reported reports said says that their there these they this through under update with would".split(" "));

export function socialTopicWords(value: string): string[] {
  return [...new Set(value.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((word) => word.length >= 4 && !STOP.has(word));
}

export function matchSocialEvent(post: { text: string; postedAt: string | Date }, event: {
  title: string; startTime: string | Date; lastActivityTime: string | Date;
  countryName?: string | null; locationName?: string | null;
}): string[] {
  const posted = new Date(post.postedAt).getTime();
  const start = new Date(event.startTime).getTime();
  const end = new Date(event.lastActivityTime).getTime();
  if (![posted, start, end].every(Number.isFinite)
    || posted < start - 24 * 3_600_000 || posted > end + 48 * 3_600_000) return [];
  const anchors = socialTopicWords(event.title);
  const words = new Set(socialTopicWords(post.text));
  const matched = anchors.filter((word) => words.has(word));
  if (event.countryName) {
    const normalized = ` ${post.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
    const places = [event.countryName, event.locationName].filter((place): place is string => Boolean(place && place.length >= 4));
    if (!places.some((place) => normalized.includes(` ${place.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `))) return [];
  }
  // Country, author location, engagement, or a discovery query alone never
  // links a claim. Require a substantial overlap with the actual event title.
  return matched.length >= 3 && matched.length / anchors.length >= 0.6 ? matched : [];
}

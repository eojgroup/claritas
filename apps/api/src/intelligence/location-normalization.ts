export function normalizeLocationAlias(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Match whole normalized words, never CAN inside cancelled or Iran inside viral text. */
export function locationAliasTextPredicateSql(): string {
  return "position(' ' || alias.normalized_alias || ' ' in ' ' || $1 || ' ') > 0";
}

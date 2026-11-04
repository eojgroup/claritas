/** Stable, account-independent key for cached reader presentation. */
export function normalizeIntelligenceDisplayLanguage(value: unknown = "en"): string {
  if (typeof value !== "string") throw new Error("display_language must be a valid BCP 47 language code.");
  const language = value.trim().toLowerCase().replace(/_/g, "-");
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(language)) throw new Error("display_language must be a valid BCP 47 language code.");
  return language;
}

export type TransportPositionFilters = {
  country?: string; corridor?: string; mode?: "maritime" | "aviation";
  from?: string; to?: string; port?: string; movement?: "departure" | "arrival"; limit: number;
};

/** Validate map reads independently from the slower historical overview. */
export function transportPositionFilters(input: Record<string, unknown>): TransportPositionFilters {
  const text = (key: string) => input[key] == null ? "" : typeof input[key] === "string" ? (input[key] as string).trim() : (() => { throw new Error(`Invalid ${key}.`); })();
  const country = text("country").toUpperCase(), corridor = text("corridor").toUpperCase();
  for (const value of [country, corridor]) if (value && !/^[A-Z]{2}$/.test(value)) throw new Error("Country links require ISO alpha-2 codes.");
  if (corridor && (!country || corridor === country)) throw new Error("A corridor requires two different countries.");
  const mode = text("mode");
  if (mode && mode !== "maritime" && mode !== "aviation") throw new Error("Invalid transport mode.");
  const from = text("from"), to = text("to");
  if (Boolean(from) !== Boolean(to)) throw new Error("Both cohort boundaries are required.");
  if (from && (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 31 * 86400000 || Date.parse(to) > Date.now() + 86400000)) throw new Error("Select a valid activity window of up to 31 days.");
  const movement = text("movement");
  if (movement && (!["departure","arrival"].includes(movement) || !from || mode === "aviation")) throw new Error("Movement selection requires a maritime activity window.");
  const port = text("port");
  if (port.length > 160) throw new Error("Invalid port.");
  const rawLimit = text("limit");
  const limit = rawLimit ? Number(rawLimit) : 600;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1200) throw new Error("Position limit must be between 1 and 1200.");
  return { country: country || undefined, corridor: corridor || undefined, mode: movement ? "maritime" : mode as TransportPositionFilters["mode"] || undefined,
    from: from ? new Date(from).toISOString() : undefined, to: to ? new Date(to).toISOString() : undefined, port: port || undefined, movement: movement as TransportPositionFilters["movement"] || undefined, limit };
}

import { gunzipSync } from "node:zlib";
import { awaitGdeltOperation, readGdeltBody } from "./gdelt-io";

export const GDELT_GAL_METADATA_BASE = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv3/gal";
export const GDELT_GAL_METADATA_VERSION = "minute-metadata-v1";
const MINUTE_MS = 60_000;

export type GdeltGalMetadataRecord = {
  url: string;
  title: string;
  description: string | null;
  languageCode: string;
  outletName: string | null;
  image: string | null;
  providerTime: string | null;
  /** Immutable object interval, not the publisher's publication timestamp. */
  firstSeenAt: string;
};

export type GdeltGalMetadataCursor = {
  version: typeof GDELT_GAL_METADATA_VERSION;
  through_minute: string;
  retry_minutes: string[];
};

const clean = (value: unknown, maxLength: number): string | null =>
  typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, maxLength) || null : null;

export function gdeltMinuteStamp(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 12) + "00";
}

export function gdeltMinuteDate(stamp: string): Date | null {
  if (!/^\d{12}00$/.test(stamp)) return null;
  const date = new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00.000Z`);
  return Number.isFinite(date.getTime()) && gdeltMinuteStamp(date) === stamp ? date : null;
}

/** Catch-up is bounded and any omitted old interval is reported explicitly. */
export function planGdeltGalMinutes(cursor: Partial<GdeltGalMetadataCursor> | null, now = new Date()): {
  minutes: string[];
  throughMinute: string;
  skippedBacklogMinutes: number;
  pendingRetryMinutes: string[];
  expiredRetryMinutes: number;
} {
  // Leave three minutes for the upstream minute object to settle. GAL objects
  // arrive in bursts and many minute names legitimately do not exist.
  const latestMs = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS - 3 * MINUTE_MS;
  const parsedCursorDate = cursor?.through_minute ? gdeltMinuteDate(cursor.through_minute) : null;
  const cursorDate = parsedCursorDate && parsedCursorDate.getTime() <= latestMs ? parsedCursorDate : null;
  const desiredStart = cursorDate ? cursorDate.getTime() + MINUTE_MS : latestMs - 14 * MINUTE_MS;
  const start = Math.max(desiredStart, latestMs - 29 * MINUTE_MS);
  const skippedBacklogMinutes = Math.max(0, Math.round((start - desiredStart) / MINUTE_MS));
  const newMinutes: string[] = [];
  for (let at = start; at <= latestMs; at += MINUTE_MS) newMinutes.push(gdeltMinuteStamp(new Date(at)));
  const storedRetries = Array.isArray(cursor?.retry_minutes) ? [...new Set(cursor.retry_minutes)] : [];
  const retries = storedRetries.filter((stamp) => {
    const date = gdeltMinuteDate(stamp);
    return date && date.getTime() <= latestMs && date.getTime() >= latestMs - 60 * MINUTE_MS;
  }).sort();
  return {
    minutes: [...new Set([...retries.slice(0, 4), ...newMinutes])],
    throughMinute: gdeltMinuteStamp(new Date(Math.max(latestMs, cursorDate?.getTime() ?? 0))),
    skippedBacklogMinutes,
    pendingRetryMinutes: retries,
    expiredRetryMinutes: storedRetries.length - retries.length,
  };
}

/** Metadata is original publisher text. GAL's date is publication OR discovery. */
export function parseGdeltGalMetadata(text: string, minute: string): {
  records: GdeltGalMetadataRecord[];
  malformedRows: number;
  rejectedRows: number;
} {
  const interval = gdeltMinuteDate(minute);
  if (!interval) throw new Error("Invalid GDELT GAL minute identity.");
  const records: GdeltGalMetadataRecord[] = [];
  let malformedRows = 0;
  let rejectedRows = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Not an object");
      row = parsed as Record<string, unknown>;
    } catch { malformedRows += 1; continue; }
    const title = clean(row.title, 500);
    const url = clean(row.url, 4_000);
    if (!title || !url) { rejectedRows += 1; continue; }
    const language = clean(row.lang, 20)?.toLowerCase().replace(/_/g, "-");
    const languageCode = language && /^[a-z]{2,3}(?:-[a-z]{2,8})?$/.test(language) && !["un", "xx"].includes(language)
      ? language : "und";
    const providerRaw = clean(row.date, 50);
    const compactDate = providerRaw && /^\d{14}$/.test(providerRaw)
      ? `${providerRaw.slice(0,4)}-${providerRaw.slice(4,6)}-${providerRaw.slice(6,8)}T${providerRaw.slice(8,10)}:${providerRaw.slice(10,12)}:${providerRaw.slice(12,14)}Z`
      : providerRaw;
    const providerDate = compactDate ? new Date(compactDate) : null;
    records.push({
      title, url,
      description: clean(row.desc, 800),
      languageCode,
      outletName: clean(row.outletName, 200),
      image: clean(row.image, 4_000),
      providerTime: providerDate && Number.isFinite(providerDate.getTime()) ? providerDate.toISOString() : null,
      firstSeenAt: interval.toISOString(),
    });
  }
  // A corrupted/truncated file must replay rather than acknowledging a partial
  // interval. Valid records in a replay remain idempotent at URL persistence.
  if (malformedRows > 0) throw new Error(`GDELT GAL minute has ${malformedRows} malformed JSON row(s).`);
  return { records, malformedRows, rejectedRows };
}

/**
 * A current, explicitly bounded sample rather than a backlog that grows
 * forever. Each language and publisher gets a turn before a large outlet can
 * fill the result. URL identity/safety is checked by the persistence caller.
 */
export function selectGdeltGalMetadataSample(records: GdeltGalMetadataRecord[], limit: number): GdeltGalMetadataRecord[] {
  const bounded = Math.max(1, Math.min(Math.trunc(limit) || 120, 250));
  const seen = new Set<string>();
  const byLanguage = new Map<string, Map<string, GdeltGalMetadataRecord[]>>();
  for (const record of [...records].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))) {
    if (seen.has(record.url)) continue;
    seen.add(record.url);
    let publisher: string;
    try { publisher = new URL(record.url).hostname.toLowerCase().replace(/^www\./, ""); }
    catch { continue; }
    const publishers = byLanguage.get(record.languageCode) ?? new Map<string, GdeltGalMetadataRecord[]>();
    const items = publishers.get(publisher) ?? [];
    items.push(record);
    publishers.set(publisher, items);
    byLanguage.set(record.languageCode, publishers);
  }
  const selected: GdeltGalMetadataRecord[] = [];
  const queues = [...byLanguage.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, publishers]) => {
    const queue: GdeltGalMetadataRecord[] = [];
    while ([...publishers.values()].some((items) => items.length)) {
      for (const items of publishers.values()) { if (items.length) queue.push(items.shift()!); }
    }
    return queue;
  });
  while (selected.length < bounded && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (queue.length && selected.length < bounded) selected.push(queue.shift()!);
    }
  }
  return selected;
}

export async function fetchGdeltGalMetadataMinute(
  minute: string,
  options: { signal?: AbortSignal; request?: typeof fetch; baseUrl?: string } = {},
): Promise<string | null> {
  if (!gdeltMinuteDate(minute)) throw new Error("Invalid GDELT GAL minute identity.");
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000);
  const url = `${(options.baseUrl || GDELT_GAL_METADATA_BASE).replace(/\/$/, "")}/${minute}.gal.json.gz`;
  const response = await awaitGdeltOperation((options.request ?? fetch)(url, {
    headers: { accept: "application/gzip, application/octet-stream", "user-agent": process.env.GDELT_USER_AGENT || "Claritas/1.0 (+https://claritas.info)" },
    signal,
  }), signal);
  if (response.status === 404) { void response.body?.cancel().catch(() => undefined); return null; }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`GDELT GAL minute HTTP ${response.status}.`);
  }
  const compressed = await readGdeltBody(response, 8 * 1024 * 1024, signal);
  signal.throwIfAborted();
  return gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }).toString("utf8");
}

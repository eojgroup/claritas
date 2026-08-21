export type RegionalAisObservation = {
  mmsi: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  heading: number | null;
  navigationStatus: number | null;
  observedAt: string;
  displayName: string | null;
  callsign: string | null;
  shipType: number | null;
  destination: string | null;
};

export type AisStaticFields = {
  displayName: string | null;
  callsign: string | null;
  shipType: number | null;
  destination: string | null;
};

export type DecodedAisPosition = {
  kind: "position";
  messageType: 1 | 2 | 3 | 18 | 19 | 27;
  mmsi: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  course: number | null;
  heading: number | null;
  navigationStatus: number | null;
  staticFields: AisStaticFields | null;
};

export type DecodedAisStatic = {
  kind: "static";
  messageType: 5 | 24;
  mmsi: string;
  staticFields: AisStaticFields;
};

export type DecodedAisMessage = DecodedAisPosition | DecodedAisStatic;

export type ParsedRegionalAisNmeaFragment = {
  talker: string;
  formatter: "VDM" | "VDO";
  fragmentCount: number;
  fragmentNumber: number;
  sequenceId: string | null;
  channel: string | null;
  payload: string;
  fillBits: number;
  source: string;
  timestampMilliseconds: number | null;
  tags: Readonly<Record<string, string>>;
};

export type RegionalAisNmeaDecoderOptions = {
  freshnessMilliseconds?: number;
  futureToleranceMilliseconds?: number;
  multipartTtlMilliseconds?: number;
  staticTtlMilliseconds?: number;
  maintenanceIntervalMilliseconds?: number;
  maxMultipartAssemblies?: number;
  maxStaticEntries?: number;
};

type MultipartAssembly = {
  fragmentCount: number;
  parts: string[];
  lastUpdatedAt: number;
  observedAtMilliseconds: number;
};

type CachedStaticFields = AisStaticFields & { updatedAt: number };

const DEFAULT_FRESHNESS_MILLISECONDS = 15 * 60_000;
const DEFAULT_FUTURE_TOLERANCE_MILLISECONDS = 5 * 60_000;
const DEFAULT_MULTIPART_TTL_MILLISECONDS = 30_000;
const DEFAULT_STATIC_TTL_MILLISECONDS = 24 * 60 * 60_000;
const DEFAULT_MAINTENANCE_INTERVAL_MILLISECONDS = 30_000;
const MIN_MAINTENANCE_INTERVAL_MILLISECONDS = 1_000;
const MAX_MAINTENANCE_INTERVAL_MILLISECONDS = 60_000;
const DEFAULT_MAX_MULTIPART_ASSEMBLIES = 1_024;
const DEFAULT_MAX_STATIC_ENTRIES = 100_000;
const MAX_LINE_LENGTH = 4_096;
const MAX_PAYLOAD_LENGTH = 1_024;

function boundedNonNegative(
  value: number | undefined,
  fallback: number,
): number {
  return value != null && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  return value != null && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

/** Calculates the two-character hexadecimal XOR checksum for text without ! or *. */
export function calculateNmeaChecksum(body: string): string {
  let checksum = 0;
  for (let index = 0; index < body.length; index += 1) {
    checksum ^= body.charCodeAt(index);
  }
  return checksum.toString(16).toUpperCase().padStart(2, "0");
}

/** Verifies an NMEA sentence. An IEC tag block before the sentence is ignored here. */
export function verifyNmeaChecksum(value: string): boolean {
  const start = value.lastIndexOf("!");
  if (start < 0) return false;
  const sentence = value.slice(start).trim();
  const match = /^!([^*\r\n]+)\*([0-9A-Fa-f]{2})$/.exec(sentence);
  return Boolean(
    match && calculateNmeaChecksum(match[1]) === match[2].toUpperCase(),
  );
}

function parseEpochMilliseconds(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric;
  return Number.isFinite(milliseconds) && milliseconds <= 8_640_000_000_000_000
    ? milliseconds
    : null;
}

function parseTagBlock(
  input: string,
): { remainder: string; tags: Record<string, string> } | null {
  if (!input.startsWith("\\")) return { remainder: input, tags: {} };
  const match = /^\\([^\\]*)\*([0-9A-Fa-f]{2})\\/.exec(input);
  if (!match || calculateNmeaChecksum(match[1]) !== match[2].toUpperCase()) {
    return null;
  }

  const tags: Record<string, string> = {};
  for (const field of match[1].split(",")) {
    if (!field) continue;
    const separator = field.indexOf(":");
    if (separator <= 0) return null;
    const key = field.slice(0, separator);
    const value = field.slice(separator + 1);
    if (!/^[A-Za-z0-9]$/.test(key) || key in tags) return null;
    tags[key] = value;
  }
  return { remainder: input.slice(match[0].length).trimStart(), tags };
}

/** Parses and checksum-validates one complete VDM/VDO line and optional IEC tag block. */
export function parseRegionalAisNmeaLine(
  line: string,
): ParsedRegionalAisNmeaFragment | null {
  if (typeof line !== "string" || line.length === 0 || line.length > MAX_LINE_LENGTH) {
    return null;
  }
  const tagged = parseTagBlock(line.trim());
  if (!tagged || !verifyNmeaChecksum(tagged.remainder)) return null;

  const match = /^!([^*\r\n]+)\*([0-9A-Fa-f]{2})$/.exec(
    tagged.remainder.trim(),
  );
  if (!match) return null;
  const fields = match[1].split(",");
  if (fields.length !== 7) return null;
  const header = /^([A-Z0-9]{2})(VDM|VDO)$/i.exec(fields[0]);
  if (!header) return null;
  if (!/^[1-9]$/.test(fields[1]) || !/^[1-9]$/.test(fields[2])) return null;
  const fragmentCount = Number(fields[1]);
  const fragmentNumber = Number(fields[2]);
  if (fragmentNumber > fragmentCount) return null;
  if (!/^\d?$/.test(fields[3]) || !/^[A-Z0-9]?$/i.test(fields[4])) return null;
  if (
    fields[5].length === 0 ||
    fields[5].length > MAX_PAYLOAD_LENGTH ||
    !/^[0-W`-w]+$/.test(fields[5]) ||
    !/^[0-5]$/.test(fields[6])
  ) {
    return null;
  }
  const fillBits = Number(fields[6]);
  if (fragmentNumber < fragmentCount && fillBits !== 0) return null;

  const sourceTag = tagged.tags.s?.trim();
  if (sourceTag != null && (sourceTag.length === 0 || sourceTag.length > 128)) {
    return null;
  }
  const timestampMilliseconds = tagged.tags.c == null
    ? null
    : parseEpochMilliseconds(tagged.tags.c);
  if (tagged.tags.c != null && timestampMilliseconds == null) return null;

  const talker = header[1].toUpperCase();
  const formatter = header[2].toUpperCase() as "VDM" | "VDO";
  return {
    talker,
    formatter,
    fragmentCount,
    fragmentNumber,
    sequenceId: fields[3] || null,
    channel: fields[4].toUpperCase() || null,
    payload: fields[5],
    fillBits,
    source: sourceTag ?? talker,
    timestampMilliseconds,
    tags: Object.freeze({ ...tagged.tags }),
  };
}

function payloadBits(payload: string, fillBits: number): string | null {
  if (
    payload.length === 0 ||
    payload.length > MAX_PAYLOAD_LENGTH ||
    !Number.isInteger(fillBits) ||
    fillBits < 0 ||
    fillBits > 5
  ) {
    return null;
  }
  let bits = "";
  for (const character of payload) {
    const code = character.charCodeAt(0);
    if (!((code >= 48 && code <= 87) || (code >= 96 && code <= 119))) {
      return null;
    }
    let value = code - 48;
    if (value > 40) value -= 8;
    bits += value.toString(2).padStart(6, "0");
  }
  if (fillBits > bits.length) return null;
  if (fillBits > 0) {
    if (!bits.endsWith("0".repeat(fillBits))) return null;
    bits = bits.slice(0, -fillBits);
  }
  return bits;
}

function unsigned(bits: string, start: number, width: number): number | null {
  if (start < 0 || width <= 0 || start + width > bits.length) return null;
  return Number.parseInt(bits.slice(start, start + width), 2);
}

function signed(bits: string, start: number, width: number): number | null {
  const value = unsigned(bits, start, width);
  if (value == null) return null;
  const signBit = 2 ** (width - 1);
  return value >= signBit ? value - 2 ** width : value;
}

function mmsiAt(bits: string): string | null {
  const value = unsigned(bits, 8, 30);
  if (value == null || value < 100_000_000 || value > 999_999_999) return null;
  return String(value);
}

function aisText(bits: string, start: number, width: number): string | null {
  if (width % 6 !== 0 || start + width > bits.length) return null;
  let value = "";
  for (let offset = 0; offset < width; offset += 6) {
    const character = unsigned(bits, start + offset, 6);
    if (character == null) return null;
    value += String.fromCharCode(character < 32 ? character + 64 : character);
  }
  const normalized = value
    .replace(/@+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function standardCoordinates(
  bits: string,
  longitudeOffset: number,
  latitudeOffset: number,
): { latitude: number; longitude: number } | null {
  const rawLongitude = signed(bits, longitudeOffset, 28);
  const rawLatitude = signed(bits, latitudeOffset, 27);
  if (rawLongitude == null || rawLatitude == null) return null;
  const longitude = rawLongitude / 600_000;
  const latitude = rawLatitude / 600_000;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null;
  }
  return { latitude, longitude };
}

function nullableTenths(value: number | null, unavailable: number): number | null {
  return value == null || value >= unavailable ? null : value / 10;
}

function nullableHeading(value: number | null): number | null {
  return value == null || value > 359 ? null : value;
}

function nullableNavigationStatus(value: number | null): number | null {
  return value == null || value === 15 ? null : value;
}

function emptyStaticFields(): AisStaticFields {
  return {
    displayName: null,
    callsign: null,
    shipType: null,
    destination: null,
  };
}

function decodeClassAPosition(
  bits: string,
  messageType: 1 | 2 | 3,
): DecodedAisPosition | null {
  if (bits.length < 168) return null;
  const mmsi = mmsiAt(bits);
  const coordinates = standardCoordinates(bits, 61, 89);
  if (!mmsi || !coordinates) return null;
  return {
    kind: "position",
    messageType,
    mmsi,
    ...coordinates,
    speed: nullableTenths(unsigned(bits, 50, 10), 1_023),
    course: nullableTenths(unsigned(bits, 116, 12), 3_600),
    heading: nullableHeading(unsigned(bits, 128, 9)),
    navigationStatus: nullableNavigationStatus(unsigned(bits, 38, 4)),
    staticFields: null,
  };
}

function decodeClassBPosition(
  bits: string,
  messageType: 18 | 19,
): DecodedAisPosition | null {
  const minimumBits = messageType === 19 ? 312 : 168;
  if (bits.length < minimumBits) return null;
  const mmsi = mmsiAt(bits);
  const coordinates = standardCoordinates(bits, 57, 85);
  if (!mmsi || !coordinates) return null;
  const staticFields = messageType === 19
    ? {
        displayName: aisText(bits, 143, 120),
        callsign: null,
        shipType: (unsigned(bits, 263, 8) || null),
        destination: null,
      }
    : null;
  return {
    kind: "position",
    messageType,
    mmsi,
    ...coordinates,
    speed: nullableTenths(unsigned(bits, 46, 10), 1_023),
    course: nullableTenths(unsigned(bits, 112, 12), 3_600),
    heading: nullableHeading(unsigned(bits, 124, 9)),
    navigationStatus: null,
    staticFields,
  };
}

function decodeLongRangePosition(bits: string): DecodedAisPosition | null {
  if (bits.length < 96) return null;
  const mmsi = mmsiAt(bits);
  const rawLongitude = signed(bits, 44, 18);
  const rawLatitude = signed(bits, 62, 17);
  if (!mmsi || rawLongitude == null || rawLatitude == null) return null;
  const longitude = rawLongitude / 600;
  const latitude = rawLatitude / 600;
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return null;
  }
  const rawSpeed = unsigned(bits, 79, 6);
  const rawCourse = unsigned(bits, 85, 9);
  return {
    kind: "position",
    messageType: 27,
    mmsi,
    latitude,
    longitude,
    speed: rawSpeed == null || rawSpeed === 63 ? null : rawSpeed,
    course: rawCourse == null || rawCourse > 359 ? null : rawCourse,
    heading: null,
    navigationStatus: nullableNavigationStatus(unsigned(bits, 40, 4)),
    staticFields: null,
  };
}

function decodeStaticVoyage(bits: string): DecodedAisStatic | null {
  if (bits.length < 424) return null;
  const mmsi = mmsiAt(bits);
  if (!mmsi) return null;
  return {
    kind: "static",
    messageType: 5,
    mmsi,
    staticFields: {
      displayName: aisText(bits, 112, 120),
      callsign: aisText(bits, 70, 42),
      shipType: unsigned(bits, 232, 8) || null,
      destination: aisText(bits, 302, 120),
    },
  };
}

function decodeStaticDataReport(bits: string): DecodedAisStatic | null {
  if (bits.length < 40) return null;
  const mmsi = mmsiAt(bits);
  const part = unsigned(bits, 38, 2);
  if (!mmsi || (part !== 0 && part !== 1)) return null;
  const staticFields = emptyStaticFields();
  if (part === 0) {
    if (bits.length < 160) return null;
    staticFields.displayName = aisText(bits, 40, 120);
  } else {
    if (bits.length < 168) return null;
    staticFields.shipType = unsigned(bits, 40, 8) || null;
    staticFields.callsign = aisText(bits, 90, 42);
  }
  return {
    kind: "static",
    messageType: 24,
    mmsi,
    staticFields,
  };
}

/** Decodes supported AIS payloads after NMEA fragment assembly. */
export function decodeAisPayload(
  payload: string,
  fillBits: number,
): DecodedAisMessage | null {
  const bits = payloadBits(payload, fillBits);
  if (!bits) return null;
  const type = unsigned(bits, 0, 6);
  switch (type) {
    case 1:
    case 2:
    case 3:
      return decodeClassAPosition(bits, type);
    case 5:
      return decodeStaticVoyage(bits);
    case 18:
    case 19:
      return decodeClassBPosition(bits, type);
    case 24:
      return decodeStaticDataReport(bits);
    case 27:
      return decodeLongRangePosition(bits);
    default:
      return null;
  }
}

export class RegionalAisNmeaDecoder {
  private readonly freshnessMilliseconds: number;
  private readonly futureToleranceMilliseconds: number;
  private readonly multipartTtlMilliseconds: number;
  private readonly staticTtlMilliseconds: number;
  private readonly maintenanceIntervalMilliseconds: number;
  private readonly maxMultipartAssemblies: number;
  private readonly maxStaticEntries: number;
  private readonly multipart = new Map<string, MultipartAssembly>();
  private readonly staticByMmsi = new Map<string, CachedStaticFields>();
  private nextMaintenanceAt: number | null = null;

  constructor(options: RegionalAisNmeaDecoderOptions = {}) {
    this.freshnessMilliseconds = boundedNonNegative(
      options.freshnessMilliseconds,
      DEFAULT_FRESHNESS_MILLISECONDS,
    );
    this.futureToleranceMilliseconds = boundedNonNegative(
      options.futureToleranceMilliseconds,
      DEFAULT_FUTURE_TOLERANCE_MILLISECONDS,
    );
    this.multipartTtlMilliseconds = boundedNonNegative(
      options.multipartTtlMilliseconds,
      DEFAULT_MULTIPART_TTL_MILLISECONDS,
    );
    this.staticTtlMilliseconds = boundedNonNegative(
      options.staticTtlMilliseconds,
      DEFAULT_STATIC_TTL_MILLISECONDS,
    );
    this.maintenanceIntervalMilliseconds = Math.max(
      MIN_MAINTENANCE_INTERVAL_MILLISECONDS,
      Math.min(
        boundedPositiveInteger(
          options.maintenanceIntervalMilliseconds,
          DEFAULT_MAINTENANCE_INTERVAL_MILLISECONDS,
        ),
        MAX_MAINTENANCE_INTERVAL_MILLISECONDS,
      ),
    );
    this.maxMultipartAssemblies = boundedPositiveInteger(
      options.maxMultipartAssemblies,
      DEFAULT_MAX_MULTIPART_ASSEMBLIES,
    );
    this.maxStaticEntries = boundedPositiveInteger(
      options.maxStaticEntries,
      DEFAULT_MAX_STATIC_ENTRIES,
    );
  }

  consumeLine(
    line: string,
    now: number | Date = Date.now(),
  ): RegionalAisObservation | null {
    const nowMilliseconds = now instanceof Date ? now.getTime() : now;
    if (!Number.isFinite(nowMilliseconds)) return null;
    this.runMaintenanceIfDue(nowMilliseconds);

    const fragment = parseRegionalAisNmeaLine(line);
    if (!fragment) return null;
    const observedAtMilliseconds = fragment.timestampMilliseconds ?? nowMilliseconds;
    if (
      observedAtMilliseconds > nowMilliseconds + this.futureToleranceMilliseconds ||
      nowMilliseconds - observedAtMilliseconds > this.freshnessMilliseconds
    ) {
      return null;
    }

    const assembled = this.assemble(fragment, nowMilliseconds, observedAtMilliseconds);
    if (!assembled) return null;
    const decoded = decodeAisPayload(assembled.payload, assembled.fillBits);
    if (!decoded) return null;

    if (decoded.staticFields) {
      this.cacheStatic(decoded.mmsi, decoded.staticFields, nowMilliseconds);
    }
    if (decoded.kind === "static") return null;

    const cached = this.currentStaticFields(decoded.mmsi, nowMilliseconds);
    const staticFields = cached ?? emptyStaticFields();
    return {
      mmsi: decoded.mmsi,
      latitude: decoded.latitude,
      longitude: decoded.longitude,
      speed: decoded.speed,
      course: decoded.course,
      heading: decoded.heading,
      navigationStatus: decoded.navigationStatus,
      observedAt: new Date(assembled.observedAtMilliseconds).toISOString(),
      displayName: staticFields.displayName,
      callsign: staticFields.callsign,
      shipType: staticFields.shipType,
      destination: staticFields.destination,
    };
  }

  private assemblyKey(fragment: ParsedRegionalAisNmeaFragment): string {
    return JSON.stringify([
      fragment.source,
      fragment.talker,
      fragment.formatter,
      fragment.sequenceId ?? "-",
      fragment.channel ?? "-",
    ]);
  }

  private assemble(
    fragment: ParsedRegionalAisNmeaFragment,
    nowMilliseconds: number,
    observedAtMilliseconds: number,
  ): { payload: string; fillBits: number; observedAtMilliseconds: number } | null {
    if (fragment.fragmentCount === 1) {
      return {
        payload: fragment.payload,
        fillBits: fragment.fillBits,
        observedAtMilliseconds,
      };
    }

    const key = this.assemblyKey(fragment);
    if (fragment.fragmentNumber === 1) {
      if (!this.multipart.has(key) && this.multipart.size >= this.maxMultipartAssemblies) {
        const oldestKey = this.multipart.keys().next().value;
        if (oldestKey != null) this.multipart.delete(oldestKey);
      }
      this.multipart.delete(key);
      this.multipart.set(key, {
        fragmentCount: fragment.fragmentCount,
        parts: [fragment.payload],
        lastUpdatedAt: nowMilliseconds,
        observedAtMilliseconds,
      });
      return null;
    }

    const assembly = this.multipart.get(key);
    if (!assembly) return null;
    if (nowMilliseconds - assembly.lastUpdatedAt > this.multipartTtlMilliseconds) {
      this.multipart.delete(key);
      return null;
    }
    if (assembly.fragmentCount !== fragment.fragmentCount) return null;
    const partIndex = fragment.fragmentNumber - 1;
    if (partIndex < assembly.parts.length) {
      if (assembly.parts[partIndex] !== fragment.payload) this.multipart.delete(key);
      return null;
    }
    if (partIndex !== assembly.parts.length) {
      this.multipart.delete(key);
      return null;
    }
    assembly.parts.push(fragment.payload);
    assembly.lastUpdatedAt = nowMilliseconds;
    assembly.observedAtMilliseconds = observedAtMilliseconds;
    if (fragment.fragmentNumber !== fragment.fragmentCount) return null;

    this.multipart.delete(key);
    const payload = assembly.parts.join("");
    if (payload.length > MAX_PAYLOAD_LENGTH) return null;
    return {
      payload,
      fillBits: fragment.fillBits,
      observedAtMilliseconds: assembly.observedAtMilliseconds,
    };
  }

  private cacheStatic(
    mmsi: string,
    incoming: AisStaticFields,
    nowMilliseconds: number,
  ): void {
    const existing = this.currentStaticFields(mmsi, nowMilliseconds);
    const merged: CachedStaticFields = {
      displayName: incoming.displayName ?? existing?.displayName ?? null,
      callsign: incoming.callsign ?? existing?.callsign ?? null,
      shipType: incoming.shipType ?? existing?.shipType ?? null,
      destination: incoming.destination ?? existing?.destination ?? null,
      updatedAt: nowMilliseconds,
    };
    if (
      merged.displayName == null &&
      merged.callsign == null &&
      merged.shipType == null &&
      merged.destination == null
    ) {
      return;
    }
    this.staticByMmsi.delete(mmsi);
    if (!existing && this.staticByMmsi.size >= this.maxStaticEntries) {
      const oldestMmsi = this.staticByMmsi.keys().next().value;
      if (oldestMmsi != null) this.staticByMmsi.delete(oldestMmsi);
    }
    this.staticByMmsi.set(mmsi, merged);
  }

  private currentStaticFields(
    mmsi: string,
    nowMilliseconds: number,
  ): CachedStaticFields | undefined {
    const cached = this.staticByMmsi.get(mmsi);
    if (
      cached &&
      nowMilliseconds - cached.updatedAt > this.staticTtlMilliseconds
    ) {
      this.staticByMmsi.delete(mmsi);
      return undefined;
    }
    return cached;
  }

  private runMaintenanceIfDue(nowMilliseconds: number): void {
    if (this.nextMaintenanceAt == null) {
      this.nextMaintenanceAt =
        nowMilliseconds + this.maintenanceIntervalMilliseconds;
      return;
    }
    if (nowMilliseconds < this.nextMaintenanceAt) return;
    this.prune(nowMilliseconds);
    this.nextMaintenanceAt =
      nowMilliseconds + this.maintenanceIntervalMilliseconds;
  }

  private prune(nowMilliseconds: number): void {
    for (const [key, assembly] of this.multipart) {
      if (nowMilliseconds - assembly.lastUpdatedAt > this.multipartTtlMilliseconds) {
        this.multipart.delete(key);
      }
    }
    for (const [mmsi, staticFields] of this.staticByMmsi) {
      if (nowMilliseconds - staticFields.updatedAt > this.staticTtlMilliseconds) {
        this.staticByMmsi.delete(mmsi);
      }
    }
  }
}

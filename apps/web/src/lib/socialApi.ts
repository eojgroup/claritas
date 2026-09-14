import type { SourceInvestigationLink } from "./api";
export const SOCIAL_PLATFORMS = ["x", "youtube", "reddit", "bluesky"] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialEngagement = {
  likes?: number | null;
  replies?: number | null;
  reposts?: number | null;
  quotes?: number | null;
  views?: number | null;
  score?: number | null;
  comments?: number | null;
  upvote_ratio?: number | null;
};

export type SocialAccount = {
  account_id: string;
  handle: string | null;
  display_name: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  platform_verified: boolean;
};

export type SocialResponsibleParty = {
  name: string;
  account_id: string;
  type: "account_holder";
  attribution_basis: "platform_account";
};

export type SocialCredibility = {
  tier: "unverified_social";
  score: null;
  platform_verified_account: boolean;
  rationale: string;
};

export type SocialSignal = {
  linked_events?: SourceInvestigationLink[];
  id: number;
  platform: SocialPlatform;
  content_type: "social_post";
  signal_nature: "claim";
  verification_status: "unverified";
  is_fact: false;
  text: string;
  title: string | null;
  url: string;
  posted_at: string;
  acquired_at: string;
  language_code: string | null;
  country_iso2: string | null;
  engagement: SocialEngagement;
  posted_by: SocialAccount;
  responsible_party: SocialResponsibleParty;
  credibility: SocialCredibility;
  warning: string;
  payload_metadata: Record<string, unknown> | null;
};

export type SocialProviderCoverage = {
  platform: SocialPlatform;
  enabled: boolean;
  configured: boolean;
  available: boolean;
  status: string;
  detail: string | null;
};

export type SocialCoverageRow = {
  platform: SocialPlatform;
  signal_count: number;
  account_count: number;
  latest_posted_at: string | null;
  latest_acquired_at: string | null;
};

export type SocialCoverage = {
  collection?: { enabled: boolean; schedule_enabled: boolean; last_status: string | null; last_run_at: string | null };
  window_days: number;
  coverage: SocialCoverageRow[];
  providers: SocialProviderCoverage[];
  generated_at: string | null;
};

export type SocialSignalResponse = {
  items: SocialSignal[];
  count: number;
  page: {
    limit: number;
    offset: number;
    total: number | null;
  };
};

const platformSet = new Set<string>(SOCIAL_PLATFORMS);

function isPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && platformSet.has(value.toLowerCase());
}

async function responseError(response: Response, fallback: string) {
  try {
    const value = await response.json() as { error?: unknown; message?: unknown };
    const message = typeof value.error === "string"
      ? value.error
      : typeof value.message === "string"
        ? value.message
        : null;
    if (message?.trim()) return message.trim().slice(0, 280);
  } catch {
    // Keep proxy and HTML errors out of the workspace.
  }
  return `${fallback} (HTTP ${response.status})`;
}

export async function fetchSocialSignals(params?: {
  eventId?: string;
  platform?: SocialPlatform | "all";
  country?: string;
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<SocialSignalResponse> {
  const search = new URLSearchParams();
  search.set("limit", String(params?.limit ?? 100));
  search.set("offset", String(params?.offset ?? 0));
  if (params?.platform && params.platform !== "all") search.set("platform", params.platform);
  if (params?.country?.trim()) search.set("country", params.country.trim().toUpperCase());
  if (params?.q?.trim()) search.set("q", params.q.trim());
  if (params?.eventId) search.set("eventId", params.eventId);

  const response = await fetch(`/api/social/signals?${search.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(await responseError(response, "Failed to fetch social signals"));
  const payload = await response.json() as Partial<SocialSignalResponse> & {
    limit?: unknown;
    offset?: unknown;
    total?: unknown;
  };
  const items = Array.isArray(payload.items) ? payload.items : [];
  return {
    items,
    count: Number.isFinite(Number(payload.count)) ? Number(payload.count) : items.length,
    page: {
      limit: Number.isFinite(Number(payload.page?.limit ?? payload.limit)) ? Number(payload.page?.limit ?? payload.limit) : (params?.limit ?? 100),
      offset: Number.isFinite(Number(payload.page?.offset ?? payload.offset)) ? Number(payload.page?.offset ?? payload.offset) : (params?.offset ?? 0),
      total: (payload.page?.total ?? payload.total) == null || !Number.isFinite(Number(payload.page?.total ?? payload.total))
        ? null
        : Number(payload.page?.total ?? payload.total),
    },
  };
}

export async function fetchSocialCoverage(): Promise<SocialCoverage> {
  const response = await fetch("/api/social/coverage", { credentials: "include" });
  if (!response.ok) throw new Error(await responseError(response, "Failed to fetch social coverage"));
  const payload = await response.json() as {
    providers?: unknown;
    coverage?: unknown;
    generated_at?: unknown;
    window_days?: unknown;
    collection?: SocialCoverage["collection"];
  };
  const rawProviders = Array.isArray(payload.providers)
    ? payload.providers
    : [];
  const providers = rawProviders.flatMap((raw): SocialProviderCoverage[] => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    const rawPlatform = value.platform ?? value.id;
    if (!isPlatform(rawPlatform)) return [];
    const platform = rawPlatform.toLowerCase() as SocialPlatform;
    return [{
      platform,
      enabled: value.enabled === true,
      configured: value.configured === true,
      available: value.available === true || (value.available == null && value.enabled === true && value.configured === true),
      status: typeof value.status === "string"
        ? value.status
        : value.available === true
          ? "available"
          : value.configured === true
            ? "disabled"
            : "not_configured",
      detail: typeof value.detail === "string"
        ? value.detail
        : typeof value.reason === "string"
          ? value.reason
          : typeof value.access_note === "string"
            ? value.access_note
            : null,
    }];
  });
  const rawCoverage = Array.isArray(payload.coverage) ? payload.coverage : [];
  const coverage = rawCoverage.flatMap((raw): SocialCoverageRow[] => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    if (!isPlatform(value.platform)) return [];
    const signalCount = Number(value.signal_count);
    const accountCount = Number(value.account_count);
    return [{
      platform: value.platform.toLowerCase() as SocialPlatform,
      signal_count: Number.isFinite(signalCount) ? Math.max(0, signalCount) : 0,
      account_count: Number.isFinite(accountCount) ? Math.max(0, accountCount) : 0,
      latest_posted_at: typeof value.latest_posted_at === "string" ? value.latest_posted_at : null,
      latest_acquired_at: typeof value.latest_acquired_at === "string" ? value.latest_acquired_at : null,
    }];
  });
  const generatedAt = payload.generated_at;
  const windowDays = Number(payload.window_days);
  return {
    collection: payload.collection,
    window_days: Number.isFinite(windowDays) ? Math.max(1, windowDays) : 7,
    coverage,
    providers,
    generated_at: typeof generatedAt === "string" ? generatedAt : null,
  };
}

function timestamp(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function newestSocialSignalsFirst(items: SocialSignal[]) {
  return [...items].sort((left, right) => {
    const chronology = timestamp(right.posted_at) - timestamp(left.posted_at);
    if (chronology !== 0) return chronology;
    return right.id - left.id;
  });
}

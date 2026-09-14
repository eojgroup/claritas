import SourceInvestigationLinks from "./SourceInvestigationLinks";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, BadgeCheck, CircleAlert, Eye, MessageCircle, RefreshCw, Repeat2, Search, ThumbsUp } from "lucide-react";
import {
  SOCIAL_PLATFORMS,
  fetchSocialCoverage,
  fetchSocialSignals,
  newestSocialSignalsFirst,
  type SocialCoverage,
  type SocialPlatform,
  type SocialSignal,
} from "../lib/socialApi";

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  x: "X",
  youtube: "YouTube",
  reddit: "Reddit",
  bluesky: "Bluesky",
};

function dateLabel(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function metric(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function handleLabel(signal: SocialSignal) {
  const handle = signal.posted_by.handle?.trim();
  if (!handle) return signal.posted_by.account_id;
  if (signal.platform === "reddit" || handle.startsWith("@")) return handle;
  return `@${handle}`;
}

function authorLabel(signal: SocialSignal) {
  return signal.posted_by.display_name?.trim()
    || signal.posted_by.handle?.trim()
    || signal.responsible_party.name
    || "Unknown account";
}

function authorInitial(signal: SocialSignal) {
  return authorLabel(signal).slice(0, 1).toUpperCase() || "?";
}

type SocialSignalsWorkspaceProps = {
  initialCountry?: string | null;
  eventId?: string | null;
  onOpenEvent?: (id: string) => void;
  onOpenMap?: () => void;
};

export default function SocialSignalsWorkspace({ initialCountry, eventId, onOpenEvent, onOpenMap }: SocialSignalsWorkspaceProps) {
  const [signals, setSignals] = useState<SocialSignal[]>([]);
  const [totalSignals, setTotalSignals] = useState(0);
  const [coverage, setCoverage] = useState<SocialCoverage | null>(null);
  const [platform, setPlatform] = useState<SocialPlatform | "all">("all");
  const [country, setCountry] = useState((initialCountry ?? "").toUpperCase());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const load = useCallback(async (filters?: {
    platform?: SocialPlatform | "all";
    country?: string;
    query?: string;
  }) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    const nextPlatform = filters?.platform ?? platform;
    const nextCountry = filters?.country ?? country;
    const nextQuery = filters?.query ?? query;
    try {
      const [signalsResult, coverageResult] = await Promise.allSettled([
        fetchSocialSignals({
          eventId: eventId || undefined,
          platform: nextPlatform,
          country: nextCountry || undefined,
          q: nextQuery || undefined,
          limit: 100,
        }),
        fetchSocialCoverage(),
      ]);
      if (sequence !== loadSequence.current) return;
      if (signalsResult.status === "rejected") throw signalsResult.reason;
      const response = signalsResult.value;
      setSignals(newestSocialSignalsFirst(response.items));
      setTotalSignals(response.page.total ?? response.items.length);
      setCoverage(coverageResult.status === "fulfilled" ? coverageResult.value : null);
    } catch (loadError) {
      if (sequence !== loadSequence.current) return;
      setSignals([]);
      setTotalSignals(0);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [country, platform, query, eventId]);

  useEffect(() => {
    const nextCountry = (initialCountry ?? "").toUpperCase();
    setCountry(nextCountry);
    void load({ country: nextCountry });
    // Global country changes should immediately refresh this source lens. Local
    // filter edits still submit explicitly through the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCountry, eventId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };

  const observedProviders = coverage?.coverage.filter((provider) => provider.signal_count > 0).length ?? 0;
  const latest = signals[0]?.posted_at ?? null;
  const representedAccounts = useMemo(
    () => new Set(signals.map((signal) => `${signal.platform}:${signal.posted_by.account_id}`)).size,
    [signals],
  );

  return (
    <div className="workspace-page flex min-w-0 flex-col gap-4" data-testid="social-signals-workspace">
      <section className="app-card-hero rounded-xl border-l-4 border-l-amber-500 p-4 sm:p-5" role="note" aria-label="Social signal trust notice">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
          <div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">Social posts are attributed claims, not verified facts</div>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-[color:var(--shell-muted)] sm:text-sm">
              Claritas preserves the posting account and responsible party for every message. Platform verification and engagement describe the account and reach only; corroborate important claims with independent reporting or primary evidence.
            </p>
          </div>
        </div>
      </section>

      <p className="text-xs text-[color:var(--shell-muted)]">{eventId ? "Showing posts linked by topic and time to the selected map investigation. Country scope includes the investigation location, not the posting account location." : "Country scope includes provider location and linked investigations. Posts without geographic context remain available in the global view."}</p>
      <form onSubmit={submit} className="operational-control-bar grid gap-3 rounded-xl p-4 md:grid-cols-[minmax(12rem,0.7fr)_minmax(9rem,0.35fr)_minmax(8rem,0.3fr)_auto] md:items-end">
        <label className="text-xs font-semibold text-[color:var(--shell-muted)]">
          Search posts
          <span className="mt-1 flex min-h-11 items-center gap-2 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3">
            <Search className="h-4 w-4" aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Topic, author, or phrase" className="w-full bg-transparent text-sm text-[color:var(--shell-ink)] outline-none" />
          </span>
        </label>
        <label className="text-xs font-semibold text-[color:var(--shell-muted)]">
          Platform
          <select value={platform} onChange={(event) => setPlatform(event.currentTarget.value as SocialPlatform | "all")} className="mt-1 min-h-11 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 text-sm text-[color:var(--shell-ink)]">
            <option value="all">All platforms</option>
            {SOCIAL_PLATFORMS.map((value) => <option key={value} value={value}>{PLATFORM_LABELS[value]}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-[color:var(--shell-muted)]">
          Country scope
          <input value={country} onChange={(event) => setCountry(event.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))} placeholder="Global" aria-label="Country scope, two-letter code" className="mt-1 min-h-11 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 text-sm uppercase text-[color:var(--shell-ink)] outline-none" />
        </label>
        <button type="submit" disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[color:var(--shell-strong)] px-4 text-sm font-semibold text-[color:var(--shell-on-strong)] disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </form>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Social coverage overview">
        <div className="app-stat-card rounded-xl p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">Matching signals</div><div className="mt-1 text-2xl font-semibold">{totalSignals}</div><div className="text-xs text-[color:var(--shell-muted)]">Newest first · {signals.length} shown</div></div>
        <div className="app-stat-card rounded-xl p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">Accounts shown</div><div className="mt-1 text-2xl font-semibold">{representedAccounts}</div><div className="text-xs text-[color:var(--shell-muted)]">Attributed accounts on this page</div></div>
        <div className="app-stat-card rounded-xl p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">Sources observed</div><div className="mt-1 text-2xl font-semibold">{observedProviders}</div><div className="text-xs text-[color:var(--shell-muted)]">Posts in the last {coverage?.window_days ?? 7} days</div></div>
        <div className="app-stat-card rounded-xl p-4"><div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">Latest post</div><div className="mt-1 text-sm font-semibold">{latest ? dateLabel(latest) : "—"}</div><div className="text-xs text-[color:var(--shell-muted)]">Publisher timestamp</div></div>
      </section>

      {coverage && coverage.providers.length > 0 && (
        <section className="app-card rounded-xl p-4" aria-label="Social provider status">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--shell-muted)]">Provider coverage</div>
          {coverage.collection && <p className="mt-2 text-xs text-[color:var(--shell-muted)]">Collection: {coverage.collection.enabled && coverage.collection.schedule_enabled ? "scheduled" : "not scheduled"} · Last run: {coverage.collection.last_status ?? "never run"}{coverage.collection.last_run_at ? ` · ${dateLabel(coverage.collection.last_run_at)}` : ""}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {coverage.providers.map((provider) => {
              const observed = coverage.coverage.find((entry) => entry.platform === provider.platform);
              const status = observed?.latest_acquired_at
                ? `last received ${dateLabel(observed.latest_acquired_at)}`
                : provider.available
                  ? "ready · no retained posts"
                  : provider.status.replace(/_/g, " ");
              return (
                <span key={provider.platform} title={provider.detail ?? undefined} className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1.5 text-xs text-[color:var(--shell-muted)]">
                  <strong className="text-[color:var(--shell-ink)]">{PLATFORM_LABELS[provider.platform]}</strong> · {status}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {error && <section className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-600" role="alert">{error}</section>}

      <section className="grid min-w-0 gap-3" aria-label="Social signal stream" aria-busy={loading}>
        {loading && signals.length === 0 && <div className="app-card grid min-h-48 place-items-center rounded-xl text-sm text-[color:var(--shell-muted)]"><span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Loading social signals…</span></div>}
        {!loading && !error && signals.length === 0 && <div className="app-card grid min-h-48 place-items-center rounded-xl p-6 text-center"><div><div className="font-semibold">No social signals in this scope</div><p className="mt-1 text-sm text-[color:var(--shell-muted)]">Clear filters or ask an administrator to configure and run a provider.</p></div></div>}
        {signals.map((signal) => (
          <article key={`${signal.platform}-${signal.id}`} className="app-card rounded-xl p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(12rem,0.34fr)_minmax(20rem,1fr)_auto]">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:var(--shell-strong)] text-sm font-bold text-[color:var(--shell-on-strong)]" aria-hidden="true">{authorInitial(signal)}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{authorLabel(signal)}</div>
                  <div className="truncate text-xs text-[color:var(--shell-muted)]">{handleLabel(signal)}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[color:var(--shell-muted)]">
                    <span>{PLATFORM_LABELS[signal.platform]}</span>
                    {signal.posted_by.platform_verified && <span title="Platform account badge; this does not verify the post or establish identity"><BadgeCheck className="inline h-3.5 w-3.5" /> platform badge</span>}
                  </div>
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                  <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-amber-600">Unverified social claim</span>
                  {signal.country_iso2 && <span className="rounded-full border border-[color:var(--shell-border)] px-2 py-1 text-[color:var(--shell-muted)]">{signal.country_iso2}</span>}
                </div>
                {signal.title && <h3 className="mt-3 text-base font-semibold">{signal.title}</h3>}
                {(!signal.title || signal.title.trim() !== signal.text.trim()) && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[color:var(--shell-ink)]">{signal.text}</p>}
                <div className="mt-3 rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-3 text-xs leading-5 text-[color:var(--shell-muted)]">
                  <strong className="text-[color:var(--shell-ink)]">Responsible party:</strong> {signal.responsible_party.name} ({signal.responsible_party.type.replace(/_/g, " ")}). Claritas has not independently verified this message.
                </div>
              </div>

              <div className="flex min-w-40 flex-col gap-3 text-xs text-[color:var(--shell-muted)] lg:items-end">
                <time dateTime={signal.posted_at} className="font-medium text-[color:var(--shell-ink)]">{dateLabel(signal.posted_at)}</time>
                <div className="flex flex-wrap gap-3" aria-label="Platform engagement at acquisition">
                  {signal.platform === "reddit" ? <>
                    <span title="Reddit score"><ThumbsUp className="inline h-3.5 w-3.5" /> {metric(signal.engagement.score)}</span>
                    <span title="Comments"><MessageCircle className="inline h-3.5 w-3.5" /> {metric(signal.engagement.comments)}</span>
                  </> : signal.platform === "youtube" ? <>
                    <span title="Likes"><ThumbsUp className="inline h-3.5 w-3.5" /> {metric(signal.engagement.likes)}</span>
                    <span title="Comments"><MessageCircle className="inline h-3.5 w-3.5" /> {metric(signal.engagement.comments)}</span>
                    <span title="Views"><Eye className="inline h-3.5 w-3.5" /> {metric(signal.engagement.views)}</span>
                  </> : <>
                    <span title="Likes"><ThumbsUp className="inline h-3.5 w-3.5" /> {metric(signal.engagement.likes)}</span>
                    <span title="Replies"><MessageCircle className="inline h-3.5 w-3.5" /> {metric(signal.engagement.replies)}</span>
                    <span title="Reposts"><Repeat2 className="inline h-3.5 w-3.5" /> {metric(signal.engagement.reposts)}</span>
                  </>}
                </div>
                <a href={signal.url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[color:var(--shell-border)] px-3 font-semibold text-[color:var(--shell-ink)] hover:border-[color:var(--shell-ink)]">
                  Open original <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
            <SourceInvestigationLinks links={signal.linked_events} onOpenEvent={onOpenEvent} onOpenMap={onOpenMap} />
          </article>
        ))}
      </section>
    </div>
  );
}

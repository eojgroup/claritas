import { describe, expect, it, vi } from "vitest";
import {
  fetchSocialCoverage,
  fetchSocialSignals,
  newestSocialSignalsFirst,
  type SocialSignal,
} from "./socialApi";

function signal(id: number, postedAt: string): SocialSignal {
  return {
    id,
    platform: "bluesky",
    content_type: "social_post",
    signal_nature: "claim",
    verification_status: "unverified",
    is_fact: false,
    text: `Signal ${id}`,
    title: null,
    url: `https://example.com/${id}`,
    posted_at: postedAt,
    acquired_at: "2026-09-07T12:00:00Z",
    language_code: "en",
    country_iso2: null,
    engagement: { likes: 0, replies: 0, reposts: 0, views: null },
    posted_by: {
      account_id: "did:example:claritas",
      handle: "claritas.example",
      display_name: "Claritas",
      profile_url: null,
      avatar_url: null,
      platform_verified: false,
    },
    responsible_party: {
      name: "Claritas",
      account_id: "did:example:claritas",
      type: "account_holder",
      attribution_basis: "platform_account",
    },
    credibility: {
      tier: "unverified_social",
      score: null,
      platform_verified_account: false,
      rationale: "Social posts are unverified claims.",
    },
    warning: "Unverified social signal",
    payload_metadata: null,
  };
}

describe("social API presentation contract", () => {
  it("orders timestamps by their instant rather than lexical offset text", () => {
    const ordered = newestSocialSignalsFirst([
      signal(1, "2026-09-07T11:30:00+02:00"),
      signal(2, "2026-09-07T10:00:00Z"),
      signal(3, "invalid"),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([2, 1, 3]);
  });

  it("sends explicit filters and retains the server paging contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [signal(4, "2026-09-07T10:00:00Z")],
      count: 1,
      page: { limit: 25, offset: 0, total: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchSocialSignals({ platform: "bluesky", country: "de", q: "rail", limit: 25, eventId: "selected-investigation" });
    expect(response.page.total).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/social/signals?limit=25&offset=0&platform=bluesky&country=DE&q=rail&eventId=selected-investigation",
      { credentials: "include" },
    );
    vi.unstubAllGlobals();
  });

  it("parses the deployed coverage contract without exposing credential values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      window_days: 7,
      coverage: [{ platform: "bluesky", signal_count: 4, account_count: 3, latest_posted_at: "2026-09-07T08:30:00Z", latest_acquired_at: "2026-09-07T08:31:00Z" }],
      providers: [{ id: "x", enabled: true, configured: false, available: false, access_note: "Bearer token required" }],
    }), { status: 200, headers: { "content-type": "application/json" } })));
    const coverage = await fetchSocialCoverage();
    expect(coverage.providers[0]).toMatchObject({ platform: "x", configured: false, detail: "Bearer token required" });
    expect(coverage.coverage[0]).toMatchObject({ platform: "bluesky", signal_count: 4, account_count: 3 });
    vi.unstubAllGlobals();
  });
});

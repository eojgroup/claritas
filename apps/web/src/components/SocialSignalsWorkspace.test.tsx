// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SocialSignalsWorkspace from "./SocialSignalsWorkspace";
import { fetchSocialCoverage, fetchSocialSignals, type SocialSignal } from "../lib/socialApi";

vi.mock("../lib/socialApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/socialApi")>();
  return {
    ...original,
    fetchSocialCoverage: vi.fn(),
    fetchSocialSignals: vi.fn(),
  };
});

const example: SocialSignal = {
  id: 7,
  platform: "x",
  content_type: "social_post",
  signal_nature: "claim",
  verification_status: "unverified",
  is_fact: false,
  text: "Account claims that the port is temporarily closed.",
  title: null,
  url: "https://x.com/example/status/7",
  posted_at: "2026-09-07T08:30:00Z",
  acquired_at: "2026-09-07T08:31:00Z",
  language_code: "en",
  country_iso2: "DE",
  engagement: { likes: 4, replies: 1, reposts: 2, views: 100 },
  posted_by: {
    account_id: "account-7",
    handle: "portwatch",
    display_name: "Port Watch",
    profile_url: "https://x.com/portwatch",
    avatar_url: null,
    platform_verified: true,
  },
  responsible_party: {
    name: "Port Watch",
    account_id: "account-7",
    type: "account_holder",
    attribution_basis: "platform_account",
  },
  credibility: {
    tier: "unverified_social",
    score: null,
    platform_verified_account: true,
    rationale: "Platform identity does not establish truth.",
  },
  warning: "Unverified social signal",
  payload_metadata: null,
};

describe("SocialSignalsWorkspace", () => {
  it("follows the map investigation when the selected event changes", async () => {
    const { rerender } = render(<SocialSignalsWorkspace initialCountry="SE" eventId="first" />);
    await waitFor(() => expect(fetchSocialSignals).toHaveBeenLastCalledWith(expect.objectContaining({ country: "SE", eventId: "first" })));
    rerender(<SocialSignalsWorkspace initialCountry="SE" eventId="second" />);
    await waitFor(() => expect(fetchSocialSignals).toHaveBeenLastCalledWith(expect.objectContaining({ country: "SE", eventId: "second" })));
  });
  beforeEach(() => {
    vi.mocked(fetchSocialSignals).mockResolvedValue({
      items: [example],
      count: 1,
      page: { limit: 100, offset: 0, total: 1 },
    });
    vi.mocked(fetchSocialCoverage).mockResolvedValue({
      window_days: 7,
      coverage: [{ platform: "x", signal_count: 1, account_count: 1, latest_posted_at: example.posted_at, latest_acquired_at: example.acquired_at }],
      providers: [{ platform: "x", enabled: true, configured: true, available: true, status: "available", detail: null }],
      generated_at: "2026-09-07T08:32:00Z",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps author responsibility and the unverified boundary visible", async () => {
    render(<SocialSignalsWorkspace initialCountry="DE" />);
    expect(screen.getByText(/Social posts are attributed claims, not verified facts/i)).toBeTruthy();
    expect(await screen.findByText(example.text)).toBeTruthy();
    expect(screen.getByText("Port Watch")).toBeTruthy();
    expect(screen.getByText("@portwatch")).toBeTruthy();
    expect(screen.getByText(/Responsible party:/i)).toBeTruthy();
    expect(screen.getAllByText(/Unverified social claim/i).length).toBeGreaterThan(0);
    expect(screen.getByTitle(/does not verify the post/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open original/i }).getAttribute("href")).toBe(example.url);
  });

  it("renders Reddit attribution and provider-specific engagement without inventing an @ handle", async () => {
    vi.mocked(fetchSocialSignals).mockResolvedValue({
      items: [{
        ...example,
        id: 8,
        platform: "reddit",
        title: "Airport report",
        text: "Flights may be delayed.",
        posted_by: { ...example.posted_by, handle: "u/witness_account", platform_verified: false },
        engagement: { score: 17, comments: 6, upvote_ratio: 0.8 },
      }],
      count: 1,
      page: { limit: 100, offset: 0, total: 1 },
    });
    render(<SocialSignalsWorkspace />);

    expect(await screen.findByText("u/witness_account")).toBeTruthy();
    expect(screen.queryByText("@u/witness_account")).toBeNull();
    expect(screen.getByTitle("Reddit score").textContent).toContain("17");
    expect(screen.getByTitle("Comments").textContent).toContain("6");
  });
});

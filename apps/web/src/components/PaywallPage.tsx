import type { AuthUser, BillingAccessState } from "../lib/api";

type PaywallPageProps = {
  user: AuthUser;
  billing: BillingAccessState;
  onRefresh: () => void;
  onSignOut: () => void;
  refreshing: boolean;
  signingOut: boolean;
};

function reasonLabel(reason: BillingAccessState["reason"]): string {
  if (reason === "no_subscription") return "No active subscription";
  if (reason === "subscription_expired") return "Subscription expired";
  if (reason === "subscription_inactive") return "Subscription inactive";
  if (reason === "trialing_subscription") return "Trial access";
  if (reason === "grace_period") return "Grace period";
  if (reason === "active_subscription") return "Active subscription";
  if (reason === "admin_override") return "Admin override";
  return "Access managed by billing";
}

export default function PaywallPage({
  user,
  billing,
  onRefresh,
  onSignOut,
  refreshing,
  signingOut,
}: PaywallPageProps) {
  const subscription = billing.subscription;

  return (
    <div className="min-h-screen bg-[color:var(--shell-bg)] text-[color:var(--shell-ink)]">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-6 shadow-sm sm:p-8">
          <div className="text-xs uppercase tracking-[0.32em] text-[color:var(--shell-muted)]">
            Payment required
          </div>
          <h1
            className="mt-3 text-3xl font-semibold text-[color:var(--shell-ink)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Activate access to Claritas
          </h1>
          <p className="mt-3 text-sm text-[color:var(--shell-muted)]">
            You are signed in as {user.email ?? user.display_name ?? `user #${user.id}`}, but this account does not
            currently have paid access to the application data endpoints.
          </p>

          <div className="mt-5 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-4 text-sm">
            <div className="font-semibold text-[color:var(--shell-ink)]">Status: {reasonLabel(billing.reason)}</div>
            <div className="mt-1 text-[color:var(--shell-muted)]">
              {subscription
                ? `Plan: ${subscription.plan.name} (${subscription.plan.code}) · Subscription: ${subscription.status}`
                : "No subscription is currently associated with this account."}
            </div>
            {subscription?.current_period_end && (
              <div className="mt-1 text-[color:var(--shell-muted)]">
                Period end: {new Date(subscription.current_period_end).toLocaleString()}
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {billing.checkout_url ? (
              <a
                href={billing.checkout_url}
                className="inline-flex items-center rounded-full border border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white"
              >
                Subscribe now
              </a>
            ) : (
              <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">
                Checkout URL not configured
              </span>
            )}
            {billing.portal_url && (
              <a
                href={billing.portal_url}
                className="inline-flex items-center rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-ink)]"
              >
                Manage billing
              </a>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-ink)] disabled:opacity-50"
            >
              {refreshing ? "Checking…" : "I have paid, refresh"}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              disabled={signingOut}
              className="inline-flex items-center rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--shell-muted)] disabled:opacity-50"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

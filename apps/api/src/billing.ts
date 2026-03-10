import { query } from "./db";

export type BillingSubscriptionSnapshot = {
  id: number;
  status: string;
  provider: string;
  started_at: string;
  current_period_end: string | null;
  canceled_at: string | null;
  plan: {
    id: number;
    code: string;
    name: string;
    price_cents: number;
    currency: string;
    interval_unit: string;
  };
};

export type BillingAccessReason =
  | "paywall_disabled"
  | "admin_override"
  | "active_subscription"
  | "trialing_subscription"
  | "grace_period"
  | "subscription_expired"
  | "subscription_inactive"
  | "no_subscription";

export type BillingAccessState = {
  paywall_enabled: boolean;
  has_access: boolean;
  reason: BillingAccessReason;
  checkout_url: string | null;
  portal_url: string | null;
  subscription: BillingSubscriptionSnapshot | null;
};

type BillingSubscriptionRow = {
  id: number;
  status: string;
  provider: string;
  started_at: string;
  current_period_end: string | null;
  canceled_at: string | null;
  plan_id: number;
  plan_code: string;
  plan_name: string;
  price_cents: number;
  currency: string;
  interval_unit: string;
};

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

function asCleanUrl(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = optionalEnv(name);
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return fallback;
}

function getBypassRoles(): string[] {
  return (optionalEnv("PAYWALL_BYPASS_ROLES") || "admin")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function isPaywallEnabled(): boolean {
  return parseBooleanEnv("PAYWALL_ENABLED", true);
}

export function getBillingPublicUrls(): { checkout_url: string | null; portal_url: string | null } {
  return {
    checkout_url: asCleanUrl(optionalEnv("BILLING_CHECKOUT_URL")),
    portal_url: asCleanUrl(optionalEnv("BILLING_PORTAL_URL")),
  };
}

function toSubscription(row: BillingSubscriptionRow): BillingSubscriptionSnapshot {
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    started_at: row.started_at,
    current_period_end: row.current_period_end,
    canceled_at: row.canceled_at,
    plan: {
      id: row.plan_id,
      code: row.plan_code,
      name: row.plan_name,
      price_cents: row.price_cents,
      currency: row.currency,
      interval_unit: row.interval_unit,
    },
  };
}

function hasBypassRole(roles: string[]): boolean {
  const bypassRoles = new Set(getBypassRoles());
  return roles.some((role) => bypassRoles.has(role.trim().toLowerCase()));
}

function statusAllowsAccess(status: string): boolean {
  return status === "active" || status === "trialing" || status === "grace_period";
}

function mapInactiveReason(status: string): BillingAccessReason {
  if (status === "active" || status === "trialing" || status === "grace_period") {
    return "subscription_expired";
  }
  return "subscription_inactive";
}

function mapActiveReason(status: string): BillingAccessReason {
  if (status === "trialing") return "trialing_subscription";
  if (status === "grace_period") return "grace_period";
  return "active_subscription";
}

async function getLatestSubscription(userId: number): Promise<BillingSubscriptionSnapshot | null> {
  const { rows } = await query<BillingSubscriptionRow>(
    `SELECT
       bs.id,
       bs.status,
       bs.provider,
       bs.started_at,
       bs.current_period_end,
       bs.canceled_at,
       bp.id AS plan_id,
       bp.code AS plan_code,
       bp.name AS plan_name,
       bp.price_cents,
       bp.currency,
       bp.interval_unit
     FROM billing_subscription bs
     JOIN billing_plan bp ON bp.id = bs.plan_id
     WHERE bs.user_id = $1
     ORDER BY
       CASE
         WHEN bs.status IN ('active', 'trialing', 'grace_period') THEN 0
         WHEN bs.status = 'past_due' THEN 1
         ELSE 2
       END,
       COALESCE(bs.current_period_end, 'infinity'::timestamptz) DESC,
       bs.started_at DESC,
       bs.id DESC
     LIMIT 1`,
    [userId]
  );

  if (!rows[0]) return null;
  return toSubscription(rows[0]);
}

function isNotExpired(currentPeriodEnd: string | null): boolean {
  if (!currentPeriodEnd) return true;
  const parsed = Date.parse(currentPeriodEnd);
  if (Number.isNaN(parsed)) return false;
  return parsed > Date.now();
}

export async function resolveBillingAccessState(input: {
  userId: number;
  roles: string[];
}): Promise<BillingAccessState> {
  const urls = getBillingPublicUrls();

  if (!isPaywallEnabled()) {
    return {
      paywall_enabled: false,
      has_access: true,
      reason: "paywall_disabled",
      checkout_url: urls.checkout_url,
      portal_url: urls.portal_url,
      subscription: await getLatestSubscription(input.userId),
    };
  }

  if (hasBypassRole(input.roles)) {
    return {
      paywall_enabled: true,
      has_access: true,
      reason: "admin_override",
      checkout_url: urls.checkout_url,
      portal_url: urls.portal_url,
      subscription: await getLatestSubscription(input.userId),
    };
  }

  const subscription = await getLatestSubscription(input.userId);
  if (!subscription) {
    return {
      paywall_enabled: true,
      has_access: false,
      reason: "no_subscription",
      checkout_url: urls.checkout_url,
      portal_url: urls.portal_url,
      subscription: null,
    };
  }

  if (statusAllowsAccess(subscription.status) && isNotExpired(subscription.current_period_end)) {
    return {
      paywall_enabled: true,
      has_access: true,
      reason: mapActiveReason(subscription.status),
      checkout_url: urls.checkout_url,
      portal_url: urls.portal_url,
      subscription,
    };
  }

  return {
    paywall_enabled: true,
    has_access: false,
    reason: mapInactiveReason(subscription.status),
    checkout_url: urls.checkout_url,
    portal_url: urls.portal_url,
    subscription,
  };
}

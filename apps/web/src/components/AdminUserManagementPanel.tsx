import { useCallback, useEffect, useMemo, useState } from "react";
import { Shield, UserCog, Users } from "lucide-react";
import {
  createAdminRole,
  fetchAdminBillingPlans,
  fetchAdminRoles,
  fetchAdminUsers,
  updateAdminUserSubscription,
  updateAdminUserRoles,
  updateAdminUserStatus,
  type AdminBillingPlan,
  type AdminRole,
  type AdminUser,
} from "../lib/api";

type RoleDraftMap = Record<number, string[]>;
type PendingMap = Record<number, boolean>;
type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "grace_period"
  | "canceled"
  | "unpaid"
  | "incomplete";
type SubscriptionDraft = {
  plan_code: string;
  status: SubscriptionStatus;
  provider: string;
  current_period_end: string;
};
type SubscriptionDraftMap = Record<number, SubscriptionDraft>;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function arrayKey(values: string[]): string {
  return sortedUnique(values).join("|");
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Date(ts).toLocaleString();
}

function toDateInputValue(value: string | null): string {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeSubscriptionStatus(value: string | null | undefined): SubscriptionStatus {
  if (
    value === "trialing" ||
    value === "active" ||
    value === "past_due" ||
    value === "grace_period" ||
    value === "canceled" ||
    value === "unpaid" ||
    value === "incomplete"
  ) {
    return value;
  }
  return "incomplete";
}

export default function AdminUserManagementPanel() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [billingPlans, setBillingPlans] = useState<AdminBillingPlan[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<RoleDraftMap>({});
  const [subscriptionDrafts, setSubscriptionDrafts] = useState<SubscriptionDraftMap>({});
  const [pendingRoleSave, setPendingRoleSave] = useState<PendingMap>({});
  const [pendingStatusSave, setPendingStatusSave] = useState<PendingMap>({});
  const [pendingSubscriptionSave, setPendingSubscriptionSave] = useState<PendingMap>({});
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [isCreatingRole, setIsCreatingRole] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [roleResp, userResp, billingPlanResp] = await Promise.all([
        fetchAdminRoles(),
        fetchAdminUsers({
          limit: 200,
          offset: 0,
          q: appliedSearch || undefined,
          role: roleFilter !== "all" ? roleFilter : undefined,
          includeInactive,
        }),
        fetchAdminBillingPlans(),
      ]);
      setRoles(roleResp);
      setBillingPlans(billingPlanResp);
      setUsers(userResp.users);
      setTotalUsers(userResp.total);
      const nextDrafts: RoleDraftMap = {};
      const nextSubscriptionDrafts: SubscriptionDraftMap = {};
      const defaultPlanCode = billingPlanResp[0]?.code || "pro";
      userResp.users.forEach((user) => {
        nextDrafts[user.id] = sortedUnique(user.roles);
        nextSubscriptionDrafts[user.id] = {
          plan_code: user.subscription?.plan.code || defaultPlanCode,
          status: normalizeSubscriptionStatus(user.subscription?.status || "incomplete"),
          provider: user.subscription?.provider || "manual",
          current_period_end: toDateInputValue(user.subscription?.current_period_end || null),
        };
      });
      setRoleDrafts(nextDrafts);
      setSubscriptionDrafts(nextSubscriptionDrafts);
    } catch (loadError) {
      setError(toErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [appliedSearch, includeInactive, roleFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const roleKeys = useMemo(() => roles.map((role) => role.key), [roles]);
  const billingPlanOptions = useMemo(
    () =>
      billingPlans.map((plan) => ({
        code: plan.code,
        label: `${plan.name} (${plan.code})`,
      })),
    [billingPlans],
  );

  const toggleRoleForUser = useCallback((userId: number, roleKey: string) => {
    setRoleDrafts((previous) => {
      const current = new Set(previous[userId] ?? []);
      if (current.has(roleKey)) current.delete(roleKey);
      else current.add(roleKey);
      return {
        ...previous,
        [userId]: Array.from(current).sort(),
      };
    });
  }, []);

  const saveUserRoles = useCallback(
    async (user: AdminUser) => {
      const draft = sortedUnique(roleDrafts[user.id] ?? []);
      setPendingRoleSave((previous) => ({ ...previous, [user.id]: true }));
      setError(null);
      setNotice(null);
      try {
        const updated = await updateAdminUserRoles(user.id, draft);
        if (updated) {
          setUsers((previous) =>
            previous.map((candidate) => (candidate.id === user.id ? updated : candidate)),
          );
          setRoleDrafts((previous) => ({
            ...previous,
            [user.id]: sortedUnique(updated.roles),
          }));
        }
        setNotice(`Updated roles for ${user.email || user.display_name || `user #${user.id}`}.`);
      } catch (saveError) {
        setError(toErrorMessage(saveError));
      } finally {
        setPendingRoleSave((previous) => ({ ...previous, [user.id]: false }));
      }
    },
    [roleDrafts],
  );

  const toggleUserStatus = useCallback(async (user: AdminUser) => {
    setPendingStatusSave((previous) => ({ ...previous, [user.id]: true }));
    setError(null);
    setNotice(null);
    try {
      const updated = await updateAdminUserStatus(user.id, !user.is_active);
      if (updated) {
        setUsers((previous) =>
          previous.map((candidate) => (candidate.id === user.id ? updated : candidate)),
        );
        setRoleDrafts((previous) => ({
          ...previous,
          [user.id]: sortedUnique(updated.roles),
        }));
      }
      setNotice(
        `${user.email || user.display_name || `user #${user.id}`} is now ${!user.is_active ? "active" : "inactive"}.`,
      );
    } catch (statusError) {
      setError(toErrorMessage(statusError));
    } finally {
      setPendingStatusSave((previous) => ({ ...previous, [user.id]: false }));
    }
  }, []);

  const updateSubscriptionDraft = useCallback(
    (userId: number, patch: Partial<SubscriptionDraft>) => {
      setSubscriptionDrafts((previous) => {
        const current = previous[userId];
        if (!current) return previous;
        return {
          ...previous,
          [userId]: {
            ...current,
            ...patch,
          },
        };
      });
    },
    [],
  );

  const saveUserSubscription = useCallback(
    async (user: AdminUser) => {
      const draft = subscriptionDrafts[user.id];
      if (!draft) return;
      if (!draft.plan_code) {
        setError("Select a billing plan before saving subscription.");
        return;
      }

      setPendingSubscriptionSave((previous) => ({ ...previous, [user.id]: true }));
      setError(null);
      setNotice(null);
      try {
        const currentPeriodEnd = draft.current_period_end
          ? new Date(`${draft.current_period_end}T23:59:59.000Z`).toISOString()
          : null;
        const updated = await updateAdminUserSubscription(user.id, {
          plan_code: draft.plan_code,
          status: draft.status,
          provider: draft.provider || "manual",
          current_period_end: currentPeriodEnd,
        });
        if (updated) {
          setUsers((previous) =>
            previous.map((candidate) => (candidate.id === user.id ? updated : candidate)),
          );
          setSubscriptionDrafts((previous) => ({
            ...previous,
            [user.id]: {
              plan_code: updated.subscription?.plan.code || draft.plan_code,
              status: normalizeSubscriptionStatus(updated.subscription?.status || draft.status),
              provider: updated.subscription?.provider || draft.provider,
              current_period_end: toDateInputValue(updated.subscription?.current_period_end || null),
            },
          }));
        }
        setNotice(`Updated subscription for ${user.email || user.display_name || `user #${user.id}`}.`);
      } catch (saveError) {
        setError(toErrorMessage(saveError));
      } finally {
        setPendingSubscriptionSave((previous) => ({ ...previous, [user.id]: false }));
      }
    },
    [subscriptionDrafts],
  );

  const handleCreateRole = useCallback(async () => {
    const key = newRoleKey.trim().toLowerCase();
    if (!key) {
      setError("Role key is required.");
      return;
    }
    setIsCreatingRole(true);
    setError(null);
    setNotice(null);
    try {
      await createAdminRole({
        key,
        description: newRoleDescription.trim() || undefined,
      });
      setNewRoleKey("");
      setNewRoleDescription("");
      await loadData();
      setNotice(`Role "${key}" created.`);
    } catch (createError) {
      setError(toErrorMessage(createError));
    } finally {
      setIsCreatingRole(false);
    }
  }, [loadData, newRoleDescription, newRoleKey]);

  return (
    <div className="admin-panel grid w-full min-w-0 max-w-full gap-3 sm:gap-4">
      <section className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
              Admin users
            </div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Manage user access, status, and role assignments
            </div>
          </div>
          <div className="ml-auto flex w-full flex-wrap items-center gap-2 text-sm sm:w-auto sm:text-xs">
            <button
              type="button"
              onClick={() => setAppliedSearch(search.trim())}
              className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1.5 text-[color:var(--shell-muted)]"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1.5 text-[color:var(--shell-muted)]"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_200px_auto]">
          <label className="text-xs text-[color:var(--shell-muted)]">
            Search user
            <input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="email or display name"
              className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
            />
          </label>
          <label className="text-xs text-[color:var(--shell-muted)]">
            Role filter
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.currentTarget.value)}
              className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
            >
              <option value="all">All roles</option>
              {roleKeys.map((roleKey) => (
                <option key={roleKey} value={roleKey}>
                  {roleKey}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-1 inline-flex items-center gap-2 text-xs text-[color:var(--shell-muted)] md:mt-5">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(event) => setIncludeInactive(event.currentTarget.checked)}
            />
            Include inactive users
          </label>
        </div>

        {error && (
          <div className="mt-3 rounded-xl border border-rose-300 bg-rose-900/30 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-3 rounded-xl border border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] px-3 py-2 text-xs text-[color:var(--shell-ink)]">
            {notice}
          </div>
        )}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-[color:var(--shell-muted)]" />
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Roles ({roles.length})
            </div>
          </div>
          <div className="space-y-2">
            {roles.map((role) => (
              <div
                key={role.key}
                className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-2"
              >
                <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                  {role.key}
                </div>
                <div className="text-xs text-[color:var(--shell-muted)]">
                  {role.description || "No description"}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                  {role.user_count} users
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3">
            <div className="mb-2 flex items-center gap-2">
              <UserCog className="h-4 w-4 text-[color:var(--shell-muted)]" />
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[color:var(--shell-muted)]">
                Add role
              </div>
            </div>
            <label className="block text-xs text-[color:var(--shell-muted)]">
              Role key
              <input
                value={newRoleKey}
                onChange={(event) => setNewRoleKey(event.currentTarget.value)}
                placeholder="e.g. analyst"
                className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
              />
            </label>
            <label className="mt-2 block text-xs text-[color:var(--shell-muted)]">
              Description
              <input
                value={newRoleDescription}
                onChange={(event) => setNewRoleDescription(event.currentTarget.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleCreateRole()}
              disabled={isCreatingRole}
              className="mt-3 w-full rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-on-strong)] disabled:opacity-50 sm:w-auto sm:text-xs"
            >
              {isCreatingRole ? "Creating…" : "Create role"}
            </button>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-[color:var(--shell-muted)]" />
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Users ({totalUsers})
            </div>
            {isLoading && (
              <div className="ml-auto text-xs text-[color:var(--shell-muted)]">Loading…</div>
            )}
          </div>

          <div className="max-h-[620px] overflow-y-auto space-y-2 pr-1">
            {users.length === 0 && (
              <div className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] px-3 py-2 text-xs text-[color:var(--shell-muted)]">
                No users found.
              </div>
            )}
            {users.map((user) => {
              const draftRoles = sortedUnique(roleDrafts[user.id] ?? user.roles);
              const isDirty = arrayKey(draftRoles) !== arrayKey(user.roles);
              const isSavingRoles = !!pendingRoleSave[user.id];
              const isSavingStatus = !!pendingStatusSave[user.id];
              const isSavingSubscription = !!pendingSubscriptionSave[user.id];
              const subscriptionDraft = subscriptionDrafts[user.id] ?? {
                plan_code: billingPlanOptions[0]?.code || "pro",
                status: normalizeSubscriptionStatus(user.subscription?.status || "incomplete"),
                provider: user.subscription?.provider || "manual",
                current_period_end: toDateInputValue(user.subscription?.current_period_end || null),
              };
              const userLabel = user.display_name || user.email || `User #${user.id}`;
              const subscriptionStatus = normalizeSubscriptionStatus(user.subscription?.status || "incomplete");
              return (
                <div
                  key={user.id}
                  className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 break-words text-sm font-semibold text-[color:var(--shell-ink)]">
                      {userLabel}
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        user.is_active
                          ? "border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] text-[color:var(--shell-ink)]"
                          : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface-muted)] text-[color:var(--shell-muted)]"
                      }`}
                    >
                      {user.is_active ? "Active" : "Inactive"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        subscriptionStatus === "active" || subscriptionStatus === "trialing" || subscriptionStatus === "grace_period"
                          ? "border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] text-[color:var(--shell-ink)]"
                          : "border-amber-700 bg-amber-900/40 text-amber-200"
                      }`}
                    >
                      {subscriptionStatus}
                    </span>
                    <span className="ml-auto text-xs text-[color:var(--shell-muted)]">
                      Last seen: {formatDateTime(user.last_seen_at)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[color:var(--shell-muted)]">
                    {user.email || "No email"} · Joined {formatDateTime(user.created_at)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(user.providers.length > 0 ? user.providers : ["none"]).map((provider) => (
                      <span
                        key={`${user.id}-provider-${provider}`}
                        className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] text-[color:var(--shell-muted)]"
                      >
                        {provider}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-[color:var(--shell-muted)]">
                      Billing plan
                      <select
                        value={subscriptionDraft.plan_code}
                        onChange={(event) =>
                          updateSubscriptionDraft(user.id, { plan_code: event.currentTarget.value })
                        }
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                      >
                        {billingPlanOptions.length === 0 && <option value="">No plans</option>}
                        {billingPlanOptions.map((plan) => (
                          <option key={plan.code} value={plan.code}>
                            {plan.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-[color:var(--shell-muted)]">
                      Subscription status
                      <select
                        value={subscriptionDraft.status}
                        onChange={(event) =>
                          updateSubscriptionDraft(user.id, {
                            status: normalizeSubscriptionStatus(event.currentTarget.value),
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                      >
                        {[
                          "trialing",
                          "active",
                          "past_due",
                          "grace_period",
                          "canceled",
                          "unpaid",
                          "incomplete",
                        ].map((statusValue) => (
                          <option key={statusValue} value={statusValue}>
                            {statusValue}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-[color:var(--shell-muted)]">
                      Provider
                      <input
                        value={subscriptionDraft.provider}
                        onChange={(event) =>
                          updateSubscriptionDraft(user.id, { provider: event.currentTarget.value })
                        }
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                      />
                    </label>
                    <label className="text-xs text-[color:var(--shell-muted)]">
                      Period end (optional)
                      <input
                        type="date"
                        value={subscriptionDraft.current_period_end}
                        onChange={(event) =>
                          updateSubscriptionDraft(user.id, {
                            current_period_end: event.currentTarget.value,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-2 py-1 text-sm text-[color:var(--shell-ink)]"
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1">
                    {roleKeys.map((roleKey) => {
                      const hasRole = draftRoles.includes(roleKey);
                      return (
                        <button
                          key={`${user.id}-${roleKey}`}
                          type="button"
                          onClick={() => toggleRoleForUser(user.id, roleKey)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-[0.16em] ${
                            hasRole
                              ? "border-[color:var(--signal-sky)] bg-[color:var(--signal-sky-soft)] text-[color:var(--shell-ink)]"
                              : "border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] text-[color:var(--shell-muted)]"
                          }`}
                        >
                          {roleKey}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveUserRoles(user)}
                      disabled={!isDirty || isSavingRoles}
                      className="w-full rounded-full border border-[color:var(--shell-strong)] bg-[color:var(--shell-strong)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-on-strong)] disabled:opacity-40 sm:w-auto sm:py-1 sm:text-xs"
                    >
                      {isSavingRoles ? "Saving…" : "Save roles"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveUserSubscription(user)}
                      disabled={isSavingSubscription || billingPlanOptions.length === 0}
                      className="w-full rounded-full border border-sky-600 bg-sky-900/40 px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-sky-100 disabled:opacity-40 sm:w-auto sm:py-1 sm:text-xs"
                    >
                      {isSavingSubscription ? "Saving billing…" : "Save billing"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleUserStatus(user)}
                      disabled={isSavingStatus}
                      className="w-full rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-2 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-ink)] disabled:opacity-40 sm:w-auto sm:py-1 sm:text-xs"
                    >
                      {isSavingStatus
                        ? "Updating…"
                        : user.is_active
                          ? "Deactivate user"
                          : "Activate user"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

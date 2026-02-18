import { useCallback, useEffect, useMemo, useState } from "react";
import { Shield, UserCog, Users } from "lucide-react";
import {
  createAdminRole,
  fetchAdminRoles,
  fetchAdminUsers,
  updateAdminUserRoles,
  updateAdminUserStatus,
  type AdminRole,
  type AdminUser,
} from "../lib/api";

type RoleDraftMap = Record<number, string[]>;
type PendingMap = Record<number, boolean>;

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

export default function AdminUserManagementPanel() {
  const [roles, setRoles] = useState<AdminRole[]>([]);
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
  const [pendingRoleSave, setPendingRoleSave] = useState<PendingMap>({});
  const [pendingStatusSave, setPendingStatusSave] = useState<PendingMap>({});
  const [newRoleKey, setNewRoleKey] = useState("");
  const [newRoleDescription, setNewRoleDescription] = useState("");
  const [isCreatingRole, setIsCreatingRole] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [roleResp, userResp] = await Promise.all([
        fetchAdminRoles(),
        fetchAdminUsers({
          limit: 200,
          offset: 0,
          q: appliedSearch || undefined,
          role: roleFilter !== "all" ? roleFilter : undefined,
          includeInactive,
        }),
      ]);
      setRoles(roleResp);
      setUsers(userResp.users);
      setTotalUsers(userResp.total);
      const nextDrafts: RoleDraftMap = {};
      userResp.users.forEach((user) => {
        nextDrafts[user.id] = sortedUnique(user.roles);
      });
      setRoleDrafts(nextDrafts);
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
    <div className="grid gap-4">
      <section className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--shell-muted)]">
              Admin users
            </div>
            <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
              Manage user access, status, and role assignments
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setAppliedSearch(search.trim())}
              className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)]"
            >
              Apply filters
            </button>
            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-[color:var(--shell-muted)]"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_200px_auto]">
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
          <label className="mt-5 inline-flex items-center gap-2 text-xs text-[color:var(--shell-muted)]">
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
          <div className="mt-3 rounded-xl border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-xs text-emerald-200">
            {notice}
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
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
              className="mt-3 rounded-full border border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-50"
            >
              {isCreatingRole ? "Creating…" : "Create role"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] p-4 shadow-sm">
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
              const userLabel = user.display_name || user.email || `User #${user.id}`;
              return (
                <div
                  key={user.id}
                  className="rounded-xl border border-[color:var(--shell-border)] bg-[color:var(--shell-bg)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-semibold text-[color:var(--shell-ink)]">
                      {userLabel}
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        user.is_active
                          ? "border-emerald-700 bg-emerald-900/40 text-emerald-200"
                          : "border-slate-600 bg-slate-800/40 text-slate-300"
                      }`}
                    >
                      {user.is_active ? "Active" : "Inactive"}
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
                              ? "border-emerald-700 bg-emerald-900/40 text-emerald-200"
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
                      className="rounded-full border border-[color:var(--shell-ink)] bg-[color:var(--shell-ink)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-white disabled:opacity-40"
                    >
                      {isSavingRoles ? "Saving…" : "Save roles"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleUserStatus(user)}
                      disabled={isSavingStatus}
                      className="rounded-full border border-[color:var(--shell-border)] bg-[color:var(--shell-surface)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--shell-ink)] disabled:opacity-40"
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

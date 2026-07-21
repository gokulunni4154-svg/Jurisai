// src/app/user-management/admin/page.tsx
// Admin Tooling — User & Org Management module.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, Users } from 'lucide-react';

// Same mirrored-shapes convention as src/app/observability/admin/page.tsx
// (this page's own confirmed template) — the client-side type below
// mirrors AdminUserListItem (user-management.service.ts) field-for-field,
// not imported directly, for the same reasoning that file's own comment
// gives for every other page in this project.

type UserRole = 'individual' | 'lawyer' | 'law_firm' | 'business' | 'admin' | 'support';

interface AdminUserRow {
  id: string;
  fullName: string | null;
  phone: string | null;
  firmId: string | null;
  avatarUrl: string | null;
  createdAt: string;
  email: string | null;
  role: UserRole | null;
  emailVerified: boolean | null;
  lastSignInAt: string | null;
}

interface ListUsersResponse {
  data: AdminUserRow[];
  total: number;
  limit: number;
  offset: number;
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

const ROLE_LABELS: Record<UserRole, string> = {
  individual: 'Individual',
  lawyer: 'Lawyer',
  law_firm: 'Law Firm',
  business: 'Business',
  admin: 'Admin',
  support: 'Support',
};

const PAGE_SIZE = 20;

/**
 * FLAGGED, KNOWN GAP: neither AdminUserRow (mirrored from
 * AdminUserListItem) nor AuthUserSummary currently exposes a
 * banned/suspended boolean — UserManagementService#listUsers() was never
 * built to surface ban state, only email/role/verification/last-sign-in.
 * So this page cannot conditionally show "Suspend" vs "Reactivate" per
 * row; both actions are shown for every row, gated only by whether that
 * row currently has an action in flight. If AuthUserSummary later grows a
 * `banned` field, swap this for a single toggle button per row instead.
 */
async function suspendOrReactivate(
  userId: string,
  action: 'suspend' | 'reactivate',
): Promise<void> {
  const res = await fetch(`/api/user-management/admin/users/${userId}/ban`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
}

function formatTimestamp(isoString: string | null): string {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * RolePill — same visual convention as ObservabilityAdminPage's
 * StatusPill (rounded-full, 11px, colored by variant), applied to
 * UserRole instead of run status. `null` (a role that failed to resolve
 * — see AuthUserRepository#findSummariesByIds's own documented failure
 * case) renders as a muted "—" pill rather than a colored one, same
 * "null is a display fact, not an error" convention that repository's
 * own doc comment establishes.
 */
function RolePill({ role }: { role: UserRole | null }) {
  if (role === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        —
      </span>
    );
  }

  const styles: Record<UserRole, string> = {
    admin: 'bg-violet-500/10 text-violet-600',
    support: 'bg-sky-500/10 text-sky-600',
    law_firm: 'bg-emerald-500/10 text-emerald-600',
    lawyer: 'bg-emerald-500/10 text-emerald-600',
    business: 'bg-amber-500/10 text-amber-600',
    individual: 'bg-muted text-muted-foreground',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

/**
 * GET /api/user-management/admin/users — admin view, every profile on
 * the platform, paginated and optionally searched. Role-gated
 * server-side (requireRole('admin', 'support')) inside
 * UserManagementService#listUsers — same "no client-side role check"
 * reasoning as ObservabilityAdminPage.
 *
 * FLAGGED, NEW UI beyond ObservabilityAdminPage's own template: that
 * page has no search box or pagination controls (its run history is
 * returned unfiltered, all at once). Both are added here since
 * findAllForAdmin()/listUsers() are paginated by design — a plain copy
 * of the template without them would silently drop the pagination this
 * endpoint already supports. Debounce on the search input (300ms) is a
 * new, flagged UX choice — no equivalent exists in the template to
 * match.
 */
export default function UserManagementAdminPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actioningIds, setActioningIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (search) params.set('search', search);

      const res = await fetch(`/api/user-management/admin/users?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = (await res.json()) as ListUsersResponse;
      setRows(json.data);
      setTotal(json.total);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load users.');
    } finally {
      setIsLoading(false);
    }
  }, [offset, search]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleAction = useCallback(
    async (userId: string, action: 'suspend' | 'reactivate') => {
      setActionError(null);
      setActioningIds((prev) => new Set(prev).add(userId));
      try {
        await suspendOrReactivate(userId, action);
        await loadUsers();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : `Failed to ${action} user.`,
        );
      } finally {
        setActioningIds((prev) => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
    },
    [loadUsers],
  );

  // Debounced search: reset to page 1 and commit the search term 300ms
  // after the user stops typing, rather than firing a request per
  // keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setOffset(0);
      setSearch(searchInput.trim());
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canGoPrevious = offset > 0;
  const canGoNext = offset + PAGE_SIZE < total;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-8 py-5">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-[15px] font-semibold">Users — All Accounts</h1>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Every account on the platform, with role, verification, and sign-in activity.
        </p>
        <div className="mt-4">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or phone…"
            className="w-full max-w-xs rounded-md border px-3 py-1.5 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        {actionError && (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading users…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{loadError}</p>
            <button
              onClick={loadUsers}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-muted-foreground">
            <p className="text-[13px]">No users found.</p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-muted/50 text-[12px] font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">Phone</th>
                    <th className="px-4 py-2.5">Firm</th>
                    <th className="px-4 py-2.5">Verified</th>
                    <th className="px-4 py-2.5">Last Sign-in</th>
                    <th className="px-4 py-2.5">Joined</th>
                    <th className="px-4 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-2.5">{row.fullName ?? '—'}</td>
                      <td className="px-4 py-2.5">{row.email ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <RolePill role={row.role} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{row.phone ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {row.firmId ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.emailVerified === null ? '—' : row.emailVerified ? 'Yes' : 'No'}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(row.lastSignInAt)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(row.createdAt)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {actioningIds.has(row.id) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <div className="flex gap-3">
                            <button
                              onClick={() => handleAction(row.id, 'suspend')}
                              className="text-[12px] font-medium text-red-600 hover:text-red-800"
                            >
                              Suspend
                            </button>
                            <button
                              onClick={() => handleAction(row.id, 'reactivate')}
                              className="text-[12px] font-medium text-emerald-600 hover:text-emerald-800"
                            >
                              Reactivate
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between text-[13px] text-muted-foreground">
              <span>
                Page {currentPage} of {totalPages} ({total} total)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={!canGoPrevious}
                  className="rounded-md border px-3 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  disabled={!canGoNext}
                  className="rounded-md border px-3 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
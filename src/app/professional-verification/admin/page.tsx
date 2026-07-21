// src/app/professional-verification/admin/page.tsx
// #43 — Professional account verification, admin review queue UI.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertCircle, BadgeCheck } from 'lucide-react';

// Same mirrored-shapes convention as src/app/user-management/admin/page.tsx
// and src/app/observability/admin/page.tsx — the client-side type below
// mirrors the real professional_verifications Row shape (confirmed via
// professional-verification.repository.ts) field-for-field, not imported
// directly, for the same reasoning those files' own comments give.

type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'resubmitted';

interface AdminVerificationRow {
  id: string;
  profile_id: string;
  registration_number: string;
  status: VerificationStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ListQueueResponse {
  data: AdminVerificationRow[];
  total: number;
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

const PAGE_SIZE = 20;

/**
 * FLAGGED, NEW ADDITION beyond both templates: a status filter dropdown.
 * Neither ObservabilityAdminPage (no filtering at all) nor
 * UserManagementAdminPage (search, not status filtering) has a direct
 * precedent for this. Added because GET .../admin/queue accepts
 * repeatable `status` params (confirmed via that route's own source,
 * built earlier this session) and a review queue benefits from being
 * able to see closed rows (verified/rejected) for reference, not just
 * the server's default pending/resubmitted view. "All statuses" (no
 * filter applied) reproduces the server's own default queue view.
 */
const STATUS_FILTER_OPTIONS: { label: string; value: VerificationStatus | 'all' }[] = [
  { label: 'Needs review (default)', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Resubmitted', value: 'resubmitted' },
  { label: 'Verified', value: 'verified' },
  { label: 'Rejected', value: 'rejected' },
];

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
 * StatusPill — same visual convention as ObservabilityAdminPage's
 * StatusPill / UserManagementAdminPage's RolePill (rounded-full, 11px,
 * colored by variant), applied to VerificationStatus.
 */
function StatusPill({ status }: { status: VerificationStatus }) {
  const styles: Record<VerificationStatus, string> = {
    pending: 'bg-muted text-muted-foreground',
    resubmitted: 'bg-amber-500/10 text-amber-600',
    verified: 'bg-emerald-500/10 text-emerald-600',
    rejected: 'bg-destructive/10 text-destructive',
  };

  const labels: Record<VerificationStatus, string> = {
    pending: 'Pending',
    resubmitted: 'Resubmitted',
    verified: 'Verified',
    rejected: 'Rejected',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

/**
 * Approve/reject a single verification row via the confirmed
 * POST /api/professional-verification/admin/[id]/review route (built
 * earlier this session, same session's own POST method + `{ decision }`
 * body shape).
 */
async function decideVerification(
  verificationId: string,
  decision: Extract<VerificationStatus, 'verified' | 'rejected'>,
): Promise<void> {
  const res = await fetch(`/api/professional-verification/admin/${verificationId}/review`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new Error(await extractErrorMessage(res));
}

/**
 * GET /api/professional-verification/admin/queue — admin review queue,
 * paginated and optionally status-filtered (built earlier this
 * session). Role-gated server-side (requireRole('admin') only, NOT
 * 'support' — confirmed via professional-verification.service.ts's own
 * still-open flag) inside ProfessionalVerificationService#listForReview
 * — same "no client-side role check" reasoning as both template pages.
 *
 * Shows profile_id as a raw id, not a resolved name — same reasoning
 * ObservabilityAdminPage's documentOwnerId column gives: no
 * user-lookup-by-id service has been built or verified this session, so
 * resolving it to a display name would be a guess.
 *
 * FLAGGED, NEW UI beyond both templates: Approve/Reject action buttons
 * only render for rows with status `pending` or `resubmitted` — matches
 * ProfessionalVerificationService#review()'s own confirmed restriction
 * (deciding an already-closed row throws ConflictError). Rows in
 * `verified`/`rejected` show a static "Decided" label instead, so the
 * UI doesn't offer an action the backend will reject.
 */
export default function ProfessionalVerificationAdminPage() {
  const [rows, setRows] = useState<AdminVerificationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actioningIds, setActioningIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (statusFilter !== 'all') params.set('status', statusFilter);

      const res = await fetch(`/api/professional-verification/admin/queue?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = (await res.json()) as ListQueueResponse;
      setRows(json.data);
      setTotal(json.total);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load review queue.');
    } finally {
      setIsLoading(false);
    }
  }, [offset, statusFilter]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleDecision = useCallback(
    async (verificationId: string, decision: Extract<VerificationStatus, 'verified' | 'rejected'>) => {
      setActionError(null);
      setActioningIds((prev) => new Set(prev).add(verificationId));
      try {
        await decideVerification(verificationId, decision);
        await loadQueue();
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : `Failed to ${decision === 'verified' ? 'approve' : 'reject'} verification.`,
        );
      } finally {
        setActioningIds((prev) => {
          const next = new Set(prev);
          next.delete(verificationId);
          return next;
        });
      }
    },
    [loadQueue],
  );

  const handleFilterChange = (value: VerificationStatus | 'all') => {
    setOffset(0);
    setStatusFilter(value);
  };

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canGoPrevious = offset > 0;
  const canGoNext = offset + PAGE_SIZE < total;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-8 py-5">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-[15px] font-semibold">Professional Verification — Review Queue</h1>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Approve or reject professional account verification submissions.
        </p>
        <div className="mt-4">
          <select
            value={statusFilter}
            onChange={(e) => handleFilterChange(e.target.value as VerificationStatus | 'all')}
            className="rounded-md border px-3 py-1.5 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
            <p className="text-[13px]">Loading review queue…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{loadError}</p>
            <button
              onClick={loadQueue}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-24 text-muted-foreground">
            <p className="text-[13px]">No submissions found.</p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-muted/50 text-[12px] font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Registration No.</th>
                    <th className="px-4 py-2.5">Profile</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Submitted</th>
                    <th className="px-4 py-2.5">Reviewed</th>
                    <th className="px-4 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-2.5">{row.registration_number}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {row.profile_id}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill status={row.status} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(row.created_at)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(row.reviewed_at)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {actioningIds.has(row.id) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : row.status === 'pending' || row.status === 'resubmitted' ? (
                          <div className="flex gap-3">
                            <button
                              onClick={() => handleDecision(row.id, 'verified')}
                              className="text-[12px] font-medium text-emerald-600 hover:text-emerald-800"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleDecision(row.id, 'rejected')}
                              className="text-[12px] font-medium text-red-600 hover:text-red-800"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">Decided</span>
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
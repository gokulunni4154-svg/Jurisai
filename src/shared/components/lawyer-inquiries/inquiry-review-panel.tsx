'use client';

// src/shared/components/lawyer-inquiries/inquiry-review-panel.tsx
//
// The pre-acceptance review experience, shared by the Individual Lawyer
// Terminal (/lawyer/inquiries/[id]) and the Firm Terminal
// (/firm/[firmId]/inquiries/[id]). It only ever talks to:
//   GET  /api/lawyer-inquires/[id]/review
//   GET  /api/lawyer-inquires/[id]/documents/[documentId]/access
//   POST /api/lawyer-inquires/[id]/accept | decline
// All authorization happens on the server; this component hides controls the
// server would refuse, but never relies on that. It holds no storage paths
// and no keys: a document opens through a fresh signed URL requested on click.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, CheckCircle2, Clock, FileText, Loader2 } from 'lucide-react';

type AnalysisState = 'complete' | 'processing' | 'unavailable';

interface ReviewDocument {
  id: string;
  fileName: string;
  analysisState: AnalysisState;
  report: unknown;
}

interface Review {
  inquiry: {
    id: string;
    status: 'pending' | 'accepted' | 'converted_to_case' | 'declined';
    targetProfileId: string | null;
    caseId: string | null;
    createdAt: string;
  };
  stage: 'pre_acceptance' | 'accepted';
  capacity: 'assigned_lawyer' | 'firm_reviewer' | null;
  reviewExpiresAt: string;
  canDecide: boolean;
  requiresAssignee: boolean;
  documents: ReviewDocument[];
}

interface RosterMember {
  profile_id: string;
  role: string;
  profile: { full_name?: string | null } | null;
}

interface Props {
  inquiryId: string;
  backHref: string;
  /** Set on the Firm Terminal: enables the "assign to a lawyer" picker. */
  firmId?: string;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATE_LABEL: Record<AnalysisState, { text: string; className: string }> = {
  complete: { text: 'Analysis complete', className: 'bg-emerald-500/10 text-emerald-700' },
  processing: { text: 'Analysis still processing', className: 'bg-amber-500/10 text-amber-700' },
  unavailable: { text: 'Analysis unavailable', className: 'bg-muted text-muted-foreground' },
};

function humanize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// Generic, read-only renderer for the frozen report (its shape is owned by the
// analysis modules; this panel must not assume more than "JSON").
function ReportValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  }
  if (depth > 6) return <span className="text-muted-foreground">…</span>;
  if (Array.isArray(value)) {
    return (
      <ul className="ml-4 list-disc space-y-1">
        {value.map((item, i) => (
          <li key={i}>
            <ReportValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="space-y-1.5">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <div key={k}>
          <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            {humanize(k)}
          </dt>
          <dd className="ml-3 text-[13px] text-foreground">
            <ReportValue value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function InquiryReviewPanel({ inquiryId, backHref, firmId }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null);

  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [assigneeId, setAssigneeId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/lawyer-inquires/${inquiryId}/review`, { credentials: 'include' });
      if (!res.ok) throw new Error(await errorMessage(res));
      const json = await res.json();
      setReview(json.data as Review);
    } catch (err) {
      setReview(null);
      setLoadError(err instanceof Error ? err.message : 'Could not load this inquiry.');
    } finally {
      setLoading(false);
    }
  }, [inquiryId]);

  useEffect(() => {
    load();
  }, [load]);

  // Firm accept needs a lawyer to assign: load the roster (owner/admin only).
  useEffect(() => {
    if (!firmId || !review?.requiresAssignee || !review.canDecide) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/firms/${firmId}/members/roster`, { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setRoster((json.data as RosterMember[]).filter((m) => m.role !== 'employee'));
      } catch {
        /* the picker simply stays empty; the server still enforces everything */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firmId, review?.requiresAssignee, review?.canDecide]);

  async function openDocument(documentId: string) {
    setActionError(null);
    setOpeningId(documentId);
    try {
      const res = await fetch(`/api/lawyer-inquires/${inquiryId}/documents/${documentId}/access`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const json = await res.json();
      window.open(json.data.url as string, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open this document.');
    } finally {
      setOpeningId(null);
    }
  }

  async function decide(kind: 'accept' | 'decline') {
    if (!review) return;
    if (kind === 'accept' && review.requiresAssignee && !assigneeId) {
      setActionError('Choose the lawyer this inquiry should be assigned to.');
      return;
    }
    setActionError(null);
    setBusy(kind);
    try {
      const body =
        kind === 'accept'
          ? { title: title.trim() || undefined, assigneeProfileId: review.requiresAssignee ? assigneeId : undefined }
          : { note: note.trim() || undefined };
      const res = await fetch(`/api/lawyer-inquires/${inquiryId}/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      setOutcome(kind === 'accept' ? 'accepted' : 'declined');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Could not ${kind} this inquiry.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-6">
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to inquiries
      </Link>

      {loading && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading inquiry…
        </div>
      )}

      {loadError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {outcome && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-[13px] text-emerald-700">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {outcome === 'accepted'
              ? 'Inquiry accepted. A case was created and access to its materials is now managed through the case.'
              : 'Inquiry declined. Your pre-acceptance access to its documents has ended.'}
          </span>
        </div>
      )}

      {review && !outcome && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-[19px] font-semibold text-foreground">
              {review.stage === 'pre_acceptance' ? 'Review before you decide' : 'Inquiry materials'}
            </h1>
            {review.stage === 'pre_acceptance' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[12px] font-medium text-amber-700">
                <Clock className="h-3.5 w-3.5" />
                Review access ends {formatTimestamp(review.reviewExpiresAt)}
              </span>
            )}
          </div>

          <p className="text-[12.5px] text-muted-foreground">
            Received {formatTimestamp(review.inquiry.createdAt)}.{' '}
            {review.stage === 'pre_acceptance'
              ? 'You can read only the document(s) and report attached to this inquiry. Declining ends your access.'
              : 'This inquiry was accepted; these materials stay available while you hold access to the case.'}
          </p>

          {review.documents.length === 0 && (
            <p className="rounded-md border border-border bg-card px-4 py-3 text-[13px] text-muted-foreground">
              No document is attached to this inquiry.
            </p>
          )}

          {review.documents.map((doc) => (
            <section key={doc.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <p className="truncate text-[14px] font-medium text-foreground">{doc.fileName}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${STATE_LABEL[doc.analysisState].className}`}
                  >
                    {STATE_LABEL[doc.analysisState].text}
                  </span>
                  <button
                    onClick={() => openDocument(doc.id)}
                    disabled={openingId === doc.id}
                    className="flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
                  >
                    {openingId === doc.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Open document
                  </button>
                </div>
              </div>

              {doc.analysisState === 'complete' && (
                <div className="mt-4 rounded-md bg-muted/30 p-4">
                  <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
                    AI analysis report (as sent with the inquiry)
                  </p>
                  <ReportValue value={doc.report} />
                </div>
              )}
              {doc.analysisState === 'processing' && (
                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  The analysis for this document had not finished when the inquiry was sent. You can
                  still open the document.
                </p>
              )}
              {doc.analysisState === 'unavailable' && (
                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  No analysis report is available for this document. You can still open it.
                </p>
              )}
            </section>
          ))}

          {actionError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          {review.canDecide && (
            <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
              <h2 className="text-[14px] font-semibold text-foreground">Your decision</h2>

              {review.requiresAssignee && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="assignee" className="text-[12.5px] font-medium text-foreground">
                    Assign to (required to accept for the firm)
                  </label>
                  <select
                    id="assignee"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                  >
                    <option value="">Select a lawyer…</option>
                    {roster.map((m) => (
                      <option key={m.profile_id} value={m.profile_id}>
                        {m.profile?.full_name ?? m.profile_id} ({m.role})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="case-title" className="text-[12.5px] font-medium text-foreground">
                  Case title (optional)
                </label>
                <input
                  id="case-title"
                  value={title}
                  maxLength={255}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Defaults to the document name"
                  className="rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="decline-note" className="text-[12.5px] font-medium text-foreground">
                  Note if declining (optional, private to reviewers)
                </label>
                <textarea
                  id="decline-note"
                  value={note}
                  maxLength={1000}
                  rows={2}
                  onChange={(e) => setNote(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-[13px]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => decide('accept')}
                  disabled={busy !== null}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                >
                  {busy === 'accept' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Accept
                </button>
                <button
                  onClick={() => decide('decline')}
                  disabled={busy !== null}
                  className="flex items-center gap-2 rounded-md border border-input px-4 py-2 text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
                >
                  {busy === 'decline' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Decline
                </button>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

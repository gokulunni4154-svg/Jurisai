// REAL FILE PATH: src/app/professional-verification/page.tsx
//
// LAWYER TERMINAL — MY VERIFICATION. New page, this session, per the
// "next genuinely missing Lawyer Terminal workflow" audit.
//
// AUDIT FINDINGS (full writeup in the accompanying implementation
// report):
//   - ProfessionalVerificationService/Repository/Factory (all real,
//     pre-existing, untouched by this change) already fully implement
//     getOwnVerification() and submit() — the latter handles BOTH the
//     first-time submission (no existing row -> status 'pending') and
//     resubmission-after-rejection (existing row, status 'rejected'
//     -> status 'resubmitted') in one method, per that Service's own
//     doc comment.
//   - GET/POST /api/professional-verification/me (both real,
//     pre-existing, untouched by this change) already wire that
//     Service up end-to-end: GET returns the caller's own row (or
//     `null`), POST accepts `{ registrationNumber }` and returns the
//     created/updated row.
//   - Despite that, a full-repo search this session
//     (`find src/app -iname "*verification*"`, plus a check of every
//     .tsx fetch call against /api/professional-verification/me)
//     found ZERO frontend consumers of that GET/POST pair. The ONLY
//     existing page under professional-verification/ is
//     professional-verification/admin/page.tsx — the admin review
//     queue, a completely different, already-built, out-of-scope
//     surface (admin-only, reviews OTHER people's rows). No lawyer
//     anywhere in this app has ever had a way to submit their own
//     registration number, see their own status, or resubmit after a
//     rejection.
//   - This is a genuine, common, individual-scoped gap, same class as
//     the earlier "My Profile" page gap: every lawyer (personal-org or
//     firm-org) needs a way to submit and track their own professional
//     verification. It requires no Firm Terminal or General Portal
//     functionality — ProfessionalVerificationService's own
//     authorization (requireAuthentication, then `profile_id` scoped
//     to `user.id`) already restricts getOwnVerification()/submit() to
//     "self", by construction; the admin-only surface (listForReview/
//     review) is untouched and unreachable from this page.
//
// GENUINE GAP THIS PAGE CLOSES: a real "My Verification" view + submit/
// resubmit form, wired to the existing GET/POST /api/professional-
// verification/me routes. NO Service, Repository, Factory, route, or
// migration was added or modified — this is a pure UI-layer addition
// against an already-complete backend.
//
// STYLING: matches the established Lawyer Terminal visual system —
// AppSidebar shell (same shell profile/page.tsx uses; this page is the
// second consumer, not a new one — no sidebar redesign), semantic
// tokens (border-border, bg-card, text-muted-foreground, bg-primary,
// etc.), same header/loading/error markup conventions as
// profile/page.tsx. The four-state status pill (pending/resubmitted/
// verified/rejected) mirrors professional-verification/admin/page.tsx's
// own StatusPill color convention exactly, so a lawyer and an admin see
// the same status rendered the same way.
//
// DISCOVERABILITY: linked from the AppSidebar's existing account
// dropdown (the same menu "My Profile" lives in — see that file's own
// diff), immediately below "My Profile". Not added as a new top-level
// nav item: same reasoning app-sidebar.tsx's own comment gives for "My
// Profile" — this is an "about me" action, and the account menu is
// already the established place that class of action lives. No other
// navigation changed.
//
// DELIBERATELY NOT ADDED:
//   - No admin review UI here — that already exists at
//     /professional-verification/admin and is untouched.
//   - No document/proof upload — the underlying table has no such
//     column (confirmed via its own migration: "just the number
//     itself"); this page only ever sends a single registrationNumber
//     string, matching the real API contract exactly.
//   - No editing while a decision is pending — resubmission is only
//     offered when status is 'rejected', matching submit()'s own
//     enforced transition rule (ConflictError otherwise). Attempting a
//     submit outside that rule is prevented client-side by hiding the
//     form, and would in any case be rejected server-side.

'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Loader2,
  AlertCircle,
  BadgeCheck,
  Bell,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

// Mirrors professional-verification.repository.ts's own
// `VerificationStatus` union and the real `professional_verifications`
// Row shape (confirmed via database.types.ts) field-for-field — same
// "mirrored, not imported" convention professional-verification/
// admin/page.tsx's own header comment documents, for the same reason
// (no shared client-safe types module for this table).
type VerificationStatus = 'pending' | 'verified' | 'rejected' | 'resubmitted';

interface MyVerification {
  id: string;
  profile_id: string;
  registration_number: string;
  status: VerificationStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

const MAX_REGISTRATION_NUMBER_LENGTH = 100;

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
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

// Same visual convention as professional-verification/admin/page.tsx's
// own StatusPill (rounded-full, 11px, colored by variant) — kept
// consistent so the same status reads the same way to a lawyer here
// and to an admin there.
function StatusPill({ status }: { status: VerificationStatus }) {
  const styles: Record<VerificationStatus, string> = {
    pending: 'bg-muted text-muted-foreground',
    resubmitted: 'bg-amber-500/10 text-amber-600',
    verified: 'bg-emerald-500/10 text-emerald-600',
    rejected: 'bg-destructive/10 text-destructive',
  };
  const labels: Record<VerificationStatus, string> = {
    pending: 'Pending review',
    resubmitted: 'Resubmitted, pending review',
    verified: 'Verified',
    rejected: 'Rejected',
  };
  const Icon: Record<VerificationStatus, typeof Clock> = {
    pending: Clock,
    resubmitted: RotateCcw,
    verified: CheckCircle2,
    rejected: XCircle,
  };
  const IconComponent = Icon[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${styles[status]}`}
    >
      <IconComponent className="h-3.5 w-3.5" strokeWidth={2} />
      {labels[status]}
    </span>
  );
}

export default function ProfessionalVerificationPage() {
  const [verification, setVerification] = useState<MyVerification | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [registrationNumberInput, setRegistrationNumberInput] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadVerification = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/professional-verification/me', { credentials: 'include' });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      // Real confirmed envelope: { data: verification | null } — see
      // professional-verification/me/route.ts's own GET handler.
      setVerification(json.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load your verification.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVerification();
  }, [loadVerification]);

  function validate(trimmed: string): boolean {
    if (trimmed.length === 0) {
      setFieldError('Registration number is required.');
      return false;
    }
    if (trimmed.length > MAX_REGISTRATION_NUMBER_LENGTH) {
      setFieldError(
        `Registration number cannot exceed ${MAX_REGISTRATION_NUMBER_LENGTH} characters.`,
      );
      return false;
    }
    setFieldError(null);
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(false);

    const trimmed = registrationNumberInput.trim();
    if (!validate(trimmed)) return;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/professional-verification/me', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationNumber: trimmed }),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      setVerification(json.data);
      setRegistrationNumberInput('');
      setSubmitSuccess(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Could not submit your verification.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // submit() (Service layer) only accepts a first-time submission (no
  // existing row) or a resubmission from 'rejected' — anything else
  // (pending/resubmitted/verified) throws ConflictError. The form is
  // only rendered in the two states the Service will actually accept,
  // so a caller never sees a form that would just 409.
  const canSubmit = verification === null || verification.status === 'rejected';

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="verification" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <BadgeCheck className="h-5 w-5 text-primary" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[19px] font-semibold leading-tight text-foreground">
                My Verification
              </h1>
              <p className="text-[12.5px] text-muted-foreground">
                Submit your professional registration number for manual review.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsNotificationsPanelOpen((v) => !v)}
              className="relative flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <NotificationsPanel
          isOpen={isNotificationsPanelOpen}
          onClose={() => setIsNotificationsPanelOpen(false)}
          onUnreadCountChange={setUnreadCount}
        />

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading your verification…</p>
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{loadError}</p>
              <button
                onClick={loadVerification}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-6">
              {/* Current status */}
              <div className="flex flex-col gap-4 rounded-lg border border-border bg-card px-6 py-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                    Status
                  </h2>
                  {verification ? (
                    <StatusPill status={verification.status} />
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
                      Not submitted
                    </span>
                  )}
                </div>

                {verification ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="text-[12.5px] text-muted-foreground">
                      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground/70">
                        Registration number
                      </span>
                      <span className="text-foreground">{verification.registration_number}</span>
                    </div>
                    <div className="text-[12.5px] text-muted-foreground">
                      <span className="block text-[11px] uppercase tracking-wide text-muted-foreground/70">
                        Submitted
                      </span>
                      <span className="text-foreground">
                        {formatTimestamp(verification.created_at)}
                      </span>
                    </div>
                    {verification.reviewed_at && (
                      <div className="text-[12.5px] text-muted-foreground">
                        <span className="block text-[11px] uppercase tracking-wide text-muted-foreground/70">
                          Reviewed
                        </span>
                        <span className="text-foreground">
                          {formatTimestamp(verification.reviewed_at)}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">
                    You haven&apos;t submitted a professional verification yet. Submit your
                    registration number below to get verified.
                  </p>
                )}

                {verification?.status === 'verified' && (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[12.5px] text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    Your account is verified. No further action needed.
                  </div>
                )}
                {(verification?.status === 'pending' || verification?.status === 'resubmitted') && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12.5px] text-amber-700">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    Awaiting manual review. You&apos;ll be notified once a decision is made.
                  </div>
                )}
                {verification?.status === 'rejected' && (
                  <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    Your submission was rejected. Correct your registration number below and
                    resubmit.
                  </div>
                )}
              </div>

              {/* Submit / resubmit form — only shown when the Service
                  will actually accept a write (no row yet, or rejected). */}
              {canSubmit && (
                <form
                  onSubmit={handleSubmit}
                  className="flex flex-col gap-5 rounded-lg border border-border bg-card px-6 py-5"
                >
                  <h2 className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">
                    {verification?.status === 'rejected'
                      ? 'Resubmit verification'
                      : 'Submit for verification'}
                  </h2>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="registration_number"
                      className="text-[13px] font-medium text-foreground"
                    >
                      Registration number
                    </label>
                    <input
                      id="registration_number"
                      type="text"
                      value={registrationNumberInput}
                      onChange={(e) => setRegistrationNumberInput(e.target.value)}
                      maxLength={MAX_REGISTRATION_NUMBER_LENGTH}
                      placeholder="e.g. Bar Council enrollment number"
                      className="rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
                    />
                    {fieldError ? (
                      <p className="text-[12px] text-destructive">{fieldError}</p>
                    ) : (
                      <p className="text-[12px] text-muted-foreground">
                        Reviewed manually — no external registry check is performed.
                      </p>
                    )}
                  </div>

                  {submitError && (
                    <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {submitError}
                    </div>
                  )}
                  {submitSuccess && !isSubmitting && (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[12.5px] text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      Submitted. You&apos;ll see the updated status above once reviewed.
                    </div>
                  )}

                  <div>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {isSubmitting
                        ? 'Submitting…'
                        : verification?.status === 'rejected'
                          ? 'Resubmit'
                          : 'Submit'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

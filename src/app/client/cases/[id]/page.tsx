// src/app/client/cases/[id]/page.tsx
//
// NEW FILE — Client Portal Phase 2, Client Matter / Case Workspace (per
// JurisAI_Architecture_Audit.md). Closes the exact gap client/page.tsx's
// own header flagged: "a case row links to /cases/[id], but that page
// itself is Lawyer Terminal surface with no client-authorization check
// of its own... so case rows are NOT made clickable here." This page,
// plus the client/page.tsx edit making rows link here, closes that.
//
// DELIBERATELY A NEW, DEDICATED PAGE — NOT a reuse of /cases/[id] with
// role-conditional rendering. Confirmed this session by reading the
// real /cases/[id]/page.tsx: it renders Task CRUD, a full Documents
// section (upload/remove), a Case Team section (assign/remove lawyers
// via case_access_grants), Notes, and a Timeline link — all lawyer-only
// surface per the brief's own list of controls that must never reach a
// client. Per the brief's own instruction ("Prefer a dedicated
// client-facing page... unless the existing architecture clearly
// supports safe role-specific rendering without making the code
// fragile"), bolting a client mode onto that file would mean threading
// a role check through five unrelated sections — a dedicated page is
// the safer, less fragile choice.
//
// VISUAL LANGUAGE: reuses client/page.tsx's own real, confirmed shell —
// same minimal header (wordmark + "Client Portal" label, no icon rail),
// same bg-background/bg-card/border-border/text-muted-foreground/
// font-serif tokens, same Loader2/AlertCircle/Inbox state icons, same
// formatDate/formatDateTime/statusLabel/statusBadgeClass helpers
// (duplicated here rather than extracted to a shared module — this
// project has no established shared-UI-helpers location yet, and two
// call sites doesn't meet the bar for inventing one uninstructed).
// extractErrorMessage() and the credentials: 'include' fetch convention
// are copied verbatim from client/page.tsx, same file.
//
// DATA: single fetch to GET /api/client/cases/[id] (new this task).
// Same three-states-beyond-loading/error posture as client/page.tsx:
// (1) caller isn't a 'client'-role account -> 403 generic forbidden;
// (2) caller IS 'client'-role but not yet linked to a clients row ->
// 403 with the service's own specific message, rendered as the same
// actionable "contact your firm" state client/page.tsx already has;
// (3) the case exists but isn't this client's (or doesn't exist at
// all) -> 404, rendered as a distinct "case not found" state — RLS
// deliberately does not distinguish "wrong owner" from "doesn't exist"
// (see ClientCaseService's own doc comment), so neither does this page;
// (4) success -> case detail + hearings.
//
// SCOPE, PER THE BRIEF: no documents, no notes, no messaging, no
// editing of any kind here — read-only case + hearings only. A missing
// case_number/created_at is never treated as an error, just omitted.

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, AlertCircle, Inbox, Gavel, Building2 } from 'lucide-react';

interface ClientCaseHearing {
  id: string;
  hearingDate: string;
  hearingType: string;
  courtName: string | null;
  location: string | null;
  outcome: string | null;
}

interface ClientCaseDetail {
  id: string;
  title: string;
  status: string;
  caseNumber: string | null;
  createdAt: string;
  updatedAt: string;
  firmName: string | null;
  hearings: ClientCaseHearing[];
}

function statusLabel(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'open':
    case 'pending':
      return 'bg-primary/10 text-primary';
    case 'won':
    case 'settled':
      return 'bg-emerald-500/10 text-emerald-700';
    case 'lost':
    case 'withdrawn':
      return 'bg-destructive/10 text-destructive';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function extractErrorMessage(json: unknown, fallback: string): string {
  if (json && typeof json === 'object' && 'error' in json) {
    const err = (json as { error?: { message?: string } }).error;
    if (err?.message) return err.message;
  }
  return fallback;
}

export default function ClientCaseDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<ClientCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setForbidden(false);
      setNotLinked(false);
      setNotFound(false);

      try {
        const res = await fetch(`/api/client/cases/${params.id}`, { credentials: 'include' });
        const json = await res.json().catch(() => null);

        if (cancelled) return;

        if (res.status === 404) {
          setNotFound(true);
          return;
        }

        if (res.status === 403) {
          const message = extractErrorMessage(json, '');
          if (message.toLowerCase().includes('not yet linked')) {
            setNotLinked(true);
          } else {
            setForbidden(true);
          }
          return;
        }

        if (!res.ok) {
          setError(extractErrorMessage(json, 'Something went wrong loading this case.'));
          return;
        }

        setData(json?.data ?? null);
      } catch {
        if (!cancelled) {
          setError('Something went wrong loading this case.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (params.id) {
      load();
    }
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-5 sm:px-8">
        <button
          onClick={() => router.push('/client')}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <div>
          <p className="font-serif text-[16px] leading-none text-foreground">
            {loading ? 'Loading\u2026' : data ? data.title : 'Case'}
          </p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Client Portal
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading case details\u2026</p>
          </div>
        ) : forbidden ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-24 text-muted-foreground">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">You don&apos;t have access to this page.</p>
          </div>
        ) : notLinked ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-24 text-center text-muted-foreground">
            <AlertCircle className="h-5 w-5" />
            <p className="max-w-sm text-[13px]">
              Your account isn&apos;t linked to a client record yet. Please contact your firm.
            </p>
          </div>
        ) : notFound ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-24 text-center text-muted-foreground">
            <AlertCircle className="h-5 w-5" />
            <p className="max-w-sm text-[13px]">
              This case couldn&apos;t be found, or isn&apos;t associated with your account.
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{error}</p>
          </div>
        ) : data ? (
          <div className="flex flex-col gap-8">
            {/* Case details */}
            <section>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Case details
                  </p>
                  <h1 className="font-serif text-[26px] leading-tight text-foreground">
                    {data.title}
                  </h1>
                  {data.firmName && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {data.firmName}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${statusBadgeClass(
                    data.status,
                  )}`}
                >
                  {statusLabel(data.status)}
                </span>
              </div>

              <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-card p-5 text-[13px]">
                {data.caseNumber && (
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Case number</span>
                    <span className="text-foreground">{data.caseNumber}</span>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Created</span>
                  <span className="text-foreground">{formatDate(data.createdAt)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Last updated</span>
                  <span className="text-foreground">{formatDate(data.updatedAt)}</span>
                </div>
              </div>
            </section>

            {/* Hearings */}
            <section>
              <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Hearings
              </h2>
              {data.hearings.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-muted-foreground">
                  <Inbox className="h-5 w-5" />
                  <p className="text-[13px]">No hearings on file yet.</p>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                  {data.hearings.map((h) => (
                    <div key={h.id} className="flex items-start gap-3 px-5 py-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                        <Gavel className="h-4 w-4 text-primary" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-foreground">
                          {statusLabel(h.hearingType)}
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {formatDateTime(h.hearingDate)}
                          {h.courtName ? ` \u00b7 ${h.courtName}` : ''}
                          {h.location ? ` \u00b7 ${h.location}` : ''}
                        </p>
                        {h.outcome && (
                          <p className="mt-1 text-[12px] text-foreground">
                            <span className="text-muted-foreground">Outcome: </span>
                            {h.outcome}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

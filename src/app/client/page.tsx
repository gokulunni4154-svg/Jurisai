// src/app/client/page.tsx
//
// NEW FILE — Client Portal, Client Dashboard / Client Home (Phase 1 of
// the Client / External Portal, per JurisAI_Architecture_Audit.md).
//
// ROUTE, A JUDGMENT CALL: chose bare `/client` over `/portal` or
// `/client/dashboard`, per the brief's own Step 6 instruction to
// inspect existing route conventions first rather than assume. The
// nearest real precedent, `/client-signup` (src/app/client-signup/page.tsx),
// already occupies the top-level `/client-signup` segment, and every
// other single-purpose account-scoped page in this project
// (`/lawyer`, `/profile`) sits at a bare top-level segment, not nested
// under its own sub-route. `/client` is the direct analog of `/lawyer`
// for this new actor. Deliberately NOT placed under the `(dashboard)`
// route group `/lawyer` and `/firm/[firmId]` share — that group holds
// the two INTERNAL-staff terminals; the brief's own Step 7/11
// explicitly requires the Client Portal be clearly, visibly separated
// from both, and (dashboard) is an organizational-only route group
// with no shared layout.tsx (confirmed, see (dashboard)/lawyer/page.tsx's
// own header) so nothing is technically lost by keeping this page
// alongside /cases, /documents, /hearings instead.
//
// SHELL, PER STEP 7: deliberately NOT the Lawyer/Firm Terminal's icon
// rail (Documents/Billing/Team/Observability/etc, reused verbatim
// across every internal page in this project) — that rail's entire
// button set is explicitly firm/lawyer-only surface area a client must
// never see (Step 11: Firm Settings, Team management, Observability,
// Billing administration, Lawyer workflows). This page gets its own
// minimal header instead: wordmark + "Client Portal" label, no sidebar
// at all — the smallest coherent shell for a single-page dashboard,
// per Step 7's own "create only the minimal... shell needed for this
// task" instruction. Visual TOKENS (bg-background/bg-card,
// text-muted-foreground, border-border, font-serif headings,
// rounded-md/rounded-lg, Loader2/AlertCircle/Inbox state icons) are
// still the same real design-token vocabulary every other real page in
// this project uses (see cases/page.tsx's own header) — visual
// consistency with the rest of JurisAI, without reusing the internal
// terminals' navigation.
//
// DATA: single fetch to GET /api/dashboard/client (new this task).
// Three states beyond loading/error, matching
// ClientDashboardService#getDashboard()'s own real behavior: (1) caller
// isn't a 'client'-role account at all -> 403, generic forbidden state;
// (2) caller IS 'client'-role but has no linked `clients` row yet ->
// 403 with the service's own specific message, rendered directly
// rather than the generic forbidden copy, since it's actionable
// ("contact your firm") and not a real permissions error the way (1)
// is; (3) success -> identity + cases + upcoming hearings.
//
// SCOPE, PER STEP 10: no case detail, no document list, no messaging,
// no billing, no appointment booking here — a case row links to
// /cases/[id], but that page itself is Lawyer Terminal surface with no
// client-authorization check of its own (out of scope for this task
// to touch — see final report's "Remaining Work"), so case rows are
// NOT made clickable here. Read-only summary only.

'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Inbox, Gavel, Building2, Scale } from 'lucide-react';

interface ClientRow {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
}

interface CaseRow {
  id: string;
  title: string;
  status: string;
  case_number: string | null;
  created_at: string;
  updated_at: string;
}

interface HearingRow {
  id: string;
  case_id: string;
  hearing_type: string;
  hearing_date: string;
  court_name: string | null;
  location: string | null;
}

interface DashboardData {
  client: ClientRow;
  firmName: string | null;
  cases: CaseRow[];
  upcomingHearings: HearingRow[];
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

export default function ClientPortalPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setForbidden(false);
      setNotLinked(false);

      try {
        const res = await fetch('/api/dashboard/client', { credentials: 'include' });
        const json = await res.json().catch(() => null);

        if (cancelled) return;

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
          setError(extractErrorMessage(json, 'Something went wrong loading your dashboard.'));
          return;
        }

        setData(json?.data ?? null);
      } catch {
        if (!cancelled) {
          setError('Something went wrong loading your dashboard.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Scale className="h-4 w-4 text-primary-foreground" strokeWidth={1.75} />
          </div>
          <div>
            <p className="font-serif text-[16px] leading-none text-foreground">JurisAI</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Client Portal
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading your dashboard…</p>
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
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{error}</p>
          </div>
        ) : data ? (
          <div className="flex flex-col gap-8">
            {/* Identity */}
            <section>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Welcome
              </p>
              <h1 className="font-serif text-[26px] leading-tight text-foreground">
                {data.client.full_name}
              </h1>
              {data.firmName && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {data.firmName}
                </p>
              )}
            </section>

            {/* Cases */}
            <section>
              <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Your Cases
              </h2>
              {data.cases.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-muted-foreground">
                  <Inbox className="h-5 w-5" />
                  <p className="text-[13px]">No cases on file yet.</p>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                  {data.cases.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium text-foreground">{c.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                          {c.case_number && <span>{c.case_number}</span>}
                          <span>Updated {formatDate(c.updated_at)}</span>
                        </p>
                      </div>
                      <span
                        className={`shrink-0 self-start rounded-full px-2.5 py-1 text-[11px] font-medium sm:self-auto ${statusBadgeClass(
                          c.status,
                        )}`}
                      >
                        {statusLabel(c.status)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Upcoming hearings */}
            <section>
              <h2 className="mb-3 text-[13px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Upcoming Hearings
              </h2>
              {data.upcomingHearings.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-muted-foreground">
                  <Inbox className="h-5 w-5" />
                  <p className="text-[13px]">No upcoming hearings.</p>
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                  {data.upcomingHearings.map((h) => (
                    <div key={h.id} className="flex items-center gap-3 px-5 py-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                        <Gavel className="h-4 w-4 text-primary" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-foreground">
                          {statusLabel(h.hearing_type)}
                        </p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          {formatDateTime(h.hearing_date)}
                          {h.court_name ? ` · ${h.court_name}` : ''}
                          {h.location ? ` · ${h.location}` : ''}
                        </p>
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

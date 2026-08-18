// src/app/inquiries/mine/page.tsx
// NEW FILE — General User Terminal, "My Sent Inquiries" task.
//
// AUDIT FINDING, THIS SESSION: a General User can already send an
// inquiry via the existing Contact-a-Lawyer flow
// (documents/[id]/page.tsx -> POST /api/documents/[id]/lawyer-inquires
// -> LawyerInquiryService#createInquiry()), but there was ZERO
// read-side entry point anywhere in the app for that same user to see
// what happened to it afterward — confirmed via a full-repo search this
// session (grep across src/app for "lawyer-inquir" turned up only the
// Lawyer Terminal's own My Inquiries inbox, which lists inquiries
// ASSIGNED TO the caller, not SENT BY them — a different query,
// different RLS column, different audience entirely).
//
// DATA SOURCE: GET /api/lawyer-inquires/mine (new this session) ->
// LawyerInquiryService#listMySentInquiries() (new this session) ->
// LawyerInquiryRepository#listForSenderProfile() (new this session),
// filtered on client_profile_id = the server-resolved authenticated
// caller's own id (requireAuthentication().id) — NEVER a browser-
// supplied id. lawyer_inquiries' real, live SELECT RLS already has a
// matching policy for this exact access pattern
// (lawyer_inquiries_select_client: client_profile_id = auth.uid(),
// confirmed via Supabase MCP this session) — no RLS change was needed.
//
// RESPONSE SHAPE: reuses LawyerInquiryService's existing
// LawyerInquiryListing DTO as-is (id, clientProfileId, targetProfileId,
// targetFirmId, teamId, status, documentStoragePath, analysisResult,
// createdAt) — the exact same shape the Lawyer Terminal's My Inquiries
// page already mirrors client-side. No new DTO invented.
//
// FIELDS SHOWN, ONLY WHAT GENUINELY EXISTS:
//   - status (pending / accepted / converted_to_case — the real enum;
//     'declined' is not a status, it's row deletion, per this table's
//     own migration comment, so a declined inquiry simply stops
//     appearing in this list rather than showing a "declined" badge —
//     same behavior the Lawyer Terminal page already has for its own
//     handleDecline()).
//   - createdAt (inquiry date).
//   - firm name, resolved by cross-referencing targetFirmId against
//     GET /api/lawyer-directory/firms (the SAME existing, already-
//     reused endpoint the Contact-a-Lawyer picker itself calls) — not a
//     new API, just the same firm list fetched once and turned into an
//     id -> name lookup client-side.
//   - the document filename, decoded from documentStoragePath — same
//     filenameFromStoragePath() convention already used on the Lawyer
//     Terminal's My Inquiries page. NOT a link: the inquiry row stores
//     only a storage path, not a document id, and there is no existing
//     storage-path -> document-id lookup anywhere in this codebase to
//     build one from safely (same "cannot fabricate a destination that
//     doesn't exist" posture as the assigned-lawyer note below).
//   - whether a specific lawyer has been assigned yet (targetProfileId
//     set or not) — shown as a plain state label, NOT a resolved lawyer
//     name: GET /api/profiles/[id] 403s for anyone but that profile's
//     own owner or an admin (requireOwnership(), confirmed real
//     constraint — same documented gap AppSidebar's own "Dashboard"
//     branch and documents/page.tsx's "Uploaded By" column already
//     carry), so this page cannot resolve another user's display name
//     any more than those pages could. Not worked around here.
//
// NOT INVENTED: response time, priority, estimated completion,
// probability, fees, or any status beyond the real three-value enum.
//
// SHELL: reuses the existing AppSidebar with a new `active="inquiries-mine"`
// value (deliberately distinct from the Lawyer Terminal's existing
// `active="inquiries"`/'/lawyer-inquiries' item — see app-sidebar.tsx's
// own diff for why these are kept as two separate nav entries, not one
// shared item pointed at two different destinations depending on role).

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock, FileText, Inbox, Loader2, Scale, Search } from 'lucide-react';

import { AppSidebar } from '@/shared/components/layout/app-sidebar';

// Mirrors LawyerInquiryService's own LawyerInquiryListing DTO
// field-for-field — same "mirrored, not imported" convention the
// Lawyer Terminal's own lawyer-inquiries/page.tsx already follows.
type InquiryStatus = 'pending' | 'accepted' | 'converted_to_case';

interface LawyerInquiryListing {
  id: string;
  clientProfileId: string;
  targetProfileId: string | null;
  targetFirmId: string;
  teamId: string | null;
  status: InquiryStatus;
  documentStoragePath: string;
  analysisResult: unknown;
  createdAt: string;
}

interface FirmListing {
  id: string;
  name: string;
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

function formatTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Same convention as lawyer-inquiries/page.tsx's own
// filenameFromStoragePath() helper.
function filenameFromStoragePath(path: string): string {
  const segment = path.split('/').pop() ?? path;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function StatusPill({ status }: { status: InquiryStatus }) {
  const styles: Record<InquiryStatus, string> = {
    pending: 'bg-amber-500/10 text-amber-600',
    accepted: 'bg-primary/10 text-primary',
    converted_to_case: 'bg-emerald-500/10 text-emerald-600',
  };
  const labels: Record<InquiryStatus, string> = {
    pending: 'Waiting for a response',
    accepted: 'Accepted',
    converted_to_case: 'Converted to a case',
  };
  const Icon: Record<InquiryStatus, typeof Clock> = {
    pending: Clock,
    accepted: CheckCircle2,
    converted_to_case: Scale,
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

export default function MySentInquiriesPage() {
  const router = useRouter();

  const [inquiries, setInquiries] = useState<LawyerInquiryListing[] | null>(null);
  const [firms, setFirms] = useState<FirmListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [inquiriesRes, firmsRes] = await Promise.all([
          fetch('/api/lawyer-inquires/mine', { credentials: 'include' }),
          fetch('/api/lawyer-directory/firms', { credentials: 'include' }),
        ]);

        if (!inquiriesRes.ok) throw new Error(await extractErrorMessage(inquiriesRes));

        const inquiriesJson = await inquiriesRes.json();
        if (cancelled) return;
        setInquiries(inquiriesJson.data as LawyerInquiryListing[]);

        // Firm names are a display nicety, not load-bearing — a failed
        // firms fetch degrades to showing the raw firm id below rather
        // than blocking the whole page.
        if (firmsRes.ok) {
          const firmsJson = await firmsRes.json();
          if (!cancelled) setFirms(firmsJson.data.firms as FirmListing[]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load your inquiries.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const firmNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const firm of firms) map.set(firm.id, firm.name);
    return map;
  }, [firms]);

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="inquiries-mine" />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="border-b border-border bg-background px-8 py-6">
          <h1 className="text-[22px] font-semibold leading-tight text-foreground">My Inquiries</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Inquiries you&apos;ve sent to lawyers and firms through JurisAI, and what&apos;s
            happened to them since.
          </p>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-background py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading your inquiries…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <p className="text-[13px]">{error}</p>
            </div>
          ) : !inquiries || inquiries.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background py-24 text-center">
              <Inbox className="h-5 w-5 text-muted-foreground" />
              <p className="text-[13.5px] font-medium text-foreground">
                You haven&apos;t contacted a lawyer yet.
              </p>
              <p className="max-w-sm text-[12.5px] text-muted-foreground">
                Once you reach out to a lawyer or firm about a document, you&apos;ll be able to
                track it here.
              </p>
              <button
                onClick={() => router.push('/lawyers')}
                className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground"
              >
                <Search className="h-4 w-4" />
                Find a Lawyer
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {inquiries.map((inquiry) => {
                const firmName = firmNameById.get(inquiry.targetFirmId) ?? 'A JurisAI firm';
                return (
                  <div
                    key={inquiry.id}
                    className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-foreground">
                        {firmName}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5" />
                          {filenameFromStoragePath(inquiry.documentStoragePath)}
                        </span>
                        <span>Sent {formatTimestamp(inquiry.createdAt)}</span>
                        {inquiry.targetProfileId ? (
                          <span>Assigned to a lawyer</span>
                        ) : (
                          <span>Awaiting firm assignment</span>
                        )}
                      </div>
                    </div>

                    <StatusPill status={inquiry.status} />
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

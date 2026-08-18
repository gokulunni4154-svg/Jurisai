// src/app/lawyers/page.tsx
// NEW FILE — General User Terminal, standalone Lawyer Directory task,
// per JurisAI_Architecture_Audit.md (gap B: "Directory-level entry
// point" — GET /api/lawyers existed with zero frontend consumer).
//
// ROUTE: bare `/lawyers`. Confirmed no conflict with any existing route
// this session (`find src/app -maxdepth 1 -type d` — closest neighbor is
// `/lawyer-inquiries`, a distinct existing page). No established
// "directory/listing" route convention exists elsewhere in this repo to
// follow instead, so this uses the brief's own suggested default.
//
// DATA SOURCE — READ, VERIFIED THIS SESSION, NOT INFERRED FROM THE
// FILENAME: GET /api/lawyers (src/app/api/lawyers/route.ts) delegates to
// LawyerDirectoryService#listVerifiedLawyers() (src/modules/
// lawyer-inquiries/lawyer-directory.service.ts), which already filters
// to `status = 'verified' AND role = 'lawyer'` at the repository layer
// (professional_verifications table, confirmed live schema via Supabase
// MCP this session). The response shape is exactly:
//   { data: Array<{ profileId, fullName, registrationNumber, verifiedAt }> }
// No firm name, no practice area, no location, no ranking, no
// pagination/filter params, and no rating/review/fee/availability
// fields exist anywhere in this response — none of those are rendered
// below, per the brief's explicit "do not invent" list. The route
// itself has no auth check (a deliberate, pre-existing, documented
// design — see that route's own header comment), but this PAGE is still
// only reachable by an authenticated General User: route-protection.ts's
// fail-closed PUBLIC_ROUTES denylist does not include `/lawyers`, so
// middleware.ts redirects an unauthenticated visitor to /sign-in before
// this component ever mounts — the same authentication boundary every
// other General User page (e.g. /documents, /dashboard) already relies
// on, not a new one invented for this page.
//
// CONTACT / INQUIRY BEHAVIOR — REAL ARCHITECTURE GAP, FLAGGED, NOT
// PAPERED OVER: LawyerInquiryService#createInquiry() (confirmed real
// source this session) requires an existing document the caller owns
// AND that document's completed Legal Health Score analysisId, and
// writes against a `targetFirmId` — not a bare lawyer profile id. The
// VerifiedLawyerListing rows returned by GET /api/lawyers carry no
// `firmId` at all (professional_verifications has no firm linkage;
// only firm_members does, which is a separate, unjoined table with no
// verification concept of its own — see
// LawyerDirectoryRepository#listFirmMembers()'s own doc comment,
// confirmed this session). There is therefore no existing data path
// from "a specific verified lawyer in this list" to "a specific firm
// inquiry target" without either a new join/API (out of scope — the
// brief requires zero new APIs unless truly necessary) or a new product
// decision about how a bare individual maps to a contactable target.
// Per the brief's own instruction ("If a true document-independent
// inquiry is impossible without a new product decision, DO NOT invent
// one... clearly report..."), this page does NOT fabricate a
// per-lawyer "Contact" button that can't actually reach that lawyer.
// Instead, each card's CTA and the page-level panel both route to the
// one real, already-wired entry point — /documents, where the existing
// Contact-a-Lawyer flow (documents/[id]/page.tsx, firm-and-optional-
// member picker) already lives — matching this same pattern already
// used on /dashboard's own "Need Legal Help?" panel (confirmed real
// precedent, this session, same CTA copy/destination).
//
// SHELL: reuses the existing AppSidebar (src/shared/components/layout/
// app-sidebar.tsx) with a new `active="lawyers"` value and new "Find a
// Lawyer" nav item (same file, this task) — not a new design language,
// per this project's established "one shared shell" convention (see
// dashboard/page.tsx, documents/page.tsx).

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, BadgeCheck, FileSearch, Loader2, Scale, Search } from 'lucide-react';

import { AppSidebar } from '@/shared/components/layout/app-sidebar';

// Mirrors LawyerDirectoryService's VerifiedLawyerListing DTO exactly
// (real, confirmed source this session) — camelCase, no extra fields.
interface VerifiedLawyerListing {
  profileId: string;
  fullName: string;
  registrationNumber: string;
  verifiedAt: string | null;
}

function formatVerifiedDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function FindALawyerPage() {
  const router = useRouter();

  const [lawyers, setLawyers] = useState<VerifiedLawyerListing[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/lawyers', { credentials: 'include' });
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const json = await res.json();
        if (!cancelled) setLawyers(json.data as VerifiedLawyerListing[]);
      } catch {
        if (!cancelled) {
          setError('Could not load the lawyer directory. Try again in a moment.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="lawyers" />

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="border-b border-border bg-background px-8 py-6">
          <h1 className="text-[22px] font-semibold leading-tight text-foreground">Find a Lawyer</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Browse verified legal professionals on JurisAI. You don&apos;t need a document analysis
            to look around — when you&apos;re ready to reach out, contact a lawyer directly from any
            of your documents.
          </p>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-background py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading the lawyer directory…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <p className="text-[13px]">{error}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
              <div>
                {!lawyers || lawyers.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background py-24 text-center">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    <p className="text-[13.5px] font-medium text-foreground">
                      No verified lawyers yet
                    </p>
                    <p className="max-w-sm text-[12.5px] text-muted-foreground">
                      Nobody has completed professional verification on JurisAI yet. Check back
                      soon — this list only ever shows lawyers JurisAI has actually verified.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {lawyers.map((lawyer) => {
                      const verifiedLabel = formatVerifiedDate(lawyer.verifiedAt);
                      return (
                        <div
                          key={lawyer.profileId}
                          className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">
                              {initials(lawyer.fullName)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[13.5px] font-semibold text-foreground">
                                {lawyer.fullName}
                              </p>
                              <p className="truncate text-[11.5px] text-muted-foreground">
                                Reg. No. {lawyer.registrationNumber}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 text-[11.5px] text-success">
                            <BadgeCheck className="h-3.5 w-3.5" />
                            <span>
                              Verified lawyer{verifiedLabel ? ` · since ${verifiedLabel}` : ''}
                            </span>
                          </div>

                          <button
                            onClick={() => router.push('/documents')}
                            className="mt-auto rounded-md border border-border px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                          >
                            Contact via one of your documents →
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right rail — how contact works, mirrors /dashboard's
                  existing "Need Legal Help?" panel copy/destination. */}
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-background p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Scale className="h-4 w-4 text-primary" />
                    <p className="text-[13px] font-semibold text-foreground">How contact works</p>
                  </div>
                  <p className="mb-3 text-[12.5px] text-muted-foreground">
                    JurisAI connects you with a lawyer through a specific document. Open a document
                    with a completed Legal Health Score, then use Contact a Lawyer to reach a
                    verified firm about it.
                  </p>
                  <button
                    onClick={() => router.push('/documents')}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground"
                  >
                    <FileSearch className="h-3.5 w-3.5" />
                    Go to your documents
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

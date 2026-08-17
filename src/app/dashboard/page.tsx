// src/app/dashboard/page.tsx
//
// NEW FILE — General Portal Phase 1 (General User Home / Dashboard),
// per JurisAI_Architecture_Audit.md.
//
// ROUTE: bare `/dashboard`, per the task brief's own suggested default,
// confirmed available — no existing route in this repo used this
// segment (the internal terminals live at /lawyer and /firm/[firmId],
// under the (dashboard) route group; the Client Portal lives at
// /client; General Portal is a fourth, independent surface, per the
// brief's own "General Portal ≠ Client Portal" boundary).
//
// SHELL: reuses the existing AppSidebar (src/shared/components/layout/
// app-sidebar.tsx), same as documents/page.tsx — this is a personal
// "Documents / General" surface, not a firm-management panel, so it
// gets the same shell every non-firm-admin page in this project uses,
// not a new design language (per the brief's own UI/UX section: "The
// General Portal should feel like JurisAI but should NOT look like a
// Firm Terminal admin dashboard").
//
// DATA: single fetch to GET /api/dashboard/general (new this task) for
// the aggregated summary, plus the same GET /api/profiles/me call
// documents/page.tsx and app-sidebar.tsx already make, reused here only
// for the welcome header's display name — no internal IDs are ever
// rendered.
//
// WHAT'S DELIBERATELY NOT HERE: a "Find a lawyer" / lawyer-marketplace
// section. LawyerInquiryService#createInquiry() (confirmed real source,
// this session) is document-scoped by design — it requires an existing
// document, requireOwnership() on that document, AND a completed
// analysisResult for it; there is no document-independent "just talk to
// a lawyer" flow anywhere in this codebase, and the brief explicitly
// forbids inventing one ("DO NOT invent a lawyer marketplace... First
// determine what lawyer discovery/inquiry infrastructure already
// exists"). The real flow already exists, just one level down, inside
// documents/[id]/page.tsx's "Contact Lawyer" modal (gated on that
// document's own completed Legal Health Score). The "Get Legal Help"
// section below is an honest CTA into that existing flow — "open one of
// your documents to contact a lawyer about it" — not a new inquiry
// surface of its own.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  FileText,
  Gauge,
  Inbox,
  Loader2,
  Scale,
  ShieldAlert,
  Sparkles,
  Upload,
} from 'lucide-react';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';

interface MeProfile {
  id: string;
  full_name: string | null;
}

interface DashboardData {
  documentSummary: {
    total: number;
    recentUploads7d: number;
    documentsAnalyzed: number;
    documentsWithRisks: number;
  };
  legalHealth: {
    averageScore: number | null;
    documentsScored: number;
  };
  riskSummary: {
    high: number;
    medium: number;
    low: number;
    critical: number;
    documentsWithCompletedRiskScan: number;
  };
  recommendations: Array<{
    id: string;
    title: string;
    recommendation: string;
    priority: string;
    documentId: string | null;
    documentTitle: string | null;
    createdAt: string;
  }>;
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-destructive';
}

const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-amber-500/10 text-amber-700',
  high: 'bg-orange-500/10 text-orange-700',
  critical: 'bg-destructive/10 text-destructive',
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function GeneralDashboardPage() {
  const router = useRouter();

  const [me, setMe] = useState<MeProfile | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/profiles/me', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        setMe(json.data as MeProfile);
      } catch {
        // Non-fatal — header falls back to a generic greeting.
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/dashboard/general', { credentials: 'include' });
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const json = await res.json();
        setData(json.data as DashboardData);
      } catch {
        setError('Could not load your dashboard. Try again in a moment.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const firstName = me?.full_name?.trim().split(/\s+/)[0] ?? null;
  const totalRiskFlags = data
    ? data.riskSummary.critical + data.riskSummary.high + data.riskSummary.medium + data.riskSummary.low
    : 0;

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="dashboard" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Welcome header */}
        <header className="border-b border-border bg-background px-8 py-6">
          <h1 className="text-[22px] font-semibold leading-tight text-foreground">
            {greeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Your legal documents, risks and legal health — all in one place.
          </p>
        </header>

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-background py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading your dashboard…</p>
            </div>
          ) : error || !data ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <p className="text-[13px]">{error ?? 'Something went wrong.'}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Document overview */}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <SummaryCard
                  icon={<Inbox className="h-4 w-4" />}
                  label="Total Documents"
                  value={String(data.documentSummary.total)}
                  tone="primary"
                />
                <SummaryCard
                  icon={<Upload className="h-4 w-4" />}
                  label="Uploaded (7 days)"
                  value={String(data.documentSummary.recentUploads7d)}
                  tone="success"
                />
                <SummaryCard
                  icon={<Sparkles className="h-4 w-4" />}
                  label="Documents Analyzed"
                  value={String(data.documentSummary.documentsAnalyzed)}
                  tone="primary"
                />
                <SummaryCard
                  icon={<ShieldAlert className="h-4 w-4" />}
                  label="Documents With Risks"
                  value={String(data.documentSummary.documentsWithRisks)}
                  tone={data.documentSummary.documentsWithRisks > 0 ? 'warning' : 'muted'}
                />
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
                <div className="space-y-6">
                  {/* Legal Health Score */}
                  <div className="rounded-lg border border-border bg-background p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Gauge className="h-4 w-4 text-primary" />
                      <p className="text-[14px] font-semibold text-foreground">Legal Health Score</p>
                    </div>
                    {data.legalHealth.averageScore === null ? (
                      <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
                        <p className="text-[13px] text-muted-foreground">
                          No completed Legal Health Score yet. Upload a document and run analysis to see
                          your score here.
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-end gap-4">
                        <span className={`text-[44px] font-semibold leading-none ${scoreColor(data.legalHealth.averageScore)}`}>
                          {data.legalHealth.averageScore}
                        </span>
                        <div className="pb-1">
                          <p className="text-[12.5px] text-muted-foreground">
                            Average across {data.legalHealth.documentsScored} scored document
                            {data.legalHealth.documentsScored === 1 ? '' : 's'}
                          </p>
                          <p className="text-[11.5px] text-muted-foreground/70">
                            Each document&apos;s own score is unchanged — this is a simple average, not a
                            new score.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Risk summary */}
                  <div className="rounded-lg border border-border bg-background p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-primary" />
                      <p className="text-[14px] font-semibold text-foreground">Risk Summary</p>
                    </div>
                    {data.riskSummary.documentsWithCompletedRiskScan === 0 ? (
                      <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
                        <p className="text-[13px] text-muted-foreground">
                          No completed risk scans yet. Analyze a document to see detected risks here.
                        </p>
                      </div>
                    ) : totalRiskFlags === 0 ? (
                      <p className="text-[13px] text-muted-foreground">
                        No risks detected across {data.riskSummary.documentsWithCompletedRiskScan} scanned
                        document{data.riskSummary.documentsWithCompletedRiskScan === 1 ? '' : 's'}.
                      </p>
                    ) : (
                      <div className="grid grid-cols-4 gap-3">
                        <RiskStat label="Critical" value={data.riskSummary.critical} tone="critical" />
                        <RiskStat label="High" value={data.riskSummary.high} tone="high" />
                        <RiskStat label="Medium" value={data.riskSummary.medium} tone="medium" />
                        <RiskStat label="Low" value={data.riskSummary.low} tone="low" />
                      </div>
                    )}
                  </div>

                  {/* AI recommendations */}
                  <div className="rounded-lg border border-border bg-background p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-[14px] font-semibold text-foreground">AI Recommendations</p>
                    </div>
                    {data.recommendations.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-center">
                        <p className="text-[13px] text-muted-foreground">
                          No recommendations yet. They&apos;ll appear here once a document&apos;s analysis
                          completes.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {data.recommendations.map((rec) => (
                          <button
                            key={rec.id}
                            onClick={() => rec.documentId && router.push(`/documents/${rec.documentId}`)}
                            disabled={!rec.documentId}
                            className="flex w-full flex-col gap-1 rounded-md border border-border px-3 py-2.5 text-left hover:bg-muted/40 disabled:cursor-default disabled:hover:bg-transparent"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-[13px] font-medium text-foreground">{rec.title}</p>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_STYLES[rec.priority] ?? PRIORITY_STYLES['low']}`}
                              >
                                {rec.priority.charAt(0).toUpperCase() + rec.priority.slice(1)}
                              </span>
                            </div>
                            <p className="text-[12px] text-muted-foreground">{rec.recommendation}</p>
                            {rec.documentTitle && (
                              <p className="text-[11px] text-muted-foreground/70">{rec.documentTitle}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right rail */}
                <div className="space-y-4">
                  {/* Quick actions */}
                  <div className="rounded-lg border border-border bg-background p-4">
                    <p className="mb-3 text-[13px] font-semibold text-foreground">Quick Actions</p>
                    <div className="space-y-1">
                      <QuickAction
                        icon={<Upload className="h-4 w-4" />}
                        label="Upload Document"
                        onClick={() => router.push('/documents')}
                      />
                      <QuickAction
                        icon={<FileText className="h-4 w-4" />}
                        label="View Documents"
                        onClick={() => router.push('/documents')}
                      />
                    </div>
                  </div>

                  {/* Get legal help */}
                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Scale className="h-4 w-4 text-primary" />
                      <p className="text-[13px] font-semibold text-foreground">Need Legal Help?</p>
                    </div>
                    <p className="mb-3 text-[12.5px] text-muted-foreground">
                      Open a document with a completed Legal Health Score to contact a lawyer directly
                      about it.
                    </p>
                    <button
                      onClick={() => router.push('/documents')}
                      className="w-full rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground"
                    >
                      Find a lawyer for a document
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'primary' | 'success' | 'warning' | 'muted';
}) {
  const toneClasses: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <span className={`mb-2 flex h-8 w-8 items-center justify-center rounded-md ${toneClasses[tone]}`}>
        {icon}
      </span>
      <p className="text-[20px] font-semibold leading-tight text-foreground">{value}</p>
      <p className="text-[12px] text-muted-foreground">{label}</p>
    </div>
  );
}

function RiskStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'critical' | 'high' | 'medium' | 'low';
}) {
  const toneClasses: Record<string, string> = {
    critical: 'text-destructive',
    high: 'text-orange-700',
    medium: 'text-amber-700',
    low: 'text-muted-foreground',
  };
  return (
    <div className="rounded-md bg-muted/30 px-3 py-2 text-center">
      <p className={`text-[18px] font-semibold ${toneClasses[tone]}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] text-foreground hover:bg-muted"
    >
      <span className="text-primary">{icon}</span>
      {label}
    </button>
  );
}

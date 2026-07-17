// src/app/documents/[id]/page.tsx
// File 160 — JurisAI Frontend, Phase 3
//
// The single-document analysis view. First page to consume the Phase 2
// pipeline's frontend surface — staged to Clause Classification + Legal
// Health Score only, per this session's confirmed rollout decision.
//
// SOURCE-VERIFIED AGAINST (this session):
//   - GET  /api/documents/[id]                                    (route.ts)
//       -> { data: { document } }
//   - GET  /api/documents/[id]/analyses                            (File 68)
//       -> { data: { analyses: DocumentAnalysis[] } }, most-recent-first,
//          NO pagination (deliberate, per File 68's own comment — a
//          document is expected to accumulate a handful of runs, not
//          thousands).
//   - document-analysis.entity.ts                                  (File 63)
//       -> DocumentAnalysis shape (id, document_id, status, ...).
//   - GET/POST /api/documents/[id]/analyses/[analysisId]/classifications
//       (File 98) -> GET returns { data: ClauseClassification[] } (BARE
//       array, not nested under a key). POST returns { data:
//       <ClauseClassification> } (single object), status 201, and BLOCKS
//       until the run is 'completed' or 'failed' — runClassification()
//       is awaited inline server-side (File 98's own KNOWN LIMITATION
//       note), so this page does not poll; the POST response IS the
//       final state.
//   - clause-classification.entity.ts + .schemas.ts (Files 92/93)
//       -> ClauseClassification.result.clauses[]: { category, excerpt,
//          order, confidence }.
//   - GET/POST /api/documents/[id]/analyses/[analysisId]/legal-health-scores
//       (File 138) -> same bare-array (GET) / single-object (POST,
//       status 201) shape as classifications. Also blocks until
//       completed/failed — no polling needed here either. POST 404s
//       with a distinctly-named resource (e.g. "risk_detections") if
//       any of the FIVE upstream Phase 2 modules has no completed run
//       for this analysis yet — see OPEN GAP below, this page does not
//       pre-check those four unstaged modules itself.
//   - legal-health-score.entity.ts + .schemas.ts (Files 132/133)
//       -> LegalHealthScore.overall_score (number|null),
//          .category_scores (CategoryScores|null: risk, compliance,
//          completeness, negotiationLeverage), .result.categoryBreakdown[]
//          (category, score, weight, rationale, contributingEvidence[]).
//
// RESOLVED, Open Item (analysis creation) — Amendment, File 161.
// POST /api/documents/[id]/analyze (File 67, real source pasted this
// session) is now wired to the empty state below. Confirmed from real
// source, not assumed:
//   - No request body — the route ignores whatever the client sends.
//     One button, no analysis-type picker.
//   - Blocks server-side for up to 60s (maxDuration = 60, File 67) —
//     two sequential inline-awaited external calls (OCR, then the AI
//     analysis call). No polling; the response IS the final state.
//   - Response is { data: { extraction, analysis } }, status 201, EVEN
//     when extraction or analysis failed — File 67 deliberately does
//     not surface either as an HTTP error. `analysis` is null
//     specifically when OCR failed (no text to analyze); a non-null
//     `analysis` can itself still carry status 'failed'.
//   - This route creates a DocumentAnalysis row (File 63's entity) —
//     the same generic row File 68 lists — NOT a ClauseClassification
//     or LegalHealthScore row. It does not pre-populate either of the
//     two panels below; it only unblocks them from having somewhere to
//     attach to.
//
// RESOLVED, NEW OPEN ITEM from Amendment/File 161 — OCRExtraction's real
// entity (File 73) has now been pasted and confirmed. It DOES have an
// `error_message: string | null` field, same user-safe-message
// convention as document_analyses (File 65) — the earlier generic
// client-side placeholder has been replaced with the real field.
// `error_message` is nullable even on a 'failed' row in principle (the
// entity doesn't enforce non-null on failure), so a fallback string is
// still kept for that edge case, not removed entirely.
//
// RESOLVED — document-analysis.entity.ts (File 63) has now been pasted
// and confirmed directly. This page's local `DocumentAnalysis` subset
// (id, document_id, status, created_at, completed_at) matches the real
// entity exactly — the real entity additionally has `result`,
// `provider_used`, and `error_message`, all deliberately unused by this
// page, same pattern as the local OCRExtraction subset above. No code
// change required; confidence upgraded from inferred to source-verified.
//
// CORRECTED TRACKING NOTE — the folder structure's annotation on File 67
// ("Amendment #27 applied, not independently re-verified") was stale.
// The real File 67 pasted this session is unchanged from the Amendment
// #25 version already built against below — no Amendment #27 exists in
// its header or body. Confirmed by direct comparison, not assumed.
//
// With this, every type/response-shape dependency File 161 has on File
// 67, File 63, and File 73 is now source-verified. What is NOT verified,
// and can't be from this session alone: an actual run against the live
// app (dev server, real click-through, real timeout/failure behavior).
//
// PARTIALLY RESOLVED, Amendment/File 161 follow-up — Legal Health
// Score's prerequisite error now names the specific missing module by
// its real name (Clause Classification / Risk Detection / Missing
// Clause Detection / Compliance Detection / AI Recommendation Engine)
// instead of a raw resource string or a generic message. Built against
// confirmed real source (File 10's NotFoundError, File 21's
// handleApiError, File 138's route) — see describeMissingPrerequisite()
// above for the exact contract this depends on and why it's parsed from
// `message` rather than a structured field (there isn't one; File 10's
// toJSON() deliberately excludes `context`, and all five checks share
// the identical statusCode/code).
//
// STILL OPEN, NOT SOLVED BY THIS AMENDMENT — Risk Detection, Missing
// Clause Detection, Compliance Detection, and AI Recommendation Engine
// still have no trigger anywhere on this page (only Clause
// Classification does, alongside Legal Health Score itself). Naming the
// missing module accurately doesn't let the user act on it for those
// four — the message says so explicitly rather than implying a button
// exists. Actually closing this requires wiring those four modules in
// (the "expand to remaining 5 analysis types" option raised earlier,
// scoped down to 4 now that Clause Classification is already handled).
//
// ASSUMPTION, not yet confirmed — route placement. Follows File
// 158/159's own established assumption (client-side fetch, credentials
// included, no shared data-fetching hook) since none has been
// established elsewhere in the project.
//
// RESOLVED, Open Item #31 — CATEGORY_LABELS below is keyed snake_case
// ("negotiation_leverage") deliberately, and this is confirmed correct:
// legal-health-score.schemas.ts (Files 132/133) shows
// result.categoryBreakdown[].category is typed against the snake_case
// LegalHealthCategory enum, while the flat category_scores column is
// separately typed camelCase (categoryScoresSchema). The two structures
// genuinely use different casing for the same concept — this file
// already handles that correctly: CATEGORY_LABELS (snake_case) for the
// categoryBreakdown lookup below, and an inline camelCase check
// ("negotiationLeverage") for the category_scores grid above it. No
// change made here; confirmed against real source, not guessed.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  ListChecks,
  Scale,
  Play,
} from 'lucide-react';

// ---- Shapes, source-verified against the entities/schemas listed above ----

interface DocumentRow {
  id: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

type DocumentAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface DocumentAnalysis {
  id: string;
  document_id: string;
  status: DocumentAnalysisStatus;
  created_at: string;
  completed_at: string | null;
}

// Mirrors File 73's real OCRExtraction entity. Only the fields this page
// actually reads are declared, same convention as DocumentAnalysis above —
// `result`/`provider` are real fields on the entity too but unused here.
type OCRExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface OCRExtraction {
  status: OCRExtractionStatus;
  error_message: string | null;
}

type RunStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface ClassifiedClause {
  category: string;
  excerpt: string;
  order: number;
  confidence: number;
}

interface ClauseClassification {
  id: string;
  document_analysis_id: string;
  status: RunStatus;
  result: { clauses: ClassifiedClause[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface CategoryScores {
  risk: number;
  compliance: number;
  completeness: number;
  negotiationLeverage: number;
}

interface CategoryScoreDetail {
  category: string;
  score: number;
  weight: number;
  rationale: string;
  contributingEvidence: string[];
}

interface LegalHealthScore {
  id: string;
  document_analysis_id: string;
  status: RunStatus;
  overall_score: number | null;
  category_scores: CategoryScores | null;
  result: { overallScore: number; categoryBreakdown: CategoryScoreDetail[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  risk: 'Risk',
  compliance: 'Compliance',
  completeness: 'Completeness',
  negotiation_leverage: 'Negotiation Leverage',
};

const CLAUSE_CATEGORY_LABELS: Record<string, string> = {
  // Populated defensively — ClauseCategory's real member list (File 62)
  // was not re-pasted this session, so unknown categories fall back to
  // a formatted version of the raw string rather than an empty label.
};

function formatCategoryFallback(raw: string): string {
  return CLAUSE_CATEGORY_LABELS[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-destructive';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-destructive';
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}
// ---- New type, alongside LegalHealthScore etc. ----
type PdfExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface PdfExport {
  id: string;
  document_analysis_id: string;
  status: PdfExportStatus;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// Legal Health Score prerequisite handling (Amendment/File 161 follow-up).
//
// Confirmed against real source (File 10's NotFoundError + toJSON(), File
// 21's handleApiError, File 138's route): every missing-prerequisite case
// returns the SAME HTTP status (404) and the SAME error code
// (RESOURCE_NOT_FOUND) — NotFoundError's `context` field (which holds
// `{ resource, identifier }` distinctly) is deliberately excluded from
// toJSON() and never reaches the client. The only place the resource name
// survives is baked into `message`'s prose, via NotFoundError's own
// deterministic template: `${resource} with identifier "${identifier}"
// was not found`. This map/parser is coupled to that exact template — if
// NotFoundError's message format ever changes, this silently stops
// matching and falls back to the raw message (see the `?? message`
// fallback at the call site), not to a wrong label.
const PREREQUISITE_LABELS: Record<string, string> = {
  clause_classifications: 'Clause Classification',
  risk_detections: 'Risk Detection',
  missing_clause_detections: 'Missing Clause Detection',
  compliance_detections: 'Compliance Detection',
  ai_recommendations: 'AI Recommendation Engine',
};

// Only Clause Classification has a working trigger on this page today
// (File 160's staged rollout). The other four modules exist as routes
// (Files 106/114/122/130) but nothing on this page can run them yet —
// the message needs to say that honestly rather than implying a button
// exists somewhere.
const RUNNABLE_FROM_THIS_PAGE = new Set(['clause_classifications']);

function describeMissingPrerequisite(message: string): string | null {
  for (const [resource, label] of Object.entries(PREREQUISITE_LABELS)) {
    if (message.startsWith(`${resource} with identifier`)) {
      return RUNNABLE_FROM_THIS_PAGE.has(resource)
        ? `${label} hasn't been run for this analysis yet — run it using the button above first.`
        : `${label} hasn't been run for this analysis yet, and this page doesn't support running it directly yet. It needs to complete before a Legal Health Score can be generated.`;
    }
  }
  return null;
}

export default function DocumentAnalysisPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const documentId = params.id;

  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [classification, setClassification] = useState<ClauseClassification | null>(null);
  const [healthScore, setHealthScore] = useState<LegalHealthScore | null>(null);

  const [isRunningClassification, setIsRunningClassification] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);

  const [isRunningHealthScore, setIsRunningHealthScore] = useState(false);
  const [healthScoreError, setHealthScoreError] = useState<string | null>(null);

  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
  const [startAnalysisError, setStartAnalysisError] = useState<string | null>(null);

  const [pdfExport, setPdfExport] = useState<PdfExport | null>(null);
const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
const [isFetchingPdfUrl, setIsFetchingPdfUrl] = useState(false);
const [pdfError, setPdfError] = useState<string | null>(null);



  const loadEverything = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const docRes = await fetch(`/api/documents/${documentId}`, { credentials: 'include' });
      if (!docRes.ok) throw new Error(await extractErrorMessage(docRes));
      const docJson = await docRes.json();
      setDoc(docJson.data.document);

      const analysesRes = await fetch(`/api/documents/${documentId}/analyses`, {
        credentials: 'include',
      });
      if (!analysesRes.ok) throw new Error(await extractErrorMessage(analysesRes));
      const analysesJson = await analysesRes.json();
      const analyses: DocumentAnalysis[] = analysesJson.data.analyses;
      const latest = analyses[0] ?? null;
      setAnalysis(latest);

      if (latest) {
        const [classificationsRes, healthScoresRes] = await Promise.all([
          fetch(`/api/documents/${documentId}/analyses/${latest.id}/classifications`, {
            credentials: 'include',
          }),
          fetch(`/api/documents/${documentId}/analyses/${latest.id}/legal-health-scores`, {
            credentials: 'include',
          }),
          
        ]);
        const pdfExportsRes = await fetch(
  `/api/documents/${documentId}/analyses/${latest.id}/pdf-exports`,
  { credentials: 'include' },
);if (pdfExportsRes.ok) {
  const json = await pdfExportsRes.json();
  const runs: PdfExport[] = json.data;
  // Sorted client-side, same reasoning as Open Item #32 already applies
  // to classification/healthScore above — API ordering isn't re-verified
  // for this endpoint either.
  const sorted = [...runs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  setPdfExport(sorted.find((r) => r.status === 'completed') ?? null);
}

        if (classificationsRes.ok) {
          const json = await classificationsRes.json();
          const runs: ClauseClassification[] = json.data;
          // Sorted explicitly rather than trusting API order — File 68's
          // most-recent-first guarantee is documented for /analyses only,
          // not confirmed for this endpoint (Open Item #32).
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setClassification(sorted.find((r) => r.status === 'completed') ?? sorted[0] ?? null);
        }

        if (healthScoresRes.ok) {
          const json = await healthScoresRes.json();
          const runs: LegalHealthScore[] = json.data;
          // Same reasoning as above — see Open Item #32.
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setHealthScore(sorted.find((r) => r.status === 'completed') ?? sorted[0] ?? null);
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this document.');
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    loadEverything();
  }, [loadEverything]);

  const handleRunClassification = async () => {
    if (!analysis) return;
    setIsRunningClassification(true);
    setClassificationError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/classifications`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      setClassification(json.data);
    } catch (err) {
      setClassificationError(
        err instanceof Error ? err.message : 'Classification failed for an unknown reason.',
      );
    } finally {
      setIsRunningClassification(false);
    }
  };

  const handleRunHealthScore = async () => {
    if (!analysis) return;
    setIsRunningHealthScore(true);
    setHealthScoreError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/legal-health-scores`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const message = await extractErrorMessage(res);
        // File 138 returns 404 + RESOURCE_NOT_FOUND identically for all
        // five prerequisite checks — status/code alone can't distinguish
        // them, only the message text can (see describeMissingPrerequisite
        // above). Falls back to the raw message if it doesn't match any
        // known prerequisite shape, e.g. a genuine unrelated 404.
        throw new Error(
          res.status === 404 ? (describeMissingPrerequisite(message) ?? message) : message,
        );
      }
      const json = await res.json();
      setHealthScore(json.data);
    } catch (err) {
      setHealthScoreError(
        err instanceof Error ? err.message : 'Health score generation failed for an unknown reason.',
      );
    } finally {
      setIsRunningHealthScore(false);
    }
  };

  const handleStartAnalysis = async () => {
    setIsStartingAnalysis(true);
    setStartAnalysisError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/analyze`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      const { extraction, analysis: newAnalysis } = json.data as {
        extraction: OCRExtraction;
        analysis: DocumentAnalysis | null;
      };

      if (!newAnalysis) {
        // HTTP succeeded (201) but OCR failed server-side, per File 67's
        // documented behavior — no DocumentAnalysis row was created.
        // `!res.ok` above does not catch this. extraction.error_message
        // is OCRExtraction's real, user-safe field (File 73, same
        // convention as document_analyses' USER_SAFE_FAILURE_MESSAGES) —
        // shown directly rather than a generic client-side placeholder.
        setStartAnalysisError(
          extraction.error_message ??
            'Text extraction failed for this document, so no analysis was created. You can try again.',
        );
        return;
      }

      setAnalysis(newAnalysis);
      // A freshly-created analysis has no classification/health-score
      // runs yet — this branch only renders when `!analysis` was true,
      // so there's nothing stale to preserve.
      setClassification(null);
      setHealthScore(null);
    } catch (err) {
      setStartAnalysisError(
        err instanceof Error ? err.message : 'Analysis failed to start for an unknown reason.',
      );
    } finally {
      setIsStartingAnalysis(false);
    }
    // ---- New handler ----
const handleDownloadPdf = async () => {
  if (!analysis) return;
  setPdfError(null);

  // Gated on both prerequisites being completed — same two-check shape
  // File 168's own POST route enforces server-side; checked client-side
  // too so the button can explain *why* it's disabled rather than
  // letting the request round-trip just to 404.
  if (classification?.status !== 'completed' || healthScore?.status !== 'completed') {
    setPdfError(
      'Both Clause Classification and Legal Health Score must be completed before a PDF report can be generated.',
    );
    return;
  }

  try {
    let exportToDownload = pdfExport;

    if (!exportToDownload) {
      setIsGeneratingPdf(true);
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/pdf-exports`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      exportToDownload = json.data as PdfExport;
      setPdfExport(exportToDownload);

      if (exportToDownload.status !== 'completed') {
        throw new Error(
          exportToDownload.error_message ?? 'PDF generation failed for an unknown reason.',
        );
      }
    }

    setIsFetchingPdfUrl(true);
    const urlRes = await fetch(
      `/api/documents/${documentId}/analyses/${analysis.id}/pdf-exports/${exportToDownload.id}/download`,
      { credentials: 'include' },
    );
    if (!urlRes.ok) throw new Error(await extractErrorMessage(urlRes));
    const urlJson = await urlRes.json();
    window.open(urlJson.data.url, '_blank', 'noopener,noreferrer');
  } catch (err) {
    setPdfError(err instanceof Error ? err.message : 'Could not download the PDF report.');
  } finally {
    setIsGeneratingPdf(false);
    setIsFetchingPdfUrl(false);
  }
};
  

  return (
    <div className="flex h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-4 border-b border-border px-8 py-6">
        <button
          onClick={() => router.push('/documents')}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted/50"
          aria-label="Back to documents"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            JurisAI · Analysis
          </p>
          <h1 className="truncate font-serif text-[24px] leading-none text-foreground">
            {doc?.title ?? (isLoading ? 'Loading…' : 'Document')}
          </h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading analysis…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{loadError}</p>
            <button
              onClick={loadEverything}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : !analysis ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-24 text-muted-foreground">
            <FileText className="h-6 w-6" />
            <p className="text-[13px]">No analysis exists for this document yet.</p>
            <p className="max-w-sm text-center text-[12px]">
              This extracts the document's text and runs the first analysis
              pass. It can take up to a minute — the page will stay on this
              screen until it's done, there's no progress bar to watch.
            </p>
            <button
              onClick={handleStartAnalysis}
              disabled={isStartingAnalysis}
              className="mt-1 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStartingAnalysis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {isStartingAnalysis ? 'Analyzing… this can take up to a minute' : 'Start Analysis'}
            </button>
            {startAnalysisError && (
              <p className="max-w-sm text-center text-[12px] text-destructive">
                {startAnalysisError}
              </p>
            )}
          </div>
          // ---- New JSX section, placed above the Legal Health Score <section> ----
{analysis && (
  <div className="mx-auto flex w-full max-w-3xl items-center justify-between rounded-lg border border-border bg-card px-5 py-4">
    <div>
      <p className="text-[13px] font-medium text-foreground">PDF Report</p>
      <p className="text-[12px] text-muted-foreground">
        {pdfExport
          ? 'A report has already been generated — download it, or regenerate for the latest data.'
          : 'Combines Clause Classification and Legal Health Score into a downloadable PDF.'}
      </p>
    </div>
    <button
      onClick={handleDownloadPdf}
      disabled={isGeneratingPdf || isFetchingPdfUrl}
      className="flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
    >
      {(isGeneratingPdf || isFetchingPdfUrl) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {isGeneratingPdf
        ? 'Generating…'
        : isFetchingPdfUrl
          ? 'Preparing download…'
          : pdfExport
            ? 'Download PDF'
            : 'Generate & Download'}
    </button>
  </div>
)}
{pdfError && (
  <p className="mx-auto w-full max-w-3xl text-[12px] text-destructive">{pdfError}</p>
)}
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {/* Legal Health Score */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <Scale className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">Legal Health Score</h2>
              </div>

              {healthScore?.status === 'completed' && healthScore.overall_score !== null ? (
                <div className="flex flex-col gap-5">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-[40px] font-semibold leading-none ${scoreColor(healthScore.overall_score)}`}>
                      {healthScore.overall_score}
                    </span>
                    <span className="text-[13px] text-muted-foreground">/ 100</span>
                  </div>

                  {healthScore.category_scores && (
                    <div className="grid grid-cols-2 gap-3">
                      {(Object.entries(healthScore.category_scores) as [string, number][]).map(
                        ([key, value]) => (
                          <div key={key} className="rounded-md border border-border p-3">
                            <div className="mb-1.5 flex items-center justify-between text-[12px]">
                              <span className="text-muted-foreground">
                                {key === 'negotiationLeverage'
                                  ? 'Negotiation Leverage'
                                  : key.charAt(0).toUpperCase() + key.slice(1)}
                              </span>
                              <span className={`font-medium ${scoreColor(value)}`}>{value}</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full ${scoreBg(value)}`}
                                style={{ width: `${value}%` }}
                              />
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}

                  {healthScore.result && (
                    <div className="flex flex-col gap-3">
                      {healthScore.result.categoryBreakdown.map((entry) => (
                        <div key={entry.category} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                          <p className="mb-1 text-[13px] font-medium text-foreground">
                            {CATEGORY_LABELS[entry.category] ?? entry.category}
                          </p>
                          <p className="text-[12px] leading-relaxed text-muted-foreground">
                            {entry.rationale}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : healthScore?.status === 'failed' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-destructive">
                    {healthScore.error_message ?? 'The last health score run failed.'}
                  </p>
                  <button
                    onClick={handleRunHealthScore}
                    disabled={isRunningHealthScore}
                    className="w-fit rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    No health score has been generated for this analysis yet.
                    This depends on four other Phase 2 modules having already
                    run — if any haven't, this may fail with a message naming
                    which one.
                  </p>
                  <button
                    onClick={handleRunHealthScore}
                    disabled={isRunningHealthScore}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunningHealthScore ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    {isRunningHealthScore ? 'Generating…' : 'Generate Health Score'}
                  </button>
                  {healthScoreError && (
                    <p className="text-[12px] text-destructive">{healthScoreError}</p>
                  )}
                </div>
              )}
            </section>

            {/* Clause Classification */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">Clause Classification</h2>
              </div>

              {classification?.status === 'completed' && classification.result ? (
                <div className="flex flex-col divide-y divide-border">
                  {classification.result.clauses
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((clause, i) => (
                      <div key={i} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {formatCategoryFallback(clause.category)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {Math.round(clause.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="text-[13px] leading-relaxed text-foreground">
                          {clause.excerpt}
                        </p>
                      </div>
                    ))}
                </div>
              ) : classification?.status === 'failed' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-destructive">
                    {classification.error_message ?? 'The last classification run failed.'}
                  </p>
                  <button
                    onClick={handleRunClassification}
                    disabled={isRunningClassification}
                    className="w-fit rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    No clause classification has been run for this analysis yet.
                  </p>
                  <button
                    onClick={handleRunClassification}
                    disabled={isRunningClassification}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunningClassification ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {isRunningClassification ? 'Classifying…' : 'Classify Clauses'}
                  </button>
                  {classificationError && (
                    <p className="text-[12px] text-destructive">{classificationError}</p>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
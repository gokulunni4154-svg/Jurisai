// src/app/api/documents/[id]/analyze/route.ts
// File 67 — JurisAI Document Analysis module
// Amendment #24: closes the documentText stopgap (see this file's own
// prior header, and PROJECT_PROGRESS.md's Known Architectural Gap #1).
// documentText is no longer accepted from the client — this route now
// calls OCRService server-side and feeds its result into
// DocumentAnalysisService.
//
// Amendment #25: resolves Issue #7 (blocking vs. fire-and-forget for
// runAnalysis()) as a DELIBERATE, INVESTIGATED decision — not an
// unresolved gap. See the KNOWN LIMITATION comment below for the full
// reasoning and the real Next.js/Vercel API constraints that ruled out
// the alternatives on the current stack.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentAnalysisService } from '@/modules/document-analysis/document-analysis.factory';
import { buildOcrService } from '@/modules/ocr/ocr.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via package.json):
 * dynamic route `params` is a plain synchronous object, NOT a Promise.
 * See File 51's identical note — do not "upgrade" this without first
 * confirming a real move to Next.js 15.
 */
interface RouteContext {
  params: { id: string };
}

/**
 * Raises this route's execution ceiling from Vercel's Hobby-plan
 * default (10s) to Hobby's hard maximum (60s). Added in Amendment #25.
 *
 * This does NOT solve Issue #7 — it only removes an unrelated, smaller
 * failure mode (the unset default) that was silently in effect
 * alongside it. Two sequential external calls (Cloud Vision, then
 * generateWithFallback(), which may itself retry a fallback provider)
 * can still exceed even 60s on a large or slow document. If that
 * becomes a real, observed problem, the real fix is one of the two
 * options this Amendment's header comment documents as deliberately
 * NOT taken now — see KNOWN LIMITATION below.
 */
export const maxDuration = 60;

/**
 * POST /api/documents/[id]/analyze
 *
 * AMENDMENT #24 — previously accepted `documentText` directly in the
 * POST body (see this file's git history / the removed
 * analyzeRequestBodySchema) because no OCR module existed yet. OCR now
 * exists (Files 70–76) — this route no longer reads a request body at
 * all. request.json() is not called; any body the client sends is
 * simply ignored, since nothing from it is needed anymore.
 *
 * Four service calls now, not two — deliberately still four separate
 * steps, not collapsed, mirroring the same "route composes independent
 * service calls" reasoning this file's pre-amendment version already
 * used for createAnalysis()/runAnalysis():
 *
 *  1. ocrService.createExtraction(context.params) — authorizes
 *     (RLS-visibility + not-soft-deleted, via DocumentService, then
 *     ownership) and creates the 'pending' extraction row.
 *  2. ocrService.runExtraction(extraction.id) — the actual OCR call.
 *  3. analysisService.createAnalysis(context.params) — same
 *     authorization shape, creates the 'pending' analysis row. Only
 *     reached if step 2 succeeded — see the early-return branch below.
 *  4. analysisService.runAnalysis(analysis.id, extraction.result.text)
 *     — the actual AI call, now fed OCR's real extracted text instead
 *     of client-supplied text.
 *
 * NEW DECISION, not dictated by any prior file — what happens when OCR
 * fails: a 'failed' OCRExtraction (caught internally by
 * runExtraction() — see File 75) is NOT surfaced as an HTTP error,
 * mirroring exactly how this route already treats a 'failed' analysis
 * outcome (see the comment below on that). But since analysis now
 * depends on OCR's output, a failed extraction means there is no text
 * to analyze — analysisService.createAnalysis()/runAnalysis() are
 * skipped entirely in that case, and the response carries only the
 * failed extraction with `analysis: null`, rather than either (a)
 * silently analyzing an empty string, or (b) throwing an HTTP error for
 * what is, per this route's own established convention, a normal
 * (non-exceptional) 'failed' outcome. The caller reads
 * data.extraction.status to distinguish this from a full success, the
 * same way it already reads data.analysis.status for an
 * analysis-only failure.
 *
 * KNOWN LIMITATION — RESOLVED AS A DELIBERATE DECISION, Amendment #25.
 * Previously flagged as an open question (blocking vs. fire-and-forget
 * for runExtraction()+runAnalysis()). This has now been investigated
 * for real, not deferred again:
 *
 *   - Vercel's context.waitUntil() does NOT work in App Router Route
 *     Handlers on Next.js 14 — it is a Middleware/Edge-function-only
 *     API (tracked, unresolved upstream: vercel/next.js#50522).
 *   - Next.js's after()/unstable_after() — the Route-Handler-safe
 *     background-task primitive — does not exist at all in 14.2.15. It
 *     was introduced experimentally in the Next.js 15 RC and only
 *     became stable in 15.1. Upgrading to get it is a real Next.js
 *     major-version decision (see this file's own params-as-object
 *     note above), not something to fold into this Amendment.
 *   - Without one of the above, fire-and-forget on Vercel's serverless
 *     Node runtime has no guarantee of completing after the response is
 *     sent — the execution context can be frozen or killed. Building
 *     "background" behavior without a supported primitive would be
 *     code that looks correct but silently doesn't work.
 *
 *   DECISION: stay on inline await for both runExtraction() and
 *   runAnalysis(), on the current Next.js 14.2.15 / Vercel Hobby stack.
 *   maxDuration = 60 (above) raises the ceiling to Hobby's max as a
 *   partial mitigation. This is accepted as a real, bounded risk, not
 *   a silent gap.
 *
 *   REVISIT WHEN, either:
 *     (a) the project upgrades to Next.js 15.1+ — adopt after() here,
 *         returning both pending rows immediately and running the OCR
 *         → analysis chain in the callback; or
 *     (b) real production timeout data (504s / stuck 'processing' rows)
 *         shows 60s is insufficient even before a framework upgrade —
 *         in which case an external queue/worker becomes the right
 *         call regardless of Next.js version.
 *
 * A 'failed' ANALYSIS outcome (as opposed to a failed extraction,
 * handled above) is still not surfaced as an HTTP error either, for
 * the same reason the pre-amendment version of this route already
 * documented: the HTTP operation — extract, then create and run an
 * analysis — succeeded; the analysis outcome being 'failed' is data
 * the caller reads from the response body, not an HTTP-level failure.
 * Only a genuinely unexpected error (anything either service rethrows)
 * reaches handleApiError() below.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const ocrService = await buildOcrService();
    const analysisService = await buildDocumentAnalysisService();

    const extraction = await ocrService.createExtraction(context.params);
    const completedExtraction = await ocrService.runExtraction(extraction.id);

    if (completedExtraction.status !== 'completed' || !completedExtraction.result) {
      // OCR failed (or, defensively, completed with no result — should
      // be unreachable per File 75's markCompleted() always pairing
      // 'completed' with a result, but checked explicitly rather than
      // asserting it away). No analysis is created — see the doc
      // comment above for why.
      return NextResponse.json(
        { data: { extraction: completedExtraction, analysis: null } },
        { status: 201 },
      );
    }

    const analysis = await analysisService.createAnalysis(context.params);
    const completedAnalysis = await analysisService.runAnalysis(
      analysis.id,
      completedExtraction.result.text,
    );

    return NextResponse.json(
      { data: { extraction: completedExtraction, analysis: completedAnalysis } },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
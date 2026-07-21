// src/app/api/document-sets/[id]/analyses/route.ts
// Multi-document module — File number not yet assigned.
//
// POST built directly against the real, pasted
// src/app/api/documents/[id]/analyze/route.ts (File 67, Amendments #24/#25)
// for: the maxDuration export, inline-await (not fire-and-forget — same
// Next.js 14.2.15 constraint documented there, unchanged here), and the
// "route composes multiple independent service/repository calls itself"
// shape. GET built against Files 68/69's identical thin-route pattern.

import { NextRequest, NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentSetService } from '@/modules/document-sets/document-set.factory';
import { buildDocumentAnalysisService } from '@/modules/document-analysis/document-analysis.factory';

interface RouteContext {
  params: { id: string };
}

/**
 * Same ceiling as File 67, same reasoning: this route makes one
 * generateWithFallback() call (not File 67's two sequential external
 * calls — OCR then AI — so probably has more real headroom under 60s
 * than File 67 does), but no request-volume/latency data exists yet to
 * justify a different number. Kept identical rather than guessing a
 * smaller one.
 */
export const maxDuration = 60;

/**
 * FLAGGED, DUPLICATED CONSTANT — must match MIN_MEMBERS_FOR_SYNTHESIS in
 * document-set.service.ts. Same "flagged duplication over silent
 * coupling" tradeoff this project already accepts elsewhere (see
 * DOCUMENTS_BUCKET in document.repository.ts) — kept as a separate
 * literal here rather than exporting the service's private constant,
 * since this route needs it for a DIFFERENT check than the service's own
 * (total membership vs. members with a completed analysis — see the
 * REAL GAP note below). If the service's constant ever changes, this one
 * needs updating by hand.
 */
const MIN_READY_MEMBERS_FOR_SYNTHESIS = 2;

/**
 * GET /api/document-sets/[id]/analyses
 *
 * Lists all synthesis runs for a set, most recent first. Thin route —
 * same shape as File 68.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const documentSetService = await buildDocumentSetService();
    const data = await documentSetService.listSetAnalyses(context.params.id);

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/document-sets/[id]/analyses
 *
 * REAL GAP, FOUND AND FIXED HERE, NOT SILENTLY PATCHED IN THE SERVICE —
 * DocumentSetService#createSetAnalysis's own precondition check is
 * against TOTAL set membership (>= MIN_MEMBERS_FOR_SYNTHESIS, currently
 * 2), because that's the only thing the Service layer can see without
 * reaching into a different module (DocumentAnalysisService). But
 * runSetAnalysis() needs members that each already have a COMPLETED
 * document-analysis to synthesize over — a set can have 3 documents and
 * 0 completed analyses among them, which the Service's own check would
 * let through, creating a 'pending' row with nothing real to run against.
 *
 * Fixed at the ROUTE layer instead, deliberately: gathering "does each
 * member document have a completed analysis" means calling
 * DocumentAnalysisService per member, which is exactly the kind of
 * cross-module orchestration File 67's own header comment establishes as
 * the route's job, not a single service's. Checked BEFORE calling
 * createSetAnalysis() — fail fast, so no 'pending' row is created for a
 * set that isn't ready yet, unlike File 67's OCR-failure case (which
 * creates rows first, then reports a degraded result) — different
 * because OCR failing is a genuine runtime outcome worth recording,
 * whereas "not enough completed analyses yet" is knowable up front,
 * before spending anything.
 *
 * Throws ValidationError for the not-ready case — same class, same
 * "known precondition failure, not a generic 500" posture as
 * document-set.service.ts's own identical check for raw membership
 * count.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const documentSetService = await buildDocumentSetService();
    const analysisService = await buildDocumentAnalysisService();

    const members = await documentSetService.listSetMembers(context.params.id);

    const memberAnalyses: Array<{ documentId: string; documentTitle: string; analysis: NonNullable<Awaited<ReturnType<typeof analysisService.listAnalysesForDocument>>[number]['result']> }> = [];

    for (const member of members) {
      const analyses = await analysisService.listAnalysesForDocument({ id: member.id });
      const latestCompleted = analyses.find((a) => a.status === 'completed' && a.result != null);

      if (latestCompleted?.result) {
        memberAnalyses.push({
          documentId: member.id,
          documentTitle: member.title,
          analysis: latestCompleted.result,
        });
      }
    }

    if (memberAnalyses.length < MIN_READY_MEMBERS_FOR_SYNTHESIS) {
      throw new ValidationError(
        `At least ${MIN_READY_MEMBERS_FOR_SYNTHESIS} documents in this set need a completed analysis before a combined synthesis can be run.`,
        {
          documentSetId: context.params.id,
          readyCount: memberAnalyses.length,
          totalMembers: members.length,
          required: MIN_READY_MEMBERS_FOR_SYNTHESIS,
        },
      );
    }

    const setAnalysis = await documentSetService.createSetAnalysis(context.params.id);
    const completedSetAnalysis = await documentSetService.runSetAnalysis(
      setAnalysis.id,
      memberAnalyses,
    );

    return NextResponse.json({ data: completedSetAnalysis }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
// src/app/api/documents/[id]/analyses/[analysisId]/pdf-exports/route.ts
// File 168 — JurisAI PDF Export module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { NotFoundError } from '@/core/errors/app-error';
import { buildPdfExportService } from '@/modules/pdf-export/pdf-export.factory';

/**
 * Next.js App Router convention (confirmed via Files 67/69/98, reused
 * unchanged through every prior route in this project, including Files
 * 138/139): dynamic route `params` is a plain synchronous object, not a
 * Promise.
 */
interface RouteContext {
  params: { id: string; analysisId: string };
}

/**
 * Same reasoning as every prior pipeline route (Files 67, 98, 106, 114,
 * 122, 130, 138, 146) — raises this route's execution ceiling from
 * Vercel Hobby's 10s default to its 60s hard maximum. Does not solve the
 * underlying inline-await risk; only removes the smaller, unrelated
 * failure mode of the unset default. Same known, accepted limitation as
 * every prior module (see those files' own KNOWN LIMITATION notes).
 */
export const maxDuration = 60;

/**
 * POST /api/documents/[id]/analyses/[analysisId]/pdf-exports
 *
 * Diverges from File 138's five-prerequisite structure — only TWO
 * upstream prerequisites here, per PdfExportService's (File 166) own
 * confirmed scope: Clause Classification and Legal Health Score, not all
 * five/six upstream Phase 2 modules. Same CLASSIFICATION-MISSING-style
 * reasoning as every prior module's equivalent check (File 106's
 * original framing): a valid analysisId with no completed run of a given
 * upstream module is a normal, reachable state, not a data-integrity
 * anomaly — surfaced as NotFoundError, each with its own distinctly-named
 * resource.
 *
 * userId for runPdfExport() is taken directly from the just-created
 * PdfExport row's own `user_id` column (File 163's entity) — confirmed
 * against File 166's real runPdfExport(pdfExportId, userId, ...)
 * signature, which requires it explicitly rather than deriving it
 * internally. This route does not need separate access to the current
 * user for this purpose.
 *
 * NO OCR-missing check — same reasoning as Files 130/138/146: this
 * module has no raw-document-text dependency at all.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const pdfExportService = await buildPdfExportService();

    const classification =
      await pdfExportService.getLatestCompletedClassificationForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!classification || !classification.result) {
      throw new NotFoundError('clause_classifications', context.params.analysisId);
    }

    const legalHealthScore =
      await pdfExportService.getLatestCompletedLegalHealthScoreForAnalysis(
        context.params,
        context.params.analysisId,
      );

    if (!legalHealthScore || !legalHealthScore.result) {
      throw new NotFoundError('legal_health_scores', context.params.analysisId);
    }

    const pdfExport = await pdfExportService.createPdfExport(
      context.params,
      context.params.analysisId,
    );

    const completedPdfExport = await pdfExportService.runPdfExport(
      pdfExport.id,
      pdfExport.user_id,
      classification.result.clauses,
      legalHealthScore.result,
    );

    return NextResponse.json({ data: completedPdfExport }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/pdf-exports
 *
 * Lists all export runs for the given analysis, most recent first
 * (PdfExportRepository#findByDocumentAnalysisId's ordering, File 164
 * Amendment 1). No requireOwnership() at this route or in the service —
 * reads follow the established RLS-only-for-reads convention throughout
 * this codebase, identical to every prior module's GET handler.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const pdfExportService = await buildPdfExportService();

    const pdfExports = await pdfExportService.listPdfExportsForAnalysis(
      context.params,
      context.params.analysisId,
    );

    return NextResponse.json({ data: pdfExports }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
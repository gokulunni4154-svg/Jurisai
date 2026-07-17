// src/app/api/documents/[id]/analyses/[analysisId]/classifications/route.ts
// File 98 — JurisAI Clause Classification module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { NotFoundError } from '@/core/errors/app-error';
import { buildOcrService } from '@/modules/ocr/ocr.factory';
import { buildClauseClassificationService } from '@/modules/clause-classification/clause-classification.factory';

/**
 * Next.js 14.2.15 App Router convention (confirmed via File 67/51):
 * dynamic route `params` is a plain synchronous object, not a Promise.
 */
interface RouteContext {
  params: { id: string; analysisId: string };
}

/**
 * Same reasoning as File 67 — raises this route's execution ceiling
 * from Vercel Hobby's 10s default to its 60s hard maximum. Does not
 * solve the underlying inline-await risk (see KNOWN LIMITATION below);
 * only removes the smaller, unrelated failure mode of the unset
 * default.
 */
export const maxDuration = 60;

/**
 * POST /api/documents/[id]/analyses/[analysisId]/classifications
 *
 * Unlike File 67 (which always creates and runs a fresh OCR extraction
 * inline, since analysis and extraction are created together in the
 * same request), this route hangs off an EXISTING analysisId that may
 * have been created in an earlier, separate request. It therefore reads
 * back the already-extracted text via OCRService's new
 * getLatestCompletedExtractionForDocument() (this session's amendment
 * to File 75) rather than re-running OCR from scratch — re-extracting
 * text for a document that has already been fully analyzed would be
 * both wasteful (real Cloud Vision cost) and semantically wrong.
 *
 * NEW DECISION — what happens if no completed extraction exists for
 * this document. Reasoned through explicitly, not inherited from File
 * 67 (whose route structure makes this state unreachable by
 * construction): reaching this route at all requires a real, resolvable
 * analysisId, and DocumentAnalysisService.getAnalysisById() (called
 * inside ClauseClassificationService.createClassification()) already
 * confirms that analysis exists and belongs to this document. Since an
 * analysis can only have been created after runAnalysis() succeeded
 * (File 67), which itself required a completed extraction, a missing
 * completed extraction at this point indicates a genuine data
 * inconsistency, not a normal branch — unlike File 67's own OCR-failure
 * case, which IS a normal, expected outcome. Surfaced as NotFoundError
 * (a confirmed, real error-class shape from pasted source) rather than
 * silently treated as "nothing to classify yet".
 *
 * KNOWN LIMITATION — inherits File 67's Amendment #25 reasoning
 * directly, not re-derived: the same Next.js 14.2.15 / Vercel Hobby
 * constraints (no context.waitUntil() in Route Handlers, no after()
 * until Next.js 15.1) apply identically here. runClassification() is
 * awaited inline, accepted as the same real, bounded risk File 67
 * already documents and accepts. Revisit under the same conditions File
 * 67's comment lists (Next.js 15.1+ upgrade, or observed production
 * timeout data).
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const ocrService = await buildOcrService();
    const classificationService = await buildClauseClassificationService();

    const extraction = await ocrService.getLatestCompletedExtractionForDocument(context.params);

    if (!extraction || !extraction.result) {
      // See NEW DECISION above — this state is expected to be
      // unreachable given a valid analysisId already implies a
      // completed extraction existed. Surfaced as a 404 rather than a
      // silent null-data response, since it indicates an inconsistency
      // worth the caller (and logs) noticing, not a normal outcome.
      throw new NotFoundError('ocr_extractions', context.params.id);
    }

    const classification = await classificationService.createClassification(
      context.params,
      context.params.analysisId,
    );

    const completedClassification = await classificationService.runClassification(
      classification.id,
      extraction.result.text,
    );

    return NextResponse.json({ data: completedClassification }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/classifications
 *
 * Lists all classification runs for the given analysis, most recent
 * first (ClauseClassificationRepository#findByDocumentAnalysisId's
 * ordering, File 95). No requireOwnership() at this route or in the
 * service — reads follow the established RLS-only-for-reads convention
 * throughout this codebase.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const classificationService = await buildClauseClassificationService();

    const classifications = await classificationService.listClassificationsForAnalysis(
      context.params,
      context.params.analysisId,
    );

    return NextResponse.json({ data: classifications }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
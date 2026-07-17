// src/app/api/documents/[id]/analyses/[analysisId]/pdf-exports/[pdfExportId]/route.ts
// File 169 — JurisAI PDF Export module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildPdfExportService } from '@/modules/pdf-export/pdf-export.factory';

interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    pdfExportId: string;
  };
}

/**
 * GET /api/documents/[id]/analyses/[analysisId]/pdf-exports/[pdfExportId]
 *
 * Fetches a single PDF export run. Thin route — all real logic
 * (parent-analysis visibility check via
 * DocumentAnalysisService#getAnalysisById, called inside
 * PdfExportService#getPdfExportById, then the document_analysis_id-match
 * check preventing cross-analysis access) lives in
 * PdfExportService#getPdfExportById (File 166), matching every prior
 * single-resource route's identical pattern (Files 107/115/123/131/139).
 *
 * A pdfExportId that doesn't exist at all, OR that exists but belongs to
 * a different analysis than [analysisId], both surface as the same
 * NotFoundError from the service layer and both become the same 404
 * response here — no special-case handling, same as every prior route.
 *
 * No requireOwnership() anywhere in this call chain — this is a read,
 * following the established RLS-only-for-reads convention.
 *
 * No maxDuration export, same reasoning as every prior single-resource
 * GET route — a pure read has no long-running work to bound.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const pdfExportService = await buildPdfExportService();
    const pdfExport = await pdfExportService.getPdfExportById(
      context.params,
      context.params.analysisId,
      context.params.pdfExportId,
    );

    return NextResponse.json({ data: { pdfExport } });
  } catch (error) {
    return handleApiError(error);
  }
}
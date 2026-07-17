// src/app/api/documents/[id]/analyses/[analysisId]/pdf-exports/[pdfExportId]/download/route.ts
// File 172 — JurisAI PDF Export module

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildPdfExportService } from '@/modules/pdf-export/pdf-export.factory';

/**
 * Next.js App Router convention, unchanged from every prior route in
 * this project: dynamic route `params` is a plain synchronous object,
 * not a Promise.
 */
interface RouteContext {
  params: {
    id: string;
    analysisId: string;
    pdfExportId: string;
  };
}

/**
 * Must match PdfExportService.getDownloadUrl()'s repository call
 * exactly — same duplication risk File 40 already flags for the
 * equivalent Documents download route, not resolved differently here.
 */
const SIGNED_URL_EXPIRES_IN_SECONDS = 300;

/**
 * GET /api/documents/[id]/analyses/[analysisId]/pdf-exports/[pdfExportId]/download
 *
 * Returns a short-lived signed URL for downloading a completed export's
 * PDF from Storage. Response is JSON (`{ data: { url,
 * expiresInSeconds } }`), not an HTTP redirect — same convention as
 * File 40's `/api/documents/[id]/download`, for the identical reason:
 * lets the client control how the download is actually initiated.
 *
 * Authorization and "is this export actually downloadable yet" are
 * entirely inside PdfExportService.getDownloadUrl() (File 171) — this
 * route does no checks of its own.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const pdfExportService = await buildPdfExportService();
    const url = await pdfExportService.getDownloadUrl(
      context.params,
      context.params.analysisId,
      context.params.pdfExportId,
    );

    return NextResponse.json({
      data: { url, expiresInSeconds: SIGNED_URL_EXPIRES_IN_SECONDS },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
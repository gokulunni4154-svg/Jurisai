// src/app/api/document-sets/[id]/analyses/[analysisId]/route.ts
// Multi-document module — File number not yet assigned.
//
// Same conventions as the real, pasted File 69
// (src/app/api/documents/[id]/analyses/[analysisId]/route.ts): thin
// route, two-segment params, wrong-parent and doesn't-exist both surface
// as the same 404 via the Service layer's identical-shape NotFoundError
// (see document-set.service.ts's getSetAnalysisById()).

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentSetService } from '@/modules/document-sets/document-set.factory';

interface RouteContext {
  params: {
    id: string;
    analysisId: string;
  };
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const documentSetService = await buildDocumentSetService();
    const data = await documentSetService.getSetAnalysisById(
      context.params.id,
      context.params.analysisId,
    );

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
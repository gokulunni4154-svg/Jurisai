// src/app/api/document-sets/[id]/members/[documentId]/route.ts
// Multi-document module — File number not yet assigned.
//
// Same conventions as the real, pasted audit-log route files. Same
// flagged, unverified dynamic-params shape as document-sets/[id]/route.ts,
// here with two dynamic segments instead of one — same caveat applies.

import { NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentSetService } from '@/modules/document-sets/document-set.factory';

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; documentId: string } },
): Promise<NextResponse> {
  try {
    const documentSetService = await buildDocumentSetService();
    await documentSetService.removeDocumentFromSet(params.id, params.documentId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
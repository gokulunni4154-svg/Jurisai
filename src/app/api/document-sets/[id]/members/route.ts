// src/app/api/document-sets/[id]/members/route.ts
// Multi-document module — File number not yet assigned.
//
// Same conventions as the real, pasted audit-log route files. Same
// flagged, unverified dynamic-params shape as document-sets/[id]/route.ts.

import { NextRequest, NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentSetService } from '@/modules/document-sets/document-set.factory';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const documentSetService = await buildDocumentSetService();
    const data = await documentSetService.listSetMembers(params.id);

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    const documentId = body?.documentId;

    if (typeof documentId !== 'string' || documentId.trim().length === 0) {
      throw new ValidationError('A documentId is required.', {
        param: 'documentId',
        received: documentId,
      });
    }

    const documentSetService = await buildDocumentSetService();
    await documentSetService.addDocumentToSet(params.id, documentId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
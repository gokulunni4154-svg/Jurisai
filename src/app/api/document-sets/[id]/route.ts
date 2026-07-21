// src/app/api/document-sets/[id]/route.ts
// Multi-document module — File number not yet assigned.
//
// Same conventions as the real, pasted audit-log route files.
//
// FLAGGED, UNVERIFIED: this project's real Next.js dynamic-route param
// shape (`{ params }: { params: { id: string } }` vs. the newer
// `Promise<{ id: string }>` shape some Next.js versions require) was
// never independently confirmed this session — no real [id]/route.ts or
// [documentId]/route.ts file was pasted for any module. Written against
// the older, synchronous params shape as the more common convention;
// flag and correct if this project's real Next.js version needs the
// async params shape instead.

import { NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentSetService } from '@/modules/document-sets/document-set.factory';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const documentSetService = await buildDocumentSetService();
    const data = await documentSetService.getDocumentSetById(params.id);

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
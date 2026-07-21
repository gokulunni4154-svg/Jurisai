// src/app/api/document-sets/route.ts
// Multi-document module — File number not yet assigned.
//
// Same conventions as the real, pasted src/app/api/audit-log/*/route.ts
// files: try/catch, handleApiError() for all error mapping,
// buildXService() factory call, NextResponse.json({ data }, { status })
// on success.

import { NextRequest, NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentSetService } from '@/modules/document-sets/document-set.factory';

export async function GET(): Promise<NextResponse> {
  try {
    const documentSetService = await buildDocumentSetService();
    const data = await documentSetService.listDocumentSets();

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    const name = body?.name;

    // FLAGGED: validated inline here (a plain string presence/type check),
    // NOT via a Zod schema the way documents.schemas.ts / billing.schemas.ts
    // validate their own routes' bodies — no document-sets.schemas.ts
    // request-validation file exists yet in this session (only the AI
    // *result* schema, document-set-analysis.schemas.ts, has been built so
    // far). Revisit once/if this module gets a real request-schemas file,
    // for consistency with the rest of the project's validation posture.
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('A non-empty name is required.', {
        param: 'name',
        received: name,
      });
    }

    const documentSetService = await buildDocumentSetService();
    const data = await documentSetService.createDocumentSet(name.trim());

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
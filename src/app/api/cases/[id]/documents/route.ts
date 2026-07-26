// src/app/api/cases/[id]/documents/route.ts
//
// DRAFT — see cases/route.ts's header comment re: Source Verification
// Rule. Same caveats apply.
//
// FLAGGED / FIXED — session 55 (tsc pass):
//   1. GET's `request` param was unused (only context.params.id is
//      read) — prefixed with `_`, same convention as every other route
//      this session.
//   2. POST still called the never-existent `getAuthUser(request)` /
//      `buildCaseService(currentUser)` pair — GET in this same file had
//      already been fixed to `getCurrentUser()` / `createCaseService()`.
//      POST brought in line to match.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseService } from '@/modules/cases/case.factory';
interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/cases/[id]/documents
 * Lists documents linked to a case via case_documents.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const caseService = await createCaseService(currentUser);
    const documents = await caseService.listCaseDocuments(id);

    return NextResponse.json({ data: documents });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cases/[id]/documents
 * Links an existing document into a case.
 *
 * FLAGGED, carried forward from the continuation prompt:
 * CaseService#addDocumentToCase only allows the case OWNER to add
 * documents today — a read_write grantee cannot, per the service's own
 * (deliberate) current behavior. Not fixed here. If that changes, this
 * route doesn't need to change — the gate lives in the Service.
 *
 * Also flagged in the scoping doc: this does not independently verify
 * documentId belongs to a document this case's owner/firm actually
 * owns — that's a service-layer concern per case_documents' own
 * precedent (document_set_members), not duplicated into this route.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const caseService = await createCaseService(currentUser);

    const body = await request.json();
    const { documentId } = body;

    const link = await caseService.addDocumentToCase(id, documentId);

    return NextResponse.json({ data: link }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
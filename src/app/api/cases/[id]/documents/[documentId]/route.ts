// src/app/api/cases/[id]/documents/[documentId]/route.ts
//
// DRAFT — see cases/route.ts's header comment re: Source Verification
// Rule. Same caveats apply.
//
// Void-returning DELETE returns a bare 204 with a null body, not a
// JSON { data: null } envelope — confirmed real per the continuation
// prompt via document-sets/[id]/members/[documentId]/route.ts.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseService } from '@/modules/cases/case.factory';

interface RouteContext {
  params: { id: string; documentId: string };
}

/**
 * DELETE /api/cases/[id]/documents/[documentId]
 * Unlinks a document from a case (does not delete the document
 * itself — case_documents is a join table).
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id, documentId } = context.params;
   const currentUser = await getCurrentUser();               // ✅ new
const caseService = await createCaseService(currentUser); // ✅ new

    await caseService.removeDocumentFromCase(id, documentId);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
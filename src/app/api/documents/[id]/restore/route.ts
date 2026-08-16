// src/app/api/documents/[id]/restore/route.ts
//
// NEW — Trash: Restore. Closes the gap flagged in
// src/app/documents/page.tsx's own header comment ("Restore ... [is]
// disabled with 'Coming soon' — no restore ... route anywhere in the
// API").
//
// POST-suffixed action route, not a PATCH on the document resource
// itself — same convention already established by
// /api/cases/[id]/grants/[grantId]/revoke and the lawyer-inquiries
// accept/decline/assign/convert routes: this is a state transition
// (deleted_at: timestamp -> null), not a general field update, so it
// gets its own verb rather than overloading PATCH /api/documents/[id]
// (which File 48's updateDocumentSchema already restricts to
// title/hearingDate and which explicitly rejects soft-deleted rows).
//
// Same Next.js 14.2.15 synchronous-params convention as the sibling
// /api/documents/[id]/route.ts (see that file's own doc comment on
// this exact point) — not upgraded to `Promise<{ id: string }>` here
// either.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildDocumentService } from '@/modules/documents/document.factory';

interface RouteContext {
  params: { id: string };
}

/**
 * POST /api/documents/[id]/restore
 *
 * Reverses a soft-delete. Owner-only, enforced entirely inside
 * DocumentService.restoreDocument() (this route does no authorization
 * logic of its own, matching every other route in this module). Returns
 * the restored row on success, same `{ data: { document } }` envelope
 * shape as GET/PATCH /api/documents/[id].
 *
 * A document that is not currently in the trash — including one that
 * never existed / isn't visible to this actor — surfaces as
 * ConflictError (409) or NotFoundError (404) respectively, via
 * handleApiError(); this route does not distinguish between them.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const service = await buildDocumentService();
    const document = await service.restoreDocument(context.params);

    return NextResponse.json({ data: { document } });
  } catch (error) {
    return handleApiError(error);
  }
}

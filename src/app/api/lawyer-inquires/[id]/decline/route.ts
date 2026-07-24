// src/app/api/lawyer-inquiries/[id]/decline/route.ts
// FLAGGED: same invented route path/folder caveat as accept/route.ts --
// no dynamic-segment route was found in pasted source this session to
// confirm this shape against.
//
// POST /api/lawyer-inquiries/:id/decline
//
// Thin wrapper around LawyerInquiryService#declineInquiry() (§2 step 8,
// §4.2 resolved -- decline deletes the row outright, no stored status).
// Near-identical to accept/route.ts by design -- same auth-loading fix,
// same factory, same admin-client-under-the-hood reasoning
// (lawyer_inquiries' RLS is SELECT-only, so this can't be a normal
// RLS-backed authenticated write either). Kept as a literal sibling
// file rather than trying to unify accept/decline into one parameterized
// route, since no existing precedent for a single-route two-action
// shape was seen in anything pasted this session -- two small files
// felt safer to guess than one clever one.
//
// FLAGGED, DECISION MADE HERE (default, not confirmed against a real
// frontend): returns a JSON `{ data: ... }` envelope on success,
// matching every OTHER route built this session (accept, lawyers
// directory, sign-in) -- picked over the original 204 No Content
// version for consistency, since nothing pasted this session confirmed
// which the frontend actually expects. If 204 turns out to be correct,
// this is a two-line revert: drop the `{ data: { declined: true } }`
// body and change the status back to 204.
//
// RESOLVED THIS SESSION, against real pasted src/core/auth/session.ts:
// same fix as accept/route.ts -- the previous currentUser-loading block
// (a raw supabase.auth.getUser() call, cast to AuthUser with
// `as unknown as`) has been replaced with getCurrentUser(), the real,
// confirmed helper. Returns AuthUser | null directly, no cast needed.
// The direct createClient() call and its import are removed entirely.
//
// FLAGGED, NOTED NOT FIXED: same createClient import-path discrepancy
// as accept/route.ts (this file's original import was
// `@/lib/supabase/server`; the real session.ts uses
// `@/core/supabase/server`) -- moot here since createClient is no
// longer called directly, but flagged for the same reason.

import { NextResponse } from 'next/server';

import { AppError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { getCurrentUser } from '@/core/auth/session';
import { buildLawyerInquiryService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

interface RouteParams {
  params: { id: string };
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: inquiryId } = params;

    if (!inquiryId) {
      // FLAGGED: same AppError constructor-shape guess as accept/route.ts.
      throw new AppError('Inquiry id is required.', { statusCode: 400 });
    }

    const currentUser = await getCurrentUser();

    const service = await buildLawyerInquiryService(currentUser);
    await service.declineInquiry(inquiryId);

    // FLAGGED: declineInquiry() itself returns void -- `declined: true`
    // here is a synthesized response body, not something the Service
    // layer produces. Chosen as the smallest useful body for a
    // delete-like action's success response.
    return NextResponse.json({ data: { declined: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
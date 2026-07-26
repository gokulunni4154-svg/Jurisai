// src/app/api/lawyer-inquiries/[id]/accept/route.ts
// FLAGGED: route path/folder structure invented -- no existing
// dynamic-segment + action-suffix route (e.g. /[id]/accept) was found
// in pasted source this session to confirm against. Every real route
// seen (sign-in, analysis/anonymous, lawyers) is a flat path with no
// dynamic segment. If the project's real convention differs (e.g. a
// query param or a body field instead of a path segment for the
// inquiry id), only this file's path/param-reading needs to move.
//
// POST /api/lawyer-inquiries/:id/accept
//
// Thin wrapper around LawyerInquiryService#acceptInquiry() (§2 step 9).
// Requires an authenticated caller -- unlike GET /api/lawyers, this is
// NOT a pre-auth endpoint. Authorization itself is enforced in the
// Service layer via requireOwnership(), not by RLS on this table
// (lawyer_inquiries' RLS is SELECT-only, so the Service's admin-client
// repository is still what performs the actual write -- this route just
// needs to know WHO is calling).
//
// FLAGGED: buildLawyerInquiryService()'s factory doesn't exist yet in
// this session's pasted/built files -- inlined a plausible construction
// here rather than a real import, since building a proper factory file
// wasn't yet done. This is a stand-in, not a confirmed pattern -- if a
// separate lawyer-inquiry.factory.ts gets built next, this route should
// import from it instead of constructing inline.
//
// RESOLVED THIS SESSION, against real pasted src/core/auth/session.ts:
// the previous currentUser-loading block (a raw supabase.auth.getUser()
// call, cast to AuthUser with `as unknown as`) has been replaced with
// getCurrentUser() -- the real, confirmed helper. It already does the
// getUser()-then-mapSupabaseUserToAuthUser() work internally (including
// the getUser()-not-getSession() JWT-verification distinction documented
// on that file) and returns AuthUser | null directly, with no cast
// needed. The direct createClient() call and its import are removed
// entirely -- this route no longer touches the Supabase client itself.
//
// FLAGGED, NOTED NOT FIXED: this route's ORIGINAL createClient import
// was `@/lib/supabase/server`, but the real session.ts imports
// createClient from `@/core/supabase/server` -- a different path. Since
// this route no longer calls createClient() directly at all after this
// fix, the discrepancy is moot here, but it may indicate two separate
// supabase client modules exist in this project. Not resolved -- flagged
// for whoever next touches route files that still import from
// `@/lib/supabase/server` directly.
//
// FLAGGED / FIXED — session 55 (tsc pass):
//   1. `AppError('...', { statusCode: 400 })` was a two-arg call against
//      a constructor never independently confirmed this session — swapped
//      to `ValidationError('...', { ... })`, a shape already compiler-
//      confirmed working in two OTHER real files this session
//      (firms/[id]/members/[profileId]/route.ts and the
//      client-invitations route.ts), both of which use the identical
//      (message, context) call shape with no tsc error. Not a blind
//      guess, but AppError's own real constructor still hasn't been
//      independently pasted/confirmed this session — revisit if that
//      surfaces and contradicts this.
//   2. `request` param was unused (only `params` is read) — prefixed
//      with `_` per this project's established convention.

import { NextResponse } from 'next/server';

import { ValidationError } from '@/core/errors/app-error';
import { handleApiError } from '@/core/errors/error-handler';
import { getCurrentUser } from '@/core/auth/session';
import { buildLawyerInquiryService } from '@/modules/lawyer-inquiries/lawyer-inquiry.factory';

interface RouteParams {
  params: { id: string };
}

export async function POST(_request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id: inquiryId } = params;

    if (!inquiryId) {
      throw new ValidationError('Inquiry id is required.', { received: inquiryId });
    }

    const currentUser = await getCurrentUser();

    const service = await buildLawyerInquiryService(currentUser);
    const result = await service.acceptInquiry(inquiryId);

    return NextResponse.json({ data: result });
  } catch (error) {
    return handleApiError(error);
  }
}
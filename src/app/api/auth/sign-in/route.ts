import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildAuthService } from '@/modules/auth/auth.factory';
import { buildAnonymousAnalysisService } from '@/modules/lawyer-inquiries/anonymous-analysis.factory';

/**
 * POST /api/auth/sign-in
 *
 * Authenticates with email and password and establishes a session.
 *
 * Session cookies are set automatically as a side effect of
 * AuthService.signIn()'s call to supabase.auth.signInWithPassword() on
 * the request-scoped client from createClient() (File 14) -- that client
 * is bridged to Next.js's cookies() via @supabase/ssr, which writes the
 * resulting session into the response cookies itself. This handler never
 * touches THAT cookie directly; that is deliberate, not an omission --
 * unchanged from the original file.
 *
 * NEW, this session: after a successful sign-in, checks for an
 * anon_session_token cookie (set by POST /api/analysis/anonymous, Lawyer
 * Inquiry feature) and, if present, triggers reattachment -- this is the
 * authenticated moment the scoping doc's §2 step 5 actually needs, since
 * AuthService.signUp() itself never establishes a session (email
 * confirmation gate, confirmed via the sign-up route's own doc comment).
 * Deliberately NOT touching AuthService for this -- reattachment is a
 * different module's concern, so it's composed here at the route level,
 * after signIn() succeeds, rather than reaching into auth.service.ts.
 *
 * FLAGGED, real accepted limitation, not solved here (per this session's
 * chat, no product decision was made to persist the choice server-side
 * instead): if the email confirmation link is opened in a different
 * browser/device than the one that made the original sign-up request,
 * anon_session_token won't be present at sign-in, and reattachment
 * silently no-ops -- the visitor's prior upload/analysis is simply not
 * carried over, no error surfaced. AnonymousAnalysisService.reattachSession()
 * (not yet written -- next file) is expected to itself no-op safely if
 * the token doesn't resolve to a live, non-expired, not-yet-reattached
 * session, so this route doesn't need to distinguish "no cookie" from
 * "cookie present but session invalid/expired."
 *
 * FLAGGED, invented, no existing precedent beyond the sign-up route's own
 * inviteToken handling: targetProfileId/targetFirmId (the lawyer or firm
 * picked in step 3, pre-auth) are read from query params only here, NOT
 * from the request body -- sign-in's body is credentials-only per
 * AuthService.signIn()'s existing contract, so following sign-up's
 * "body OR query" dual-source pattern isn't available; query-only is the
 * only option that doesn't change signIn()'s own input shape. Whether
 * the frontend actually appends these query params to the sign-in POST
 * (vs. some other carry-through mechanism entirely) is unconfirmed.
 *
 * Reattachment failure does NOT fail the sign-in response -- a session
 * was legitimately established; losing the anon upload is a degraded
 * outcome, not an auth failure. Errors are swallowed here, not
 * propagated to handleApiError(). FLAGGED: this means a real bug in
 * reattachSession() would fail silently from the client's perspective --
 * accepted for now given no logging/observability hook was pasted this
 * session to report it through instead.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    let rawInput: unknown;
    try {
      rawInput = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const service = await buildAuthService();
    const user = await service.signIn(rawInput);

    await tryReattachAnonymousSession(request, user.id);

    return NextResponse.json({ data: user });
  } catch (error) {
    return handleApiError(error);
  }
}

async function tryReattachAnonymousSession(request: Request, profileId: string): Promise<void> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const sessionToken = readCookie(cookieHeader, 'anon_session_token');

  if (!sessionToken) {
    return;
  }

  const url = new URL(request.url);
  const targetProfileId = url.searchParams.get('targetProfileId');
  const targetFirmId = url.searchParams.get('targetFirmId');

  if (!targetFirmId) {
    // No inquiry target carried through -- nothing to reattach into.
    // FLAGGED: this silently drops a live anon session that has no
    // target, rather than reattaching it "unassigned" for later use --
    // no product decision covers that case, since the scoping doc's flow
    // assumes a target was always picked in step 3 before reaching here.
    return;
  }

  try {
    const anonymousAnalysisService = await buildAnonymousAnalysisService();
    await anonymousAnalysisService.reattachSession({
      sessionToken,
      profileId,
      targetProfileId,
      targetFirmId,
    });
  } catch {
    // Swallowed -- see doc comment above.
  }
}

// FLAGGED: no existing cookie-parsing utility was found in pasted source
// this session (the analysis/anonymous route reads cookies via
// NextRequest's built-in request.cookies, but this file receives a plain
// Request, not a NextRequest, matching the original sign-in route's own
// signature -- changing that signature wasn't done unprompted). Minimal
// hand-rolled parser, not a general-purpose cookie library.
function readCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(';')
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
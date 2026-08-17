import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildAuthService } from '@/modules/auth/auth.factory';
import { buildAnonymousAnalysisService } from '@/modules/lawyer-inquiries/anonymous-analysis.factory';
import { createClient } from '@/core/supabase/server';
import { FirmRepository } from '@/modules/billing/firm.repository';
import { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import type { AuthUser } from '@/core/auth/types';

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
 *
 * NEW, this session: response body now also includes `redirectTo`, the
 * resolved post-sign-in dashboard destination -- see
 * resolveDashboardRedirect()'s own doc comment below for the resolution
 * order and rationale. This closes the continuation prompt's "Next
 * steps" §2 gap (sign-in previously always sent every account to '/',
 * regardless of role or firm ownership, since sign-in-form.tsx had
 * nothing else to route on).
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
    const redirectTo = await resolveDashboardRedirect(user);

    return NextResponse.json({ data: user, redirectTo });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * NEW. Resolves the post-sign-in dashboard destination, per the
 * continuation prompt's "Next steps" §2 -- three destinations, checked
 * in this priority order:
 *
 * 1. lawyer ('/lawyer') -- checked FIRST, deliberately. signUpAsLawyer()
 *    (this session's earlier work) also creates a solo owner-role firm
 *    for every lawyer account, so a solo lawyer literally owns a firm
 *    via firms.owner_id too. Checking firm ownership before role would
 *    misroute a lawyer to /firm/[firmId] instead of /lawyer -- this is
 *    the one real ordering constraint here, not an arbitrary choice.
 *    LawyerDashboardService's own confirmed role check (per the
 *    resolved blocking issue) gates on this same top-level
 *    UserRole -- consistent with that.
 *
 * 2. firm owner ('/firm/[firmId]'), via FirmRepository.findByOwnerId().
 *    FLAGGED: FirmRepository lives in src/modules/billing/, per that
 *    file's own header ("no firm-creation flow exists ... out of this
 *    file's scope") -- reused here across modules since no dedicated
 *    firm module exists yet. This is a deliberate, flagged cross-module
 *    reuse, not a hidden coupling.
 *
 * 3. client ('/client') -- NEW, General Portal Phase 1 task. Checked
 *    before the firm-owner lookup for the same reason lawyer is
 *    checked first: role is the cheaper, more specific signal, and a
 *    'client' account is by definition never a firm owner (clients.firm_id
 *    is a separate relationship from firms.owner_id -- see
 *    src/core/auth/types.ts's own AMENDMENT comment on why 'client' is
 *    modeled as never firm-side). src/app/client/page.tsx (backed by
 *    GET /api/dashboard/client) has been a fully real, working page
 *    since an earlier session, but nothing here ever routed a
 *    signing-in client TO it -- they fell through to the generic
 *    fallback below like every other non-lawyer, non-firm-owner
 *    account. Confirmed real via this session's repo audit, not
 *    assumed.
 *
 * 4. firm owner OR firm admin ('/firm/[firmId]'). CORRECTED, Navigation
 *    + Polish Cleanup task: previously ONLY checked
 *    FirmRepository.findByOwnerId() -- a real bug, found via this
 *    task's own audit, not assumed. That call only ever matches a
 *    profile listed as firms.owner_id, so a profile that is a firm
 *    'admin' (FirmRole, via firm_members) WITHOUT being the owner --
 *    a real, distinct, inviteable account shape (see
 *    firm-invitation.service.ts's own ALLOWED_INVITE_ROLES) -- fell
 *    through to the '/dashboard' fallback below instead of landing in
 *    the Firm Terminal, contradicting this project's own stated
 *    "FIRM OWNER/ADMIN -> Firm Terminal" redirect rule. Now checks
 *    FirmMemberRepository#findByProfileId() (new method, this task)
 *    for an 'owner' or 'admin' row (owner preferred first, matching
 *    the prior behavior exactly when one exists; multi-firm-admin case
 *    takes the earliest membership, same "primary = first join"
 *    convention profiles.firm_id itself uses) instead of the
 *    owner-only firms table lookup. Ordinary ('employee'/'lawyer'
 *    FirmRole) members are deliberately NOT matched here -- they are
 *    firm-side staff, not firm-wide administrators, so they keep
 *    following the role-based / fallback paths above and below
 *    exactly as before; this preserves scenario 5 in this task's own
 *    test matrix ("Ordinary firm lawyer -> no unauthorized management
 *    navigation").
 *
 * 5. fallback ('/dashboard') -- CORRECTED, this task: previously
 *    '/documents'. General Portal Phase 1 (this task) adds the actual
 *    missing piece '/documents' itself was standing in for -- a real
 *    welcome/overview home (GET /api/dashboard/general) with Legal
 *    Health Score, risk summary, and AI recommendations aggregated
 *    across the caller's own documents, not just the document-manager
 *    table. '/documents' remains fully real and reachable (linked from
 *    the new dashboard's own Quick Actions and from AppSidebar), it is
 *    simply no longer the FIRST thing a general user sees after
 *    signing in. Also the landing spot for 'business', 'admin', and
 *    'support' roles for now -- none of those had a more specific
 *    destination in scope for this task either.
 *
 * Failure while resolving firm ownership is swallowed to '/dashboard'
 * rather than propagated -- matching this file's existing
 * reattachment-error posture just above: a session was legitimately
 * established, so a firm-lookup failure degrading the destination is
 * preferable to failing the whole sign-in response over it.
 */
async function resolveDashboardRedirect(user: AuthUser): Promise<string> {
  if (user.role === 'lawyer') {
    return '/lawyer';
  }

  if (user.role === 'client') {
    return '/client';
  }

  try {
    const supabase = await createClient();
    const firmRepository = new FirmRepository(supabase);
    const firm = await firmRepository.findByOwnerId(user.id);
    if (firm) {
      return `/firm/${firm.id}`;
    }

    const firmMemberRepository = new FirmMemberRepository(supabase);
    const memberships = await firmMemberRepository.findByProfileId(user.id);
    const adminMembership = memberships.find((m) => m.role === 'admin');
    return adminMembership ? `/firm/${adminMembership.firm_id}` : '/dashboard';
  } catch {
    return '/dashboard';
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
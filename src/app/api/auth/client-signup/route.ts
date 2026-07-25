import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildAuthService } from '@/modules/auth/auth.factory';

/**
 * POST /api/auth/client-sign-up
 *
 * NEW THIS SESSION. Structural mirror of the confirmed real
 * /api/auth/sign-up route -- same buildAuthService() import, same
 * try/catch/handleApiError shape, same dual body-or-query inviteToken
 * read (a client could land on the signup page with the token as a URL
 * param and the frontend could post it either folded into the body or
 * left as a query string -- same unconfirmed-frontend-behavior
 * reasoning the real sign-up route's own comment gives for checking
 * both).
 *
 * ONE real difference from /api/auth/sign-up: inviteToken is REQUIRED
 * here, not optional -- AuthService#signUpAsClient()'s own signature
 * has no default for it (confirmed against its real pasted source this
 * session). Missing it is a caller-facing ValidationError (400),
 * thrown here rather than left for signUpAsClient() to discover via its
 * own internal `if (!inviteToken)` check -- that check still exists
 * inside signUpAsClient() as its own defense, this is just a fast
 * fail at the HTTP boundary.
 *
 * Deliberately POST-only, same rationale as /api/auth/sign-up.
 *
 * FLAGGED: path NOT mirrored from any confirmed real precedent --
 * /api/auth/client-sign-up is this session's own naming, sibling to
 * the confirmed real /api/auth/sign-up. Correct if a different shape
 * is wanted or already exists elsewhere.
 *
 * REAL FILE PATH: src/app/api/auth/client-sign-up/route.ts
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    let rawInput: unknown;
    try {
      rawInput = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const bodyInviteToken =
      typeof rawInput === 'object' && rawInput !== null && 'inviteToken' in rawInput
        ? (rawInput as { inviteToken?: unknown }).inviteToken
        : undefined;
    const queryInviteToken = new URL(request.url).searchParams.get('inviteToken');
    const inviteToken =
      typeof bodyInviteToken === 'string' && bodyInviteToken.length > 0
        ? bodyInviteToken
        : queryInviteToken ?? undefined;

    if (!inviteToken) {
      throw new ValidationError('An invitation token is required to create a client account.');
    }

    const service = await buildAuthService();
    const result = await service.signUpAsClient(rawInput, inviteToken);

    // 201 Created -- same reasoning as /api/auth/sign-up: this creates
    // a new resource (an account), not just reads/updates one.
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
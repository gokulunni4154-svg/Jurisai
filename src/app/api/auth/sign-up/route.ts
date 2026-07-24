import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildAuthService } from '@/modules/auth/auth.factory';

/**
 * POST /api/auth/sign-up
 *
 * Creates a new account. Deliberately POST-only -- sign-up is an action,
 * not a resource fetch, so there is no matching GET here.
 *
 * No session cookies are set by this response: with email confirmations
 * enabled (File 12), AuthService.signUp() never establishes an active
 * session. The client should show a "check your email" state and direct
 * the user to /api/auth/sign-in after they confirm.
 *
 * All validation and Supabase Auth error translation happens inside
 * AuthService.signUp() (File 34) -- this handler only parses the request
 * body, delegates, and shapes the HTTP response.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    let rawInput: unknown;
    try {
      rawInput = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    // inviteToken can arrive either as a field on the JSON body or as a
    // query param on the sign-up POST (e.g. an invite link that lands on
    // a sign-up page which then posts the token straight through as
    // ?inviteToken=... rather than folding it into the body). Which one
    // the frontend actually does is unconfirmed -- check both, body wins
    // if somehow both are present.
    const bodyInviteToken =
      typeof rawInput === 'object' && rawInput !== null && 'inviteToken' in rawInput
        ? (rawInput as { inviteToken?: unknown }).inviteToken
        : undefined;
    const queryInviteToken = new URL(request.url).searchParams.get('inviteToken');
    const inviteToken =
      typeof bodyInviteToken === 'string'
        ? bodyInviteToken
        : queryInviteToken ?? undefined;

    const service = await buildAuthService();
    const result = await service.signUp(rawInput, inviteToken);

    // 201 Created -- this is the first Route Handler that creates a new
    // resource (an account) rather than reading or updating one.
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
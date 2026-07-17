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

    const service = await buildAuthService();
    const result = await service.signUp(rawInput);

    // 201 Created -- this is the first Route Handler that creates a new
    // resource (an account) rather than reading or updating one.
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
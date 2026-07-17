import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildAuthService } from '@/modules/auth/auth.factory';

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
 * touches a cookie directly; that is deliberate, not an omission.
 *
 * Returns the AuthUser domain type (core/auth/types.ts), never the raw
 * Supabase session or its tokens -- those stay inside the Supabase client
 * instance by design, so they can't accidentally end up logged or
 * serialized into a response body elsewhere.
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

    return NextResponse.json({ data: user });
  } catch (error) {
    return handleApiError(error);
  }
}
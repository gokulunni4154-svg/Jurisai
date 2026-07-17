import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { AuthenticationError, ValidationError } from '@/core/errors/app-error';
import { getCurrentUser } from '@/core/auth/session';
import { buildAuthService } from '@/modules/auth/auth.factory';

/**
 * POST /api/auth/update-password
 *
 * Sets a new password for the current session. Requires a session to
 * already be present -- either a normal signed-in session, or the
 * temporary recovery session Supabase establishes after a user follows a
 * password-reset email link. Both are valid, verified sessions from
 * getCurrentUser()'s point of view; this route does not need to (and at
 * this layer, cannot cleanly) distinguish which one it is.
 *
 * The session check is deliberately done here, in the route, rather than
 * inside AuthService: AuthService does not extend BaseService and has no
 * requireAuthentication()-style guard (see File 34's reasoning), and
 * without this check, supabase.auth.updateUser() would fail with
 * Supabase's own session-missing error -- which mapSupabaseAuthError()'s
 * fallback would misclassify as a 502 ExternalServiceError, when the real
 * problem is "nobody is authenticated" (401). Rather than teach
 * AuthService a one-off guard only this method would ever use, the check
 * uses getCurrentUser() (File 20) directly -- the same function
 * BaseService.requireAuthentication() itself is built on.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();

    if (!user) {
      throw new AuthenticationError(
        'You must be signed in, or have followed a password reset link, to change your password.',
      );
    }

    let rawInput: unknown;
    try {
      rawInput = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const service = await buildAuthService();
    await service.updatePassword(rawInput);

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
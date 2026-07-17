import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildAuthService } from '@/modules/auth/auth.factory';

/**
 * POST /api/auth/request-password-reset
 *
 * Triggers a password-reset email for the given address, if an account
 * exists for it.
 *
 * The response is deliberately identical for a well-formed email
 * regardless of whether an account exists -- this is the HTTP-layer half
 * of the anti-enumeration guarantee AuthService.requestPasswordReset()
 * (File 34) already provides at the Supabase Auth layer. There is no
 * branching here on whether the account was found; doing so would
 * silently undo that guarantee at this level even though the service
 * layer got it right.
 *
 * A malformed email (fails validation) is a different concern from
 * whether the email is registered, so ValidationError is allowed to
 * surface normally here -- the anti-enumeration guarantee only covers
 * well-formed addresses.
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
    await service.requestPasswordReset(rawInput);

    return NextResponse.json({
      data: {
        message: 'If an account exists for this email address, a password reset link has been sent.',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
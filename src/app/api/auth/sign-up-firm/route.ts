import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildAuthService } from '@/modules/auth/auth.factory';

/**
 * POST /api/auth/sign-up-firm
 *
 * Creates a new lawyer-firm account (a real, given firm name, no
 * professional_verifications row for the signing user -- see
 * AuthService.signUpAsFirm()'s own doc comment for why). Sibling route
 * to /api/auth/sign-up-lawyer, same posture in every other respect:
 * POST-only, no session cookies set on success, no inviteToken handling
 * (this path always creates its own firm).
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
    const result = await service.signUpAsFirm(rawInput);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
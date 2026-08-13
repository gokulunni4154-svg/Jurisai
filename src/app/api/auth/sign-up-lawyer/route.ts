import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';
import { buildAuthService } from '@/modules/auth/auth.factory';

/**
 * POST /api/auth/sign-up-lawyer
 *
 * Creates a new individual (solo) lawyer account. Sibling route to
 * /api/auth/sign-up (File 36), same posture: POST-only, no session
 * cookies set on success (email confirmations enabled per File 12,
 * AuthService.signUpAsLawyer() never establishes an active session).
 *
 * Deliberately has NO inviteToken handling, unlike sign-up/route.ts --
 * this path always creates a brand-new solo firm for the signing user
 * (see AuthService.signUpAsLawyer()'s own doc comment), so there is no
 * existing firm to join via token here.
 *
 * All validation (including registrationNumber) and Supabase Auth error
 * translation happens inside AuthService.signUpAsLawyer() -- this
 * handler only parses the request body, delegates, and shapes the HTTP
 * response, same division of responsibility sign-up/route.ts already
 * establishes.
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
    const result = await service.signUpAsLawyer(rawInput);

    // 201 Created -- creates a new resource (an account, plus a solo
    // firm and a pending verification), same status sign-up/route.ts
    // uses for the same reason.
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { buildAuthService } from '@/modules/auth/auth.factory';

/**
 * POST /api/auth/sign-out
 *
 * Ends the current session. Takes no request body -- there is nothing to
 * validate, so unlike every other Route Handler so far, there is no
 * request.json() parsing step here at all.
 *
 * Kept routed through AuthService.signOut() rather than calling
 * supabase.auth.signOut() directly, even though the method itself is a
 * thin wrapper today: this keeps error translation centralized
 * (mapSupabaseAuthError), and is where future logic -- audit logging a
 * sign-out event, invalidating related sessions -- will naturally land
 * without a later refactor.
 */
export async function POST(): Promise<NextResponse> {
  try {
    const service = await buildAuthService();
    await service.signOut();

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    return handleApiError(error);
  }
}
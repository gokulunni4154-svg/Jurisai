import { NextResponse } from 'next/server';
import { createClient } from '@/core/supabase/server';
import { getCurrentUser } from '@/core/auth/session';
import { ProfileRepository } from '@/modules/profiles/profile.repository';
import { ProfileService } from '@/modules/profiles/profile.service';
import { handleApiError } from '@/core/errors/error-handler';
import { ValidationError } from '@/core/errors/app-error';

/**
 * GET  /api/profiles/me   -- returns the current user's own profile
 * PATCH /api/profiles/me  -- updates the current user's own profile
 *
 * Deliberately thin: this file contains no business logic and no direct
 * Supabase queries. It resolves the request-scoped Supabase client and
 * session, constructs a ProfileService, delegates to it, and maps the
 * result (or any thrown AppError) to an HTTP response. All authorization
 * and validation live in ProfileService (File 28) and profile.schemas.ts
 * (File 27), not here.
 */

/**
 * Builds a ProfileService bound to this request's session and RLS-respecting
 * Supabase client. createClient() (File 14) is called fresh here, per
 * request, per that file's own documented constraint -- it must never be
 * cached at module scope, since it is bound to this request's cookies.
 */
async function buildProfileService() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  return new ProfileService(user, new ProfileRepository(supabase));
}

/**
 * Parses the request body as JSON, converting a malformed-JSON failure
 * into a ValidationError (400) rather than letting it fall through to
 * error-handler.ts's generic fallback, which would otherwise wrap a plain
 * SyntaxError into an InternalServerError (500). A client sending broken
 * JSON is a client mistake, not a server bug, and should be reported as
 * one.
 */
async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
}

export async function GET() {
  try {
    const service = await buildProfileService();
    const profile = await service.getOwnProfile();

    return NextResponse.json({ data: profile });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const rawInput = await parseJsonBody(request);
    const service = await buildProfileService();
    const profile = await service.updateOwnProfile(rawInput);

    return NextResponse.json({ data: profile });
  } catch (error) {
    return handleApiError(error);
  }
}

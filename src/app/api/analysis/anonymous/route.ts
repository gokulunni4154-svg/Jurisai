import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildAnonymousAnalysisService } from '@/modules/lawyer-inquiries/anonymous-analysis.factory';

/**
 * POST /api/analysis/anonymous
 *
 * Entry point for the "upload without an account" step of the Lawyer
 * Inquiry flow (§2, steps 1). Accepts a multipart file upload from an
 * unauthenticated visitor, kicks off analysis, and returns the result —
 * no auth required, by design.
 *
 * Mirrors /api/documents' (File 50) division of responsibility: this
 * route's only job is pulling the file + any existing session cookie out
 * of the request and shaping the response. Validation (file size, mime
 * type against the same allow-list the legal-vault-documents bucket
 * enforces — see File 45's own doc comment on defense-in-depth not being
 * a substitute for application-level checks), the actual Storage write
 * via the admin client, running analysis, and the
 * anonymous_analysis_sessions upsert all live in
 * AnonymousAnalysisService — not written yet, this route's import is
 * forward-declared against the contract described in this session's
 * scoping doc / chat, same working pattern as building any other
 * multi-file module in this project.
 *
 * FLAGGED, all invented for this file, no existing precedent found in
 * pasted source this session:
 *   - Cookie name "anon_session_token" — no anon-flow cookie exists
 *     anywhere else in the project to match against.
 *   - request.formData() for a multipart body — every other route seen
 *     this session (documents, profiles, auth) is request.json(); this is
 *     the first file-upload route, so there's no existing convention to
 *     confirm this against.
 *   - Cookie options below (httpOnly/secure/sameSite=lax/path=/,
 *     maxAge = 7 days matching expires_at) — reasonable defaults, not
 *     copied from an existing cookie-setting call site, since none was
 *     found in pasted source.
 *
 * Response shape `{ data: { analysisResult, expiresAt } }` — deliberately
 * does NOT return document_storage_path or the session_token itself to
 * the client; the token only ever travels via the httpOnly cookie, never
 * in a JSON body, so it can't be read or exfiltrated by client JS.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    // Deliberately not an AppError subclass here — no existing
    // "missing/invalid multipart field" error type was found in pasted
    // source this session (File 21's app-error.ts hierarchy wasn't
    // pasted). Flagged: this should likely become a real ValidationError
    // once that hierarchy is confirmed, not stay a bare Response.
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { message: 'A file is required.' } },
        { status: 400 }
      );
    }

    const existingSessionToken = request.cookies.get('anon_session_token')?.value ?? null;

    const service = await buildAnonymousAnalysisService();
    const { sessionToken, analysisResult, expiresAt } = await service.createAnonymousAnalysis({
      file,
      existingSessionToken,
    });

    const response = NextResponse.json(
      { data: { analysisResult, expiresAt } },
      { status: 201 }
    );

    // Only (re)set the cookie when the service minted a new token — an
    // existing session reusing its token doesn't need the cookie rewritten.
    if (sessionToken !== existingSessionToken) {
      response.cookies.set('anon_session_token', sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days — matches expires_at
      });
    }

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
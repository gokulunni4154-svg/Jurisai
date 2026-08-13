import { NextResponse } from 'next/server';

import { createClient } from '@/core/supabase/server';

/**
 * GET /auth/callback
 *
 * NEW -- fixes a confirmed real gap found this session: Supabase's email
 * confirmation link uses the PKCE flow, which redirects the browser to
 * `${siteUrl}/?code=<auth-code>` (or wherever Supabase's dashboard "Site
 * URL"/"Redirect URLs" config points, plus whatever `emailRedirectTo` a
 * signUp() call supplies) with an authorization `code` query param. That
 * code is NOT a session by itself -- it must be exchanged for one via
 * `supabase.auth.exchangeCodeForSession(code)`. With no route to do that
 * exchange, the confirmation link "worked" (the account row exists,
 * email_confirmed_at gets set) but no session was ever established from
 * clicking it -- confirmed via real observed behavior this session
 * (landing on `/?code=...` with no callback route in the project to
 * consume it).
 *
 * Uses createClient() from src/core/supabase/server.ts (the same
 * request-scoped, cookie-bridged client AuthService is built with)
 * rather than constructing a new Supabase client here -- this is
 * deliberately a Route Handler, not a Server Component, specifically
 * because server.ts's own doc comment confirms only Route Handlers,
 * Server Actions, and Middleware can actually write cookies; a Server
 * Component calling this exchange could silently fail to persist the
 * resulting session.
 *
 * `next` is an OPTIONAL query param this route also accepts, read the
 * same defensive way sign-in-form.tsx's sanitizeRedirectTarget() already
 * treats `redirectTo` -- only a same-origin relative path starting with
 * a single "/" is trusted, closing the same open-redirect risk that
 * function's own doc comment documents, for the same reason (this code
 * param arrives via a URL a user could have forwarded or had crafted for
 * them).
 */
function sanitizeNextTarget(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = sanitizeNextTarget(searchParams.get('next'));

  if (!code) {
    // No code at all -- nothing to exchange. Send to sign-in rather than
    // silently landing on the destination with no session, same
    // "don't report false success" discipline AuthService's own methods
    // follow.
    return NextResponse.redirect(`${origin}/sign-in`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Expired/already-used/invalid code. Redirect to sign-in with an
    // error indicator rather than pretending this succeeded -- the
    // sign-in page does not currently read this param (flagged, not
    // built this session; UI-level "show an error banner" work is a
    // separate task from fixing the broken exchange itself).
    return NextResponse.redirect(`${origin}/sign-in?error=confirmation_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
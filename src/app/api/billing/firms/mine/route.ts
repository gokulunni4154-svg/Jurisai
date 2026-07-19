// src/app/api/billing/firms/mine/route.ts
// NEW, THIS SESSION — closes gap #1 ("no route exists to look up the
// caller's own firm"), flagged repeatedly since billing/firms/new/page.tsx
// was first built and its ConflictError fallback had nothing real to
// call.
//
// SOURCE-VERIFIED AGAINST, THIS SESSION:
//   - POST /api/billing/firms (route.ts, pasted this session) -> real
//     construction pattern reused exactly: getCurrentUser() ->
//     createFirmService(currentUser) -> service method -> manual
//     NextResponse.json({ data }) -> handleApiError() on catch.
//   - FirmService#getMyFirm() (firm.service.ts, added this session) ->
//     returns FirmRow | null, using requireAuthentication() the same
//     way createFirm() does.
//
// `maxDuration = 60` deliberately NOT copied from POST /api/billing/firms
// — this route makes no outbound network call (no Cashfree, nothing),
// only a DB read via getMyFirm(), same reasoning GET
// /api/billing/subscription's own route.ts already gives for omitting
// the same override.
//
// Returns 200 with `data: null` when the caller doesn't own a firm —
// NOT 404 — same convention as GET /api/billing/subscription: "no
// owned firm" is a normal state for a not-yet-onboarded user, not a
// missing resource.
//
// No query params — unlike /billing/subscription's `?firmId=`, this
// route only ever answers "what firm does the CALLER own," so there's
// nothing else to scope by.
//
// Error handling: AuthenticationError (not logged in) is the only
// realistic error path (getMyFirm() has no ownership check to fail
// against another party, since it only ever looks up the caller's own
// id) — routed through the same handleApiError() as every other route,
// no special-casing added.

import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createFirmService } from '@/modules/billing/firm.factory';

export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    const firmService = createFirmService(currentUser);
    const firm = await firmService.getMyFirm();

    return NextResponse.json({ data: firm }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
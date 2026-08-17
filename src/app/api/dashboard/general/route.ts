// src/app/api/dashboard/general/route.ts
//
// NEW FILE — General Portal Phase 1. Structural mirror of the confirmed
// real src/app/api/dashboard/client/route.ts: getCurrentUser() is
// resolved inside the factory (buildGeneralDashboardService()), not
// here — same shape as buildDocumentService()/buildAuthService() used
// throughout this project. handleApiError() wrapping, { data }
// envelope. No RouteContext/params needed — self-scoped off the
// caller's own session and their own RLS-visible rows only.

import { NextResponse } from 'next/server';
import { handleApiError } from '@/core/errors/error-handler';
import { buildGeneralDashboardService } from '@/modules/general-dashboard/general-dashboard.factory';

/**
 * GET /api/dashboard/general
 * Returns the current authenticated user's General Portal dashboard
 * summary: document counts, an average of their own documents'
 * already-computed Legal Health Scores, a risk-severity breakdown, and
 * their most recent AI recommendations — all read-only aggregation
 * over rows RLS already scopes to `documents.owner_id = auth.uid()`.
 */
export async function GET() {
  try {
    const service = await buildGeneralDashboardService();
    const dashboard = await service.getDashboard();

    return NextResponse.json({ data: dashboard });
  } catch (error) {
    return handleApiError(error);
  }
}

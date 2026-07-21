// src/app/api/user-management/admin/users/route.ts
// Admin Tooling — User & Org Management module.

import { NextRequest, NextResponse } from 'next/server';

import { handleApiError } from '@/core/errors/error-handler';
import { buildUserManagementService } from '@/modules/user-management/user-management.factory';

/**
 * GET /api/user-management/admin/users
 *
 * Admin "view users" page's data source — a paginated, optionally-
 * searched listing of every profile on the platform, enriched with
 * email/role/verification/last-sign-in.
 *
 * Authorization: NOT handled here, same division of responsibility as
 * every route in this project (observability's two admin/firm-owner
 * routes, both confirmed this session) — requireRole('admin', 'support')
 * lives inside UserManagementService#listUsers itself.
 *
 * FLAGGED, NEW: this is the first route in the project (of the ones
 * confirmed this session) to accept query-param pagination/search —
 * neither observability route needed this (both return an unfiltered
 * list). Parsing happens here, at the route layer, not the Service —
 * consistent with the route layer's job being request-shape parsing,
 * while the Service layer owns authorization and business logic.
 *   - `limit`: parsed as an integer, defaulting to 20 if absent/invalid.
 *     Clamped to a maximum of 100 — an unbounded limit would let a
 *     caller request the entire profiles table in one page, defeating
 *     the pagination this endpoint exists to provide.
 *   - `offset`: parsed as an integer, defaulting to 0 if absent/invalid.
 *   - `search`: passed through as-is if present and non-empty, omitted
 *     (undefined) otherwise — matches
 *     ProfileRepository#findAllForAdmin's own optional `search` param.
 *
 * These defaults/clamp values are NEW, flagged decisions — no existing
 * pagination convention in this project's confirmed source to match
 * against (findAllForAdmin's own doc comment specifies the method's
 * *behavior* given limit/offset, not what a route layer's defaults
 * should be).
 *
 * No maxDuration override — pure DB reads (profiles page + a bounded
 * batch of auth.admin.getUserById calls), no inline AI provider call,
 * same reasoning both observability routes already give for omitting it.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;

    const rawLimit = Number.parseInt(searchParams.get('limit') ?? '', 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

    const rawOffset = Number.parseInt(searchParams.get('offset') ?? '', 10);
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const rawSearch = searchParams.get('search');
    const search = rawSearch && rawSearch.trim().length > 0 ? rawSearch.trim() : undefined;

    const userManagementService = await buildUserManagementService();

    const { rows, total } = await userManagementService.listUsers({ limit, offset, search });

    return NextResponse.json({ data: rows, total, limit, offset }, { status: 200 });
  } catch (error) {
    return handleApiError(error);
  }
}
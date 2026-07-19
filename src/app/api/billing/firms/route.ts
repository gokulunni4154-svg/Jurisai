import { NextRequest, NextResponse } from 'next/server';

import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createFirmSchema } from '@/modules/billing/billing.schemas';
import { createFirmService } from '@/modules/billing/firm.factory';

/**
 * POST /api/billing/firms
 * ------------------------
 * Closes Item #67 (route half — FirmService.createFirm() closes the
 * service half). Structured against the same pattern the checkout route
 * used: maxDuration = 60, try/catch → handleApiError, manual
 * `NextResponse.json` shape matching `{ data: ... }`.
 *
 * FIXED — previously called a `getCurrentSession()` that doesn't exist
 * anywhere in this project's pasted source. billing.factory.ts (real,
 * verified this session) imports `getCurrentUser` from this exact same
 * path and passes its return value straight into a BaseService subtype's
 * constructor as `currentUser: AuthUser | null` — FirmService needs the
 * identical shape. Corrected to match that confirmed precedent rather
 * than a guessed function name.
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const currentUser = await getCurrentUser();
    const body = await request.json();
    const input = createFirmSchema.parse(body);

    const firmService = createFirmService(currentUser);
    const firm = await firmService.createFirm(input);

    return NextResponse.json({ data: firm }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
// src/app/api/cases/[id]/grants/route.ts
//
// Thin Route Handler; all logic in the Service.
//
// FLAGGED / FIXED — session 55 (tsc pass), TWO separate issues, not one:
//
//   1. GET had a real bug, not just a naming mismatch: it constructed
//      `caseService` (via createCaseService(), the wrong service for
//      this route) but then called `grantService.listGrantsForCase(id)`
//      — a variable that was never declared at all. This route needs
//      CaseAccessGrantService, not CaseService (see this file's own
//      class-level doc comment on GET) — `caseService`'s construction
//      is replaced below with a real `grantService`, not renamed.
//
//   2. POST still called the never-existent `getAuthUser(request)` /
//      `buildCaseAccessGrantService(currentUser)` pair.
//
//   Both now construct the grant service via `createCaseAccessGrantService`,
//   imported from `case.factory.ts` — confirmed real source this
//   session: createCaseAccessGrantService lives in case.factory.ts
//   alongside createCaseService, NOT in a separate
//   case-access-grant.factory.ts (that module never existed; an earlier
//   session's import path was a guess that has since been corrected).
//
//   3. GET's `request` param was also unused (only context.params.id is
//      read) — prefixed with `_`, same convention as every other route
//      this session.
//
//   4. FIXED, session 55 continued: POST's issueGrant() call passed
//      three positional args (id, granteeId, accessLevel). Confirmed
//      against the real, pasted case-access-grant.service.ts:
//      issueGrant() takes ONE object argument —
//      { caseId, granteeId, accessLevel } — not three positional
//      params. Corrected below.
//
//   5. CORRECTED, session 55 continued: this file's POST doc comment
//      previously claimed grants were "gated to team-lead-or-firm-admin
//      only... a solo case owner who is not also a firm admin cannot
//      grant access to their own case." That claim is now confirmed
//      stale against the real, pasted case-access-grant.service.ts —
//      Decision #60 already closed this gap there (requireGrantManageAccess()
//      checks caseRow.owner_id === user.id FIRST, before team-lead or
//      firm-admin checks). Comment corrected to match; no route
//      behavior changed, since this route was only ever describing the
//      Service's authorization, never enforcing it independently.

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/core/auth/session';
import { handleApiError } from '@/core/errors/error-handler';
import { createCaseAccessGrantService } from '@/modules/cases/case.factory';

interface RouteContext {
  params: { id: string };
}

/**
 * GET /api/cases/[id]/grants
 * Lists active + revoked grants for a case. Visibility per
 * CaseAccessGrantService/RLS: the grantee (own grants), case owner,
 * granter, or firm admin.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;

    const currentUser = await getCurrentUser();
    const grantService = await createCaseAccessGrantService(currentUser);

    const grants = await grantService.listGrantsForCase(id);

    return NextResponse.json({ data: grants });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cases/[id]/grants
 * Issues a new access grant on a case.
 *
 * Authorization, confirmed against the real, pasted
 * case-access-grant.service.ts (Decision #60): the case OWNER may
 * always issue a grant on their own case, regardless of firm/team role.
 * Failing that, a team lead of the case's team (if it has one), or a
 * firm admin/owner, may also issue.
 *
 * Also flagged, unchanged: issueGrant does not validate that granteeId
 * is an actual member of the case's firm/team before granting — mirrors
 * document_set_members' own precedent of leaving that unenforced.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = context.params;
    const currentUser = await getCurrentUser();
    const grantService = await createCaseAccessGrantService(currentUser);

    const body = await request.json();
    const { granteeId, accessLevel } = body;

    const grant = await grantService.issueGrant({
      caseId: id,
      granteeId,
      accessLevel,
    });

    return NextResponse.json({ data: grant }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
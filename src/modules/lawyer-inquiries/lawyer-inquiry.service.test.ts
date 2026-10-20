// src/modules/lawyer-inquiries/lawyer-inquiry.service.test.ts
//
// NEW — General User Terminal, "My Sent Inquiries" task. Focused suite
// for LawyerInquiryService#listMySentInquiries() only — not a full
// re-test of createInquiry()/acceptInquiry()/declineInquiry()/
// assignInquiry()/convertInquiry() (all unchanged by this task),
// matching this project's existing per-feature test-file convention
// (e.g. lawyer-directory.service.test.ts alongside the standalone
// directory task).
//
// Same `vi.mock('server-only', ...)` workaround as
// case-access-grant.service.test.ts / document.service.trash.test.ts —
// LawyerInquiryService imports 'server-only' at module scope (extends
// BaseService), which throws outside a real Next.js server context
// unless mocked out first, before any of this file's other imports run.
//
// Covers the brief's own requested test list for this task:
//   - "sender can retrieve own inquiries" — TEST 1.
//   - "sender cannot retrieve another sender's inquiries" — TEST 2
//     (asserts the repository is called with THIS caller's own id, and
//     only this caller's own id — the actual cross-sender isolation is
//     enforced one layer down, by the repository's WHERE clause and the
//     live RLS policy, both confirmed this session; this suite verifies
//     the service never passes a browser-supplied id through).
//   - "sender identity is resolved server-side" — TEST 3 (unauthenticated
//     caller: no repository call is made at all, AuthenticationError
//     thrown instead).
//   - "empty result works" — TEST 4.
//   - "status mapping is accurate" — TEST 5 (all three real enum values
//     pass through toListing() unchanged).

vi.mock('server-only', () => ({}));

import { describe, expect, it, vi } from 'vitest';

import { AuthenticationError, AuthorizationError, ConflictError, ValidationError } from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';

import { LawyerInquiryService } from './lawyer-inquiry.service';
import type { LawyerInquiryRepository } from './lawyer-inquiry.repository';
import type { FirmMemberRepository } from '@/modules/user-management/firm-member.repository';
import type { CaseService } from '@/modules/cases/case.service';
import type { DocumentService } from '@/modules/documents/document.service';

const SENDER = { id: 'sender-1', role: 'individual' } as unknown as AuthUser;
const OTHER_SENDER_ID = 'sender-2';

const BASE_ROW = {
  id: 'inquiry-1',
  client_profile_id: SENDER.id,
  target_profile_id: null,
  target_firm_id: 'firm-1',
  team_id: null,
  document_storage_path: 'individual/sender-1/doc-1/agreement.pdf',
  analysis_result: { legalHealthScore: { result: {} }, aiLegalInsight: null },
  created_at: '2026-08-01T00:00:00.000Z',
};

function buildService(currentUser: AuthUser | null, repositoryOverrides: Partial<LawyerInquiryRepository> = {}) {
  const repository = {
    listForSenderProfile: vi.fn(),
    ...repositoryOverrides,
  } as unknown as LawyerInquiryRepository;

  const firmMemberRepository = {} as unknown as FirmMemberRepository;
  const caseService = {} as unknown as CaseService;
  const documentService = {} as unknown as DocumentService;

  const service = new LawyerInquiryService(
    currentUser,
    repository,
    firmMemberRepository,
    caseService,
    documentService
  );

  return { service, repository };
}

describe('LawyerInquiryService#listMySentInquiries', () => {
  it('TEST 1 — returns the authenticated sender’s own inquiries, mapped to the listing DTO', async () => {
    const { service } = buildService(SENDER, {
      listForSenderProfile: vi.fn().mockResolvedValue([{ ...BASE_ROW, status: 'pending' }]),
    });

    const result = await service.listMySentInquiries();

    expect(result).toEqual([
      {
        id: 'inquiry-1',
        clientProfileId: SENDER.id,
        targetProfileId: null,
        targetFirmId: 'firm-1',
        teamId: null,
        status: 'pending',
        documentName: 'agreement.pdf',
        analysisAvailable: true,
        caseId: undefined,
        decision: undefined,
        decidedAt: undefined,
        reviewExpiresAt: undefined,
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ]);
    // The raw report and storage path never travel on a listing.
    expect(result[0]).not.toHaveProperty('analysisResult');
    expect(result[0]).not.toHaveProperty('documentStoragePath');
  });

  it('TEST 2 — queries only the authenticated caller’s own id, never a browser-supplied one', async () => {
    const { service, repository } = buildService(SENDER, {
      listForSenderProfile: vi.fn().mockResolvedValue([]),
    });

    await service.listMySentInquiries();

    expect(repository.listForSenderProfile).toHaveBeenCalledTimes(1);
    expect(repository.listForSenderProfile).toHaveBeenCalledWith(SENDER.id);
    expect(repository.listForSenderProfile).not.toHaveBeenCalledWith(OTHER_SENDER_ID);
  });

  it('TEST 3 — resolves identity server-side: an unauthenticated caller is rejected before any repository call', async () => {
    const { service, repository } = buildService(null, {
      listForSenderProfile: vi.fn().mockResolvedValue([]),
    });

    await expect(service.listMySentInquiries()).rejects.toThrow(AuthenticationError);
    expect(repository.listForSenderProfile).not.toHaveBeenCalled();
  });

  it('TEST 4 — returns an honest empty array when the sender has no inquiries yet', async () => {
    const { service } = buildService(SENDER, {
      listForSenderProfile: vi.fn().mockResolvedValue([]),
    });

    const result = await service.listMySentInquiries();

    expect(result).toEqual([]);
  });

  it('TEST 5 — maps all three real status values through unchanged', async () => {
    const { service } = buildService(SENDER, {
      listForSenderProfile: vi.fn().mockResolvedValue([
        { ...BASE_ROW, id: 'inquiry-pending', status: 'pending' },
        { ...BASE_ROW, id: 'inquiry-accepted', status: 'accepted', target_profile_id: 'lawyer-1' },
        {
          ...BASE_ROW,
          id: 'inquiry-converted',
          status: 'converted_to_case',
          target_profile_id: 'lawyer-1',
          case_id: 'case-1',
        },
      ]),
    });

    const result = await service.listMySentInquiries();

    expect(result.map((r) => r.status)).toEqual(['pending', 'accepted', 'converted_to_case']);
  });
});

// NEW — P0 security fix, convertInquiry() authorization gap.
//
// FIXED BUG: convertInquiry() previously relied entirely on
// CaseService#createCase()'s own requireCaseCreateAccess() check (firm
// membership / team-lead / firm-admin), which never verified the
// caller is actually the lawyer this inquiry is assigned to
// (row.target_profile_id). That let any other member of the same firm
// convert an inquiry accepted by a DIFFERENT lawyer and become the
// resulting case's owner_id.
//
// The critical test is TEST B below — "same-firm non-assigned lawyer
// cannot convert accepted inquiry" — which fails against the old
// implementation (no requireOwnership() call in convertInquiry()) and
// passes after the fix.
describe('LawyerInquiryService#convertInquiry', () => {
  const ASSIGNED_LAWYER = { id: 'lawyer-assigned', role: 'lawyer' } as unknown as AuthUser;
  const OTHER_FIRM_LAWYER = { id: 'lawyer-other-firm-member', role: 'lawyer' } as unknown as AuthUser;

  const ACCEPTED_ROW = {
    ...BASE_ROW,
    status: 'accepted' as const,
    target_profile_id: ASSIGNED_LAWYER.id,
  };

  const CREATED_CASE = { id: 'case-1', firm_id: 'firm-1', team_id: null, title: 'New Case' };
  const CONVERTED_ROW = {
    ...ACCEPTED_ROW,
    status: 'converted_to_case' as const,
    case_id: CREATED_CASE.id,
  };

  function buildConvertService(
    currentUser: AuthUser | null,
    row: (Omit<typeof ACCEPTED_ROW, 'status' | 'target_profile_id'> & {
      status: 'pending' | 'accepted' | 'converted_to_case';
      target_profile_id: string | null;
    }) | null,
    repositoryOverrides: Partial<LawyerInquiryRepository> = {}
  ) {
    const repository = {
      findById: vi.fn().mockResolvedValue(row),
      convert: vi.fn().mockResolvedValue(CONVERTED_ROW),
      ...repositoryOverrides,
    } as unknown as LawyerInquiryRepository;

    const firmMemberRepository = {} as unknown as FirmMemberRepository;
    const caseService = {
      createCase: vi.fn().mockResolvedValue(CREATED_CASE),
    } as unknown as CaseService;
    const documentService = {} as unknown as DocumentService;

    const service = new LawyerInquiryService(
      currentUser,
      repository,
      firmMemberRepository,
      caseService,
      documentService
    );

    return { service, repository, caseService };
  }

  it('TEST A — the assigned lawyer can convert their own accepted inquiry', async () => {
    const { service, repository, caseService } = buildConvertService(ASSIGNED_LAWYER, ACCEPTED_ROW);

    const result = await service.convertInquiry('inquiry-1', 'New Case');

    expect(caseService.createCase).toHaveBeenCalledWith({
      firmId: 'firm-1',
      teamId: null,
      title: 'New Case',
    });
    expect(repository.convert).toHaveBeenCalledWith('inquiry-1', CREATED_CASE.id);
    expect(result.status).toBe('converted_to_case');
  });

  it('TEST B (CRITICAL) — a same-firm lawyer who is NOT the assigned lawyer cannot convert the inquiry', async () => {
    const { service, repository, caseService } = buildConvertService(OTHER_FIRM_LAWYER, ACCEPTED_ROW);

    await expect(service.convertInquiry('inquiry-1', 'New Case')).rejects.toThrow(AuthorizationError);

    // Authorization must happen BEFORE case creation — no case may be
    // created, and no conversion recorded, on a rejected attempt.
    expect(caseService.createCase).not.toHaveBeenCalled();
    expect(repository.convert).not.toHaveBeenCalled();
  });

  it('TEST C — an unauthenticated caller cannot convert', async () => {
    const { service, repository, caseService } = buildConvertService(null, ACCEPTED_ROW);

    await expect(service.convertInquiry('inquiry-1', 'New Case')).rejects.toThrow(AuthenticationError);

    expect(repository.findById).not.toHaveBeenCalled();
    expect(caseService.createCase).not.toHaveBeenCalled();
  });

  it('TEST D — a non-accepted (pending) inquiry cannot be converted, even by the assigned lawyer', async () => {
    const PENDING_ROW = { ...ACCEPTED_ROW, status: 'pending' as const };
    const { service, caseService } = buildConvertService(ASSIGNED_LAWYER, PENDING_ROW);

    await expect(service.convertInquiry('inquiry-1', 'New Case')).rejects.toThrow(ConflictError);
    expect(caseService.createCase).not.toHaveBeenCalled();
  });

  it('TEST E — an already-converted inquiry cannot be converted again', async () => {
    const { service, caseService } = buildConvertService(ASSIGNED_LAWYER, CONVERTED_ROW);

    await expect(service.convertInquiry('inquiry-1', 'New Case')).rejects.toThrow(ConflictError);
    expect(caseService.createCase).not.toHaveBeenCalled();
  });

  it('TEST F — an unassigned accepted-in-appearance inquiry (target_profile_id null) cannot be converted', async () => {
    // Defensive case: an inquiry can't normally reach 'accepted' status
    // without target_profile_id being set (acceptInquiry() requires it),
    // but convertInquiry() must not trust that invariant blindly.
    const UNASSIGNED_ROW = { ...ACCEPTED_ROW, target_profile_id: null };
    const { service, caseService } = buildConvertService(ASSIGNED_LAWYER, UNASSIGNED_ROW);

    await expect(service.convertInquiry('inquiry-1', 'New Case')).rejects.toThrow(AuthorizationError);
    expect(caseService.createCase).not.toHaveBeenCalled();
  });
});

// Soft decline (pre-acceptance review). declineInquiry() now calls the atomic
// decline_lawyer_inquiry() function through repository.declineAtomic(); the row
// is kept with reviewer + timestamp. Authority is unchanged for an inquiry
// addressed to a lawyer, and a firm owner/admin may now decline a firm-routed
// (unassigned) inquiry.
describe('LawyerInquiryService#declineInquiry', () => {
  const ASSIGNED_LAWYER = { id: 'lawyer-assigned', role: 'lawyer' } as unknown as AuthUser;
  const OTHER_FIRM_LAWYER = { id: 'lawyer-other-firm-member', role: 'lawyer' } as unknown as AuthUser;
  const FIRM_ADMIN = { id: 'firm-admin', role: 'law_firm' } as unknown as AuthUser;

  const PENDING_ROW = {
    ...BASE_ROW,
    status: 'pending' as const,
    target_profile_id: ASSIGNED_LAWYER.id,
    decision: null,
    decided_by: null,
  };

  function buildDeclineService(
    currentUser: AuthUser | null,
    row: Record<string, unknown> | null,
    options: { firmRole?: string | null; declineAtomic?: ReturnType<typeof vi.fn> } = {}
  ) {
    const repository = {
      findById: vi.fn().mockResolvedValue(row),
      declineAtomic:
        options.declineAtomic ??
        vi.fn().mockResolvedValue({ inquiry_id: 'inquiry-1', already_declined: false }),
    } as unknown as LawyerInquiryRepository;

    const firmMemberRepository = {
      findByFirmAndProfile: vi.fn().mockResolvedValue(options.firmRole ?? null),
    } as unknown as FirmMemberRepository;
    const caseService = {} as unknown as CaseService;
    const documentService = {} as unknown as DocumentService;

    const service = new LawyerInquiryService(
      currentUser,
      repository,
      firmMemberRepository,
      caseService,
      documentService
    );

    return { service, repository };
  }

  it('TEST G — the assigned lawyer declining a pending inquiry records the decline through the atomic function', async () => {
    const { service, repository } = buildDeclineService(ASSIGNED_LAWYER, PENDING_ROW);

    await service.declineInquiry('inquiry-1', { note: 'conflict of interest' });

    expect(repository.declineAtomic).toHaveBeenCalledTimes(1);
    expect(repository.declineAtomic).toHaveBeenCalledWith('inquiry-1', ASSIGNED_LAWYER.id, 'conflict of interest');
  });

  it('TEST H — a same-firm lawyer who is NOT the assigned lawyer cannot decline the inquiry', async () => {
    const { service, repository } = buildDeclineService(OTHER_FIRM_LAWYER, PENDING_ROW, { firmRole: 'lawyer' });

    await expect(service.declineInquiry('inquiry-1')).rejects.toThrow(AuthorizationError);
    expect(repository.declineAtomic).not.toHaveBeenCalled();
  });

  it('TEST I — a lawyer at a different firm entirely cannot decline the inquiry', async () => {
    const OTHER = { id: 'lawyer-elsewhere', role: 'lawyer' } as unknown as AuthUser;
    const { service, repository } = buildDeclineService(OTHER, PENDING_ROW);

    await expect(service.declineInquiry('inquiry-1')).rejects.toThrow(AuthorizationError);
    expect(repository.declineAtomic).not.toHaveBeenCalled();
  });

  it('TEST J — an unauthenticated caller cannot decline', async () => {
    const { service, repository } = buildDeclineService(null, PENDING_ROW);

    await expect(service.declineInquiry('inquiry-1')).rejects.toThrow(AuthenticationError);
    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.declineAtomic).not.toHaveBeenCalled();
  });

  it('TEST K — a missing inquiry resolves silently (unchanged semantics)', async () => {
    const { service, repository } = buildDeclineService(ASSIGNED_LAWYER, null);

    await expect(service.declineInquiry('inquiry-missing')).resolves.toBeUndefined();
    expect(repository.declineAtomic).not.toHaveBeenCalled();
  });

  it('TEST L — a firm-routed inquiry (no assigned lawyer) cannot be declined by a non-member, an employee or a plain firm lawyer', async () => {
    const UNASSIGNED = { ...PENDING_ROW, target_profile_id: null };

    for (const firmRole of [null, 'employee', 'lawyer']) {
      const { service, repository } = buildDeclineService(ASSIGNED_LAWYER, UNASSIGNED, { firmRole });
      await expect(service.declineInquiry('inquiry-1')).rejects.toThrow(AuthorizationError);
      expect(repository.declineAtomic).not.toHaveBeenCalled();
    }
  });

  it('TEST L2 — a firm owner or admin can decline a firm-routed inquiry', async () => {
    const UNASSIGNED = { ...PENDING_ROW, target_profile_id: null };

    for (const firmRole of ['owner', 'admin']) {
      const { service, repository } = buildDeclineService(FIRM_ADMIN, UNASSIGNED, { firmRole });
      await service.declineInquiry('inquiry-1');
      expect(repository.declineAtomic).toHaveBeenCalledWith('inquiry-1', FIRM_ADMIN.id, null);
    }
  });

  it('TEST M — declining an already-accepted inquiry surfaces a Conflict from the database function, not a 500', async () => {
    const declineAtomic = vi.fn().mockRejectedValue({ message: 'inquiry_already_accepted', code: '55000' });
    const { service } = buildDeclineService(
      ASSIGNED_LAWYER,
      { ...PENDING_ROW, status: 'accepted', decision: 'accepted', decided_by: ASSIGNED_LAWYER.id },
      { declineAtomic }
    );

    await expect(service.declineInquiry('inquiry-1')).rejects.toThrow(ConflictError);
  });

  it('TEST M2 — an unrecognised database error is not disguised as a 4xx', async () => {
    const boom = { message: 'connection reset', code: '08006' };
    const { service } = buildDeclineService(ASSIGNED_LAWYER, PENDING_ROW, {
      declineAtomic: vi.fn().mockRejectedValue(boom),
    });

    await expect(service.declineInquiry('inquiry-1')).rejects.toBe(boom);
  });
});

describe('LawyerInquiryService#acceptInquiry', () => {
  const LAWYER = { id: 'lawyer-assigned', role: 'lawyer' } as unknown as AuthUser;
  const ADMIN = { id: 'firm-admin', role: 'law_firm' } as unknown as AuthUser;
  const PENDING = {
    ...BASE_ROW,
    status: 'pending' as const,
    target_profile_id: LAWYER.id,
    decision: null,
    decided_by: null,
    case_id: null,
    decided_at: null,
    review_expires_at: '2026-10-24T00:00:00.000Z',
  };

  function build(currentUser: AuthUser | null, row: Record<string, unknown> | null, firmRole: string | null = null) {
    const accepted = { ...(row ?? {}), status: 'accepted', decision: 'accepted', case_id: 'case-1' };
    const repository = {
      findById: vi.fn().mockResolvedValueOnce(row).mockResolvedValue(accepted),
      listDocumentsForInquiry: vi.fn().mockResolvedValue([{ file_name: 'agreement.pdf' }]),
      ensureDocumentRow: vi.fn().mockResolvedValue(undefined),
      acceptAtomic: vi.fn().mockResolvedValue({ case_id: 'case-1', already_accepted: false }),
    } as unknown as LawyerInquiryRepository;
    const caseService = { assertCanCreateCase: vi.fn().mockResolvedValue(undefined) } as unknown as CaseService;
    const firmMemberRepository = {
      findByFirmAndProfile: vi.fn().mockResolvedValue(firmRole),
    } as unknown as FirmMemberRepository;
    const service = new LawyerInquiryService(currentUser, repository, firmMemberRepository, caseService, {} as unknown as DocumentService);
    return { service, repository, caseService };
  }

  it('the assigned lawyer accepts through the atomic function and gets the case back on the listing', async () => {
    const { service, repository, caseService } = build(LAWYER, PENDING);

    const result = await service.acceptInquiry('inquiry-1');

    expect(caseService.assertCanCreateCase).toHaveBeenCalledWith(PENDING.target_firm_id, null);
    expect(repository.acceptAtomic).toHaveBeenCalledWith({
      inquiryId: 'inquiry-1',
      actorId: LAWYER.id,
      assigneeId: null,
      teamId: null,
      title: 'Inquiry: agreement.pdf',
    });
    expect(result.caseId).toBe('case-1');
    expect(result.status).toBe('accepted');
  });

  it('makes sure the inquiry has its document rows before the case is created, and not for an unauthorized caller', async () => {
    const ok = build(LAWYER, PENDING);
    await ok.service.acceptInquiry('inquiry-1');
    expect(ok.repository.ensureDocumentRow).toHaveBeenCalledWith(PENDING);

    const denied = build({ id: 'someone-else', role: 'lawyer' } as unknown as AuthUser, PENDING);
    await expect(denied.service.acceptInquiry('inquiry-1')).rejects.toThrow(AuthorizationError);
    expect(denied.repository.ensureDocumentRow).not.toHaveBeenCalled();
  });

  it('a listing never carries the report or the storage path', async () => {
    const { service } = build(LAWYER, PENDING);

    const result = await service.acceptInquiry('inquiry-1');

    expect(result).not.toHaveProperty('analysisResult');
    expect(result).not.toHaveProperty('documentStoragePath');
  });

  it('an unrelated lawyer cannot accept and nothing is written', async () => {
    const { service, repository } = build({ id: 'someone-else', role: 'lawyer' } as unknown as AuthUser, PENDING);

    await expect(service.acceptInquiry('inquiry-1')).rejects.toThrow(AuthorizationError);
    expect(repository.acceptAtomic).not.toHaveBeenCalled();
  });

  it('an employee of the firm cannot accept a firm-routed inquiry', async () => {
    const { service, repository } = build(ADMIN, { ...PENDING, target_profile_id: null }, 'employee');

    await expect(service.acceptInquiry('inquiry-1', { assigneeProfileId: 'lawyer-2' })).rejects.toThrow(AuthorizationError);
    expect(repository.acceptAtomic).not.toHaveBeenCalled();
  });

  it('a firm admin accepts a firm-routed inquiry and passes the chosen assignee and team', async () => {
    const { service, repository } = build(ADMIN, { ...PENDING, target_profile_id: null }, 'admin');

    await service.acceptInquiry('inquiry-1', { assigneeProfileId: 'lawyer-2', teamId: 'team-1', title: '  Matter X ' });

    expect(repository.acceptAtomic).toHaveBeenCalledWith({
      inquiryId: 'inquiry-1',
      actorId: ADMIN.id,
      assigneeId: 'lawyer-2',
      teamId: 'team-1',
      title: 'Matter X',
    });
  });

  it('missing assignee on a firm-routed inquiry is a validation error from the database function', async () => {
    const { service, repository } = build(ADMIN, { ...PENDING, target_profile_id: null }, 'owner');
    (repository.acceptAtomic as ReturnType<typeof vi.fn>).mockRejectedValue({ message: 'assignee_required', code: '22023' });

    await expect(service.acceptInquiry('inquiry-1')).rejects.toThrow(ValidationError);
  });

  it('an expired window and a declined inquiry both surface as Conflict', async () => {
    for (const message of ['review_window_expired', 'inquiry_declined']) {
      const { service, repository } = build(LAWYER, PENDING);
      (repository.acceptAtomic as ReturnType<typeof vi.fn>).mockRejectedValue({ message, code: '55000' });
      await expect(service.acceptInquiry('inquiry-1')).rejects.toThrow(ConflictError);
    }
  });

  it('a repeat accept by the decider skips the create-access check and returns the existing case', async () => {
    const accepted = { ...PENDING, status: 'accepted', decision: 'accepted', decided_by: LAWYER.id, case_id: 'case-1' };
    const { service, repository, caseService } = build(LAWYER, accepted);

    const result = await service.acceptInquiry('inquiry-1');

    expect(caseService.assertCanCreateCase).not.toHaveBeenCalled();
    expect(repository.acceptAtomic).toHaveBeenCalledTimes(1);
    expect(result.caseId).toBe('case-1');
  });

  it('an unauthenticated caller is rejected before any lookup', async () => {
    const { service, repository } = build(null, PENDING);

    await expect(service.acceptInquiry('inquiry-1')).rejects.toThrow(AuthenticationError);
    expect(repository.findById).not.toHaveBeenCalled();
  });
});

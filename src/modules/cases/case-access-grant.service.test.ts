// src/modules/cases/case-access-grant.service.test.ts
//
// FOUNDATION TASK 2 — Case Assignment & Access Architecture.
//
// Covers assignCase() / reassignCase() / removeAssignment() — the new
// lawyer-assignment entry points — against the task's own CASE ACCESS
// TEST numbering where a test maps cleanly onto service-layer behavior.
// TESTs 1-2-5-6 are primarily RLS-level (cases_select / has_case_grant /
// is_firm_case_manager) and were verified directly against the live
// database rather than re-asserted here; this suite focuses on what the
// service layer alone is responsible for: TEST 8 (cross-firm assignment
// rejection) and the authorization gate assignCase/reassignCase/
// removeAssignment all share with the pre-existing issueGrant/revokeGrant.

vi.mock('server-only', () => ({}));

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AuthenticationError, AuthorizationError, NotFoundError, ValidationError } from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';

import { CaseAccessGrantService } from './case-access-grant.service';

const FIRM_ID = 'firm-1';
const OTHER_FIRM_ID = 'firm-2';
const CASE_ID = 'case-1';

const CASE_OWNER = { id: 'owner-1', role: 'lawyer' } as unknown as AuthUser;
const FIRM_ADMIN = { id: 'admin-1', role: 'lawyer' } as unknown as AuthUser;
const PLAIN_LAWYER = { id: 'lawyer-plain-1', role: 'lawyer' } as unknown as AuthUser;

const SAME_FIRM_LAWYER_ID = 'lawyer-same-firm-1';
const CROSS_FIRM_LAWYER_ID = 'lawyer-other-firm-1';

const CASE_ROW = { id: CASE_ID, firm_id: FIRM_ID, team_id: null, owner_id: CASE_OWNER.id };

function buildMocks() {
  const caseAccessGrantRepository = {
    create: vi.fn(),
    update: vi.fn(),
    findActiveGrantForCaseAndProfile: vi.fn(),
    findActiveGrantsForCase: vi.fn(),
    findActiveGrantsForProfile: vi.fn(),
    findByIdOrThrow: vi.fn(),
  };

  const caseRepository = {
    findByIdOrThrow: vi.fn(),
  };

  const teamMemberRepository = {
    findRowByTeamAndProfile: vi.fn(),
  };

  const firmMemberRepository = {
    findByFirmAndProfile: vi.fn(),
  };

  const auditLogRepository = {
    recordUserAction: vi.fn(),
  };

  return {
    caseAccessGrantRepository,
    caseRepository,
    teamMemberRepository,
    firmMemberRepository,
    auditLogRepository,
  };
}

function buildService(currentUser: AuthUser | null, mocks: ReturnType<typeof buildMocks>) {
  return new CaseAccessGrantService(
    currentUser,
    mocks.caseAccessGrantRepository as never,
    mocks.caseRepository as never,
    mocks.teamMemberRepository as never,
    mocks.firmMemberRepository as never,
    mocks.auditLogRepository as never,
  );
}

describe('CaseAccessGrantService', () => {
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = buildMocks();
    mocks.caseRepository.findByIdOrThrow.mockResolvedValue(CASE_ROW);
  });

  describe('assignCase', () => {
    it('throws AuthenticationError when there is no current user', async () => {
      const service = buildService(null, mocks);
      await expect(
        service.assignCase({ caseId: CASE_ID, lawyerId: SAME_FIRM_LAWYER_ID }),
      ).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('throws AuthorizationError when the caller is not the case owner, a team lead, or a firm admin/owner (rule: caller must belong to and manage the case org)', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockResolvedValue('employee');
      const service = buildService(PLAIN_LAWYER, mocks);

      await expect(
        service.assignCase({ caseId: CASE_ID, lawyerId: SAME_FIRM_LAWYER_ID }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      // Must fail before ever checking the target lawyer's firm membership.
      expect(mocks.caseAccessGrantRepository.create).not.toHaveBeenCalled();
    });

    it('CASE ACCESS TEST 8 — throws ValidationError when the target lawyer is not a member of the case firm (rejects cross-firm assignment)', async () => {
      // Caller is a firm admin of the case's own firm.
      mocks.firmMemberRepository.findByFirmAndProfile.mockImplementation(
        async (firmId: string, profileId: string) => {
          if (firmId === FIRM_ID && profileId === FIRM_ADMIN.id) return 'admin';
          if (firmId === FIRM_ID && profileId === CROSS_FIRM_LAWYER_ID) return null; // not a member of this firm
          return null;
        },
      );
      const service = buildService(FIRM_ADMIN, mocks);

      await expect(
        service.assignCase({ caseId: CASE_ID, lawyerId: CROSS_FIRM_LAWYER_ID }),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(mocks.caseAccessGrantRepository.create).not.toHaveBeenCalled();
    });

    it('assigns successfully when caller is firm admin and target lawyer is a member of the same firm', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockImplementation(
        async (firmId: string, profileId: string) => {
          if (firmId === FIRM_ID && profileId === FIRM_ADMIN.id) return 'admin';
          if (firmId === FIRM_ID && profileId === SAME_FIRM_LAWYER_ID) return 'lawyer';
          return null;
        },
      );
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue(null);
      const created = { id: 'grant-1', case_id: CASE_ID, grantee_id: SAME_FIRM_LAWYER_ID, access_level: 'read_write' };
      mocks.caseAccessGrantRepository.create.mockResolvedValue(created);

      const service = buildService(FIRM_ADMIN, mocks);
      const result = await service.assignCase({ caseId: CASE_ID, lawyerId: SAME_FIRM_LAWYER_ID });

      expect(mocks.caseAccessGrantRepository.create).toHaveBeenCalledWith({
        case_id: CASE_ID,
        grantee_id: SAME_FIRM_LAWYER_ID,
        granted_by: FIRM_ADMIN.id,
        access_level: 'read_write',
      });
      expect(mocks.auditLogRepository.recordUserAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'case.assignment.assign', caseId: CASE_ID, firmId: FIRM_ID }),
      );
      expect(result).toEqual(created);
    });

    it('the case OWNER may assign without any firm_members row of their own (Decision #60 parity)', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockImplementation(
        async (firmId: string, profileId: string) => {
          if (firmId === FIRM_ID && profileId === SAME_FIRM_LAWYER_ID) return 'lawyer';
          return null; // owner has no firm_members row (e.g. a personal org)
        },
      );
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue(null);
      mocks.caseAccessGrantRepository.create.mockResolvedValue({ id: 'grant-2' });

      const service = buildService(CASE_OWNER, mocks);
      await expect(
        service.assignCase({ caseId: CASE_ID, lawyerId: SAME_FIRM_LAWYER_ID }),
      ).resolves.toBeDefined();
    });

    it('is idempotent: assigning an already-actively-assigned lawyer at the same access level returns the existing grant without a duplicate create()', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockImplementation(
        async (firmId: string, profileId: string) => {
          if (firmId === FIRM_ID && profileId === FIRM_ADMIN.id) return 'admin';
          if (firmId === FIRM_ID && profileId === SAME_FIRM_LAWYER_ID) return 'lawyer';
          return null;
        },
      );
      const existing = { id: 'grant-3', case_id: CASE_ID, grantee_id: SAME_FIRM_LAWYER_ID, access_level: 'read_write' };
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue(existing);

      const service = buildService(FIRM_ADMIN, mocks);
      const result = await service.assignCase({
        caseId: CASE_ID,
        lawyerId: SAME_FIRM_LAWYER_ID,
        accessLevel: 'read_write',
      });

      expect(mocks.caseAccessGrantRepository.create).not.toHaveBeenCalled();
      expect(mocks.caseAccessGrantRepository.update).not.toHaveBeenCalled();
      expect(result).toEqual(existing);
    });

    it('updates the existing grant in place when re-assigning at a different access level, instead of creating a duplicate row', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockImplementation(
        async (firmId: string, profileId: string) => {
          if (firmId === FIRM_ID && profileId === FIRM_ADMIN.id) return 'admin';
          if (firmId === FIRM_ID && profileId === SAME_FIRM_LAWYER_ID) return 'lawyer';
          return null;
        },
      );
      const existing = { id: 'grant-4', case_id: CASE_ID, grantee_id: SAME_FIRM_LAWYER_ID, access_level: 'read' };
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue(existing);
      mocks.caseAccessGrantRepository.update.mockResolvedValue({ ...existing, access_level: 'read_write' });

      const service = buildService(FIRM_ADMIN, mocks);
      await service.assignCase({ caseId: CASE_ID, lawyerId: SAME_FIRM_LAWYER_ID, accessLevel: 'read_write' });

      expect(mocks.caseAccessGrantRepository.update).toHaveBeenCalledWith(existing.id, {
        access_level: 'read_write',
      });
      expect(mocks.caseAccessGrantRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('reassignCase', () => {
    it('rejects cross-firm reassignment the same as assignCase (TEST 8 applies identically)', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockImplementation(
        async (firmId: string, profileId: string) => {
          if (firmId === FIRM_ID && profileId === FIRM_ADMIN.id) return 'admin';
          return null;
        },
      );
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue(null);

      const service = buildService(FIRM_ADMIN, mocks);
      await expect(
        service.reassignCase({
          caseId: CASE_ID,
          fromLawyerId: SAME_FIRM_LAWYER_ID,
          toLawyerId: CROSS_FIRM_LAWYER_ID,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('revokes the prior assignee and assigns the new one', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockImplementation(
        async (firmId: string, profileId: string) => {
          if (firmId === FIRM_ID && profileId === FIRM_ADMIN.id) return 'admin';
          if (firmId === FIRM_ID && [SAME_FIRM_LAWYER_ID, 'lawyer-new-1'].includes(profileId)) return 'lawyer';
          return null;
        },
      );
      const priorGrant = { id: 'grant-5', case_id: CASE_ID, grantee_id: SAME_FIRM_LAWYER_ID, access_level: 'read_write' };
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockImplementation(
        async (_caseId: string, profileId: string) => (profileId === SAME_FIRM_LAWYER_ID ? priorGrant : null),
      );
      mocks.caseAccessGrantRepository.update.mockResolvedValue({ ...priorGrant, revoked_at: '2026-08-13T00:00:00.000Z' });
      mocks.caseAccessGrantRepository.create.mockResolvedValue({ id: 'grant-6', grantee_id: 'lawyer-new-1' });

      const service = buildService(FIRM_ADMIN, mocks);
      const result = await service.reassignCase({
        caseId: CASE_ID,
        fromLawyerId: SAME_FIRM_LAWYER_ID,
        toLawyerId: 'lawyer-new-1',
      });

      expect(mocks.caseAccessGrantRepository.update).toHaveBeenCalledWith(
        priorGrant.id,
        expect.objectContaining({ revoked_at: expect.any(String) }),
      );
      expect(mocks.caseAccessGrantRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ grantee_id: 'lawyer-new-1' }),
      );
      expect(result).toEqual({ id: 'grant-6', grantee_id: 'lawyer-new-1' });
    });

    it('does not error when the prior assignee has no active grant', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockImplementation(
        async (firmId: string, profileId: string) => {
          if (firmId === FIRM_ID && profileId === FIRM_ADMIN.id) return 'admin';
          if (firmId === FIRM_ID && profileId === 'lawyer-new-1') return 'lawyer';
          return null;
        },
      );
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue(null);
      mocks.caseAccessGrantRepository.create.mockResolvedValue({ id: 'grant-7' });

      const service = buildService(FIRM_ADMIN, mocks);
      await expect(
        service.reassignCase({ caseId: CASE_ID, fromLawyerId: 'nobody-1', toLawyerId: 'lawyer-new-1' }),
      ).resolves.toBeDefined();
      expect(mocks.caseAccessGrantRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('removeAssignment', () => {
    it('throws NotFoundError when the lawyer has no active assignment on the case', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockResolvedValue('admin');
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue(null);

      const service = buildService(FIRM_ADMIN, mocks);
      await expect(
        service.removeAssignment(CASE_ID, SAME_FIRM_LAWYER_ID),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('soft-revokes the active grant on success', async () => {
      mocks.firmMemberRepository.findByFirmAndProfile.mockResolvedValue('admin');
      const grant = { id: 'grant-8', case_id: CASE_ID, grantee_id: SAME_FIRM_LAWYER_ID };
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue(grant);
      mocks.caseAccessGrantRepository.update.mockResolvedValue({ ...grant, revoked_at: '2026-08-13T00:00:00.000Z' });

      const service = buildService(FIRM_ADMIN, mocks);
      const result = await service.removeAssignment(CASE_ID, SAME_FIRM_LAWYER_ID);

      expect(mocks.caseAccessGrantRepository.update).toHaveBeenCalledWith(
        grant.id,
        expect.objectContaining({ revoked_at: expect.any(String) }),
      );
      expect(mocks.auditLogRepository.recordUserAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'case.assignment.remove', caseId: CASE_ID }),
      );
      expect(result.revoked_at).toBeTruthy();
    });
  });

  describe('cross-firm isolation (CASE ACCESS TEST 5 parity at the service layer)', () => {
    it('a firm admin of Firm B cannot manage (and therefore cannot assign) a case owned by Firm A', async () => {
      const caseInFirmA = { ...CASE_ROW, firm_id: FIRM_ID };
      mocks.caseRepository.findByIdOrThrow.mockResolvedValue(caseInFirmA);
      // FIRM_ADMIN is admin of OTHER_FIRM_ID, not FIRM_ID.
      mocks.firmMemberRepository.findByFirmAndProfile.mockImplementation(
        async (firmId: string, profileId: string) => {
          if (firmId === OTHER_FIRM_ID && profileId === FIRM_ADMIN.id) return 'admin';
          return null;
        },
      );

      const service = buildService(FIRM_ADMIN, mocks);
      await expect(
        service.assignCase({ caseId: CASE_ID, lawyerId: SAME_FIRM_LAWYER_ID }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });
});

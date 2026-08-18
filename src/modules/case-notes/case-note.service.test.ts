// src/modules/case-notes/case-note.service.test.ts
//
// Firm-Manager Visibility Consistency Audit — Lawyer Terminal B-level
// fix. Covers the specific bug found: listNotesForCase() used to call
// requireNoteAccess() (case owner OR active READ_WRITE grantee ONLY)
// as an app-layer gate, which rejected a legitimate firm owner/admin
// with AuthorizationError even though case_notes_select's live RLS
// already grants them visibility via is_firm_case_manager(). See
// 20260818071705_fix_firm_manager_case_resource_visibility.sql's own
// header for the full RLS-side finding.
//
// Per this project's established convention (case-access-grant.service
// .test.ts's own header), the actual RLS-level visibility grant itself
// (a firm manager's SELECT reaching case_notes at all) was verified
// directly against the live database (pg_policies), not re-asserted
// here — a unit test with mocked repositories cannot exercise real
// Postgres RLS. What IS testable, and tested below, is the service-
// layer CONTRACT: listNotesForCase() must no longer throw for a caller
// who is merely authenticated and whose case is visible (trusting RLS
// to have narrowed what's visible), while createNote()'s deliberately
// narrower owner-or-read-write-grantee rule must be completely
// unaffected by this fix — a firm manager with no grant and no
// ownership can list a case's notes post-fix, but still cannot create
// one, proving the write path was not accidentally loosened.

vi.mock('server-only', () => ({}));

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AuthenticationError, AuthorizationError, NotFoundError } from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';

import { CaseNoteService } from './case-note.service';

const FIRM_ID = 'firm-1';
const CASE_ID = 'case-1';
const NOTE_ID = 'note-1';

const CASE_OWNER = { id: 'owner-1', role: 'lawyer' } as unknown as AuthUser;
const FIRM_MANAGER = { id: 'manager-1', role: 'lawyer' } as unknown as AuthUser;
const READ_WRITE_GRANTEE = { id: 'grantee-rw-1', role: 'lawyer' } as unknown as AuthUser;
const READ_ONLY_GRANTEE = { id: 'grantee-r-1', role: 'lawyer' } as unknown as AuthUser;
const UNRELATED_LAWYER = { id: 'lawyer-unrelated-1', role: 'lawyer' } as unknown as AuthUser;

const CASE_ROW = { id: CASE_ID, firm_id: FIRM_ID, owner_id: CASE_OWNER.id };

const NOTE_ROW = {
  id: NOTE_ID,
  case_id: CASE_ID,
  author_id: CASE_OWNER.id,
  content: 'hello',
};

function buildMocks() {
  const caseNoteRepository = {
    findByCaseId: vi.fn(),
    findByIdOrThrow: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const caseRepository = {
    findByIdOrThrow: vi.fn(),
  };

  const caseAccessGrantRepository = {
    findActiveGrantForCaseAndProfile: vi.fn(),
  };

  const auditLogRepository = {
    recordUserAction: vi.fn(),
  };

  return { caseNoteRepository, caseRepository, caseAccessGrantRepository, auditLogRepository };
}

function buildService(currentUser: AuthUser | null, mocks: ReturnType<typeof buildMocks>) {
  return new CaseNoteService(
    currentUser,
    mocks.caseNoteRepository as never,
    mocks.caseRepository as never,
    mocks.caseAccessGrantRepository as never,
    mocks.auditLogRepository as never,
  );
}

describe('CaseNoteService', () => {
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = buildMocks();
    mocks.caseRepository.findByIdOrThrow.mockResolvedValue(CASE_ROW);
  });

  describe('listNotesForCase() — RLS-is-the-backstop, post-fix', () => {
    it('THE FIX: does not throw for a firm manager who owns nothing and holds no grant — RLS narrows visibility, not this service', async () => {
      mocks.caseNoteRepository.findByCaseId.mockResolvedValue([NOTE_ROW]);

      const service = buildService(FIRM_MANAGER, mocks);

      await expect(service.listNotesForCase(CASE_ID)).resolves.toEqual([NOTE_ROW]);
      // No grant lookup performed anymore for the list path -- proves
      // the old requireNoteAccess() app-layer gate is gone from here.
      expect(mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile).not.toHaveBeenCalled();
    });

    it('REGRESSION GUARD: still works for the case owner', async () => {
      mocks.caseNoteRepository.findByCaseId.mockResolvedValue([NOTE_ROW]);

      const service = buildService(CASE_OWNER, mocks);

      await expect(service.listNotesForCase(CASE_ID)).resolves.toEqual([NOTE_ROW]);
    });

    it('REGRESSION GUARD: still works for an active read_write grantee', async () => {
      mocks.caseNoteRepository.findByCaseId.mockResolvedValue([NOTE_ROW]);

      const service = buildService(READ_WRITE_GRANTEE, mocks);

      await expect(service.listNotesForCase(CASE_ID)).resolves.toEqual([NOTE_ROW]);
    });

    it('unauthenticated caller is still rejected with AuthenticationError, not AuthorizationError', async () => {
      const service = buildService(null, mocks);

      await expect(service.listNotesForCase(CASE_ID)).rejects.toBeInstanceOf(AuthenticationError);
      expect(mocks.caseNoteRepository.findByCaseId).not.toHaveBeenCalled();
    });

    it('a case the caller cannot see at all (RLS-invisible) still surfaces as NotFoundError via findByIdOrThrow', async () => {
      mocks.caseRepository.findByIdOrThrow.mockRejectedValue(new NotFoundError('cases', CASE_ID));

      const service = buildService(UNRELATED_LAWYER, mocks);

      await expect(service.listNotesForCase(CASE_ID)).rejects.toBeInstanceOf(NotFoundError);
      expect(mocks.caseNoteRepository.findByCaseId).not.toHaveBeenCalled();
    });
  });

  describe('createNote() — write path deliberately untouched by this fix', () => {
    it('WRITE PATH STAYS NARROW: a firm manager with no ownership and no grant still cannot create a note', async () => {
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue(null);

      const service = buildService(FIRM_MANAGER, mocks);

      await expect(
        service.createNote({ caseId: CASE_ID, content: 'hi' }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(mocks.caseNoteRepository.create).not.toHaveBeenCalled();
    });

    it('a read-only grantee still cannot create a note', async () => {
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue({
        access_level: 'read',
        revoked_at: null,
      });

      const service = buildService(READ_ONLY_GRANTEE, mocks);

      await expect(
        service.createNote({ caseId: CASE_ID, content: 'hi' }),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(mocks.caseNoteRepository.create).not.toHaveBeenCalled();
    });

    it('the case owner can create a note', async () => {
      mocks.caseNoteRepository.create.mockResolvedValue(NOTE_ROW);

      const service = buildService(CASE_OWNER, mocks);

      await expect(
        service.createNote({ caseId: CASE_ID, content: 'hi' }),
      ).resolves.toEqual(NOTE_ROW);
      expect(mocks.auditLogRepository.recordUserAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'note.create', firmId: FIRM_ID }),
      );
    });

    it('an active read_write grantee can create a note', async () => {
      mocks.caseAccessGrantRepository.findActiveGrantForCaseAndProfile.mockResolvedValue({
        access_level: 'read_write',
        revoked_at: null,
      });
      mocks.caseNoteRepository.create.mockResolvedValue(NOTE_ROW);

      const service = buildService(READ_WRITE_GRANTEE, mocks);

      await expect(
        service.createNote({ caseId: CASE_ID, content: 'hi' }),
      ).resolves.toEqual(NOTE_ROW);
    });
  });
});

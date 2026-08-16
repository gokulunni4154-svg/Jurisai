// src/modules/documents/document.service.trash.test.ts
//
// NEW — Trash: Restore & Permanent delete (Amendment #16). Covers
// DocumentService.restoreDocument() / permanentlyDeleteDocument() only
// — a focused suite for this session's two new methods, not a full
// re-test of DocumentService (createDocument/updateDocument/etc. are
// unchanged and untested here, matching this project's existing
// per-feature test-file convention, e.g.
// case-access-grant.service.test.ts alongside case.service.ts).
//
// Same `vi.mock('server-only', ...)` workaround as
// case-access-grant.service.test.ts — DocumentService (like every
// Service in this project) imports 'server-only' at module scope,
// which throws outside a real Next.js server context unless mocked
// out first, before any of this file's other imports run.

vi.mock('server-only', () => ({}));

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AuthenticationError, AuthorizationError, ConflictError, NotFoundError } from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';

import { DocumentService } from './document.service';

const OWNER = { id: '11111111-1111-4111-8111-111111111111', role: 'lawyer' } as unknown as AuthUser;
const OTHER_USER = {
  id: '22222222-2222-4222-8222-222222222222',
  role: 'lawyer',
} as unknown as AuthUser;

// documentIdParamSchema (documents.schemas.ts) requires a real UUID, same
// as every other id-bearing schema in this project — a plain 'doc-1'
// style fixture (fine for services that don't validate id shape) would
// fail Zod's .uuid() check here.
const DOC_ID = '33333333-3333-4333-8333-333333333333';
const STORAGE_PATH = `${OWNER.id}/${DOC_ID}/contract.pdf`;

const TRASHED_DOC = {
  id: DOC_ID,
  owner_id: OWNER.id,
  title: 'Contract.pdf',
  storage_path: STORAGE_PATH,
  deleted_at: '2026-08-01T00:00:00.000Z',
};

const ACTIVE_DOC = { ...TRASHED_DOC, deleted_at: null };

function buildMocks() {
  const documentRepository = {
    findByIdOrThrow: vi.fn(),
    restore: vi.fn(),
    hardDelete: vi.fn(),
    removeStorageObject: vi.fn(),
  };

  const notificationService = {
    createNotification: vi.fn(),
  };

  const auditLogRepository = {
    recordUserAction: vi.fn(),
  };

  return { documentRepository, notificationService, auditLogRepository };
}

function buildService(currentUser: AuthUser | null, mocks: ReturnType<typeof buildMocks>) {
  return new DocumentService(
    currentUser,
    mocks.documentRepository as never,
    mocks.notificationService as never,
    mocks.auditLogRepository as never,
  );
}

describe('DocumentService', () => {
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = buildMocks();
  });

  describe('restoreDocument', () => {
    it('throws AuthenticationError when there is no current user', async () => {
      const service = buildService(null, mocks);
      await expect(service.restoreDocument({ id: DOC_ID })).rejects.toBeInstanceOf(
        AuthenticationError,
      );
      expect(mocks.documentRepository.findByIdOrThrow).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when the document does not exist / is not visible', async () => {
      mocks.documentRepository.findByIdOrThrow.mockRejectedValue(new NotFoundError('documents', DOC_ID));
      const service = buildService(OWNER, mocks);

      await expect(service.restoreDocument({ id: DOC_ID })).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws ConflictError when the document is not currently in the trash', async () => {
      mocks.documentRepository.findByIdOrThrow.mockResolvedValue(ACTIVE_DOC);
      const service = buildService(OWNER, mocks);

      await expect(service.restoreDocument({ id: DOC_ID })).rejects.toBeInstanceOf(ConflictError);
      expect(mocks.documentRepository.restore).not.toHaveBeenCalled();
    });

    it('throws AuthorizationError when the caller is not the document owner', async () => {
      mocks.documentRepository.findByIdOrThrow.mockResolvedValue(TRASHED_DOC);
      const service = buildService(OTHER_USER, mocks);

      await expect(service.restoreDocument({ id: DOC_ID })).rejects.toBeInstanceOf(AuthorizationError);
      expect(mocks.documentRepository.restore).not.toHaveBeenCalled();
    });

    it('restores the document and records an audit entry when the owner restores a trashed document', async () => {
      mocks.documentRepository.findByIdOrThrow.mockResolvedValue(TRASHED_DOC);
      mocks.documentRepository.restore.mockResolvedValue(ACTIVE_DOC);
      const service = buildService(OWNER, mocks);

      const result = await service.restoreDocument({ id: DOC_ID });

      expect(result).toEqual(ACTIVE_DOC);
      expect(mocks.documentRepository.restore).toHaveBeenCalledWith(DOC_ID);
      expect(mocks.auditLogRepository.recordUserAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: OWNER.id,
          action: 'documents.restore',
          resourceType: 'document',
          resourceId: DOC_ID,
        }),
      );
    });
  });

  describe('permanentlyDeleteDocument', () => {
    it('throws AuthenticationError when there is no current user', async () => {
      const service = buildService(null, mocks);
      await expect(service.permanentlyDeleteDocument({ id: DOC_ID })).rejects.toBeInstanceOf(
        AuthenticationError,
      );
      expect(mocks.documentRepository.findByIdOrThrow).not.toHaveBeenCalled();
    });

    it('throws ConflictError when the document is not currently in the trash', async () => {
      mocks.documentRepository.findByIdOrThrow.mockResolvedValue(ACTIVE_DOC);
      const service = buildService(OWNER, mocks);

      await expect(service.permanentlyDeleteDocument({ id: DOC_ID })).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(mocks.documentRepository.hardDelete).not.toHaveBeenCalled();
    });

    it('throws AuthorizationError when the caller is not the document owner', async () => {
      mocks.documentRepository.findByIdOrThrow.mockResolvedValue(TRASHED_DOC);
      const service = buildService(OTHER_USER, mocks);

      await expect(service.permanentlyDeleteDocument({ id: DOC_ID })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
      expect(mocks.documentRepository.hardDelete).not.toHaveBeenCalled();
    });

    it('hard-deletes the row, removes the Storage object, and records an audit entry, in that order', async () => {
      mocks.documentRepository.findByIdOrThrow.mockResolvedValue(TRASHED_DOC);
      mocks.documentRepository.hardDelete.mockResolvedValue(TRASHED_DOC);
      mocks.documentRepository.removeStorageObject.mockResolvedValue(true);
      const service = buildService(OWNER, mocks);

      await service.permanentlyDeleteDocument({ id: DOC_ID });

      expect(mocks.documentRepository.hardDelete).toHaveBeenCalledWith(DOC_ID);
      expect(mocks.documentRepository.removeStorageObject).toHaveBeenCalledWith(STORAGE_PATH);
      expect(mocks.auditLogRepository.recordUserAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: OWNER.id,
          action: 'documents.permanent_delete',
          resourceType: 'document',
          resourceId: DOC_ID,
          metadata: { storagePath: STORAGE_PATH },
        }),
      );

      // hardDelete must resolve before removeStorageObject is even called,
      // matching the ordering decision documented on the service method
      // itself (row is the source of truth; Storage cleanup is best-effort
      // and happens second).
      const hardDeleteOrder = mocks.documentRepository.hardDelete.mock.invocationCallOrder.at(0) ?? -1;
      const removeStorageOrder =
        mocks.documentRepository.removeStorageObject.mock.invocationCallOrder.at(0) ?? -1;
      expect(hardDeleteOrder).toBeGreaterThanOrEqual(0);
      expect(hardDeleteOrder).toBeLessThan(removeStorageOrder);
    });

    it('still resolves (does not throw) when Storage removal fails, per removeStorageObject’s accepted-risk contract', async () => {
      mocks.documentRepository.findByIdOrThrow.mockResolvedValue(TRASHED_DOC);
      mocks.documentRepository.hardDelete.mockResolvedValue(TRASHED_DOC);
      mocks.documentRepository.removeStorageObject.mockResolvedValue(false);
      const service = buildService(OWNER, mocks);

      await expect(service.permanentlyDeleteDocument({ id: DOC_ID })).resolves.toBeUndefined();
      expect(mocks.auditLogRepository.recordUserAction).toHaveBeenCalled();
    });
  });
});

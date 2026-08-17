// src/modules/documents/document.service.create.test.ts
//
// NEW — General Portal Phase 2 (Upload → Analyze quick flow). Focused
// suite for DocumentService.createDocument() only, matching this
// project's existing per-feature test-file convention (see
// document.service.trash.test.ts's own header comment for the same
// reasoning — updateDocument/getDocumentById/etc. are unchanged and
// untested here).
//
// WHY THIS TEST, SPECIFICALLY: createDocument() is the one place the
// new dashboard Upload → Analyze flow (src/shared/components/dashboard/
// upload-analyze-modal.tsx) writes a document row, and its own doc
// comment (document.service.ts, Amendment #15's neighboring code)
// states the storage-path-ownership check is what stands between a
// client-supplied owner and a real cross-user write — exactly Security
// Test Matrix items #1 (owner can upload), #5 (unauthenticated cannot),
// and #6 (client-supplied owner_id is ignored/not trusted). No new
// authorization logic was written for this feature — createDocument()
// itself is untouched — but no test existed for this check before now,
// so one is added rather than only "reasoned about" in the report.
//
// Same `vi.mock('server-only', ...)` workaround as
// document.service.trash.test.ts — required before any other import in
// this file runs.

vi.mock('server-only', () => ({}));

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AuthenticationError, AuthorizationError } from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';

import { DocumentService } from './document.service';

const OWNER = { id: '11111111-1111-4111-8111-111111111111', role: 'individual' } as unknown as AuthUser;
const OTHER_USER = {
  id: '22222222-2222-4222-8222-222222222222',
  role: 'individual',
} as unknown as AuthUser;

const DOC_ID = '33333333-3333-4333-8333-333333333333';

const CREATED_ROW = {
  id: DOC_ID,
  owner_id: OWNER.id,
  title: 'Contract.pdf',
  storage_path: `${OWNER.id}/${DOC_ID}/contract.pdf`,
  mime_type: 'application/pdf',
  size_bytes: 1024,
  deleted_at: null,
};

function buildMocks() {
  const documentRepository = {
    create: vi.fn().mockResolvedValue(CREATED_ROW),
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

describe('DocumentService#createDocument', () => {
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    mocks = buildMocks();
  });

  // Security Test Matrix #1 — User A uploads a document → allowed, and
  // the row is created with User A's own id, derived server-side.
  it('creates the document with owner_id derived from the authenticated session', async () => {
    const service = buildService(OWNER, mocks);

    const result = await service.createDocument({
      title: 'Contract.pdf',
      storagePath: `${OWNER.id}/${DOC_ID}/contract.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    expect(result).toEqual(CREATED_ROW);
    expect(mocks.documentRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: OWNER.id }),
    );
  });

  // Security Test Matrix #6 — a client-supplied owner cannot be
  // smuggled in via the storage path. The service does not accept an
  // ownerId field at all (createDocumentSchema has none); this proves
  // the *storage path's* owner segment — the only other place an
  // attacker could try to assert a different identity — is checked
  // against the real session, not trusted.
  it('rejects a storage path whose owner segment does not match the authenticated user', async () => {
    const service = buildService(OTHER_USER, mocks);

    await expect(
      service.createDocument({
        title: 'Contract.pdf',
        // Path claims to belong to OWNER, but the session is OTHER_USER.
        storagePath: `${OWNER.id}/${DOC_ID}/contract.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(mocks.documentRepository.create).not.toHaveBeenCalled();
  });

  // Security Test Matrix #5 — unauthenticated cannot upload through the
  // authenticated API.
  it('rejects an unauthenticated request', async () => {
    const service = buildService(null, mocks);

    await expect(
      service.createDocument({
        title: 'Contract.pdf',
        storagePath: `${OWNER.id}/${DOC_ID}/contract.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);

    expect(mocks.documentRepository.create).not.toHaveBeenCalled();
  });
});

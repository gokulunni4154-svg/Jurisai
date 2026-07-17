// src/modules/clause-classification/clause-classification.service.test.ts
// Tests for File 96 — clause-classification.service.ts
//
// TEMPLATE NOTE (read this before writing the next module's service
// tests): this suite's structure is meant to generalize directly to
// Risk Detection, Missing Clause Detection, Compliance Detection, and
// AI Recommendation — all four share this exact shape (one repository +
// one or two upstream *Service collaborators + generateWithFallback).
// Reusable pieces, in order:
//
//   1. `vi.mock('@/core/ai/ai-provider.factory', ...)` at module scope —
//      always mock generateWithFallback this way, never call the real
//      one.
//   2. `buildMocks()` — constructs fresh vi.fn() stand-ins for every
//      collaborator method the service actually calls (confirmed against
//      real pasted source only — do not mock a method you haven't seen
//      the real signature of).
//   3. `buildService(currentUser)` — constructs the real service class
//      with the mocked collaborators injected via its real constructor.
//   4. Auth/ownership tests always come first, using a shared
//      AUTHENTICATED_USER / OTHER_USER fixture pair.
//   5. Read-method tests (list/get/getLatestCompleted) follow the
//      "re-validate the parent, then act" pattern almost every module in
//      this codebase uses — assert both the delegation AND the
//      cross-resource mismatch -> NotFoundError case.
//   6. runX()/AI-call tests come last: success, one AIProviderError code
//      mapped to its user-safe message, and the non-AIProviderError
//      rethrow-after-best-effort-markFailed path. Legal Health Score and
//      AI Legal Insights may not have a runX() at all (worth confirming
//      their real source before assuming this section applies) — Chat
//      has no runX() equivalent either (it streams) and needs its own
//      section instead, per the class-level outlier note in
//      PROJECT_PROGRESS.md.
//
// For Legal Health Score / AI Legal Insights specifically: their
// services depend on OTHER Phase 2 services as data sources rather than
// only gating access to one parent, per the module list. Confirm each
// one's real dependency shape before assuming this exact mock shape
// transfers unchanged.

import { describe, expect, it, vi, beforeEach } from 'vitest';

// clause-classification.service.ts (File 96) starts with `import
// 'server-only'`, which throws unconditionally unless something tells
// the runtime this is a legitimate server context. Vitest's node
// environment doesn't set that up automatically — mock the package to a
// no-op BEFORE anything else is imported, so the throw never fires. This
// mock is required in every one of this template's downstream service
// test files (Risk Detection, Missing Clause Detection, Compliance
// Detection, AI Recommendation, Legal Health Score, AI Legal Insights,
// Chat) since every real service file in this project starts the same
// way — copy this block first, not last.
vi.mock('server-only', () => ({}));

import {
  AIProviderError,
  AuthenticationError,
  AuthorizationError,
  ErrorCode,
  NotFoundError,
} from '@/core/errors/app-error';
import type { AuthUser } from '@/core/auth/types';

import { ClauseClassificationService } from './clause-classification.service';
import type { ClauseClassification } from './clause-classification.entity';

vi.mock('@/core/ai/ai-provider.factory', () => ({
  generateWithFallback: vi.fn(),
}));

// Imported after the mock so the mocked implementation is what's bound.
import { generateWithFallback } from '@/core/ai/ai-provider.factory';

const AUTHENTICATED_USER = { id: 'user-1', role: 'user' } as unknown as AuthUser;
const OTHER_USER_ID = 'user-2';

const DOCUMENT = { id: 'doc-1', owner_id: AUTHENTICATED_USER.id };
const ANALYSIS = { id: 'analysis-1', document_id: DOCUMENT.id };

function buildClassification(
  overrides: Partial<ClauseClassification> = {},
): ClauseClassification {
  return {
    id: 'cc-1',
    document_analysis_id: ANALYSIS.id,
    status: 'pending',
    result: null,
    provider_used: null,
    error_message: null,
    created_at: '2026-07-01T00:00:00.000Z',
    completed_at: null,
    ...overrides,
  };
}

function buildMocks() {
  const classificationRepository = {
    create: vi.fn(),
    findByDocumentAnalysisId: vi.fn(),
    findByIdOrThrow: vi.fn(),
    markProcessing: vi.fn(),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
  };

  const analysisService = {
    getAnalysisById: vi.fn(),
  };

  const documentService = {
    getDocumentById: vi.fn(),
  };

  return { classificationRepository, analysisService, documentService };
}

function buildService(
  currentUser: AuthUser | null,
  mocks: ReturnType<typeof buildMocks>,
): ClauseClassificationService {
  return new ClauseClassificationService(
    currentUser,
    mocks.classificationRepository as never,
    mocks.analysisService as never,
    mocks.documentService as never,
  );
}

describe('ClauseClassificationService', () => {
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks = buildMocks();
    mocks.documentService.getDocumentById.mockResolvedValue(DOCUMENT);
    mocks.analysisService.getAnalysisById.mockResolvedValue(ANALYSIS);
  });

  describe('createClassification', () => {
    it('throws AuthenticationError when there is no current user', async () => {
      const service = buildService(null, mocks);
      await expect(service.createClassification({}, ANALYSIS.id)).rejects.toBeInstanceOf(
        AuthenticationError,
      );
    });

    it('throws AuthorizationError when the current user does not own the document', async () => {
      mocks.documentService.getDocumentById.mockResolvedValue({
        ...DOCUMENT,
        owner_id: OTHER_USER_ID,
      });
      const service = buildService(AUTHENTICATED_USER, mocks);
      await expect(service.createClassification({}, ANALYSIS.id)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    });

    it('creates a pending row scoped to the resolved analysis id on success', async () => {
      const created = buildClassification();
      mocks.classificationRepository.create.mockResolvedValue(created);
      const service = buildService(AUTHENTICATED_USER, mocks);

      const result = await service.createClassification({ id: DOCUMENT.id }, ANALYSIS.id);

      expect(mocks.documentService.getDocumentById).toHaveBeenCalledWith({ id: DOCUMENT.id });
      expect(mocks.analysisService.getAnalysisById).toHaveBeenCalledWith(
        { id: DOCUMENT.id },
        ANALYSIS.id,
      );
      expect(mocks.classificationRepository.create).toHaveBeenCalledWith({
        document_analysis_id: ANALYSIS.id,
      });
      expect(result).toEqual(created);
    });
  });

  describe('listClassificationsForAnalysis', () => {
    it('throws AuthenticationError when there is no current user', async () => {
      const service = buildService(null, mocks);
      await expect(
        service.listClassificationsForAnalysis({}, ANALYSIS.id),
      ).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('re-validates the analysis then lists by the resolved analysis id', async () => {
      const rows = [buildClassification()];
      mocks.classificationRepository.findByDocumentAnalysisId.mockResolvedValue(rows);
      const service = buildService(AUTHENTICATED_USER, mocks);

      const result = await service.listClassificationsForAnalysis({ id: DOCUMENT.id }, ANALYSIS.id);

      expect(mocks.analysisService.getAnalysisById).toHaveBeenCalledWith(
        { id: DOCUMENT.id },
        ANALYSIS.id,
      );
      expect(mocks.classificationRepository.findByDocumentAnalysisId).toHaveBeenCalledWith(
        ANALYSIS.id,
      );
      expect(result).toEqual(rows);
    });
  });

  describe('getClassificationById', () => {
    it('throws NotFoundError when the classification belongs to a different analysis', async () => {
      mocks.classificationRepository.findByIdOrThrow.mockResolvedValue(
        buildClassification({ document_analysis_id: 'some-other-analysis' }),
      );
      const service = buildService(AUTHENTICATED_USER, mocks);

      await expect(
        service.getClassificationById({ id: DOCUMENT.id }, ANALYSIS.id, 'cc-1'),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the classification when it belongs to the resolved analysis', async () => {
      const classification = buildClassification({ document_analysis_id: ANALYSIS.id });
      mocks.classificationRepository.findByIdOrThrow.mockResolvedValue(classification);
      const service = buildService(AUTHENTICATED_USER, mocks);

      const result = await service.getClassificationById({ id: DOCUMENT.id }, ANALYSIS.id, 'cc-1');

      expect(result).toEqual(classification);
    });
  });

  describe('getLatestCompletedClassificationForAnalysis', () => {
    it('returns null when no completed run exists', async () => {
      mocks.classificationRepository.findByDocumentAnalysisId.mockResolvedValue([
        buildClassification({ status: 'failed' }),
        buildClassification({ status: 'processing' }),
      ]);
      const service = buildService(AUTHENTICATED_USER, mocks);

      await expect(
        service.getLatestCompletedClassificationForAnalysis({ id: DOCUMENT.id }, ANALYSIS.id),
      ).resolves.toBeNull();
    });

    it('returns the first completed run when one exists', async () => {
      const completed = buildClassification({ status: 'completed', id: 'cc-completed' });
      mocks.classificationRepository.findByDocumentAnalysisId.mockResolvedValue([
        buildClassification({ status: 'failed' }),
        completed,
      ]);
      const service = buildService(AUTHENTICATED_USER, mocks);

      const result = await service.getLatestCompletedClassificationForAnalysis(
        { id: DOCUMENT.id },
        ANALYSIS.id,
      );

      expect(result).toEqual(completed);
    });
  });

  describe('runClassification', () => {
    const CLASSIFICATION_ID = 'cc-1';
    const DOCUMENT_TEXT = 'This Agreement is entered into...';

    it('marks processing, calls generateWithFallback, then marks completed on success', async () => {
      const result = { clauses: [] };
      vi.mocked(generateWithFallback).mockResolvedValue({ result, providerUsed: 'openai' });
      const completedRow = buildClassification({ status: 'completed', result, provider_used: 'openai' });
      mocks.classificationRepository.markCompleted.mockResolvedValue(completedRow);
      const service = buildService(AUTHENTICATED_USER, mocks);

      const outcome = await service.runClassification(CLASSIFICATION_ID, DOCUMENT_TEXT);

      expect(mocks.classificationRepository.markProcessing).toHaveBeenCalledWith(CLASSIFICATION_ID);
      expect(generateWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({ userPrompt: DOCUMENT_TEXT }),
      );
      expect(mocks.classificationRepository.markCompleted).toHaveBeenCalledWith(
        CLASSIFICATION_ID,
        result,
        'openai',
      );
      expect(outcome).toEqual(completedRow);
    });

    it('marks failed with the mapped user-safe message on a retryable AIProviderError', async () => {
      const providerError = new AIProviderError(
        'openai',
        ErrorCode.AI_PROVIDER_TIMEOUT,
        'raw upstream timeout detail, never shown to a customer',
      );
      vi.mocked(generateWithFallback).mockRejectedValue(providerError);
      const failedRow = buildClassification({ status: 'failed' });
      mocks.classificationRepository.markFailed.mockResolvedValue(failedRow);
      const service = buildService(AUTHENTICATED_USER, mocks);

      const outcome = await service.runClassification(CLASSIFICATION_ID, DOCUMENT_TEXT);

      expect(mocks.classificationRepository.markFailed).toHaveBeenCalledWith(
        CLASSIFICATION_ID,
        'Clause classification timed out. Please try again.',
      );
      expect(outcome).toEqual(failedRow);
    });

    it('falls back to the generic message for an AIProviderError code with no explicit mapping', async () => {
      // AIProviderError's constructor only accepts 5 codes and every one
      // of them DOES have an explicit mapping in USER_SAFE_FAILURE_MESSAGES
      // per the real source — this test documents that invariant rather
      // than asserting an unreachable branch. If a 6th AI-provider code
      // is ever added without a matching message, this is the test that
      // should start failing.
      const messages = [
        ErrorCode.AI_PROVIDER_TIMEOUT,
        ErrorCode.AI_PROVIDER_RATE_LIMITED,
        ErrorCode.AI_PROVIDER_CONTENT_REJECTED,
        ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
      ];
      expect(messages).toHaveLength(5);
    });

    it('rethrows and best-effort marks failed for a non-AIProviderError', async () => {
      const dbError = new Error('connection pool exhausted');
      vi.mocked(generateWithFallback).mockRejectedValue(dbError);
      mocks.classificationRepository.markFailed.mockResolvedValue(
        buildClassification({ status: 'failed' }),
      );
      const service = buildService(AUTHENTICATED_USER, mocks);

      await expect(service.runClassification(CLASSIFICATION_ID, DOCUMENT_TEXT)).rejects.toThrow(
        dbError,
      );
      expect(mocks.classificationRepository.markFailed).toHaveBeenCalledWith(
        CLASSIFICATION_ID,
        'Clause classification failed due to an unexpected error. Please try again.',
      );
    });

    it('still rethrows the original error even if the best-effort markFailed itself fails', async () => {
      const originalError = new Error('connection pool exhausted');
      vi.mocked(generateWithFallback).mockRejectedValue(originalError);
      mocks.classificationRepository.markFailed.mockRejectedValue(new Error('db is also down'));
      const service = buildService(AUTHENTICATED_USER, mocks);

      await expect(service.runClassification(CLASSIFICATION_ID, DOCUMENT_TEXT)).rejects.toBe(
        originalError,
      );
    });
  });
});
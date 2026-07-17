// src/modules/clause-classification/clause-classification.repository.test.ts
// Tests for File 95 — clause-classification.repository.ts
//
// TEMPLATE NOTE: this suite mocks the Supabase client directly rather
// than pulling in BaseRepository's real internals, because every method
// exercised here (findById, findByIdOrThrow, the three transitions,
// parseRow) is fully overridden or private in the real pasted source —
// none of them fall through to BaseRepository's own implementation. For
// a future module where the repository does NOT override findById/
// findByIdOrThrow, this mock-supabase-directly approach is not
// sufficient on its own — BaseRepository's real source would need to be
// requested first, per the Source Verification Rule.
//
// buildSupabaseMock() below models the exact chain each real method
// calls: .from().select().eq().maybeSingle() for reads,
// .from().update().eq().select().maybeSingle() for writes. Reuse this
// helper shape for the other five repositories; only the resolved
// {data, error} values change per test.

import { describe, expect, it, vi } from 'vitest';

import { DatabaseError, NotFoundError } from '@/core/errors/app-error';

import { ClauseClassificationRepository } from './clause-classification.repository';

const VALID_ROW_BASE = {
  id: 'cc-1',
  document_analysis_id: 'da-1',
  status: 'completed' as const,
  provider_used: 'openai' as const,
  error_message: null,
  created_at: '2026-07-01T00:00:00.000Z',
  completed_at: '2026-07-01T00:05:00.000Z',
};

const VALID_RESULT = {
  clauses: [
    {
      category: 'payment' as const,
      excerpt: 'Payment shall be made within 30 days.',
      order: 0,
      confidence: 0.88,
    },
  ],
};

/**
 * Builds a mock SupabaseClient whose .from() always returns the same
 * chainable object. `selectResult` backs .select().eq().maybeSingle()
 * (and .select().eq().order()... for list reads); `updateResult` backs
 * .update().eq().select().maybeSingle(). Both default to a "no result"
 * shape so a test only needs to override what it cares about.
 */
function buildSupabaseMock(options: {
  selectResult?: { data: unknown; error: unknown };
  selectListResult?: { data: unknown[] | null; error: unknown };
  updateResult?: { data: unknown; error: unknown };
} = {}) {
  const selectResult = options.selectResult ?? { data: null, error: null };
  const selectListResult = options.selectListResult ?? { data: [], error: null };
  const updateResult = options.updateResult ?? { data: null, error: null };

  const maybeSingle = vi.fn().mockResolvedValue(selectResult);
  const limit = vi.fn().mockReturnValue({ maybeSingle });
  // order() is used two ways in the real repository: awaited directly
  // (findByDocumentAnalysisId) and chained into .limit().maybeSingle()
  // (findLatestByDocumentAnalysisId). Support both by making the
  // returned object thenable AND chainable.
  const orderChainable = Object.assign(Promise.resolve(selectListResult), { limit });

  const eqForSelect = vi.fn().mockImplementation(() => ({
    maybeSingle,
    order: vi.fn().mockReturnValue(orderChainable),
  }));

  const selectUpdate = vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(updateResult) });
  const eqForUpdate = vi.fn().mockReturnValue({ select: selectUpdate });

  const select = vi.fn().mockReturnValue({ eq: eqForSelect });
  const update = vi.fn().mockReturnValue({ eq: eqForUpdate });

  const from = vi.fn().mockReturnValue({ select, update });

  return { from, select, update, eqForSelect, eqForUpdate, maybeSingle, order: orderChainable };
}

function buildRepository(supabaseOverrides?: Parameters<typeof buildSupabaseMock>[0]) {
  const supabase = buildSupabaseMock(supabaseOverrides);
  const repository = new ClauseClassificationRepository(supabase as never);
  return { repository, supabase };
}

describe('ClauseClassificationRepository', () => {
  describe('findById', () => {
    it('returns null when no row is found', async () => {
      const { repository } = buildRepository({ selectResult: { data: null, error: null } });
      await expect(repository.findById('missing')).resolves.toBeNull();
    });

    it('parses and returns a row with a null result', async () => {
      const { repository } = buildRepository({
        selectResult: { data: { ...VALID_ROW_BASE, result: null }, error: null },
      });
      const row = await repository.findById('cc-1');
      expect(row).toEqual({ ...VALID_ROW_BASE, result: null });
    });

    it('parses and returns a row with a valid result', async () => {
      const { repository } = buildRepository({
        selectResult: { data: { ...VALID_ROW_BASE, result: VALID_RESULT }, error: null },
      });
      const row = await repository.findById('cc-1');
      expect(row?.result).toEqual(VALID_RESULT);
    });

    it('throws DatabaseError when the result column fails schema validation', async () => {
      const { repository } = buildRepository({
        selectResult: {
          data: { ...VALID_ROW_BASE, result: { clauses: [{ category: 'not_real' }] } },
          error: null,
        },
      });
      await expect(repository.findById('cc-1')).rejects.toBeInstanceOf(DatabaseError);
    });

    it('throws DatabaseError when Supabase itself returns an error', async () => {
      const { repository } = buildRepository({
        selectResult: { data: null, error: { message: 'connection reset' } },
      });
      await expect(repository.findById('cc-1')).rejects.toBeInstanceOf(DatabaseError);
    });
  });

  describe('findByIdOrThrow', () => {
    it('throws NotFoundError when the row does not exist', async () => {
      const { repository } = buildRepository({ selectResult: { data: null, error: null } });
      await expect(repository.findByIdOrThrow('missing')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('returns the parsed row when it exists', async () => {
      const { repository } = buildRepository({
        selectResult: { data: { ...VALID_ROW_BASE, result: null }, error: null },
      });
      await expect(repository.findByIdOrThrow('cc-1')).resolves.toEqual({
        ...VALID_ROW_BASE,
        result: null,
      });
    });
  });

  describe('findByDocumentAnalysisId', () => {
    it('returns an empty array when no rows exist', async () => {
      const { repository } = buildRepository({ selectListResult: { data: [], error: null } });
      await expect(repository.findByDocumentAnalysisId('da-1')).resolves.toEqual([]);
    });

    it('maps every row through parseRow', async () => {
      const { repository } = buildRepository({
        selectListResult: {
          data: [{ ...VALID_ROW_BASE, result: VALID_RESULT }],
          error: null,
        },
      });
      const rows = await repository.findByDocumentAnalysisId('da-1');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.result).toEqual(VALID_RESULT);
    });

    it('throws DatabaseError on a Supabase error', async () => {
      const { repository } = buildRepository({
        selectListResult: { data: null, error: { message: 'boom' } },
      });
      await expect(repository.findByDocumentAnalysisId('da-1')).rejects.toBeInstanceOf(
        DatabaseError,
      );
    });
  });

  describe('markProcessing / markCompleted / markFailed', () => {
    it('markProcessing sends status: processing and returns the parsed row', async () => {
      const { repository, supabase } = buildRepository({
        updateResult: { data: { ...VALID_ROW_BASE, status: 'processing', result: null }, error: null },
      });
      const row = await repository.markProcessing('cc-1');
      expect(supabase.update).toHaveBeenCalledWith({ status: 'processing' });
      expect(row.status).toBe('processing');
    });

    it('markCompleted sends status, result, provider_used, and completed_at together', async () => {
      const { repository, supabase } = buildRepository({
        updateResult: { data: { ...VALID_ROW_BASE, result: VALID_RESULT }, error: null },
      });
      const row = await repository.markCompleted('cc-1', VALID_RESULT, 'openai');
      const patchArg = supabase.update.mock.calls[0]?.[0];
      expect(patchArg).toMatchObject({ status: 'completed', result: VALID_RESULT, provider_used: 'openai' });
      expect(typeof patchArg.completed_at).toBe('string');
      expect(row.result).toEqual(VALID_RESULT);
    });

    it('markFailed sends status: failed and the given error message', async () => {
      const { repository, supabase } = buildRepository({
        updateResult: {
          data: { ...VALID_ROW_BASE, status: 'failed', result: null, error_message: 'nope' },
          error: null,
        },
      });
      const row = await repository.markFailed('cc-1', 'nope');
      const patchArg = supabase.update.mock.calls[0]?.[0];
      expect(patchArg).toMatchObject({ status: 'failed', error_message: 'nope' });
      expect(row.status).toBe('failed');
    });

    it('throws NotFoundError when the transition targets a nonexistent row', async () => {
      const { repository } = buildRepository({ updateResult: { data: null, error: null } });
      await expect(repository.markProcessing('missing')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('throws DatabaseError when the update itself fails', async () => {
      const { repository } = buildRepository({
        updateResult: { data: null, error: { message: 'write failed' } },
      });
      await expect(repository.markProcessing('cc-1')).rejects.toBeInstanceOf(DatabaseError);
    });
  });
});
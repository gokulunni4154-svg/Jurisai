// @vitest-environment node
// P2-02 regression suite for AnonymousAnalysisService. Uses in-memory fakes
// for the repository / Storage / limiter, so it verifies APPLICATION logic
// (validation order, token hashing, session isolation, cleanup, CAS races).
// It does NOT verify real Supabase RLS, Storage policies, or the SQL
// rate-limit function — those need a live-database integration test.

vi.mock('server-only', () => ({}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConflictError, DatabaseError, RateLimitError, ValidationError } from '@/core/errors/app-error';

import type { AnonymousAnalysisRepository, AnonymousAnalysisSessionRow } from './anonymous-analysis.repository';
import { AnonymousAnalysisService } from './anonymous-analysis.service';
import { generateSessionToken, hashSessionToken } from './anonymous-analysis.token';
import { ANON_MAX_EXTRACTED_CHARS, ANON_MAX_FILE_BYTES } from './anonymous-analysis.validation';

const pdf = (name = 'contract.pdf', body = 'hello') =>
  new File([`%PDF-1.7\n${body}`], name, { type: 'application/pdf' });

class FakeRepo {
  rows = new Map<string, AnonymousAnalysisSessionRow>(); // keyed by HASH
  failCreate = false;
  racing: (() => void) | null = null;

  async create(token: string, i: { documentStoragePath: string; analysisResult: unknown; expiresAt: string }) {
    if (this.failCreate) throw new Error('db down');
    this.rows.set(hashSessionToken(token), {
      id: crypto.randomUUID(), session_token: hashSessionToken(token),
      document_storage_path: i.documentStoragePath, analysis_result: i.analysisResult,
      created_at: new Date().toISOString(), expires_at: i.expiresAt, reattached_profile_id: null,
    });
  }
  // Returns a COPY, like a real DB read — never the live row.
  async findByToken(token: string) { const r = this.rows.get(hashSessionToken(token)); return r ? { ...r } : null; }
  async replaceDocument(token: string, expected: string, i: { documentStoragePath: string; analysisResult: unknown }) {
    this.racing?.();
    const row = this.rows.get(hashSessionToken(token));
    if (!row || row.document_storage_path !== expected) return false;
    row.document_storage_path = i.documentStoragePath;
    row.analysis_result = i.analysisResult;
    return true;
  }
  async markReattached() {}
}

function setup() {
  const repo = new FakeRepo();
  const objects = new Set<string>();
  const storage = { failUpload: false };
  const storageClient = {
    storage: { from: () => ({
      upload: async (path: string) => {
        if (storage.failUpload) return { error: { message: 'boom internal path' } };
        objects.add(path); return { error: null };
      },
      remove: async (paths: string[]) => { paths.forEach((p) => objects.delete(p)); return { error: null }; },
    }) },
  };
  const consume = vi.fn(async () => undefined);
  const extractText = vi.fn(async () => 'text');
  const analyze = vi.fn(async () => ({ summary: 'ok' }));
  const service = new AnonymousAnalysisService({
    repository: repo as unknown as AnonymousAnalysisRepository,
    storageClient: storageClient as never,
    lawyerInquiryRepository: {} as never,
    rateLimiter: { consume },
    extractText, analyze,
  });
  return { service, repo, objects, storage, consume, extractText, analyze };
}

const call = (s: ReturnType<typeof setup>, file: File, token: string | null = null) =>
  s.service.createAnonymousAnalysis({ file, existingSessionToken: token, clientKey: 'ip-hash' });

describe('AnonymousAnalysisService — validation (rejected before any work)', () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });

  const expectNoSideEffects = () => {
    expect(s.objects.size).toBe(0); expect(s.repo.rows.size).toBe(0);
    expect(s.extractText).not.toHaveBeenCalled(); expect(s.analyze).not.toHaveBeenCalled();
    expect(s.consume).not.toHaveBeenCalled();
  };

  it('rejects an empty file', async () => {
    await expect(call(s, new File([], 'a.pdf', { type: 'application/pdf' }))).rejects.toBeInstanceOf(ValidationError);
    expectNoSideEffects();
  });
  it('rejects an unsupported MIME type', async () => {
    await expect(call(s, new File(['%PDF-1.7'], 'a.docx', { type: 'application/msword' }))).rejects.toBeInstanceOf(ValidationError);
    expectNoSideEffects();
  });
  it('rejects a spoofed MIME type with no PDF signature', async () => {
    await expect(call(s, new File(['MZ\x90 not a pdf'], 'evil.pdf', { type: 'application/pdf' }))).rejects.toBeInstanceOf(ValidationError);
    expectNoSideEffects();
  });
  it('rejects an oversized file before storage or analysis', async () => {
    const big = new File([new Uint8Array(ANON_MAX_FILE_BYTES + 1)], 'big.pdf', { type: 'application/pdf' });
    await expect(call(s, big)).rejects.toBeInstanceOf(ValidationError);
    expectNoSideEffects();
  });
});

describe('AnonymousAnalysisService — sessions', () => {
  it('creates a new session: opaque 43-char token, only its hash stored, hash-based path', async () => {
    const s = setup();
    const r = await call(s, pdf());
    expect(r.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.analysisResult).toEqual({ summary: 'ok' });
    const [hash, row] = [...s.repo.rows.entries()][0]!;
    expect(hash).toBe(hashSessionToken(r.sessionToken));
    expect(JSON.stringify([...s.repo.rows.values()])).not.toContain(r.sessionToken);
    expect(row.document_storage_path.startsWith(`anon/${hash}/`)).toBe(true);
    expect([...s.objects].join()).not.toContain(r.sessionToken);
  });

  it('reuses a valid session: same token, same expiry, old document removed', async () => {
    const s = setup();
    const first = await call(s, pdf('a.pdf'));
    const oldPath = [...s.repo.rows.values()][0]!.document_storage_path;
    const second = await call(s, pdf('b.pdf'), first.sessionToken);
    expect(second.sessionToken).toBe(first.sessionToken);
    expect(second.expiresAt).toBe(first.expiresAt); // expiry is not extended
    expect(s.repo.rows.size).toBe(1);
    expect(s.objects.has(oldPath)).toBe(false);
    expect(s.objects.size).toBe(1);
  });

  it.each([
    ['malformed', 'not-a-real-token'],
    ['well-formed but unknown', generateSessionToken()],
  ])('a %s token never selects a session — a fresh one is minted', async (_n, token) => {
    const s = setup();
    const victim = await call(s, pdf('victim.pdf'));
    const victimPath = [...s.repo.rows.values()][0]!.document_storage_path;
    const r = await call(s, pdf('x.pdf'), token);
    expect(r.sessionToken).not.toBe(token);
    expect(r.sessionToken).not.toBe(victim.sessionToken);
    expect(s.repo.rows.size).toBe(2);
    expect(s.objects.has(victimPath)).toBe(true); // victim untouched
  });

  it('an expired session is not reused and its token is not accepted', async () => {
    const s = setup();
    const first = await call(s, pdf());
    [...s.repo.rows.values()][0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    const r = await call(s, pdf(), first.sessionToken);
    expect(r.sessionToken).not.toBe(first.sessionToken);
  });

  it('a reattached session is not reusable', async () => {
    const s = setup();
    const first = await call(s, pdf());
    [...s.repo.rows.values()][0]!.reattached_profile_id = 'user-1';
    const r = await call(s, pdf(), first.sessionToken);
    expect(r.sessionToken).not.toBe(first.sessionToken);
  });

  it("session B cannot replace or delete session A's document or analysis", async () => {
    const s = setup();
    const a = await call(s, pdf('a.pdf'));
    const b = await call(s, pdf('b.pdf'));
    const rowA = s.repo.rows.get(hashSessionToken(a.sessionToken))!;
    const rowB = s.repo.rows.get(hashSessionToken(b.sessionToken))!;
    const aPath = rowA.document_storage_path;
    await call(s, pdf('b2.pdf'), b.sessionToken);
    expect(rowA.document_storage_path).toBe(aPath);
    expect(s.objects.has(aPath)).toBe(true);
    expect(rowB.document_storage_path.startsWith(`anon/${hashSessionToken(b.sessionToken)}/`)).toBe(true);
  });
});

describe('AnonymousAnalysisService — failures leave nothing behind', () => {
  it('analysis failure: nothing stored, no session row', async () => {
    const s = setup();
    s.analyze.mockRejectedValueOnce(new Error('provider exploded'));
    await expect(call(s, pdf())).rejects.toThrow();
    expect(s.objects.size).toBe(0); expect(s.repo.rows.size).toBe(0);
  });
  it('extraction failure: nothing stored, analysis never called', async () => {
    const s = setup();
    s.extractText.mockRejectedValueOnce(new ValidationError('unreadable'));
    await expect(call(s, pdf())).rejects.toBeInstanceOf(ValidationError);
    expect(s.analyze).not.toHaveBeenCalled(); expect(s.objects.size).toBe(0);
  });
  it('storage failure: safe error, no raw storage message, no session row', async () => {
    const s = setup(); s.storage.failUpload = true;
    const err = await call(s, pdf()).catch((e) => e);
    expect(err.message).toBe('Failed to store the uploaded document.');
    expect(JSON.stringify(err.toJSON())).not.toContain('internal path');
    expect(s.repo.rows.size).toBe(0);
  });
  it('database failure after upload: uploaded object is removed', async () => {
    const s = setup(); s.repo.failCreate = true;
    await expect(call(s, pdf())).rejects.toBeInstanceOf(DatabaseError);
    expect(s.objects.size).toBe(0);
  });
});

describe('AnonymousAnalysisService — global AI quota ordering', () => {
  it('is consumed after the session limit and extraction, immediately before analysis', async () => {
    const s = setup();
    await call(s, pdf());
    expect(s.consume).toHaveBeenCalledTimes(2);
    expect(s.consume).toHaveBeenNthCalledWith(2, 'anon-analysis:global', 300, 3600);
    const [sessionAt, globalAt] = s.consume.mock.invocationCallOrder;
    expect(sessionAt!).toBeLessThan(s.extractText.mock.invocationCallOrder[0]!);
    expect(s.extractText.mock.invocationCallOrder[0]!).toBeLessThan(globalAt!);
    expect(globalAt!).toBeLessThan(s.analyze.mock.invocationCallOrder[0]!);
  });

  it('is one shared key for every request — not per-IP and not per-session', async () => {
    const s = setup();
    const first = await call(s, pdf()); // new session, client "ip-hash"
    await call(s, pdf(), first.sessionToken); // reused session
    await s.service.createAnonymousAnalysis({ file: pdf(), existingSessionToken: null, clientKey: 'other-ip' });
    expect(s.consume).toHaveBeenNthCalledWith(2, 'anon-analysis:global', 300, 3600);
    expect(s.consume).toHaveBeenNthCalledWith(4, 'anon-analysis:global', 300, 3600);
    expect(s.consume).toHaveBeenNthCalledWith(6, 'anon-analysis:global', 300, 3600);
  });

  it('is not consumed when extraction fails', async () => {
    const s = setup();
    s.extractText.mockRejectedValueOnce(new ValidationError('unreadable'));
    await expect(call(s, pdf())).rejects.toBeInstanceOf(ValidationError);
    expect(s.consume).toHaveBeenCalledTimes(1); // session limit only
    expect(s.consume).not.toHaveBeenCalledWith('anon-analysis:global', expect.anything(), expect.anything());
    expect(s.analyze).not.toHaveBeenCalled();
  });

  it('is not consumed when the extracted text is too long', async () => {
    const s = setup();
    s.extractText.mockResolvedValueOnce('x'.repeat(ANON_MAX_EXTRACTED_CHARS + 1));
    await expect(call(s, pdf())).rejects.toBeInstanceOf(ValidationError);
    expect(s.consume).toHaveBeenCalledTimes(1); // session limit only
    expect(s.consume).not.toHaveBeenCalledWith('anon-analysis:global', expect.anything(), expect.anything());
    expect(s.analyze).not.toHaveBeenCalled();
  });

  it('when exceeded: analyze is not called and nothing is stored or persisted', async () => {
    const s = setup();
    s.consume.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new RateLimitError('slow down', 30));
    await expect(call(s, pdf())).rejects.toBeInstanceOf(RateLimitError);
    expect(s.consume).toHaveBeenNthCalledWith(2, 'anon-analysis:global', 300, 3600);
    expect(s.analyze).not.toHaveBeenCalled();
    expect(s.objects.size).toBe(0);
    expect(s.repo.rows.size).toBe(0);
  });

  it('when exceeded on a reused session: the existing document and analysis are untouched', async () => {
    const s = setup();
    const first = await call(s, pdf('a.pdf'));
    const before = { ...[...s.repo.rows.values()][0]! };
    s.consume.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new RateLimitError('slow down', 30));
    await expect(call(s, pdf('b.pdf'), first.sessionToken)).rejects.toBeInstanceOf(RateLimitError);
    expect(s.analyze).toHaveBeenCalledTimes(1); // only the first, successful request
    expect([...s.repo.rows.values()][0]).toEqual(before);
    expect([...s.objects]).toEqual([before.document_storage_path]);
  });

  it('fails closed when the limiter itself errors: analyze is not called', async () => {
    const s = setup();
    s.consume.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('limiter unavailable'));
    await expect(call(s, pdf())).rejects.toThrow('limiter unavailable');
    expect(s.analyze).not.toHaveBeenCalled();
    expect(s.objects.size).toBe(0);
  });
});

describe('AnonymousAnalysisService — limits and concurrency', () => {
  it('propagates RateLimitError and does no analysis/storage work', async () => {
    const s = setup();
    s.consume.mockRejectedValueOnce(new RateLimitError('slow down', 30));
    await expect(call(s, pdf())).rejects.toBeInstanceOf(RateLimitError);
    expect(s.analyze).not.toHaveBeenCalled(); expect(s.objects.size).toBe(0);
  });
  it('new sessions are limited per client; reused sessions per session hash', async () => {
    const s = setup();
    const first = await call(s, pdf());
    // Each successful request makes two limiter calls: [session limit, global AI quota].
    expect(s.consume).toHaveBeenNthCalledWith(1, 'anon-analysis:new-session:ip-hash', 5, 3600);
    await call(s, pdf(), first.sessionToken);
    expect(s.consume).toHaveBeenNthCalledWith(3, `anon-analysis:session:${hashSessionToken(first.sessionToken)}`, 5, 3600);
  });
  it('a concurrent upload that loses the compare-and-swap is rejected and cleaned up', async () => {
    const s = setup();
    const first = await call(s, pdf('a.pdf'));
    const row = [...s.repo.rows.values()][0]!;
    s.repo.racing = () => { row.document_storage_path = 'anon/x/winner/w.pdf'; }; // other request wins
    await expect(call(s, pdf('b.pdf'), first.sessionToken)).rejects.toBeInstanceOf(ConflictError);
    expect(row.document_storage_path).toBe('anon/x/winner/w.pdf');
    expect([...s.objects].some((p) => p.endsWith('/b.pdf'))).toBe(false); // loser's upload removed
  });
});

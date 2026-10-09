// @vitest-environment node
// Route-level tests: HTTP contract, cookie, limiter wiring, body bounds.
// Service/Supabase are mocked; real RLS / Storage are NOT exercised here.

vi.mock('server-only', () => ({}));

const rpc = vi.fn();
const createAnonymousAnalysis = vi.fn();

vi.mock('@/core/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock('@/modules/lawyer-inquiries/anonymous-analysis.factory', () => ({
  buildAnonymousAnalysisService: async () => ({ createAnonymousAnalysis }),
}));

// Pass-through spy: real body-bounds behaviour is kept, but the tests can see
// whether (and when) the route reads the multipart body.
vi.mock('@/core/http/read-multipart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/http/read-multipart')>();
  return { ...actual, readMultipartWithLimit: vi.fn(actual.readMultipartWithLimit) };
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readMultipartWithLimit } from '@/core/http/read-multipart';

import { POST } from './route';

const TOKEN = 'A'.repeat(43);

function upload(opts: { file?: File | null; cookie?: string; headers?: Record<string, string> } = {}) {
  const fd = new FormData();
  if (opts.file !== null) fd.append('file', opts.file ?? new File(['%PDF-1.7 x'], 'c.pdf', { type: 'application/pdf' }));
  return new NextRequest('http://localhost/api/analysis/anonymous', {
    method: 'POST', body: fd,
    headers: { ...(opts.cookie ? { cookie: `anon_session_token=${opts.cookie}` } : {}), ...opts.headers },
  });
}

beforeEach(() => {
  rpc.mockReset(); createAnonymousAnalysis.mockReset();
  vi.mocked(readMultipartWithLimit).mockClear(); // keeps the pass-through implementation
  rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 1 }], error: null });
  createAnonymousAnalysis.mockResolvedValue({
    sessionToken: TOKEN, analysisResult: { summary: 'ok' },
    expiresAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
  });
});

describe('POST /api/analysis/anonymous', () => {
  it('missing file -> 400', async () => {
    expect((await POST(upload({ file: null }))).status).toBe(400);
    expect(createAnonymousAnalysis).not.toHaveBeenCalled();
  });

  it('non-multipart body -> 400', async () => {
    const req = new NextRequest('http://localhost/api/analysis/anonymous', {
      method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('success keeps the contract, sets an httpOnly cookie, never returns the token in JSON', async () => {
    const res = await POST(upload());
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(Object.keys(JSON.parse(text).data).sort()).toEqual(['analysisResult', 'expiresAt']);
    expect(text).not.toContain(TOKEN);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain(`anon_session_token=${TOKEN}`);
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i); expect(cookie).toMatch(/Path=\//);
  });

  it('cookie Max-Age tracks the server-side expiry, not a fixed 7 days', async () => {
    const res = await POST(upload());
    const maxAge = Number(/Max-Age=(\d+)/i.exec(res.headers.get('set-cookie')!)![1]);
    expect(maxAge).toBeGreaterThan(2.9 * 86400); expect(maxAge).toBeLessThanOrEqual(3 * 86400);
  });

  it('forwards the cookie token and a hashed (non-raw) client key to the service', async () => {
    await POST(upload({ cookie: TOKEN, headers: { 'x-real-ip': '203.0.113.9' } }));
    const arg = createAnonymousAnalysis.mock.calls[0]![0];
    expect(arg.existingSessionToken).toBe(TOKEN);
    expect(arg.clientKey).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.clientKey).not.toContain('203.0.113.9');
  });

  it('per-IP rate limit -> 429 with Retry-After, before the body is read or service called', async () => {
    rpc.mockResolvedValueOnce({ data: [{ allowed: false, retry_after_seconds: 42 }], error: null });
    const res = await POST(upload());
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(readMultipartWithLimit).not.toHaveBeenCalled();
    expect(createAnonymousAnalysis).not.toHaveBeenCalled();
  });

  it('makes exactly one limiter RPC (per-IP) before reading the body; the global AI quota belongs to the service', async () => {
    const res = await POST(upload());
    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('anon-analysis:global');
    expect(readMultipartWithLimit).toHaveBeenCalledTimes(1);
    expect(rpc.mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(readMultipartWithLimit).mock.invocationCallOrder[0]!,
    );
  });

  it('FAILS CLOSED (503) when the shared limiter is unavailable', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    const res = await POST(upload());
    expect(res.status).toBe(503);
    expect(createAnonymousAnalysis).not.toHaveBeenCalled();
    expect(await res.text()).not.toContain('does not exist');
  });

  it('oversized declared Content-Length -> 413 without invoking the service', async () => {
    const res = await POST(upload({ headers: { 'content-length': String(500 * 1024 * 1024) } }));
    expect(res.status).toBe(413);
    expect(createAnonymousAnalysis).not.toHaveBeenCalled();
  });

  it('oversized body with a lying/absent Content-Length is aborted mid-stream -> 413', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) { if (sent++ > 15) c.close(); else c.enqueue(chunk); },
    });
    const req = new NextRequest('http://localhost/api/analysis/anonymous', {
      method: 'POST', body, duplex: 'half',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
    } as never);
    expect((await POST(req)).status).toBe(413);
    expect(createAnonymousAnalysis).not.toHaveBeenCalled();
  });

  it('service errors surface as safe JSON without internals', async () => {
    const { ExternalServiceError } = await import('@/core/errors/app-error');
    createAnonymousAnalysis.mockRejectedValueOnce(new ExternalServiceError('ai-provider', 'Document analysis is temporarily unavailable.', new Error('sk-secret provider stack')));
    const res = await POST(upload());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('sk-secret'); expect(text).not.toContain('stack');
  });
});

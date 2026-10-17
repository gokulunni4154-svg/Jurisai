// src/modules/chat/chat.service.test.ts
// Regression tests for the "chat_conversations ... was not found" bug:
// conversation lists were not scoped to the analysis, so the UI could
// send a message into a conversation from a different analysis.

vi.mock('server-only', () => ({}));
vi.mock('@/core/ai/ai-provider.factory', () => ({
  generateStreamingWithFallback: vi.fn(),
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/core/auth/types';
import { AuthenticationError, AuthorizationError, NotFoundError } from '@/core/errors/app-error';
import { generateStreamingWithFallback } from '@/core/ai/ai-provider.factory';

import { ChatService } from './chat.service';

const USER = { id: 'user-1', role: 'general_user' } as unknown as AuthUser;
const ANALYSIS_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ANALYSIS_ID = '22222222-2222-4222-8222-222222222222';
const CONV_ID = 'da87097d-ec1d-4e6a-af13-cd766861c8a9';

function build(user: AuthUser | null = USER) {
  const conversationRepo = {
    create: vi.fn(),
    findByIdOrThrow: vi.fn(),
    findManyForUserAndAnalysis: vi.fn(),
    touch: vi.fn(),
  };
  const messageRepo = { create: vi.fn(), findManyForConversation: vi.fn().mockResolvedValue([]) };
  const analysisService = { getAnalysisById: vi.fn().mockResolvedValue({ id: ANALYSIS_ID }) };
  const upstream = () => ({ getLatestCompletedXForAnalysis: vi.fn() });
  const nine = Array.from({ length: 7 }, () => ({}) as never);
  // Upstream passthroughs are called by name; stub each on the service itself.
  const service = new ChatService(
    user,
    conversationRepo as never,
    messageRepo as never,
    analysisService as never,
    {} as never,
    ...(nine as [never, never, never, never, never, never, never]),
  );
  for (const m of [
    'getLatestCompletedClassificationForAnalysis',
    'getLatestCompletedRiskDetectionForAnalysis',
    'getLatestCompletedMissingClauseDetectionForAnalysis',
    'getLatestCompletedComplianceDetectionForAnalysis',
    'getLatestCompletedAIRecommendationForAnalysis',
    'getLatestCompletedLegalHealthScoreForAnalysis',
    'getLatestCompletedAiLegalInsightForAnalysis',
  ]) {
    vi.spyOn(service as never, m as never).mockResolvedValue(null as never);
  }
  void upstream;
  return { service, conversationRepo, messageRepo, analysisService };
}

function fakeStream(chunks: string[]) {
  return (async function* () {
    for (const c of chunks) yield c;
    return 'gemini' as never;
  })();
}

const conv = (over: Record<string, unknown> = {}) => ({
  id: CONV_ID,
  user_id: USER.id,
  document_analysis_id: ANALYSIS_ID,
  ...over,
});

async function drain(gen: AsyncGenerator<string, void, undefined>) {
  const out: string[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

describe('ChatService — conversation lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('lists only conversations scoped to the requested analysis', async () => {
    const { service, conversationRepo } = build();
    conversationRepo.findManyForUserAndAnalysis.mockResolvedValue([conv()]);
    await service.listConversationsForAnalysis({ id: 'doc' }, ANALYSIS_ID);
    expect(conversationRepo.findManyForUserAndAnalysis).toHaveBeenCalledWith(USER.id, ANALYSIS_ID);
  });

  it('creates a conversation then sends first and subsequent messages', async () => {
    const { service, conversationRepo, messageRepo } = build();
    conversationRepo.findByIdOrThrow.mockResolvedValue(conv());
    vi.mocked(generateStreamingWithFallback).mockImplementation(() => fakeStream(['a', 'b']) as never);

    for (const content of ['first', 'second']) {
      const out = await drain(
        service.sendMessage({ id: 'doc' }, ANALYSIS_ID, { conversationId: CONV_ID, content }),
      );
      expect(out).toEqual(['a', 'b']);
    }
    const roles = messageRepo.create.mock.calls.map((c) => c[0].role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(conversationRepo.touch).toHaveBeenCalledTimes(2);
  });

  it('404s for a nonexistent / RLS-hidden conversation', async () => {
    const { service, conversationRepo } = build();
    conversationRepo.findByIdOrThrow.mockRejectedValue(new NotFoundError('chat_conversations', CONV_ID));
    await expect(
      drain(service.sendMessage({ id: 'doc' }, ANALYSIS_ID, { conversationId: CONV_ID, content: 'hi' })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a conversation that belongs to another analysis (and logs it)', async () => {
    const { service, conversationRepo } = build();
    conversationRepo.findByIdOrThrow.mockResolvedValue(conv({ document_analysis_id: OTHER_ANALYSIS_ID }));
    await expect(
      drain(service.sendMessage({ id: 'doc' }, ANALYSIS_ID, { conversationId: CONV_ID, content: 'hi' })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(console.warn).toHaveBeenCalledWith(
      '[chat] conversation/analysis mismatch',
      expect.objectContaining({ conversationId: CONV_ID }),
    );
  });

  it("rejects another user's conversation", async () => {
    const { service, conversationRepo, messageRepo } = build();
    conversationRepo.findByIdOrThrow.mockResolvedValue(conv({ user_id: 'someone-else' }));
    await expect(
      drain(service.sendMessage({ id: 'doc' }, ANALYSIS_ID, { conversationId: CONV_ID, content: 'hi' })),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(messageRepo.create).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers', async () => {
    const { service } = build(null);
    await expect(
      drain(service.sendMessage({ id: 'doc' }, ANALYSIS_ID, { conversationId: CONV_ID, content: 'hi' })),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

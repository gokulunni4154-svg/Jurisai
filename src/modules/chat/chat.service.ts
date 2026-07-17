// src/modules/chat/chat.service.ts
// File 153 — JurisAI Module 8 (AI Legal Chat)

import 'server-only';

import type { AuthUser } from '@/core/auth/types';
import { AIProviderError, ErrorCode, NotFoundError } from '@/core/errors/app-error';
import { BaseService } from '@/core/services/base.service';
import { generateStreamingWithFallback } from '@/core/ai/ai-provider.factory';
import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import type { DocumentService } from '@/modules/documents/document.service';
import type { DocumentAnalysisService } from '@/modules/document-analysis/document-analysis.service';
import type { ClauseClassificationService } from '@/modules/clause-classification/clause-classification.service';
import type { RiskDetectionService } from '@/modules/risk-detection/risk-detection.service';
import type { MissingClauseDetectionService } from '@/modules/missing-clause-detection/missing-clause-detection.service';
import type { ComplianceDetectionService } from '@/modules/compliance-detection/compliance-detection.service';
import type { AIRecommendationService } from '@/modules/ai-recommendation/ai-recommendation.service';
import type { LegalHealthScoreService } from '@/modules/legal-health-score/legal-health-score.service';
import type { AiLegalInsightService } from '@/modules/ai-legal-insight/ai-legal-insight.service';

import type { ChatConversationRepository, ChatMessageRepository } from './chat.repository';
import type { ChatConversation, ChatMessage } from './chat.entity';
import { sendMessageInputSchema } from './chat.schemas';

/**
 * User-safe fallback messages, same convention as every upstream
 * service. Reused as-is for a pre-stream failure (retried once by
 * generateStreamingWithFallback, then surfaced here if both providers
 * fail before any content is produced).
 */
const USER_SAFE_FAILURE_MESSAGES: Partial<Record<string, string>> = {
  [ErrorCode.AI_PROVIDER_CONTENT_REJECTED]:
    'This message could not be answered — it may have been flagged by content safety checks.',
  [ErrorCode.AI_PROVIDER_INVALID_RESPONSE]:
    'This message could not be answered due to an unexpected error. Please try again.',
  [ErrorCode.AI_PROVIDER_TIMEOUT]: 'The response timed out. Please try again.',
  [ErrorCode.AI_PROVIDER_RATE_LIMITED]: 'Chat is temporarily busy. Please try again shortly.',
  [ErrorCode.AI_PROVIDER_UNAVAILABLE]: 'Chat is temporarily unavailable. Please try again shortly.',
};

/**
 * Service layer for Module 8 (AI Legal Chat). Depends on ELEVEN
 * collaborators — two own repositories (chatConversationRepository,
 * chatMessageRepository) plus nine sibling services, one more than File
 * 145's nine total. Matches buildChatService()'s (File 152) construction
 * order exactly.
 *
 * KEY DECISION, DEPARTS FROM FILE 145 — sendMessage() fetches its own
 * upstream context internally via this Service's own passthrough
 * methods, rather than taking seven explicit parameters the way
 * runAiLegalInsight() takes six. Every batch module runs once per Route
 * request, so pushing the fetch responsibility to the Route made sense.
 * Chat is interactive — sendMessage() is called once per user turn, and
 * requiring the Route to re-fetch all seven upstream reads on every
 * single message would duplicate logic this Service already owns.
 * Deliberate, flagged departure — not an oversight.
 *
 * OPEN ITEM, NOT RESOLVED HERE — buildUserPrompt() below does not
 * include raw document/OCR text. Every prior module uses
 * analysisService/documentService purely for gating, never as prompt
 * content, and this Service follows that same convention for now. But
 * unlike those modules, Chat's whole purpose includes explaining actual
 * clause text ("explain this indemnity clause") — that requires
 * DocumentAnalysisService's/DocumentService's real return shape, which
 * has not been pasted into this conversation. Context is currently
 * limited to the seven upstream STRUCTURED outputs (classification,
 * risk, missing-clause, compliance, recommendations, health score,
 * insights) plus conversation history. Flagged as the top gap for a
 * near-term amendment once that source is available.
 *
 * FLAGGED ASSUMPTION, carried forward unchanged from Files 136/145 —
 * BaseService's constructor/guard signatures are now directly confirmed
 * (base.service.ts was pasted in this session), so this is no longer an
 * inference for THIS file specifically — noted for completeness.
 */
export class ChatService extends BaseService {
  constructor(
    currentUser: AuthUser | null,
    private readonly chatConversationRepository: ChatConversationRepository,
    private readonly chatMessageRepository: ChatMessageRepository,
    private readonly analysisService: DocumentAnalysisService,
    private readonly documentService: DocumentService,
    private readonly classificationService: ClauseClassificationService,
    private readonly riskDetectionService: RiskDetectionService,
    private readonly missingClauseDetectionService: MissingClauseDetectionService,
    private readonly complianceDetectionService: ComplianceDetectionService,
    private readonly aiRecommendationService: AIRecommendationService,
    private readonly legalHealthScoreService: LegalHealthScoreService,
    private readonly aiLegalInsightService: AiLegalInsightService,
  ) {
    super(currentUser);
  }

  /**
   * Validates the target analysis and requires ownership of the parent
   * document — mirrors createAiLegalInsight()'s (File 145) identical
   * gating exactly, since starting a conversation is the entry point to
   * an action that will spend real AI cost (sendMessage()).
   */
  async startConversation(rawParams: unknown, analysisId: string): Promise<ChatConversation> {
    const user = this.requireAuthentication();

    const document = await this.documentService.getDocumentById(rawParams);
    this.requireOwnership(document.owner_id);

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.chatConversationRepository.create({
      document_analysis_id: analysis.id,
      user_id: user.id,
    } as never) as unknown as Promise<ChatConversation>;
  }

  /**
   * Lists a user's conversations for a given analysis, most recently
   * active first. Re-validates the analysis first — same reasoning as
   * every upstream listXForAnalysis(): an invisible or cross-document
   * analysisId surfaces as an explicit NotFoundError, not a silently
   * empty list.
   *
   * No requireOwnership() call needed here beyond what RLS already
   * enforces: findManyForUser() is called with the current user's own
   * id, and chat_conversations' RLS policy (File 148) independently
   * restricts every row to its owner regardless. Belt-and-suspenders,
   * not a substitute for one another.
   */
  async listConversationsForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ): Promise<ChatConversation[]> {
    const user = this.requireAuthentication();

    await this.analysisService.getAnalysisById(rawParams, analysisId);

    return this.chatConversationRepository.findManyForUser(user.id);
  }

  /**
   * Fetches a single conversation, scoped to an analysis the caller can
   * see. Mirrors getAiLegalInsightById()'s (File 145) pattern: re-
   * validate the parent, then verify the fetched row's
   * document_analysis_id actually matches it.
   *
   * requireOwnership() IS called here, unlike File 145's read methods —
   * a conversation is a private thread, not a shared analysis artifact,
   * so ownership is checked explicitly rather than relying on RLS alone.
   */
  async getConversationById(
    rawParams: unknown,
    analysisId: string,
    conversationId: string,
  ): Promise<ChatConversation> {
    this.requireAuthentication();

    const analysis = await this.analysisService.getAnalysisById(rawParams, analysisId);
    const conversation = await this.chatConversationRepository.findByIdOrThrow(conversationId);

    if (conversation.document_analysis_id !== analysis.id) {
      throw new NotFoundError('chat_conversations', conversationId);
    }

    this.requireOwnership(conversation.user_id);

    return conversation;
  }

  /**
   * Lists a conversation's messages in chronological order. Re-validates
   * the conversation (which itself re-validates the analysis and checks
   * ownership) before listing — same defense-in-depth reasoning as
   * getConversationById().
   */
  async listMessagesForConversation(
    rawParams: unknown,
    analysisId: string,
    conversationId: string,
  ): Promise<ChatMessage[]> {
    const conversation = await this.getConversationById(rawParams, analysisId, conversationId);

    return this.chatMessageRepository.findManyForConversation(conversation.id);
  }

  /** Passthrough to ClauseClassificationService. */
  async getLatestCompletedClassificationForAnalysis(rawParams: unknown, analysisId: string) {
    return this.classificationService.getLatestCompletedClassificationForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /** Passthrough to RiskDetectionService. */
  async getLatestCompletedRiskDetectionForAnalysis(rawParams: unknown, analysisId: string) {
    return this.riskDetectionService.getLatestCompletedRiskDetectionForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /** Passthrough to MissingClauseDetectionService. */
  async getLatestCompletedMissingClauseDetectionForAnalysis(
    rawParams: unknown,
    analysisId: string,
  ) {
    return this.missingClauseDetectionService.getLatestCompletedMissingClauseDetectionForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /** Passthrough to ComplianceDetectionService. */
  async getLatestCompletedComplianceDetectionForAnalysis(rawParams: unknown, analysisId: string) {
    return this.complianceDetectionService.getLatestCompletedComplianceDetectionForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /** Passthrough to AIRecommendationService. */
  async getLatestCompletedAIRecommendationForAnalysis(rawParams: unknown, analysisId: string) {
    return this.aiRecommendationService.getLatestCompletedAIRecommendationForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /** Passthrough to LegalHealthScoreService. */
  async getLatestCompletedLegalHealthScoreForAnalysis(rawParams: unknown, analysisId: string) {
    return this.legalHealthScoreService.getLatestCompletedLegalHealthScoreForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /** Passthrough to AiLegalInsightService — the ninth and final upstream read. */
  async getLatestCompletedAiLegalInsightForAnalysis(rawParams: unknown, analysisId: string) {
    return this.aiLegalInsightService.getLatestCompletedAiLegalInsightForAnalysis(
      rawParams,
      analysisId,
    );
  }

  /**
   * Sends a user message and streams the assistant's response.
   *
   * Sequence:
   *  1. Re-validate the conversation (analysis + ownership).
   *  2. Persist the user's message immediately — this happens before any
   *     AI call, so it is never lost even if generation fails.
   *  3. Fetch all seven upstream structured outputs + full conversation
   *     history, internally (see class-level KEY DECISION).
   *  4. Stream the assistant's response via generateStreamingWithFallback(),
   *     yielding each chunk to the caller (the Route) as it arrives.
   *  5. On successful completion, persist the full assistant message with
   *     whichever provider answered, then touch() the conversation.
   *  6. On a pre-stream failure (both providers failed before any
   *     content), surface a user-safe error and persist nothing for this
   *     turn. On a mid-stream failure, propagate the error and persist
   *     nothing — see class-level OPEN ITEM #4 on why no partial content
   *     is saved.
   *
   * Yields text chunks (AsyncGenerator<string>), not a Promise — the
   * Route layer is responsible for piping this to the HTTP response
   * stream.
   */
  async *sendMessage(
    rawParams: unknown,
    analysisId: string,
    rawInput: unknown,
  ): AsyncGenerator<string, void, undefined> {
    const input = sendMessageInputSchema.parse(rawInput);

    const conversation = await this.getConversationById(
      rawParams,
      analysisId,
      input.conversationId,
    );

    await this.chatMessageRepository.create({
      conversation_id: conversation.id,
      role: 'user',
      content: input.content,
    });

    const [
      classification,
      riskDetection,
      missingClauseDetection,
      complianceDetection,
      aiRecommendation,
      legalHealthScore,
      aiLegalInsight,
      history,
    ] = await Promise.all([
      this.getLatestCompletedClassificationForAnalysis(rawParams, analysisId),
      this.getLatestCompletedRiskDetectionForAnalysis(rawParams, analysisId),
      this.getLatestCompletedMissingClauseDetectionForAnalysis(rawParams, analysisId),
      this.getLatestCompletedComplianceDetectionForAnalysis(rawParams, analysisId),
      this.getLatestCompletedAIRecommendationForAnalysis(rawParams, analysisId),
      this.getLatestCompletedLegalHealthScoreForAnalysis(rawParams, analysisId),
      this.getLatestCompletedAiLegalInsightForAnalysis(rawParams, analysisId),
      this.chatMessageRepository.findManyForConversation(conversation.id),
    ]);

    const request = {
      systemPrompt: buildSystemPrompt(),
      userPrompt: buildUserPrompt({
        classification,
        riskDetection,
        missingClauseDetection,
        complianceDetection,
        aiRecommendation,
        legalHealthScore,
        aiLegalInsight,
        history,
      }),
    };

    let fullText = '';
    let providerUsed: AIProviderName;

    try {
      const stream = generateStreamingWithFallback(request);

      while (true) {
        const next = await stream.next();

        if (next.done) {
          providerUsed = next.value;
          break;
        }

        fullText += next.value;
        yield next.value;
      }
    } catch (error) {
      // Pre-stream failure only — per the Provider Layer amendment's
      // contract, a mid-stream failure propagates from WITHIN the
      // for-await above, meaning fullText already has partial content
      // yielded to the caller by the time it's thrown. Per OPEN ITEM #4,
      // no partial assistant message is persisted either way — the
      // user's own message (already saved above) is the only durable
      // record of this turn if generation fails.
      if (error instanceof AIProviderError) {
        const message =
          USER_SAFE_FAILURE_MESSAGES[error.code] ??
          USER_SAFE_FAILURE_MESSAGES[ErrorCode.AI_PROVIDER_UNAVAILABLE];
        throw new AIProviderError(error.provider, error.code, message ?? error.message, error);
      }

      throw error;
    }

    await this.chatMessageRepository.create({
      conversation_id: conversation.id,
      role: 'assistant',
      content: fullText,
      provider_used: providerUsed,
    });

    await this.chatConversationRepository.touch(conversation.id);
  }
}

/**
 * System prompt for the chat model. Explicitly instructs it to answer
 * from the provided context rather than general legal knowledge, and to
 * be transparent about what it does not have visibility into (raw
 * document text — see class-level OPEN ITEM on this gap).
 */
function buildSystemPrompt(): string {
  return [
    'You are the AI Legal Chat assistant for JurisAI, an AI legal',
    "operating system serving customers in India. You are given a",
    "document's clause classification, risk detection, missing clause",
    'detection, compliance detection, AI recommendations, legal health',
    'score, and AI legal insights — plus the ongoing conversation history',
    '— and you answer the user\'s questions about their document.',
    '',
    'Rules:',
    '- Answer using the structured findings provided below. Do not invent',
    '  specific clause text or document details you have not been given.',
    '- You do NOT currently have access to the raw text of the document',
    '  itself — only the structured outputs of prior analysis passes. If',
    '  a question genuinely requires quoting or reading exact clause',
    '  wording you were not given, say so plainly rather than guessing.',
    '- Write in plain language for someone without a legal background.',
    '- This is not a substitute for a lawyer\'s review — for anything with',
    '  real legal or financial stakes, say so and suggest professional',
    '  review, same standard as AI Recommendation Engine\'s',
    '  seek_professional_review action type.',
  ].join('\n');
}

/**
 * Builds the user-turn prompt from all seven upstream structured outputs
 * plus full conversation history. Serialized as JSON for the upstream
 * blocks, consistent with every prior module's identical treatment;
 * conversation history rendered as a plain transcript, since that's
 * genuinely prose, not structured reference data.
 *
 * OPEN ITEM (see class-level note): no raw document/OCR text included.
 * NO history length cap: every message in the conversation is included
 * in full — flagged as a known scalability gap, not solved here.
 */
function buildUserPrompt(context: {
  classification: unknown;
  riskDetection: unknown;
  missingClauseDetection: unknown;
  complianceDetection: unknown;
  aiRecommendation: unknown;
  legalHealthScore: unknown;
  aiLegalInsight: unknown;
  history: ChatMessage[];
}): string {
  const transcript = context.history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  return [
    '=== CLAUSE BREAKDOWN ===',
    JSON.stringify(context.classification, null, 2),
    '',
    '=== RISK FLAGS ===',
    JSON.stringify(context.riskDetection, null, 2),
    '',
    '=== MISSING CLAUSE FLAGS ===',
    JSON.stringify(context.missingClauseDetection, null, 2),
    '',
    '=== COMPLIANCE FLAGS ===',
    JSON.stringify(context.complianceDetection, null, 2),
    '',
    '=== RECOMMENDATIONS ===',
    JSON.stringify(context.aiRecommendation, null, 2),
    '',
    '=== LEGAL HEALTH SCORE ===',
    JSON.stringify(context.legalHealthScore, null, 2),
    '',
    '=== AI LEGAL INSIGHTS ===',
    JSON.stringify(context.aiLegalInsight, null, 2),
    '',
    '=== CONVERSATION SO FAR ===',
    transcript,
  ].join('\n');
}
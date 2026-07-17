import type { AIProviderName } from '@/core/ai/ai-provider.factory';
import type { ChatMessageRole } from '@/modules/chat/chat.schemas';

/**
 * Mirrors the `chat_conversations` table (File 148 migration).
 * snake_case, matching Postgrest's default column naming — no camelCase
 * mapping layer anywhere in this project, consistent with
 * ai-recommendation.entity.ts, compliance-detection.entity.ts, etc.
 *
 * ARCHITECTURAL NOTE, DEPARTURE FROM EVERY MODULE SINCE FILE 100: unlike
 * AIRecommendation/ComplianceDetection/MissingClauseDetection/
 * RiskDetection, this entity has NO status/result/error_message
 * run-lifecycle shape. A conversation is not a single run that succeeds
 * or fails — it's an open-ended, mutable thread. Closer in shape to
 * Profile (File 27) than to any AI-run entity built since.
 */
export interface ChatConversation {
  id: string;
  document_analysis_id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

/**
 * Fields required to create a new conversation.
 *
 * KEY DECISION — unlike every prior Create*Input (which only ever needed
 * document_analysis_id, since ownership was resolved via the analysis
 * itself), this requires user_id directly. Ownership is stored directly
 * on chat_conversations (File 148 design decision), not inferred via a
 * join, so BaseService.requireOwnership() has a bare id to check against.
 *
 * No title accepted — title-generation strategy remains an open item
 * (flagged in File 148 and File 149). Rows are created with title: null;
 * a later amendment can add title-setting once that's decided.
 */
export interface CreateChatConversationInput {
  document_analysis_id: string;
  user_id: string;
}

/**
 * Mirrors the `chat_messages` table (File 148 migration). Append-only —
 * no update/delete policies exist on this table at the RLS layer, so no
 * Update*Input type is defined here; there is nothing to update.
 */
export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: ChatMessageRole;
  content: string;
  /**
   * Reuses AIProviderName (File 61's factory), same choice
   * ai-recommendation.entity.ts already made for its own provider_used
   * column — the concrete 'openai' | 'gemini' union, not a re-derived
   * database enum. Null for 'user'-role messages, which never have a
   * provider.
   */
  provider_used: AIProviderName | null;
  created_at: string;
}

/**
 * Fields required to create a new message row.
 *
 * KEY DECISION, FLAGGED AS A SOFT SPOT — provider_used is a plain
 * optional field here, not enforced via a discriminated union
 * ({ role: 'user' } | { role: 'assistant'; provider_used: AIProviderName }).
 * A stricter discriminated union would prevent an assistant message from
 * ever being constructed without a provider at the type level, but every
 * prior Create*Input in this project has stayed a flat interface — this
 * keeps that convention rather than introducing a new pattern for one
 * table. The Service layer (File 152/153) is responsible for ensuring
 * this invariant holds at runtime. Revisit if stricter typing is wanted.
 */
export interface CreateChatMessageInput {
  conversation_id: string;
  role: ChatMessageRole;
  content: string;
  provider_used?: AIProviderName;
}
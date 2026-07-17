import { z } from 'zod';

/**
 * Provider-agnostic generation tuning. Deliberately minimal — only
 * options that are meaningful across both OpenAI and Gemini belong here.
 * Provider-specific tuning (e.g. OpenAI's `seed`) stays inside that
 * provider's own implementation, never leaks into this shared surface.
 */
export interface AIGenerationOptions {
  /** 0-2 typically. Lower = more deterministic. Provider clamps to its own valid range. */
  temperature?: number;
  /** Hard ceiling on response length. Provider-specific default applies if omitted. */
  maxOutputTokens?: number;
}

export interface AIGenerationRequest<TSchema extends z.ZodTypeAny> {
  /** Role/behavior instructions — not user-controlled content. */
  systemPrompt: string;
  /** The actual task input — may contain user- or document-derived content. */
  userPrompt: string;
  /**
   * The shape the response MUST conform to. This is the mechanism by which
   * callers get rich, multi-field results in a single round-trip instead of
   * a block of prose that has to be re-parsed downstream. Every field the
   * customer-facing result needs should be represented in this schema —
   * if it's not in the schema, the model has no obligation to return it.
   */
  schema: TSchema;
  options?: AIGenerationOptions;
}

/**
 * AMENDMENT (Provider Layer — Streaming Support, prerequisite to Module 8
 * AI Legal Chat): request shape for free-text streaming generation.
 *
 * Deliberately NOT parameterized by a Zod schema, unlike
 * AIGenerationRequest<TSchema>. Streaming and structured-output validation
 * are in tension by design — you cannot schema.safeParse() a partial JSON
 * chunk mid-stream. Chat responses are conversational prose, not structured
 * data extraction, so this method sidesteps the problem entirely rather
 * than attempting to reconcile it.
 *
 * `userPrompt` carries whatever the caller (Module 8's Service) has already
 * assembled — eagerly-fetched upstream module context plus conversation
 * history. This interface does not know or care about that structure; it
 * is opaque prompt content, same boundary AIGenerationRequest keeps today.
 */
export interface AIStreamingGenerationRequest {
  /** Role/behavior instructions — not user-controlled content. */
  systemPrompt: string;
  /** The actual task input, including any injected context and conversation history. */
  userPrompt: string;
  options?: AIGenerationOptions;
}

/**
 * Provider-agnostic contract for structured LLM generation.
 *
 * Every implementation (OpenAI, Gemini) must:
 *  - Return data that has ALREADY been validated against `schema` — callers
 *    never receive unvalidated JSON and never re-validate themselves.
 *  - Never return partial/best-effort results on failure. Failure means
 *    throwing an AIProviderError (see @/core/errors/app-error), never
 *    returning null, an empty object, or a schema-shaped placeholder.
 *  - Map their own SDK's failure modes onto the existing AIProviderError
 *    codes (AI_PROVIDER_TIMEOUT, AI_PROVIDER_RATE_LIMITED,
 *    AI_PROVIDER_CONTENT_REJECTED, AI_PROVIDER_INVALID_RESPONSE,
 *    AI_PROVIDER_UNAVAILABLE) rather than letting a raw SDK error escape.
 *  - Never silently drop or truncate schema fields to fit a token budget —
 *    if the schema can't be satisfied, that's an AI_PROVIDER_INVALID_RESPONSE,
 *    not a smaller result.
 *
 * AMENDMENT (Provider Layer — Streaming Support): every implementation must
 * additionally satisfy the generateStreamingText() contract documented on
 * that method below.
 */
export interface AIProvider {
  readonly name: 'openai' | 'gemini';

  generateStructured<TSchema extends z.ZodTypeAny>(
    request: AIGenerationRequest<TSchema>,
  ): Promise<z.infer<TSchema>>;

  /**
   * AMENDMENT (Provider Layer — Streaming Support): free-text streaming
   * generation. Returns an async generator of text deltas rather than a
   * Promise, so the Route layer (Module 8) can pipe chunks to the client
   * as they arrive instead of waiting for full completion.
   *
   * Implementations must:
   *  - Yield incremental text deltas as they arrive from the underlying
   *    SDK — never buffer the full response and yield it as one chunk
   *    (that defeats the purpose; use generateStructured() instead if the
   *    full response is needed anyway).
   *  - Map SDK failure modes onto the same AIProviderError codes used by
   *    generateStructured().
   *  - Throw BEFORE the first `yield` if the failure occurs before any
   *    content has been produced. This is what allows fallback logic at
   *    the Factory layer to distinguish "never started" from "died
   *    mid-stream" (see generateStreamingWithFallback()).
   *  - Throw from within the generator (propagating naturally out of the
   *    `for await` loop) if the failure occurs after at least one chunk
   *    has already been yielded — never swallowed, never yielded as if it
   *    were content.
   */
  generateStreamingText(
    request: AIStreamingGenerationRequest,
  ): AsyncGenerator<string, void, undefined>;
}
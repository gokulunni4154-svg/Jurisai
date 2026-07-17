import { z } from 'zod';

import { AIProviderError, ErrorCode } from '@/core/errors/app-error';
import type {
  AIGenerationRequest,
  AIProvider,
  AIStreamingGenerationRequest,
} from '@/core/ai/ai-provider.interface';
import { OpenAIProvider } from '@/core/ai/providers/openai.provider';
import { GeminiProvider } from '@/core/ai/providers/gemini.provider';

export type AIProviderName = 'openai' | 'gemini';

/**
 * AMENDMENT #18: generateWithFallback()'s return type changed from
 * `Promise<z.infer<TSchema>>` to `Promise<AIGenerationOutcome<TSchema>>`.
 *
 * Reason: File 64 (document-analysis.repository.ts)'s markCompleted()
 * records which provider actually produced a given analysis — necessary
 * given this function's whole purpose is silently falling back to a
 * second vendor on transient failure. The bare result gave callers no
 * way to know which vendor answered. Surfaced while building File 65,
 * which is this function's first real caller — flagged as an amendment
 * per project convention rather than silently baked into File 65.
 *
 * No existing callers to break: File 61 has been built but not yet
 * consumed anywhere before now.
 */
export interface AIGenerationOutcome<TSchema extends z.ZodTypeAny> {
  result: z.infer<TSchema>;
  providerUsed: AIProviderName;
}

/**
 * Transient failure codes — worth retrying against a fallback provider.
 * Deliberately excludes CONTENT_REJECTED and INVALID_RESPONSE: a refusal
 * or a schema mismatch is not fixed by asking a different vendor the
 * exact same question, and masking it behind a silent fallback would
 * hide a real prompt/schema problem from whoever's debugging it.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  ErrorCode.AI_PROVIDER_TIMEOUT,
  ErrorCode.AI_PROVIDER_RATE_LIMITED,
  ErrorCode.AI_PROVIDER_UNAVAILABLE,
]);

/**
 * Builds a single named provider. Never cached at module scope, per
 * project convention — each call constructs a fresh instance, consistent
 * with buildProfileService()/buildDocumentService().
 */
export function buildAIProvider(name: AIProviderName): AIProvider {
  switch (name) {
    case 'openai':
      return new OpenAIProvider();
    case 'gemini':
      return new GeminiProvider();
  }
}

/**
 * Builds the configured default provider. AI_DEFAULT_PROVIDER env var
 * overrides; falls back to 'openai' if unset. Throws at call time (not
 * silently) if the env var holds a value that isn't a real provider name.
 */
function resolveDefaultProviderName(): AIProviderName {
  const configured = process.env['AI_DEFAULT_PROVIDER'];

  if (!configured) {
    return 'openai';
  }

  if (configured !== 'openai' && configured !== 'gemini') {
    throw new Error(
      `AI_DEFAULT_PROVIDER is set to an unrecognized value "${configured}" — must be "openai" or "gemini"`,
    );
  }

  return configured;
}

/**
 * Calls the default provider; on a transient failure, retries once
 * against the other provider before giving up. Every module that needs
 * AI generation should go through this function rather than calling
 * buildAIProvider() directly, unless it has a specific reason to pin to
 * one vendor (e.g. comparing provider outputs).
 *
 * Deliberately a single retry, not a loop — if both providers fail
 * transiently, that's a real outage worth surfacing to the caller as an
 * AIProviderError, not silently retried into a long hang.
 *
 * AMENDMENT #18: now returns { result, providerUsed } instead of a bare
 * result — see AIGenerationOutcome doc comment above.
 */
export async function generateWithFallback<TSchema extends z.ZodTypeAny>(
  request: AIGenerationRequest<TSchema>,
): Promise<AIGenerationOutcome<TSchema>> {
  const primaryName = resolveDefaultProviderName();
  const fallbackName: AIProviderName = primaryName === 'openai' ? 'gemini' : 'openai';

  const primary = buildAIProvider(primaryName);

  try {
    const result = await primary.generateStructured(request);
    return { result, providerUsed: primaryName };
  } catch (error) {
    const isRetryable = error instanceof AIProviderError && RETRYABLE_CODES.has(error.code);

    if (!isRetryable) {
      throw error;
    }

    const fallback = buildAIProvider(fallbackName);
    const result = await fallback.generateStructured(request);
    return { result, providerUsed: fallbackName };
  }
}

/**
 * AMENDMENT (Provider Layer — Streaming Support, prerequisite to Module 8
 * AI Legal Chat): streaming counterpart to generateWithFallback().
 * Deliberately NOT a drop-in — fallback semantics differ for a stream, per
 * the developer decision made ahead of Module 8:
 *
 *   - Failure BEFORE the first chunk is yielded: retry once against the
 *     fallback provider, identical in spirit to generateWithFallback().
 *   - Failure AFTER at least one chunk has been yielded: do NOT fall back.
 *     Re-throw and let the caller (Module 8's Route) surface a clean
 *     "generation interrupted" state. Silently discarding partial output
 *     already streamed to a client and restarting with a different vendor
 *     produces a visibly broken UX and cannot resume mid-sentence with a
 *     different model's context — rejected explicitly, not an oversight.
 *
 * Returns an async generator, not an outcome object — there is no
 * equivalent of AIGenerationOutcome<TSchema> here because there is no
 * schema. Callers that need to know which provider ultimately answered
 * (e.g. for logging) should track providerUsed themselves from the
 * resolved provider name, mirroring how markCompleted() consumes
 * AIGenerationOutcome today.
 */
/**
 * AMENDMENT #1 (Streaming Support amendment): return type changed from
 * AsyncGenerator<string, void, undefined> to
 * AsyncGenerator<string, AIProviderName, undefined>. The generator's
 * TReturn slot now carries which provider ultimately answered, retrieved
 * via the final `{ done: true, value }` result when the caller drains
 * the generator to completion — standard JS generator return-value
 * protocol, not a new mechanism.
 *
 * Reason: the original doc comment claimed callers could "track
 * providerUsed themselves from the resolved provider name," but no such
 * name was ever actually returned or yielded — a real gap, caught while
 * building Module 8's Service (File 153), which needs this value to
 * persist chat_messages.provider_used.
 */
export async function* generateStreamingWithFallback(
  request: AIStreamingGenerationRequest,
): AsyncGenerator<string, AIProviderName, undefined> {
  const primaryName = resolveDefaultProviderName();
  const fallbackName: AIProviderName = primaryName === 'openai' ? 'gemini' : 'openai';

  const primary = buildAIProvider(primaryName);

  let primaryStream: AsyncGenerator<string, void, undefined>;

  try {
    primaryStream = primary.generateStreamingText(request);
    const first = await primaryStream.next();

    if (!first.done && first.value) {
      yield first.value;
    }
  } catch (error) {
    const isRetryable = error instanceof AIProviderError && RETRYABLE_CODES.has(error.code);

    if (!isRetryable) {
      throw error;
    }

    const fallback = buildAIProvider(fallbackName);
    yield* fallback.generateStreamingText(request);
    return fallbackName;
  }

  for await (const chunk of primaryStream) {
    yield chunk;
  }

  return primaryName;
}
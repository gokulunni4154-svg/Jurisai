import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError as OpenAIRateLimitError,
} from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import { AIProviderError } from '@/core/errors/app-error';
import { ErrorCode } from '@/core/errors/app-error';
import type {
  AIGenerationRequest,
  AIProvider,
  AIStreamingGenerationRequest,
} from '@/core/ai/ai-provider.interface';

/**
 * Default model. OpenAI's own current documentation (July 2026) uses
 * gpt-5.6 as the flagship example for chat.completions.parse structured
 * outputs. NOT independently verified against pricing/availability for
 * this account — confirm before relying on this in production, and
 * override via OPENAI_MODEL if a different model is preferred.
 */
const DEFAULT_MODEL = 'gpt-5.6';

export class OpenAIProvider implements AIProvider {
  public readonly name = 'openai' as const;

  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      // Fails fast at construction, not on first request — a missing key
      // should never reach production traffic before being noticed.
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    this.client = new OpenAI({ apiKey });
    this.model = process.env['OPENAI_MODEL'] ?? DEFAULT_MODEL;
  }

  async generateStructured<TSchema extends z.ZodTypeAny>(
    request: AIGenerationRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const { systemPrompt, userPrompt, schema, options } = request;

    try {
      // AMENDMENT (stabilization pass, openai@4.63.0): structured-output
      // .parse() is not yet promoted to the top-level chat.completions
      // namespace at this SDK version — it lives under `.beta`. Revisit
      // if/when the project upgrades the openai package and confirm
      // whether `.beta` is still required at the new version before
      // removing it.
      const completion = await this.client.beta.chat.completions.parse({
        model: this.model,
        temperature: options?.temperature,
        max_tokens: options?.maxOutputTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        // zodResponseFormat name is used by OpenAI for schema caching —
        // stable across calls with the same schema shape is intentional.
        response_format: zodResponseFormat(schema, 'ai_generation_result'),
      });

      const choice = completion.choices[0];

      if (choice?.message.refusal) {
        throw new AIProviderError(
          'openai',
          ErrorCode.AI_PROVIDER_CONTENT_REJECTED,
          `OpenAI refused to generate a response: ${choice.message.refusal}`,
        );
      }

      if (choice?.finish_reason === 'length') {
        // The model hit max_tokens before finishing — per interface contract,
        // this is a failure, not a truncated success.
        throw new AIProviderError(
          'openai',
          ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
          'OpenAI response was truncated before completing the required schema (max_tokens reached)',
        );
      }

      const parsed = choice?.message.parsed;

      if (parsed === null || parsed === undefined) {
        throw new AIProviderError(
          'openai',
          ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
          'OpenAI response did not include parsed structured output',
        );
      }

      return parsed;
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw error;
      }

      throw this.mapSdkError(error);
    }
  }

  /**
   * AMENDMENT (Provider Layer — Streaming Support): free-text streaming
   * generation for Module 8 (AI Legal Chat). Uses the plain completions
   * endpoint with `stream: true` — NOT `.beta.chat.completions.parse()`,
   * which is the structured-output path used by generateStructured() and
   * is fundamentally non-streaming (it waits for a complete,
   * schema-validated response before returning anything).
   */
  async *generateStreamingText(
    request: AIStreamingGenerationRequest,
  ): AsyncGenerator<string, void, undefined> {
    const { systemPrompt, userPrompt, options } = request;

    let stream: Awaited<ReturnType<OpenAI['chat']['completions']['create']>>;

    try {
      stream = await this.client.chat.completions.create({
        model: this.model,
        temperature: options?.temperature,
        max_tokens: options?.maxOutputTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: true,
      });
    } catch (error) {
      // Failure before the first chunk — throws before any yield, per
      // interface contract, so Factory-layer fallback logic can safely
      // retry against the other provider.
      throw this.mapSdkError(error);
    }

    try {
      // AMENDMENT (tsc cleanup pass): the @ts-expect-error previously here
      // is gone — verified via `pnpm tsc --noEmit` reporting it as an
      // "Unused '@ts-expect-error' directive" error (TS2578), meaning the
      // SDK's overload resolution now narrows `stream` to an async
      // iterable correctly on its own for this call shape. If a future
      // SDK upgrade reintroduces the narrowing failure, tsc will surface
      // it again as a real type error at this line, not silently.
      for await (const chunk of stream) {
        const choice = chunk.choices[0];

        if (choice?.finish_reason === 'content_filter') {
          throw new AIProviderError(
            'openai',
            ErrorCode.AI_PROVIDER_CONTENT_REJECTED,
            'OpenAI refused to continue generating a response (content filter)',
          );
        }

        const delta = choice?.delta?.content;

        if (delta) {
          yield delta;
        }
      }
    } catch (error) {
      // Failure mid-stream — propagates from within the generator, per
      // interface contract, so the caller can distinguish "some content
      // already reached the client" from a clean pre-stream failure.
      if (error instanceof AIProviderError) {
        throw error;
      }
      throw this.mapSdkError(error);
    }
  }

  /**
   * Maps openai SDK's own typed errors onto our AIProviderError codes.
   * Anything not recognized falls back to AI_PROVIDER_UNAVAILABLE rather
   * than letting a raw SDK error escape the provider boundary. Shared
   * unchanged between generateStructured() and generateStreamingText() —
   * the SDK's typed error classes are the same regardless of streaming.
   */
  private mapSdkError(error: unknown): AIProviderError {
    if (error instanceof APIConnectionTimeoutError) {
      return new AIProviderError(
        'openai',
        ErrorCode.AI_PROVIDER_TIMEOUT,
        'OpenAI request timed out',
        error,
      );
    }

    if (error instanceof OpenAIRateLimitError) {
      return new AIProviderError(
        'openai',
        ErrorCode.AI_PROVIDER_RATE_LIMITED,
        'OpenAI rate limit exceeded',
        error,
      );
    }

    if (error instanceof APIConnectionError) {
      return new AIProviderError(
        'openai',
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        'Could not connect to OpenAI',
        error,
      );
    }

    if (error instanceof APIError) {
      // Any other 4xx/5xx from OpenAI we don't specifically distinguish —
      // treat as unavailable rather than guessing at intent.
      return new AIProviderError(
        'openai',
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        `OpenAI API error: ${error.message}`,
        error,
      );
    }

    return new AIProviderError(
      'openai',
      ErrorCode.AI_PROVIDER_UNAVAILABLE,
      'Unexpected error calling OpenAI',
      error,
    );
  }
}
// src/core/ai/providers/gemini.provider.ts
// File 62 — JurisAI AI Provider Layer
// AMENDMENT #26: switched from z.toJSONSchema() (Zod v4-only, never worked
// on this project's Zod v3.23.8) to zodToJsonSchema() from the
// zod-to-json-schema package. Also confirms @google/genai (already imported
// here) as the correct package to standardize on — it is Google's actively
// maintained, GA SDK; @google/generative-ai (what was actually installed
// pre-Amendment) is the deprecated legacy package as of Nov 30, 2025.
// Resolves Open Issues #3 and #4 together, per the recommendation to treat
// them as one fix.
//
// KNOWN FUTURE DEBT, flagged not hidden: zod-to-json-schema is no longer
// actively maintained as of Nov 2025 (per its own README) — it is the
// correct v3-compatible bridge for now, same category as openai.provider.ts's
// zodResponseFormat() helper. If this project ever upgrades to Zod v4,
// revisit this file and swap back to native z.toJSONSchema().
//
// AMENDMENT (Provider Layer — Streaming Support, prerequisite to Module 8
// AI Legal Chat): adds generateStreamingText(), using generateContentStream()
// — a genuinely different SDK call from generateContent(), not a config
// flag on the same call. No responseJsonSchema/responseMimeType here:
// schema-constrained JSON mode and token streaming are not combined, per
// this amendment's whole premise (see ai-provider.interface.ts doc comment).
//
// NOT YET LIVE-TESTED: this is the first time this project has exercised
// the streaming half of the @google/genai SDK. The shape of
// generateContentStream()'s return value is based on Google's documented
// pattern, consistent with this file's existing generateContent() usage,
// but should be smoke-tested against a live API key before Module 8 ships.

import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { AIProviderError, ErrorCode } from '@/core/errors/app-error';
import type {
  AIGenerationRequest,
  AIProvider,
  AIStreamingGenerationRequest,
} from '@/core/ai/ai-provider.interface';

/**
 * Default model. gemini-3.5-flash is the model used consistently across
 * Google's own current documentation (July 2026) for structured-output
 * examples — a reasonable default, not independently verified against
 * this account's tier/availability. Override via GEMINI_MODEL.
 */
const DEFAULT_MODEL = 'gemini-3.5-flash';

/** Gemini SDK errors carry an HTTP-like `.status` — no dedicated typed error classes to catch. */
interface GeminiSdkError {
  status?: number;
  message?: string;
}

function isGeminiSdkError(error: unknown): error is GeminiSdkError {
  return typeof error === 'object' && error !== null && 'status' in error;
}

export class GeminiProvider implements AIProvider {
  public readonly name = 'gemini' as const;

  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    this.client = new GoogleGenAI({ apiKey });
    this.model = process.env['GEMINI_MODEL'] ?? DEFAULT_MODEL;
  }

  async generateStructured<TSchema extends z.ZodTypeAny>(
    request: AIGenerationRequest<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const { systemPrompt, userPrompt, schema, options } = request;

    let rawText: string | undefined;

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          // AMENDMENT #26: zodToJsonSchema() replaces z.toJSONSchema() —
          // same responseJsonSchema config key, Zod v3-compatible producer.
          // Same schema object used for OpenAI's zodResponseFormat, single
          // source of truth for the shape.
          responseJsonSchema: zodToJsonSchema(schema),
          temperature: options?.temperature,
          maxOutputTokens: options?.maxOutputTokens,
        },
      });

      const candidate = response.candidates?.[0];

      if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
        throw new AIProviderError(
          'gemini',
          ErrorCode.AI_PROVIDER_CONTENT_REJECTED,
          `Gemini refused to generate a response (finishReason: ${candidate.finishReason})`,
        );
      }

      if (candidate?.finishReason === 'MAX_TOKENS') {
        throw new AIProviderError(
          'gemini',
          ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
          'Gemini response was truncated before completing the required schema (max output tokens reached)',
        );
      }

      rawText = response.text;

      if (!rawText) {
        throw new AIProviderError(
          'gemini',
          ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
          'Gemini response did not include any text output',
        );
      }

      const parsedJson = JSON.parse(rawText);

      // Gemini's JSON Schema adherence is not guaranteed as strictly as
      // OpenAI's — re-validate with the real Zod schema rather than
      // trusting the API's own schema compliance. This is the interface
      // contract ("callers never receive unvalidated JSON"), applied
      // here because Gemini specifically needs the extra check.
      const result = schema.safeParse(parsedJson);

      if (!result.success) {
        throw new AIProviderError(
          'gemini',
          ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
          `Gemini response did not match the required schema: ${result.error.message}`,
          result.error,
        );
      }

      return result.data;
    } catch (error) {
      if (error instanceof AIProviderError) {
        throw error;
      }

      if (error instanceof SyntaxError) {
        throw new AIProviderError(
          'gemini',
          ErrorCode.AI_PROVIDER_INVALID_RESPONSE,
          'Gemini response was not valid JSON',
          error,
        );
      }

      throw this.mapSdkError(error);
    }
  }

  /**
   * AMENDMENT (Provider Layer — Streaming Support): free-text streaming
   * generation for Module 8 (AI Legal Chat). Uses generateContentStream(),
   * not generateContent() — a distinct SDK call, not a config flag.
   */
  async *generateStreamingText(
    request: AIStreamingGenerationRequest,
  ): AsyncGenerator<string, void, undefined> {
    const { systemPrompt, userPrompt, options } = request;

    let stream: AsyncGenerator<{
      candidates?: Array<{ finishReason?: string }>;
      text?: string;
    }>;

    try {
      stream = await this.client.models.generateContentStream({
        model: this.model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: options?.temperature,
          maxOutputTokens: options?.maxOutputTokens,
        },
      });
    } catch (error) {
      // Failure before the first chunk — throws before any yield, per
      // interface contract, so Factory-layer fallback logic can safely
      // retry against the other provider.
      throw this.mapSdkError(error);
    }

    try {
      for await (const chunk of stream) {
        const candidate = chunk.candidates?.[0];

        if (
          candidate?.finishReason === 'SAFETY' ||
          candidate?.finishReason === 'PROHIBITED_CONTENT'
        ) {
          throw new AIProviderError(
            'gemini',
            ErrorCode.AI_PROVIDER_CONTENT_REJECTED,
            `Gemini refused to continue generating a response (finishReason: ${candidate.finishReason})`,
          );
        }

        const delta = chunk.text;

        if (delta) {
          yield delta;
        }
      }
    } catch (error) {
      // Failure mid-stream — propagates from within the generator, per
      // interface contract.
      if (error instanceof AIProviderError) {
        throw error;
      }
      throw this.mapSdkError(error);
    }
  }

  private mapSdkError(error: unknown): AIProviderError {
    if (isGeminiSdkError(error)) {
      const status = error.status;

      if (status === 429) {
        return new AIProviderError(
          'gemini',
          ErrorCode.AI_PROVIDER_RATE_LIMITED,
          'Gemini rate limit exceeded',
          error,
        );
      }

      if (status === 504 || status === 408) {
        return new AIProviderError(
          'gemini',
          ErrorCode.AI_PROVIDER_TIMEOUT,
          'Gemini request timed out',
          error,
        );
      }

      if (status !== undefined && status >= 500) {
        return new AIProviderError(
          'gemini',
          ErrorCode.AI_PROVIDER_UNAVAILABLE,
          `Gemini service unavailable (status ${status})`,
          error,
        );
      }

      return new AIProviderError(
        'gemini',
        ErrorCode.AI_PROVIDER_UNAVAILABLE,
        `Gemini API error: ${error.message ?? 'unknown error'}`,
        error,
      );
    }

    return new AIProviderError(
      'gemini',
      ErrorCode.AI_PROVIDER_UNAVAILABLE,
      'Unexpected error calling Gemini',
      error,
    );
  }
}
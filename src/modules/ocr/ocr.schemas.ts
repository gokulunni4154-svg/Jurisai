// src/modules/ocr/ocr.schemas.ts
// File 72 — JurisAI OCR module

import { z } from 'zod';

/**
 * Status lifecycle for an OCR extraction row, deliberately identical in
 * shape and naming to document_analyses' status lifecycle (File 62/63):
 * both represent "kick off an async external-service call, track its
 * outcome as a persisted row" — reusing the same vocabulary means
 * anyone who understands one module's lifecycle already understands
 * the other's, rather than this module inventing synonymous-but-
 * different state names (e.g. 'in_progress' vs 'processing').
 *
 * - 'pending'    — row created, extraction not yet started.
 * - 'processing' — extraction in flight (fetching source, staging,
 *                  awaiting the Cloud Vision batch operation).
 * - 'completed'  — extraction succeeded; `ocr_extractions.result` is
 *                  populated per ocrExtractionResultSchema below.
 * - 'failed'     — extraction failed; `ocr_extractions.error_message`
 *                  holds a user-safe message, mirroring
 *                  document_analyses' USER_SAFE_FAILURE_MESSAGES
 *                  convention (File 65) — the OCR service (File 75)
 *                  owns translating an OCRProviderError's category
 *                  into a user-safe message, not this schemas file.
 */
export const ocrExtractionStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
]);

export type OCRExtractionStatus = z.infer<typeof ocrExtractionStatusSchema>;

/**
 * Shape of a successful extraction's persisted result data — the
 * `result` jsonb column's real, narrower shape (same reasoning
 * document_analyses' repository, File 64, already documents for its
 * own `result` column: the generic Postgrest `Update` type can't
 * express this narrower shape, so lifecycle-transition methods bypass
 * the generic update() entirely and are typed against this schema
 * instead).
 *
 * DELIBERATELY NOT the same type as OCRExtractionResult (File 70's
 * provider interface). That type is what a provider returns in-memory
 * immediately after a call; this schema is what gets persisted and
 * validated at the database boundary. Keeping them distinct means a
 * future provider-side addition (e.g. a debug/raw-response field on
 * OCRExtractionResult) doesn't silently become part of what's stored,
 * and a future storage-shape change doesn't ripple back into every
 * provider implementation's return type.
 */
export const ocrExtractionResultSchema = z.object({
  text: z.string(),
  pageCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
});

export type OCRExtractionResultData = z.infer<typeof ocrExtractionResultSchema>;

/**
 * Identifies which provider produced a completed extraction. A plain
 * string, not a fixed enum, mirroring provider identification in the
 * AI module: today's only value is 'google-vision' (File 71), but
 * this column/field should not require a schema change every time a
 * new provider is added — the same reasoning File 70's
 * OCRExtractionResult.provider field already documents.
 */
export const ocrProviderNameSchema = z.string().min(1);
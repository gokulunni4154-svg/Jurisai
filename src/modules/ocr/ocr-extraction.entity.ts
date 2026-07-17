// src/modules/ocr/ocr-extraction.entity.ts
// File 73 — JurisAI OCR module

import { OCRExtractionResultData, OCRExtractionStatus } from './ocr.schemas';

/**
 * Hand-written entity type, NOT derived from
 * Database['public']['Tables']['ocr_extractions'] — the same
 * documented gap document-analysis.entity.ts (File 63) already carries
 * for document_analyses. `database.types.ts` (File 11) regeneration to
 * include this new table is assumed, not independently verified, for
 * the same reason File 64's header comments already flag for
 * document_analyses: this type cannot compile against the real base
 * repository class otherwise. `result`'s real narrower shape
 * (OCRExtractionResultData) is handled the same way File 64 handles
 * document_analyses.result — via typed transition methods with `as
 * never` casts at the repository layer (File 74), not resolved at the
 * type-generation level here.
 */
export interface OCRExtraction {
  id: string;
  document_id: string;
  status: OCRExtractionStatus;
  result: OCRExtractionResultData | null;
  provider: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Minimal insert shape — mirrors CreateDocumentAnalysisInput's minimal
 * `{ document_id }` pattern (File 65): a row is created in 'pending'
 * status with nothing else populated yet, the same "create first,
 * populate on transition" lifecycle document_analyses already uses.
 */
export interface CreateOCRExtractionInput {
  document_id: string;
}

/**
 * The actual migration is a SEPARATE standalone .sql file — see
 * supabase/migrations/<needs real timestamp>_create_ocr_extractions_table.sql,
 * created alongside this entity file. This project's established
 * convention (confirmed via Files 25, 45, and 63's real folder
 * locations) is standalone .sql files under supabase/migrations/, not
 * SQL embedded in TypeScript. An earlier draft of this file embedded
 * the SQL as a JS template string here — caught and corrected before
 * being presented as final, since it broke from the confirmed
 * convention.
 */
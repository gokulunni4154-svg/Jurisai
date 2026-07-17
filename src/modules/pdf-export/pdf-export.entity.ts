// src/modules/pdf-export/pdf-export.entity.ts
// File 163 — JurisAI PDF Export module

export type PdfExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Mirrors the `pdf_exports` table (see migration
 * 20260724000000_pdf_exports.sql, File 162). This is the shape returned
 * by BaseRepository<'pdf_exports'> — snake_case, matching Postgrest's
 * default column naming, consistent with every other entity in this
 * project (no camelCase mapping layer anywhere).
 *
 * `status` is typed here as a plain string union, not re-derived from a
 * database enum — same choice document-analysis.entity.ts,
 * clause-classification.entity.ts, and legal-health-score.entity.ts all
 * already made for their own status columns. File 162's migration itself
 * flags that this table's status column being text+check (not a native
 * Postgres enum) is an assumption carried from documents.sql's stated
 * reasoning, not independently re-verified against File 63/132's real
 * migration text — noted here too so that assumption isn't silently lost
 * if this entity file is ever read in isolation.
 *
 * NO `result` FIELD — unlike every AI-pipeline entity (DocumentAnalysis,
 * ClauseClassification, LegalHealthScore, etc.), this table has nothing
 * analogous. A PDF export doesn't produce new structured findings; it
 * deterministically composes already-validated ClauseClassificationResult
 * and LegalHealthScoreResult data (Files 93/133) into a rendered
 * document. There is nothing here for a schemas.ts / Zod result schema
 * to validate, which is why this module has no companion
 * pdf-export.schemas.ts the way ocr.schemas.ts or every AI-pipeline
 * module's schemas.ts exists — deliberate, not an oversight.
 *
 * `user_id` — denormalized directly on this table (see File 162's own
 * comment), not inferred via a join through document_analysis_id ->
 * document_id -> documents.owner_id. Same rationale as
 * chat_conversations.user_id (File 148): BaseService.requireOwnership()
 * gets a bare id to check against without an extra join.
 */
export interface PdfExport {
  id: string;
  document_analysis_id: string;
  user_id: string;
  status: PdfExportStatus;
  storage_path: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Fields required to create a new export run. Everything else (status,
 * storage_path, error_message, completed_at) is either DB-defaulted or
 * populated later as the run progresses from pending -> processing ->
 * completed/failed — identical lifecycle shape to every prior module's
 * CreateXInput.
 *
 * UNLIKE CreateDocumentAnalysisInput/CreateClauseClassificationInput
 * (which only need `{ document_id }` / `{ document_analysis_id }`, since
 * ownership is checked via a join elsewhere), this input ALSO requires
 * `user_id` explicitly — because pdf_exports.user_id is a real not-null
 * column with no default, denormalized for the reason explained above.
 * The Service layer is responsible for supplying the current
 * authenticated user's id here, not leaving it to a DB default that
 * doesn't exist.
 */
export interface CreatePdfExportInput {
  document_analysis_id: string;
  user_id: string;
}
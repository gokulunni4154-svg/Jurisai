// src/shared/components/dashboard/upload-analyze-modal.tsx
// NEW FILE — General Portal Phase 2, "Upload → Analyze" quick flow.
//
// SOURCE-VERIFIED AGAINST (this session, real pasted/read files, not
// paraphrased):
//   - src/core/storage/document-upload.ts — uploadDocument()/
//     validateFile()/ALLOWED_MIME_TYPES/MAX_SIZE_BYTES (the latter three
//     newly exported this session, no behavior change) are reused
//     verbatim. This modal does NOT re-implement Storage upload or
//     duplicate the allow-list/size-limit — Step 1 below calls the real
//     validateFile() so the error a user sees here is byte-for-byte the
//     same rule uploadDocument() itself enforces.
//   - src/app/api/documents/[id]/analyze/route.ts (File 67, Amendments
//     24/25) — POST returns `{ data: { extraction, analysis } }` with
//     `analysis: null` on a failed OCR extraction, and does NOT expose
//     any interim/percentage progress: OCR + AI analysis run as one
//     blocking call. This modal shows exactly two REAL stages tied to
//     real promises ("Uploading…" / "Analyzing your document…") and
//     deliberately does not invent a fake multi-step progress bar or
//     percentage, per the task brief's explicit instruction.
//   - src/app/documents/[id]/page.tsx's handleStartAnalysis() — already
//     the canonical retry surface for a failed OCR/analysis outcome
//     (its own error state + "Start Analysis" button). This modal does
//     NOT duplicate that retry UI; on any outcome (success OR failure)
//     it hands off to the real document detail page, which already
//     knows how to display/retry from wherever the analysis actually
//     landed.
//
// NOT INVENTED, per the brief's explicit "do not invent" list:
//   - No fake progress percentages.
//   - No new duplicate-upload policy (uploadDocument()'s random-UUID
//     storage path already makes every upload independent; there is no
//     existing duplicate-detection to reuse).
//   - No new cancellation/abort machinery. The user can close this
//     modal at any point; if a request is already in flight it is left
//     to resolve in the background rather than corrupting state with a
//     half-built abort path the rest of the codebase doesn't have.

'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, File as FileIcon, Loader2, Upload, X } from 'lucide-react';

import { uploadDocument, validateFile, UploadValidationError } from '@/core/storage/document-upload';

type FlowStep =
  | 'select'
  | 'uploading'
  | 'analyzing'
  | 'success'
  | 'upload_error'
  | 'analysis_incomplete';

interface AnalyzeOutcome {
  documentId: string;
  // Present only when OCR failed server-side and no analysis was ever
  // created — File 67's real, documented `analysis: null` shape.
  message: string | null;
}

async function extractErrorMessage(res: Response): Promise<string> {
  // Mirrors src/app/documents/[id]/page.tsx's own extractErrorMessage
  // convention exactly, so error text is consistent across both
  // surfaces rather than a second, slightly-different implementation.
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function titleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  return withoutExt.trim().length > 0 ? withoutExt.trim() : filename;
}

export function UploadAnalyzeModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<FlowStep>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AnalyzeOutcome | null>(null);

  const handlePickClick = () => fileInputRef.current?.click();

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setValidationError(null);
    try {
      // Real validation — same rule uploadDocument() itself enforces,
      // just run up front so Step 1 can show the error before the user
      // commits to starting the upload.
      validateFile(file);
      setSelectedFile(file);
    } catch (err) {
      setSelectedFile(null);
      setValidationError(err instanceof UploadValidationError ? err.message : 'That file could not be used.');
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setValidationError(null);
  };

  const runUploadAndAnalyze = async () => {
    if (!selectedFile) return;

    setStep('uploading');
    setErrorMessage(null);

    let documentId: string;
    try {
      const uploaded = await uploadDocument(selectedFile, titleFromFilename(selectedFile.name));
      documentId = uploaded.id;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Upload failed for an unknown reason.');
      setStep('upload_error');
      return;
    }

    setStep('analyzing');
    try {
      const res = await fetch(`/api/documents/${documentId}/analyze`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));

      const json = await res.json();
      const { extraction, analysis } = json.data as {
        extraction: { error_message?: string | null };
        analysis: { status: string } | null;
      };

      if (!analysis) {
        // Real, documented outcome (File 67): OCR failed, no analysis
        // was created. Not an HTTP error — handled as data, same as
        // the document detail page's own handleStartAnalysis().
        setOutcome({
          documentId,
          message:
            extraction.error_message ??
            'Text extraction failed for this document, so no analysis was created. You can try again from the document page.',
        });
        setStep('analysis_incomplete');
        return;
      }

      // The route only ever returns after the analysis has genuinely
      // finished running (inline await, see File 67's own Amendment
      // #25 decision) — 'completed' or 'failed' are the only reachable
      // terminal statuses here, never 'pending'/'processing'.
      if (analysis.status === 'failed') {
        setOutcome({
          documentId,
          message: 'Analysis could not be completed for this document. You can try again from the document page.',
        });
        setStep('analysis_incomplete');
        return;
      }

      setOutcome({ documentId, message: null });
      setStep('success');
    } catch (err) {
      // The upload itself succeeded — the document exists — so this is
      // reported as an incomplete analysis (with a real document to go
      // look at), not a full upload failure.
      setOutcome({ documentId, message: err instanceof Error ? err.message : 'Analysis failed to start.' });
      setStep('analysis_incomplete');
    }
  };

  const goToDocument = () => {
    if (!outcome) return;
    router.push(`/documents/${outcome.documentId}`);
  };

  const isBusy = step === 'uploading' || step === 'analyzing';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[15px] font-semibold text-foreground">Upload a legal document</p>
          {!isBusy && (
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {step === 'select' && (
          <div className="space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Upload a document and JurisAI will analyze it for risks, legal health, and
              recommendations.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.tiff"
              className="hidden"
              onChange={handleFileSelected}
            />

            {!selectedFile ? (
              <button
                onClick={handlePickClick}
                className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center hover:bg-muted/40"
              >
                <Upload className="h-5 w-5 text-primary" />
                <span className="text-[13px] font-medium text-foreground">Choose a file</span>
                <span className="text-[11.5px] text-muted-foreground">
                  PDF, Word, or image — up to 25 MB
                </span>
              </button>
            ) : (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-foreground">{selectedFile.name}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {selectedFile.type || 'Unknown type'} · {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleRemoveFile}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
                  aria-label="Remove file"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {validationError && (
              <p className="flex items-start gap-1.5 text-[12.5px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {validationError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={runUploadAndAnalyze}
                disabled={!selectedFile}
                className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Upload &amp; Analyze
              </button>
            </div>
          </div>
        )}

        {(step === 'uploading' || step === 'analyzing') && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-[13px] font-medium text-foreground">
              {step === 'uploading' ? 'Uploading your document…' : 'Analyzing your document…'}
            </p>
            <p className="max-w-xs text-center text-[11.5px] text-muted-foreground">
              {step === 'uploading'
                ? 'This stays on this screen — do not close your browser.'
                : 'Running text extraction and AI legal analysis. This can take up to a minute for larger documents.'}
            </p>
          </div>
        )}

        {step === 'upload_error' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <p className="text-[13px] font-medium text-foreground">Upload failed</p>
              <p className="text-[12.5px] text-muted-foreground">{errorMessage}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted"
              >
                Back to dashboard
              </button>
              <button
                onClick={() => setStep('select')}
                className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {step === 'analysis_incomplete' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <AlertTriangle className="h-6 w-6 text-amber-600" />
              <p className="text-[13px] font-medium text-foreground">Document uploaded, analysis incomplete</p>
              <p className="text-[12.5px] text-muted-foreground">{outcome?.message}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted"
              >
                Back to dashboard
              </button>
              <button
                onClick={goToDocument}
                className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
              >
                View document
              </button>
            </div>
          </div>
        )}

        {step === 'success' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-2 py-4 text-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              <p className="text-[13px] font-medium text-foreground">Analysis complete</p>
              <p className="text-[12.5px] text-muted-foreground">
                Your document&apos;s Legal Health Score, risks, and recommendations are ready.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground hover:bg-muted"
              >
                Back to dashboard
              </button>
              <button
                onClick={goToDocument}
                className="rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
              >
                View results
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

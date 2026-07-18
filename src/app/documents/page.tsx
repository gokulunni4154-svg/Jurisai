// src/app/documents/page.tsx
// File 159 — JurisAI Frontend, Phase 3
//
// AMENDMENT, THIS SESSION:
//   - Document row buttons previously had no onClick at all — clicking a
//     document did nothing. Now navigates to /documents/[id] (File 160,
//     confirmed real and already built this session's prior turns).
//   - The Bell button in the left rail previously had no onClick and no
//     badge — purely decorative. Now opens the new NotificationsPanel
//     (src/shared/components/notifications/notifications-panel.tsx, new
//     this session) and shows an unread-count badge, sourced from
//     GET /api/notifications (confirmed real response shape this
//     session — see notifications-panel.tsx's own header comment for the
//     full source-verification trail).
//
// FLAGGED: the unread count is only fetched once the panel has been
// opened at least once (NotificationsPanel's own fetch is gated on
// `isOpen`) — there is no independent "check for unread notifications on
// page load" call here. This means the badge shows 0/hidden until the
// user opens the panel for the first time in a given page load, not a
// true "you have unread notifications" indicator from the moment the
// page mounts. Flagged as a real, deliberate scope-narrowing (avoids a
// second, redundant fetch pattern/polling design this session hasn't
// been asked to build), not an oversight — revisit if "notify without
// opening" becomes a real requirement.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Upload,
  FileText,
  ChevronRight,
  ChevronLeft,
  Scale,
  FolderOpen,
  Bell,
  Settings,
  Loader2,
  AlertCircle,
  Inbox,
} from 'lucide-react';
import { uploadDocument, UploadValidationError } from '@/core/storage/document-upload';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';

interface DocumentRow {
  id: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  owner_id: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ListDocumentsResponse {
  data: {
    documents: DocumentRow[];
    total: number;
    limit: number;
    offset: number;
  };
}

const PAGE_SIZE = 20;

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word (.doc)',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/tiff': 'TIFF',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function titleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  return withoutExt.trim().length > 0 ? withoutExt.trim() : filename;
}

export default function DocumentsPage() {
  const router = useRouter();

  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // NEW, THIS SESSION — notifications panel open/closed + unread badge.
  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchDocuments = useCallback(async (nextOffset: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(nextOffset),
      });
      const res = await fetch(`/api/documents?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const json: ListDocumentsResponse = await res.json();
      setDocuments(json.data.documents);
      setTotal(json.data.total);
      setOffset(json.data.offset);
    } catch {
      setError('Could not load your documents. Try again in a moment.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments(0);
  }, [fetchDocuments]);

  const handleUploadClick = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input immediately so selecting the same file twice in a
    // row still fires a change event.
    e.target.value = '';
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    try {
      const uploaded = await uploadDocument(file, titleFromFilename(file.name));
      setDocuments((prev) => [uploaded, ...prev]);
      setTotal((prev) => prev + 1);
    } catch (err) {
      if (err instanceof UploadValidationError) {
        setUploadError(err.message);
      } else if (err instanceof Error) {
        setUploadError(err.message);
      } else {
        setUploadError('Upload failed for an unknown reason.');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const filtered = documents.filter((doc) =>
    doc.title.toLowerCase().includes(query.toLowerCase()),
  );

  const hasNextPage = offset + PAGE_SIZE < total;
  const hasPrevPage = offset > 0;

  return (
    <div className="relative flex h-screen w-full bg-background font-sans text-foreground">
      {/* Left rail */}
      <aside className="flex w-16 flex-col items-center bg-primary py-5">
        <div className="mb-8 flex h-9 w-9 items-center justify-center rounded-md bg-primary-foreground/15">
          <Scale className="h-[18px] w-[18px] text-primary-foreground" strokeWidth={1.75} />
        </div>
        <nav className="flex flex-1 flex-col items-center gap-1">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-foreground/10 text-primary-foreground"
            aria-current="page"
            aria-label="Documents"
          >
            <FolderOpen className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
          {/* AMENDED, THIS SESSION — was purely decorative (no onClick,
              no badge). Now opens NotificationsPanel and shows an
              unread-count badge. */}
          <button
            onClick={() => setIsNotificationsPanelOpen((prev) => !prev)}
            className="relative flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/70 hover:bg-primary-foreground/10 hover:text-primary-foreground"
            aria-label="Notifications"
            aria-expanded={isNotificationsPanelOpen}
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-md text-primary-foreground/40"
            aria-label="Settings"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </nav>
      </aside>

      {/* NEW, THIS SESSION */}
      <NotificationsPanel
        isOpen={isNotificationsPanelOpen}
        onClose={() => setIsNotificationsPanelOpen(false)}
        onUnreadCountChange={setUnreadCount}
      />

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-border px-8 py-6">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              JurisAI
            </p>
            <h1 className="font-serif text-[26px] leading-none text-foreground">Documents</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents"
                className="w-48 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.tiff"
              className="hidden"
              onChange={handleFileSelected}
            />
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              {isUploading ? 'Uploading…' : 'Upload document'}
            </button>
          </div>
        </header>

        {uploadError && (
          <div className="mx-8 mt-4 flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{uploadError}</span>
            <button
              onClick={() => setUploadError(null)}
              className="ml-auto text-[12px] font-medium underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Document list */}
        <main className="flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              <p className="text-[13px]">Loading documents…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p className="text-[13px]">{error}</p>
              <button
                onClick={() => fetchDocuments(offset)}
                className="text-[13px] font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-24 text-muted-foreground">
              <Inbox className="h-6 w-6" />
              <p className="text-[13px]">No documents yet.</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[13px] text-muted-foreground">
                  {total} document{total !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
                {filtered.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => router.push(`/documents/${doc.id}`)}
                    className="group flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                      <FileText className="h-[18px] w-[18px] text-primary" strokeWidth={1.5} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-foreground">
                        {doc.title}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {formatRelativeTime(doc.created_at)} ·{' '}
                        {MIME_LABELS[doc.mime_type] ?? doc.mime_type} ·{' '}
                        {formatFileSize(doc.size_bytes)}
                      </p>
                    </div>

                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>

              {(hasPrevPage || hasNextPage) && (
                <div className="mt-4 flex items-center justify-between text-[13px] text-muted-foreground">
                  <button
                    disabled={!hasPrevPage}
                    onClick={() => fetchDocuments(Math.max(0, offset - PAGE_SIZE))}
                    className="flex items-center gap-1 rounded-md px-2 py-1 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Previous
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
                  </span>
                  <button
                    disabled={!hasNextPage}
                    onClick={() => fetchDocuments(offset + PAGE_SIZE)}
                    className="flex items-center gap-1 rounded-md px-2 py-1 disabled:opacity-30"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
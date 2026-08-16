// src/app/documents/page.tsx
// REBUILT — Documents page task, this session.
//
// Replaces the prior narrow-icon-rail Documents page with the full
// Documents workspace from the reference image (header, summary cards,
// tabs, filters, table, Storage Overview / Quick Actions / Recent
// Uploads panel), now hosted on the new shared AppSidebar
// (src/shared/components/layout/app-sidebar.tsx, new this session) —
// the first page in the project to use it.
//
// REAL DATA, REAL GAPS — every number and column here is either
// computed from GET /api/documents (confirmed real, includeDeleted
// query param, `{ data: { documents, total, limit, offset } }` shape —
// see documents.schemas.ts's listDocumentsQuerySchema) or explicitly
// marked unavailable. Specifically NOT faked, because the schema
// genuinely doesn't support them yet (confirmed via Supabase MCP
// `list_tables` against the live `Juris` project, this session):
//   - Matter/case linkage per document: case_documents is a many-to-many
//     join table with no "get my case for this document" list endpoint
//     anywhere in the API. The Matter column and Matter filter are
//     rendered as an honest "not linked yet" state, not a fabricated
//     case name.
//   - Legal document "Type" (Pleading/Affidavit/Evidence/...): no such
//     column exists on public.documents (only mime_type). The Type
//     column shows a file-type badge derived from mime_type instead —
//     a deliberate, flagged substitution, not the same thing the
//     reference image shows.
//   - Shared With Me / Favorites: no schema support (no favorites
//     table, no document-level sharing — case_access_grants scopes
//     cases, not documents). Rendered as real, clickable tabs with an
//     honest "not available yet" panel, not a fake empty list dressed
//     up as a real one.
//   - Storage Overview total/available quota: no quota field on
//     plans or subscriptions. Only "used" (sum of size_bytes, computed
//     client-side) is shown as real; total/available are marked
//     unavailable rather than hardcoded.
//   - Trash restore / permanent delete: CLOSED THIS SESSION. DELETE
//     /api/documents/[id] is still soft-delete only (unchanged — see
//     that route's own doc comment), but two new routes now exist:
//     POST /api/documents/[id]/restore and DELETE
//     /api/documents/[id]/permanent (document.service.ts's
//     restoreDocument()/permanentlyDeleteDocument(), Amendment #16).
//     Restore and Delete permanently below are real, wired actions now,
//     not "coming soon" stubs — see handleRestore/handlePermanentDelete.
//
// PAGINATION, FLAGGED: fetches with limit=100 (MAX_PAGE_SIZE, confirmed
// in common.schemas.ts) and includeDeleted=true once, then does all
// tab/filter/search/summary-card work client-side against that set.
// Fine while the account's real document count is low (0 rows in the
// live Juris project as of this session) — will need real server-side
// pagination + filtering once a firm's document count exceeds 100.
// Flagged, not silently hidden.
//
// AUTHOR NAME RESOLUTION, FLAGGED, SAME GAP AS (dashboard)/lawyer/
// page.tsx's own header comment: GET /api/profiles/[id] 403s for
// anyone but the profile's own owner or an admin (requireOwnership()),
// so this page cannot resolve *other* users' display names client-side.
// "Uploaded By" shows "You" for the caller's own documents and a short
// id for anyone else's — not a fabricated name.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Upload,
  FileText,
  FileImage,
  FileArchive,
  File as FileIcon,
  Bell,
  Loader2,
  AlertCircle,
  Inbox,
  ChevronDown,
  Trash2,
  Download,
  Eye,
  MoreHorizontal,
  FolderPlus,
  FileUp,
  ScanLine,
  Settings2,
  X,
} from 'lucide-react';
import { uploadDocument, uploadDocumentsBulk, UploadValidationError } from '@/core/storage/document-upload';
import { NotificationsPanel } from '@/shared/components/notifications/notifications-panel';
import { AppSidebar } from '@/shared/components/layout/app-sidebar';

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
  hearing_date: string | null;
}

interface ListDocumentsResponse {
  data: {
    documents: DocumentRow[];
    total: number;
    limit: number;
    offset: number;
  };
}

interface MeProfile {
  id: string;
  full_name: string | null;
}

type TabKey = 'all' | 'mine' | 'shared' | 'favorites' | 'trash';

const FETCH_LIMIT = 100; // MAX_PAGE_SIZE, see file header.

const MIME_META: Record<string, { label: string; group: string }> = {
  'application/pdf': { label: 'PDF', group: 'pdf' },
  'application/msword': { label: 'DOC', group: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    label: 'DOCX',
    group: 'doc',
  },
  'image/jpeg': { label: 'JPEG', group: 'image' },
  'image/png': { label: 'PNG', group: 'image' },
  'image/tiff': { label: 'TIFF', group: 'image' },
};

function fileMeta(mime: string): { label: string; group: string } {
  return MIME_META[mime] ?? { label: mime.split('/')[1]?.toUpperCase() ?? 'FILE', group: 'other' };
}

function FileTypeIcon({ mime }: { mime: string }) {
  const { group } = fileMeta(mime);
  const cls = 'h-[18px] w-[18px]';
  switch (group) {
    case 'image':
      return <FileImage className={cls} strokeWidth={1.75} />;
    case 'archive':
      return <FileArchive className={cls} strokeWidth={1.75} />;
    case 'pdf':
    case 'doc':
      return <FileText className={cls} strokeWidth={1.75} />;
    default:
      return <FileIcon className={cls} strokeWidth={1.75} />;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function titleFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  return withoutExt.trim().length > 0 ? withoutExt.trim() : filename;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default function DocumentsPage() {
  const router = useRouter();

  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [me, setMe] = useState<MeProfile | null>(null);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabKey>('all');
  const [fileTypeFilter, setFileTypeFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<'any' | '7d' | '30d' | '1y'>('any');

  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isNotificationsPanelOpen, setIsNotificationsPanelOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(FETCH_LIMIT),
        offset: '0',
        includeDeleted: 'true',
      });
      const res = await fetch(`/api/documents?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
      const json: ListDocumentsResponse = await res.json();
      setDocuments(json.data.documents);
      setTotal(json.data.total);
    } catch {
      setError('Could not load your documents. Try again in a moment.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/profiles/me', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        setMe(json.data as MeProfile);
      } catch {
        // Non-fatal — "Uploaded By" falls back to short ids.
      }
    })();
  }, []);

  // ---- Derived data ---------------------------------------------------

  const active = useMemo(() => documents.filter((d) => !d.deleted_at), [documents]);
  const trashed = useMemo(() => documents.filter((d) => !!d.deleted_at), [documents]);

  const recentUploads7d = useMemo(
    () => active.filter((d) => Date.now() - new Date(d.created_at).getTime() <= 7 * DAY_MS),
    [active],
  );

  const expiringSoon = useMemo(
    () =>
      active.filter((d) => {
        if (!d.hearing_date) return false;
        const diff = new Date(d.hearing_date).getTime() - Date.now();
        return diff >= 0 && diff <= 30 * DAY_MS;
      }),
    [active],
  );

  const fileTypes = useMemo(() => {
    const set = new Set(active.map((d) => d.mime_type));
    return Array.from(set);
  }, [active]);

  const tabDocuments = useMemo(() => {
    switch (tab) {
      case 'mine':
        return me ? active.filter((d) => d.owner_id === me.id) : [];
      case 'trash':
        return trashed;
      case 'shared':
      case 'favorites':
        return [];
      case 'all':
      default:
        return active;
    }
  }, [tab, active, trashed, me]);

  const filtered = useMemo(() => {
    return tabDocuments.filter((doc) => {
      if (query && !doc.title.toLowerCase().includes(query.toLowerCase())) return false;
      if (fileTypeFilter !== 'all' && doc.mime_type !== fileTypeFilter) return false;
      if (dateFilter !== 'any') {
        const ageMs = Date.now() - new Date(doc.created_at).getTime();
        const cutoff = dateFilter === '7d' ? 7 * DAY_MS : dateFilter === '30d' ? 30 * DAY_MS : 365 * DAY_MS;
        if (ageMs > cutoff) return false;
      }
      return true;
    });
  }, [tabDocuments, query, fileTypeFilter, dateFilter]);

  const recentUploadsPanel = useMemo(
    () => [...active].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 5),
    [active],
  );

  const storageUsedBytes = useMemo(() => active.reduce((sum, d) => sum + d.size_bytes, 0), [active]);

  const filtersActive = query !== '' || fileTypeFilter !== 'all' || dateFilter !== 'any';
  const clearFilters = () => {
    setQuery('');
    setFileTypeFilter('all');
    setDateFilter('any');
  };

  // ---- Upload -----------------------------------------------------------

  const handleUploadClick = () => {
    setUploadError(null);
    setUploadNotice(null);
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadNotice(null);
    try {
      if (files.length === 1) {
        const singleFile = files[0]!;
        const uploaded = await uploadDocument(singleFile, titleFromFilename(singleFile.name));
        setDocuments((prev) => [uploaded as unknown as DocumentRow, ...prev]);
        setTotal((prev) => prev + 1);
      } else {
        const { succeeded, failed } = await uploadDocumentsBulk(files);
        if (succeeded.length > 0) {
          setDocuments((prev) => [...(succeeded as unknown as DocumentRow[]), ...prev]);
          setTotal((prev) => prev + succeeded.length);
        }
        if (failed.length > 0) {
          setUploadNotice(
            `${succeeded.length} of ${files.length} uploaded. ${failed.length} failed: ${failed
              .map((f) => f.fileName)
              .join(', ')}.`,
          );
        } else {
          setUploadNotice(`${succeeded.length} document${succeeded.length === 1 ? '' : 's'} uploaded.`);
        }
      }
    } catch (err) {
      if (err instanceof UploadValidationError || err instanceof Error) {
        setUploadError(err.message);
      } else {
        setUploadError('Upload failed for an unknown reason.');
      }
    } finally {
      setIsUploading(false);
    }
  };

  // ---- Row actions --------------------------------------------------------

  const handleDownload = async (doc: DocumentRow) => {
    setBusyDocId(doc.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/download`, { credentials: 'include' });
      if (!res.ok) throw new Error(`Could not get a download link (status ${res.status}).`);
      const json = await res.json();
      window.open(json.data.url as string, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setBusyDocId(null);
      setOpenActionsFor(null);
    }
  };

  const handleTrash = async (doc: DocumentRow) => {
    setBusyDocId(doc.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok && res.status !== 204) throw new Error(`Could not move to trash (status ${res.status}).`);
      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, deleted_at: new Date().toISOString() } : d)),
      );
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not move document to trash.');
    } finally {
      setBusyDocId(null);
      setOpenActionsFor(null);
    }
  };

  // NEW — Trash: Restore. Mirrors handleTrash's shape exactly (same
  // busy/error/optimistic-update pattern), calling the new
  // POST /api/documents/[id]/restore route (document.service.ts's
  // restoreDocument(), Amendment #16) instead of DELETE. No confirm()
  // prompt — restoring is non-destructive and reversible (the document
  // can simply be trashed again), unlike permanent delete below.
  const handleRestore = async (doc: DocumentRow) => {
    setBusyDocId(doc.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/restore`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Could not restore document (status ${res.status}).`);
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, deleted_at: null } : d)));
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not restore document.');
    } finally {
      setBusyDocId(null);
      setOpenActionsFor(null);
    }
  };

  // NEW — Trash: Permanent delete. Calls the new
  // DELETE /api/documents/[id]/permanent route (document.service.ts's
  // permanentlyDeleteDocument(), Amendment #16). Irreversible, so this
  // is the one row action in the file that gates on window.confirm()
  // first — same pattern already used by
  // src/app/billing/subscription/page.tsx's cancel-subscription flow
  // (that file's own doc comment: a styled modal is a possible future
  // upgrade, not yet built anywhere in this project). On success the
  // row is removed from local state entirely, not just flagged, since
  // the row no longer exists server-side.
  const handlePermanentDelete = async (doc: DocumentRow) => {
    if (
      !window.confirm(
        `Permanently delete "${doc.title}"? This cannot be undone — the file will be removed completely.`,
      )
    ) {
      return;
    }

    setBusyDocId(doc.id);
    setRowError(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/permanent`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Could not permanently delete document (status ${res.status}).`);
      }
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Could not permanently delete document.');
    } finally {
      setBusyDocId(null);
      setOpenActionsFor(null);
    }
  };

  // ---- Render -------------------------------------------------------------

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="documents" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background px-8 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-[19px] font-semibold leading-tight text-foreground">Documents</h1>
              <p className="text-[12.5px] text-muted-foreground">
                Store, organize and manage your legal documents securely.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
              <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents…"
                className="w-52 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>

            <button
              onClick={() => setIsNotificationsPanelOpen((v) => !v)}
              className="relative flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium leading-none text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.tiff"
              className="hidden"
              onChange={handleFilesSelected}
            />
            <button
              onClick={handleUploadClick}
              disabled={isUploading}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
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

        <NotificationsPanel
          isOpen={isNotificationsPanelOpen}
          onClose={() => setIsNotificationsPanelOpen(false)}
          onUnreadCountChange={setUnreadCount}
        />

        {(uploadError || uploadNotice || rowError) && (
          <div className="mx-8 mt-4 space-y-2">
            {uploadError && (
              <Banner tone="destructive" onDismiss={() => setUploadError(null)}>
                {uploadError}
              </Banner>
            )}
            {uploadNotice && (
              <Banner tone="info" onDismiss={() => setUploadNotice(null)}>
                {uploadNotice}
              </Banner>
            )}
            {rowError && (
              <Banner tone="destructive" onDismiss={() => setRowError(null)}>
                {rowError}
              </Banner>
            )}
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-8 py-6">
          {/* Summary cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <SummaryCard
              icon={<Inbox className="h-4 w-4" />}
              label="Total Documents"
              value={isLoading ? '—' : String(active.length)}
              tone="primary"
            />
            <SummaryCard
              icon={<Upload className="h-4 w-4" />}
              label="Recent Uploads"
              value={isLoading ? '—' : String(recentUploads7d.length)}
              hint="Last 7 days"
              tone="success"
            />
            <SummaryCard
              icon={<FileText className="h-4 w-4" />}
              label="Shared With Me"
              value="—"
              hint="Not available yet"
              tone="muted"
            />
            <SummaryCard
              icon={<AlertCircle className="h-4 w-4" />}
              label="Expiring Soon"
              value={isLoading ? '—' : String(expiringSoon.length)}
              hint="Hearing date in 30 days"
              tone="warning"
            />
            <SummaryCard
              icon={<Trash2 className="h-4 w-4" />}
              label="Trash"
              value={isLoading ? '—' : String(trashed.length)}
              tone="muted"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_300px]">
            {/* Left: tabs, filters, table */}
            <div>
              {/* Tabs */}
              <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-border">
                <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
                  All Documents
                </TabButton>
                <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
                  My Documents
                </TabButton>
                <TabButton active={tab === 'shared'} onClick={() => setTab('shared')}>
                  Shared With Me
                </TabButton>
                <TabButton active={tab === 'favorites'} onClick={() => setTab('favorites')}>
                  Favorites
                </TabButton>
                <TabButton active={tab === 'trash'} onClick={() => setTab('trash')}>
                  Trash {trashed.length > 0 ? `(${trashed.length})` : ''}
                </TabButton>
              </div>

              {/* Filters */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <select
                  disabled
                  title="Matter linking isn't available yet — documents aren't currently attached to a case."
                  className="cursor-not-allowed rounded-md border border-input bg-muted/40 px-2.5 py-1.5 text-[12.5px] text-muted-foreground"
                >
                  <option>All Matters (coming soon)</option>
                </select>
                <select
                  value={fileTypeFilter}
                  onChange={(e) => setFileTypeFilter(e.target.value)}
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-[12.5px] text-foreground"
                >
                  <option value="all">All File Types</option>
                  {fileTypes.map((mime) => (
                    <option key={mime} value={mime}>
                      {fileMeta(mime).label}
                    </option>
                  ))}
                </select>
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
                  className="rounded-md border border-input bg-background px-2.5 py-1.5 text-[12.5px] text-foreground"
                >
                  <option value="any">Any time</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="1y">Last year</option>
                </select>
                {filtersActive && (
                  <button
                    onClick={clearFilters}
                    className="ml-auto text-[12.5px] font-medium text-primary underline underline-offset-2"
                  >
                    Clear Filters
                  </button>
                )}
              </div>

              {/* Table */}
              {isLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-background py-24 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <p className="text-[13px]">Loading documents…</p>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <p className="text-[13px]">{error}</p>
                  <button onClick={fetchDocuments} className="text-[13px] font-medium underline underline-offset-2">
                    Retry
                  </button>
                </div>
              ) : tab === 'shared' || tab === 'favorites' ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background py-24 text-center text-muted-foreground">
                  <FileText className="h-6 w-6" />
                  <p className="text-[13px]">
                    {tab === 'shared' ? 'Document sharing' : 'Favorites'} isn&apos;t available yet.
                  </p>
                  <p className="max-w-xs text-[12px]">
                    This needs a small schema addition we haven&apos;t built yet — flagged for a future
                    session rather than shown with fake data.
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background py-24 text-muted-foreground">
                  <Inbox className="h-6 w-6" />
                  <p className="text-[13px]">
                    {tabDocuments.length === 0
                      ? tab === 'trash'
                        ? 'Trash is empty.'
                        : 'No documents yet.'
                      : 'No documents match your search or filters.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border bg-background">
                  <table className="w-full min-w-[860px] text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-[11.5px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Document Name</th>
                        <th className="px-4 py-3 font-medium">Matter</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">Uploaded By</th>
                        <th className="px-4 py-3 font-medium">Uploaded On</th>
                        <th className="px-4 py-3 font-medium">Size</th>
                        <th className="px-4 py-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filtered.map((doc) => (
                        <tr key={doc.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => router.push(`/documents/${doc.id}`)}
                              className="flex items-center gap-3 text-left"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                <FileTypeIcon mime={doc.mime_type} />
                              </span>
                              <span className="truncate font-medium text-foreground hover:underline">
                                {doc.title}
                              </span>
                            </button>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            <span className="text-[12px] italic" title="Documents aren't linked to a matter yet.">
                              Not linked
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-secondary-foreground">
                              {fileMeta(doc.mime_type).label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {me && doc.owner_id === me.id ? 'You' : doc.owner_id.slice(0, 8)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground" title={formatDateTime(doc.created_at)}>
                            {formatDate(doc.created_at)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{formatFileSize(doc.size_bytes)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => router.push(`/documents/${doc.id}`)}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                                aria-label="View"
                                title="View"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleDownload(doc)}
                                disabled={busyDocId === doc.id || !!doc.deleted_at}
                                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
                                aria-label="Download"
                                title="Download"
                              >
                                {busyDocId === doc.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Download className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <div className="relative">
                                <button
                                  onClick={() => setOpenActionsFor((v) => (v === doc.id ? null : doc.id))}
                                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                                  aria-label="More actions"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                                {openActionsFor === doc.id && (
                                  <div className="absolute right-0 top-8 z-10 w-44 rounded-md border border-border bg-background py-1 shadow-lg">
                                    <button
                                      disabled
                                      title="Document sharing isn't available yet."
                                      className="flex w-full cursor-not-allowed items-center px-3 py-2 text-left text-[12.5px] text-muted-foreground/60"
                                    >
                                      Share (coming soon)
                                    </button>
                                    {!doc.deleted_at ? (
                                      <button
                                        onClick={() => handleTrash(doc)}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-destructive hover:bg-destructive/5"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Move to Trash
                                      </button>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => handleRestore(doc)}
                                          disabled={busyDocId === doc.id}
                                          className="flex w-full items-center px-3 py-2 text-left text-[12.5px] text-foreground hover:bg-muted disabled:opacity-40"
                                        >
                                          Restore
                                        </button>
                                        <button
                                          onClick={() => handlePermanentDelete(doc)}
                                          disabled={busyDocId === doc.id}
                                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-destructive hover:bg-destructive/5 disabled:opacity-40"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                          Delete permanently
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!isLoading && !error && tab !== 'shared' && tab !== 'favorites' && total > FETCH_LIMIT && (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  Showing the first {FETCH_LIMIT} of {total} documents. Server-side pagination for larger
                  document sets isn&apos;t built yet.
                </p>
              )}
            </div>

            {/* Right rail */}
            <div className="space-y-4">
              {/* Storage overview */}
              <div className="rounded-lg border border-border bg-background p-4">
                <p className="mb-3 text-[13px] font-semibold text-foreground">Storage Overview</p>
                <p className="text-[22px] font-semibold text-foreground">
                  {isLoading ? '—' : formatFileSize(storageUsedBytes)}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Used across {active.length} document{active.length === 1 ? '' : 's'}
                </p>
                <p className="mt-2 text-[11.5px] italic text-muted-foreground/80">
                  Plan storage limits aren&apos;t available yet — not shown.
                </p>
              </div>

              {/* Quick actions */}
              <div className="rounded-lg border border-border bg-background p-4">
                <p className="mb-3 text-[13px] font-semibold text-foreground">Quick Actions</p>
                <div className="space-y-1">
                  <QuickAction icon={<Upload className="h-4 w-4" />} label="Upload Document" onClick={handleUploadClick} />
                  <QuickAction icon={<FileUp className="h-4 w-4" />} label="Bulk Upload" onClick={handleUploadClick} />
                  <QuickAction icon={<FolderPlus className="h-4 w-4" />} label="Create Folder" disabled />
                  <QuickAction icon={<FileText className="h-4 w-4" />} label="Request Document" disabled />
                  <QuickAction icon={<ScanLine className="h-4 w-4" />} label="Scan Document" disabled />
                  <QuickAction icon={<Settings2 className="h-4 w-4" />} label="Document Settings" disabled />
                </div>
              </div>

              {/* Recent uploads */}
              <div className="rounded-lg border border-border bg-background p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-foreground">Recent Uploads</p>
                  <button
                    onClick={() => {
                      setTab('all');
                      setDateFilter('any');
                      setQuery('');
                    }}
                    className="text-[12px] font-medium text-primary"
                  >
                    View all
                  </button>
                </div>
                {isLoading ? (
                  <div className="flex justify-center py-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : recentUploadsPanel.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">No uploads yet.</p>
                ) : (
                  <div className="space-y-3">
                    {recentUploadsPanel.map((doc) => (
                      <button
                        key={doc.id}
                        onClick={() => router.push(`/documents/${doc.id}`)}
                        className="flex w-full items-center gap-2.5 text-left"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <FileTypeIcon mime={doc.mime_type} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-foreground">{doc.title}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{formatDate(doc.created_at)}</p>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// ---- Small presentational helpers ------------------------------------------

function SummaryCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone: 'primary' | 'success' | 'warning' | 'muted';
}) {
  const toneClasses: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    muted: 'bg-muted text-muted-foreground',
  };
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className={`flex h-8 w-8 items-center justify-center rounded-md ${toneClasses[tone]}`}>{icon}</span>
      </div>
      <p className="text-[20px] font-semibold leading-tight text-foreground">{value}</p>
      <p className="text-[12px] text-muted-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors ${
        active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Coming soon' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] ${
        disabled ? 'cursor-not-allowed text-muted-foreground/50' : 'text-foreground hover:bg-muted'
      }`}
    >
      <span className={disabled ? 'text-muted-foreground/50' : 'text-primary'}>{icon}</span>
      {label}
      {disabled && <ChevronDown className="ml-auto h-3 w-3 rotate-[-90deg] opacity-0" />}
    </button>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'destructive' | 'info';
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  const toneClasses =
    tone === 'destructive'
      ? 'border-destructive/20 bg-destructive/5 text-destructive'
      : 'border-info/20 bg-info/5 text-info';
  return (
    <div className={`flex items-center gap-2 rounded-md border px-4 py-3 text-[13px] ${toneClasses}`}>
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{children}</span>
      <button onClick={onDismiss} aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
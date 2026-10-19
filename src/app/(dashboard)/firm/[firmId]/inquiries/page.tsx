'use client';

// /firm/[firmId]/inquiries -- Firm Terminal inquiry inbox (firm owner/admin).
// Lists every inquiry routed to the firm. Only unassigned, pending inquiries
// are reviewable by the firm; one addressed to a specific lawyer is that
// lawyer's to review, and shows here as status only.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, FileText, Inbox, Loader2 } from 'lucide-react';

import { AppShell } from '@/shared/components/layout/app-shell';
import { Button } from '@/shared/components/ui/button';

interface FirmInquiry {
  id: string;
  status: 'pending' | 'accepted' | 'converted_to_case' | 'declined';
  targetProfileId: string | null;
  documentName: string;
  analysisAvailable: boolean;
  reviewExpiresAt: string;
  createdAt: string;
  reviewableByYou: boolean;
}

const STATUS_LABEL: Record<FirmInquiry['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  converted_to_case: 'Converted to case',
  declined: 'Declined',
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function FirmInquiriesPage() {
  const params = useParams<{ firmId: string }>();
  const [inquiries, setInquiries] = useState<FirmInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/firms/${params.firmId}/lawyer-inquires`, { credentials: 'include' });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error?.message ?? `Request failed with status ${res.status}`);
        if (!cancelled) setInquiries(json.data as FirmInquiry[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load inquiries.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.firmId]);

  return (
    <AppShell active="inquiries" terminal="firm" firmId={params.firmId}>
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-5 flex items-center gap-3">
          <Inbox className="h-5 w-5 text-primary" strokeWidth={1.75} />
          <div>
            <h1 className="text-xl font-semibold leading-tight tracking-tight sm:text-page-title">Firm Inquiries</h1>
            <p className="text-meta text-muted-foreground">
              Contact requests routed to your firm. Review the document and report, then accept
              (assigning a lawyer) or decline.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-meta text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive-subtle px-4 py-3 text-meta text-destructive-subtle-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {!loading && !error && inquiries.length === 0 && (
          <p className="text-meta text-muted-foreground">No inquiries have been routed to your firm.</p>
        )}

        <div className="flex flex-col gap-3">
          {inquiries.map((inquiry) => (
            <div
              key={inquiry.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-5 py-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div className="min-w-0">
                  <p className="truncate text-ui font-medium">{inquiry.documentName}</p>
                  <p className="text-meta text-muted-foreground">
                    Received {formatTimestamp(inquiry.createdAt)} · {STATUS_LABEL[inquiry.status]}
                    {inquiry.targetProfileId ? ' · addressed to a specific lawyer' : ''}
                  </p>
                </div>
              </div>
              {inquiry.reviewableByYou && (
                <Button asChild>
                  <Link href={`/firm/${params.firmId}/inquiries/${inquiry.id}`}>
                    Review &amp; decide
                  </Link>
                </Button>
              )}
            </div>
          ))}
        </div>
      </main>
    </AppShell>
  );
}

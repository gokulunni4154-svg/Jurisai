'use client';

// /firm/[firmId]/inquiries/[id] -- Firm Terminal: a firm owner/admin reviews
// a firm-routed inquiry's document and report, then accepts it (assigning a
// lawyer) or declines it.

import { useParams } from 'next/navigation';

import { AppSidebar } from '@/shared/components/layout/app-sidebar';
import { InquiryReviewPanel } from '@/shared/components/lawyer-inquiries/inquiry-review-panel';

export default function FirmInquiryReviewPage() {
  const params = useParams<{ firmId: string; id: string }>();

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="inquiries" terminal="firm" firmId={params.firmId} />
      <main className="flex-1 overflow-y-auto">
        <InquiryReviewPanel
          inquiryId={params.id}
          firmId={params.firmId}
          backHref={`/firm/${params.firmId}/inquiries`}
        />
      </main>
    </div>
  );
}

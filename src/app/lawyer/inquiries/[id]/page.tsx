'use client';

// /lawyer/inquiries/[id] -- Individual Lawyer Terminal: review the exact
// document and AI report attached to an inquiry, then accept or decline.

import { useParams } from 'next/navigation';

import { AppSidebar } from '@/shared/components/layout/app-sidebar';
import { InquiryReviewPanel } from '@/shared/components/lawyer-inquiries/inquiry-review-panel';

export default function LawyerInquiryReviewPage() {
  const params = useParams<{ id: string }>();

  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="inquiries" terminal="lawyer" />
      <main className="flex-1 overflow-y-auto">
        <InquiryReviewPanel inquiryId={params.id} backHref="/lawyer/inquiries" />
      </main>
    </div>
  );
}

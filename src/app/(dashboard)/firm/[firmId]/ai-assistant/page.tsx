"use client";

import { AppShell } from "@/shared/components/layout/app-shell";
import { AssistantChat } from "@/shared/components/assistant/assistant-chat";

export default function FirmAiAssistantPage({
  params,
}: {
  params: { firmId: string };
}) {
  const firmId = params.firmId;
  return (
    <AppShell active="ai-assistant" terminal="firm" firmId={firmId}>
      <div className="min-w-0 flex-1">
        <AssistantChat
          endpoint={`/api/assistant/firm/${encodeURIComponent(firmId)}`}
          heading="AI Assistant — Firm Terminal"
          contextLabel="Uses only the firm matters, tasks and hearings your role allows. Owners and admins see firm-wide data; other members see only their own."
          suggestions={[
            "Summarize the matters I am authorized to access.",
            "Help me review upcoming deadlines.",
            "Summarize our permitted firm-level workload.",
          ]}
          disclaimer="AI-generated from data you are permitted to access. Verify before relying on it."
        />
      </div>
    </AppShell>
  );
}

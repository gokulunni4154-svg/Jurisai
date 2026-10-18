"use client";

import { AppSidebar } from "@/shared/components/layout/app-sidebar";
import { AssistantChat } from "@/shared/components/assistant/assistant-chat";

export default function GeneralAiAssistantPage() {
  return (
    <div className="flex h-screen w-full bg-muted/30 font-sans text-foreground">
      <AppSidebar active="ai-assistant" terminal="general" />
      <div className="min-w-0 flex-1">
        <AssistantChat
          endpoint="/api/assistant/general"
          heading="Legal AI Assistant"
          contextLabel="General information about Indian law. It cannot see your documents, cases, or any lawyer or firm records."
          suggestions={[
            "Explain the legal steps for my situation.",
            "Help me understand a legal notice I received.",
            "What information should I collect before consulting a lawyer?",
          ]}
          disclaimer="General information only, not legal advice. Laws change; consult a qualified Indian lawyer for your specific situation."
        />
      </div>
    </div>
  );
}

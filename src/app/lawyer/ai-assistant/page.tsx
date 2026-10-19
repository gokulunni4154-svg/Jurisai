"use client";

import { AppShell } from "@/shared/components/layout/app-shell";
import { AssistantChat } from "@/shared/components/assistant/assistant-chat";

export default function LawyerAiAssistantPage() {
  return (
    <AppShell active="ai-assistant" terminal="lawyer">
      <div className="min-w-0 flex-1">
        <AssistantChat
          endpoint="/api/assistant/lawyer"
          heading="AI Assistant — Lawyer Terminal"
          contextLabel="Can use your own matters, tasks and upcoming hearings that you are authorized to see, plus general legal knowledge."
          suggestions={[
            "Summarize my upcoming hearings.",
            "Which of my tasks are due soonest?",
            "Help me draft a legal notice. I will give you the facts.",
          ]}
          disclaimer="AI-generated. Verify citations and provisions before relying on them. Drafts need your professional review."
        />
      </div>
    </AppShell>
  );
}

// src/modules/assistant/assistant.factory.ts
// Request-scoped construction. Never cached at module scope: each request has
// its own session and its own Supabase client.

import { getCurrentUser } from "@/core/auth/session";
import { DbRateLimiter } from "@/core/rate-limit/db-rate-limiter";
import { createAdminClient } from "@/core/supabase/admin";
import { createClient } from "@/core/supabase/server";
import { CaseRepository } from "@/modules/cases/case.repository";
import { createFirmDashboardService } from "@/modules/firm-dashboard/firm-dashboard.factory";
import { HearingRepository } from "@/modules/hearings/hearing.repository";
import { TaskRepository } from "@/modules/tasks/task.repository";
import { FirmMemberRepository } from "@/modules/user-management/firm-member.repository";

import { AssistantRepository } from "./assistant.repository";
import { AssistantService } from "./assistant.service";

export async function buildAssistantService(): Promise<AssistantService> {
  const currentUser = await getCurrentUser();
  // RLS-scoped client: assistant rows, the caller's own cases/tasks/hearings
  // and their firm membership are all read as the caller.
  const supabase = await createClient();

  return new AssistantService(
    currentUser,
    new AssistantRepository(supabase),
    new FirmMemberRepository(supabase),
    new CaseRepository(supabase),
    new TaskRepository(supabase),
    new HearingRepository(supabase),
    // Firm-wide reads go through the existing service, which enforces its own
    // owner/admin gate on top of ours (admin client lives inside that factory).
    createFirmDashboardService(currentUser),
    // The rate-limit RPC needs the service-role client; it only ever receives a
    // key derived from the authenticated user id.
    new DbRateLimiter(createAdminClient()),
  );
}

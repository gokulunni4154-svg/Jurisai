// src/modules/assistant/assistant.context.ts
//
// Builds the bounded, authorized data snapshot placed in the prompt. All
// inputs come from repositories/services that already enforce access
// (RLS-scoped client, or FirmDashboardService's owner/admin gate). Nothing
// here decides authorization; it only formats and truncates.

import type { Database } from "@/core/supabase/database.types";

type CaseRow = Database["public"]["Tables"]["cases"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type HearingRow = Database["public"]["Tables"]["hearings"]["Row"];

export type AssistantScope = "own_matters" | "firm_wide";

const MAX_CASES = 25;
const MAX_TASKS = 40;
const MAX_HEARINGS = 20;
const MAX_FIELD_CHARS = 160;

function clip(value: unknown): string {
  const s =
    typeof value === "string" ? value : value == null ? "" : String(value);
  // Collapse whitespace/newlines so stored text cannot fake prompt structure.
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > MAX_FIELD_CHARS
    ? `${flat.slice(0, MAX_FIELD_CHARS)}…`
    : flat;
}

export interface AuthorizedSnapshot {
  cases: CaseRow[];
  tasks: TaskRow[];
  hearings: HearingRow[];
}

export function formatAuthorizedContext(
  scope: AssistantScope,
  data: AuthorizedSnapshot,
): string {
  const titleByCase = new Map<string, string>();
  for (const c of data.cases) titleByCase.set(c.id, clip(c.title));

  const caseLines = data.cases.slice(0, MAX_CASES).map((c) => {
    const row = c as unknown as Record<string, unknown>;
    const parts = [`title: ${clip(c.title)}`, `status: ${clip(row["status"])}`];
    if (row["case_number"])
      parts.push(`case_number: ${clip(row["case_number"])}`);
    return `- ${parts.join(" | ")}`;
  });

  const openTasks = data.tasks.filter((t) => t.status !== "done");
  const taskLines = openTasks.slice(0, MAX_TASKS).map((t) => {
    const parts = [`title: ${clip(t.title)}`, `status: ${clip(t.status)}`];
    if (t.due_date) parts.push(`due: ${clip(t.due_date)}`);
    const caseTitle = t.case_id ? titleByCase.get(t.case_id) : undefined;
    if (caseTitle) parts.push(`matter: ${caseTitle}`);
    return `- ${parts.join(" | ")}`;
  });

  const hearingLines = data.hearings.slice(0, MAX_HEARINGS).map((h) => {
    const parts = [
      `date: ${clip(h.hearing_date)}`,
      `type: ${clip(h.hearing_type)}`,
    ];
    const caseTitle = titleByCase.get(h.case_id);
    if (caseTitle) parts.push(`matter: ${caseTitle}`);
    if (h.court_name) parts.push(`court: ${clip(h.court_name)}`);
    return `- ${parts.join(" | ")}`;
  });

  const section = (name: string, lines: string[], total: number, max: number) =>
    [
      `${name} (${Math.min(total, max)} of ${total} shown):`,
      ...(lines.length ? lines : ["- none"]),
    ].join("\n");

  return [
    `Access scope: ${scope}`,
    `Today: ${new Date().toISOString().slice(0, 10)}`,
    section("Matters", caseLines, data.cases.length, MAX_CASES),
    section("Open tasks", taskLines, openTasks.length, MAX_TASKS),
    section(
      "Upcoming hearings",
      hearingLines,
      data.hearings.length,
      MAX_HEARINGS,
    ),
  ].join("\n\n");
}

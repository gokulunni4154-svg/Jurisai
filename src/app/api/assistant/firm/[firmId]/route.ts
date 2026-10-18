import { NextRequest, NextResponse } from "next/server";

import {
  handleAssistantGet,
  handleAssistantPost,
} from "@/modules/assistant/assistant.http";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { firmId: string };
}

// firmId is only a claim: AssistantService verifies firm_members for the caller.
export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  return handleAssistantGet(request, "firm", context.params.firmId);
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  return handleAssistantPost(request, "firm", context.params.firmId);
}

import { NextRequest, NextResponse } from "next/server";

import {
  handleAssistantGet,
  handleAssistantPost,
} from "@/modules/assistant/assistant.http";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleAssistantGet(request, "general", null);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleAssistantPost(request, "general", null);
}

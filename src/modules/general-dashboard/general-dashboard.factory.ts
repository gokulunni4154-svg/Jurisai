// src/modules/general-dashboard/general-dashboard.factory.ts
//
// NEW FILE — General Portal Phase 1. Follows
// document-analysis.factory.ts's confirmed real pattern: resolve
// getCurrentUser() once, construct ONE request-scoped RLS-respecting
// Supabase client via createClient(), and build every repository this
// service needs directly against that single client instance — no
// admin client anywhere in this file, deliberately (see
// general-dashboard.service.ts's class-level header for why: RLS alone
// is this module's entire authorization boundary).

import { getCurrentUser } from '@/core/auth/session';
import { createClient } from '@/core/supabase/server';

import { DocumentRepository } from '@/modules/documents/document.repository';
import { DocumentAnalysisRepository } from '@/modules/document-analysis/document-analysis.repository';
import { RiskDetectionRepository } from '@/modules/risk-detection/risk-detection.repository';
import { LegalHealthScoreRepository } from '@/modules/legal-health-score/legal-health-score.repository';
import { AIRecommendationRepository } from '@/modules/ai-recommendation/ai-recommendation.repository';

import { GeneralDashboardService } from './general-dashboard.service';

export async function buildGeneralDashboardService(): Promise<GeneralDashboardService> {
  const currentUser = await getCurrentUser();
  const supabase = await createClient();

  const documentRepository = new DocumentRepository(supabase);
  const documentAnalysisRepository = new DocumentAnalysisRepository(supabase);
  const riskDetectionRepository = new RiskDetectionRepository(supabase);
  const legalHealthScoreRepository = new LegalHealthScoreRepository(supabase);
  const aiRecommendationRepository = new AIRecommendationRepository(supabase);

  return new GeneralDashboardService(
    currentUser,
    documentRepository,
    documentAnalysisRepository,
    riskDetectionRepository,
    legalHealthScoreRepository,
    aiRecommendationRepository,
  );
}

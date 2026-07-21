// src/app/documents/[id]/page.tsx
// File 160 — JurisAI Frontend, Phase 3
//
// AMENDMENT, THIS SESSION — hearing_date view/set/change/clear UI added
// to the header, alongside document title. Built against real,
// source-verified dependencies from this session:
//   - documents.schemas.ts's updateDocumentSchema: hearingDate is
//     .optional().nullable() — omitted = untouched, null = clear, a
//     date = set/change. This page always sends the key explicitly
//     (never omits it) since every call here is a deliberate user
//     action on this one field — there is no scenario on this page
//     where hearingDate would be sent alongside an unrelated title
//     change, so the "omit to leave untouched" case doesn't arise here.
//   - document.service.ts's updateDocument(): returns the full updated
//     DocumentRow, which this page uses to refresh local `doc` state
//     directly rather than re-fetching.
//   - route.ts (PATCH /api/documents/[id]): confirmed response shape
//     `{ data: { document } }`, confirmed no try/catch needed around
//     request.json() beyond this page's own existing extractErrorMessage
//     convention (matches every other mutation on this page).
//   - database.types.ts (regenerated, this session): documents.hearing_date
//     is `string | null` (timestamptz, ISO string) — DocumentRow below
//     is amended to match exactly.
//
// FLAGGED, NOT DRAWN FROM PRECEDENT: this project's other date displays
// (formatRelativeTime, in File 159) show relative time ("2d ago"), not
// this. Hearing date is a future-facing, exact date a user needs to
// know precisely — a relative/fuzzy format would be actively unhelpful
// here, so this uses toLocaleDateString('en-IN', ...) instead, same
// absolute-date formatter File 159 already falls back to for anything
// older than a week. Not a new formatting convention, reusing an
// existing one for a different reason.
//
// FLAGGED, DELEGATED DECISION: uses a native <input type="date">, same
// "no design-system date picker exists in this project yet, a native
// control is the smallest thing that could plausibly be right" reasoning
// File 159's own comment gives for its bare native file-picker input.
// Revisit if a real date-picker component is built or adopted later.
//
// FLAGGED: an empty-string input clears the hearing date (sends
// `hearingDate: null`), rather than being treated as "no change" and
// silently ignored. This is a UI-level choice, not dictated by the
// schema — the schema's "omit to leave untouched" affordance isn't
// reachable from this page's UI at all, since this page never sends a
// hearingDate-omitted PATCH. Worth knowing if a future requirement wants
// a true three-way UI ("leave as-is" as a distinct, selectable action).

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  ListChecks,
  Scale,
  Play,
  CalendarClock,
  ShieldAlert,
  ListX,
  Gavel,
  Lightbulb,
  MessageCircle,
  Send,
  Brain,
} from 'lucide-react';

// ---- Shapes, source-verified against the entities/schemas listed above ----

interface DocumentRow {
  id: string;
  title: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  // NEW, THIS SESSION — matches database.types.ts's regenerated
  // documents.Row.hearing_date exactly (timestamptz -> string | null).
  hearing_date: string | null;
}

type DocumentAnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface DocumentAnalysis {
  id: string;
  document_id: string;
  status: DocumentAnalysisStatus;
  created_at: string;
  completed_at: string | null;
}

// Mirrors File 73's real OCRExtraction entity. Only the fields this page
// actually reads are declared, same convention as DocumentAnalysis above —
// `result`/`provider` are real fields on the entity too but unused here.
type OCRExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface OCRExtraction {
  status: OCRExtractionStatus;
  error_message: string | null;
}

type RunStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface ClassifiedClause {
  category: string;
  excerpt: string;
  order: number;
  confidence: number;
}

interface ClauseClassification {
  id: string;
  document_analysis_id: string;
  status: RunStatus;
  result: { clauses: ClassifiedClause[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

interface CategoryScores {
  risk: number;
  compliance: number;
  completeness: number;
  negotiationLeverage: number;
}

interface CategoryScoreDetail {
  category: string;
  score: number;
  weight: number;
  rationale: string;
  contributingEvidence: string[];
}

interface LegalHealthScore {
  id: string;
  document_analysis_id: string;
  status: RunStatus;
  overall_score: number | null;
  category_scores: CategoryScores | null;
  result: { overallScore: number; categoryBreakdown: CategoryScoreDetail[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  risk: 'Risk',
  compliance: 'Compliance',
  completeness: 'Completeness',
  negotiation_leverage: 'Negotiation Leverage',
};

const CLAUSE_CATEGORY_LABELS: Record<string, string> = {
  // Populated defensively — ClauseCategory's real member list (File 62)
  // was not re-pasted this session, so unknown categories fall back to
  // a formatted version of the raw string rather than an empty label.
};

function formatCategoryFallback(raw: string): string {
  return CLAUSE_CATEGORY_LABELS[raw] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-destructive';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-destructive';
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const json = await res.json();
    return json?.error?.message ?? json?.message ?? `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

// NEW, THIS SESSION — formats hearing_date's real ISO string (timestamptz)
// as a plain date, deliberately not relative time. See file-level comment
// above for why this differs from File 159's formatRelativeTime.
function formatHearingDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// NEW, THIS SESSION — converts hearing_date's real ISO string into the
// `YYYY-MM-DD` shape <input type="date"> requires as its `value`. Takes
// only the date portion (first 10 characters of an ISO timestamptz
// string) — deliberately not timezone-adjusted, since the hearing_date
// column stores a point in time and this page has no stated requirement
// yet for which timezone a "hearing date" should be interpreted in. This
// is a UI-level simplification, not something confirmed against a real
// product decision — flagged, not silently assumed correct for every case.
function isoToDateInputValue(isoString: string): string {
  return isoString.slice(0, 10);
}

// ---- New type, alongside LegalHealthScore etc. ----
type PdfExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface PdfExport {
  id: string;
  document_analysis_id: string;
  status: PdfExportStatus;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// NEW, THIS SESSION — mirrors File 106's route + File 102's real entity +
// File 101's real riskDetectionResultSchema exactly. `category`/`excerpt`
// are optional on RiskFlag (unlike ClassifiedClause above, where both are
// required) — per risk-detection.schemas.ts's own KEY DECISION comments,
// a `missing_clause`-type flag describes an absence, so it has no clause
// instance to categorize in the usual sense and no verbatim excerpt to
// return. Rendered defensively below to account for that.
type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

interface RiskFlag {
  type: string;
  severity: RiskSeverity;
  category?: string;
  excerpt?: string;
  explanation: string;
  confidence: number;
}

interface RiskDetection {
  id: string;
  document_analysis_id: string;
  status: RunStatus;
  result: { flags: RiskFlag[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

const SEVERITY_STYLES: Record<RiskSeverity, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-amber-500/10 text-amber-700',
  high: 'bg-orange-500/10 text-orange-700',
  critical: 'bg-destructive/10 text-destructive',
};

function formatRiskType(raw: string): string {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// NEW, THIS SESSION — mirrors File 114's route + File 110's real entity
// + File 109's real missingClauseDetectionResultSchema exactly. Unlike
// RiskFlag above, `category` is REQUIRED here (every flag in this
// module IS a missing-clause report by definition) and there is no
// `type`/`excerpt`/`order` field at all — per missing-clause-detection
// .schemas.ts's own KEY DECISION comments, an absent clause has no
// clause instance to excerpt and no position to order.
type MissingClauseImportance = 'low' | 'medium' | 'high' | 'critical';

interface MissingClauseFlag {
  category: string;
  importance: MissingClauseImportance;
  explanation: string;
  confidence: number;
}

interface MissingClauseDetection {
  id: string;
  document_analysis_id: string;
  status: RunStatus;
  result: { flags: MissingClauseFlag[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// Deliberately reuses SEVERITY_STYLES rather than defining a parallel
// IMPORTANCE_STYLES — both are the same four-value low/medium/high/
// critical vocabulary, just named differently per each schema's own KEY
// DECISION (severity vs. importance), and the visual treatment (a
// colored pill) has no reason to differ between the two concepts on
// this page. Not a claim that the two enums are the same TS type.

// NEW, THIS SESSION — mirrors File 122's route + File 118's real entity
// + File 117's real complianceDetectionResultSchema exactly. Unlike
// MissingClauseFlag, `type` IS required here (two distinct shapes —
// missing_requirement vs. non_compliant_clause — same reason File 101
// needed `type` across nine risk kinds); `category`/`excerpt` are
// optional, mirroring RiskFlag rather than MissingClauseFlag (a
// missing_requirement issue can be document-level, not clause-level);
// and `framework` is a new required field with no analog in either
// sibling module. SEVERITY_STYLES is reused again here for the same
// reason it's reused for MissingClauseImportance above — same four
// values, different name per schema.
type ComplianceIssueType = 'missing_requirement' | 'non_compliant_clause';
type ComplianceFramework =
  | 'indian_contract_act'
  | 'stamp_duty_registration'
  | 'consumer_protection_act'
  | 'dpdp_act'
  | 'labour_law';
type ComplianceSeverity = 'low' | 'medium' | 'high' | 'critical';

interface ComplianceFlag {
  type: ComplianceIssueType;
  framework: ComplianceFramework;
  severity: ComplianceSeverity;
  category?: string;
  excerpt?: string;
  explanation: string;
  confidence: number;
}

interface ComplianceDetection {
  id: string;
  document_analysis_id: string;
  status: RunStatus;
  result: { flags: ComplianceFlag[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// Real, fixed 5-value enum confirmed from compliance-detection.schemas
// .ts's own ComplianceFramework — this module's own docstring flags it
// as scoped to a first pass, expecting an extending amendment later, so
// this label map is coupled to that same expected-incomplete scope, not
// a claim it's exhaustive going forward.
const FRAMEWORK_LABELS: Record<ComplianceFramework, string> = {
  indian_contract_act: 'Indian Contract Act',
  stamp_duty_registration: 'Stamp Duty / Registration',
  consumer_protection_act: 'Consumer Protection Act',
  dpdp_act: 'DPDP Act',
  labour_law: 'Labour Law',
};

const COMPLIANCE_TYPE_LABELS: Record<ComplianceIssueType, string> = {
  missing_requirement: 'Missing Requirement',
  non_compliant_clause: 'Non-Compliant Clause',
};

// NEW, THIS SESSION — mirrors File 130's route + File 124's real entity +
// File 125's real aiRecommendationResultSchema exactly. Unlike the three
// detection-flag types above, this module's inner array is
// `recommendations`, not `flags`, and every field on Recommendation is
// REQUIRED — per ai-recommendation.schemas.ts's own docstring, this
// module synthesizes across four already-completed upstream results
// rather than reporting fresh issues found directly in the document, so
// none of the "no clause instance to excerpt/categorize" cases that
// justified RiskFlag/MissingClauseFlag/ComplianceFlag's optional fields
// arise here.
//
// `provider_used` (real field on AIRecommendation, File 124) is
// deliberately NOT declared below — same "only fields this page actually
// reads are declared" convention OCRExtraction's own comment states
// above, and AIProviderName's real member values were not pasted this
// session, so no value would be renderable from it anyway.
//
// `status` reuses RunStatus rather than the entity's own
// AIRecommendationStatus alias — both are the identical four-value
// pending/processing/completed/failed union; this page already made
// that same reuse choice for ClauseClassification/RiskDetection/
// MissingClauseDetection/ComplianceDetection above, not a new pattern.
type RecommendationActionType =
  | 'add_clause'
  | 'amend_clause'
  | 'remove_clause'
  | 'compliance_action'
  | 'negotiate_terms'
  | 'seek_professional_review';

type RecommendationPriority = 'low' | 'medium' | 'high' | 'critical';

type SourceModule =
  | 'clause_classification'
  | 'risk_detection'
  | 'missing_clause_detection'
  | 'compliance_detection';

interface Recommendation {
  actionType: RecommendationActionType;
  priority: RecommendationPriority;
  title: string;
  recommendation: string;
  rationale: string;
  sourceModules: SourceModule[];
  sourceSummary: string;
  confidence: number;
}

interface AIRecommendation {
  id: string;
  document_analysis_id: string;
  status: RunStatus;
  result: { recommendations: Recommendation[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// Deliberately reuses SEVERITY_STYLES rather than a parallel
// PRIORITY_STYLES — RecommendationPriority is the same four-value low/
// medium/high/critical vocabulary as RiskSeverity/MissingClauseImportance
// /ComplianceSeverity, just named differently per that schema's own KEY
// DECISION against cross-module severity/priority reuse at the TYPE
// level. Same visual-reuse reasoning already given above for the other
// two, not a new exception.

// RecommendationActionType and SourceModule have no abbreviation or
// special-casing needs the way ComplianceFramework's `dpdp_act` did
// (there's no "DPDP"-style acronym among either enum's real members, per
// ai-recommendation.schemas.ts above), so this reuses formatRiskType's
// existing generic humanizer rather than adding two more static label
// maps for enums that don't need one.

// NEW, THIS SESSION — mirrors ai-legal-insight.entity.ts's (File 141)
// real AiLegalInsight row + ai-legal-insight.schemas.ts's (File 142)
// real aiLegalInsightResultSchema exactly.
//
// AiLegalInsightSourceModule is a DISTINCT 7-value type from
// SourceModule above (4 values), not a reuse — per
// ai-legal-insight.schemas.ts's own KEY DECISION comment, this module's
// enum extends File 125's four-value SourceModule with three more
// (ai_recommendation, legal_health_score, document_analysis), since it
// synthesizes across a strictly larger set of upstream modules than AI
// Recommendation Engine does.
//
// The single-insight item is named LegalInsight here, not AiLegalInsight
// — the real schemas.ts source itself exports `AiLegalInsight` as the
// per-item type (z.infer<typeof insightSchema>) while entity.ts
// separately exports `AiLegalInsight` as the DB row interface. Those two
// same-named real exports would collide if both were declared verbatim
// in one client file, so the row keeps the entity's name (AILegalInsight,
// same AIRecommendation-style capitalization this page already uses) and
// the per-item shape is named LegalInsight instead. A naming choice made
// necessary by the real source's own two-module split, not a claim that
// the real modules name these identically.
//
// Every field on LegalInsight is REQUIRED, matching insightSchema's real
// shape (no optional fields the way RiskFlag/ComplianceFlag have, since
// this module's insights are synthesized text, not clause references
// that may or may not exist).
type AiLegalInsightSourceModule =
  | 'clause_classification'
  | 'risk_detection'
  | 'missing_clause_detection'
  | 'compliance_detection'
  | 'ai_recommendation'
  | 'legal_health_score'
  | 'document_analysis';

interface LegalInsight {
  title: string;
  narrative: string;
  sourceModules: AiLegalInsightSourceModule[];
  sourceSummary: string;
  confidence: number;
}

interface AILegalInsight {
  id: string;
  document_analysis_id: string;
  status: RunStatus;
  result: { insights: LegalInsight[] } | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

// AiLegalInsightSourceModule has no abbreviation exceptions either (same
// reasoning already given for SourceModule above), so this reuses
// formatRiskType's existing generic humanizer rather than adding a
// third static label map.

// NEW, THIS SESSION — mirrors File 149's real ChatMessageRole enum,
// File 150's real ChatConversation/ChatMessage entities. GENUINELY
// DIFFERENT SHAPE from every module above: per chat.entity.ts's own
// docstring, a conversation has no status/result/error_message
// run-lifecycle — it's a mutable thread, closer to a Profile than to
// any AI-run entity. Mirrored in full below (not a status/result
// subset the way ClauseClassification etc. are).
//
// `provider_used` (real field on ChatMessage, chat.entity.ts) is
// deliberately NOT declared here, same "only fields this page actually
// reads are declared" convention already applied to AIRecommendation
// above, for the same reason: AIProviderName's real member values were
// never pasted in any session, so no label would be renderable from it.
type ChatMessageRole = 'user' | 'assistant';

interface ChatConversation {
  id: string;
  document_analysis_id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}

interface ChatMessage {
  id: string;
  conversation_id: string;
  role: ChatMessageRole;
  content: string;
  created_at: string;
}

// Legal Health Score prerequisite handling (Amendment/File 161 follow-up).
//
// Confirmed against real source (File 10's NotFoundError + toJSON(), File
// 21's handleApiError, File 138's route): every missing-prerequisite case
// returns the SAME HTTP status (404) and the SAME error code
// (RESOURCE_NOT_FOUND) — NotFoundError's `context` field (which holds
// `{ resource, identifier }` distinctly) is deliberately excluded from
// toJSON() and never reaches the client. The only place the resource name
// survives is baked into `message`'s prose, via NotFoundError's own
// deterministic template: `${resource} with identifier "${identifier}"
// was not found`. This map/parser is coupled to that exact template — if
// NotFoundError's message format ever changes, this silently stops
// matching and falls back to the raw message (see the `?? message`
// fallback at the call site), not to a wrong label.
const PREREQUISITE_LABELS: Record<string, string> = {
  clause_classifications: 'Clause Classification',
  risk_detections: 'Risk Detection',
  missing_clause_detections: 'Missing Clause Detection',
  compliance_detections: 'Compliance Detection',
  ai_recommendations: 'AI Recommendation Engine',
  // NEW, THIS SESSION — route.ts's sixth and last prerequisite check
  // (ai-legal-insights route, File 146). Not new to this PAGE (a Legal
  // Health Score trigger, handleRunHealthScore, already existed before
  // this session), just newly reachable as a NotFoundError resource name
  // now that a route (AI Legal Insights) checks for it as an upstream
  // dependency rather than this page's own legal-health-scores route
  // being the thing that's missing.
  legal_health_scores: 'Legal Health Score Engine',
};

// UPDATED ACROSS FIVE SESSIONS: Risk Detection (File 106), Missing
// Clause Detection (File 114), Compliance Detection (File 122), AI
// Recommendation Engine (File 130), and now AI Legal Insights (File
// 146) all have real triggers on this page — Legal Health Score
// (handleRunHealthScore) already did before any of these. File 161's
// original open item — four routes with no UI — was fully closed as of
// the AI Recommendation Engine addition; this addition doesn't reopen
// it, it just adds legal_health_scores to the set since AI Legal
// Insights is the first route on this page to report it as a missing
// upstream prerequisite by name. The "not runnable from this page yet"
// branch in describeMissingPrerequisite below remains unreachable for
// every resource this page's own routes can report as a missing
// prerequisite; kept rather than removed, same forward-compatibility
// reasoning as before.
const RUNNABLE_FROM_THIS_PAGE = new Set([
  'clause_classifications',
  'risk_detections',
  'missing_clause_detections',
  'compliance_detections',
  'ai_recommendations',
  'legal_health_scores',
]);

function describeMissingPrerequisite(message: string): string | null {
  for (const [resource, label] of Object.entries(PREREQUISITE_LABELS)) {
    if (message.startsWith(`${resource} with identifier`)) {
      return RUNNABLE_FROM_THIS_PAGE.has(resource)
        ? `${label} hasn't been run for this analysis yet — run it using the button above first.`
        : `${label} hasn't been run for this analysis yet, and this page doesn't support running it directly yet. It needs to complete before a Legal Health Score can be generated.`;
    }
  }
  return null;
}

export default function DocumentAnalysisPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const documentId = params.id;

  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [analysis, setAnalysis] = useState<DocumentAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [classification, setClassification] = useState<ClauseClassification | null>(null);
  const [healthScore, setHealthScore] = useState<LegalHealthScore | null>(null);
  // NEW, THIS SESSION — mirrors classification/healthScore's state shape.
  const [riskDetection, setRiskDetection] = useState<RiskDetection | null>(null);
  const [isRunningRiskDetection, setIsRunningRiskDetection] = useState(false);
  const [riskDetectionError, setRiskDetectionError] = useState<string | null>(null);
  // NEW, THIS SESSION — mirrors riskDetection's state shape exactly.
  const [missingClauseDetection, setMissingClauseDetection] =
    useState<MissingClauseDetection | null>(null);
  const [isRunningMissingClauseDetection, setIsRunningMissingClauseDetection] = useState(false);
  const [missingClauseDetectionError, setMissingClauseDetectionError] = useState<string | null>(
    null,
  );
  // NEW, THIS SESSION — mirrors missingClauseDetection's state shape.
  const [complianceDetection, setComplianceDetection] = useState<ComplianceDetection | null>(
    null,
  );
  const [isRunningComplianceDetection, setIsRunningComplianceDetection] = useState(false);
  const [complianceDetectionError, setComplianceDetectionError] = useState<string | null>(null);
  // NEW, THIS SESSION — mirrors the three sibling detection modules'
  // state shape exactly.
  const [aiRecommendation, setAiRecommendation] = useState<AIRecommendation | null>(null);
  const [isRunningAIRecommendation, setIsRunningAIRecommendation] = useState(false);
  const [aiRecommendationError, setAiRecommendationError] = useState<string | null>(null);
  // NEW, THIS SESSION — mirrors aiRecommendation's state shape exactly;
  // same run-lifecycle pattern as every module above.
  const [aiLegalInsight, setAiLegalInsight] = useState<AILegalInsight | null>(null);
  const [isRunningAILegalInsight, setIsRunningAILegalInsight] = useState(false);
  const [aiLegalInsightError, setAiLegalInsightError] = useState<string | null>(null);

  // NEW, THIS SESSION — Chat state. Not a run-lifecycle shape like every
  // state block above (no isRunning/Error pair per "run") — a
  // conversation is loaded once, then has its own separate
  // isSendingMessage/sendMessageError pair for the ongoing interaction,
  // plus isStartingConversation/startConversationError for creating a
  // fresh conversation when none exists yet.
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const [startConversationError, setStartConversationError] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [sendMessageError, setSendMessageError] = useState<string | null>(null);
  // Holds the in-flight assistant reply's accumulated text while
  // streaming; null when nothing is currently streaming. Per File 156's
  // own DECISION #3, a mid-stream failure can only end the stream
  // early — there is no separate "streaming failed" state distinct from
  // sendMessageError plus this simply stopping partway.
  const [streamingAssistantText, setStreamingAssistantText] = useState<string | null>(null);

  const [isRunningClassification, setIsRunningClassification] = useState(false);
  const [classificationError, setClassificationError] = useState<string | null>(null);

  const [isRunningHealthScore, setIsRunningHealthScore] = useState(false);
  const [healthScoreError, setHealthScoreError] = useState<string | null>(null);

  const [isStartingAnalysis, setIsStartingAnalysis] = useState(false);
  const [startAnalysisError, setStartAnalysisError] = useState<string | null>(null);

  const [pdfExport, setPdfExport] = useState<PdfExport | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isFetchingPdfUrl, setIsFetchingPdfUrl] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // NEW, THIS SESSION — hearing_date view/edit state. Mirrors the
  // isEditing/isSaving/error state shape already used for every other
  // mutation on this page (classification, health score, PDF).
  const [isEditingHearingDate, setIsEditingHearingDate] = useState(false);
  const [hearingDateInput, setHearingDateInput] = useState('');
  const [isSavingHearingDate, setIsSavingHearingDate] = useState(false);
  const [hearingDateError, setHearingDateError] = useState<string | null>(null);

  const loadEverything = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const docRes = await fetch(`/api/documents/${documentId}`, { credentials: 'include' });
      if (!docRes.ok) throw new Error(await extractErrorMessage(docRes));
      const docJson = await docRes.json();
      setDoc(docJson.data.document);

      const analysesRes = await fetch(`/api/documents/${documentId}/analyses`, {
        credentials: 'include',
      });
      if (!analysesRes.ok) throw new Error(await extractErrorMessage(analysesRes));
      const analysesJson = await analysesRes.json();
      const analyses: DocumentAnalysis[] = analysesJson.data.analyses;
      const latest = analyses[0] ?? null;
      setAnalysis(latest);

      if (latest) {
        const [
          classificationsRes,
          healthScoresRes,
          riskDetectionsRes,
          missingClauseDetectionsRes,
          complianceDetectionsRes,
          aiRecommendationsRes,
          aiLegalInsightsRes,
          chatConversationsRes,
        ] = await Promise.all([
          fetch(`/api/documents/${documentId}/analyses/${latest.id}/classifications`, {
            credentials: 'include',
          }),
          fetch(`/api/documents/${documentId}/analyses/${latest.id}/legal-health-scores`, {
            credentials: 'include',
          }),
          // File 106's real GET, confirmed to return { data:
          // <RiskDetection[]> } with no pagination wrapper, same shape
          // as classifications/health-scores' own list endpoints.
          fetch(`/api/documents/${documentId}/analyses/${latest.id}/risk-detections`, {
            credentials: 'include',
          }),
          // File 114's real GET, same { data: <MissingClauseDetection[]> }
          // shape, confirmed from source.
          fetch(
            `/api/documents/${documentId}/analyses/${latest.id}/missing-clause-detections`,
            { credentials: 'include' },
          ),
          // NEW, THIS SESSION — File 122's real GET, same { data:
          // <ComplianceDetection[]> } shape, confirmed from source.
          fetch(`/api/documents/${documentId}/analyses/${latest.id}/compliance-detections`, {
            credentials: 'include',
          }),
          // NEW, THIS SESSION — File 130's real GET, same { data:
          // <AIRecommendation[]> } shape, confirmed from source
          // (AIRecommendationRepository#findByDocumentAnalysisId).
          fetch(`/api/documents/${documentId}/analyses/${latest.id}/ai-recommendations`, {
            credentials: 'include',
          }),
          // NEW, THIS SESSION — File 146's real GET, same { data:
          // <AILegalInsight[]> } shape, confirmed from route.ts's GET
          // handler (AiLegalInsightService#listAiLegalInsightsForAnalysis).
          fetch(`/api/documents/${documentId}/analyses/${latest.id}/ai-legal-insights`, {
            credentials: 'include',
          }),
          // NEW, THIS SESSION — File 154's real GET, same { data:
          // <ChatConversation[]> } shape, confirmed from source
          // (ChatConversationRepository#findManyForUser).
          fetch(`/api/documents/${documentId}/analyses/${latest.id}/chat/conversations`, {
            credentials: 'include',
          }),
        ]);
        const pdfExportsRes = await fetch(
          `/api/documents/${documentId}/analyses/${latest.id}/pdf-exports`,
          { credentials: 'include' },
        );
        if (pdfExportsRes.ok) {
          const json = await pdfExportsRes.json();
          const runs: PdfExport[] = json.data;
          // Sorted client-side, same reasoning as Open Item #32 already applies
          // to classification/healthScore above — API ordering isn't re-verified
          // for this endpoint either.
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setPdfExport(sorted.find((r) => r.status === 'completed') ?? null);
        }

        if (classificationsRes.ok) {
          const json = await classificationsRes.json();
          const runs: ClauseClassification[] = json.data;
          // Sorted explicitly rather than trusting API order — File 68's
          // most-recent-first guarantee is documented for /analyses only,
          // not confirmed for this endpoint (Open Item #32).
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setClassification(sorted.find((r) => r.status === 'completed') ?? sorted[0] ?? null);
        }

        if (healthScoresRes.ok) {
          const json = await healthScoresRes.json();
          const runs: LegalHealthScore[] = json.data;
          // Same reasoning as above — see Open Item #32.
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setHealthScore(sorted.find((r) => r.status === 'completed') ?? sorted[0] ?? null);
        }

        // NEW, THIS SESSION — same sort/select pattern as classification
        // and health score above (Open Item #32 applies equally here:
        // File 106's GET doesn't confirm ordering, so this doesn't trust
        // API order either).
        if (riskDetectionsRes.ok) {
          const json = await riskDetectionsRes.json();
          const runs: RiskDetection[] = json.data;
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setRiskDetection(sorted.find((r) => r.status === 'completed') ?? sorted[0] ?? null);
        }

        // NEW, THIS SESSION — same pattern as risk detection above.
        if (missingClauseDetectionsRes.ok) {
          const json = await missingClauseDetectionsRes.json();
          const runs: MissingClauseDetection[] = json.data;
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setMissingClauseDetection(
            sorted.find((r) => r.status === 'completed') ?? sorted[0] ?? null,
          );
        }

        // NEW, THIS SESSION — same pattern as the three siblings above.
        if (complianceDetectionsRes.ok) {
          const json = await complianceDetectionsRes.json();
          const runs: ComplianceDetection[] = json.data;
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setComplianceDetection(sorted.find((r) => r.status === 'completed') ?? sorted[0] ?? null);
        }

        // NEW, THIS SESSION — same sort/select pattern as the three
        // sibling detection modules above (Open Item #32 applies here
        // identically — File 130's GET doesn't confirm ordering either).
        if (aiRecommendationsRes.ok) {
          const json = await aiRecommendationsRes.json();
          const runs: AIRecommendation[] = json.data;
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setAiRecommendation(sorted.find((r) => r.status === 'completed') ?? sorted[0] ?? null);
        }

        // NEW, THIS SESSION — same sort/select pattern as every sibling
        // module above (Open Item #32 applies here identically — File
        // 146's GET doesn't confirm ordering either).
        if (aiLegalInsightsRes.ok) {
          const json = await aiLegalInsightsRes.json();
          const runs: AILegalInsight[] = json.data;
          const sorted = [...runs].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
          setAiLegalInsight(sorted.find((r) => r.status === 'completed') ?? sorted[0] ?? null);
        }

        // NEW, THIS SESSION — File 154's GET documents its own ordering
        // (most recently active first, via last_message_at), but this
        // still doesn't trust it blindly — same Open Item #32 reasoning
        // as every list endpoint above, just sorting by
        // last_message_at instead of created_at since that's the field
        // the real ordering claim is actually about. Picks the single
        // most-recently-active conversation as "the" conversation for
        // this page — a deliberate v1 scope choice (this UI supports
        // one active conversation at a time, not a conversation
        // switcher), not something File 149/150/154 themselves impose.
        if (chatConversationsRes.ok) {
          const json = await chatConversationsRes.json();
          const conversations: ChatConversation[] = json.data;
          const sorted = [...conversations].sort(
            (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime(),
          );
          const mostRecent = sorted[0] ?? null;
          setActiveConversation(mostRecent);

          if (mostRecent) {
            // Sequential, not part of the Promise.all above — depends on
            // knowing mostRecent.id first. Same pattern as pdfExportsRes's
            // own sequential-after-Promise.all fetch elsewhere in this
            // function.
            const messagesRes = await fetch(
              `/api/documents/${documentId}/analyses/${latest.id}/chat/conversations/${mostRecent.id}/messages`,
              { credentials: 'include' },
            );
            if (messagesRes.ok) {
              const messagesJson = await messagesRes.json();
              setMessages(messagesJson.data);
            }
          }
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load this document.');
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    loadEverything();
  }, [loadEverything]);

  const handleRunClassification = async () => {
    if (!analysis) return;
    setIsRunningClassification(true);
    setClassificationError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/classifications`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      setClassification(json.data);
    } catch (err) {
      setClassificationError(
        err instanceof Error ? err.message : 'Classification failed for an unknown reason.',
      );
    } finally {
      setIsRunningClassification(false);
    }
  };

  // NEW, THIS SESSION — mirrors handleRunClassification's shape, but
  // gates client-side on classification being completed first (File
  // 106's real route 404s with clause_classifications otherwise — see
  // route.ts's own CLASSIFICATION-MISSING CHECK comment) so the button
  // can explain why rather than letting the request round-trip to a
  // 404. The OCR-missing case is not client-checked, same reasoning File
  // 106 itself gives: it's treated as an unreachable data-inconsistency
  // case here, not a normal branch a user should be steered around.
  const handleRunRiskDetection = async () => {
    if (!analysis) return;
    if (classification?.status !== 'completed') {
      setRiskDetectionError(
        'Clause Classification must be completed before Risk Detection can run — use the button below first.',
      );
      return;
    }
    setIsRunningRiskDetection(true);
    setRiskDetectionError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/risk-detections`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const message = await extractErrorMessage(res);
        throw new Error(
          res.status === 404 ? (describeMissingPrerequisite(message) ?? message) : message,
        );
      }
      const json = await res.json();
      setRiskDetection(json.data);
    } catch (err) {
      setRiskDetectionError(
        err instanceof Error ? err.message : 'Risk detection failed for an unknown reason.',
      );
    } finally {
      setIsRunningRiskDetection(false);
    }
  };

  // NEW, THIS SESSION — mirrors handleRunRiskDetection's shape exactly.
  // File 114's route has the identical two-prerequisite structure as
  // File 106 (OCR + completed classification), same reasoning for why
  // only the classification check is client-gated here.
  const handleRunMissingClauseDetection = async () => {
    if (!analysis) return;
    if (classification?.status !== 'completed') {
      setMissingClauseDetectionError(
        'Clause Classification must be completed before Missing Clause Detection can run — use the button below first.',
      );
      return;
    }
    setIsRunningMissingClauseDetection(true);
    setMissingClauseDetectionError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/missing-clause-detections`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const message = await extractErrorMessage(res);
        throw new Error(
          res.status === 404 ? (describeMissingPrerequisite(message) ?? message) : message,
        );
      }
      const json = await res.json();
      setMissingClauseDetection(json.data);
    } catch (err) {
      setMissingClauseDetectionError(
        err instanceof Error ? err.message : 'Missing clause detection failed for an unknown reason.',
      );
    } finally {
      setIsRunningMissingClauseDetection(false);
    }
  };

  // NEW, THIS SESSION — mirrors handleRunMissingClauseDetection's shape
  // exactly. File 122's route confirms the same two-prerequisite
  // structure as Files 106/114 (OCR + completed classification).
  const handleRunComplianceDetection = async () => {
    if (!analysis) return;
    if (classification?.status !== 'completed') {
      setComplianceDetectionError(
        'Clause Classification must be completed before Compliance Detection can run — use the button below first.',
      );
      return;
    }
    setIsRunningComplianceDetection(true);
    setComplianceDetectionError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/compliance-detections`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const message = await extractErrorMessage(res);
        throw new Error(
          res.status === 404 ? (describeMissingPrerequisite(message) ?? message) : message,
        );
      }
      const json = await res.json();
      setComplianceDetection(json.data);
    } catch (err) {
      setComplianceDetectionError(
        err instanceof Error ? err.message : 'Compliance detection failed for an unknown reason.',
      );
    } finally {
      setIsRunningComplianceDetection(false);
    }
  };

  // NEW, THIS SESSION — diverges from handleRunRiskDetection/
  // handleRunMissingClauseDetection/handleRunComplianceDetection in one
  // deliberate way: FOUR client-side prerequisite checks, not one. Per
  // route.ts's own comment, this route synthesizes over Clause
  // Classification, Risk Detection, Missing Clause Detection, and
  // Compliance Detection results (not raw OCR text), and checks all four
  // server-side in that exact order. Checks below mirror that order
  // (classification -> risk -> missing-clause -> compliance) and
  // short-circuit on the first missing one, same "explain why rather
  // than round-trip to a 404" reasoning the other three handlers give,
  // just applied four times instead of once.
  const handleRunAIRecommendation = async () => {
    if (!analysis) return;
    if (classification?.status !== 'completed') {
      setAiRecommendationError(
        'Clause Classification must be completed before AI Recommendations can be generated — use the button above first.',
      );
      return;
    }
    if (riskDetection?.status !== 'completed') {
      setAiRecommendationError(
        'Risk Detection must be completed before AI Recommendations can be generated — use the button above first.',
      );
      return;
    }
    if (missingClauseDetection?.status !== 'completed') {
      setAiRecommendationError(
        'Missing Clause Detection must be completed before AI Recommendations can be generated — use the button above first.',
      );
      return;
    }
    if (complianceDetection?.status !== 'completed') {
      setAiRecommendationError(
        'Compliance Detection must be completed before AI Recommendations can be generated — use the button above first.',
      );
      return;
    }
    setIsRunningAIRecommendation(true);
    setAiRecommendationError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/ai-recommendations`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const message = await extractErrorMessage(res);
        throw new Error(
          res.status === 404 ? (describeMissingPrerequisite(message) ?? message) : message,
        );
      }
      const json = await res.json();
      setAiRecommendation(json.data);
    } catch (err) {
      setAiRecommendationError(
        err instanceof Error
          ? err.message
          : 'AI recommendation generation failed for an unknown reason.',
      );
    } finally {
      setIsRunningAIRecommendation(false);
    }
  };

  // NEW, THIS SESSION — diverges from handleRunAIRecommendation the same
  // way route.ts diverges from File 130's route: SIX client-side
  // prerequisite checks, not four. Order mirrors route.ts's own check
  // order exactly (classification -> risk -> missing-clause ->
  // compliance -> ai-recommendation -> legal-health-score), which itself
  // mirrors runAiLegalInsight()'s parameter order per route.ts's own
  // comment. Same short-circuit-with-a-named-message reasoning as every
  // handler above, just extended by the one new upstream check
  // (legal-health-score) appended last.
  const handleRunAILegalInsight = async () => {
    if (!analysis) return;
    if (classification?.status !== 'completed') {
      setAiLegalInsightError(
        'Clause Classification must be completed before AI Legal Insights can be generated — use the button above first.',
      );
      return;
    }
    if (riskDetection?.status !== 'completed') {
      setAiLegalInsightError(
        'Risk Detection must be completed before AI Legal Insights can be generated — use the button above first.',
      );
      return;
    }
    if (missingClauseDetection?.status !== 'completed') {
      setAiLegalInsightError(
        'Missing Clause Detection must be completed before AI Legal Insights can be generated — use the button above first.',
      );
      return;
    }
    if (complianceDetection?.status !== 'completed') {
      setAiLegalInsightError(
        'Compliance Detection must be completed before AI Legal Insights can be generated — use the button above first.',
      );
      return;
    }
    if (aiRecommendation?.status !== 'completed') {
      setAiLegalInsightError(
        'AI Recommendation Engine must be completed before AI Legal Insights can be generated — use the button above first.',
      );
      return;
    }
    if (healthScore?.status !== 'completed') {
      setAiLegalInsightError(
        'Legal Health Score must be completed before AI Legal Insights can be generated — use the button above first.',
      );
      return;
    }
    setIsRunningAILegalInsight(true);
    setAiLegalInsightError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/ai-legal-insights`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const message = await extractErrorMessage(res);
        throw new Error(
          res.status === 404 ? (describeMissingPrerequisite(message) ?? message) : message,
        );
      }
      const json = await res.json();
      setAiLegalInsight(json.data);
    } catch (err) {
      setAiLegalInsightError(
        err instanceof Error
          ? err.message
          : 'AI legal insight generation failed for an unknown reason.',
      );
    } finally {
      setIsRunningAILegalInsight(false);
    }
  };

  // NEW, THIS SESSION — starts a fresh conversation. Per route.ts's own
  // comment, File 154's POST has no upstream prerequisite checks (unlike
  // every run-lifecycle handler above) — startConversation() only
  // validates the parent document/analysis and inserts one row, so
  // there's nothing to client-side-gate here the way
  // handleRunRiskDetection etc. gate on classification.
  const handleStartConversation = async () => {
    if (!analysis) return;
    setIsStartingConversation(true);
    setStartConversationError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/chat/conversations`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      setActiveConversation(json.data);
      // A freshly-created conversation has no messages yet.
      setMessages([]);
    } catch (err) {
      setStartConversationError(
        err instanceof Error ? err.message : 'Could not start a conversation for an unknown reason.',
      );
    } finally {
      setIsStartingConversation(false);
    }
  };

  // NEW, THIS SESSION — sends a message and consumes File 156's real
  // streaming response. Genuinely different shape from every handler
  // above: no single `const json = await res.json(); setX(json.data)`
  // step, since the POST response is a raw ReadableStream of text
  // chunks, not JSON (see route.ts's own DECISION #1). Built directly
  // against that file's documented consumption pattern:
  // `response.body.getReader()` / `TextDecoder`, not EventSource.
  const handleSendMessage = async () => {
    if (!analysis || !activeConversation) return;
    const content = chatInput.trim();
    if (!content) return;

    setIsSendingMessage(true);
    setSendMessageError(null);
    setStreamingAssistantText('');
    setChatInput('');

    // Optimistic local echo of the user's own message. Safe per File
    // 153's own docstring — the user's message is persisted BEFORE the
    // AI call starts, so it is never lost even on a failed turn. This
    // temporary row is replaced by the canonical persisted rows once
    // the stream finishes and messages are re-fetched below (or removed
    // in the catch block, for the one case where nothing was persisted
    // at all — see there).
    const optimisticId = `optimistic-user-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        conversation_id: activeConversation.id,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/chat/conversations/${activeConversation.id}/messages`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: activeConversation.id, content }),
        },
      );

      // Per route.ts's own DECISION #2 — everything sendMessage()
      // validates (auth, conversation lookup, ownership, cross-analysis
      // check, upstream-context fetch) runs before the first token is
      // yielded, so a real HTTP status here is meaningful, not a race
      // against an already-started stream.
      if (!res.ok) {
        throw new Error(await extractErrorMessage(res));
      }
      if (!res.body) {
        throw new Error('No response stream was returned.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setStreamingAssistantText(accumulated);
      }

      // Per route.ts's own DECISION #3 — a mid-stream failure can only
      // end the stream early, never change the HTTP status, so there is
      // no separate error signal to check beyond the stream simply
      // ending short. Re-fetching the canonical message list either way
      // is the only reliable source of truth for what actually got
      // persisted (the user's message, always; the assistant's reply,
      // only if the stream ran to completion — File 153's own open
      // item on partial-assistant-message persistence, not solved
      // here).
      const messagesRes = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/chat/conversations/${activeConversation.id}/messages`,
        { credentials: 'include' },
      );
      if (messagesRes.ok) {
        const json = await messagesRes.json();
        setMessages(json.data);
      }
    } catch (err) {
      setSendMessageError(
        err instanceof Error ? err.message : 'Sending your message failed for an unknown reason.',
      );
      // Only removes the optimistic row for a genuine PRE-stream
      // failure, where nothing was persisted at all. For a mid-stream
      // failure the re-fetch above already ran and replaced this with
      // the canonical row, so this filter is a no-op in that case —
      // deliberately, not by accident.
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    } finally {
      setIsSendingMessage(false);
      setStreamingAssistantText(null);
    }
  };

  const handleRunHealthScore = async () => {
    if (!analysis) return;
    setIsRunningHealthScore(true);
    setHealthScoreError(null);
    try {
      const res = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/legal-health-scores`,
        { method: 'POST', credentials: 'include' },
      );
      if (!res.ok) {
        const message = await extractErrorMessage(res);
        // File 138 returns 404 + RESOURCE_NOT_FOUND identically for all
        // five prerequisite checks — status/code alone can't distinguish
        // them, only the message text can (see describeMissingPrerequisite
        // above). Falls back to the raw message if it doesn't match any
        // known prerequisite shape, e.g. a genuine unrelated 404.
        throw new Error(
          res.status === 404 ? (describeMissingPrerequisite(message) ?? message) : message,
        );
      }
      const json = await res.json();
      setHealthScore(json.data);
    } catch (err) {
      setHealthScoreError(
        err instanceof Error ? err.message : 'Health score generation failed for an unknown reason.',
      );
    } finally {
      setIsRunningHealthScore(false);
    }
  };

  const handleStartAnalysis = async () => {
    setIsStartingAnalysis(true);
    setStartAnalysisError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/analyze`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      const { extraction, analysis: newAnalysis } = json.data as {
        extraction: OCRExtraction;
        analysis: DocumentAnalysis | null;
      };

      if (!newAnalysis) {
        // HTTP succeeded (201) but OCR failed server-side, per File 67's
        // documented behavior — no DocumentAnalysis row was created.
        // `!res.ok` above does not catch this. extraction.error_message
        // is OCRExtraction's real, user-safe field (File 73, same
        // convention as document_analyses' USER_SAFE_FAILURE_MESSAGES) —
        // shown directly rather than a generic client-side placeholder.
        setStartAnalysisError(
          extraction.error_message ??
            'Text extraction failed for this document, so no analysis was created. You can try again.',
        );
        return;
      }

      setAnalysis(newAnalysis);
      // A freshly-created analysis has no classification/health-score
      // runs yet — this branch only renders when `!analysis` was true,
      // so there's nothing stale to preserve.
      setClassification(null);
      setHealthScore(null);
    } catch (err) {
      setStartAnalysisError(
        err instanceof Error ? err.message : 'Analysis failed to start for an unknown reason.',
      );
    } finally {
      setIsStartingAnalysis(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!analysis) return;
    setPdfError(null);

    // Gated on both prerequisites being completed — same two-check shape
    // File 168's own POST route enforces server-side; checked client-side
    // too so the button can explain *why* it's disabled rather than
    // letting the request round-trip just to 404.
    if (classification?.status !== 'completed' || healthScore?.status !== 'completed') {
      setPdfError(
        'Both Clause Classification and Legal Health Score must be completed before a PDF report can be generated.',
      );
      return;
    }

    try {
      let exportToDownload = pdfExport;

      if (!exportToDownload) {
        setIsGeneratingPdf(true);
        const res = await fetch(
          `/api/documents/${documentId}/analyses/${analysis.id}/pdf-exports`,
          { method: 'POST', credentials: 'include' },
        );
        if (!res.ok) throw new Error(await extractErrorMessage(res));
        const json = await res.json();
        exportToDownload = json.data as PdfExport;
        setPdfExport(exportToDownload);

        if (exportToDownload.status !== 'completed') {
          throw new Error(
            exportToDownload.error_message ?? 'PDF generation failed for an unknown reason.',
          );
        }
      }

      setIsFetchingPdfUrl(true);
      const urlRes = await fetch(
        `/api/documents/${documentId}/analyses/${analysis.id}/pdf-exports/${exportToDownload.id}/download`,
        { credentials: 'include' },
      );
      if (!urlRes.ok) throw new Error(await extractErrorMessage(urlRes));
      const urlJson = await urlRes.json();
      window.open(urlJson.data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Could not download the PDF report.');
    } finally {
      setIsGeneratingPdf(false);
      setIsFetchingPdfUrl(false);
    }
  };

  // NEW, THIS SESSION — enters edit mode, seeding the input from doc's
  // real current hearing_date (converted to <input type="date">'s
  // required YYYY-MM-DD shape) or empty if none is set yet.
  const handleStartEditHearingDate = () => {
    setHearingDateError(null);
    setHearingDateInput(doc?.hearing_date ? isoToDateInputValue(doc.hearing_date) : '');
    setIsEditingHearingDate(true);
  };

  // NEW, THIS SESSION — PATCH /api/documents/[id] with hearingDate always
  // present as a key (never omitted): a real date string if the input has
  // a value, or `null` if the input was cleared. Both are legitimate,
  // deliberate states per updateDocumentSchema — this handler covers
  // set/change AND clear in one path, since the only difference is what
  // the input field currently holds.
  const handleSaveHearingDate = async () => {
    setIsSavingHearingDate(true);
    setHearingDateError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hearingDate: hearingDateInput === '' ? null : hearingDateInput,
        }),
      });
      if (!res.ok) throw new Error(await extractErrorMessage(res));
      const json = await res.json();
      setDoc(json.data.document);
      setIsEditingHearingDate(false);
    } catch (err) {
      setHearingDateError(
        err instanceof Error ? err.message : 'Could not update the hearing date.',
      );
    } finally {
      setIsSavingHearingDate(false);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-background font-sans text-foreground">
      <header className="flex items-center gap-4 border-b border-border px-8 py-6">
        <button
          onClick={() => router.push('/documents')}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted/50"
          aria-label="Back to documents"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            JurisAI · Analysis
          </p>
          <h1 className="truncate font-serif text-[24px] leading-none text-foreground">
            {doc?.title ?? (isLoading ? 'Loading…' : 'Document')}
          </h1>

          {/* NEW, THIS SESSION — hearing date view/edit, only rendered
              once the document has actually loaded. */}
          {doc && (
            <div className="mt-2 flex items-center gap-2">
              <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              {isEditingHearingDate ? (
                <>
                  <input
                    type="date"
                    value={hearingDateInput}
                    onChange={(e) => setHearingDateInput(e.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-[12px] text-foreground focus:outline-none"
                  />
                  <button
                    onClick={handleSaveHearingDate}
                    disabled={isSavingHearingDate}
                    className="text-[12px] font-medium text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingHearingDate ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingHearingDate(false);
                      setHearingDateError(null);
                    }}
                    disabled={isSavingHearingDate}
                    className="text-[12px] text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[12px] text-muted-foreground">
                    {doc.hearing_date
                      ? `Hearing date: ${formatHearingDate(doc.hearing_date)}`
                      : 'No hearing date set'}
                  </span>
                  <button
                    onClick={handleStartEditHearingDate}
                    className="text-[12px] font-medium text-primary underline underline-offset-2"
                  >
                    {doc.hearing_date ? 'Change' : 'Set date'}
                  </button>
                </>
              )}
            </div>
          )}
          {hearingDateError && (
            <p className="mt-1 text-[12px] text-destructive">{hearingDateError}</p>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-[13px]">Loading analysis…</p>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 py-24 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-[13px]">{loadError}</p>
            <button
              onClick={loadEverything}
              className="text-[13px] font-medium underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : !analysis ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-24 text-muted-foreground">
            <FileText className="h-6 w-6" />
            <p className="text-[13px]">No analysis exists for this document yet.</p>
            <p className="max-w-sm text-center text-[12px]">
              This extracts the document's text and runs the first analysis
              pass. It can take up to a minute — the page will stay on this
              screen until it's done, there's no progress bar to watch.
            </p>
            <button
              onClick={handleStartAnalysis}
              disabled={isStartingAnalysis}
              className="mt-1 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStartingAnalysis ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {isStartingAnalysis ? 'Analyzing… this can take up to a minute' : 'Start Analysis'}
            </button>
            {startAnalysisError && (
              <p className="max-w-sm text-center text-[12px] text-destructive">
                {startAnalysisError}
              </p>
            )}
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-5 py-4">
              <div>
                <p className="text-[13px] font-medium text-foreground">PDF Report</p>
                <p className="text-[12px] text-muted-foreground">
                  {pdfExport
                    ? 'A report has already been generated — download it, or regenerate for the latest data.'
                    : 'Combines Clause Classification and Legal Health Score into a downloadable PDF.'}
                </p>
              </div>
              <button
                onClick={handleDownloadPdf}
                disabled={isGeneratingPdf || isFetchingPdfUrl}
                className="flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {(isGeneratingPdf || isFetchingPdfUrl) && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {isGeneratingPdf
                  ? 'Generating…'
                  : isFetchingPdfUrl
                    ? 'Preparing download…'
                    : pdfExport
                      ? 'Download PDF'
                      : 'Generate & Download'}
              </button>
            </div>
            {pdfError && (
              <p className="text-[12px] text-destructive">{pdfError}</p>
            )}

            {/* Legal Health Score */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <Scale className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">Legal Health Score</h2>
              </div>

              {healthScore?.status === 'completed' && healthScore.overall_score !== null ? (
                <div className="flex flex-col gap-5">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-[40px] font-semibold leading-none ${scoreColor(healthScore.overall_score)}`}>
                      {healthScore.overall_score}
                    </span>
                    <span className="text-[13px] text-muted-foreground">/ 100</span>
                  </div>

                  {healthScore.category_scores && (
                    <div className="grid grid-cols-2 gap-3">
                      {(Object.entries(healthScore.category_scores) as [string, number][]).map(
                        ([key, value]) => (
                          <div key={key} className="rounded-md border border-border p-3">
                            <div className="mb-1.5 flex items-center justify-between text-[12px]">
                              <span className="text-muted-foreground">
                                {key === 'negotiationLeverage'
                                  ? 'Negotiation Leverage'
                                  : key.charAt(0).toUpperCase() + key.slice(1)}
                              </span>
                              <span className={`font-medium ${scoreColor(value)}`}>{value}</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className={`h-full rounded-full ${scoreBg(value)}`}
                                style={{ width: `${value}%` }}
                              />
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}

                  {healthScore.result && (
                    <div className="flex flex-col gap-3">
                      {healthScore.result.categoryBreakdown.map((entry) => (
                        <div key={entry.category} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                          <p className="mb-1 text-[13px] font-medium text-foreground">
                            {CATEGORY_LABELS[entry.category] ?? entry.category}
                          </p>
                          <p className="text-[12px] leading-relaxed text-muted-foreground">
                            {entry.rationale}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : healthScore?.status === 'failed' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-destructive">
                    {healthScore.error_message ?? 'The last health score run failed.'}
                  </p>
                  <button
                    onClick={handleRunHealthScore}
                    disabled={isRunningHealthScore}
                    className="w-fit rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    No health score has been generated for this analysis yet.
                    This depends on four other Phase 2 modules having already
                    run — if any haven't, this may fail with a message naming
                    which one.
                  </p>
                  <button
                    onClick={handleRunHealthScore}
                    disabled={isRunningHealthScore}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunningHealthScore ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    {isRunningHealthScore ? 'Generating…' : 'Generate Health Score'}
                  </button>
                  {healthScoreError && (
                    <p className="text-[12px] text-destructive">{healthScoreError}</p>
                  )}
                </div>
              )}
            </section>

            {/* Clause Classification */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">Clause Classification</h2>
              </div>

              {classification?.status === 'completed' && classification.result ? (
                <div className="flex flex-col divide-y divide-border">
                  {classification.result.clauses
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((clause, i) => (
                      <div key={i} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {formatCategoryFallback(clause.category)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {Math.round(clause.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="text-[13px] leading-relaxed text-foreground">
                          {clause.excerpt}
                        </p>
                      </div>
                    ))}
                </div>
              ) : classification?.status === 'failed' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-destructive">
                    {classification.error_message ?? 'The last classification run failed.'}
                  </p>
                  <button
                    onClick={handleRunClassification}
                    disabled={isRunningClassification}
                    className="w-fit rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    No clause classification has been run for this analysis yet.
                  </p>
                  <button
                    onClick={handleRunClassification}
                    disabled={isRunningClassification}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunningClassification ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {isRunningClassification ? 'Classifying…' : 'Classify Clauses'}
                  </button>
                  {classificationError && (
                    <p className="text-[12px] text-destructive">{classificationError}</p>
                  )}
                </div>
              )}
            </section>

            {/* Risk Detection — NEW, THIS SESSION. First of the four
                deferred analysis-type triggers to get a real UI. Placed
                after Clause Classification since File 106's route
                requires a completed classification run as input. */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">Risk Detection</h2>
              </div>

              {riskDetection?.status === 'completed' && riskDetection.result ? (
                riskDetection.result.flags.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No risks were flagged for this document.
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-border">
                    {riskDetection.result.flags.map((flag, i) => (
                      <div key={i} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[flag.severity]}`}
                          >
                            {flag.severity.charAt(0).toUpperCase() + flag.severity.slice(1)}
                          </span>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {formatRiskType(flag.type)}
                          </span>
                          {flag.category && (
                            <span className="text-[11px] text-muted-foreground">
                              {formatCategoryFallback(flag.category)}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            {Math.round(flag.confidence * 100)}% confidence
                          </span>
                        </div>
                        {/* Optional per risk-detection.schemas.ts's own KEY
                            DECISION — a missing_clause flag has no excerpt
                            since the clause it describes isn't present. */}
                        {flag.excerpt && (
                          <p className="text-[13px] leading-relaxed text-foreground">
                            {flag.excerpt}
                          </p>
                        )}
                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                          {flag.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                )
              ) : riskDetection?.status === 'failed' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-destructive">
                    {riskDetection.error_message ?? 'The last risk detection run failed.'}
                  </p>
                  <button
                    onClick={handleRunRiskDetection}
                    disabled={isRunningRiskDetection}
                    className="w-fit rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    No risk detection has been run for this analysis yet. This depends on
                    Clause Classification having already completed.
                  </p>
                  <button
                    onClick={handleRunRiskDetection}
                    disabled={isRunningRiskDetection}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunningRiskDetection ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    )}
                    {isRunningRiskDetection ? 'Detecting risks…' : 'Detect Risks'}
                  </button>
                  {riskDetectionError && (
                    <p className="text-[12px] text-destructive">{riskDetectionError}</p>
                  )}
                </div>
              )}
            </section>

            {/* Missing Clause Detection — NEW, THIS SESSION. Second of
                the four deferred analysis-type triggers. Also depends
                on Clause Classification, same as Risk Detection —
                placed as its sibling, order between the two is
                arbitrary (neither depends on the other). */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <ListX className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">
                  Missing Clause Detection
                </h2>
              </div>

              {missingClauseDetection?.status === 'completed' && missingClauseDetection.result ? (
                missingClauseDetection.result.flags.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No expected clause categories appear to be missing from this document.
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-border">
                    {missingClauseDetection.result.flags.map((flag, i) => (
                      <div key={i} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[flag.importance]}`}
                          >
                            {flag.importance.charAt(0).toUpperCase() + flag.importance.slice(1)}
                          </span>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {formatCategoryFallback(flag.category)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {Math.round(flag.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                          {flag.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                )
              ) : missingClauseDetection?.status === 'failed' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-destructive">
                    {missingClauseDetection.error_message ??
                      'The last missing clause detection run failed.'}
                  </p>
                  <button
                    onClick={handleRunMissingClauseDetection}
                    disabled={isRunningMissingClauseDetection}
                    className="w-fit rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    No missing clause detection has been run for this analysis yet. This
                    depends on Clause Classification having already completed.
                  </p>
                  <button
                    onClick={handleRunMissingClauseDetection}
                    disabled={isRunningMissingClauseDetection}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunningMissingClauseDetection ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ListX className="h-3.5 w-3.5" />
                    )}
                    {isRunningMissingClauseDetection
                      ? 'Checking for gaps…'
                      : 'Detect Missing Clauses'}
                  </button>
                  {missingClauseDetectionError && (
                    <p className="text-[12px] text-destructive">{missingClauseDetectionError}</p>
                  )}
                </div>
              )}
            </section>

            {/* Compliance Detection — NEW, THIS SESSION. Third of the
                four deferred analysis-type triggers. Also depends only
                on Clause Classification, sibling to the two sections
                above. */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <Gavel className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">Compliance Detection</h2>
              </div>

              {complianceDetection?.status === 'completed' && complianceDetection.result ? (
                complianceDetection.result.flags.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No compliance issues were identified for this document.
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-border">
                    {complianceDetection.result.flags.map((flag, i) => (
                      <div key={i} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[flag.severity]}`}
                          >
                            {flag.severity.charAt(0).toUpperCase() + flag.severity.slice(1)}
                          </span>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {FRAMEWORK_LABELS[flag.framework]}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {COMPLIANCE_TYPE_LABELS[flag.type]}
                          </span>
                          {flag.category && (
                            <span className="text-[11px] text-muted-foreground">
                              {formatCategoryFallback(flag.category)}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground">
                            {Math.round(flag.confidence * 100)}% confidence
                          </span>
                        </div>
                        {/* Optional per compliance-detection.schemas.ts's
                            own KEY DECISION — only non_compliant_clause
                            issues have real clause text to quote. */}
                        {flag.excerpt && (
                          <p className="text-[13px] leading-relaxed text-foreground">
                            {flag.excerpt}
                          </p>
                        )}
                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                          {flag.explanation}
                        </p>
                      </div>
                    ))}
                  </div>
                )
              ) : complianceDetection?.status === 'failed' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-destructive">
                    {complianceDetection.error_message ?? 'The last compliance detection run failed.'}
                  </p>
                  <button
                    onClick={handleRunComplianceDetection}
                    disabled={isRunningComplianceDetection}
                    className="w-fit rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    No compliance detection has been run for this analysis yet. This depends
                    on Clause Classification having already completed.
                  </p>
                  <button
                    onClick={handleRunComplianceDetection}
                    disabled={isRunningComplianceDetection}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunningComplianceDetection ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Gavel className="h-3.5 w-3.5" />
                    )}
                    {isRunningComplianceDetection ? 'Checking compliance…' : 'Detect Compliance Issues'}
                  </button>
                  {complianceDetectionError && (
                    <p className="text-[12px] text-destructive">{complianceDetectionError}</p>
                  )}
                </div>
              )}
            </section>

            {/* AI Recommendation Engine — NEW, THIS SESSION. Last of the
                four deferred analysis-type triggers; File 161's original
                open item is fully closed with this section. Placed after
                all three detection sections (not alongside them as a
                sibling depending only on Clause Classification) since
                this is the one module that genuinely depends on all
                four upstream results being complete, not just
                classification. */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">AI Recommendations</h2>
              </div>

              {aiRecommendation?.status === 'completed' && aiRecommendation.result ? (
                aiRecommendation.result.recommendations.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No actionable recommendations were synthesized for this document.
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-border">
                    {aiRecommendation.result.recommendations.map((rec, i) => (
                      <div key={i} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[rec.priority]}`}
                          >
                            {rec.priority.charAt(0).toUpperCase() + rec.priority.slice(1)}
                          </span>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                            {formatRiskType(rec.actionType)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {Math.round(rec.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="text-[13px] font-medium leading-relaxed text-foreground">
                          {rec.title}
                        </p>
                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                          {rec.recommendation}
                        </p>
                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                          {rec.rationale}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {rec.sourceModules.map((mod) => (
                            <span
                              key={mod}
                              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {formatRiskType(mod)}
                            </span>
                          ))}
                        </div>
                        <p className="text-[11px] italic text-muted-foreground">
                          {rec.sourceSummary}
                        </p>
                      </div>
                    ))}
                  </div>
                )
              ) : aiRecommendation?.status === 'failed' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-destructive">
                    {aiRecommendation.error_message ??
                      'The last AI recommendation run failed.'}
                  </p>
                  <button
                    onClick={handleRunAIRecommendation}
                    disabled={isRunningAIRecommendation}
                    className="w-fit rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    No AI recommendations have been generated for this analysis yet. This
                    depends on Clause Classification, Risk Detection, Missing Clause
                    Detection, and Compliance Detection all having already completed.
                  </p>
                  <button
                    onClick={handleRunAIRecommendation}
                    disabled={isRunningAIRecommendation}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunningAIRecommendation ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Lightbulb className="h-3.5 w-3.5" />
                    )}
                    {isRunningAIRecommendation
                      ? 'Generating recommendations…'
                      : 'Generate Recommendations'}
                  </button>
                  {aiRecommendationError && (
                    <p className="text-[12px] text-destructive">{aiRecommendationError}</p>
                  )}
                </div>
              )}
            </section>

            {/* AI Legal Insights — NEW, THIS SESSION. Placed after AI
                Recommendations (not alongside the four detection-derived
                sections as a sibling) since this is the one module that
                depends on ALL SIX upstream results, including AI
                Recommendation Engine and Legal Health Score themselves —
                a strict superset of AI Recommendation Engine's own four
                prerequisites. Genuinely different rendering shape from
                every run-lifecycle section above: each item's content is
                free-text narrative synthesis, not a flag/recommendation
                object with a fixed set of typed fields to lay out in a
                fixed order — rendered as a lightweight card per insight
                (title + narrative), with sourceModules/sourceSummary/
                confidence as supporting metadata underneath, mirroring
                AI Recommendations' pill/paragraph layout for that
                metadata rather than inventing a new visual vocabulary
                for it. */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">AI Legal Insights</h2>
              </div>

              {aiLegalInsight?.status === 'completed' && aiLegalInsight.result ? (
                aiLegalInsight.result.insights.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    No cross-module insights were synthesized for this document.
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-border">
                    {aiLegalInsight.result.insights.map((insight, i) => (
                      <div key={i} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            {Math.round(insight.confidence * 100)}% confidence
                          </span>
                        </div>
                        <p className="text-[13px] font-medium leading-relaxed text-foreground">
                          {insight.title}
                        </p>
                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                          {insight.narrative}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {insight.sourceModules.map((mod) => (
                            <span
                              key={mod}
                              className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {formatRiskType(mod)}
                            </span>
                          ))}
                        </div>
                        <p className="text-[11px] italic text-muted-foreground">
                          {insight.sourceSummary}
                        </p>
                      </div>
                    ))}
                  </div>
                )
              ) : aiLegalInsight?.status === 'failed' ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-destructive">
                    {aiLegalInsight.error_message ?? 'The last AI legal insight run failed.'}
                  </p>
                  <button
                    onClick={handleRunAILegalInsight}
                    disabled={isRunningAILegalInsight}
                    className="w-fit rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
                  >
                    Try again
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    No AI legal insights have been generated for this analysis yet. This depends
                    on Clause Classification, Risk Detection, Missing Clause Detection,
                    Compliance Detection, AI Recommendation Engine, and Legal Health Score all
                    having already completed.
                  </p>
                  <button
                    onClick={handleRunAILegalInsight}
                    disabled={isRunningAILegalInsight}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunningAILegalInsight ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Brain className="h-3.5 w-3.5" />
                    )}
                    {isRunningAILegalInsight ? 'Generating insights…' : 'Generate Insights'}
                  </button>
                  {aiLegalInsightError && (
                    <p className="text-[12px] text-destructive">{aiLegalInsightError}</p>
                  )}
                </div>
              )}
            </section>

            {/* AI Legal Chat — NEW, THIS SESSION. Genuinely different
                shape from every section above: not a run-lifecycle
                panel (no single completed/failed/try-again state), but
                a live, ongoing conversation. Placed last, as its own
                section, rather than modeled after any sibling above. */}
            <section className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <h2 className="font-serif text-[18px] text-foreground">Ask About This Document</h2>
              </div>

              {!activeConversation ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-[13px] text-muted-foreground">
                    Start a conversation to ask questions about this document — its clauses,
                    risks, and the analysis above.
                  </p>
                  <button
                    onClick={handleStartConversation}
                    disabled={isStartingConversation}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isStartingConversation ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MessageCircle className="h-3.5 w-3.5" />
                    )}
                    {isStartingConversation ? 'Starting…' : 'Start Conversation'}
                  </button>
                  {startConversationError && (
                    <p className="text-[12px] text-destructive">{startConversationError}</p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex max-h-[480px] flex-col gap-3 overflow-y-auto">
                    {messages.length === 0 && !streamingAssistantText ? (
                      <p className="text-[13px] text-muted-foreground">
                        No messages yet. Ask a question to get started.
                      </p>
                    ) : (
                      messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex flex-col gap-1 rounded-lg px-3 py-2 text-[13px] leading-relaxed ${
                            message.role === 'user'
                              ? 'ml-8 bg-primary/10 text-foreground'
                              : 'mr-8 bg-muted text-foreground'
                          }`}
                        >
                          {message.content}
                        </div>
                      ))
                    )}

                    {/* Live streaming bubble — only rendered while a
                        reply is actively coming in. Not part of
                        `messages` (it isn't a real persisted row yet,
                        per File 153's own open item on mid-stream
                        failures not persisting a partial message). */}
                    {streamingAssistantText !== null && (
                      <div className="mr-8 flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-[13px] leading-relaxed text-foreground">
                        {streamingAssistantText || (
                          <span className="text-muted-foreground">Thinking…</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isSendingMessage) {
                          handleSendMessage();
                        }
                      }}
                      disabled={isSendingMessage}
                      placeholder="Ask a question about this document…"
                      maxLength={4000}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground disabled:opacity-60"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={isSendingMessage || chatInput.trim().length === 0}
                      className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSendingMessage ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                  {sendMessageError && (
                    <p className="text-[12px] text-destructive">{sendMessageError}</p>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
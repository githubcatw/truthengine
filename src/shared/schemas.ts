// The single shared Zod schema set used by both client and server.
// There are exactly two verdicts. Nothing in this file may add a third.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Binary verdict (PART 2)
// ---------------------------------------------------------------------------
export const VerdictSchema = z.enum(['CORRECT', 'WRONG']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const VerdictBasisSchema = z.enum(['established', 'contradicted', 'material_error', 'not_established']);
export type VerdictBasis = z.infer<typeof VerdictBasisSchema>;

export const WinnerSchema = z.enum(['DEFENDER', 'PROSECUTOR']);
export type Winner = z.infer<typeof WinnerSchema>;

/** CORRECT requires `established`; WRONG requires anything but `established`. */
export function isVerdictBasisConsistent(verdict: Verdict, basis: VerdictBasis): boolean {
  return verdict === 'CORRECT' ? basis === 'established' : basis !== 'established';
}

/** Defender wins → CORRECT; Prosecutor wins → WRONG. */
export function verdictForWinner(winner: Winner): Verdict {
  return winner === 'DEFENDER' ? 'CORRECT' : 'WRONG';
}

export const EvidenceStrengthSchema = z.enum(['Strong', 'Moderate', 'Limited']);
export type EvidenceStrength = z.infer<typeof EvidenceStrengthSchema>;

// ---------------------------------------------------------------------------
// Common enums
// ---------------------------------------------------------------------------
export const LanguageSchema = z.enum(['hy', 'en', 'ru']);
export type Language = z.infer<typeof LanguageSchema>;

export const RoleSchema = z.enum(['student', 'teacher', 'admin']);
export type Role = z.infer<typeof RoleSchema>;

export const SUBJECTS = [
  'armenian_history',
  'world_history',
  'armenian_language',
  'armenian_literature',
  'mathematics',
  'physics',
  'chemistry',
  'biology',
  'geography',
  'computer_science',
  'other',
] as const;
export const SubjectSchema = z.enum(SUBJECTS);
export type Subject = z.infer<typeof SubjectSchema>;

export const ClaimStatusSchema = z.enum(['pending_confirmation', 'confirmed', 'not_verifiable']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

/** Processing outcome of one claim inside a job. `research_failed` is a status, never a verdict. */
export const ClaimOutcomeSchema = z.enum(['pending', 'judged', 'research_failed', 'failed', 'skipped']);
export type ClaimOutcome = z.infer<typeof ClaimOutcomeSchema>;

export const ComplexityClassSchema = z.enum(['basic', 'standard', 'complex']);
export type ComplexityClass = z.infer<typeof ComplexityClassSchema>;
export const TimeSensitivitySchema = z.enum(['stable', 'time_sensitive']);
export type TimeSensitivity = z.infer<typeof TimeSensitivitySchema>;

export const JobStatusSchema = z.enum([
  'queued',
  'processing',
  'paused',
  'completed',
  'partially_completed',
  'research_failed',
  'failed',
  'cancelled',
  'superseded',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  'completed',
  'partially_completed',
  'research_failed',
  'failed',
  'cancelled',
  'superseded',
];

export const StageStatusSchema = z.enum(['pending', 'leased', 'completed', 'failed', 'skipped']);
export type StageStatus = z.infer<typeof StageStatusSchema>;

export const DebateModeSchema = z.enum(['fast', 'full']);
export type DebateMode = z.infer<typeof DebateModeSchema>;

export const AgentTypeSchema = z.enum([
  'content_extractor',
  'quality_auditor',
  'claim_extractor',
  'triage',
  'researcher',
  'defender',
  'prosecutor',
  'judge',
  'pedagogue',
]);
export type AgentType = z.infer<typeof AgentTypeSchema>;

// ---------------------------------------------------------------------------
// Evidence: three separate validation layers (PART 0.4 / 9)
// ---------------------------------------------------------------------------
// Layer A: technical provenance
export const ProvenanceStatusSchema = z.enum(['search_metadata_only', 'fetched', 'quote_verified', 'retrieval_failed']);
export type ProvenanceStatus = z.infer<typeof ProvenanceStatusSchema>;

export const RetrievalFailureReasonSchema = z.enum([
  'blocked_403',
  'rate_limited_429',
  'auth_required',
  'parse_error',
  'timeout',
  'not_found',
]);
export type RetrievalFailureReason = z.infer<typeof RetrievalFailureReasonSchema>;

/** Where a URL came from. The model itself is never a valid origin. */
export const UrlOriginSchema = z.enum(['grounding_metadata', 'fetched_page', 'trusted_registry', 'knowledge_base', 'classroom_material']);
export type UrlOrigin = z.infer<typeof UrlOriginSchema>;

// Layer B: source quality
export const QualityRatingSchema = z.enum(['high', 'medium', 'low']);
const RatedSchema = z.object({ rating: QualityRatingSchema, rationale: z.string().min(1).max(240) });
export const QualityAssessmentSchema = z.object({
  credibility: RatedSchema,
  currency: RatedSchema,
  methodology: RatedSchema,
  independence: RatedSchema,
  relevance: RatedSchema,
});
export type QualityAssessment = z.infer<typeof QualityAssessmentSchema>;

// Layer C: claim support
export const ClaimRelationSchema = z.enum(['supports', 'contradicts', 'context_only']);
export type ClaimRelation = z.infer<typeof ClaimRelationSchema>;
export const DirectnessSchema = z.enum(['direct', 'contextual']);
export type Directness = z.infer<typeof DirectnessSchema>;

export const SourceTypeSchema = z.enum(['book', 'paper', 'textbook', 'official', 'encyclopedia', 'news', 'other']);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const FoundByAgentSchema = z.enum(['researcher', 'defender', 'prosecutor']);
export type FoundByAgent = z.infer<typeof FoundByAgentSchema>;

export const EvidenceRecordSchema = z.object({
  evidenceId: z.string(), // E1, E2, ... unique within a claim
  claimId: z.string(),
  jobId: z.string(),
  userId: z.string(),
  foundByAgent: FoundByAgentSchema,
  sourceTitle: z.string().nullable(),
  sourceOrganization: z.string().nullable(),
  sourceUrl: z.string(),
  urlOrigin: UrlOriginSchema,
  domain: z.string(),
  sourceType: SourceTypeSchema,
  originalSourceId: z.string().nullable(),
  /** Verbatim excerpt: only non-null when provenanceStatus is `quote_verified`. */
  excerpt: z.string().nullable(),
  /** Search snippet or unverified text: a lead, never a quotation. */
  snippet: z.string().nullable(),
  excerptLocation: z.string().nullable(),
  publicationDate: z.string().nullable(),
  retrievalDate: z.string(),
  provenanceStatus: ProvenanceStatusSchema,
  failureReason: RetrievalFailureReasonSchema.nullable(),
  qualityAssessment: QualityAssessmentSchema.nullable(),
  /** The Researcher's label is provisional; Defender and Prosecutor re-evaluate it. */
  provisionalRelation: ClaimRelationSchema.nullable(),
  directness: DirectnessSchema.nullable(),
  conditionsMatch: z.boolean().nullable(),
  conditionsNote: z.string().nullable(),
  /** True when this record is not independent (repeats another source or exceeds the per-domain cap). */
  countsAsIndependent: z.boolean(),
  /** Listed in the trusted-sources registry. A preference signal only, never proof of correctness. */
  trustedSource: z.object({ sourceId: z.string(), name: z.string(), verificationStatus: z.enum(['unverified', 'verified_by_admin']) }).nullable(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;

/** fast: reuse saved queries and searches from similar earlier questions. detailed: plan and search afresh. */
export const ResearchModeSchema = z.enum(['fast', 'detailed']);
export type ResearchMode = z.infer<typeof ResearchModeSchema>;

export const ResearchActionSchema = z.enum([
  'search_query',
  'fetch_page',
  'read_pdf',
  'quote_verified',
  'retrieval_failed',
  'source_rejected',
  'research_stopped',
  'kb_lookup',
]);
export type ResearchAction = z.infer<typeof ResearchActionSchema>;

// ---------------------------------------------------------------------------
// Topic lock (PART 11.1)
// ---------------------------------------------------------------------------
export const TopicLockSchema = z.object({
  claimId: z.string().min(1),
  debateId: z.string().min(1),
  topicHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type TopicLock = z.infer<typeof TopicLockSchema>;

export const DebateTopicSchema = z.object({
  claimId: z.string(),
  debateId: z.string(),
  topicStatement: z.string(),
  originalText: z.string(),
  context: z.object({
    subject: SubjectSchema,
    language: LanguageSchema,
    gradeLevel: z.number().int().min(1).max(12).nullable(),
    surroundingExcerpt: z.string().nullable(),
    timeframe: z.string().nullable(),
    place: z.string().nullable(),
    population: z.string().nullable(),
  }),
  positions: z.object({
    defender: z.literal('argues the claim is CORRECT'),
    prosecutor: z.literal('argues the claim is WRONG'),
    judge: z.literal('neutral'),
  }),
  topicHash: z.string(),
});
export type DebateTopic = z.infer<typeof DebateTopicSchema>;

// ---------------------------------------------------------------------------
// Debate records
// ---------------------------------------------------------------------------
export const DebateSideSchema = z.enum(['defender', 'prosecutor']);
export type DebateSide = z.infer<typeof DebateSideSchema>;

export const DebateStepSchema = z.enum([
  'r1_initial',
  // fast mode
  'r2_challenge_reassess',
  'r3_response_final',
  // full mode
  'r2a_challenges',
  'r2b_responses',
  'r3_reassess',
  'r4_final',
]);
export type DebateStep = z.infer<typeof DebateStepSchema>;

export const FAST_STEPS: readonly DebateStep[] = ['r1_initial', 'r2_challenge_reassess', 'r3_response_final'];
export const FULL_STEPS: readonly DebateStep[] = ['r1_initial', 'r2a_challenges', 'r2b_responses', 'r3_reassess', 'r4_final'];
export const STEP_ROUND: Record<DebateStep, number> = {
  r1_initial: 1,
  r2_challenge_reassess: 2,
  r3_response_final: 3,
  r2a_challenges: 2,
  r2b_responses: 2,
  r3_reassess: 3,
  r4_final: 4,
};

export const MessageTypeSchema = z.enum([
  'argument',
  'evidence_assessment',
  'challenge',
  'response',
  'reassessment',
  'final_position',
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const StanceSchema = z.enum(['maintains', 'concedes']);
export type Stance = z.infer<typeof StanceSchema>;

export const ChallengeTypeSchema = z.enum([
  'unsupported',
  'contradicted',
  'irrelevant',
  'weak_source',
  'wrong_conditions',
  'overreach',
]);
export type ChallengeType = z.infer<typeof ChallengeTypeSchema>;

export const DebateMessageSchema = z.object({
  messageId: z.string(),
  debateId: z.string(),
  claimId: z.string(),
  jobId: z.string(),
  userId: z.string(),
  agentType: DebateSideSchema,
  roundNumber: z.number().int(),
  stepName: DebateStepSchema,
  messageType: MessageTypeSchema,
  argumentId: z.string().nullable(),
  referencedArgumentIds: z.array(z.string()),
  referencedEvidenceIds: z.array(z.string()),
  content: z.string(),
  /** Structured details (stance, flags, etc.) — always derived from validated agent output. */
  details: z.record(z.unknown()),
  unsupportedAssertion: z.boolean(),
  order: z.number().int(),
});
export type DebateMessage = z.infer<typeof DebateMessageSchema>;

export const RejectReasonSchema = z.enum(['unsupported', 'contradicted', 'irrelevant', 'weak_source', 'wrong_conditions']);

// ---------------------------------------------------------------------------
// Consistent API error shape
// ---------------------------------------------------------------------------
export const ApiErrorCodeSchema = z.enum([
  'GEMINI_NOT_CONFIGURED',
  'GEMINI_INVALID_KEY',
  'GEMINI_QUOTA_EXHAUSTED',
  'FIREBASE_NOT_CONFIGURED',
  'STORAGE_NOT_CONFIGURED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_INPUT',
  'CONFLICT',
  'RATE_LIMITED',
  'USAGE_LIMIT',
  'AI_OUTPUT_INVALID',
  'RESEARCH_FAILED',
  'UNSUPPORTED_FILE',
  'ENCRYPTED_FILE',
  'CORRUPTED_FILE',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export const ApiErrorSchema = z.object({ error: z.object({ code: ApiErrorCodeSchema, message: z.string() }) });

// ---------------------------------------------------------------------------
// Setup status (booleans only — never secret values)
// ---------------------------------------------------------------------------
const ServiceStatusSchema = z.object({ configured: z.boolean(), message: z.string().nullable() });
export const SetupStatusSchema = z.object({
  gemini: ServiceStatusSchema,
  firebase: ServiceStatusSchema,
  storage: ServiceStatusSchema,
});
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

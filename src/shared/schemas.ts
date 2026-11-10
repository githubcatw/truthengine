// The single shared Zod schema set used by both client and server.
// Later parts extend this file; nothing here may introduce a third verdict.
import { z } from 'zod';

// ---- Binary verdict (PART 2) ----
export const VerdictSchema = z.enum(['CORRECT', 'WRONG']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const VerdictBasisSchema = z.enum(['established', 'contradicted', 'material_error', 'not_established']);
export type VerdictBasis = z.infer<typeof VerdictBasisSchema>;

/** CORRECT requires `established`; WRONG requires anything but `established`. */
export function isVerdictBasisConsistent(verdict: Verdict, basis: VerdictBasis): boolean {
  return verdict === 'CORRECT' ? basis === 'established' : basis !== 'established';
}

// ---- Layer A: technical provenance (PART 0.4 / 9.2) ----
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

/** Where a URL came from. The model itself is never a valid origin (PART 0.5 rule 2). */
export const UrlOriginSchema = z.enum(['grounding_metadata', 'fetched_page', 'trusted_registry']);
export type UrlOrigin = z.infer<typeof UrlOriginSchema>;

// ---- Layer B: source quality ----
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

// ---- Layer C: claim support ----
export const ClaimRelationSchema = z.enum(['supports', 'contradicts', 'context_only']);
export const DirectnessSchema = z.enum(['direct', 'contextual']);

// ---- Topic lock identifiers carried by every agent output (PART 0.5 rule 7) ----
export const TopicLockSchema = z.object({
  claimId: z.string().min(1),
  debateId: z.string().min(1),
  topicHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type TopicLock = z.infer<typeof TopicLockSchema>;

// ---- Consistent API error shape ----
export const ApiErrorCodeSchema = z.enum([
  'GEMINI_NOT_CONFIGURED',
  'GEMINI_INVALID_KEY',
  'GEMINI_QUOTA_EXHAUSTED',
  'FIREBASE_NOT_CONFIGURED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_INPUT',
  'AI_OUTPUT_INVALID',
  'RESEARCH_FAILED',
  'INTERNAL',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export const ApiErrorSchema = z.object({ error: z.object({ code: ApiErrorCodeSchema, message: z.string() }) });

// ---- Setup status (booleans only — never secret values) ----
export const SetupStatusSchema = z.object({
  gemini: z.object({ configured: z.boolean(), message: z.string().nullable() }),
  firebase: z.object({ configured: z.boolean(), message: z.string().nullable() }),
  storage: z.object({ configured: z.boolean(), message: z.string().nullable() }),
});
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

// Structured output schemas for every agent. Agents return JSON validated by
// these schemas plus deterministic checks in src/server/validation.
import { z } from 'zod';
import {
  ChallengeTypeSchema,
  ClaimRelationSchema,
  ComplexityClassSchema,
  DirectnessSchema,
  EvidenceStrengthSchema,
  QualityAssessmentSchema,
  RejectReasonSchema,
  SourceTypeSchema,
  StanceSchema,
  SubjectSchema,
  TimeSensitivitySchema,
  TopicLockSchema,
  VerdictBasisSchema,
  VerdictSchema,
  WinnerSchema,
} from './schemas';

const str = (max: number) => z.string().trim().min(1).max(max);
const ids = (max: number) => z.array(z.string().min(1)).max(max);

// ---- Claim Extractor ----
export const ExtractedClaimSchema = z.object({
  originalText: str(800),
  normalizedText: str(400),
  category: SubjectSchema,
  verifiable: z.boolean(),
  notVerifiableReason: z.enum(['opinion', 'prediction', 'value_judgment', 'not_factual']).nullable(),
  ambiguityNote: str(300).nullable(),
  contextExcerpt: str(600).nullable(),
  timeframe: str(120).nullable(),
  place: str(120).nullable(),
  population: str(120).nullable(),
  importance: z.number().int().min(1).max(5),
  /** If this atomic claim was split from a compound sentence, the compound's text. */
  splitFrom: str(800).nullable(),
  /** True when the claim is about what a named person or organisation said, wrote, announced or decided. Defaults to false. */
  attributedStatement: z.boolean().default(false),
});
export const ClaimExtractionOutputSchema = z.object({
  detectedLanguage: z.enum(['hy', 'en', 'ru', 'other']),
  detectedSubject: SubjectSchema,
  claims: z.array(ExtractedClaimSchema).max(30),
});
export type ClaimExtractionOutput = z.infer<typeof ClaimExtractionOutputSchema>;

// ---- Triage ----
export const TriageOutputSchema = TopicLockSchema.extend({
  complexityClass: ComplexityClassSchema,
  timeSensitivity: TimeSensitivitySchema,
  rationale: str(300),
  queryLanguages: z.array(z.enum(['hy', 'en', 'ru'])).min(1).max(3),
});
export type TriageOutput = z.infer<typeof TriageOutputSchema>;

// ---- Evidence Researcher: query plan ----
export const ResearchTrackSchema = z.enum(['neutral', 'supporting', 'contradicting']);
export type ResearchTrack = z.infer<typeof ResearchTrackSchema>;
export const ResearchPlanOutputSchema = TopicLockSchema.extend({
  queries: z
    .array(z.object({ track: ResearchTrackSchema, query: str(200), language: z.enum(['hy', 'en', 'ru']) }))
    .min(1)
    .max(20),
});
export type ResearchPlanOutput = z.infer<typeof ResearchPlanOutputSchema>;

// ---- Evidence Researcher: per-source assessment of fetched content ----
export const SourceAssessmentSchema = z.object({
  sourceRef: z.string().regex(/^S\d+$/),
  usable: z.boolean(),
  rejectReason: str(200).nullable(),
  sourceTitle: str(300).nullable(),
  sourceOrganization: str(200).nullable(),
  sourceType: SourceTypeSchema,
  publicationDate: str(40).nullable(),
  /** Must be copied verbatim from one supplied passage; verified in code. */
  excerpt: str(700).nullable(),
  excerptPassageId: z.string().nullable(),
  /** If this source only repeats another primary source, name that source. */
  repeatsPrimarySource: str(200).nullable(),
  qualityAssessment: QualityAssessmentSchema.nullable(),
  provisionalRelation: ClaimRelationSchema.nullable(),
  directness: DirectnessSchema.nullable(),
  conditionsMatch: z.boolean().nullable(),
  conditionsNote: str(240).nullable(),
});
export const SourceAssessmentOutputSchema = TopicLockSchema.extend({
  sources: z.array(SourceAssessmentSchema).max(10),
});
export type SourceAssessmentOutput = z.infer<typeof SourceAssessmentOutputSchema>;

// ---- Defender / Prosecutor ----
export const AgentEvidenceAssessmentSchema = z.object({
  evidenceId: z.string(),
  relation: ClaimRelationSchema,
  directness: DirectnessSchema,
  conditionsMatch: z.boolean(),
  /** Verbatim passage from the evidence text the agent relies on; verified in code. */
  quotedPassage: str(400),
  note: str(240),
});

export const ArgumentDraftSchema = z.object({
  text: str(360),
  evidenceIds: ids(4),
});

export const InitialArgumentsOutputSchema = TopicLockSchema.extend({
  stance: StanceSchema,
  evidenceAssessments: z.array(AgentEvidenceAssessmentSchema).max(12),
  arguments: z.array(ArgumentDraftSchema).max(3),
  concessionNote: str(300).nullable(),
  summary: str(300),
});
export type InitialArgumentsOutput = z.infer<typeof InitialArgumentsOutputSchema>;

export const ChallengeDraftSchema = z.object({
  targetArgumentId: z.string().regex(/^[DP]-\d+$/),
  challengeType: ChallengeTypeSchema,
  text: str(360),
  evidenceIds: ids(4),
});
export const ResponseDraftSchema = z.object({
  challengeId: z.string(),
  accepts: z.boolean(),
  text: str(360),
  evidenceIds: ids(4),
});
export const ReassessmentSchema = z.object({
  stance: StanceSchema,
  survivedArgumentIds: ids(6),
  failedArgumentIds: ids(6),
  evidenceThatChangedView: ids(6),
  remainingDisagreements: z.array(str(240)).max(3),
  ownWeaknesses: z.array(str(240)).max(3),
  note: str(300),
});
export const FinalPositionSchema = z.object({
  stance: StanceSchema,
  finalAssessment: str(400),
  opponentStrongestArgumentId: z.string().regex(/^[DP]-\d+$/).nullable(),
  acknowledgement: str(300),
  evidenceIds: ids(4),
});

export const ChallengesOutputSchema = TopicLockSchema.extend({ challenges: z.array(ChallengeDraftSchema).max(3) });
export const ResponsesOutputSchema = TopicLockSchema.extend({ responses: z.array(ResponseDraftSchema).max(6) });
export const ReassessOutputSchema = TopicLockSchema.extend({ reassessment: ReassessmentSchema });
export const FinalOutputSchema = TopicLockSchema.extend({ final: FinalPositionSchema });
export const ChallengeReassessOutputSchema = TopicLockSchema.extend({
  challenges: z.array(ChallengeDraftSchema).max(3),
  reassessment: ReassessmentSchema,
});
export const ResponseFinalOutputSchema = TopicLockSchema.extend({
  responses: z.array(ResponseDraftSchema).max(6),
  final: FinalPositionSchema,
});

// ---- Independent Judge ----
const SideFindingsSchema = z.object({
  established: z.array(str(300)).max(4),
  failedToEstablish: z.array(str(300)).max(4),
});
const BelievabilityItemSchema = z.object({ text: str(300), evidenceIds: ids(4) });
export const JudgeOutputSchema = TopicLockSchema.extend({
  winner: WinnerSchema,
  verdict: VerdictSchema,
  verdictBasis: VerdictBasisSchema,
  /** The "because…" part of "I choose the Defender/Prosecutor because…". */
  reasoning: str(900),
  whatWasEstablished: z.array(str(300)).max(5),
  whatWasNotEstablished: z.array(str(300)).max(5),
  defender: SideFindingsSchema,
  prosecutor: SideFindingsSchema,
  decisiveEvidenceIds: ids(6).min(1),
  decisiveEvidenceRationale: str(600),
  acceptedArgumentIds: ids(12),
  rejectedArguments: z
    .array(z.object({ argumentId: z.string(), reason: RejectReasonSchema, note: str(240) }))
    .max(12),
  evidenceStrength: EvidenceStrengthSchema,
  limitations: z.array(str(300)).max(5),
  studentConclusion: str(500),
  believability: z.object({
    whyBelievable: z.array(BelievabilityItemSchema).max(3),
    whyMightBeWrong: z.array(BelievabilityItemSchema).max(3),
    canEstablish: z.array(BelievabilityItemSchema).max(3),
    cannotEstablish: z.array(BelievabilityItemSchema).max(3),
  }),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

// ---- Pedagogue (Phase 3) ----
export const PedagogueOutputSchema = TopicLockSchema.extend({
  explanation: str(1400),
  keyLesson: str(300),
  fallacies: z
    .array(z.object({ name: str(80), explanation: str(400), argumentId: z.string().nullable() }))
    .max(3),
  sourceEvaluationTips: z.array(z.object({ tip: str(300), evidenceId: z.string().nullable() })).max(4),
  exercises: z
    .array(
      z.object({
        question: str(300),
        options: z.array(str(200)).min(2).max(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: str(400),
        evidenceIds: ids(3),
      }),
    )
    .min(1)
    .max(3),
});
export type PedagogueOutput = z.infer<typeof PedagogueOutputSchema>;

// ---- Document Quality and Citation Auditor (Phase 2) ----
export const AuditCandidatesOutputSchema = z.object({
  references: z
    .array(
      z.object({
        passage: str(600),
        kind: z.enum(['book', 'paper', 'doi', 'url', 'author', 'other']),
        citationText: str(400),
        doi: z.string().max(200).nullable(),
        url: z.string().max(500).nullable(),
      }),
    )
    .max(15),
  quotations: z.array(z.object({ passage: str(600), quotedText: str(500), attributedTo: str(200).nullable() })).max(10),
  unsourcedFigures: z.array(z.object({ passage: str(600), explanation: str(300) })).max(10),
  contradictions: z.array(z.object({ passageA: str(600), passageB: str(600), explanation: str(300) })).max(5),
  editorial: z
    .array(
      z.object({
        passage: str(600),
        kind: z.enum(['vague', 'repetitive', 'filler', 'overconfident']),
        explanation: str(300),
      }),
    )
    .max(8),
});
export type AuditCandidatesOutput = z.infer<typeof AuditCandidatesOutputSchema>;

// ---- Content Extractor OCR (Phase 2) ----
export const OcrOutputSchema = z.object({
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1),
        text: z.string().max(20000),
        readable: z.boolean(),
        warning: z.string().max(300).nullable(),
      }),
    )
    .max(50),
  detectedLanguage: z.enum(['hy', 'en', 'ru', 'other']),
});
export type OcrOutput = z.infer<typeof OcrOutputSchema>;

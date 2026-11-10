// Investigation events (PART 14.2). Every event points to the stored record it
// represents; the animation and transcript render only these.
import { z } from 'zod';

export const EventTypeSchema = z.enum([
  'job_status',
  'stage_started',
  'stage_completed',
  'stage_failed',
  'stage_retry',
  'extraction_page',
  'claims_extracted',
  'quality_finding',
  'triage_completed',
  'research_log',
  'evidence_saved',
  'debate_message',
  'judge_decision',
  'pedagogue_lesson',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventRefSchema = z.object({
  collection: z.enum([
    'verificationJobs',
    'claims',
    'researchLog',
    'evidence',
    'debateMessages',
    'judgeDecisions',
    'qualityFindings',
    'extractionPages',
    'agentAnalyses',
    'educationalExplanations',
  ]),
  id: z.string(),
});

export const InvestigationEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  jobId: z.string(),
  userId: z.string(),
  type: EventTypeSchema,
  stageKey: z.string().nullable(),
  claimId: z.string().nullable(),
  agentType: z.string().nullable(),
  ref: EventRefSchema.nullable(),
  groupId: z.string().nullable(),
  /** Text copied from the referenced stored record (never invented). */
  summary: z.string().nullable(),
  data: z.record(z.unknown()),
  createdAtMs: z.number(),
});
export type InvestigationEvent = z.infer<typeof InvestigationEventSchema>;

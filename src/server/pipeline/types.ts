import type { Transaction } from 'firebase-admin/firestore';
import type {
  ClaimOutcome,
  ClaimStatus,
  ComplexityClass,
  DebateMode,
  JobStatus,
  Language,
  StageStatus,
  Subject,
  TimeSensitivity,
  Verdict,
} from '../../shared/schemas';
import type { GeminiClient } from '../ai/gemini';
import type { EventInput } from './store';

export interface JobDoc {
  jobId: string;
  submissionId: string;
  userId: string;
  status: JobStatus;
  currentStage: string;
  supersededBy: string | null;
  supersedes: string | null;
  /** "Run deeper investigation": larger budget and full debate mode. */
  deep: boolean;
  outputLanguage: Language;
  gradeLevel: number | null;
  sourceType: 'text' | 'document';
  fileId: string | null;
  classroomId: string | null;
  assignmentId: string | null;
  /** Claims carried over from a previous job (retry / deeper / topic edit) skip extraction. */
  prefilledClaims: boolean;
  confirmedAt: number | null;
  eventSeq: number;
  lastActivityAt: number;
  startedAtMs: number;
  completedAtMs: number | null;
  errorDetails: { code: string; message: string } | null;
  claimSummaries: Array<{ claimId: string; normalizedText: string; outcome: ClaimOutcome; verdict: Verdict | null }>;
  aiCalls: number;
}

export interface ClaimDoc {
  claimId: string;
  submissionId: string;
  jobId: string;
  userId: string;
  order: number;
  originalText: string;
  normalizedText: string;
  context: {
    surroundingExcerpt: string | null;
    timeframe: string | null;
    place: string | null;
    population: string | null;
    sourceLocation: string | null;
  };
  subject: Subject;
  language: Language;
  category: Subject;
  status: ClaimStatus;
  selected: boolean;
  notVerifiableReason: string | null;
  ambiguityNote: string | null;
  importance: number;
  splitFrom: string | null;
  complexityClass: ComplexityClass | null;
  timeSensitivity: TimeSensitivity | null;
  queryLanguages: Language[] | null;
  debateId: string | null;
  debateMode: DebateMode | null;
  topicHash: string | null;
  outcome: ClaimOutcome;
  verdict: Verdict | null;
  failure: { stageKey: string; code: string; message: string } | null;
  cacheKey: string;
}

export interface StageRunDoc {
  stageKey: string;
  status: StageStatus;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  attempts: number;
  nextRetryAt: number | null;
  startedAtMs: number | null;
  completedAtMs: number | null;
  durationMs: number | null;
  aiCalls: number;
  errorCode: string | null;
  errorMessage: string | null;
  outputRef: string | null;
}

export interface StageContext {
  job: JobDoc;
  claim: ClaimDoc | null;
  claims: ClaimDoc[];
  stageKey: string;
  gemini: () => GeminiClient;
  counter: { aiCalls: number };
  /** Persist a record plus its event immediately (live research log). */
  live: (apply: (tx: Transaction) => void, events: EventInput[]) => Promise<void>;
}

export interface StageResult {
  /** Writes committed atomically together with the stage completion. */
  apply?: (tx: Transaction) => void;
  events?: EventInput[];
  outputRef?: string | null;
  /** If set, the claim ends here with this outcome (e.g. research_failed). */
  claimOutcome?: { outcome: ClaimOutcome; failure?: ClaimDoc['failure'] };
}

export interface StageDef {
  key: string;
  deps: string[];
  claimId: string | null;
  /** Non-critical stages (pedagogue) do not fail their claim. */
  critical: boolean;
  /** Extra readiness condition beyond deps (used by finalize). */
  ready?: () => boolean;
  run: (ctx: StageContext) => Promise<StageResult>;
}

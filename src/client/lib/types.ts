// Client-side shapes of API responses (mirrors server records).
import type { ClaimOutcome, DebateMessage, EvidenceRecord, JobStatus, StageStatus, Verdict, VerdictBasis, Winner } from '../../shared/schemas';
import type { InvestigationEvent } from '../../shared/events';

export interface ClaimView {
  claimId: string;
  order: number;
  originalText: string;
  normalizedText: string;
  status: 'pending_confirmation' | 'confirmed' | 'not_verifiable';
  selected: boolean;
  notVerifiableReason: string | null;
  ambiguityNote: string | null;
  splitFrom: string | null;
  context?: { sourceLocation: string | null };
  subject: string;
  complexityClass: string | null;
  debateMode: 'fast' | 'full' | null;
  outcome: ClaimOutcome;
  verdict: Verdict | null;
  failure: { stageKey: string; code: string; message: string } | null;
}

export interface StageView {
  stageKey: string;
  status: StageStatus;
  attempts: number;
  durationMs: number | null;
  aiCalls: number;
  errorCode: string | null;
  errorMessage: string | null;
  errorDetail?: string | null;
  startedAtMs: number | null;
  nextRetryAt: number | null;
}

export interface JobView {
  job: {
    jobId: string;
    status: JobStatus;
    currentStage: string;
    supersededBy: string | null;
    confirmedAt: number | null;
    startedAtMs: number;
    completedAtMs: number | null;
    sourceType: 'text' | 'document';
    deep: boolean;
    errorDetails: { code: string; message: string } | null;
    claimSummaries: Array<{ claimId: string; normalizedText: string; outcome: ClaimOutcome; verdict: Verdict | null }>;
  };
  claims: ClaimView[];
  stages: StageView[];
  previousResults: Array<{ claimId: string; resultClaimId: string; verdict: Verdict; completedAtMs: number; timeSensitivity: string | null }>;
  readOnly?: boolean;
  ran?: string[];
  busy?: boolean;
}

export interface Decision {
  decisionId: string;
  winner: Winner;
  verdict: Verdict;
  verdictBasis: VerdictBasis;
  reasoning: string;
  whatWasEstablished: string[];
  whatWasNotEstablished: string[];
  defender: { established: string[]; failedToEstablish: string[] };
  prosecutor: { established: string[]; failedToEstablish: string[] };
  decisiveEvidenceIds: string[];
  decisiveEvidenceRationale: string;
  acceptedArgumentIds: string[];
  rejectedArguments: Array<{ argumentId: string; reason: string; note: string }>;
  evidenceStrength: 'Strong' | 'Moderate' | 'Limited';
  limitations: string[];
  studentConclusion: string;
  believability: Record<'whyBelievable' | 'whyMightBeWrong' | 'canEstablish' | 'cannotEstablish', Array<{ text: string; evidenceIds: string[] }>>;
  createdAtMs: number;
}

export interface Challenge {
  challengeId: string;
  challengerAgent: 'defender' | 'prosecutor';
  challengedArgumentId: string;
  challengeType: string;
  explanation: string;
  response: string | null;
  outcome: 'pending' | 'accepted' | 'rebutted' | 'unanswered';
}

export interface Report {
  claim: ClaimView & { userId: string; jobId: string; topicHash: string | null };
  job: { jobId: string; status: JobStatus; deep: boolean; startedAtMs: number; completedAtMs: number | null; submissionId: string };
  debate: { debateId: string; mode: 'fast' | 'full' | null; topic: { topicStatement: string; originalText: string; context: { subject: string } } } | null;
  evidence: EvidenceRecord[];
  messages: DebateMessage[];
  challenges: Challenge[];
  decision: Decision | null;
  result: { verdict: Verdict; verdictBasis: VerdictBasis; evidenceStrength: string; sourceCounts: { total: number; organizations: number; verified: number; independent: number }; completedAtMs: number } | null;
  explanation: { explanation: string; keyLesson: string; fallacies: Array<{ name: string; explanation: string; argumentId: string | null }>; sourceEvaluationTips: Array<{ tip: string; evidenceId: string | null }> } | null;
  exercises: Exercise[];
  research: Array<{ agentType: string; output: any }>;
  readOnly: boolean;
}

export interface Exercise {
  exerciseId: string;
  claimId: string;
  topicStatement: string;
  question: string;
  options: string[];
  correctIndex?: number;
  explanation: string;
  evidenceIds: string[];
  attempt: { selectedIndex: number; correct: boolean; atMs: number } | null;
}

export type { InvestigationEvent };

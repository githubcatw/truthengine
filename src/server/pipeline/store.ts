// Firestore access for the pipeline: collection names, deterministic IDs,
// atomic event sequencing, and the stage commit transaction.
import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { db } from '../firebase';
import type { EventType, InvestigationEvent } from '../../shared/events';

export const C = {
  users: 'users',
  submissions: 'submissions',
  jobs: 'verificationJobs',
  claims: 'claims',
  researchLog: 'researchLog',
  evidence: 'evidence',
  analyses: 'agentAnalyses',
  debates: 'debates',
  messages: 'debateMessages',
  challenges: 'argumentChallenges',
  decisions: 'judgeDecisions',
  results: 'verificationResults',
  searchCache: 'searchCache',
  pageCache: 'pageCache',
  auditLogs: 'auditLogs',
  files: 'submissionFiles',
  extractionPages: 'extractionPages',
  qualityFindings: 'qualityFindings',
  explanations: 'educationalExplanations',
  exercises: 'learningExercises',
  profiles: 'profiles',
  classrooms: 'classrooms',
  members: 'classroomMembers',
  assignments: 'assignments',
  trustedSources: 'trustedSources',
  // Imported credibility lists (Wikipedia perennial sources, DOAJ, EUvsDisinfo), one document per origin and host.
  sourceCredibility: 'sourceCredibility',
  notifications: 'notifications',
  receipts: 'verificationReceipts',
  // Knowledge base. Public and classroom passages live in separate collections so
  // a query can never mix them; classroom passages are always filtered by classroomId.
  kbPublic: 'kbPublic',
  kbSources: 'kbSources',
  kbClassroom: 'kbClassroom',
  materials: 'classroomMaterials',
  // Fast research mode: planned queries by claim, with the claim's embedding.
  planCache: 'planCache',
} as const;

export const col = (name: string) => db().collection(name);
export const jobRef = (jobId: string) => col(C.jobs).doc(jobId);
export const stageRef = (jobId: string, stageKey: string) => jobRef(jobId).collection('stageRuns').doc(stageDocId(stageKey));
export const eventsCol = (jobId: string) => jobRef(jobId).collection('events');

/** Stage keys contain ':' (e.g. research:{claimId}); Firestore IDs cannot contain '/'. */
export function stageDocId(stageKey: string): string {
  return stageKey.replace(/:/g, '__');
}

export const newId = () => col(C.jobs).doc().id;
export const hashId = (...parts: string[]) => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 28);
export const leaseOwnerId = () => randomUUID();

export interface EventInput {
  type: EventType;
  stageKey?: string | null;
  claimId?: string | null;
  agentType?: string | null;
  ref?: InvestigationEvent['ref'];
  groupId?: string | null;
  summary?: string | null;
  data?: Record<string, unknown>;
}

const padSeq = (n: number) => String(n).padStart(8, '0');

/**
 * Inside a transaction: reserve sequence numbers on the job document and write
 * the events. All reads must already have happened (Firestore rule), so the
 * caller passes the current eventSeq it read.
 */
export function writeEventsInTx(
  tx: Transaction,
  jobId: string,
  userId: string,
  currentSeq: number,
  events: EventInput[],
): number {
  let seq = currentSeq;
  const now = Date.now();
  for (const e of events) {
    seq += 1;
    const doc: InvestigationEvent = {
      seq,
      jobId,
      userId,
      type: e.type,
      stageKey: e.stageKey ?? null,
      claimId: e.claimId ?? null,
      agentType: e.agentType ?? null,
      ref: e.ref ?? null,
      groupId: e.groupId ?? null,
      summary: e.summary ? e.summary.slice(0, 600) : null,
      data: e.data ?? {},
      createdAtMs: now,
    };
    tx.set(eventsCol(jobId).doc(padSeq(seq)), doc);
  }
  if (events.length) tx.update(jobRef(jobId), { eventSeq: seq, lastEventAt: FieldValue.serverTimestamp() });
  return seq;
}

/** Writes records and their events atomically (used for live research log entries). */
export async function persistWithEvents(
  jobId: string,
  userId: string,
  apply: (tx: Transaction) => void,
  events: EventInput[],
): Promise<void> {
  await db().runTransaction(async (tx) => {
    const job = await tx.get(jobRef(jobId));
    const seq = (job.get('eventSeq') as number | undefined) ?? 0;
    apply(tx);
    writeEventsInTx(tx, jobId, userId, seq, events);
  });
}

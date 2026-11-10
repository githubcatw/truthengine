// The stage graph for a job (PART 10.3 / 11.2). Stages are derived from the
// stored job and claims, so the plan can always be recomputed after a restart.
import { FAST_STEPS, FULL_STEPS, type DebateStep } from '../../shared/schemas';
import { runAudit } from './handlers/audit';
import { runDebateStep } from './handlers/debate';
import { runExtractClaims } from './handlers/extractClaims';
import { runFinalize } from './handlers/finalize';
import { runJudge } from './handlers/judge';
import { runPedagogue } from './handlers/pedagogue';
import { runResearchPlan, runResearchRead, runResearchRefine, runResearchSearch } from './handlers/research';
import { runTriage } from './handlers/triage';
import type { ClaimDoc, JobDoc, StageDef, StageRunDoc } from './types';

export const stageKeys = {
  triage: (c: string) => `triage:${c}`,
  researchPlan: (c: string) => `research_plan:${c}`,
  researchSearch: (c: string) => `research_search:${c}`,
  researchRead: (c: string) => `research_read:${c}`,
  researchRefine: (c: string) => `research_refine:${c}`,
  debate: (c: string, step: DebateStep) => `debate:${c}:${step}`,
  judge: (c: string) => `judge:${c}`,
  pedagogue: (c: string) => `pedagogue:${c}`,
};

export function debateSteps(claim: ClaimDoc): readonly DebateStep[] {
  return claim.debateMode === 'full' ? FULL_STEPS : FAST_STEPS;
}

/** Claims that take part in verification after the student's confirmation. */
export function activeClaims(claims: ClaimDoc[]): ClaimDoc[] {
  return claims.filter((c) => c.status === 'confirmed' && c.selected);
}

export function isStageDone(run: StageRunDoc | undefined, critical = true): boolean {
  if (!run) return false;
  if (run.status === 'completed' || run.status === 'skipped') return true;
  return !critical && run.status === 'failed';
}

export function planStages(job: JobDoc, claims: ClaimDoc[], runs: Map<string, StageRunDoc>): StageDef[] {
  const defs: StageDef[] = [];
  if (!job.prefilledClaims) {
    defs.push({ key: 'extract_claims', deps: [], claimId: null, critical: true, run: runExtractClaims });
    if (job.sourceType === 'document') defs.push({ key: 'audit', deps: [], claimId: null, critical: false, run: runAudit });
  }
  if (!job.confirmedAt) return defs;

  const terminalKeys: string[] = [];
  for (const claim of activeClaims(claims)) {
    const c = claim.claimId;
    if (claim.outcome === 'failed' || claim.outcome === 'research_failed' || claim.outcome === 'skipped') continue;
    const chain: Array<{ key: string; run: StageDef['run']; critical?: boolean }> = [
      { key: stageKeys.triage(c), run: runTriage },
      { key: stageKeys.researchPlan(c), run: runResearchPlan },
      { key: stageKeys.researchSearch(c), run: runResearchSearch },
      { key: stageKeys.researchRead(c), run: runResearchRead },
      { key: stageKeys.researchRefine(c), run: runResearchRefine },
    ];
    // Debate mode is known only once triage has completed.
    if (claim.debateMode) {
      for (const step of debateSteps(claim)) chain.push({ key: stageKeys.debate(c, step), run: runDebateStep(step) });
      chain.push({ key: stageKeys.judge(c), run: runJudge });
      chain.push({ key: stageKeys.pedagogue(c), run: runPedagogue, critical: false });
    }
    let prev: string | null = job.prefilledClaims ? null : 'extract_claims';
    for (const s of chain) {
      defs.push({ key: s.key, deps: prev ? [prev] : [], claimId: c, critical: s.critical ?? true, run: s.run });
      prev = s.key;
    }
  }
  for (const claim of activeClaims(claims)) {
    if (claim.outcome === 'judged') terminalKeys.push(stageKeys.pedagogue(claim.claimId));
  }

  defs.push({
    key: 'finalize',
    deps: [],
    claimId: null,
    critical: true,
    run: runFinalize,
    ready: () => {
      const active = activeClaims(claims);
      if (active.some((c) => c.outcome === 'pending')) return false;
      if (!terminalKeys.every((k) => isStageDone(runs.get(k), false))) return false;
      if (job.sourceType === 'document' && !job.prefilledClaims && !isStageDone(runs.get('audit'), false)) return false;
      return true;
    },
  });
  return defs;
}

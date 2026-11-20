// Document Quality and Citation Audit (PART 8.2, Phase 2). Not an AI-authorship
// detector. Findings use cautious wording and are never verdicts.
import { AuditCandidatesOutputSchema } from '../../../shared/agents';
import { callStructured } from '../../ai/structured';
import { wrapUntrusted } from '../../ai/untrusted';
import { QUALITY_AUDITOR, SEARCH_ASSISTANT } from '../../agents/prompts';
import { AUDIT, MAX_OUTPUT_TOKENS, MODELS, TEMPERATURE } from '../../config';
import { fetchSource } from '../../research/fetcher';
import { tokenize } from '../../research/passages';
import { normalizeWhitespace, verifyExcerpt } from '../../validation/contract';
import { C, col, type EventInput } from '../store';
import type { StageContext, StageResult } from '../types';

export const FINDING_LABELS = {
  reference_unverified: 'Reference could not be independently verified',
  quotation_unverified: 'Quotation could not be verified',
  source_not_identified: 'Source not identified',
  internal_contradiction: 'Internal contradiction',
  editorial_observation: 'Editorial observation',
} as const;
export type FindingKind = keyof typeof FINDING_LABELS;

export interface QualityFinding {
  findingId: string;
  jobId: string;
  submissionId: string;
  userId: string;
  classroomId: string | null;
  kind: FindingKind;
  label: string;
  passage: string;
  passageB: string | null;
  explanation: string;
  severity: 'low' | 'medium' | 'high';
  check: { performed: string; result: string };
  offerAsClaim: boolean;
}

async function crossrefExists(doi: string): Promise<'found' | 'not_found' | 'unavailable'> {
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi.trim())}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'TruthEngineClassroom/1.0' },
    });
    if (res.status === 200) return 'found';
    if (res.status === 404) return 'not_found';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** A cited work counts as found only if most of its distinctive words appear in a search result's title or snippet. */
export function citationMatches(citation: string, candidates: string[]): boolean {
  const words = [...new Set(tokenize(citation).filter((w) => w.length >= 4))];
  if (!words.length) return false;
  return candidates.some((c) => {
    const hay = new Set(tokenize(c));
    return words.filter((w) => hay.has(w)).length / words.length >= 0.6;
  });
}

export async function runAudit(ctx: StageContext): Promise<StageResult> {
  const sub = await col(C.submissions).doc(ctx.job.submissionId).get();
  const text: string = sub.get('originalText') ?? '';
  const doc = normalizeWhitespace(text);
  const inDoc = (p: string) => doc.includes(normalizeWhitespace(p));

  const { value } = await callStructured({
    client: ctx.gemini(),
    schema: AuditCandidatesOutputSchema,
    model: MODELS.fast,
    systemInstruction: QUALITY_AUDITOR,
    prompt: `DOCUMENT:\n${wrapUntrusted('user_document', text.slice(0, 60_000))}`,
    temperature: TEMPERATURE.extraction,
    maxOutputTokens: MAX_OUTPUT_TOKENS.audit,
    counter: ctx.counter,
    postValidate: (v) => {
      const passages = [
        ...v.references.map((r) => r.passage),
        ...v.quotations.map((q) => q.passage),
        ...v.unsourcedFigures.map((f) => f.passage),
        ...v.contradictions.flatMap((c) => [c.passageA, c.passageB]),
        ...v.editorial.map((e) => e.passage),
      ];
      const missing = passages.filter((p) => !inDoc(p));
      return missing.length ? `Every passage must be copied exactly from the document; not found: ${missing.slice(0, 3).map((m) => JSON.stringify(m.slice(0, 60))).join(', ')}` : null;
    },
  });

  const base = {
    jobId: ctx.job.jobId,
    submissionId: ctx.job.submissionId,
    userId: ctx.job.userId,
    classroomId: ctx.job.classroomId,
  };
  const findings: Omit<QualityFinding, 'findingId'>[] = [];

  const search = async (q: string) => {
    const r = await ctx.gemini().generate({
      model: MODELS.fast,
      systemInstruction: SEARCH_ASSISTANT,
      prompt: `Search query: ${q}`,
      temperature: 0,
      maxOutputTokens: 512,
      googleSearch: true,
    });
    ctx.counter.aiCalls++;
    return r.groundingSources;
  };

  // References
  await Promise.all(
    value.references.slice(0, AUDIT.maxReferencesChecked).map(async (r) => {
      let performed: string;
      let result: string;
      let found = false;
      if (r.doi) {
        performed = `Crossref lookup for DOI ${r.doi}`;
        const status = await crossrefExists(r.doi);
        found = status === 'found';
        result = status === 'found' ? 'Found in Crossref.' : status === 'not_found' ? 'Crossref has no record for this DOI.' : 'Crossref could not be reached.';
      } else if (r.url) {
        performed = `URL check for ${r.url}`;
        const outcome = await fetchSource(r.url);
        found = outcome.ok;
        result = outcome.ok ? 'The page was retrieved.' : `The page could not be retrieved (${outcome.reason}).`;
      } else {
        performed = `Web search for: ${r.citationText}`;
        const sources = await search(r.citationText).catch(() => null);
        found = Boolean(sources && citationMatches(r.citationText, sources.flatMap((s) => [s.title ?? '', ...s.snippets])));
        result = sources === null ? 'The search could not be run.' : found ? 'A matching result was found.' : 'No matching result was found.';
      }
      if (!found) {
        findings.push({
          ...base,
          kind: 'reference_unverified',
          label: FINDING_LABELS.reference_unverified,
          passage: r.passage,
          passageB: null,
          explanation: `The cited ${r.kind} "${r.citationText}" could not be independently verified. This does not mean it is fake.`,
          severity: 'medium',
          check: { performed, result },
          offerAsClaim: false,
        });
      }
    }),
  );

  // Quotations
  await Promise.all(
    value.quotations.slice(0, AUDIT.maxQuotationsChecked).map(async (q) => {
      const performed = `Web search for the quoted passage, then a verbatim check in up to 3 retrieved pages`;
      let found = false;
      let result = 'The quotation was not located.';
      const sources = await search(`"${q.quotedText.slice(0, 200)}"`).catch(() => null);
      if (sources === null) result = 'The search could not be run.';
      for (const s of (sources ?? []).slice(0, 3)) {
        const page = await fetchSource(s.uri);
        if (page.ok && verifyExcerpt(q.quotedText, page.pages.map((p) => p.text).join('\n'), 10).verified) {
          found = true;
          result = `Located verbatim at ${page.finalUrl}.`;
          break;
        }
      }
      if (!found) {
        findings.push({
          ...base,
          kind: 'quotation_unverified',
          label: FINDING_LABELS.quotation_unverified,
          passage: q.passage,
          passageB: null,
          explanation: `The quoted passage${q.attributedTo ? ` attributed to ${q.attributedTo}` : ''} could not be verified. This does not mean it was invented.`,
          severity: 'medium',
          check: { performed, result },
          offerAsClaim: false,
        });
      }
    }),
  );

  for (const f of value.unsourcedFigures) {
    findings.push({
      ...base,
      kind: 'source_not_identified',
      label: FINDING_LABELS.source_not_identified,
      passage: f.passage,
      passageB: null,
      explanation: f.explanation,
      severity: 'medium',
      check: { performed: 'Searched the document for a citation supporting this figure.', result: 'No traceable source was given in the document.' },
      offerAsClaim: true,
    });
  }
  for (const c of value.contradictions) {
    findings.push({
      ...base,
      kind: 'internal_contradiction',
      label: FINDING_LABELS.internal_contradiction,
      passage: c.passageA,
      passageB: c.passageB,
      explanation: c.explanation,
      severity: 'high',
      check: { performed: 'Compared statements within the document.', result: 'The two passages conflict.' },
      offerAsClaim: false,
    });
  }
  for (const e of value.editorial) {
    findings.push({
      ...base,
      kind: 'editorial_observation',
      label: FINDING_LABELS.editorial_observation,
      passage: e.passage,
      passageB: null,
      explanation: e.explanation,
      severity: 'low',
      check: { performed: `Editorial reading (${e.kind} wording).`, result: 'Editorial note only; not evidence of fabrication.' },
      offerAsClaim: false,
    });
  }

  const withIds: QualityFinding[] = findings.map((f, i) => ({ ...f, findingId: `${ctx.job.jobId}_f${i + 1}` }));
  const events: EventInput[] = withIds.map((f) => ({
    type: 'quality_finding',
    agentType: 'quality_auditor',
    ref: { collection: 'qualityFindings', id: f.findingId },
    summary: `${f.label}: ${f.passage}`,
    data: { kind: f.kind, severity: f.severity },
  }));
  return {
    outputRef: `qualityFindings:${withIds.length}`,
    apply: (tx) => {
      for (const f of withIds) tx.set(col(C.qualityFindings).doc(f.findingId), { ...f, createdAtMs: Date.now() });
    },
    events,
  };
}

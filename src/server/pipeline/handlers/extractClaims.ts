// Claim Extractor stage (PART 7.3). Long documents are chunked, claims are
// extracted from all chunks, deduplicated and ranked; the student then confirms.
import { FieldValue } from 'firebase-admin/firestore';
import { ClaimExtractionOutputSchema, type ClaimExtractionOutput } from '../../../shared/agents';
import type { Language, Subject } from '../../../shared/schemas';
import { callStructured } from '../../ai/structured';
import { wrapUntrusted } from '../../ai/untrusted';
import { CLAIM_EXTRACTOR } from '../../agents/prompts';
import { MAX_OUTPUT_TOKENS, MODELS, PIPELINE, TEMPERATURE } from '../../config';
import { AppError } from '../../errors';
import { normalizeWhitespace } from '../../validation/contract';
import { C, col, hashId } from '../store';
import type { ClaimDoc, StageContext, StageResult } from '../types';

const CHUNK_CHARS = 8_000;

export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  const paras = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > size) {
      chunks.push(cur);
      cur = '';
    }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

const dedupeKey = (s: string) => normalizeWhitespace(s).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');

/** Cache key for "previously verified" lookups (PART 10.7): claim, context, subject, language. */
export function claimCacheKey(c: { normalizedText: string; subject: string; language: string; context: ClaimDoc['context'] }) {
  return hashId(dedupeKey(c.normalizedText), c.subject, c.language, c.context.timeframe ?? '', c.context.place ?? '', c.context.population ?? '');
}

export async function runExtractClaims(ctx: StageContext): Promise<StageResult> {
  const sub = await col(C.submissions).doc(ctx.job.submissionId).get();
  const text: string = sub.get('originalText') ?? '';
  if (!text.trim()) throw new AppError('INVALID_INPUT', 'The submission has no text to verify.');
  const normalizedDoc = normalizeWhitespace(text);
  // Preserve source locations (PART 8.1): which document page each claim came from.
  const pageTexts = ctx.job.fileId
    ? (await col(C.extractionPages).where('fileId', '==', ctx.job.fileId).get()).docs
        .map((d) => ({ page: d.get('pageNumber') as number, text: normalizeWhitespace((d.get('text') as string) ?? '') }))
        .filter((p) => p.text)
    : [];
  const pageOf = (original: string) => {
    const needle = normalizeWhitespace(original);
    return pageTexts.find((p) => p.text.includes(needle))?.page ?? null;
  };

  const chunks = chunkText(text);
  const outputs: ClaimExtractionOutput[] = [];
  for (let i = 0; i < chunks.length; i += PIPELINE.claimConcurrency) {
    const batch = chunks.slice(i, i + PIPELINE.claimConcurrency);
    const results = await Promise.all(
      batch.map(async (chunk, j) => {
        const { value } = await callStructured({
          client: ctx.gemini(),
          schema: ClaimExtractionOutputSchema,
          model: MODELS.fast,
          systemInstruction: CLAIM_EXTRACTOR,
          prompt: `DOCUMENT CHUNK ${i + j + 1} of ${chunks.length}:\n${wrapUntrusted('user_document', chunk)}`,
          temperature: TEMPERATURE.extraction,
          maxOutputTokens: MAX_OUTPUT_TOKENS.extraction,
          counter: ctx.counter,
          postValidate: (v) => {
            const missing = v.claims.filter((c) => !normalizedDoc.includes(normalizeWhitespace(c.originalText)));
            return missing.length
              ? `originalText must be copied exactly from the document; not found: ${missing.map((m) => JSON.stringify(m.originalText.slice(0, 80))).join(', ')}`
              : null;
          },
        });
        return value;
      }),
    );
    outputs.push(...results);
  }

  // Deduplicate across chunks and rank: verifiable first, then importance, then document order.
  const seen = new Set<string>();
  const all = outputs.flatMap((o) => o.claims).filter((c) => {
    const k = dedupeKey(c.normalizedText);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const position = (c: (typeof all)[number]) => normalizedDoc.indexOf(normalizeWhitespace(c.originalText));
  const verifiable = all.filter((c) => c.verifiable).sort((a, b) => b.importance - a.importance || position(a) - position(b));
  const notVerifiable = all.filter((c) => !c.verifiable);
  const subject: Subject = (sub.get('subject') as Subject | null) ?? outputs[0]?.detectedSubject ?? 'other';
  const detected = outputs[0]?.detectedLanguage;
  const language: Language = (sub.get('language') as Language | null) ?? (detected && detected !== 'other' ? detected : ctx.job.outputLanguage);
  const kept = [...verifiable.slice(0, PIPELINE.defaultMaxClaims * 2), ...notVerifiable.slice(0, PIPELINE.defaultMaxClaims)];

  const claims: ClaimDoc[] = kept.map((c, i) => {
    const claimId = `${ctx.job.jobId}_c${i + 1}`;
    const context = {
      surroundingExcerpt: c.contextExcerpt,
      timeframe: c.timeframe,
      place: c.place,
      population: c.population,
      sourceLocation: pageOf(c.originalText) ? `page ${pageOf(c.originalText)}` : null,
    };
    const claimSubject = c.category === 'other' ? subject : c.category;
    return {
      claimId,
      submissionId: ctx.job.submissionId,
      jobId: ctx.job.jobId,
      userId: ctx.job.userId,
      order: i,
      originalText: c.originalText,
      normalizedText: c.normalizedText,
      context,
      subject: claimSubject,
      language,
      category: c.category,
      status: c.verifiable ? 'pending_confirmation' : 'not_verifiable',
      // Default selection: the top-ranked checkable claims, up to the configured maximum.
      selected: c.verifiable && verifiable.indexOf(c) < PIPELINE.defaultMaxClaims,
      notVerifiableReason: c.notVerifiableReason,
      ambiguityNote: c.ambiguityNote,
      importance: c.importance,
      splitFrom: c.splitFrom,
      attributionClaim: c.attributedStatement,
      complexityClass: null,
      timeSensitivity: null,
      queryLanguages: null,
      debateId: null,
      debateMode: null,
      topicHash: null,
      outcome: 'pending',
      verdict: null,
      failure: null,
      cacheKey: claimCacheKey({ normalizedText: c.normalizedText, subject: claimSubject, language, context }),
    };
  });

  return {
    outputRef: `claims:${claims.length}`,
    apply: (tx) => {
      for (const c of claims) tx.set(col(C.claims).doc(c.claimId), { ...c, createdAt: FieldValue.serverTimestamp() });
      tx.update(col(C.submissions).doc(ctx.job.submissionId), { subject, language });
    },
    events: [
      {
        type: 'claims_extracted',
        agentType: 'claim_extractor',
        summary: claims.length
          ? claims.filter((c) => c.status !== 'not_verifiable').map((c) => c.normalizedText).join(' • ')
          : null,
        data: {
          claimIds: claims.map((c) => c.claimId),
          verifiable: claims.filter((c) => c.status !== 'not_verifiable').length,
          notVerifiable: claims.filter((c) => c.status === 'not_verifiable').length,
        },
      },
    ],
  };
}

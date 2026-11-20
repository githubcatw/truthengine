// Evidence research (PART 9). The neutral Researcher, plus the Defender's and
// Prosecutor's position-specific tracks, run concurrently inside each stage.
// Stages: plan → search → read → refine (stop when sufficient or budget is spent).
import type { Transaction } from 'firebase-admin/firestore';
import {
  ResearchPlanOutputSchema,
  SourceAssessmentOutputSchema,
  type ResearchTrack,
  type SourceAssessmentOutput,
} from '../../../shared/agents';
import type { EvidenceRecord, FoundByAgent, Language, ResearchAction, RetrievalFailureReason } from '../../../shared/schemas';
import { agentCall } from '../../agents/call';
import { RESEARCH_PLANNER, SEARCH_ASSISTANT, SOURCE_ASSESSOR, render } from '../../agents/prompts';
import { wrapUntrusted } from '../../ai/untrusted';
import { AppError } from '../../errors';
import { DEEP_BUDGET_MULTIPLIER, MAX_OUTPUT_TOKENS, MODELS, RESEARCH, RESEARCH_BUDGETS, TEMPERATURE, type ResearchBudget } from '../../config';
import { getCachedPage, getCachedSearch, putCachedPage, putCachedSearch } from '../../research/cache';
import { findSimilarPlan, findSimilarSearch, putPlan, tryEmbed } from '../../research/semanticCache';
import { fetchSource, type FetchOutcome, type FetchedPage } from '../../research/fetcher';
import { indexPublicSource } from '../../kb/store';
import { kbLooksStrong, retrieveForClaim, type KbSource } from '../../kb/retrieve';
import { buildTerms, selectPassages, type Passage } from '../../research/passages';
import { trustedSourceFor } from '../../research/registry';
import { policiesFor } from '../../research/credibility/store';
import { effectiveTier, isEvidenceGrade, type SourcePolicy } from '../../../shared/credibility';
import { normalizeWhitespace, verifyExcerpt } from '../../validation/contract';
import { C, col, type EventInput } from '../store';
import { loadTopic } from '../topic';
import type { ClaimDoc, StageContext, StageResult } from '../types';
import type { DebateTopic } from '../../../shared/schemas';

// ---------------------------------------------------------------------------
// State kept between research stages (one agentAnalyses document per claim)
// ---------------------------------------------------------------------------
export interface Lead {
  url: string;
  title: string | null;
  snippets: string[];
  track: ResearchTrack;
  query: string;
  language: Language;
}

export interface ResearchState {
  plan: Array<{ track: ResearchTrack; query: string; language: Language }>;
  executedQueries: string[];
  leads: Lead[];
  readUrls: string[];
  used: { searches: number; pages: number; pdfPages: number; aiCalls: number };
  nextEvidenceNumber: number;
  stopReason: string | null;
  /** Stored passages found before any web search. `consumed` once they have been assessed. */
  kb?: { sources: KbSource[]; consumed: boolean; webSkipped: boolean };
}

interface Prepared {
  ref: string;
  lead: Lead;
  page: FetchedPage;
  passages: Passage[];
  kb?: KbSource;
}

const stateId = (claimId: string) => `${claimId}_research_state`;
const TRACK_AGENT: Record<ResearchTrack, FoundByAgent> = { neutral: 'researcher', supporting: 'defender', contradicting: 'prosecutor' };

/** Fast mode reuses saved work from similar questions. A deeper investigation never does. */
export function isFast(ctx: StageContext): boolean {
  return !ctx.job.deep && (ctx.job.researchMode ?? 'detailed') === 'fast';
}

export function budgetFor(claim: ClaimDoc, deep: boolean): ResearchBudget {
  const base = RESEARCH_BUDGETS[claim.complexityClass ?? 'standard'];
  if (!deep) return base;
  const m = (n: number) => Math.round(n * DEEP_BUDGET_MULTIPLIER);
  return {
    targetIndependentSources: base.targetIndependentSources,
    maxSearches: m(base.maxSearches),
    maxPagesFetched: m(base.maxPagesFetched),
    maxPdfPages: m(base.maxPdfPages),
    maxAiCalls: m(base.maxAiCalls),
  };
}

async function loadState(claimId: string): Promise<ResearchState> {
  const snap = await col(C.analyses).doc(stateId(claimId)).get();
  if (!snap.exists) throw new AppError('INTERNAL', 'Research state is missing for this claim.');
  return snap.get('structuredOutput') as ResearchState;
}

function writeState(tx: Transaction, ctx: StageContext, state: ResearchState) {
  const claim = ctx.claim!;
  tx.set(col(C.analyses).doc(stateId(claim.claimId)), {
    analysisId: stateId(claim.claimId),
    claimId: claim.claimId,
    jobId: ctx.job.jobId,
    userId: ctx.job.userId,
    agentType: 'researcher',
    stageKey: ctx.stageKey,
    structuredOutput: state,
    status: 'completed',
    createdAtMs: Date.now(),
  });
}

/** Writes one researchLog entry and its event immediately, as the action happens. */
async function logAction(
  ctx: StageContext,
  entry: {
    agentType: FoundByAgent;
    action: ResearchAction;
    queryOrUrl: string;
    resultSummary: string;
    failureReason?: RetrievalFailureReason | null;
    groupId?: string;
    /** Structured facts the interface turns into a localized sentence (no prose). */
    details?: Record<string, unknown>;
  },
) {
  const claim = ctx.claim!;
  const ref = col(C.researchLog).doc();
  const doc = {
    logId: ref.id,
    claimId: claim.claimId,
    jobId: ctx.job.jobId,
    userId: ctx.job.userId,
    agentType: entry.agentType,
    action: entry.action,
    queryOrUrl: entry.queryOrUrl,
    resultSummary: entry.resultSummary.slice(0, 500),
    failureReason: entry.failureReason ?? null,
    details: entry.details ?? {},
    timestampMs: Date.now(),
  };
  await ctx.live(
    (tx) => tx.set(ref, doc),
    [
      {
        type: 'research_log',
        agentType: entry.agentType,
        ref: { collection: 'researchLog', id: ref.id },
        groupId: entry.groupId ?? ctx.stageKey,
        summary: `${entry.queryOrUrl} — ${doc.resultSummary}`,
        data: { action: entry.action, failureReason: doc.failureReason, queryOrUrl: entry.queryOrUrl, ...(entry.details ?? {}) },
      },
    ],
  );
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'unknown';
  }
};

// ---------------------------------------------------------------------------
// Query planning
// ---------------------------------------------------------------------------
async function planQueries(ctx: StageContext, topic: DebateTopic, maxQueries: number, alreadyFound: string | null) {
  const claim = ctx.claim!;
  const out = await agentCall({
    ctx,
    topic,
    schema: ResearchPlanOutputSchema,
    model: MODELS.fast,
    system: render(RESEARCH_PLANNER, {
      MAX_QUERIES: String(maxQueries),
      ALREADY_FOUND: alreadyFound ? `Sources already found (look for different, independent sources):\n${alreadyFound}` : '',
    }),
    body: `QUERY_LANGUAGES: ${(claim.queryLanguages ?? [claim.language]).join(', ')}\nPlan the search queries.`,
    temperature: TEMPERATURE.research,
    maxOutputTokens: MAX_OUTPUT_TOKENS.research,
  });
  return out.queries.slice(0, maxQueries);
}

// ---------------------------------------------------------------------------
// Search (Gemini Google Search grounding). Only grounding-metadata URLs are kept.
// ---------------------------------------------------------------------------
async function runSearches(ctx: StageContext, queries: ResearchState['plan'], state: ResearchState, budget: ResearchBudget) {
  const claim = ctx.claim!;
  const sensitivity = claim.timeSensitivity ?? 'time_sensitive';
  const allowed = queries.filter((q) => !state.executedQueries.includes(q.query)).slice(0, Math.max(0, budget.maxSearches - state.used.searches));
  const leads: Lead[] = [];
  // One embedding call for all queries. Always stored, so later fast-mode runs can find these searches;
  // only fast mode (and never a deeper investigation) reads from it.
  const fast = isFast(ctx);
  const vectors = await tryEmbed(ctx.gemini(), allowed.map((q) => q.query));
  await pool(allowed, RESEARCH.searchConcurrency, async (q, qi) => {
    state.used.searches++;
    state.executedQueries.push(q.query);
    const agentType = TRACK_AGENT[q.track];
    const vector = vectors?.[qi] ?? null;
    let sources;
    let cached = false;
    let similar: { matchedQuery: string; similarity: number } | null = null;
    try {
      const exact = await getCachedSearch(q.query, q.language);
      const near = !exact && fast && vector ? await findSimilarSearch(vector, q.query, q.language, sensitivity) : null;
      const hit = exact ?? near;
      if (hit) {
        sources = hit.sources;
        cached = true;
        if (near) similar = { matchedQuery: near.matchedQuery, similarity: near.similarity };
      } else {
        const res = await ctx.gemini().generate({
          model: MODELS.fast,
          systemInstruction: SEARCH_ASSISTANT,
          prompt: `Search query: ${q.query}`,
          temperature: TEMPERATURE.research,
          maxOutputTokens: 1024,
          googleSearch: true,
        });
        ctx.counter.aiCalls++;
        sources = res.groundingSources;
        // Time-sensitive subjects get a short TTL; fast-changing ones are effectively not reused.
        await putCachedSearch(q.query, q.language, sensitivity, { sources, webSearchQueries: res.webSearchQueries }, vector);
      }
    } catch (err) {
      if (err instanceof AppError && ['GEMINI_NOT_CONFIGURED', 'GEMINI_INVALID_KEY'].includes(err.code)) throw err;
      await logAction(ctx, { agentType, action: 'search_query', queryOrUrl: q.query, resultSummary: 'The search request failed.', details: { kind: 'search_failed', query: q.query } });
      return;
    }
    for (const s of sources) leads.push({ url: s.uri, title: s.title, snippets: s.snippets, track: q.track, query: q.query, language: q.language });
    await logAction(ctx, {
      agentType,
      action: 'search_query',
      queryOrUrl: q.query,
      resultSummary: sources.length
        ? `${sources.length} result(s)${cached ? ' (cached search)' : ''}: ${sources.map((s) => s.title ?? hostOf(s.uri)).join('; ')}`
        : 'No results.',
      details: { kind: 'search', query: q.query, cached, semantic: Boolean(similar), matchedQuery: similar?.matchedQuery ?? null, sites: [...new Set(sources.map((s) => (s.title && /\./.test(s.title) ? s.title : hostOf(s.uri))))] },
    });
  });
  // Merge into state without duplicate URLs.
  const known = new Set(state.leads.map((l) => l.url));
  for (const l of leads) {
    if (!known.has(l.url)) {
      known.add(l.url);
      state.leads.push(l);
    }
  }
}

// ---------------------------------------------------------------------------
// Read: fetch, preselect passages, assess (layers B and C), verify excerpts (layer A)
// ---------------------------------------------------------------------------
interface ReadOutput {
  records: EvidenceRecord[];
}

/** Reading order by what the credibility database says about the site: sources that can be evidence first, context-only sites last. */
export function leadRank(policy: SourcePolicy | null | undefined, attributionClaim: boolean): number {
  if (!isEvidenceGrade(policy, attributionClaim)) return 2;
  return policy?.tier === 'high' ? 0 : 1;
}

/**
 * Interleaves tracks so the pool stays balanced between neutral, supporting and contradicting leads.
 * Within a track, better-ranked sites are read first, so a small page budget is not spent on social posts.
 */
function chooseLeads(leads: Lead[], n: number, rank: (lead: Lead) => number = () => 0): Lead[] {
  const byTrack: Record<ResearchTrack, Lead[]> = { neutral: [], supporting: [], contradicting: [] };
  for (const l of [...leads].sort((a, b) => rank(a) - rank(b))) byTrack[l.track].push(l);
  const out: Lead[] = [];
  const order: ResearchTrack[] = ['neutral', 'supporting', 'contradicting'];
  while (out.length < n && order.some((t) => byTrack[t].length)) {
    for (const t of order) {
      const l = byTrack[t].shift();
      if (l && out.length < n) out.push(l);
    }
  }
  return out;
}

async function fetchWithCache(url: string, sensitivity: 'stable' | 'time_sensitive'): Promise<{ outcome: FetchOutcome; cached: boolean }> {
  const hit = await getCachedPage(url);
  if (hit) return { outcome: hit, cached: true };
  const outcome = await fetchSource(url);
  if (outcome.ok) {
    await putCachedPage(url, sensitivity, outcome, RESEARCH.maxStoredPageChars);
    if (outcome.finalUrl !== url) await putCachedPage(outcome.finalUrl, sensitivity, outcome, RESEARCH.maxStoredPageChars);
  }
  return { outcome, cached: false };
}

async function readLeads(
  ctx: StageContext,
  topic: DebateTopic,
  state: ResearchState,
  budget: ResearchBudget,
  existing: EvidenceRecord[],
): Promise<ReadOutput> {
  const claim = ctx.claim!;
  const sensitivity = claim.timeSensitivity ?? 'time_sensitive';
  const unread = state.leads.filter((l) => !state.readUrls.includes(l.url));
  const pagesLeft = Math.max(0, budget.maxPagesFetched - state.used.pages);
  const attributionClaim = claim.attributionClaim ?? false;
  const leadPolicies = await policiesFor(unread.map((l) => hostOf(l.url)));
  const toRead = chooseLeads(unread, pagesLeft, (l) => leadRank(leadPolicies.get(hostOf(l.url)), attributionClaim));
  const records: EvidenceRecord[] = [];
  const now = new Date().toISOString();
  const domainCount = new Map<string, number>();
  for (const e of existing) if (e.provenanceStatus !== 'retrieval_failed') domainCount.set(e.domain, (domainCount.get(e.domain) ?? 0) + 1);

  const nextId = () => `E${state.nextEvidenceNumber++}`;
  const baseRecord = (lead: Lead): Omit<EvidenceRecord, 'evidenceId' | 'provenanceStatus'> => ({
    claimId: claim.claimId,
    jobId: ctx.job.jobId,
    userId: ctx.job.userId,
    foundByAgent: TRACK_AGENT[lead.track],
    sourceTitle: lead.title,
    sourceOrganization: null,
    sourceUrl: lead.url,
    urlOrigin: 'grounding_metadata',
    domain: hostOf(lead.url),
    sourceType: 'other',
    originalSourceId: null,
    excerpt: null,
    snippet: lead.snippets.join(' … ').slice(0, 600) || null,
    excerptLocation: null,
    publicationDate: null,
    retrievalDate: now,
    failureReason: null,
    qualityAssessment: null,
    provisionalRelation: null,
    directness: null,
    conditionsMatch: null,
    conditionsNote: null,
    countsAsIndependent: false,
    trustedSource: null,
    sourcePolicy: null,
  });

  // 1. Fetch concurrently within the page budget.
  const fetched: Array<{ lead: Lead; page: FetchedPage; cached: boolean }> = [];
  await pool(toRead, RESEARCH.fetchConcurrency, async (lead) => {
    state.readUrls.push(lead.url);
    state.used.pages++;
    const agentType = TRACK_AGENT[lead.track];
    const { outcome, cached } = await fetchWithCache(lead.url, sensitivity);
    if (!outcome.ok) {
      records.push({ ...baseRecord(lead), sourcePolicy: leadPolicies.get(hostOf(lead.url)) ?? null, evidenceId: '', provenanceStatus: 'retrieval_failed', failureReason: outcome.reason });
      await logAction(ctx, {
        agentType,
        action: 'retrieval_failed',
        queryOrUrl: outcome.finalUrl ?? lead.url,
        resultSummary: `Could not retrieve the source (${outcome.reason}: ${outcome.detail}).`,
        failureReason: outcome.reason,
        details: { kind: 'retrieval_failed', host: hostOf(outcome.finalUrl ?? lead.url), url: outcome.finalUrl ?? lead.url },
      });
      return;
    }
    const domain = hostOf(outcome.finalUrl);
    if ((domainCount.get(domain) ?? 0) >= RESEARCH.maxEvidencePerDomain) {
      await logAction(ctx, {
        agentType,
        action: 'source_rejected',
        queryOrUrl: outcome.finalUrl,
        resultSummary: `Skipped: already ${RESEARCH.maxEvidencePerDomain} sources from ${domain} (independence limit).`,
        details: { kind: 'domain_limit', host: domain, url: outcome.finalUrl, limit: RESEARCH.maxEvidencePerDomain },
      });
      return;
    }
    domainCount.set(domain, (domainCount.get(domain) ?? 0) + 1);
    fetched.push({ lead, page: outcome, cached });
    await logAction(ctx, {
      agentType,
      action: outcome.kind === 'pdf' ? 'read_pdf' : 'fetch_page',
      queryOrUrl: outcome.finalUrl,
      resultSummary: `Retrieved ${outcome.kind.toUpperCase()}${cached ? ' (cached copy)' : ''}${outcome.title ? `: ${outcome.title}` : ''}${outcome.kind === 'pdf' ? `, ${outcome.pages.length} page(s)` : ''}.`,
      details: { kind: 'fetched', host: domain, url: outcome.finalUrl, format: outcome.kind, title: outcome.title, pages: outcome.kind === 'pdf' ? outcome.pages.length : null, cached },
    });
  });

  // Public pages fetched for a stable claim are added to the knowledge base while the assessment runs.
  const indexing =
    sensitivity === 'stable'
      ? Promise.allSettled(
          fetched
            .filter((f) => !f.cached)
            .map((f) => indexPublicSource(ctx.gemini(), { url: f.page.finalUrl, title: f.page.title, kind: 'web', pages: f.page.pages })),
        )
      : Promise.resolve([]);

  // 2. Preselect passages deterministically and assess in batches.
  const terms = buildTerms([topic.topicStatement, topic.originalText, ...state.executedQueries]);
  const prepared: Prepared[] = fetched.map(({ lead, page }, i) => {
    const ref = `S${i + 1}`;
    const pdfLeft = Math.max(1, budget.maxPdfPages - state.used.pdfPages);
    const { passages, pagesRead } = selectPassages(ref, page.pages, terms, page.kind === 'pdf' ? Math.min(pdfLeft, 10) : 1);
    if (page.kind === 'pdf') state.used.pdfPages += pagesRead;
    return { ref, lead, page, passages };
  });
  // Stored passages need no fetch. They go through the same assessment and excerpt check as fetched pages.
  if (state.kb && !state.kb.consumed) {
    state.kb.consumed = true;
    for (const src of state.kb.sources) {
      if ((domainCount.get(src.domain) ?? 0) >= RESEARCH.maxEvidencePerDomain) continue;
      domainCount.set(src.domain, (domainCount.get(src.domain) ?? 0) + 1);
      const ref = `S${prepared.length + 1}`;
      const lead: Lead = { url: src.url, title: src.title, snippets: [], track: 'neutral', query: '', language: claim.language };
      const passages = src.passages.map((p, j) => ({ id: `${ref}-P${j + 1}`, page: p.page, text: p.text }));
      const page: FetchedPage = { ok: true, requestedUrl: src.url, finalUrl: src.url, title: src.title, kind: 'text', pages: passages.map((p) => ({ page: p.page, text: p.text })) };
      prepared.push({ ref, lead, page, passages, kb: src });
    }
  }
  const registry = new Map<string, Awaited<ReturnType<typeof trustedSourceFor>>>();
  for (const p of prepared) registry.set(p.ref, p.kb ? (p.kb.host ? await trustedSourceFor(p.kb.host) : null) : await trustedSourceFor(hostOf(p.page.finalUrl)));
  // The credibility database's opinion of each site (teacher materials are not websites and have none).
  const policyHost = (p: Prepared): string | null => (p.kb ? p.kb.host : hostOf(p.page.finalUrl));
  const preparedPolicies = await policiesFor(prepared.flatMap((p) => (policyHost(p) ? [policyHost(p)!] : [])));
  const policyOf = (p: Prepared): SourcePolicy | null => (policyHost(p) ? preparedPolicies.get(policyHost(p)!) ?? null : null);
  const policyLine = (p: Prepared): string[] => {
    if (p.kb?.scope === 'classroom') return [];
    const pol = policyOf(p);
    return [
      pol
        ? `credibility policy (a ceiling for your rating): ${pol.tier} credibility, ${pol.use === 'context_only' ? 'CONTEXT ONLY' : 'may be evidence'}. ${pol.note}${pol.stateOwned ? ' State-owned media: look for the owner’s interests in how the topic is covered.' : ''}`
        : 'credibility policy: none (site not in the database); rate it on its content and do not rate it high',
    ];
  };
  const batches: Prepared[][] = [];
  for (let i = 0; i < prepared.length; i += RESEARCH.sourcesPerAssessmentCall) batches.push(prepared.slice(i, i + RESEARCH.sourcesPerAssessmentCall));

  const assessments = await Promise.all(
    batches.map(async (batch) => {
      if (state.used.aiCalls + ctx.counter.aiCalls >= budget.maxAiCalls) return null;
      const refs = new Set(batch.map((b) => b.ref));
      const passageOwner = new Map<string, string>(batch.flatMap((b) => b.passages.map((p) => [p.id, b.ref] as [string, string])));
      const body = batch
        .map((b) =>
          [
            `SOURCE ${b.ref}`,
            `url: ${b.page.finalUrl}`,
            `page title: ${b.page.title ?? b.lead.title ?? 'unknown'}`,
            `content type: ${b.page.kind}`,
            ...(b.kb
              ? [
                  b.kb.scope === 'classroom'
                    ? 'origin: material uploaded by the classroom teacher, not a public web page; judge it as a teaching document'
                    : `origin: stored copy of a public page, fetched ${new Date(b.kb.fetchedAtMs).toISOString().slice(0, 10)}; the page may have changed since`,
                ]
              : []),
            ...(registry.get(b.ref) ? [`listed in the trusted-sources registry as "${registry.get(b.ref)!.name}" (${registry.get(b.ref)!.verificationStatus}); this is a preference signal only and never proves the claim`] : []),
            ...policyLine(b),
            'PASSAGES:',
            ...b.passages.map((p) => `[${p.id}${p.page ? `, page ${p.page}` : ''}]\n${wrapUntrusted('web_page', p.text, p.id)}`),
          ].join('\n'),
        )
        .join('\n\n');
      return agentCall({
        ctx,
        topic,
        schema: SourceAssessmentOutputSchema,
        model: MODELS.fast,
        system: SOURCE_ASSESSOR,
        body: `${body}\n\nAssess every source: ${[...refs].join(', ')}.`,
        temperature: TEMPERATURE.research,
        maxOutputTokens: MAX_OUTPUT_TOKENS.research,
        postValidate: (v: SourceAssessmentOutput) => {
          const unknown = v.sources.filter((s) => !refs.has(s.sourceRef)).map((s) => s.sourceRef);
          if (unknown.length) return `Unknown sourceRef: ${unknown.join(', ')}`;
          const wrongPassage = v.sources.filter((s) => s.excerptPassageId && passageOwner.get(s.excerptPassageId) !== s.sourceRef);
          if (wrongPassage.length) return `excerptPassageId must belong to the same source: ${wrongPassage.map((s) => s.sourceRef).join(', ')}`;
          return null;
        },
      });
    }),
  );

  // 3. Build evidence records. Only text found verbatim in fetched content becomes an excerpt.
  const assessedRefs = new Set<string>();
  for (let bi = 0; bi < batches.length; bi++) {
    const out = assessments[bi];
    for (const b of batches[bi]!) {
      const a = out?.sources.find((s) => s.sourceRef === b.ref);
      const agentType = TRACK_AGENT[b.lead.track];
      const domain = b.kb ? b.kb.domain : hostOf(b.page.finalUrl);
      const trustedSource = b.kb ? (b.kb.host ? await trustedSourceFor(b.kb.host) : null) : await trustedSourceFor(domain);
      const base = {
        ...baseRecord(b.lead),
        sourceUrl: b.page.finalUrl,
        urlOrigin: (b.kb ? (b.kb.scope === 'classroom' ? 'classroom_material' : 'knowledge_base') : 'fetched_page') as EvidenceRecord['urlOrigin'],
        // Stored passages show when the text was actually fetched or uploaded, not today's date.
        ...(b.kb ? { retrievalDate: new Date(b.kb.fetchedAtMs).toISOString() } : {}),
        domain,
        sourceTitle: b.page.title ?? b.lead.title,
        trustedSource,
        sourcePolicy: b.kb?.scope === 'classroom' ? null : policyOf(b),
      };
      if (!a) {
        // Not assessed (AI-call budget exhausted): keep as retrieved content without a verified excerpt.
        records.push({ ...base, evidenceId: '', provenanceStatus: 'fetched' });
        continue;
      }
      assessedRefs.add(b.ref);
      if (!a.usable) {
        await logAction(ctx, {
          agentType,
          action: 'source_rejected',
          queryOrUrl: b.page.finalUrl,
          resultSummary: `Rejected: ${a.rejectReason ?? 'not relevant to the claim'}`,
          // rejectReason is written by the model in the output language.
          details: { kind: 'rejected', host: hostOf(b.page.finalUrl), url: b.page.finalUrl, note: a.rejectReason },
        });
        continue;
      }
      const fullText = b.page.pages.map((p) => p.text).join('\n');
      const passage: Passage | undefined = b.passages.find((p) => p.id === a.excerptPassageId);
      const check = a.excerpt ? verifyExcerpt(a.excerpt, fullText) : { verified: false, offset: null };
      const verified = check.verified;
      const record: EvidenceRecord = {
        ...base,
        evidenceId: '',
        sourceTitle: a.sourceTitle ?? base.sourceTitle,
        sourceOrganization: a.sourceOrganization,
        sourceType: a.sourceType,
        publicationDate: a.publicationDate,
        originalSourceId: a.repeatsPrimarySource,
        excerpt: verified ? normalizeWhitespace(a.excerpt!) : null,
        excerptLocation: verified ? (passage?.page ? `page ${passage.page}` : `offset ${check.offset}`) : null,
        provenanceStatus: verified ? 'quote_verified' : 'fetched',
        qualityAssessment: a.qualityAssessment,
        provisionalRelation: a.provisionalRelation,
        directness: a.directness,
        conditionsMatch: a.conditionsMatch,
        conditionsNote: a.conditionsNote,
      };
      records.push(record);
      await logAction(ctx, {
        agentType,
        action: verified ? 'quote_verified' : 'source_rejected',
        queryOrUrl: b.page.finalUrl,
        resultSummary: verified
          ? `Excerpt verified in the retrieved content${record.excerptLocation ? ` (${record.excerptLocation})` : ''}.`
          : 'The proposed excerpt was not found verbatim in the retrieved content, so it is not shown as a quotation.',
        details: verified
          ? { kind: 'verified', host: domain, url: b.page.finalUrl, location: record.excerptLocation, evidenceId: null, contextOnly: record.sourcePolicy?.use === 'context_only' }
          : { kind: 'not_verbatim', host: domain, url: b.page.finalUrl },
      });
    }
  }

  // 4. A few unread leads stay visible as unverified search results (layer A: search_metadata_only).
  const leftover = unread.filter((l) => !toRead.includes(l)).slice(0, 4);
  for (const l of leftover) records.push({ ...baseRecord(l), sourcePolicy: leadPolicies.get(hostOf(l.url)) ?? null, evidenceId: '', provenanceStatus: 'search_metadata_only' });

  for (const r of records) r.evidenceId = nextId();
  await indexing;
  return { records };
}

/** Independence: distinct domains among verified records that do not merely repeat another source. Context-only sites never count. */
export function independentCount(records: EvidenceRecord[], attributionClaim = false): number {
  return new Set(
    records.filter((r) => r.provenanceStatus === 'quote_verified' && !r.originalSourceId && isEvidenceGrade(r.sourcePolicy, attributionClaim)).map((r) => r.domain),
  ).size;
}

function markIndependence(records: EvidenceRecord[], attributionClaim = false): void {
  const seenDomain = new Set<string>();
  for (const r of records) {
    r.countsAsIndependent =
      r.provenanceStatus === 'quote_verified' && !r.originalSourceId && isEvidenceGrade(r.sourcePolicy, attributionClaim) && !seenDomain.has(r.domain);
    if (r.countsAsIndependent) seenDomain.add(r.domain);
  }
}

function evidenceWrites(tx: Transaction, records: EvidenceRecord[]) {
  for (const r of records) tx.set(col(C.evidence).doc(`${r.claimId}_${r.evidenceId}`), { ...r, createdAtMs: Date.now() });
}

function evidenceEvents(records: EvidenceRecord[]): EventInput[] {
  return records.map((r) => ({
    type: 'evidence_saved' as const,
    agentType: r.foundByAgent,
    ref: { collection: 'evidence' as const, id: `${r.claimId}_${r.evidenceId}` },
    summary: r.excerpt ?? r.sourceTitle ?? r.sourceUrl,
    data: { evidenceId: r.evidenceId, provenanceStatus: r.provenanceStatus, domain: r.domain, title: r.sourceTitle },
  }));
}

export async function loadEvidence(claimId: string): Promise<EvidenceRecord[]> {
  const snap = await col(C.evidence).where('claimId', '==', claimId).get();
  return snap.docs
    .map((d) => d.data() as EvidenceRecord)
    .sort((a, b) => Number(a.evidenceId.slice(1)) - Number(b.evidenceId.slice(1)));
}

// ---------------------------------------------------------------------------
// Stage handlers
// ---------------------------------------------------------------------------
export async function runResearchPlan(ctx: StageContext): Promise<StageResult> {
  const claim = ctx.claim!;
  const topic = await loadTopic(claim);
  const budget = budgetFor(claim, ctx.job.deep);
  // First round: 3 to 6 queries (PART 9.1), within the search budget.
  const maxQueries = Math.max(3, Math.min(6, Math.floor(budget.maxSearches / 2)));

  // Look in the knowledge base first. Teacher materials are searched only with the classroom of this
  // job; they are never described to the query planner, because planned queries go to a web search.
  const sensitivity = claim.timeSensitivity ?? 'time_sensitive';
  const classroomId = ctx.job.classroomId;
  const kbAttempted = sensitivity === 'stable' || Boolean(classroomId);
  const fast = isFast(ctx);
  const [kbSources, claimVector] = await Promise.all([
    retrieveForClaim(ctx.gemini(), { queries: [topic.topicStatement, topic.originalText], classroomId, timeSensitivity: sensitivity }),
    tryEmbed(ctx.gemini(), [topic.topicStatement]).then((v) => v?.[0] ?? null),
  ]);
  // Stored pages from context-only sites (Wikipedia) cannot satisfy the target, so they never justify skipping the web.
  const kbPolicies = await policiesFor(kbSources.flatMap((s) => (s.host ? [s.host] : [])));
  const kbEvidence = kbSources.filter((s) => !s.host || isEvidenceGrade(kbPolicies.get(s.host), claim.attributionClaim ?? false));
  const webSkipped = kbLooksStrong(kbEvidence, budget.targetIndependentSources);
  const publicFound = kbSources.filter((s) => s.scope === 'public').map((s) => `- ${s.title ?? s.host} (${s.domain})`).join('\n');
  let plan: ResearchState['plan'] = [];
  if (!webSkipped) {
    // Fast mode: a similar earlier claim's queries replace the planner call. Only a plan made with no
    // knowledge-base context is stored or reused, so it never depends on what one classroom or user had stored.
    const reused = fast && claimVector && !publicFound ? await findSimilarPlan(claimVector, topic.topicStatement, claim.language) : null;
    if (reused) {
      plan = reused.queries.slice(0, maxQueries);
      await logAction(ctx, {
        agentType: 'researcher',
        action: 'search_query',
        queryOrUrl: topic.topicStatement,
        resultSummary: `Reused ${plan.length} search queries from a similar earlier question.`,
        details: { kind: 'plan_cached', queries: plan.length, similarity: Math.round(reused.similarity * 100) },
      });
    } else {
      plan = await planQueries(ctx, topic, maxQueries, publicFound || null);
      if (claimVector && !publicFound) await putPlan(topic.topicStatement, claim.language, plan, claimVector);
    }
  }
  if (kbAttempted) {
    const publicCount = kbSources.filter((s) => s.scope === 'public').length;
    const classroomCount = kbSources.length - publicCount;
    await logAction(ctx, {
      agentType: 'researcher',
      action: 'kb_lookup',
      queryOrUrl: topic.topicStatement,
      resultSummary: `Knowledge base: ${publicCount} stored public source(s), ${classroomCount} classroom material(s)${webSkipped ? '; first web search skipped' : ''}.`,
      details: { kind: 'kb', publicSources: publicCount, classroomSources: classroomCount, webSkipped },
    });
  }
  const state: ResearchState = {
    plan,
    executedQueries: [],
    leads: [],
    readUrls: [],
    used: { searches: 0, pages: 0, pdfPages: 0, aiCalls: ctx.counter.aiCalls },
    nextEvidenceNumber: 1,
    stopReason: null,
    kb: { sources: kbSources, consumed: false, webSkipped },
  };
  return { outputRef: `agentAnalyses/${stateId(claim.claimId)}`, apply: (tx) => writeState(tx, ctx, state) };
}

export async function runResearchSearch(ctx: StageContext): Promise<StageResult> {
  const claim = ctx.claim!;
  const state = await loadState(claim.claimId);
  await runSearches(ctx, state.plan, state, budgetFor(claim, ctx.job.deep));
  state.used.aiCalls += ctx.counter.aiCalls;
  return { outputRef: `agentAnalyses/${stateId(claim.claimId)}`, apply: (tx) => writeState(tx, ctx, state) };
}

export async function runResearchRead(ctx: StageContext): Promise<StageResult> {
  const claim = ctx.claim!;
  const topic = await loadTopic(claim);
  const state = await loadState(claim.claimId);
  const existing = await loadEvidence(claim.claimId);
  const { records } = await readLeads(ctx, topic, state, budgetFor(claim, ctx.job.deep), existing);
  markIndependence([...existing, ...records], claim.attributionClaim ?? false);
  state.used.aiCalls += ctx.counter.aiCalls;
  return {
    outputRef: `evidence:${records.length}`,
    apply: (tx) => {
      evidenceWrites(tx, records);
      writeState(tx, ctx, state);
    },
    events: evidenceEvents(records),
  };
}

/** Sufficient = enough direct, reliable, independent verified evidence (PART 9.6). */
export function isSufficient(records: EvidenceRecord[], target: number, attributionClaim = false): boolean {
  const strong = records.filter(
    (r) =>
      r.provenanceStatus === 'quote_verified' &&
      r.directness === 'direct' &&
      !r.originalSourceId &&
      isEvidenceGrade(r.sourcePolicy, attributionClaim) &&
      effectiveTier(r.sourcePolicy, r.qualityAssessment?.credibility.rating, attributionClaim) !== 'low',
  );
  return new Set(strong.map((r) => r.domain)).size >= target;
}

export async function runResearchRefine(ctx: StageContext): Promise<StageResult> {
  const claim = ctx.claim!;
  const attributionClaim = claim.attributionClaim ?? false;
  const topic = await loadTopic(claim);
  const state = await loadState(claim.claimId);
  const budget = budgetFor(claim, ctx.job.deep);
  const existing = await loadEvidence(claim.claimId);
  let added: EvidenceRecord[] = [];

  const searchesLeft = budget.maxSearches - state.used.searches;
  const pagesLeft = budget.maxPagesFetched - state.used.pages;
  const aiLeft = budget.maxAiCalls - state.used.aiCalls;
  if (isSufficient(existing, budget.targetIndependentSources, attributionClaim)) {
    state.stopReason = 'sufficient';
  } else if (searchesLeft <= 0 || pagesLeft <= 0 || aiLeft <= 2) {
    state.stopReason = 'budget_exhausted';
  } else {
    const found = existing
      .filter((e) => e.provenanceStatus === 'quote_verified' && e.urlOrigin !== 'classroom_material')
      .map((e) => `- ${e.sourceTitle ?? e.domain} (${e.domain})`)
      .join('\n');
    // When the first web round was skipped in favour of the knowledge base, this is the only web round.
    const more = await planQueries(ctx, topic, Math.min(state.kb?.webSkipped ? 6 : 4, searchesLeft), found || '- none verified yet');
    const before = state.leads.length;
    await runSearches(ctx, more, state, budget);
    if (state.leads.length === before) {
      state.stopReason = 'no_new_results';
    } else {
      added = (await readLeads(ctx, topic, state, budget, existing)).records;
      const all = [...existing, ...added];
      markIndependence(all, attributionClaim);
      state.stopReason = isSufficient(all, budget.targetIndependentSources, attributionClaim)
        ? 'sufficient'
        : added.some((r) => r.provenanceStatus === 'quote_verified')
          ? 'budget_exhausted'
          : 'no_new_results';
    }
  }
  state.used.aiCalls += ctx.counter.aiCalls;

  const all = [...existing, ...added];
  markIndependence(all, attributionClaim);
  // Context-only sites (social networks, blogs, file sharing, Wikipedia, known disinformation) can be quoted but never decide a verdict.
  const quoted = all.filter((r) => r.provenanceStatus === 'quote_verified');
  const verified = quoted.filter((r) => isEvidenceGrade(r.sourcePolicy, attributionClaim)).length;
  const contextOnly = quoted.length - verified;
  const reasonText: Record<string, string> = {
    sufficient: 'Stopped: direct, reliable, independent evidence covers the claim.',
    budget_exhausted: 'Stopped: the research budget is exhausted.',
    no_new_results: 'Stopped: further searching found nothing new.',
  };
  await logAction(ctx, {
    agentType: 'researcher',
    action: 'research_stopped',
    queryOrUrl: topic.topicStatement,
    resultSummary: `${reasonText[state.stopReason!]} ${verified} source(s) with verified excerpts, ${independentCount(all, attributionClaim)} independent.${contextOnly ? ` ${contextOnly} more are context only and cannot decide the verdict.` : ''}`,
    details: { kind: 'stopped', stopReason: state.stopReason, verified, independent: independentCount(all, attributionClaim), contextOnly },
  });

  // Fail closed: zero quote_verified evidence from sources that can be evidence means no verdict (PART 0.5 rule 5).
  const failed = verified === 0;
  const failMessage =
    contextOnly > 0
      ? 'Only context-only sources (social networks, blogs, file-sharing sites, Wikipedia or known disinformation sites) were found. They cannot decide a verdict.'
      : 'No usable evidence with a verified excerpt was retrieved.';
  return {
    outputRef: `evidence:${all.length}`,
    apply: (tx) => {
      evidenceWrites(tx, all.filter((r) => added.includes(r) || existing.includes(r)));
      writeState(tx, ctx, state);
    },
    events: [
      ...evidenceEvents(added),
      ...(failed
        ? [
            {
              type: 'stage_failed' as const,
              summary: `${failMessage} No verdict can be produced.`,
              data: { code: 'RESEARCH_FAILED', willRetry: false },
            },
          ]
        : []),
    ],
    claimOutcome: failed
      ? { outcome: 'research_failed', failure: { stageKey: ctx.stageKey, code: 'RESEARCH_FAILED', message: failMessage } }
      : undefined,
  };
}

// All tunable numbers and model names live here (PART 9.6 / 10.5 / 17).
// Secrets are read from process.env on the server only and never exported raw.
import type { ComplexityClass, TimeSensitivity } from '../shared/schemas';

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export const MODELS = {
  // Fast model for extraction, triage, research and debate steps (stable, GA).
  fast: process.env.GEMINI_MODEL_FAST || 'gemini-3.8-flash',
  // Strongest model, used only for the Judge. No stable Pro text model is
  // published yet; 3.1 Pro is the newest Pro and is still a preview, so it can
  // change or be retired. Override with GEMINI_MODEL_JUDGE when a stable one ships.
  judge: process.env.GEMINI_MODEL_JUDGE || 'gemini-3.1-pro-preview',
  // Multilingual embedding model for the knowledge base (Armenian, Russian, English).
  embed: process.env.GEMINI_MODEL_EMBED || 'gemini-embedding-001',
} as const;

/** Low randomness for extraction, research and the Judge (PART 0.5 rule 8). */
export const TEMPERATURE = {
  extraction: 0,
  triage: 0,
  research: 0.1,
  judge: 0,
  debate: 0.3,
  pedagogue: 0.4,
} as const;

// Generous limits: Gemini 3 thinking tokens count toward maxOutputTokens.
export const MAX_OUTPUT_TOKENS = {
  extraction: 16384,
  triage: 4096,
  research: 12288,
  debate: 8192,
  judge: 16384,
  pedagogue: 8192,
  audit: 12288,
  ocr: 32768,
} as const;

export const AI_LIMITS = {
  /** One controlled repair retry for invalid structured output (PART 0.5 rule 6). */
  repairRetries: 1,
  requestTimeoutMs: 90_000,
  /** Exponential backoff on 429 from Gemini. */
  rateLimitRetries: 3,
  rateLimitBaseDelayMs: 2_000,
} as const;

export interface ResearchBudget {
  targetIndependentSources: number;
  maxSearches: number;
  maxPagesFetched: number;
  maxPdfPages: number;
  maxAiCalls: number;
}

/** Targets are suggestions, budgets are hard caps (PART 9.6). */
export const RESEARCH_BUDGETS: Record<ComplexityClass, ResearchBudget> = {
  basic: { targetIndependentSources: 2, maxSearches: 6, maxPagesFetched: 8, maxPdfPages: 20, maxAiCalls: 24 },
  standard: { targetIndependentSources: 4, maxSearches: 12, maxPagesFetched: 16, maxPdfPages: 40, maxAiCalls: 36 },
  complex: { targetIndependentSources: 6, maxSearches: 20, maxPagesFetched: 30, maxPdfPages: 80, maxAiCalls: 56 },
};
/** "Run deeper investigation" multiplies the budget and forces full mode. */
export const DEEP_BUDGET_MULTIPLIER = 1.5;

export const RESEARCH = {
  maxEvidencePerDomain: 2,
  fetchTimeoutMs: 15_000,
  maxFetchBytes: 8 * 1024 * 1024,
  maxStoredPageChars: 300_000,
  passageChars: 700,
  passagesPerSource: 4,
  sourcesPerAssessmentCall: 4,
  fetchConcurrency: 4,
  searchConcurrency: 3,
  userAgent: 'TruthEngineClassroom/1.0 (educational research bot)',
} as const;

/** Cache TTLs depend on time sensitivity (PART 10.7). */
export const CACHE_TTL_MS: Record<TimeSensitivity, number> = {
  stable: 7 * 24 * 3600_000,
  time_sensitive: 3 * 3600_000,
};

/**
 * Knowledge base (vector search in front of web search). Similarity only decides
 * which stored passages are worth showing to the source assessor; it never decides
 * whether a claim is supported.
 */
export const KB = {
  /** Firestore vectors support up to 2048 dimensions. Must match firestore.indexes.json. */
  dimensions: 768,
  /** Texts per embedding request. */
  embedBatch: 64,
  chunkChars: 800,
  /** A source is indexed only up to this many characters (about 75 chunks). */
  maxIndexedCharsPerSource: 60_000,
  /** Candidates fetched from each vector query before filtering. */
  candidates: 30,
  /** Cosine similarity floor for a passage to be considered at all. */
  minSimilarity: num('KB_MIN_SIMILARITY', 0.62),
  /** A source whose best passage reaches this counts towards "the KB probably covers it". */
  strongSimilarity: num('KB_STRONG_SIMILARITY', 0.72),
  /** Public pages older than this are not used (stable claims only; time-sensitive claims never use public pages). */
  publicMaxAgeMs: num('KB_PUBLIC_MAX_AGE_DAYS', 90) * 24 * 3600_000,
  /** Passages passed to the assessor per source. */
  passagesPerSource: 4,
  maxSourcesPerTrack: 6,
  /** Per classroom. */
  maxMaterialsPerClassroom: num('LIMIT_MATERIALS_PER_CLASSROOM', 50),
  maxChunksPerMaterial: 400,
  /** Brute-force fallback (emulator / tests only) reads at most this many documents. */
  bruteForceMaxDocs: 5000,
} as const;

export const PIPELINE = {
  claimConcurrency: num('CLAIM_CONCURRENCY', 3),
  maxStageAttempts: 3,
  stageLeaseMs: 4 * 60_000,
  retryBaseDelayMs: 5_000,
  maxStageMs: 4 * 60_000,
  /** Total time spent running stages for one job (pauses do not count). */
  maxJobProcessingMs: num('MAX_JOB_PROCESSING_MINUTES', 30) * 60_000,
  /** No advance call for this long and no live lease → the job is reported as paused. */
  pauseAfterIdleMs: 45_000,
  defaultMaxClaims: num('MAX_CLAIMS_PER_SUBMISSION', 5),
} as const;

export const USAGE_LIMITS = {
  verificationsPerDay: num('LIMIT_VERIFICATIONS_PER_DAY', 20),
  uploadsPerDay: num('LIMIT_UPLOADS_PER_DAY', 10),
  maxTextChars: 30_000,
  maxFileBytes: num('LIMIT_MAX_FILE_MB', 15) * 1024 * 1024,
  maxDocumentPages: num('LIMIT_MAX_PAGES', 40),
  maxOcrPages: num('LIMIT_MAX_OCR_PAGES', 15),
  requestsPerMinute: num('LIMIT_REQUESTS_PER_MINUTE', 120),
} as const;

export const AUDIT = {
  maxReferencesChecked: 8,
  maxQuotationsChecked: 5,
} as const;

export function readGeminiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key ? key : null;
}

/** Comma-separated emails that are granted the admin role on sign-in (bootstrap, PART 6.2). */
export function bootstrapAdminEmails(): string[] {
  return (process.env.BOOTSTRAP_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

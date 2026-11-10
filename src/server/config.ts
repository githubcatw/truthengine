// All tunable numbers and model names live here (PART 9.6 / 10.5).
// Secrets are read from process.env on the server only and never exported raw.

export const MODELS = {
  // Verify these names against the current Gemini model list in your project;
  // override with GEMINI_MODEL_FAST / GEMINI_MODEL_JUDGE if they differ.
  fast: process.env.GEMINI_MODEL_FAST || 'gemini-2.5-flash',
  judge: process.env.GEMINI_MODEL_JUDGE || 'gemini-2.5-pro',
} as const;

/** Low randomness for extraction, research and the Judge (PART 0.5 rule 8). */
export const TEMPERATURE = {
  extraction: 0,
  triage: 0,
  research: 0.1,
  judge: 0,
  debate: 0.3,
} as const;

export const AI_LIMITS = {
  /** One controlled repair retry for invalid structured output (PART 0.5 rule 6). */
  repairRetries: 1,
  requestTimeoutMs: 60_000,
} as const;

export function readGeminiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key ? key : null;
}

// The only module that talks to the Gemini API. Server-side only.
import { GoogleGenAI } from '@google/genai';
import { AI_LIMITS, readGeminiKey } from '../config';
import { AppError } from '../errors';

export interface GroundingSource {
  uri: string;
  title: string | null;
}

export interface GenerateRequest {
  model: string;
  systemInstruction: string;
  /** Already-assembled prompt; untrusted content must be wrapped with wrapUntrusted(). */
  prompt: string;
  temperature: number;
  maxOutputTokens?: number;
  /** Ask for JSON output. Cannot be combined with googleSearch on some models (PART 9.1). */
  json?: boolean;
  googleSearch?: boolean;
}

export interface GenerateResult {
  text: string;
  /** URLs from grounding metadata — the only model-adjacent URLs we ever accept. */
  groundingSources: GroundingSource[];
  webSearchQueries: string[];
}

/** Abstraction so tests can inject a mocked client (fixtures live only in /tests). */
export interface GeminiClient {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

function classifyError(err: unknown): AppError {
  const status = (err as { status?: number })?.status;
  const message = String((err as Error)?.message ?? '');
  if (status === 400 && /api key/i.test(message)) {
    return new AppError('GEMINI_INVALID_KEY', 'The Gemini API key was rejected. Check the server Secrets configuration.');
  }
  if (status === 401 || status === 403) {
    return new AppError('GEMINI_INVALID_KEY', 'The Gemini API key was rejected. Check the server Secrets configuration.');
  }
  if (status === 429) {
    return new AppError('GEMINI_QUOTA_EXHAUSTED', 'The Gemini quota is exhausted. Existing data is preserved; try again later.');
  }
  return new AppError('INTERNAL', 'The AI service request failed.', { status });
}

export function createGeminiClient(): GeminiClient {
  const apiKey = readGeminiKey();
  if (!apiKey) {
    throw new AppError(
      'GEMINI_NOT_CONFIGURED',
      'The Gemini API key is not configured. Add GEMINI_API_KEY to the server Secrets.',
    );
  }
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generate(req) {
      try {
        const response = await ai.models.generateContent({
          model: req.model,
          contents: req.prompt,
          config: {
            systemInstruction: req.systemInstruction,
            temperature: req.temperature,
            maxOutputTokens: req.maxOutputTokens,
            responseMimeType: req.json ? 'application/json' : undefined,
            tools: req.googleSearch ? [{ googleSearch: {} }] : undefined,
            abortSignal: AbortSignal.timeout(AI_LIMITS.requestTimeoutMs),
          },
        });
        const meta = response.candidates?.[0]?.groundingMetadata;
        const groundingSources: GroundingSource[] = (meta?.groundingChunks ?? [])
          .map((c) => c.web)
          .filter((w): w is NonNullable<typeof w> => Boolean(w?.uri))
          .map((w) => ({ uri: w.uri as string, title: w.title ?? null }));
        return {
          text: response.text ?? '',
          groundingSources,
          webSearchQueries: meta?.webSearchQueries ?? [],
        };
      } catch (err) {
        throw classifyError(err);
      }
    },
  };
}

let singleton: GeminiClient | null = null;
/** Lazily created so a missing key surfaces as a clear setup error, not a crash at boot. */
export function getGeminiClient(): GeminiClient {
  singleton ??= createGeminiClient();
  return singleton;
}

// The only module that talks to the Gemini API. Server-side only.
import { GoogleGenAI } from '@google/genai';
import { AI_LIMITS, readGeminiKey } from '../config';
import { AppError } from '../errors';
import { log } from '../logger';

export interface GroundingSource {
  uri: string;
  title: string | null;
  /** Text segments the grounding metadata attributes to this source. A lead, never a quotation. */
  snippets: string[];
}

export interface InlinePart {
  mimeType: string;
  /** base64 data */
  data: string;
}

export interface GenerateRequest {
  model: string;
  systemInstruction: string;
  /** Already-assembled prompt; untrusted content must be wrapped with wrapUntrusted(). */
  prompt: string;
  temperature: number;
  maxOutputTokens?: number;
  /** Ask for JSON output. Never combined with googleSearch (kept as separate calls, PART 9.1). */
  json?: boolean;
  /** JSON Schema for the response (sent as responseJsonSchema; falls back to the prompt). */
  jsonSchema?: Record<string, unknown>;
  googleSearch?: boolean;
  inline?: InlinePart[];
}

export interface GenerateResult {
  text: string;
  /** URLs from grounding metadata — the only model-adjacent URLs we ever accept. */
  groundingSources: GroundingSource[];
  webSearchQueries: string[];
  /** e.g. STOP or MAX_TOKENS (output cut off). */
  finishReason?: string | null;
}

/** Abstraction so tests can inject a mocked client (fixtures live only in /tests). */
export interface GeminiClient {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

function classifyError(err: unknown): AppError {
  const status = (err as { status?: number })?.status;
  const message = String((err as Error)?.message ?? '');
  if ((status === 400 && /api key/i.test(message)) || status === 401 || status === 403) {
    return new AppError('GEMINI_INVALID_KEY', 'The Gemini API key was rejected. Check the server Secrets configuration.');
  }
  if (status === 429) {
    return new AppError('GEMINI_QUOTA_EXHAUSTED', 'The Gemini quota is exhausted. Existing data is preserved; try again later.');
  }
  if (status === 404) {
    return new AppError('INTERNAL', 'The configured Gemini model was not found. Check GEMINI_MODEL_FAST / GEMINI_MODEL_JUDGE.', { status });
  }
  if ((err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError') {
    return new AppError('INTERNAL', 'The AI service did not respond in time.', { timeout: true });
  }
  return new AppError('INTERNAL', 'The AI service request failed.', { status });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Set once the API refuses responseJsonSchema; the schema is then sent in the prompt. */
let schemaInPrompt = false;

export function createGeminiClient(): GeminiClient {
  const apiKey = readGeminiKey();
  if (!apiKey) {
    throw new AppError(
      'GEMINI_NOT_CONFIGURED',
      'The Gemini API key is not configured. Add GEMINI_API_KEY to the server Secrets.',
    );
  }
  const ai = new GoogleGenAI({ apiKey });

  async function once(req: GenerateRequest): Promise<GenerateResult> {
    const useSchemaParam = Boolean(req.json && req.jsonSchema && !schemaInPrompt);
    const promptText =
      req.json && req.jsonSchema && schemaInPrompt
        ? `${req.prompt}\n\nReturn JSON that matches this JSON Schema exactly (field names, types and enum values):\n${JSON.stringify(req.jsonSchema)}`
        : req.prompt;
    const parts: Array<{ text: string } | { inlineData: InlinePart }> = [
      ...(req.inline ?? []).map((p) => ({ inlineData: p })),
      { text: promptText },
    ];
    const response = await ai.models.generateContent({
      model: req.model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: req.systemInstruction,
        temperature: req.temperature,
        maxOutputTokens: req.maxOutputTokens,
        responseMimeType: req.json ? 'application/json' : undefined,
        responseJsonSchema: useSchemaParam ? req.jsonSchema : undefined,
        tools: req.googleSearch ? [{ googleSearch: {} }] : undefined,
        abortSignal: AbortSignal.timeout(AI_LIMITS.requestTimeoutMs),
      },
    });
    const meta = response.candidates?.[0]?.groundingMetadata;
    const chunks = meta?.groundingChunks ?? [];
    const sources: GroundingSource[] = chunks.map((c) => ({
      uri: c.web?.uri ?? '',
      title: c.web?.title ?? null,
      snippets: [],
    }));
    for (const support of meta?.groundingSupports ?? []) {
      const text = support.segment?.text?.trim();
      if (!text) continue;
      for (const idx of support.groundingChunkIndices ?? []) {
        const s = sources[idx];
        if (s && s.snippets.length < 3) s.snippets.push(text);
      }
    }
    return {
      text: response.text ?? '',
      groundingSources: sources.filter((s) => s.uri),
      webSearchQueries: meta?.webSearchQueries ?? [],
      finishReason: response.candidates?.[0]?.finishReason ?? null,
    };
  }

  return {
    async generate(req) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await once(req);
        } catch (err) {
          // The API refused the response schema: send it in the prompt from now on.
          if ((err as { status?: number })?.status === 400 && req.jsonSchema && !schemaInPrompt && /schema/i.test(String((err as Error)?.message))) {
            schemaInPrompt = true;
            log.warn('responseJsonSchema refused by the API; sending the schema in the prompt instead');
            continue;
          }
          const classified = err instanceof AppError ? err : classifyError(err);
          if (classified.code === 'GEMINI_QUOTA_EXHAUSTED' && attempt < AI_LIMITS.rateLimitRetries) {
            await sleep(AI_LIMITS.rateLimitBaseDelayMs * 2 ** attempt);
            continue;
          }
          throw classified;
        }
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

/** Test hook: inject a mocked client. Only called from /tests. */
export function setGeminiClientForTests(client: GeminiClient | null): void {
  singleton = client;
}

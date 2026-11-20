// Structured output only (PART 0.5 rule 6): every agent call returns JSON that
// is validated by Zod, with exactly one controlled repair retry. If it is still
// invalid the caller receives an AI_OUTPUT_INVALID error to persist on the stage.
import type { z } from 'zod';
import { AI_LIMITS } from '../config';
import { AppError } from '../errors';
import type { GeminiClient, GenerateRequest, InlinePart } from './gemini';
import { toResponseSchema } from './jsonSchema';
import { UNTRUSTED_RULES } from './untrusted';
import { log } from '../logger';

/** Schemas the API refused (e.g. "Constraint is too tall"); they are sent in the prompt instead. */
const refusedSchemas = new Set<string>();

function isSchemaRefusal(err: unknown): boolean {
  return err instanceof AppError && err.code === 'INTERNAL' && (err.detail as { status?: number } | undefined)?.status === 400;
}

/** Puts the schema into the prompt and stops sending it as responseJsonSchema. */
function schemaInPrompt(req: GenerateRequest): GenerateRequest {
  return {
    ...req,
    jsonSchema: undefined,
    prompt: `${req.prompt}\n\nReturn JSON that matches this JSON Schema exactly (field names, types, enum values and the limits in the descriptions):\n${JSON.stringify(req.jsonSchema)}`,
  };
}

export interface StructuredCallOptions<T extends z.ZodTypeAny> {
  client: GeminiClient;
  schema: T;
  model: string;
  systemInstruction: string;
  prompt: string;
  temperature: number;
  maxOutputTokens?: number;
  inline?: InlinePart[];
  /** Repeated in the repair prompt (the topic-lock block, PART 11.1 rule 2). */
  repairContext?: string;
  /** Shared per-stage counter so AI calls are tracked (PART 10.5 rule 7). */
  counter?: { aiCalls: number };
  /** Exact values for top-level string fields (topic-lock identifiers). */
  pins?: Record<string, string>;
  /** Extra deterministic checks after Zod (e.g. topic lock, evidence IDs). Return an error string or null. */
  postValidate?: (value: z.infer<T>) => string | null;
}

export interface StructuredCallResult<T> {
  value: T;
  aiCalls: number;
  repaired: boolean;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  return JSON.parse(trimmed);
}

function check<T extends z.ZodTypeAny>(
  text: string,
  finishReason: string | null | undefined,
  schema: T,
  postValidate?: (v: z.infer<T>) => string | null,
): { ok: true; value: z.infer<T> } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = parseJson(text);
  } catch {
    if (finishReason === 'MAX_TOKENS') return { ok: false, problem: 'Output was cut off by the token limit. Return shorter, complete JSON.' };
    return { ok: false, problem: 'Output was not valid JSON.' };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, problem: `Schema validation failed: ${issues}` };
  }
  const extra = postValidate?.(parsed.data);
  if (extra) return { ok: false, problem: extra };
  return { ok: true, value: parsed.data };
}

export async function callStructured<T extends z.ZodTypeAny>(
  opts: StructuredCallOptions<T>,
): Promise<StructuredCallResult<z.infer<T>>> {
  const system = `${opts.systemInstruction}\n\n${UNTRUSTED_RULES}\nRespond with a single JSON object only.`;
  const base: GenerateRequest = {
    model: opts.model,
    systemInstruction: system,
    prompt: opts.prompt,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    inline: opts.inline,
    json: true,
    jsonSchema: toResponseSchema(opts.schema, opts.pins),
  };

  let aiCalls = 0;
  let problem = '';
  for (let attempt = 0; attempt <= AI_LIMITS.repairRetries; attempt++) {
    const req =
      attempt === 0
        ? base
        : {
            ...base,
            // Thinking tokens count toward the limit: give the repair attempt more room.
            maxOutputTokens: base.maxOutputTokens ? base.maxOutputTokens * 2 : undefined,
            prompt: `${opts.prompt}\n\nYOUR PREVIOUS OUTPUT WAS REJECTED: ${problem}\n${opts.repairContext ? `${opts.repairContext}\n` : ''}Return corrected JSON that satisfies the required schema. Do not add information that is not in the inputs.`,
          };
    const key = JSON.stringify(req.jsonSchema ?? null);
    let sent = req.jsonSchema && refusedSchemas.has(key) ? schemaInPrompt(req) : req;
    let result;
    try {
      result = await opts.client.generate(sent);
    } catch (err) {
      if (!sent.jsonSchema || !isSchemaRefusal(err)) throw err;
      // The API rejected the response schema: retry this call with the schema in the prompt.
      refusedSchemas.add(key);
      log.warn('responseJsonSchema refused by the API (HTTP 400); retrying with the schema in the prompt');
      aiCalls++;
      if (opts.counter) opts.counter.aiCalls++;
      sent = schemaInPrompt(req);
      result = await opts.client.generate(sent);
    }
    aiCalls++;
    if (opts.counter) opts.counter.aiCalls++;
    const outcome = check(result.text, result.finishReason, opts.schema, opts.postValidate);
    if (outcome.ok) return { value: outcome.value, aiCalls, repaired: attempt > 0 };
    problem = outcome.problem;
  }
  throw new AppError('AI_OUTPUT_INVALID', 'The AI returned output that failed validation after one repair attempt.', {
    problem,
    aiCalls,
  });
}

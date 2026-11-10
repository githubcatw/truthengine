// Structured output only (PART 0.5 rule 6): every agent call returns JSON that
// is validated by Zod, with exactly one controlled repair retry. If it is still
// invalid the caller receives an AI_OUTPUT_INVALID error to persist on the stage.
import type { z } from 'zod';
import { AI_LIMITS } from '../config';
import { AppError } from '../errors';
import type { GeminiClient, GenerateRequest } from './gemini';
import { UNTRUSTED_RULES } from './untrusted';

export interface StructuredCallOptions<T extends z.ZodTypeAny> {
  client: GeminiClient;
  schema: T;
  model: string;
  systemInstruction: string;
  prompt: string;
  temperature: number;
  maxOutputTokens?: number;
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
  schema: T,
  postValidate?: (v: z.infer<T>) => string | null,
): { ok: true; value: z.infer<T> } | { ok: false; problem: string } {
  let raw: unknown;
  try {
    raw = parseJson(text);
  } catch {
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
    json: true,
  };

  let aiCalls = 0;
  let problem = '';
  for (let attempt = 0; attempt <= AI_LIMITS.repairRetries; attempt++) {
    const req =
      attempt === 0
        ? base
        : {
            ...base,
            prompt: `${opts.prompt}\n\nYOUR PREVIOUS OUTPUT WAS REJECTED: ${problem}\nReturn corrected JSON that satisfies the required schema. Do not add information that is not in the inputs.`,
          };
    const result = await opts.client.generate(req);
    aiCalls++;
    const outcome = check(result.text, opts.schema, opts.postValidate);
    if (outcome.ok) return { value: outcome.value, aiCalls, repaired: attempt > 0 };
    problem = outcome.problem;
  }
  throw new AppError('AI_OUTPUT_INVALID', 'The AI returned output that failed validation after one repair attempt.', {
    problem,
    aiCalls,
  });
}

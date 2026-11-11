import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { callStructured } from '../../src/server/ai/structured';
import { AppError } from '../../src/server/errors';
import { mockGemini } from '../helpers/mockGemini';

const Schema = z.object({ answer: z.string().max(20), evidenceIds: z.array(z.string()) });
const base = { schema: Schema, model: 'm', systemInstruction: 'sys', prompt: 'p', temperature: 0 };

describe('structured output with one repair retry', () => {
  it('returns valid output on the first call', async () => {
    const client = mockGemini(['{"answer":"ok","evidenceIds":[]}']);
    const r = await callStructured({ ...base, client });
    expect(r).toMatchObject({ value: { answer: 'ok' }, aiCalls: 1, repaired: false });
    expect(client.calls[0]!.json).toBe(true);
  });

  it('repairs once and tells the model what was wrong', async () => {
    const client = mockGemini(['not json', '{"answer":"ok","evidenceIds":[]}']);
    const r = await callStructured({ ...base, client });
    expect(r).toMatchObject({ aiCalls: 2, repaired: true });
    expect(client.calls[1]!.prompt).toMatch(/PREVIOUS OUTPUT WAS REJECTED: Output was not valid JSON/);
  });

  it('fails with AI_OUTPUT_INVALID after the single repair attempt', async () => {
    const client = mockGemini(['{"answer":1}', '{"answer":2}', '{"answer":"never used","evidenceIds":[]}']);
    await expect(callStructured({ ...base, client })).rejects.toMatchObject({ code: 'AI_OUTPUT_INVALID' });
    expect(client.calls).toHaveLength(2);
  });

  it('applies deterministic post-validation such as evidence ID checks', async () => {
    const client = mockGemini(['{"answer":"a","evidenceIds":["E9"]}', '{"answer":"a","evidenceIds":["E9"]}']);
    const err = await callStructured({
      ...base,
      client,
      postValidate: (v) => (v.evidenceIds.includes('E9') ? 'Unknown evidence IDs cited: E9' : null),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(client.calls[1]!.prompt).toMatch(/E9/);
  });

  it('sends the JSON Schema with pinned topic-lock values, and gives the repair more room after truncation', async () => {
    const calls: any[] = [];
    const client = {
      async generate(req: any) {
        calls.push(req);
        return calls.length === 1
          ? { text: '{"answer":"cut', groundingSources: [], webSearchQueries: [], finishReason: 'MAX_TOKENS' }
          : { text: '{"answer":"ok","evidenceIds":[]}', groundingSources: [], webSearchQueries: [], finishReason: 'STOP' };
      },
    };
    await callStructured({ ...base, client, maxOutputTokens: 1000, pins: { answer: 'ok' } });
    expect(calls[0].jsonSchema.properties.answer).toEqual({ type: 'string', enum: ['ok'] });
    expect(calls[0].jsonSchema.required).toEqual(['answer', 'evidenceIds']);
    expect(calls[1].prompt).toMatch(/cut off by the token limit/);
    expect(calls[1].maxOutputTokens).toBe(2000);
  });
});

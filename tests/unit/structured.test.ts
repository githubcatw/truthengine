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

  it('falls back to the schema in the prompt when the API refuses it (400), and remembers that', async () => {
    const { AppError } = await import('../../src/server/errors');
    const calls: any[] = [];
    const client = {
      async generate(req: any) {
        calls.push(req);
        if (req.jsonSchema) throw new AppError('INTERNAL', 'The AI service request failed.', { status: 400 });
        return { text: '{"answer":"ok","evidenceIds":[]}', groundingSources: [], webSearchQueries: [] };
      },
    };
    const Other = z.object({ answer: z.string().max(20), evidenceIds: z.array(z.string()).max(2) });
    const r = await callStructured({ ...base, schema: Other, client });
    expect(r.value.answer).toBe('ok');
    expect(calls).toHaveLength(2);
    expect(calls[1].jsonSchema).toBeUndefined();
    expect(calls[1].prompt).toMatch(/matches this JSON Schema exactly/);
    expect(calls[1].prompt).toMatch(/at most 2 items/);
    // The refused schema is not sent again.
    await callStructured({ ...base, schema: Other, client });
    expect(calls).toHaveLength(3);
    expect(calls[2].jsonSchema).toBeUndefined();
  });

  it('never sends item counts as schema keywords (they inflate the decoding grammar)', async () => {
    const calls: any[] = [];
    const client = { async generate(req: any) { calls.push(req); return { text: '{"answer":"ok","evidenceIds":[]}', groundingSources: [], webSearchQueries: [] }; } };
    await callStructured({ ...base, client });
    expect(JSON.stringify(calls[0].jsonSchema)).not.toMatch(/"maxItems"|"minItems"|"maxLength"|"pattern"/);
  });
});

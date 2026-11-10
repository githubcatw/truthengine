// Shared wrapper for every claim-level agent call: fixed leading TOPIC block,
// structured output, deterministic topic-lock check first (PART 11.1).
import type { z } from 'zod';
import { callStructured } from '../ai/structured';
import { topicLockError } from '../validation/contract';
import type { DebateTopic, TopicLock } from '../../shared/schemas';
import type { StageContext } from '../pipeline/types';
import { topicBlock } from './prompts';

export interface AgentCallOptions<T extends z.ZodTypeAny> {
  ctx: StageContext;
  topic: DebateTopic;
  schema: T;
  model: string;
  system: string;
  body: string;
  temperature: number;
  maxOutputTokens: number;
  postValidate?: (value: z.infer<T>) => string | null;
}

export function lockOf(topic: DebateTopic): TopicLock {
  return { claimId: topic.claimId, debateId: topic.debateId, topicHash: topic.topicHash };
}

export async function agentCall<T extends z.ZodTypeAny>(opts: AgentCallOptions<T>): Promise<z.infer<T>> {
  const block = topicBlock(opts.topic);
  const expected = lockOf(opts.topic);
  const { value } = await callStructured({
    client: opts.ctx.gemini(),
    schema: opts.schema,
    model: opts.model,
    systemInstruction: opts.system,
    prompt: `${block}\n\n${opts.body}`,
    temperature: opts.temperature,
    maxOutputTokens: opts.maxOutputTokens,
    counter: opts.ctx.counter,
    repairContext: block,
    postValidate: (v) => topicLockError(v as Partial<TopicLock>, expected) ?? opts.postValidate?.(v) ?? null,
  });
  return value;
}

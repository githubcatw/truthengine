// Test-only mocked Gemini client. Never imported by the app (checked by bundle.test.ts).
import type { GeminiClient, GenerateRequest, GenerateResult } from '../../src/server/ai/gemini';

export const FIXTURE_MARKER = 'TE_TEST_FIXTURE_MARKER_7f3a9c';

export function mockGemini(responses: string[]): GeminiClient & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];
  return {
    calls,
    async generate(req): Promise<GenerateResult> {
      calls.push(req);
      const text = responses[calls.length - 1];
      if (text === undefined) throw new Error('mockGemini: no response queued');
      return { text, groundingSources: [], webSearchQueries: [] };
    },
  };
}

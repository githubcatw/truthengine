import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../src/server/app';
import { createGeminiClient } from '../../src/server/ai/gemini';
import { redact } from '../../src/server/logger';

const FAKE_KEY = 'AIza' + 'x'.repeat(35);

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
});

describe('Gemini key handling', () => {
  it('missing key produces a clear setup error, not fake results', () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => createGeminiClient()).toThrowError(/not configured/);
  });

  it('logger redacts the key', () => {
    process.env.GEMINI_API_KEY = FAKE_KEY;
    expect(redact(`key=${FAKE_KEY}`)).toBe('key=[REDACTED]');
  });

  it('setup-status reports configuration without returning the key', async () => {
    process.env.GEMINI_API_KEY = FAKE_KEY;
    const server = createApp().listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/setup-status`);
      const body = await res.text();
      expect(JSON.parse(body).gemini.configured).toBe(true);
      expect(body).not.toContain(FAKE_KEY);
      const missing = await fetch(`http://127.0.0.1:${port}/api/nope`);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    } finally {
      server.close();
    }
  });
});

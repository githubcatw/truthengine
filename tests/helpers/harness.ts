// Test-only harness: real Express app + Firebase emulators + scripted Gemini.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../../src/server/app';
import { setGeminiClientForTests, type GeminiClient } from '../../src/server/ai/gemini';
import type { FetchOutcome } from '../../src/server/research/fetcher';

const PROJECT = 'demo-truthengine';

export async function clearEmulators() {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

export async function createUser(email: string) {
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }) },
  );
  const body = (await res.json()) as { idToken: string; localId: string };
  return { token: body.idToken, uid: body.localId, email };
}

export function startServer(): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createApp().listen(0, () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }));
  });
}

export function useGemini(client: GeminiClient) {
  setGeminiClientForTests(client);
}

export function apiClient(base: string, token: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

export type Api = ReturnType<typeof apiClient>;

const TERMINAL = ['completed', 'partially_completed', 'research_failed', 'failed', 'cancelled', 'superseded'];

/** Calls advance until the job reaches `stopAt` (default: a terminal status) or claim confirmation. */
export async function drive(api: Api, jobId: string, max = 80) {
  let view: any;
  for (let i = 0; i < max; i++) {
    const r = await api('POST', `/verifications/${jobId}/advance`);
    if (r.status !== 200) throw new Error(`advance failed: ${JSON.stringify(r.body)}`);
    view = r.body;
    if (TERMINAL.includes(view.job.status)) return view;
    if (view.job.currentStage === 'awaiting_confirmation' && !view.job.confirmedAt) return view;
    if (!view.ran.length && !view.busy) {
      // Nothing ready: a retry backoff is pending.
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return view;
}

/** A deterministic stand-in for real web pages, keyed by host. */
export function fakeFetch(failHosts: string[] = []) {
  return async (url: string): Promise<FetchOutcome> => {
    const host = new URL(url).hostname;
    if (failHosts.includes(host) || failHosts.includes('*')) {
      return { ok: false, requestedUrl: url, finalUrl: url, reason: 'blocked_403', detail: 'HTTP 403' };
    }
    return {
      ok: true,
      requestedUrl: url,
      finalUrl: url,
      title: `Page at ${host}`,
      kind: 'html',
      pages: [{ page: null, text: `The source at ${host} documents the statement in detail. It reports that the statement under review is described in standard references. Further context follows here for readers.` }],
    };
  };
}

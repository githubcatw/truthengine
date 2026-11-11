import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { apiClient, clearEmulators, createUser, drive, fakeFetch, startServer, useGemini, type Api } from '../helpers/harness';
import { fakeGemini } from '../helpers/fakeGemini';
import { PNG, docx, pdf } from '../helpers/fixtures';

const fetchMock = vi.hoisted(() => ({ impl: null as null | ((u: string) => Promise<unknown>) }));
vi.mock('../../src/server/research/fetcher', async (orig) => {
  const real = await orig<typeof import('../../src/server/research/fetcher')>();
  return { ...real, fetchSource: (u: string) => fetchMock.impl!(u) };
});

let server: Server;
let base: string;
let api: Api;
let token: string;

beforeAll(async () => {
  process.env.GEMINI_API_KEY = 'test-key-not-used-by-the-fake';
  ({ server, url: base } = await startServer());
});
afterAll(() => {
  server.close();
  delete process.env.GEMINI_API_KEY;
});
beforeEach(async () => {
  await clearEmulators();
  fetchMock.impl = fakeFetch() as never;
  useGemini(fakeGemini({ unreadablePages: [3] }));
  const u = await createUser(`doc${Date.now()}@example.com`);
  token = u.token;
  api = apiClient(base, u.token);
});

async function upload(buf: Buffer, type: string, name: string, tok = token) {
  const res = await fetch(`${base}/api/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) },
    body: buf,
  });
  return { status: res.status, body: await res.json() };
}

describe('document upload and extraction', () => {
  it('text PDF: native text per page, with page numbers', async () => {
    const r = await upload(await pdf(['The canal was opened to shipping in the late autumn.', 'The second page talks about the lighthouse keepers.']), 'application/pdf', 'a.pdf');
    expect(r.status).toBe(200);
    expect(r.body.pages).toEqual([
      { pageNumber: 1, status: 'extracted', warning: null },
      { pageNumber: 2, status: 'extracted', warning: null },
    ]);
    expect(r.body.text).toContain('The canal was opened');
  });

  it('scanned PDF: pages without text are read by OCR; unreadable pages are recorded, not omitted', async () => {
    const r = await upload(await pdf(['A normal page of text about the old harbour walls.', null, null]), 'application/pdf', 'scan.pdf');
    expect(r.status).toBe(200);
    expect(r.body.pages.map((p: any) => p.status)).toEqual(['extracted', 'ocr', 'failed']);
    expect(r.body.pages[2].warning).toBe('The scan is too blurry to read.');
    expect(r.body.warnings.join(' ')).toMatch(/1 page\(s\) could not be read/);
    expect(r.body.text).toContain('Scanned page 2');
    const meta = await api('GET', `/files/${r.body.fileId}`);
    expect(meta.body.pages).toHaveLength(3);
    expect(meta.body.storagePath).toBeUndefined();
  });

  it('DOCX and TXT are extracted', async () => {
    const d = await upload(docx(['Heading of the essay', 'The bridge was painted green in the summer.']), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'e.docx');
    expect(d.status).toBe(200);
    expect(d.body.text).toContain('Heading of the essay');
    const t = await upload(Buffer.from('Հայերեն տեքստ։ The tower was restored in brick.'), 'text/plain', 'n.txt');
    expect(t.status).toBe(200);
    expect(t.body.text).toContain('Հայերեն տեքստ');
  });

  it('images are read with OCR', async () => {
    const r = await upload(PNG, 'image/png', 'photo.png');
    expect(r.status).toBe(200);
    expect(r.body.pages[0].status).toBe('ocr');
  });

  it('encrypted, corrupted, unsupported and mismatched files are rejected with clear messages', async () => {
    const enc = await upload(await pdf(['secret text on this page'], { password: 'pw' }), 'application/pdf', 'locked.pdf');
    expect(enc.status).toBe(422);
    expect(enc.body.error.code).toBe('ENCRYPTED_FILE');
    expect(enc.body.error.message).toMatch(/unprotected copy/);
    const bad = await upload(Buffer.from('%PDF-1.4\nthis is not really a pdf'), 'application/pdf', 'broken.pdf');
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('CORRUPTED_FILE');
    const exe = await upload(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0xff, 0xfe]), 'application/octet-stream', 'tool.exe');
    expect(exe.body.error.code).toBe('UNSUPPORTED_FILE');
    const mismatch = await upload(PNG, 'application/pdf', 'fake.pdf');
    expect(mismatch.body.error.code).toBe('UNSUPPORTED_FILE');
  });

  it('upload is disabled with a setup message when Storage is not configured', async () => {
    const saved = process.env.FIREBASE_STORAGE_BUCKET;
    delete process.env.FIREBASE_STORAGE_BUCKET;
    try {
      const r = await upload(Buffer.from('Some text that would be uploaded.'), 'text/plain', 'x.txt');
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
      const status = await (await fetch(`${base}/api/setup-status`)).json();
      expect(status.storage.configured).toBe(false);
    } finally {
      process.env.FIREBASE_STORAGE_BUCKET = saved;
    }
  });

  it('another user cannot read or download the file', async () => {
    const r = await upload(Buffer.from('Private notes about the river crossing.'), 'text/plain', 'p.txt');
    const other = apiClient(base, (await createUser('other-doc@example.com')).token);
    expect((await other('GET', `/files/${r.body.fileId}`)).status).toBe(404);
    expect((await other('GET', `/files/${r.body.fileId}/download`)).status).toBe(404);
    const own = await fetch(`${base}/api/files/${r.body.fileId}/download`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await own.text()).toBe('Private notes about the river crossing.');
  });
});

describe('document jobs and the Quality and Citation Audit', () => {
  it('runs the audit in parallel with extraction, uses cautious wording, and records extraction events', async () => {
    const text = 'The museum received 48213 visitors last year according to many. More detail is at the archive site listed here.';
    useGemini(
      fakeGemini({
        audit: {
          unsourcedFigure: 'The museum received 48213 visitors last year according to many.',
          referenceUrl: { passage: 'More detail is at the archive site listed here.', url: 'https://archive.example.org/missing' },
        },
      }),
    );
    fetchMock.impl = fakeFetch(['archive.example.org']) as never;
    const up = await upload(Buffer.from(text), 'text/plain', 'essay.txt');
    const created = await api('POST', '/verifications', { text: up.body.text, idempotencyKey: `doc-${Date.now()}`, fileId: up.body.fileId });
    expect(created.status).toBe(200);
    const awaiting = await drive(api, created.body.jobId);
    expect(awaiting.stages.find((s: any) => s.stageKey === 'audit').status).toBe('completed');
    const findings = (await api('GET', `/verifications/${created.body.jobId}/findings`)).body.items;
    const labels = findings.map((f: any) => f.label);
    expect(labels).toContain('Source not identified');
    expect(labels).toContain('Reference could not be independently verified');
    for (const f of findings) {
      // The only allowed mention is the explicit negation ("This does not mean it is fake.").
      const asserted = `${f.label} ${f.explanation}`.replace(/This does not mean it (is fake|was invented)\./g, '');
      expect(asserted).not.toMatch(/fake|invented|fabricat|written by AI|used AI/i);
      expect(f.check.performed).toBeTruthy();
      expect(f.check.result).toBeTruthy();
      expect(text).toContain(f.passage);
    }
    const events = (await api('GET', `/verifications/${created.body.jobId}/events?limit=500`)).body.items;
    expect(events.filter((e: any) => e.type === 'extraction_page')).toHaveLength(1);
    expect(events.filter((e: any) => e.type === 'quality_finding')).toHaveLength(findings.length);
  });

  it('claims from a document keep the page they came from; findings include the document for highlighting', async () => {
    const up = await upload(await pdf(['The first page describes the old school building and its garden.', 'The observatory dome was installed on the roof in the cold winter.']), 'application/pdf', 'two.pdf');
    const created = await api('POST', '/verifications', { text: up.body.text, idempotencyKey: `pages-${Date.now()}`, fileId: up.body.fileId });
    const awaiting = await drive(api, created.body.jobId);
    const dome = awaiting.claims.find((c: any) => c.originalText.includes('observatory dome'));
    expect(dome.context.sourceLocation).toBe('page 2');
    const first = awaiting.claims.find((c: any) => c.originalText.includes('first page'));
    expect(first.context.sourceLocation).toBe('page 1');
    const findings = (await api('GET', `/verifications/${created.body.jobId}/findings`)).body;
    expect(findings).toHaveProperty('documentText');
  });
});

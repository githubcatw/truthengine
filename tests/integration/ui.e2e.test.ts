// Browser end-to-end: register → submit text → confirm claim → research → debate →
// Judge → result → refresh and retrieve the same result. Real UI, real emulators,
// scripted Gemini and stand-in web pages (test-only).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { clearEmulators, fakeFetch, startServer, useGemini } from '../helpers/harness';
import { fakeGemini } from '../helpers/fakeGemini';

const fetchMock = vi.hoisted(() => ({ impl: null as null | ((u: string) => Promise<unknown>) }));
vi.mock('../../src/server/research/fetcher', async (orig) => {
  const real = await orig<typeof import('../../src/server/research/fetcher')>();
  return { ...real, fetchSource: (u: string) => fetchMock.impl!(u) };
});

const root = path.resolve(__dirname, '../..');
let server: Server;
let base: string;
// The environment's pre-installed Playwright (resolved via require, like the project docs describe).
const { chromium } = createRequire(import.meta.url)('playwright');
let browser: any;

beforeAll(async () => {
  execSync('npx vite build --logLevel error --outDir dist-e2e', {
    cwd: root,
    stdio: 'pipe',
    env: {
      ...process.env,
      VITE_FIREBASE_API_KEY: 'fake-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
      VITE_FIREBASE_PROJECT_ID: 'demo-truthengine',
      VITE_FIREBASE_APP_ID: 'demo',
      VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1',
    },
  });
  process.env.NODE_ENV = 'production';
  process.env.STATIC_DIR = 'dist-e2e';
  await clearEmulators();
  fetchMock.impl = fakeFetch() as never;
  useGemini(fakeGemini());
  ({ server, url: base } = await startServer());
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
  delete process.env.STATIC_DIR;
  process.env.NODE_ENV = 'test';
});

describe('UI end-to-end', () => {
  it('runs a full investigation in the browser and shows the stored result after refresh', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`${base}/`);
    await page.locator('select[aria-label]').first().selectOption('en');
    await page.goto(`${base}/register`);
    await page.getByLabel('Your name').fill('Ani');
    await page.getByLabel('Email').fill(`ui${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');
    await page.getByText('You have not verified anything yet.').waitFor();

    await page.goto(`${base}/new`);
    const box = page.getByPlaceholder('Paste text or upload a document to verify');
    expect(await box.inputValue()).toBe(''); // starts empty: no sample claims
    await box.fill('The old library on the hill was rebuilt in stone after the great fire of that decade.');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await page.waitForURL('**/investigations/**');
    await page.getByRole('button', { name: 'Start the investigation' }).click({ timeout: 60_000 });

    // The animation reads persisted events through the realtime listener (Firestore rules apply).
    await page.getByText('View full report').first().waitFor({ timeout: 90_000 });
    await page.screenshot({ path: path.join(root, 'dist-e2e', 'investigation.png'), fullPage: true });
    const reportLink = page.getByRole('link', { name: 'View full report' }).first();
    await reportLink.click();
    await page.waitForURL('**/results/**');
    await page.getByText('I choose the Defender because').waitFor();
    await page.getByText('CORRECT', { exact: true }).first().waitFor();
    await page.getByText('Verified excerpt (found in retrieved content)').first().waitFor();
    await page.getByText('This is AI-assisted verification, not official certification. Read the sources yourself.').waitFor();
    await page.screenshot({ path: path.join(root, 'dist-e2e', 'results.png'), fullPage: true });

    await page.reload();
    await page.getByText('I choose the Defender because').waitFor();
    await page.goto(`${base}/history`);
    await page.getByText('The old library on the hill').first().waitFor();
    expect(errors).toEqual([]);
  });

  it('shows one courtroom per claim; selecting a card shows only that claim', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/`);
    await page.locator('select[aria-label]').first().selectOption('en');
    await page.goto(`${base}/register`);
    await page.getByLabel('Your name').fill('Aram');
    await page.getByLabel('Email').fill(`court${Date.now()}@example.com`);
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');
    await page.goto(`${base}/new`);
    await page.getByPlaceholder('Paste text or upload a document to verify').fill('The northern bridge was rebuilt with granite blocks. The southern market hall opened on a rainy spring morning.');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await page.waitForURL('**/investigations/**');
    await page.getByRole('button', { name: 'Start the investigation' }).click({ timeout: 60_000 });
    await page.getByText('View full report').first().waitFor({ timeout: 120_000 });

    // Overview + two claim cards; no speed control once finished? (finished = replay, so it is shown)
    const cards = page.locator('button[aria-pressed]');
    await expect.poll(() => cards.count()).toBe(3);
    await page.screenshot({ path: path.join(root, 'dist-e2e', 'courtroom.png'), fullPage: false });

    await cards.nth(2).click();
    await page.getByText('The southern market hall opened on a rainy spring morning.', { exact: false }).first().waitFor();
    const header = page.locator('.sticky.top-14');
    await expect.poll(() => header.innerText()).toContain('southern market hall');
    // The transcript of this courtroom contains no search for the other claim.
    await page.getByText('Text transcript').click();
    const transcript = await page.locator('details ol').innerText();
    expect(transcript).not.toContain('northern bridge');
    expect(transcript).toContain('southern market hall');

    // Scrub to a search event and capture the bubble with site chips.
    const range = page.locator('input[type=range]');
    for (let i = 0; i < 40; i++) {
      await range.fill(String(i));
      if (await page.locator('text=/\\d+ results/').first().isVisible().catch(() => false)) break;
    }
    await page.screenshot({ path: path.join(root, 'dist-e2e', 'search-bubble.png'), fullPage: true });
  });
});

// Builds the client and checks that no fixtures, server code, or secrets reach the bundle (PART 0.2 / 0.3).
import { beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { FIXTURE_MARKER } from '../helpers/mockGemini';

const root = path.resolve(__dirname, '../..');
const FAKE_KEY = 'AIza' + 'q'.repeat(35);

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

let bundle = '';

beforeAll(() => {
  execSync('npx vite build --logLevel error', { cwd: root, env: { ...process.env, GEMINI_API_KEY: FAKE_KEY }, stdio: 'pipe' });
  bundle = filesUnder(path.join(root, 'dist'))
    .filter((f) => /\.(js|css|html)$/.test(f))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
});

describe('built client bundle', () => {
  it('contains no test fixtures or mocked client', () => {
    expect(bundle).not.toContain(FIXTURE_MARKER);
    expect(bundle).not.toContain('mockGemini');
  });

  it('contains no Gemini key or server-only code', () => {
    expect(bundle).not.toContain(FAKE_KEY);
    expect(bundle).not.toContain('GEMINI_API_KEY');
    expect(bundle).not.toContain('@google/genai');
    expect(bundle).not.toContain('firebase-admin');
  });

  it('client sources never import from tests or server', () => {
    for (const f of filesUnder(path.join(root, 'src/client'))) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"][^'"]*(tests|\/server)\//);
    }
  });
});

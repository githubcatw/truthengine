// Seeds the knowledge base with Wikipedia articles you choose.
//
//   npm run kb:seed -- titles.txt [--dry-run]
//
// titles.txt has one article per line as `lang:Title`, for example:
//   hy:Հայաստան
//   ru:Ереван
//   en:Mount_Ararat
// Blank lines and lines starting with # are ignored. This is a curated seed, not a
// dump: the full Wikipedias are far too large for this index. Choose the topics your
// classes actually cover. Article text is CC BY-SA; each chunk keeps its article URL.
import { readFileSync } from 'node:fs';
import { RESEARCH } from '../src/server/config';
import { getGeminiClient } from '../src/server/ai/gemini';
import { chunkPages } from '../src/server/kb/chunk';
import { indexPublicSource } from '../src/server/kb/store';

const file = process.argv[2];
if (!file || file.startsWith('--')) {
  console.error('Usage: npm run kb:seed -- titles.txt [--dry-run]');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const entries = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const i = l.indexOf(':');
    return { lang: l.slice(0, i), title: l.slice(i + 1).replace(/_/g, ' ') };
  })
  .filter((e) => /^[a-z]{2,3}$/.test(e.lang) && e.title);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let indexed = 0;
let chunks = 0;
let failed = 0;

for (const { lang, title } of entries) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({ action: 'query', format: 'json', redirects: '1', prop: 'extracts|info', explaintext: '1', inprop: 'url', titles: title }).toString();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': RESEARCH.userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { query?: { pages?: Record<string, { missing?: string; title: string; extract?: string; fullurl?: string }> } };
    const page = Object.values(body.query?.pages ?? {})[0];
    if (!page || page.missing !== undefined || !page.extract || !page.fullurl) throw new Error('article not found');
    const pages = [{ page: null, text: page.extract }];
    if (dryRun) {
      chunks += chunkPages(pages).length;
      indexed++;
    } else {
      const r = await indexPublicSource(getGeminiClient(), { url: page.fullurl, title: page.title, kind: 'wikipedia', pages });
      if (r.chunks) {
        indexed++;
        chunks += r.chunks;
      } else failed++;
    }
  } catch (err) {
    failed++;
    console.warn(`${lang}:${title} — ${(err as Error).message}`);
  }
  await sleep(250);
}
console.log(`${dryRun ? 'Would index' : 'Indexed'} ${indexed} article(s), ${chunks} chunk(s). Failed or empty: ${failed}.`);

// Indexes public pages already stored in Firestore (pageCache) into the knowledge base.
//
//   npm run kb:backfill -- [--dry-run] [--limit 500]
//
// Only pageCache is read: it holds public web pages and nothing else. Student
// submissions, uploaded documents and teacher materials are never touched.
// Only pages cached with the long "stable" lifetime are indexed, because the
// knowledge base is used for stable claims only.
import { CACHE_TTL_MS } from '../src/server/config';
import { getGeminiClient } from '../src/server/ai/gemini';
import { chunkPages } from '../src/server/kb/chunk';
import { indexPublicSource } from '../src/server/kb/store';
import { C, col } from '../src/server/pipeline/store';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

let seen = 0;
let indexed = 0;
let skipped = 0;
let chunks = 0;
let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;

for (;;) {
  let q = col(C.pageCache).orderBy('__name__').limit(100);
  if (last) q = q.startAfter(last);
  const snap = await q.get();
  if (snap.empty) break;
  for (const doc of snap.docs) {
    last = doc;
    if (seen >= limit) break;
    seen++;
    const d = doc.data();
    const stable = d.expiresAtMs - d.fetchedAtMs >= CACHE_TTL_MS.stable;
    const page = d.page as { finalUrl: string; title: string | null; pages: Array<{ page: number | null; text: string }> } | undefined;
    if (!stable || !page?.pages?.length) {
      skipped++;
      continue;
    }
    if (dryRun) {
      chunks += chunkPages(page.pages).length;
      indexed++;
      continue;
    }
    const r = await indexPublicSource(getGeminiClient(), { url: page.finalUrl, title: page.title, kind: 'web', pages: page.pages, fetchedAtMs: d.fetchedAtMs });
    if (r.chunks) {
      indexed++;
      chunks += r.chunks;
    } else skipped++;
  }
  if (seen >= limit) break;
}
console.log(`${dryRun ? 'Would index' : 'Indexed'} ${indexed} page(s), ${chunks} chunk(s). Skipped ${skipped} (time-sensitive, empty or failed). Scanned ${seen}.`);

// Imports or refreshes one imported list of the source-credibility database. Each run replaces that
// list's records and leaves the other lists alone.
//
//   npm run credibility:import -- wikipedia [--dry-run]
//   npm run credibility:import -- doaj [--dry-run] [--max-pages N]
//   npm run credibility:import -- euvsdisinfo outlets.txt [--dry-run]
//
// Set CREDIBILITY_IMPORT_CONTACT (a URL or address) so the sites can reach you; it is added to the
// User-Agent. A download that fails part-way aborts the run, so a partial list never replaces a
// complete one. If the new list is under half the size of the stored one, add --force to proceed.
import { readFileSync } from 'node:fs';
import { C, col } from '../src/server/pipeline/store';
import { replaceOrigin } from '../src/server/research/credibility/store';
import type { StoredCredibility } from '../src/server/research/credibility/resolve';
import { politeGet } from '../src/server/research/credibility/importers/http';
import { parseRspPage, rspRecords, rspSubpages, RSP_PAGE } from '../src/server/research/credibility/importers/wikipedia';
import { DOAJ_FIRST_PAGE, doajRecords, parseDoajPage, type DoajJournal } from '../src/server/research/credibility/importers/doaj';
import { euvsdisinfoRecords, parseOutletFile } from '../src/server/research/credibility/importers/euvsdisinfo';

const args = process.argv.slice(2);
const source = args[0];
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--max-pages');
const now = Date.now();

async function wikipedia(): Promise<StoredCredibility[]> {
  const page = async (title: string) => {
    const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2`;
    const body = (await (await politeGet(url, { minGapMs: 3000, accept: 'application/json' })).json()) as { parse?: { wikitext?: string } };
    if (!body.parse?.wikitext) throw new Error(`No wikitext for ${title}`);
    return body.parse.wikitext;
  };
  const subpages = rspSubpages(await page(RSP_PAGE));
  if (!subpages.length) throw new Error('Found no subpages in the perennial sources page; its layout has changed.');
  const entries = [];
  let pathScoped = 0;
  let withoutHosts = 0;
  for (const n of subpages) {
    const r = parseRspPage(await page(`${RSP_PAGE}/${n}`));
    console.log(`  subpage ${n}: ${r.entries.length} entries`);
    entries.push(...r.entries);
    pathScoped += r.pathScoped;
    withoutHosts += r.withoutHosts;
  }
  console.log(`Wikipedia: ${entries.length} entries; skipped ${pathScoped} path-scoped domain(s) and ${withoutHosts} entry(ies) with no domain.`);
  return rspRecords(entries, now);
}

async function doaj(): Promise<StoredCredibility[]> {
  const maxPages = Number(flag('--max-pages')) || Infinity;
  const journals: DoajJournal[] = [];
  let url: string | null = DOAJ_FIRST_PAGE;
  let pages = 0;
  let withoutHost = 0;
  while (url && pages < maxPages) {
    // DOAJ allows about two requests a second.
    const body = parseDoajPage(await (await politeGet(url, { minGapMs: 700, accept: 'application/json' })).json());
    journals.push(...body.journals);
    withoutHost += body.withoutHost;
    pages++;
    url = body.next;
    if (pages % 20 === 0) console.log(`  ${pages} page(s), ${journals.length} journal(s)`);
  }
  if (url) console.log(`Stopped after ${pages} page(s) because of --max-pages; this is a partial list.`);
  console.log(`DOAJ: ${journals.length} journal(s) with a homepage; ${withoutHost} without one.`);
  return doajRecords(journals, now);
}

function euvsdisinfo(): StoredCredibility[] {
  const file = positional[0];
  if (!file) throw new Error('Usage: credibility:import -- euvsdisinfo outlets.txt (one outlet per line: a domain, a URL or "Name,url")');
  const parsed = parseOutletFile(readFileSync(file, 'utf8'));
  console.log(`EUvsDisinfo file: ${parsed.hosts.length} outlet(s); ${parsed.skippedLines} unusable line(s). Review the most frequent hosts:`);
  for (const h of parsed.hosts.slice(0, 15)) console.log(`  ${String(h.cases).padStart(5)}  ${h.host}  (${h.name})`);
  return euvsdisinfoRecords(parsed, now);
}

const origins = { wikipedia: 'wikipedia_rsp', doaj: 'doaj', euvsdisinfo: 'euvsdisinfo' } as const;
if (!source || !(source in origins)) {
  console.error('Usage: npm run credibility:import -- <wikipedia|doaj|euvsdisinfo> [file] [--dry-run] [--force] [--max-pages N]');
  process.exit(1);
}
const origin = origins[source as keyof typeof origins];

const records = source === 'wikipedia' ? await wikipedia() : source === 'doaj' ? await doaj() : euvsdisinfo();
const tiers = { high: 0, medium: 0, low: 0 };
for (const r of records) tiers[r.tier]++;
console.log(`${records.length} host record(s): ${tiers.high} high, ${tiers.medium} medium, ${tiers.low} low.`);

if (dryRun) {
  console.log('Dry run: nothing written.');
} else {
  const existing = (await col(C.sourceCredibility).where('origin', '==', origin).count().get()).data().count;
  if (existing > 0 && records.length < existing / 2 && !force) {
    console.error(`Refusing to replace ${existing} stored record(s) with only ${records.length}. If this is intended, run again with --force.`);
    process.exit(1);
  }
  const r = await replaceOrigin(origin, records);
  console.log(`Wrote ${r.written} record(s), removed ${r.removed} stale record(s).`);
}

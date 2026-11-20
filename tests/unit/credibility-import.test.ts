import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describesStateOwnership, entryScope, parseRspPage, plainWikitext, rspRecords, rspSubpages } from '../../src/server/research/credibility/importers/wikipedia';
import { doajRecords, parseDoajPage, DOAJ_FIRST_PAGE } from '../../src/server/research/credibility/importers/doaj';
import { euvsdisinfoRecords, parseOutletFile } from '../../src/server/research/credibility/importers/euvsdisinfo';
import { resolvePolicy } from '../../src/server/research/credibility/resolve';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

describe('Wikipedia perennial sources importer (real rows)', () => {
  const parsed = parseRspPage(fixture('rsp-sample.wikitext'));
  const records = rspRecords(parsed.entries, 1);
  const byHost = (h: string) => records.find((r) => r.host === h)!;

  it('reads every row of the sample with its status and domains', () => {
    expect(parsed.entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(['Salon', 'Scribd', 'Anadolu Agency', 'RT', 'Academic repositories', 'CNET (November 2022–present)']),
    );
    expect(parsed.entries.find((e) => e.name === 'Scribd')).toMatchObject({ status: 'gu', hosts: ['scribd.com'] });
    expect(parsed.entries.find((e) => e.name === 'Academic repositories')!.hosts).toEqual(['academia.edu', 'researchgate.net', 'zenodo.org']);
    expect(parsed.unknownStatus).toBe(0);
  });
  it('skips path-scoped entries instead of rating a whole site from one section', () => {
    expect(parsed.pathScoped).toBeGreaterThan(0);
    expect(records.some((r) => r.host.includes('/'))).toBe(false);
  });
  it('maps statuses to tiers: reliable high, no consensus medium, unreliable and deprecated low and context only', () => {
    expect(byHost('salon.com')).toMatchObject({ tier: 'medium', use: 'evidence' });
    expect(byHost('scribd.com')).toMatchObject({ tier: 'low', use: 'context_only', category: 'unreliable' });
    expect(byHost('rt.com')).toMatchObject({ tier: 'low', use: 'context_only', category: 'deprecated' });
  });
  it('a site covered by general and topic entries follows the general one and mentions the caveat', () => {
    expect(byHost('aa.com.tr')).toMatchObject({ tier: 'medium', name: 'Anadolu Agency' });
    expect(byHost('aa.com.tr')!.note).toMatch(/controversial topics/);
  });
  it('a site with period entries follows the current one', () => {
    expect(byHost('cnet.com')).toMatchObject({ tier: 'low', name: 'CNET (November 2022–present)' });
  });
  it('every record links back to its entry and says where it came from', () => {
    for (const r of records) {
      expect(r.origin).toBe('wikipedia_rsp');
      expect(r.sourceUrl).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\/Wikipedia:Reliable_sources\/Perennial_sources#/);
      expect(r.note).toMatch(/^Wikipedia editors list/);
    }
  });
  it('the imported record never overrides the project’s explicit choice for Wikipedia itself', () => {
    const imported = [{ ...byHost('scribd.com'), host: 'wikipedia.org', tier: 'low' as const, use: 'context_only' as const }];
    expect(resolvePolicy('en.wikipedia.org', imported)).toMatchObject({ tier: 'medium', origin: 'builtin' });
  });
  it('marks outlets the list describes as state-run, from the full summary', () => {
    expect(byHost('aa.com.tr')).toMatchObject({ stateOwned: true });
    expect(byHost('salon.com').stateOwned).toBeUndefined();
    expect(byHost('scribd.com').stateOwned).toBeUndefined();
  });
  it('detects ownership, control and funding by a state, not slant', () => {
    for (const yes of [
      'Deutsche Welle is a German state-owned international broadcaster.',
      'Wen Wei Po is a newspaper owned by the government of Hong Kong.',
      'Al Jazeera is a Qatari state funded news organization.',
      'The Shanghai United Media Group, which is government-controlled.',
      'Xinhua is the official state-run press agency.',
      'It is operated by the Ministry of Defence.',
    ]) expect(describesStateOwnership(yes), yes).toBe(true);
    for (const no of [
      'It engages in pro-government propaganda.',
      'PBS is a public broadcaster.',
      'It disseminates Iranian state propaganda and conspiracy theories.',
      'Founded by a former government minister, it is privately owned.',
    ]) expect(describesStateOwnership(no), no).toBe(false);
  });
  it('classifies entry names', () => {
    expect(entryScope('Salon')).toMatchObject({ scope: 'general' });
    expect(entryScope('Anadolu Agency (controversial topics)')).toMatchObject({ scope: 'topic', qualifier: 'controversial topics' });
    expect(entryScope('CNET (pre-October 2020)').scope).toBe('historical');
    expect(entryScope('CNET (November 2022–present)').scope).toBe('general');
    expect(entryScope('The Washington Free Beacon 2012-2018').scope).toBe('historical');
    expect(entryScope('The Washington Free Beacon 2019-present').scope).toBe('general');
  });
  it('finds the subpages the main page transcludes', () => {
    expect(rspSubpages('{{WP:Reliable sources/Perennial sources/2}} <!-- B -->\n{{WP:Reliable sources/Perennial sources/1}}\n{{WP:Reliable sources/Perennial sources/2}}')).toEqual([1, 2]);
  });
  it('strips wiki markup from summaries', () => {
    expect(plainWikitext("''[[Salon.com|Salon]]'' is [[WP:BIASED|biased]]. {{em|Only}} it.<ref>x</ref> &amp; more")).toBe('Salon is biased. it. & more');
  });
});

describe('DOAJ importer (real records)', () => {
  const page = parseDoajPage(JSON.parse(fixture('doaj-page.json')));
  const records = doajRecords(page.journals, 1);

  it('takes each journal’s homepage host and counts the ones without a homepage', () => {
    expect(page.journals.map((j) => j.host)).toEqual(['mlj.goums.ac.ir', 'czasopismanaukowe.mazowiecka.edu.pl', 'jurnal.unej.ac.id']);
    expect(page.withoutHost).toBe(1);
    expect(page.total).toBeGreaterThan(20000);
  });
  it('follows only links that stay on the DOAJ API', () => {
    expect(page.next).toMatch(/^https:\/\/doaj\.org\/api\//);
    expect(parseDoajPage({ results: [], next: 'https://evil.example/api/search' }).next).toBeNull();
    expect(parseDoajPage({ results: [], next: 'https://doaj.org.evil.example/api/x' }).next).toBeNull();
    expect(DOAJ_FIRST_PAGE.startsWith('https://doaj.org/api/')).toBe(true);
  });
  it('lists a DOAJ journal host as a high-credibility journal that can be evidence', () => {
    expect(records).toHaveLength(3);
    for (const r of records) expect(r).toMatchObject({ origin: 'doaj', tier: 'high', use: 'evidence', category: 'journal' });
    expect(records[0]!.note).toMatch(/Directory of Open Access Journals/);
  });
  it('a host with several journals is one record', () => {
    const j = { title: 'A', host: 'x.org', issn: null, seal: false };
    const r = doajRecords([j, { ...j, title: 'B', seal: true }], 1);
    expect(r).toHaveLength(1);
    expect(r[0]!.note).toMatch(/2 journals.*DOAJ Seal/);
  });
  it('is tolerant of malformed pages', () => {
    expect(parseDoajPage(null)).toMatchObject({ journals: [], next: null, total: null });
    expect(parseDoajPage({ results: [null, {}, { bibjson: { ref: { journal: 'not a url' } } }] }).journals).toEqual([]);
  });
});

describe('EUvsDisinfo outlet file importer', () => {
  it('reads domains, URLs, names and CSV rows, and counts repeated hosts', () => {
    const text = [
      '# outlets compiled from the EUvsDisinfo database',
      'outlet,url',
      'RT,https://www.rt.com/news/123',
      'Sputnik,"https://sputnikglobe.com/2024/1"',
      'rt.com',
      'https://ria.ru/20240101/x.html',
      'Pervyi Kanal; 1tv.ru',
      'not a line we can use',
    ].join('\n');
    const r = parseOutletFile(text);
    expect(r.hosts.map((h) => [h.host, h.cases])).toEqual([['rt.com', 2], ['sputnikglobe.com', 1], ['ria.ru', 1], ['1tv.ru', 1]]);
    expect(r.hosts.find((h) => h.host === 'rt.com')!.name).toBe('RT');
    expect(r.hosts.find((h) => h.host === '1tv.ru')!.name).toBe('Pervyi Kanal');
    expect(r.skippedLines).toBe(2); // the header and the sentence
  });
  it('marks outlets low, context only, and able to show what the outlet itself published', () => {
    const [rec] = euvsdisinfoRecords(parseOutletFile('rt.com'), 1);
    expect(rec).toMatchObject({ origin: 'euvsdisinfo', tier: 'low', use: 'context_only', category: 'disinformation', attribution: true });
    expect(rec!.sourceUrl).toBe('https://euvsdisinfo.eu/disinformation-cases/');
  });
});
